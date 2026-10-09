import * as path from 'path';
import crypto from 'crypto';
import {
    ALLOWED_PDF_EXTENSIONS,
    assertUploadedFileType,
    hasAllowedExtension,
    sanitizeStoredFileName,
} from './upload-security';
import { normalizeDesignApprovalRequestBody } from './request-normalization';
import {
    buildDesignedPdfAssetRecord,
    buildDesignApprovalOverrideUpdate,
    buildDesignApprovalSubmissionRecord,
} from './approval-transitions';

type DesignApprovalWorkflowDeps = {
    axios: any;
    fs: typeof import('fs').promises;
    pathModule: typeof path;
    execAsync: (command: string, options?: any) => Promise<{ stdout: string; stderr: string }>;
    DB_SERVICE_URL: string;
    CLICKUP_SERVICE_URL: string;
    clickupFinalizeTimeoutMs: number;
    getDocxRedlinerDir: () => string;
    getDocumentStorageRoot: () => string;
    resolveApprovedSourceDocx: (submissionId: string, candidatePath: string) => Promise<string>;
    compareMenuTexts: (
        docxText: string,
        pdfText: string,
        intent?: { removedContent?: any[]; requiredContent?: any[] }
    ) => { differences: any[]; alignments: any[] };
    reviewPdfVisuals: (pdfPath: string) => Promise<{
        status: string;
        model?: string;
        pagesReviewed: number;
        totalPages: number;
        findings: any[];
        message?: string;
    }>;
    visualReviewDifferences: (result: any) => any[];
    isClientInputError: (error: any) => boolean;
};

const APPROVED_MENU_STATUSES = new Set(['approved', 'approved_override']);

function publicSubmissionId(submission: any): string {
    return `${submission?.legacy_id || submission?.id || ''}`.trim();
}

function parseStoredApprovals(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function designApprovalPayload(submission: any): { rawPayload: any; designApproval: any } {
    const raw = submission?.raw_payload && typeof submission.raw_payload === 'object' && !Array.isArray(submission.raw_payload)
        ? submission.raw_payload
        : {};
    if (raw.design_approval && typeof raw.design_approval === 'object') {
        return { rawPayload: raw, designApproval: raw.design_approval };
    }
    const nested = raw.raw_payload && typeof raw.raw_payload === 'object' && !Array.isArray(raw.raw_payload)
        ? raw.raw_payload
        : {};
    return {
        rawPayload: Object.keys(nested).length ? nested : raw,
        designApproval: nested.design_approval && typeof nested.design_approval === 'object'
            ? nested.design_approval
            : {},
    };
}

function inferDesignApprovalServicePeriod(projectName: string, fileName: string): string {
    const source = `${projectName || ''} ${fileName || ''}`.toLowerCase();
    const patterns = [
        { pattern: /\bbreakfast\b/, label: 'Breakfast' },
        { pattern: /\bbrunch\b/, label: 'Brunch' },
        { pattern: /\blunch\b/, label: 'Lunch' },
        { pattern: /\bdinner\b/, label: 'Dinner' },
        { pattern: /\bhappy\s+hour\b/, label: 'Happy Hour' },
        { pattern: /\bbeverage|drink|cocktail|bar\b/, label: 'Beverage' },
        { pattern: /\bwine\b/, label: 'Wine' },
        { pattern: /\bdesserts?\b/, label: 'Dessert' },
        { pattern: /\bkids?\b/, label: 'Kids' },
        { pattern: /\bprix|set\s+menu|half\s+board\b/, label: 'Set Menu' },
        { pattern: /\bnew\s*year|nye\b/, label: 'NYE' },
        { pattern: /\bvalentine\b/, label: "Valentine's" },
        { pattern: /\beaster\b/, label: 'Easter' },
        { pattern: /\bevent\b/, label: 'Event' },
    ];

    return patterns.find((item) => item.pattern.test(source))?.label || '';
}

export function parseExtractorJson(stdout: string, extractorLabel: string): any {
    const output = (stdout || '').trim();
    if (!output) {
        throw new Error(`${extractorLabel} returned no data`);
    }

    try {
        return JSON.parse(output);
    } catch {
        // Extractors are required to keep stdout JSON-only, but a third-party
        // library can still print a diagnostic first. Accept one complete JSON
        // object on the final non-empty line so an upstream warning does not
        // turn a valid upload into an opaque parser error.
        const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const jsonLine = [...lines].reverse().find((line) => line.startsWith('{') && line.endsWith('}'));
        if (jsonLine) {
            try {
                return JSON.parse(jsonLine);
            } catch {
                // Fall through to the stable workflow error below.
            }
        }
        throw new Error(`${extractorLabel} returned invalid JSON`);
    }
}

export function getDesignComparisonSource(docxData: any): string {
    const source = typeof docxData?.comparison_menu_content === 'string'
        ? docxData.comparison_menu_content
        : (docxData?.menu_content || '');
    return source.trim();
}

export function createDesignApprovalWorkflowHandlers(deps: DesignApprovalWorkflowDeps) {
    const runClickUpHandoff = async (submissionId: string): Promise<any> => {
        try {
            const response = await deps.axios.post(
                `${deps.CLICKUP_SERVICE_URL}/design-approval/finalize`,
                { designApprovalSubmissionId: submissionId },
                { timeout: deps.clickupFinalizeTimeoutMs }
            );
            return response.data || { success: false, status: 'failed', handoffComplete: false };
        } catch (error: any) {
            const message = error?.response?.data?.error || error?.response?.data?.details || error.message || 'ClickUp handoff failed';
            try {
                const currentResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
                const current = currentResponse.data || {};
                const { rawPayload, designApproval } = designApprovalPayload(current);
                await deps.axios.put(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`, {
                    raw_payload: {
                        ...rawPayload,
                        design_approval: {
                            ...designApproval,
                            handoff: {
                                ...(designApproval.handoff || {}),
                                status: 'failed',
                                handoff_complete: false,
                                error: `${message}`,
                                last_attempt_at: new Date().toISOString(),
                            },
                        },
                    },
                });
            } catch (persistError: any) {
                console.error('Failed to persist design handoff failure:', persistError.message);
            }
            return {
                success: false,
                status: 'failed',
                handoffComplete: false,
                warning: `${message}`,
            };
        }
    };

    const compare = async (req: any, res: any) => {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        const tempFiles: string[] = [];
        const {
            submitterName,
            submitterEmail,
            submitterJobTitle,
            menuId,
        } = normalizeDesignApprovalRequestBody(req.body);

        try {
            if (!files?.pdfFile?.[0]) {
                return res.status(400).json({ error: 'PDF file is required' });
            }

            if (!menuId) {
                return res.status(400).json({ error: 'Select an approved menu before submitting the design' });
            }

            const menuResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/menus/${encodeURIComponent(menuId)}`);
            const selectedMenu = menuResponse.data?.menu || null;
            const sourceSubmissionId = `${selectedMenu?.current_submission_id || ''}`.trim();
            if (!selectedMenu || selectedMenu.status !== 'active' || !sourceSubmissionId) {
                return res.status(409).json({ error: 'The selected menu no longer has a current approved version. Refresh and select it again.' });
            }

            const subResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(sourceSubmissionId)}`);
            const baselineSubmission = subResponse.data || {};
            const baselineStatus = `${baselineSubmission.status || ''}`.trim().toLowerCase();
            const baselineSource = `${baselineSubmission.source || ''}`.trim();
            if (!APPROVED_MENU_STATUSES.has(baselineStatus) || (baselineSource && baselineSource !== 'form' && baselineSource !== 'clickup_history_import')) {
                return res.status(409).json({ error: 'The selected menu version is no longer eligible for design approval. Refresh and select the current version.' });
            }
            const canonicalSourceSubmissionId = publicSubmissionId(baselineSubmission);
            if (!canonicalSourceSubmissionId || canonicalSourceSubmissionId !== sourceSubmissionId) {
                return res.status(409).json({ error: 'The selected menu changed while this page was open. Refresh and select the current version.' });
            }
            const candidatePath = `${baselineSubmission.final_path || ''}`.trim();
            if (!candidatePath) {
                return res.status(409).json({ error: 'The current approved menu does not have an approved Word file available' });
            }
            const docxPath = await deps.resolveApprovedSourceDocx(sourceSubmissionId, candidatePath);
            const docxOriginalName = sanitizeStoredFileName(baselineSubmission.filename, 'approved-menu.docx');

            const pdfFile = files.pdfFile[0];
            tempFiles.push(pdfFile.path);
            const pdfFileName = sanitizeStoredFileName(pdfFile.originalname, 'design-approval.pdf');
            if (!hasAllowedExtension(pdfFileName, ALLOWED_PDF_EXTENSIONS)) {
                return res.status(400).json({ error: 'Second file must be a PDF' });
            }
            await assertUploadedFileType(pdfFile.path, ['pdf']);

            const docxRedlinerDir = deps.getDocxRedlinerDir();
            const venvPython = deps.pathModule.join(docxRedlinerDir, 'venv', 'bin', 'python');
            let pythonCmd: string;
            try {
                await deps.fs.access(venvPython);
                pythonCmd = `"${venvPython}"`;
            } catch {
                pythonCmd = 'python3';
            }

            const extractDetailsScript = deps.pathModule.join(docxRedlinerDir, 'extract_project_details.py');
            const detailsResult = await deps.execAsync(
                `${pythonCmd} "${extractDetailsScript}" "${docxPath}"`,
                { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
            );

            const docxData = parseExtractorJson(detailsResult.stdout, 'DOCX extractor');
            if (docxData.error) {
                return res.status(400).json({ error: `DOCX extraction failed: ${docxData.error}` });
            }

            const extractPdfScript = deps.pathModule.join(docxRedlinerDir, 'extract_pdf_text.py');
            const pdfResult = await deps.execAsync(
                `${pythonCmd} "${extractPdfScript}" "${pdfFile.path}"`,
                { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
            );

            const pdfData = parseExtractorJson(pdfResult.stdout, 'PDF extractor');
            if (pdfData.error) {
                return res.status(400).json({ error: `PDF extraction failed: ${pdfData.error}` });
            }
            if (!pdfData.has_text_layer) {
                return res.status(400).json({
                    error: 'The PDF does not contain a text layer. It may be a scanned image. Please provide a PDF with selectable text.'
                });
            }

            const docxText = getDesignComparisonSource(docxData);
            const pdfText = (pdfData.full_text || '').trim();
            const documentMarkup = {
                removedContent: Array.isArray(docxData.removed_content) ? docxData.removed_content : [],
                requiredContent: Array.isArray(docxData.required_content) ? docxData.required_content : [],
            };
            const { differences: allDifferences, alignments } = deps.compareMenuTexts(
                docxText,
                pdfText,
                documentMarkup,
            );
            const visualReview = await deps.reviewPdfVisuals(pdfFile.path);
            const differences = [
                ...allDifferences.filter((d: any) => d.severity !== 'info'),
                ...deps.visualReviewDifferences(visualReview),
            ];
            const isMatch = differences.length === 0;

            const projectDetails = docxData.project_details || {};
            const servicePeriod = `${baselineSubmission.service_period || baselineSubmission.raw_payload?.servicePeriod || selectedMenu.service_period || ''}`.trim() || inferDesignApprovalServicePeriod(
                projectDetails.project_name || '',
                docxOriginalName || ''
            );
            const submissionId = `design-${crypto.randomUUID()}`;
            const pdfStorageDir = deps.pathModule.join(deps.getDocumentStorageRoot(), 'design-approvals', submissionId);
            const pdfPath = deps.pathModule.join(pdfStorageDir, pdfFileName);
            await deps.fs.mkdir(pdfStorageDir, { recursive: true });
            await deps.fs.copyFile(pdfFile.path, pdfPath);

            const storedApprovals = parseStoredApprovals(baselineSubmission.approvals);
            await deps.axios.post(
                `${deps.DB_SERVICE_URL}/submissions`,
                buildDesignApprovalSubmissionRecord({
                    submissionId,
                    submitterEmail,
                    submitterName,
                    submitterJobTitle,
                    projectName: baselineSubmission.project_name || projectDetails.project_name || selectedMenu.name || 'Design Approval',
                    property: baselineSubmission.property || projectDetails.property || selectedMenu.property || '',
                    size: baselineSubmission.size || projectDetails.size || '',
                    orientation: baselineSubmission.orientation || projectDetails.orientation || '',
                    pdfFileName,
                    pdfPath,
                    status: isMatch ? 'approved' : 'needs_correction',
                    requiredApprovals: storedApprovals,
                    sourceMenuId: menuId,
                    sourceSubmissionId,
                    clickupTaskId: baselineSubmission.clickup_task_id,
                    differences,
                    visualReview,
                    servicePeriod,
                })
            );
            await deps.axios.post(
                `${deps.DB_SERVICE_URL}/assets`,
                buildDesignedPdfAssetRecord({
                    submissionId,
                    sourceSubmissionId,
                    sourceMenuId: menuId,
                    pdfPath,
                    pdfFileName,
                    clickupTaskId: baselineSubmission.clickup_task_id,
                })
            );
            console.log(`Design approval submission saved: ${submissionId}`);

            if (submitterName && submitterEmail) {
                deps.axios.post(`${deps.DB_SERVICE_URL}/submitter-profiles`, {
                    name: submitterName,
                    email: submitterEmail,
                    jobTitle: submitterJobTitle
                }).catch((err: any) => console.error('Failed to save submitter profile:', err.message));
            }

            const handoff = isMatch
                ? await runClickUpHandoff(submissionId)
                : { success: false, status: 'not_started', handoffComplete: false };

            res.json({
                isMatch,
                projectDetails: docxData.project_details,
                differences,
                alignments,
                docxText,
                pdfText,
                documentMarkup,
                visualReview,
                requiredApprovals: storedApprovals,
                sourceMenu: {
                    menuId,
                    submissionId: sourceSubmissionId,
                    projectName: baselineSubmission.project_name || selectedMenu.name || '',
                    property: baselineSubmission.property || selectedMenu.property || '',
                    servicePeriod,
                },
                handoff,
                submissionId,
            });
        } catch (error: any) {
            console.error('Error comparing documents:', error);
            res.status(deps.isClientInputError(error) ? 400 : 500).json({ error: error.message || 'Comparison failed' });
        } finally {
            for (const f of tempFiles) {
                deps.fs.unlink(f).catch(() => {});
            }
        }
    };

    const saveOverride = async (req: any, res: any) => {
        try {
            const { submissionId } = req.params;
            const reason = (req.body?.reason || '').toString().trim();
            if (!reason) {
                return res.status(400).json({ error: 'Override reason is required' });
            }

            let submission: any = null;
            try {
                const dbResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
                submission = dbResponse.data;
            } catch (err: any) {
                console.error('Failed to fetch design approval submission:', err.message);
                return res.status(404).json({ error: 'Design approval submission not found' });
            }

            if (`${submission?.source || ''}`.trim() !== 'design_approval') {
                return res.status(400).json({ error: 'Only design approval submissions can be overridden' });
            }

            await deps.axios.put(
                `${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`,
                buildDesignApprovalOverrideUpdate(reason)
            );
            const handoff = await runClickUpHandoff(submissionId);
            res.json({ success: true, handoff });
        } catch (error: any) {
            console.error('Failed to save design approval override:', error.message);
            res.status(500).json({ error: 'Failed to save override' });
        }
    };

    const retryHandoff = async (req: any, res: any) => {
        try {
            const submissionId = `${req.params?.submissionId || ''}`.trim();
            const dbResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
            const submission = dbResponse.data || {};
            const status = `${submission.status || ''}`.trim().toLowerCase();
            if (`${submission.source || ''}`.trim() !== 'design_approval') {
                return res.status(400).json({ error: 'Only design approval submissions can be handed off' });
            }
            if (!APPROVED_MENU_STATUSES.has(status)) {
                return res.status(409).json({ error: 'Resolve or override the design findings before sending this PDF to ClickUp' });
            }
            const handoff = await runClickUpHandoff(submissionId);
            res.json({ success: !!handoff.success, handoff });
        } catch (error: any) {
            console.error('Failed to retry design approval handoff:', error.message);
            res.status(500).json({ error: 'Failed to retry ClickUp handoff' });
        }
    };

    return {
        compare,
        saveOverride,
        retryHandoff,
    };
}

import * as path from 'path';
import {
    ALLOWED_DOCX_EXTENSIONS,
    ALLOWED_PDF_EXTENSIONS,
    assertUploadedFileType,
    hasAllowedExtension,
    sanitizeStoredFileName,
} from './upload-security';
import { normalizeDesignApprovalRequestBody } from './request-normalization';
import {
    buildDesignApprovalOverrideUpdate,
    buildDesignApprovalSubmissionRecord,
} from './approval-transitions';

type DesignApprovalWorkflowDeps = {
    axios: any;
    fs: typeof import('fs').promises;
    pathModule: typeof path;
    execAsync: (command: string, options?: any) => Promise<{ stdout: string; stderr: string }>;
    DB_SERVICE_URL: string;
    getDocxRedlinerDir: () => string;
    resolveStoredPath: (candidatePath: string, label: string, allowedExtensions?: Set<string>) => string;
    compareMenuTexts: (docxText: string, pdfText: string) => { differences: any[]; alignments: any[] };
    extractDishesAfterApproval: (
        submissionId: string,
        menuContent: string | undefined,
        property: string,
        finalPath: string,
        servicePeriod?: string
    ) => Promise<void>;
    isClientInputError: (error: any) => boolean;
};

export function createDesignApprovalWorkflowHandlers(deps: DesignApprovalWorkflowDeps) {
    const compare = async (req: any, res: any) => {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        const tempFiles: string[] = [];
        const {
            submitterName,
            submitterEmail,
            submitterJobTitle,
            existingDocxSubmissionId,
            requiredApprovals,
        } = normalizeDesignApprovalRequestBody(req.body);

        try {
            if (!files.pdfFile) {
                return res.status(400).json({ error: 'PDF file is required' });
            }

            let docxPath = '';
            let docxOriginalName = 'design-approval.docx';
            if (files.docxFile && files.docxFile[0]) {
                docxPath = files.docxFile[0].path;
                docxOriginalName = sanitizeStoredFileName(files.docxFile[0].originalname, docxOriginalName);
                tempFiles.push(docxPath);
                if (!hasAllowedExtension(docxOriginalName, ALLOWED_DOCX_EXTENSIONS)) {
                    return res.status(400).json({ error: 'First file must be a .docx document' });
                }
                await assertUploadedFileType(docxPath, ['docx']);
            } else if (existingDocxSubmissionId) {
                const subResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(existingDocxSubmissionId)}`);
                const baselineSubmission = subResponse.data || {};
                const candidatePath = baselineSubmission.final_path || baselineSubmission.approved_path || baselineSubmission.original_path;
                if (!candidatePath) {
                    return res.status(400).json({ error: 'Selected submission has no available DOCX file path' });
                }
                docxPath = deps.resolveStoredPath(candidatePath, 'Design approval DOCX source', ALLOWED_DOCX_EXTENSIONS);
                await deps.fs.access(docxPath);
                docxOriginalName = sanitizeStoredFileName(baselineSubmission.filename, docxOriginalName);
            } else {
                return res.status(400).json({ error: 'DOCX source is required (upload or database selection)' });
            }

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

            const docxData = JSON.parse(detailsResult.stdout);
            if (docxData.error) {
                return res.status(400).json({ error: `DOCX extraction failed: ${docxData.error}` });
            }

            const extractPdfScript = deps.pathModule.join(docxRedlinerDir, 'extract_pdf_text.py');
            const pdfResult = await deps.execAsync(
                `${pythonCmd} "${extractPdfScript}" "${pdfFile.path}"`,
                { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
            );

            const pdfData = JSON.parse(pdfResult.stdout);
            if (pdfData.error) {
                return res.status(400).json({ error: `PDF extraction failed: ${pdfData.error}` });
            }
            if (!pdfData.has_text_layer) {
                return res.status(400).json({
                    error: 'The PDF does not contain a text layer. It may be a scanned image. Please provide a PDF with selectable text.'
                });
            }

            const docxText = (docxData.menu_content || '').trim();
            const pdfText = (pdfData.full_text || '').trim();
            const { differences: allDifferences, alignments } = deps.compareMenuTexts(docxText, pdfText);
            const differences = allDifferences.filter((d: any) => d.severity !== 'info');
            const isMatch = differences.length === 0;

            const projectDetails = docxData.project_details || {};
            const submissionId = `design-${Date.now()}`;
            let dbSaved = false;

            try {
                await deps.axios.post(
                    `${deps.DB_SERVICE_URL}/submissions`,
                    buildDesignApprovalSubmissionRecord({
                        submissionId,
                        submitterEmail,
                        submitterName,
                        submitterJobTitle,
                        projectName: projectDetails.project_name || 'Design Approval',
                        property: projectDetails.property || '',
                        size: projectDetails.size || '',
                        orientation: projectDetails.orientation || '',
                        fileName: docxOriginalName || 'design-approval.docx',
                        status: isMatch ? 'approved' : 'needs_correction',
                        requiredApprovals,
                    })
                );
                dbSaved = true;
                console.log(`Design approval submission saved: ${submissionId}`);
            } catch (dbError: any) {
                console.error('Failed to save design approval submission:', dbError.message);
            }

            if (submitterName && submitterEmail) {
                deps.axios.post(`${deps.DB_SERVICE_URL}/submitter-profiles`, {
                    name: submitterName,
                    email: submitterEmail,
                    jobTitle: submitterJobTitle
                }).catch((err: any) => console.error('Failed to save submitter profile:', err.message));
            }

            if (isMatch && dbSaved) {
                deps.extractDishesAfterApproval(
                    submissionId,
                    docxText,
                    projectDetails.property || 'Unknown',
                    '',
                ).catch((err: any) => console.error('Background dish extraction failed (design approval):', err));
            }

            res.json({
                isMatch,
                projectDetails: docxData.project_details,
                differences,
                alignments,
                docxText,
                pdfText,
                requiredApprovals,
                submissionId: dbSaved ? submissionId : undefined
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
                console.error('Failed to fetch submission for dish extraction:', err.message);
            }

            await deps.axios.put(
                `${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`,
                buildDesignApprovalOverrideUpdate(reason)
            );

            if (submission) {
                deps.extractDishesAfterApproval(
                    submissionId,
                    submission.menu_content,
                    submission.property || 'Unknown',
                    submission.final_path || '',
                    submission.service_period
                ).catch((err: any) => console.error('Background dish extraction failed (design override):', err));
            }

            res.json({ success: true });
        } catch (error: any) {
            console.error('Failed to save design approval override:', error.message);
            res.status(500).json({ error: 'Failed to save override' });
        }
    };

    return {
        compare,
        saveOverride,
    };
}

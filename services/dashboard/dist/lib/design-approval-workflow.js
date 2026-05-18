"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDesignApprovalWorkflowHandlers = createDesignApprovalWorkflowHandlers;
const upload_security_1 = require("./upload-security");
const request_normalization_1 = require("./request-normalization");
const approval_transitions_1 = require("./approval-transitions");
function inferDesignApprovalServicePeriod(projectName, fileName) {
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
function createDesignApprovalWorkflowHandlers(deps) {
    const compare = async (req, res) => {
        const files = req.files;
        const tempFiles = [];
        const { submitterName, submitterEmail, submitterJobTitle, existingDocxSubmissionId, requiredApprovals, } = (0, request_normalization_1.normalizeDesignApprovalRequestBody)(req.body);
        try {
            if (!files.pdfFile) {
                return res.status(400).json({ error: 'PDF file is required' });
            }
            let docxPath = '';
            let docxOriginalName = 'design-approval.docx';
            if (files.docxFile && files.docxFile[0]) {
                docxPath = files.docxFile[0].path;
                docxOriginalName = (0, upload_security_1.sanitizeStoredFileName)(files.docxFile[0].originalname, docxOriginalName);
                tempFiles.push(docxPath);
                if (!(0, upload_security_1.hasAllowedExtension)(docxOriginalName, upload_security_1.ALLOWED_DOCX_EXTENSIONS)) {
                    return res.status(400).json({ error: 'First file must be a .docx document' });
                }
                await (0, upload_security_1.assertUploadedFileType)(docxPath, ['docx']);
            }
            else if (existingDocxSubmissionId) {
                const subResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(existingDocxSubmissionId)}`);
                const baselineSubmission = subResponse.data || {};
                const candidatePath = baselineSubmission.final_path || baselineSubmission.approved_path || baselineSubmission.original_path;
                if (!candidatePath) {
                    return res.status(400).json({ error: 'Selected submission has no available DOCX file path' });
                }
                docxPath = deps.resolveStoredPath(candidatePath, 'Design approval DOCX source', upload_security_1.ALLOWED_DOCX_EXTENSIONS);
                await deps.fs.access(docxPath);
                docxOriginalName = (0, upload_security_1.sanitizeStoredFileName)(baselineSubmission.filename, docxOriginalName);
            }
            else {
                return res.status(400).json({ error: 'DOCX source is required (upload or database selection)' });
            }
            const pdfFile = files.pdfFile[0];
            tempFiles.push(pdfFile.path);
            const pdfFileName = (0, upload_security_1.sanitizeStoredFileName)(pdfFile.originalname, 'design-approval.pdf');
            if (!(0, upload_security_1.hasAllowedExtension)(pdfFileName, upload_security_1.ALLOWED_PDF_EXTENSIONS)) {
                return res.status(400).json({ error: 'Second file must be a PDF' });
            }
            await (0, upload_security_1.assertUploadedFileType)(pdfFile.path, ['pdf']);
            const docxRedlinerDir = deps.getDocxRedlinerDir();
            const venvPython = deps.pathModule.join(docxRedlinerDir, 'venv', 'bin', 'python');
            let pythonCmd;
            try {
                await deps.fs.access(venvPython);
                pythonCmd = `"${venvPython}"`;
            }
            catch {
                pythonCmd = 'python3';
            }
            const extractDetailsScript = deps.pathModule.join(docxRedlinerDir, 'extract_project_details.py');
            const detailsResult = await deps.execAsync(`${pythonCmd} "${extractDetailsScript}" "${docxPath}"`, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
            const docxData = JSON.parse(detailsResult.stdout);
            if (docxData.error) {
                return res.status(400).json({ error: `DOCX extraction failed: ${docxData.error}` });
            }
            const extractPdfScript = deps.pathModule.join(docxRedlinerDir, 'extract_pdf_text.py');
            const pdfResult = await deps.execAsync(`${pythonCmd} "${extractPdfScript}" "${pdfFile.path}"`, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
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
            const differences = allDifferences.filter((d) => d.severity !== 'info');
            const isMatch = differences.length === 0;
            const projectDetails = docxData.project_details || {};
            const servicePeriod = inferDesignApprovalServicePeriod(projectDetails.project_name || '', docxOriginalName || '');
            const submissionId = `design-${Date.now()}`;
            let dbSaved = false;
            try {
                await deps.axios.post(`${deps.DB_SERVICE_URL}/submissions`, (0, approval_transitions_1.buildDesignApprovalSubmissionRecord)({
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
                    servicePeriod,
                }));
                dbSaved = true;
                console.log(`Design approval submission saved: ${submissionId}`);
            }
            catch (dbError) {
                console.error('Failed to save design approval submission:', dbError.message);
            }
            if (submitterName && submitterEmail) {
                deps.axios.post(`${deps.DB_SERVICE_URL}/submitter-profiles`, {
                    name: submitterName,
                    email: submitterEmail,
                    jobTitle: submitterJobTitle
                }).catch((err) => console.error('Failed to save submitter profile:', err.message));
            }
            if (isMatch && dbSaved) {
                deps.extractDishesAfterApproval(submissionId, docxText, projectDetails.property || 'Unknown', docxPath, servicePeriod).catch((err) => console.error('Background dish extraction failed (design approval):', err));
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
        }
        catch (error) {
            console.error('Error comparing documents:', error);
            res.status(deps.isClientInputError(error) ? 400 : 500).json({ error: error.message || 'Comparison failed' });
        }
        finally {
            for (const f of tempFiles) {
                deps.fs.unlink(f).catch(() => { });
            }
        }
    };
    const saveOverride = async (req, res) => {
        try {
            const { submissionId } = req.params;
            const reason = (req.body?.reason || '').toString().trim();
            if (!reason) {
                return res.status(400).json({ error: 'Override reason is required' });
            }
            let submission = null;
            try {
                const dbResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
                submission = dbResponse.data;
            }
            catch (err) {
                console.error('Failed to fetch submission for dish extraction:', err.message);
            }
            await deps.axios.put(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`, (0, approval_transitions_1.buildDesignApprovalOverrideUpdate)(reason));
            if (submission) {
                deps.extractDishesAfterApproval(submissionId, submission.menu_content, submission.property || 'Unknown', submission.final_path || '', submission.service_period).catch((err) => console.error('Background dish extraction failed (design override):', err));
            }
            res.json({ success: true });
        }
        catch (error) {
            console.error('Failed to save design approval override:', error.message);
            res.status(500).json({ error: 'Failed to save override' });
        }
    };
    return {
        compare,
        saveOverride,
    };
}

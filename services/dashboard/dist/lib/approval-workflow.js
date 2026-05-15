"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApprovalWorkflowHandlers = createApprovalWorkflowHandlers;
const upload_security_1 = require("./upload-security");
const approval_transitions_1 = require("./approval-transitions");
function createApprovalWorkflowHandlers(deps) {
    const persistApprovedSubmission = async (input) => {
        await deps.axios.put(`${deps.DB_SERVICE_URL}/submissions/${input.submissionId}`, (0, approval_transitions_1.buildApprovedSubmissionUpdate)({
            finalPath: input.finalPath,
            changesMade: input.changesMade,
        }));
        await deps.axios.post(`${deps.DIFFER_SERVICE_URL}/compare`, {
            submission_id: input.submissionId,
            ai_draft_path: input.submission.ai_draft_path,
            final_path: input.finalPath
        });
        deps.extractDishesAfterApproval(input.submission.id || input.submissionId, input.submission.menu_content, input.submission.property || 'Unknown', input.finalPath, input.submission.service_period || input.submission.raw_payload?.servicePeriod).catch((err) => console.error('Background dish extraction failed:', err));
    };
    const quickApprove = async (req, res) => {
        try {
            const { submissionId } = req.params;
            console.log(`Quick approve for submission ${submissionId}`);
            const dbResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${submissionId}`);
            const submission = dbResponse.data;
            if (!submission) {
                return res.status(404).json({ error: 'Submission not found' });
            }
            const finalPath = submission.ai_draft_path.replace('-draft.', '-final.');
            await deps.fs.copyFile(submission.ai_draft_path, finalPath);
            await persistApprovedSubmission({
                submissionId,
                submission,
                finalPath,
                changesMade: false,
            });
            res.json({
                success: true,
                message: 'Submission approved'
            });
        }
        catch (error) {
            console.error('Error approving submission:', error);
            res.status(500).json({ error: 'Failed to approve submission' });
        }
    };
    const uploadCorrectedVersion = async (req, res) => {
        try {
            const { submissionId } = req.params;
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            console.log(`Corrected version uploaded for submission ${submissionId}`);
            const dbResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${submissionId}`);
            const submission = dbResponse.data;
            if (!submission) {
                return res.status(404).json({ error: 'Submission not found' });
            }
            const finalPath = deps.pathModule.join(__dirname, '..', '..', '..', 'tmp', 'finals', `${submissionId}-final.docx`);
            await deps.fs.mkdir(deps.pathModule.dirname(finalPath), { recursive: true });
            await deps.fs.rename(req.file.path, finalPath);
            await persistApprovedSubmission({
                submissionId,
                submission,
                finalPath,
                changesMade: true,
            });
            res.json({
                success: true,
                message: 'Corrected version uploaded'
            });
        }
        catch (error) {
            console.error('Error uploading corrected version:', error);
            res.status(500).json({ error: 'Failed to upload corrected version' });
        }
    };
    const submitBrowserApproval = async (req, res) => {
        try {
            const { submissionId } = req.params;
            const editorHtmlRaw = (0, upload_security_1.sanitizeRichTextHtml)(req.body?.editorHtml || '');
            const menuContentTextRaw = (0, upload_security_1.sanitizePlainTextInput)(req.body?.menuContentText, { multiline: true, maxLength: upload_security_1.MAX_LONG_TEXT_LENGTH });
            if (!editorHtmlRaw && !menuContentTextRaw) {
                return res.status(400).json({ error: 'Approval editor content is required' });
            }
            const dbResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
            const submission = dbResponse.data;
            if (!submission) {
                return res.status(404).json({ error: 'Submission not found' });
            }
            const rawPayload = submission.raw_payload || {};
            const projectName = deps.coalesceString(submission.project_name, rawPayload.projectName) || 'Menu Approval';
            const property = deps.coalesceString(submission.property, rawPayload.property) || 'Unknown Property';
            const orientation = deps.coalesceString(submission.orientation, rawPayload.orientation) || 'Portrait';
            const templateTypeRaw = deps.coalesceString(submission.template_type, rawPayload.templateType) || 'food';
            const templateType = templateTypeRaw === 'non_beverage' ? 'food' : templateTypeRaw;
            const assetType = deps.coalesceString(submission.asset_type, rawPayload.assetType).toUpperCase();
            const printRegion = deps.coalesceString(submission.print_region, rawPayload.printRegion);
            const printSize = deps.coalesceString(submission.print_size, rawPayload.printSize);
            const printWidth = deps.coalesceString(submission.print_width, rawPayload.printWidth);
            const printHeight = deps.coalesceString(submission.print_height, rawPayload.printHeight);
            const digitalWidth = deps.coalesceString(submission.digital_width, rawPayload.digitalWidth);
            const digitalHeight = deps.coalesceString(submission.digital_height, rawPayload.digitalHeight);
            const width = deps.coalesceString(submission.width, rawPayload.width);
            const height = deps.coalesceString(submission.height, rawPayload.height);
            const wantsPrint = assetType === 'PRINT' || assetType === 'BOTH';
            const wantsDigital = assetType === 'DIGITAL' || assetType === 'BOTH';
            const printSizeForDocx = wantsPrint
                ? (printRegion === 'NON_US' ? (printSize || 'N/A') : `${printWidth || width || ''} x ${printHeight || height || ''} inches`)
                : '';
            const digitalSizeForDocx = wantsDigital
                ? `${digitalWidth || width || ''} x ${digitalHeight || height || ''} pixels`
                : '';
            const sizeForDocx = assetType === 'BOTH'
                ? `Digital: ${digitalSizeForDocx} | Print: ${printSizeForDocx}`
                : (wantsPrint ? printSizeForDocx : digitalSizeForDocx);
            const fallbackAllergens = deps.coalesceString(submission.allergens, rawPayload.allergens, deps.DEFAULT_ALLERGEN_KEY);
            const normalizedEditorHtml = deps.stripManagedFooterFromHtml(editorHtmlRaw);
            const footerMetadata = deps.normalizeMenuFooter(menuContentTextRaw, fallbackAllergens);
            const normalizedMenuContent = footerMetadata.body || deps.stripManagedFooterText(deps.coalesceString(submission.menu_content, rawPayload.menuContent), fallbackAllergens);
            const effectiveAllergens = footerMetadata.normalizedAllergenLine || deps.normalizeAllergenLegend(fallbackAllergens) || deps.DEFAULT_ALLERGEN_KEY;
            const shouldAddRawNotice = !footerMetadata.hadRawNotice && deps.detectRawUndercookedContent(normalizedMenuContent);
            const approvedDir = deps.pathModule.join(deps.getSubmissionDocumentDir(projectName, property, submission.id || submissionId), 'approved');
            const approvedPath = deps.pathModule.join(approvedDir, `${submission.id || submissionId}-approved.docx`);
            const approvedFileName = submission.filename || (0, upload_security_1.buildMenuFilename)(projectName, property, deps.coalesceString(submission.service_period, rawPayload.servicePeriod), deps.coalesceString(submission.date_needed, rawPayload.dateNeeded));
            await deps.generateDocxFromForm(submission.id || submissionId, {
                projectName,
                property,
                size: sizeForDocx,
                orientation,
                menuType: deps.coalesceString(submission.menu_type, rawPayload.menuType) || 'standard',
                templateType,
                dateNeeded: deps.coalesceString(submission.date_needed, rawPayload.dateNeeded),
                menuContent: normalizedMenuContent,
                menuContentHtml: normalizedEditorHtml || deps.textToParagraphHtml(normalizedMenuContent),
                allergens: effectiveAllergens,
                footerText: footerMetadata.preservedFooterText,
                shouldAddRawNotice,
            }, {
                outputPath: approvedPath,
            });
            const finalizeResponse = await deps.axios.post(`${deps.CLICKUP_SERVICE_URL}/approval/finalize`, (0, approval_transitions_1.buildApprovalFinalizeRequest)({
                submissionId: submission.id || submissionId,
                approvedPath,
                approvedFileName,
            }));
            res.json({
                success: true,
                submissionId: submission.id || submissionId,
                approvedPath,
                clickup: finalizeResponse.data || {},
            });
        }
        catch (error) {
            console.error('Error submitting browser approval:', error.response?.data || error.message);
            res.status(500).json({
                error: 'Failed to submit browser approval',
                details: error.message,
            });
        }
    };
    return {
        quickApprove,
        uploadCorrectedVersion,
        submitBrowserApproval,
    };
}

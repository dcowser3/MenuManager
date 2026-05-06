import * as path from 'path';
import {
    ALLOWED_MENU_IMAGE_EXTENSIONS,
    MAX_LONG_TEXT_LENGTH,
    assertUploadedFileType,
    hasAllowedExtension,
    sanitizePlainTextInput,
    sanitizeStoredFileName,
} from './upload-security';
import { normalizeSubmissionBody } from './request-normalization';

type SubmissionWorkflowDeps = {
    axios: any;
    fs: typeof import('fs').promises;
    DB_SERVICE_URL: string;
    AI_REVIEW_URL: string;
    CLICKUP_SERVICE_URL: string;
    DEFAULT_ALLERGEN_KEY: string;
    INTERNAL_REVIEWER_EMAIL?: string;
    getTempUploadsDir: () => string;
    getSubmissionDocumentDir: (projectName: string, property: string, submissionId: string) => string;
    getPropertyCatalogFromDb: () => Promise<any[]>;
    resolveCityCountryFromCatalog: (property: string, catalog: any[]) => string;
    normalizeMenuFooter: (text: string, fallbackAllergens?: string) => {
        body: string;
        normalizedAllergenLine: string;
        hadRawNotice: boolean;
    };
    stripManagedFooterFromHtml: (html: string) => string;
    detectRawUndercookedContent: (text: string) => boolean;
    generateDocxFromForm: (submissionId: string, formData: any, options?: { outputPath?: string }) => Promise<string>;
    sendAdminAlert: (alert: any) => void;
    isClientInputError: (error: any) => boolean;
};

export function createSubmissionWorkflowHandlers(deps: SubmissionWorkflowDeps) {
    const uploadMenuImage = async (req: any, res: any) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No image uploaded' });
            }

            const fileName = sanitizeStoredFileName(req.file.originalname, path.basename(req.file.path));
            if (!hasAllowedExtension(fileName, ALLOWED_MENU_IMAGE_EXTENSIONS)) {
                return res.status(400).json({ error: 'Only PNG, JPG, GIF, WEBP, or PDF uploads are allowed' });
            }
            await assertUploadedFileType(req.file.path, ['png', 'jpg', 'gif', 'webp', 'pdf']);

            res.json({
                success: true,
                menuImagePath: req.file.path,
                menuImageFileName: fileName,
            });
        } catch (error: any) {
            console.error('Error uploading menu image:', error.message);
            res.status(deps.isClientInputError(error) ? 400 : 500).json({ error: 'Failed to upload menu image', details: error.message });
        }
    };

    const submitMenu = async (req: any, res: any) => {
        try {
            const {
                width,
                height,
                printWidth,
                printHeight,
                printRegion,
                printSize,
                folded,
                digitalWidth,
                digitalHeight,
                cropMarks,
                bleedMarks,
                fileSizeLimit,
                fileSizeLimitMb,
                fileDeliveryNotes,
                turnaroundDays,
                containsRawUndercooked,
                suppressRawNotice,
                chefPersistentDiff,
                skipAiReview,
            } = req.body;

            const {
                safeSubmitterName,
                safeSubmitterEmail,
                safeSubmitterJobTitle,
                safeProjectName,
                safeProperty,
                safeOrientation,
                safeMenuType,
                safeServicePeriod,
                safeTemplateType,
                safeDateNeeded,
                safeAssetType,
                safeHotelName,
                safeCityCountryInput,
                safeAllergens,
                safeMenuContent,
                safeMenuContentHtml,
                safePersistentDiffHtml,
                safeFileDeliveryNotes,
                safeSubmissionMode,
                safeRevisionBaseSubmissionId,
                safeRevisionSource,
                safeRevisionBaselineFileName,
                safeBaseApprovedMenuContent,
                safeMenuImageFileName,
                normalizedApprovals,
                normalizedCriticalOverrides,
                safeRevisionBaselineDocPath,
                safeMenuImagePath,
            } = normalizeSubmissionBody(req.body, deps.getTempUploadsDir());

            const wantsPrint = safeAssetType === 'PRINT' || safeAssetType === 'BOTH';
            const wantsDigital = safeAssetType === 'DIGITAL' || safeAssetType === 'BOTH';
            const normalizedTemplateType = safeTemplateType || 'food';
            const skipAi = !!skipAiReview || normalizedTemplateType === 'non_beverage';
            const minTurnaroundDays = safeSubmissionMode === 'modification' ? 2 : 5;
            const parsedTurnaroundDays = Number.parseInt(`${turnaroundDays || ''}`, 10);
            const normalizedTurnaroundDays = Number.isFinite(parsedTurnaroundDays) ? parsedTurnaroundDays : minTurnaroundDays;
            const normalizedProperty = safeProperty;
            const propertyCatalog = await deps.getPropertyCatalogFromDb();
            const normalizedCityCountry = deps.resolveCityCountryFromCatalog(normalizedProperty, propertyCatalog) || safeCityCountryInput;

            if (!safeSubmitterName || !safeSubmitterEmail || !safeSubmitterJobTitle || !safeProjectName || !normalizedProperty || !safeOrientation || !safeMenuType || !safeServicePeriod || !safeTemplateType || !safeDateNeeded || !safeAssetType || !safeMenuContent) {
                return res.status(400).json({ error: 'All fields are required' });
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeSubmitterEmail)) {
                return res.status(400).json({ error: 'A valid submitter email is required' });
            }
            if (!normalizedCityCountry) {
                return res.status(400).json({ error: 'Selected property must map to a configured location' });
            }
            const isAllowedProperty = propertyCatalog.some((item) => item.name.toLowerCase() === normalizedProperty.toLowerCase());
            if (!isAllowedProperty) {
                return res.status(400).json({ error: 'Property must be selected from the configured property list' });
            }
            if (normalizedTurnaroundDays < minTurnaroundDays) {
                return res.status(400).json({
                    error: `Turnaround days must be at least ${minTurnaroundDays} for ${safeSubmissionMode === 'modification' ? 'modification' : 'new'} submissions`
                });
            }
            if (wantsDigital && (!digitalWidth || !digitalHeight)) {
                return res.status(400).json({ error: 'Digital width and height are required' });
            }
            if (wantsPrint) {
                if (!printRegion || !folded || !cropMarks || !bleedMarks || !fileSizeLimit) {
                    return res.status(400).json({ error: 'All print fields are required for print assets' });
                }
                if (printRegion === 'US' && (!printWidth || !printHeight)) {
                    return res.status(400).json({ error: 'US print requires print width and height' });
                }
                if (printRegion === 'NON_US' && !printSize) {
                    return res.status(400).json({ error: 'Non-US print requires A-size selection' });
                }
            }
            if (safeSubmissionMode === 'modification' && !safeRevisionBaseSubmissionId && !safeRevisionBaselineDocPath) {
                return res.status(400).json({ error: 'Modification flow requires a prior approved submission or uploaded approved baseline document' });
            }

            const printSizeForDocx = wantsPrint
                ? (printRegion === 'NON_US' ? (printSize || 'N/A') : `${printWidth || width || ''} x ${printHeight || height || ''} inches`)
                : '';
            const digitalSizeForDocx = wantsDigital
                ? `${digitalWidth || width || ''} x ${digitalHeight || height || ''} pixels`
                : '';
            const sizeForDocx = safeAssetType === 'BOTH'
                ? `Digital: ${digitalSizeForDocx} | Print: ${printSizeForDocx}`
                : (wantsPrint ? printSizeForDocx : digitalSizeForDocx);
            const footerMetadata = deps.normalizeMenuFooter(safeMenuContent, safeAllergens || '');
            const effectiveAllergens = footerMetadata.normalizedAllergenLine || deps.DEFAULT_ALLERGEN_KEY;
            const normalizedMenuContent = footerMetadata.body;
            const normalizedMenuContentHtml = deps.stripManagedFooterFromHtml(safeMenuContentHtml || '');
            const normalizedPersistentDiffHtml = deps.stripManagedFooterFromHtml(safePersistentDiffHtml || '');
            const docxMenuContentHtml =
                safeSubmissionMode === 'modification' && normalizedPersistentDiffHtml
                    ? normalizedPersistentDiffHtml
                    : normalizedMenuContentHtml;
            const selectedRawFlag = `${containsRawUndercooked}` === 'true' || containsRawUndercooked === true;
            const suppressedRawFlag = `${suppressRawNotice}` === 'true' || suppressRawNotice === true;
            const detectedRawFlag = deps.detectRawUndercookedContent(normalizedMenuContent);
            const shouldAddRawNotice = footerMetadata.hadRawNotice || (!suppressedRawFlag && (selectedRawFlag || detectedRawFlag));

            const submissionId = `form-${Date.now()}`;
            const docxPath = await deps.generateDocxFromForm(submissionId, {
                projectName: safeProjectName,
                property: normalizedProperty,
                size: sizeForDocx,
                orientation: safeOrientation,
                menuType: safeMenuType || 'standard',
                templateType: normalizedTemplateType === 'non_beverage' ? 'food' : normalizedTemplateType,
                dateNeeded: safeDateNeeded,
                menuContent: normalizedMenuContent,
                menuContentHtml: docxMenuContentHtml,
                allergens: effectiveAllergens,
                shouldAddRawNotice
            });

            console.log(`📝 Generated document for submission ${submissionId}: ${docxPath}`);

            let persistedBaselineDocPath: string | null = null;
            if (safeRevisionBaselineDocPath) {
                try {
                    await deps.fs.access(safeRevisionBaselineDocPath);
                    const submissionDir = deps.getSubmissionDocumentDir(safeProjectName, normalizedProperty, submissionId);
                    const baselineDir = path.join(submissionDir, 'baseline');
                    await deps.fs.mkdir(baselineDir, { recursive: true });
                    const baselineFile = sanitizeStoredFileName(safeRevisionBaselineFileName, path.basename(safeRevisionBaselineDocPath));
                    persistedBaselineDocPath = path.join(baselineDir, baselineFile);
                    if (path.resolve(safeRevisionBaselineDocPath) !== path.resolve(persistedBaselineDocPath)) {
                        await deps.fs.copyFile(safeRevisionBaselineDocPath, persistedBaselineDocPath);
                    }
                } catch (baselineError: any) {
                    console.warn(`Failed to persist baseline doc for ${submissionId}:`, baselineError.message);
                    persistedBaselineDocPath = safeRevisionBaselineDocPath;
                }
            }

            let persistedMenuImagePath: string | null = null;
            if (safeMenuImagePath) {
                try {
                    await deps.fs.access(safeMenuImagePath);
                    const submissionDir = deps.getSubmissionDocumentDir(safeProjectName, normalizedProperty, submissionId);
                    const assetDir = path.join(submissionDir, 'assets');
                    await deps.fs.mkdir(assetDir, { recursive: true });
                    const imageFileName = sanitizeStoredFileName(safeMenuImageFileName, path.basename(safeMenuImagePath));
                    persistedMenuImagePath = path.join(assetDir, imageFileName);
                    if (path.resolve(safeMenuImagePath) !== path.resolve(persistedMenuImagePath)) {
                        await deps.fs.copyFile(safeMenuImagePath, persistedMenuImagePath);
                    }
                } catch (imageError: any) {
                    console.warn(`Failed to persist menu image for ${submissionId}:`, imageError.message);
                    persistedMenuImagePath = safeMenuImagePath;
                }
            }

            const submissionStatus = skipAi ? 'submitted_no_ai_review' : 'pending_human_review';

            await deps.axios.post(`${deps.DB_SERVICE_URL}/submissions`, {
                id: submissionId,
                submitter_email: safeSubmitterEmail,
                submitter_name: safeSubmitterName,
                submitter_job_title: safeSubmitterJobTitle,
                project_name: safeProjectName,
                property: normalizedProperty,
                date_needed: safeDateNeeded,
                filename: `${safeProjectName}_Menu.docx`,
                original_path: docxPath,
                status: submissionStatus,
                created_at: new Date().toISOString(),
                source: 'form',
                menu_type: safeMenuType || 'standard',
                service_period: safeServicePeriod || 'other',
                template_type: normalizedTemplateType,
                hotel_name: safeHotelName || null,
                city_country: normalizedCityCountry,
                asset_type: safeAssetType,
                width: width || (wantsPrint ? (printRegion === 'NON_US' ? printSize : printWidth) : digitalWidth),
                height: height || (wantsPrint ? (printRegion === 'NON_US' ? printSize : printHeight) : digitalHeight),
                print_width: printWidth || null,
                print_height: printHeight || null,
                print_region: printRegion || null,
                print_size: printSize || null,
                folded: folded === 'yes',
                digital_width: digitalWidth || null,
                digital_height: digitalHeight || null,
                turnaround_days: normalizedTurnaroundDays,
                crop_marks: cropMarks === 'yes',
                bleed_marks: bleedMarks === 'yes',
                file_size_limit: fileSizeLimit === 'yes',
                file_size_limit_mb: fileSizeLimitMb || null,
                file_delivery_notes: safeFileDeliveryNotes || null,
                orientation: safeOrientation,
                approvals: JSON.stringify(normalizedApprovals),
                critical_overrides: JSON.stringify(normalizedCriticalOverrides || []),
                menu_content: normalizedMenuContent,
                menu_content_html: normalizedMenuContentHtml || null,
                allergens: effectiveAllergens,
                submission_mode: safeSubmissionMode || 'new',
                revision_source: safeRevisionSource || null,
                revision_base_submission_id: safeRevisionBaseSubmissionId || null,
                revision_baseline_doc_path: persistedBaselineDocPath || null,
                revision_baseline_file_name: safeRevisionBaselineFileName || null,
                base_approved_menu_content: safeBaseApprovedMenuContent || null,
                chef_persistent_diff: chefPersistentDiff ? JSON.stringify(chefPersistentDiff) : null,
            });

            console.log(`✓ Submission created in database: ${submissionId}`);

            deps.axios.post(`${deps.DB_SERVICE_URL}/assets`, {
                submission_id: submissionId,
                asset_type: 'original_docx',
                source: 'chef_form',
                storage_provider: 'local',
                storage_path: docxPath,
                file_name: sanitizeStoredFileName(`${safeProjectName}_Menu.docx`, 'submission.docx')
            }).catch((err: any) => console.error('Failed to save original_docx asset metadata:', err.message));

            if (persistedBaselineDocPath) {
                deps.axios.post(`${deps.DB_SERVICE_URL}/assets`, {
                    submission_id: submissionId,
                    asset_type: 'baseline_approved_docx',
                    source: 'chef_modification_upload',
                    storage_provider: 'local',
                    storage_path: persistedBaselineDocPath,
                    file_name: sanitizeStoredFileName(safeRevisionBaselineFileName || path.basename(persistedBaselineDocPath), 'baseline.docx'),
                }).catch((err: any) => console.error('Failed to save baseline_approved_docx asset metadata:', err.message));
            }

            if (persistedMenuImagePath) {
                deps.axios.post(`${deps.DB_SERVICE_URL}/assets`, {
                    submission_id: submissionId,
                    asset_type: 'menu_image',
                    source: 'chef_form',
                    storage_provider: 'local',
                    storage_path: persistedMenuImagePath,
                    file_name: sanitizeStoredFileName(safeMenuImageFileName || path.basename(persistedMenuImagePath), 'menu-upload'),
                }).catch((err: any) => console.error('Failed to save menu_image asset metadata:', err.message));
            }

            deps.axios.post(`${deps.DB_SERVICE_URL}/submitter-profiles`, {
                name: safeSubmitterName,
                email: safeSubmitterEmail,
                jobTitle: safeSubmitterJobTitle
            }).catch((err: any) => console.error('Failed to save submitter profile:', err.message));

            try {
                if (skipAi) {
                    console.log(`Skipping AI review for submission ${submissionId} (template: ${normalizedTemplateType})`);
                } else {
                    const mammoth = require('mammoth');
                    const result = await mammoth.extractRawText({ path: docxPath });
                    const text = result.value;

                    await deps.axios.post(`${deps.AI_REVIEW_URL}/ai-review`, {
                        text: text,
                        submission_id: submissionId,
                        submitter_email: safeSubmitterEmail,
                        filename: `${safeProjectName}_Menu.docx`,
                        original_path: docxPath
                    });

                    console.log(`✓ AI review triggered for ${submissionId}`);
                }
            } catch (aiError: any) {
                console.error('Error triggering AI review:', aiError.message);
                await deps.axios.put(`${deps.DB_SERVICE_URL}/submissions/${submissionId}`, {
                    status: skipAi ? 'submitted_no_ai_review' : 'pending_human_review'
                });
                deps.sendAdminAlert({
                    alert_type: 'ai_review_failed',
                    severity: 'warning',
                    service: 'dashboard',
                    submission_id: submissionId,
                    message: `AI review failed for "${safeProjectName}". Submission moved to manual review.`,
                    details: { error: aiError.message },
                });
            }

            let clickupWarning: string | undefined;
            let clickupTaskId: string | undefined;
            try {
                const clickupResponse = await deps.axios.post(`${deps.CLICKUP_SERVICE_URL}/create-task`, {
                    submissionId,
                    submitterName: safeSubmitterName,
                    submitterEmail: safeSubmitterEmail,
                    submitterJobTitle: safeSubmitterJobTitle,
                    projectName: safeProjectName,
                    property: normalizedProperty,
                    width: width || (wantsPrint ? (printRegion === 'NON_US' ? printSize : printWidth) : digitalWidth),
                    height: height || (wantsPrint ? (printRegion === 'NON_US' ? printSize : printHeight) : digitalHeight),
                    printWidth,
                    printHeight,
                    printRegion,
                    printSize,
                    folded,
                    digitalWidth,
                    digitalHeight,
                    cropMarks,
                    bleedMarks,
                    fileSizeLimit,
                    fileSizeLimitMb,
                    fileDeliveryNotes,
                    orientation: safeOrientation,
                    menuType: safeMenuType,
                    servicePeriod: safeServicePeriod,
                    templateType: normalizedTemplateType,
                    turnaroundDays: normalizedTurnaroundDays,
                    dateNeeded: safeDateNeeded,
                    hotelName: safeHotelName,
                    cityCountry: normalizedCityCountry,
                    assetType: safeAssetType,
                    docxPath,
                    menuImagePath: persistedMenuImagePath,
                    menuImageFileName: safeMenuImageFileName,
                    filename: `${safeProjectName}_Menu.docx`,
                    submissionMode: safeSubmissionMode,
                    revisionSource: safeRevisionSource,
                    revisionBaseSubmissionId: safeRevisionBaseSubmissionId,
                    revisionBaselineDocPath: persistedBaselineDocPath,
                    revisionBaselineFileName: safeRevisionBaselineFileName,
                    chefPersistentDiff,
                    criticalOverrides: normalizedCriticalOverrides,
                    approvals: normalizedApprovals,
                });

                const clickupData = clickupResponse.data || {};
                clickupTaskId = clickupData.taskId;
                if (clickupData.skipped) {
                    clickupWarning = 'Menu submitted, but ClickUp integration is not configured yet. If this persists, please email the Word document to the design team.';
                } else if (clickupData.warning || clickupData.attachmentUploadFailed || clickupData.baselineUploadFailed) {
                    const supportEmail = deps.INTERNAL_REVIEWER_EMAIL || 'the design team';
                    clickupWarning = `Menu submitted, but we could not upload the Word document to ClickUp. If this persists, please email the Word document directly to ${supportEmail}.`;
                }
            } catch (clickupError: any) {
                console.error('Failed to create ClickUp task:', clickupError.response?.data || clickupError.message);
                const supportEmail = deps.INTERNAL_REVIEWER_EMAIL || 'the design team';
                clickupWarning = `Menu submitted, but we could not create your ClickUp task. If this persists, please email the Word document directly to ${supportEmail}.`;
                deps.sendAdminAlert({
                    alert_type: 'clickup_task_failed',
                    severity: 'error',
                    service: 'dashboard',
                    submission_id: submissionId,
                    message: `ClickUp task creation failed for "${safeProjectName}" (${normalizedProperty})`,
                    details: { error: clickupError.response?.data || clickupError.message, submitter: safeSubmitterEmail },
                });
            }

            res.json({
                success: true,
                submissionId: submissionId,
                message: 'Menu submitted successfully',
                clickup: {
                    taskId: clickupTaskId,
                    warning: clickupWarning,
                },
            });
        } catch (error: any) {
            console.error('Error submitting form:', error);
            const statusCode = deps.isClientInputError(error) ? 400 : 500;
            deps.sendAdminAlert({
                alert_type: 'submission_failed',
                severity: 'critical',
                service: 'dashboard',
                message: `Menu submission failed completely: ${error.message}`,
                details: { error: error.message, stack: error.stack?.slice(0, 500) },
            });
            res.status(statusCode).json({
                error: 'Failed to submit menu',
                details: error.message
            });
        }
    };

    return {
        uploadMenuImage,
        submitMenu,
    };
}

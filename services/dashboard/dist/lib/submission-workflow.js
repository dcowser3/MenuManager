"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMissingRequiredSubmissionFieldLabels = getMissingRequiredSubmissionFieldLabels;
exports.createSubmissionWorkflowHandlers = createSubmissionWorkflowHandlers;
const path = __importStar(require("path"));
const upload_security_1 = require("./upload-security");
const request_normalization_1 = require("./request-normalization");
const clickup_handoff_1 = require("./clickup-handoff");
function getRequestHostname(req) {
    const hostHeader = `${req?.hostname || (typeof req?.get === 'function' ? req.get('host') : '') || req?.headers?.host || ''}`.trim();
    if (!hostHeader)
        return '';
    if (hostHeader.startsWith('[')) {
        return hostHeader.slice(1, hostHeader.indexOf(']')).toLowerCase();
    }
    return hostHeader.split(':')[0].toLowerCase();
}
function isLocalDashboardRequest(req) {
    if (process.env.NODE_ENV === 'production')
        return false;
    const hostname = getRequestHostname(req);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
function mergeFooterText(...values) {
    const seen = new Set();
    const lines = [];
    for (const value of values) {
        for (const line of `${value || ''}`.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            const key = trimmed.replace(/\s+/g, ' ').toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            lines.push(trimmed);
        }
    }
    return lines.join('\n');
}
function hasRequiredSubmissionValue(value) {
    if (value === null || value === undefined)
        return false;
    if (typeof value === 'string')
        return value.trim().length > 0;
    return !!value;
}
function getMissingRequiredSubmissionFieldLabels(fields) {
    return Object.entries(fields)
        .filter(([, value]) => !hasRequiredSubmissionValue(value))
        .map(([label]) => label);
}
function buildMissingRequiredSubmissionFieldsError(labels) {
    return `Please complete these required fields: ${labels.join(', ')}.`;
}
function createSubmissionWorkflowHandlers(deps) {
    const publicSupportEmail = deps.PUBLIC_FORM_SUPPORT_EMAIL || 'dcowser@richardsandoval.com';
    const triggerAiReview = async (input) => {
        try {
            if (input.skipAi) {
                console.log(`Skipping AI review for submission ${input.submissionId} (template: ${input.templateType})`);
                return;
            }
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ path: input.originalPath });
            const text = result.value;
            await deps.axios.post(`${deps.AI_REVIEW_URL}/ai-review`, {
                text,
                submission_id: input.submissionId,
                submitter_email: input.submitterEmail,
                filename: input.filename,
                original_path: input.originalPath
            }, { timeout: deps.AI_REVIEW_SUBMIT_TIMEOUT_MS });
            console.log(`✓ AI review triggered for ${input.submissionId}`);
        }
        catch (aiError) {
            console.error('Error triggering AI review:', aiError.message);
            try {
                await deps.axios.put(`${deps.DB_SERVICE_URL}/submissions/${input.submissionId}`, {
                    status: input.skipAi ? 'submitted_no_ai_review' : 'pending_human_review'
                });
            }
            catch (statusError) {
                console.error('Failed to keep submission in manual review after AI review failure:', statusError.message);
            }
            deps.sendAdminAlert({
                alert_type: 'ai_review_failed',
                severity: 'warning',
                service: 'dashboard',
                submission_id: input.submissionId,
                message: `AI review failed for "${input.projectName}". Submission moved to manual review.`,
                details: { error: aiError.message },
            });
        }
    };
    const uploadMenuImage = async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No image uploaded' });
            }
            const fileName = (0, upload_security_1.sanitizeStoredFileName)(req.file.originalname, path.basename(req.file.path));
            if (!(0, upload_security_1.hasAllowedExtension)(fileName, upload_security_1.ALLOWED_MENU_IMAGE_EXTENSIONS)) {
                return res.status(400).json({ error: 'Only PNG, JPG, GIF, WEBP, or PDF uploads are allowed' });
            }
            await (0, upload_security_1.assertUploadedFileType)(req.file.path, ['png', 'jpg', 'gif', 'webp', 'pdf']);
            res.json({
                success: true,
                menuImagePath: req.file.path,
                menuImageFileName: fileName,
            });
        }
        catch (error) {
            console.error('Error uploading menu image:', error.message);
            res.status(deps.isClientInputError(error) ? 400 : 500).json({ error: 'Failed to upload menu image', details: error.message });
        }
    };
    const submitMenu = async (req, res) => {
        try {
            const { width, height, printWidth, printHeight, printRegion, printSize, folded, digitalWidth, digitalHeight, cropMarks, bleedMarks, fileSizeLimit, fileSizeLimitMb, fileDeliveryNotes, turnaroundDays, containsRawUndercooked, suppressRawNotice, chefPersistentDiff, skipAiReview, } = req.body;
            const { safeSubmitterName, safeSubmitterEmail, safeSubmitterJobTitle, safeProjectName, safeProperty, safeOrientation, safeMenuType, safeServicePeriod, safeTemplateType, safeDateNeeded, safeAssetType, safeHotelName, safeCityCountryInput, safeAllergens, safeMenuContent, safeMenuContentHtml, safePersistentDiffHtml, safePreservedFooterText, safeFileDeliveryNotes, safeSubmissionMode, safeRevisionBaseSubmissionId, safeRevisionSource, safeRevisionBaselineFileName, safeBaseApprovedMenuContent, safeMenuImageFileName, normalizedApprovals, normalizedCriticalOverrides, safeRevisionBaselineDocPath, safeMenuImagePath, } = (0, request_normalization_1.normalizeSubmissionBody)(req.body, deps.getTempUploadsDir());
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
            const missingRequiredFields = getMissingRequiredSubmissionFieldLabels({
                'submitter name': safeSubmitterName,
                'submitter email': safeSubmitterEmail,
                'submitter job title': safeSubmitterJobTitle,
                'project name': safeProjectName,
                property: normalizedProperty,
                orientation: safeOrientation,
                'menu type': safeMenuType,
                'service period': safeServicePeriod,
                'template type': safeTemplateType,
                'date needed': safeDateNeeded,
                'asset type': safeAssetType,
                'menu content': safeMenuContent,
            });
            if (missingRequiredFields.length) {
                return res.status(400).json({
                    error: buildMissingRequiredSubmissionFieldsError(missingRequiredFields),
                    missingFields: missingRequiredFields,
                });
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
            if (wantsDigital) {
                const missingDigitalFields = getMissingRequiredSubmissionFieldLabels({
                    'digital width': digitalWidth,
                    'digital height': digitalHeight,
                });
                if (missingDigitalFields.length) {
                    return res.status(400).json({
                        error: buildMissingRequiredSubmissionFieldsError(missingDigitalFields),
                        missingFields: missingDigitalFields,
                    });
                }
            }
            if (wantsPrint) {
                const missingPrintFields = getMissingRequiredSubmissionFieldLabels({
                    'print region': printRegion,
                    folded,
                    'crop marks': cropMarks,
                    'bleed marks': bleedMarks,
                    'file size limit': fileSizeLimit,
                });
                if (missingPrintFields.length) {
                    return res.status(400).json({
                        error: buildMissingRequiredSubmissionFieldsError(missingPrintFields),
                        missingFields: missingPrintFields,
                    });
                }
                if (printRegion === 'US') {
                    const missingUsPrintFields = getMissingRequiredSubmissionFieldLabels({
                        'print width': printWidth,
                        'print height': printHeight,
                    });
                    if (missingUsPrintFields.length) {
                        return res.status(400).json({
                            error: buildMissingRequiredSubmissionFieldsError(missingUsPrintFields),
                            missingFields: missingUsPrintFields,
                        });
                    }
                }
                if (printRegion === 'NON_US' && !printSize) {
                    return res.status(400).json({
                        error: buildMissingRequiredSubmissionFieldsError(['A-size selection']),
                        missingFields: ['A-size selection'],
                    });
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
            const explicitFooterMetadata = deps.normalizeMenuFooter(safePreservedFooterText || '', '');
            const effectiveAllergens = footerMetadata.normalizedAllergenLine || deps.DEFAULT_ALLERGEN_KEY;
            const normalizedMenuContent = footerMetadata.body;
            const normalizedMenuContentHtml = deps.stripManagedFooterFromHtml(safeMenuContentHtml || '');
            const normalizedPersistentDiffHtml = deps.stripManagedFooterFromHtml(safePersistentDiffHtml || '');
            const preservedFooterText = mergeFooterText(footerMetadata.preservedFooterText, explicitFooterMetadata.preservedFooterText);
            const docxMenuContentHtml = safeSubmissionMode === 'modification' && normalizedPersistentDiffHtml
                ? normalizedPersistentDiffHtml
                : normalizedMenuContentHtml;
            const selectedRawFlag = `${containsRawUndercooked}` === 'true' || containsRawUndercooked === true;
            const suppressedRawFlag = `${suppressRawNotice}` === 'true' || suppressRawNotice === true;
            const detectedRawFlag = deps.detectRawUndercookedContent(normalizedMenuContent);
            const hadRawNotice = footerMetadata.hadRawNotice || explicitFooterMetadata.hadRawNotice;
            const shouldAddRawNotice = !hadRawNotice && !suppressedRawFlag && (selectedRawFlag || detectedRawFlag);
            const submissionId = `form-${Date.now()}`;
            const formAttemptId = (0, upload_security_1.sanitizePlainTextInput)((typeof req.get === 'function' ? req.get('x-menumanager-attempt-id') : '') || req.body?.attemptId, { maxLength: 100 }) || null;
            const localTestingRequest = isLocalDashboardRequest(req);
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
                footerText: preservedFooterText,
                shouldAddRawNotice
            });
            console.log(`📝 Generated document for submission ${submissionId}: ${docxPath}`);
            let persistedBaselineDocPath = null;
            if (safeRevisionBaselineDocPath) {
                try {
                    await deps.fs.access(safeRevisionBaselineDocPath);
                    const submissionDir = deps.getSubmissionDocumentDir(safeProjectName, normalizedProperty, submissionId);
                    const baselineDir = path.join(submissionDir, 'baseline');
                    await deps.fs.mkdir(baselineDir, { recursive: true });
                    const baselineFile = (0, upload_security_1.sanitizeStoredFileName)(safeRevisionBaselineFileName, path.basename(safeRevisionBaselineDocPath));
                    persistedBaselineDocPath = path.join(baselineDir, baselineFile);
                    if (path.resolve(safeRevisionBaselineDocPath) !== path.resolve(persistedBaselineDocPath)) {
                        await deps.fs.copyFile(safeRevisionBaselineDocPath, persistedBaselineDocPath);
                    }
                }
                catch (baselineError) {
                    console.warn(`Failed to persist baseline doc for ${submissionId}:`, baselineError.message);
                    persistedBaselineDocPath = safeRevisionBaselineDocPath;
                }
            }
            let persistedMenuImagePath = null;
            if (safeMenuImagePath) {
                try {
                    await deps.fs.access(safeMenuImagePath);
                    const submissionDir = deps.getSubmissionDocumentDir(safeProjectName, normalizedProperty, submissionId);
                    const assetDir = path.join(submissionDir, 'assets');
                    await deps.fs.mkdir(assetDir, { recursive: true });
                    const imageFileName = (0, upload_security_1.sanitizeStoredFileName)(safeMenuImageFileName, path.basename(safeMenuImagePath));
                    persistedMenuImagePath = path.join(assetDir, imageFileName);
                    if (path.resolve(safeMenuImagePath) !== path.resolve(persistedMenuImagePath)) {
                        await deps.fs.copyFile(safeMenuImagePath, persistedMenuImagePath);
                    }
                }
                catch (imageError) {
                    console.warn(`Failed to persist menu image for ${submissionId}:`, imageError.message);
                    persistedMenuImagePath = safeMenuImagePath;
                }
            }
            const submissionStatus = skipAi ? 'submitted_no_ai_review' : 'pending_human_review';
            const generatedMenuFilename = (0, upload_security_1.buildMenuFilename)(safeProjectName, normalizedProperty, safeServicePeriod, safeDateNeeded);
            const submissionRecordPayload = {
                id: submissionId,
                submitter_email: safeSubmitterEmail,
                submitter_name: safeSubmitterName,
                submitter_job_title: safeSubmitterJobTitle,
                project_name: safeProjectName,
                property: normalizedProperty,
                date_needed: safeDateNeeded,
                filename: generatedMenuFilename,
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
                form_attempt_id: formAttemptId,
            };
            await deps.axios.post(`${deps.DB_SERVICE_URL}/submissions`, submissionRecordPayload);
            console.log(`✓ Submission created in database: ${submissionId}`);
            if (formAttemptId && deps.linkBasicAiCheckAuditsToSubmission) {
                deps.linkBasicAiCheckAuditsToSubmission(formAttemptId, submissionId)
                    .catch((err) => console.error('Failed to link basic check audits to submission:', err.message));
            }
            deps.axios.post(`${deps.DB_SERVICE_URL}/assets`, {
                submission_id: submissionId,
                asset_type: 'original_docx',
                source: 'chef_form',
                storage_provider: 'local',
                storage_path: docxPath,
                file_name: (0, upload_security_1.sanitizeStoredFileName)(generatedMenuFilename, 'submission.docx')
            }).catch((err) => console.error('Failed to save original_docx asset metadata:', err.message));
            if (persistedBaselineDocPath) {
                deps.axios.post(`${deps.DB_SERVICE_URL}/assets`, {
                    submission_id: submissionId,
                    asset_type: 'baseline_approved_docx',
                    source: 'chef_modification_upload',
                    storage_provider: 'local',
                    storage_path: persistedBaselineDocPath,
                    file_name: (0, upload_security_1.sanitizeStoredFileName)(safeRevisionBaselineFileName || path.basename(persistedBaselineDocPath), 'baseline.docx'),
                }).catch((err) => console.error('Failed to save baseline_approved_docx asset metadata:', err.message));
            }
            if (persistedMenuImagePath) {
                deps.axios.post(`${deps.DB_SERVICE_URL}/assets`, {
                    submission_id: submissionId,
                    asset_type: 'menu_image',
                    source: 'chef_form',
                    storage_provider: 'local',
                    storage_path: persistedMenuImagePath,
                    file_name: (0, upload_security_1.sanitizeStoredFileName)(safeMenuImageFileName || path.basename(persistedMenuImagePath), 'menu-upload'),
                }).catch((err) => console.error('Failed to save menu_image asset metadata:', err.message));
            }
            deps.axios.post(`${deps.DB_SERVICE_URL}/submitter-profiles`, {
                name: safeSubmitterName,
                email: safeSubmitterEmail,
                jobTitle: safeSubmitterJobTitle
            }).catch((err) => console.error('Failed to save submitter profile:', err.message));
            void triggerAiReview({
                submissionId,
                submitterEmail: safeSubmitterEmail,
                filename: generatedMenuFilename,
                originalPath: docxPath,
                projectName: safeProjectName,
                skipAi,
                templateType: normalizedTemplateType,
            });
            let clickupWarning;
            let clickupTaskId;
            let clickupDiagnosticReference;
            const clickupTaskPayload = {
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
                filename: generatedMenuFilename,
                submissionMode: safeSubmissionMode,
                revisionSource: safeRevisionSource,
                revisionBaseSubmissionId: safeRevisionBaseSubmissionId,
                chefPersistentDiff,
                criticalOverrides: normalizedCriticalOverrides,
                approvals: normalizedApprovals,
            };
            const recordClickUpHandoff = async (metadata) => {
                const rawPayload = (0, clickup_handoff_1.mergeClickUpHandoffMetadata)({
                    ...submissionRecordPayload,
                    form_payload: req.body,
                }, metadata);
                try {
                    await deps.axios.put(`${deps.DB_SERVICE_URL}/submissions/${submissionId}`, { raw_payload: rawPayload });
                }
                catch (handoffError) {
                    console.error('Failed to save ClickUp handoff metadata:', handoffError.response?.data || handoffError.message);
                }
            };
            if (localTestingRequest) {
                clickupWarning = 'Local testing mode: ClickUp task creation was skipped. Use the downloaded DOCX and approval editor link to test review locally.';
                console.log(`Skipping ClickUp task creation for local submission ${submissionId}`);
                await recordClickUpHandoff({
                    status: 'skipped_local_testing',
                    last_attempt_at: new Date().toISOString(),
                    last_payload: clickupTaskPayload,
                    retry_count: 0,
                });
            }
            else {
                try {
                    await recordClickUpHandoff({
                        status: 'attempting',
                        last_attempt_at: new Date().toISOString(),
                        last_payload: clickupTaskPayload,
                        retry_count: 0,
                    });
                    const clickupResponse = await deps.axios.post(`${deps.CLICKUP_SERVICE_URL}/create-task`, clickupTaskPayload, { timeout: deps.CLICKUP_TASK_CREATE_TIMEOUT_MS });
                    const clickupData = clickupResponse.data || {};
                    clickupTaskId = clickupData.taskId;
                    if (clickupData.skipped) {
                        clickupDiagnosticReference = submissionId;
                        clickupWarning = (0, clickup_handoff_1.withSubmissionReference)(`Menu submitted, but ClickUp integration is not configured yet. If this persists, please email the Word document to ${publicSupportEmail}.`, clickupDiagnosticReference);
                        await recordClickUpHandoff({
                            status: 'skipped_not_configured',
                            last_response: clickupData,
                            last_payload: clickupTaskPayload,
                            last_attempt_at: new Date().toISOString(),
                            retry_count: 0,
                        });
                    }
                    else if (clickupData.warning || clickupData.attachmentUploadFailed) {
                        clickupDiagnosticReference = submissionId;
                        clickupWarning = (0, clickup_handoff_1.withSubmissionReference)(`Menu submitted, but we could not upload the Word document to ClickUp. If this persists, please email the Word document directly to ${publicSupportEmail}.`, clickupDiagnosticReference);
                        await recordClickUpHandoff({
                            status: 'task_created_with_warning',
                            task_id: clickupTaskId,
                            last_response: clickupData,
                            last_payload: clickupTaskPayload,
                            last_attempt_at: new Date().toISOString(),
                            retry_count: 0,
                        });
                    }
                    else {
                        await recordClickUpHandoff({
                            status: 'task_created',
                            task_id: clickupTaskId,
                            last_response: clickupData,
                            last_payload: clickupTaskPayload,
                            last_attempt_at: new Date().toISOString(),
                            retry_count: 0,
                        });
                    }
                }
                catch (clickupError) {
                    const errorDetails = (0, clickup_handoff_1.describeServiceError)(clickupError);
                    console.error('Failed to create ClickUp task:', errorDetails.response || errorDetails.message);
                    clickupDiagnosticReference = submissionId;
                    clickupWarning = (0, clickup_handoff_1.withSubmissionReference)(`Menu submitted, but we could not create your ClickUp task. If this persists, please email the Word document directly to ${publicSupportEmail}.`, clickupDiagnosticReference);
                    await recordClickUpHandoff({
                        status: 'failed',
                        last_error: errorDetails,
                        last_payload: clickupTaskPayload,
                        last_attempt_at: new Date().toISOString(),
                        retry_count: 0,
                        diagnosticReference: clickupDiagnosticReference,
                    });
                    deps.sendAdminAlert({
                        alert_type: 'clickup_task_failed',
                        severity: 'error',
                        service: 'dashboard',
                        submission_id: submissionId,
                        message: `ClickUp task creation failed for "${safeProjectName}" (${normalizedProperty})`,
                        details: {
                            error: errorDetails,
                            submitter: safeSubmitterEmail,
                            projectName: safeProjectName,
                            property: normalizedProperty,
                            filename: generatedMenuFilename,
                            docxPath,
                            clickupServiceUrl: deps.CLICKUP_SERVICE_URL,
                            diagnosticReference: clickupDiagnosticReference,
                        },
                    });
                }
            }
            const localTesting = localTestingRequest
                ? {
                    downloadUrl: `/download/original/${encodeURIComponent(submissionId)}`,
                    approvalUrl: `/approval/${encodeURIComponent(submissionId)}`,
                }
                : undefined;
            res.json({
                success: true,
                submissionId: submissionId,
                message: 'Menu submitted successfully',
                clickup: {
                    taskId: clickupTaskId,
                    warning: clickupWarning,
                    diagnosticReference: clickupDiagnosticReference,
                },
                localTesting,
            });
        }
        catch (error) {
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

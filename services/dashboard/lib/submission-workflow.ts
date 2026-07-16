import * as path from 'path';
import { getTenantConfig } from '@menumanager/tenant-config';
import {
    ALLOWED_MENU_IMAGE_EXTENSIONS,
    MAX_LONG_TEXT_LENGTH,
    assertUploadedFileType,
    buildMenuFilename,
    hasAllowedExtension,
    sanitizePlainTextInput,
    sanitizeStoredFileName,
} from './upload-security';
import { normalizeSubmissionBody } from './request-normalization';
import {
    describeServiceError,
    mergeClickUpHandoffMetadata,
    withSubmissionReference,
} from './clickup-handoff';

type SubmissionWorkflowDeps = {
    axios: any;
    fs: typeof import('fs').promises;
    DB_SERVICE_URL: string;
    AI_REVIEW_URL: string;
    CLICKUP_SERVICE_URL: string;
    DEFAULT_ALLERGEN_KEY: string;
    PUBLIC_FORM_SUPPORT_EMAIL?: string;
    AI_REVIEW_SUBMIT_TIMEOUT_MS: number;
    CLICKUP_TASK_CREATE_TIMEOUT_MS: number;
    getTempUploadsDir: () => string;
    getSubmissionDocumentDir: (projectName: string, property: string, submissionId: string) => string;
    getPropertyCatalogFromDb: () => Promise<any[]>;
    resolveCityCountryFromCatalog: (property: string, catalog: any[]) => string;
    normalizeMenuFooter: (text: string, fallbackAllergens?: string) => {
        body: string;
        normalizedAllergenLine: string;
        hadRawNotice: boolean;
        preservedFooterText: string;
    };
    stripManagedFooterFromHtml: (html: string) => string;
    detectRawUndercookedContent: (text: string) => boolean;
    generateDocxFromForm: (submissionId: string, formData: any, options?: { outputPath?: string }) => Promise<string>;
    sendAdminAlert: (alert: any) => void;
    sendSubmissionConfirmationEmails?: (input: {
        submissionId: string;
        projectName: string;
        property: string;
        submitterName: string;
        submitterEmail: string;
        approvals: Array<{ approved: boolean; name: string; position: string; email: string }>;
        docxPath: string;
        filename: string;
        approverDisputeToken?: string;
    }) => void;
    isClientInputError: (error: any) => boolean;
    linkBasicAiCheckAuditsToSubmission?: (attemptId: string, submissionId: string) => Promise<void>;
    getDraftSession?: (token: string) => Promise<any>;
    lockDraftSession?: (token: string, submittedSubmissionId: string) => Promise<any>;
};

function getRequestHostname(req: any): string {
    const hostHeader = `${req?.hostname || (typeof req?.get === 'function' ? req.get('host') : '') || req?.headers?.host || ''}`.trim();
    if (!hostHeader) return '';
    if (hostHeader.startsWith('[')) {
        return hostHeader.slice(1, hostHeader.indexOf(']')).toLowerCase();
    }
    return hostHeader.split(':')[0].toLowerCase();
}

function isLocalDashboardRequest(req: any): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    const hostname = getRequestHostname(req);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function mergeFooterText(...values: string[]): string {
    const seen = new Set<string>();
    const lines: string[] = [];

    for (const value of values) {
        for (const line of `${value || ''}`.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const key = trimmed.replace(/\s+/g, ' ').toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            lines.push(trimmed);
        }
    }

    return lines.join('\n');
}

function hasRequiredSubmissionValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    return !!value;
}

export function getMissingRequiredSubmissionFieldLabels(fields: Record<string, unknown>): string[] {
    return Object.entries(fields)
        .filter(([, value]) => !hasRequiredSubmissionValue(value))
        .map(([label]) => label);
}

function buildMissingRequiredSubmissionFieldsError(labels: string[]): string {
    return `Please complete these required fields: ${labels.join(', ')}.`;
}

export function createSubmissionWorkflowHandlers(deps: SubmissionWorkflowDeps) {
    const publicSupportEmail = deps.PUBLIC_FORM_SUPPORT_EMAIL || getTenantConfig().emails.publicSupport;

    const triggerAiReview = async (input: {
        submissionId: string;
        submitterEmail: string;
        filename: string;
        originalPath: string;
        projectName: string;
        skipAi: boolean;
        templateType: string;
    }) => {
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
        } catch (aiError: any) {
            console.error('Error triggering AI review:', aiError.message);
            try {
                await deps.axios.put(`${deps.DB_SERVICE_URL}/submissions/${input.submissionId}`, {
                    status: input.skipAi ? 'submitted_no_ai_review' : 'pending_human_review'
                });
            } catch (statusError: any) {
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
                safePreservedFooterText,
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
            if (safeSubmissionMode === 'modification' && safeRevisionSource === 'uploaded_baseline' && safeRevisionBaseSubmissionId) {
                const lineageConfirmed = req.body?.lineageConfirmed === true || req.body?.lineageConfirmed === 'true';
                if (!lineageConfirmed) {
                    return res.status(400).json({ error: 'Uploaded-baseline lineage must be explicitly confirmed' });
                }
                try {
                    const baselineResponse = await deps.axios.get(`${deps.DB_SERVICE_URL}/submissions/${encodeURIComponent(safeRevisionBaseSubmissionId)}`);
                    const baseline = baselineResponse.data || {};
                    const approved = ['approved', 'approved_override'].includes(`${baseline.status || ''}`.toLowerCase());
                    if (!approved || `${baseline.property || ''}`.trim().toLowerCase() !== normalizedProperty.toLowerCase()) {
                        return res.status(400).json({ error: 'Confirmed baseline must be an approved submission for the same property' });
                    }
                } catch (error: any) {
                    return res.status(400).json({ error: 'Confirmed baseline could not be validated' });
                }
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
            const preservedFooterText = mergeFooterText(
                footerMetadata.preservedFooterText,
                explicitFooterMetadata.preservedFooterText
            );
            const docxMenuContentHtml =
                safeSubmissionMode === 'modification' && normalizedPersistentDiffHtml
                    ? normalizedPersistentDiffHtml
                    : normalizedMenuContentHtml;
            const selectedRawFlag = `${containsRawUndercooked}` === 'true' || containsRawUndercooked === true;
            const suppressedRawFlag = `${suppressRawNotice}` === 'true' || suppressRawNotice === true;
            const detectedRawFlag = deps.detectRawUndercookedContent(normalizedMenuContent);
            const hadRawNotice = footerMetadata.hadRawNotice || explicitFooterMetadata.hadRawNotice;
            const shouldAddRawNotice = !hadRawNotice && !suppressedRawFlag && (selectedRawFlag || detectedRawFlag);

            const submissionId = `form-${Date.now()}`;
            const formAttemptId = sanitizePlainTextInput(
                (typeof req.get === 'function' ? req.get('x-menumanager-attempt-id') : '') || req.body?.attemptId,
                { maxLength: 100 }
            ) || null;
            const draftSessionToken = sanitizePlainTextInput(req.body?.draftSessionToken, { maxLength: 160 }).trim();
            let draftSessionId: string | null = null;
            if (draftSessionToken && deps.getDraftSession) {
                const draft = await deps.getDraftSession(draftSessionToken);
                draftSessionId = `${draft?.id || ''}`.trim() || null;
                if (draft?.status === 'submitted') {
                    const error: any = new Error('This shared draft has already been submitted. Reload the edit link to view the submitted state.');
                    error.statusCode = 409;
                    throw error;
                }
                if (draft?.status === 'expired') {
                    const error: any = new Error('This shared draft has expired. Start a fresh edit from the approved menu.');
                    error.statusCode = 410;
                    throw error;
                }
            }
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
            const generatedMenuFilename = buildMenuFilename(
                safeProjectName,
                normalizedProperty,
                safeServicePeriod,
                safeDateNeeded
            );

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

            const createResponse = await deps.axios.post(`${deps.DB_SERVICE_URL}/submissions`, submissionRecordPayload);

            console.log(`✓ Submission created in database: ${submissionId}`);

            // Email the submitter and each approver a copy of the submitted document.
            // Fire-and-forget: a mail failure must never fail the submission itself.
            if (deps.sendSubmissionConfirmationEmails) {
                deps.sendSubmissionConfirmationEmails({
                    submissionId,
                    projectName: safeProjectName,
                    property: normalizedProperty,
                    submitterName: safeSubmitterName,
                    submitterEmail: safeSubmitterEmail,
                    approvals: normalizedApprovals,
                    docxPath,
                    filename: generatedMenuFilename,
                    approverDisputeToken: `${createResponse?.data?.approver_dispute_token || ''}`,
                });
            }

            if (formAttemptId && deps.linkBasicAiCheckAuditsToSubmission) {
                deps.linkBasicAiCheckAuditsToSubmission(formAttemptId, submissionId)
                    .catch((err: any) => console.error('Failed to link basic check audits to submission:', err.message));
            }

            deps.axios.post(`${deps.DB_SERVICE_URL}/assets`, {
                submission_id: submissionId,
                asset_type: 'original_docx',
                source: 'chef_form',
                storage_provider: 'local',
                storage_path: docxPath,
                file_name: sanitizeStoredFileName(generatedMenuFilename, 'submission.docx')
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

            void triggerAiReview({
                submissionId,
                submitterEmail: safeSubmitterEmail,
                filename: generatedMenuFilename,
                originalPath: docxPath,
                projectName: safeProjectName,
                skipAi,
                templateType: normalizedTemplateType,
            });

            let clickupWarning: string | undefined;
            let clickupTaskId: string | undefined;
            let clickupDiagnosticReference: string | undefined;
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
            const recordClickUpHandoff = async (metadata: Record<string, any>) => {
                const rawPayload = mergeClickUpHandoffMetadata(
                    {
                        ...submissionRecordPayload,
                        form_payload: req.body,
                    },
                    metadata
                );
                try {
                    await deps.axios.put(`${deps.DB_SERVICE_URL}/submissions/${submissionId}`, { raw_payload: rawPayload });
                } catch (handoffError: any) {
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
            } else {
                try {
                    await recordClickUpHandoff({
                        status: 'attempting',
                        last_attempt_at: new Date().toISOString(),
                        last_payload: clickupTaskPayload,
                        retry_count: 0,
                    });
                    const clickupResponse = await deps.axios.post(
                        `${deps.CLICKUP_SERVICE_URL}/create-task`,
                        clickupTaskPayload,
                        { timeout: deps.CLICKUP_TASK_CREATE_TIMEOUT_MS }
                    );

                    const clickupData = clickupResponse.data || {};
                    clickupTaskId = clickupData.taskId;
                    if (clickupData.skipped) {
                        clickupDiagnosticReference = submissionId;
                        clickupWarning = withSubmissionReference(
                            `Menu submitted, but ClickUp integration is not configured yet. If this persists, please email the Word document to ${publicSupportEmail}.`,
                            clickupDiagnosticReference
                        );
                        await recordClickUpHandoff({
                            status: 'skipped_not_configured',
                            last_response: clickupData,
                            last_payload: clickupTaskPayload,
                            last_attempt_at: new Date().toISOString(),
                            retry_count: 0,
                        });
                    } else if (clickupData.warning || clickupData.attachmentUploadFailed) {
                        clickupDiagnosticReference = submissionId;
                        clickupWarning = withSubmissionReference(
                            `Menu submitted, but we could not upload the Word document to ClickUp. If this persists, please email the Word document directly to ${publicSupportEmail}.`,
                            clickupDiagnosticReference
                        );
                        await recordClickUpHandoff({
                            status: 'task_created_with_warning',
                            task_id: clickupTaskId,
                            last_response: clickupData,
                            last_payload: clickupTaskPayload,
                            last_attempt_at: new Date().toISOString(),
                            retry_count: 0,
                        });
                    } else {
                        await recordClickUpHandoff({
                            status: 'task_created',
                            task_id: clickupTaskId,
                            last_response: clickupData,
                            last_payload: clickupTaskPayload,
                            last_attempt_at: new Date().toISOString(),
                            retry_count: 0,
                        });
                    }
                } catch (clickupError: any) {
                    const errorDetails = describeServiceError(clickupError);
                    console.error('Failed to create ClickUp task:', errorDetails.response || errorDetails.message);
                    clickupDiagnosticReference = submissionId;
                    clickupWarning = withSubmissionReference(
                        `Menu submitted, but we could not create your ClickUp task. If this persists, please email the Word document directly to ${publicSupportEmail}.`,
                        clickupDiagnosticReference
                    );
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

            if (draftSessionToken && deps.lockDraftSession) {
                const lockedDraft = await deps.lockDraftSession(draftSessionToken, submissionId);
                draftSessionId = `${lockedDraft?.id || draftSessionId || ''}`.trim() || null;
            }

            res.json({
                success: true,
                submissionId: submissionId,
                draftSessionId,
                message: 'Menu submitted successfully',
                clickup: {
                    taskId: clickupTaskId,
                    warning: clickupWarning,
                    diagnosticReference: clickupDiagnosticReference,
                },
                localTesting,
            });
        } catch (error: any) {
            console.error('Error submitting form:', error);
            const statusCode = error?.statusCode || (deps.isClientInputError(error) ? 400 : 500);
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

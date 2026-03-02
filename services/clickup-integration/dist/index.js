"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const crypto_1 = __importDefault(require("crypto"));
dotenv_1.default.config({ path: path_1.default.join(__dirname, '..', '..', '..', '.env') });
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const app = (0, express_1.default)();
const port = 3007;
const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;
const CLICKUP_ASSIGNEE_ID = process.env.CLICKUP_ASSIGNEE_ID;
const CLICKUP_TEAM_ID = process.env.CLICKUP_TEAM_ID;
const CLICKUP_WEBHOOK_URL = process.env.CLICKUP_WEBHOOK_URL;
const CLICKUP_WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET;
const CLICKUP_CORRECTIONS_STATUS = (process.env.CLICKUP_CORRECTIONS_STATUS || 'corrections complete').toLowerCase();
const hasSmtpConfig = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailFromAddress = process.env.GRAPH_MAILBOX_ADDRESS || process.env.SMTP_USER || 'no-reply@example.com';
const mailTransporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
function getRepoRoot() {
    const candidates = [
        path_1.default.resolve(__dirname, '..', '..'),
        path_1.default.resolve(__dirname, '..', '..', '..')
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(path_1.default.join(candidate, 'services')) && fs_1.default.existsSync(path_1.default.join(candidate, 'samples'))) {
            return candidate;
        }
    }
    return candidates[0];
}
function getDocumentStorageRoot() {
    return process.env.DOCUMENT_STORAGE_ROOT || path_1.default.join(getRepoRoot(), 'tmp', 'documents');
}
function slugifyStorageSegment(value) {
    const cleaned = (value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || 'unknown';
}
function getSubmissionDocumentDir(projectName, property, submissionId) {
    return path_1.default.join(getDocumentStorageRoot(), slugifyStorageSegment(property), slugifyStorageSegment(projectName), submissionId);
}
const clickupHeaders = {
    Authorization: CLICKUP_API_TOKEN || '',
    'Content-Type': 'application/json',
};
app.use(express_1.default.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));
function safeTimingEqual(a, b) {
    try {
        const ab = Buffer.from(a);
        const bb = Buffer.from(b);
        if (ab.length !== bb.length)
            return false;
        return crypto_1.default.timingSafeEqual(ab, bb);
    }
    catch {
        return false;
    }
}
function verifyClickUpSignature(rawBody, signatureHeader) {
    if (!CLICKUP_WEBHOOK_SECRET)
        return true;
    if (!signatureHeader)
        return false;
    const expectedHex = crypto_1.default
        .createHmac('sha256', CLICKUP_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');
    const expectedBase64 = crypto_1.default
        .createHmac('sha256', CLICKUP_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('base64');
    const expectedBase64Url = expectedBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const rawProvided = signatureHeader.trim();
    const provided = rawProvided.replace(/^sha256=/i, '').trim();
    const providedLower = provided.toLowerCase();
    // Accept common encodings/header styles observed in webhook providers.
    if (safeTimingEqual(providedLower, expectedHex.toLowerCase()))
        return true;
    if (safeTimingEqual(provided, expectedBase64))
        return true;
    if (safeTimingEqual(provided, expectedBase64Url))
        return true;
    return false;
}
function getClickUpSignatureHeader(req) {
    return (req.header('X-Signature') ||
        req.header('x-signature') ||
        req.header('X-Webhook-Signature') ||
        req.header('x-webhook-signature') ||
        undefined);
}
function toTitleCase(value) {
    return value
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}
function formatDateNeeded(value) {
    if (!value)
        return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return value;
    return date.toISOString().slice(0, 10);
}
function buildTaskName(input) {
    const property = (input.property || '').trim();
    const menuType = (input.menuType || '').trim();
    const projectName = (input.projectName || '').trim();
    const assetType = (input.assetType || '').trim();
    const submissionMode = (input.submissionMode || '').trim();
    const menuLabel = menuType ? `${toTitleCase(menuType)} Menu` : '';
    const projectLabel = projectName || (assetType ? toTitleCase(assetType) : 'Menu Submission');
    const parts = ['RSH'];
    if (property)
        parts.push(property);
    if (menuLabel)
        parts.push(menuLabel);
    parts.push(projectLabel);
    if (submissionMode && submissionMode !== 'new')
        parts.push('Modification');
    return parts.join(' - ');
}
function buildTaskDescription(input) {
    const lines = [
        '## Menu Submission',
        `- Submission ID: ${input.submissionId || 'N/A'}`,
        `- Submitter: ${input.submitterName || 'N/A'} (${input.submitterEmail || 'N/A'})`,
        `- Job Title: ${input.submitterJobTitle || 'N/A'}`,
        `- Property: ${input.property || 'N/A'}`,
        `- Project: ${input.projectName || 'N/A'}`,
        `- Hotel: ${input.hotelName || 'N/A'}`,
        `- Location: ${input.cityCountry || 'N/A'}`,
        `- Menu Type: ${input.menuType || 'standard'}`,
        `- Template: ${input.templateType || 'food'}`,
        `- Asset Type: ${input.assetType || 'N/A'}`,
        `- Dimensions: ${input.width || 'N/A'} x ${input.height || 'N/A'} ${input.assetType === 'PRINT' ? 'in' : (input.assetType === 'BOTH' ? 'mixed' : 'px')}`,
        `- Orientation: ${input.orientation || 'N/A'}`,
        `- Turnaround: ${input.turnaroundDays || 'N/A'} day(s)`,
        `- Date Needed: ${formatDateNeeded(input.dateNeeded)}`,
        `- Submission Mode: ${input.submissionMode || 'new'}`,
        '- ClickUp Watchers: TODO add Marketing Team as watcher when watcher mapping/API is configured.',
    ];
    if (input.submissionMode === 'modification') {
        lines.push(`- Revision Source: ${input.revisionSource || (input.revisionBaseSubmissionId ? 'database' : 'uploaded-baseline')}`);
        if (input.revisionBaseSubmissionId) {
            lines.push(`- Base Submission ID: ${input.revisionBaseSubmissionId}`);
        }
    }
    if (input.assetType === 'PRINT' || input.assetType === 'BOTH') {
        if (input.assetType === 'BOTH') {
            lines.push(`- Digital Dimensions: ${input.digitalWidth || 'N/A'} x ${input.digitalHeight || 'N/A'} px`);
        }
        lines.push(`- Print Region: ${input.printRegion || 'N/A'}`);
        lines.push(`- Folded: ${input.folded === 'yes' ? 'Yes' : (input.folded === 'no' ? 'No' : 'N/A')}`);
        if (input.printRegion === 'NON_US') {
            lines.push(`- Print Size: ${input.printSize || 'N/A'}`);
        }
        else {
            lines.push(`- Print Dimensions: ${input.printWidth || 'N/A'} x ${input.printHeight || 'N/A'} in`);
        }
        lines.push(`- Crop Marks: ${input.cropMarks || 'No'}`);
        lines.push(`- Bleed Marks: ${input.bleedMarks || 'No'}`);
        lines.push(`- File Size Limit: ${input.fileSizeLimit === 'yes' ? `Yes (${input.fileSizeLimitMb || 'N/A'} MB)` : 'No'}`);
        if (input.fileDeliveryNotes) {
            lines.push(`- Delivery Notes: ${input.fileDeliveryNotes}`);
        }
    }
    if (input.overrideLines && input.overrideLines.length) {
        lines.push('', '## Critical Overrides', ...input.overrideLines);
    }
    if (Array.isArray(input.approvals) && input.approvals.length) {
        lines.push('', '## Approval Attestations');
        input.approvals.forEach((approval, index) => {
            const status = approval?.approved ? 'Approved' : 'Not approved';
            const name = (approval?.name || '').trim() || 'N/A';
            const position = (approval?.position || '').trim() || 'N/A';
            lines.push(`- Level ${index + 1}: ${status} by ${name} (${position})`);
        });
    }
    return lines.join('\n');
}
function sanitizeAttachmentFilename(rawName, fallbackBase, defaultExtension = '.docx') {
    const base = (rawName || '').trim() || fallbackBase;
    const cleaned = base
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    const lower = cleaned.toLowerCase();
    const withExt = lower.endsWith(defaultExtension.toLowerCase()) ? cleaned : `${cleaned}${defaultExtension}`;
    return withExt || `${fallbackBase}${defaultExtension}`;
}
async function sendCorrectionsReadyNotification(payload) {
    if (!hasSmtpConfig) {
        console.warn('SMTP not configured. Skipping corrections_ready notification.');
        return;
    }
    if (!payload.submitterEmail) {
        console.warn('No submitter email on submission. Skipping corrections_ready notification.');
        return;
    }
    const correctedBuffer = await fs_1.default.promises.readFile(payload.correctedPath);
    await mailTransporter.sendMail({
        from: `"Menu Review Bot" <${mailFromAddress}>`,
        to: payload.submitterEmail,
        subject: `Corrections Ready: ${payload.projectName || payload.filename || 'Menu Submission'}`,
        html: `
            <p>Hello ${payload.submitterName || ''},</p>
            <p>The corrected version of your menu submission is ready. Please find it attached.</p>
            <p>Thank you,</p>
            <p>Menu Review Bot</p>
        `,
        attachments: [
            {
                filename: payload.filename || 'corrected-menu.docx',
                content: correctedBuffer,
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
        ],
    });
    console.log(`Notification email (corrections_ready) sent successfully to ${payload.submitterEmail}.`);
}
async function uploadTaskAttachment(taskId, filePath, preferredFilename, contentType) {
    const fieldCandidates = ['attachment[]', 'attachment'];
    let lastError;
    for (const fieldName of fieldCandidates) {
        try {
            const form = new form_data_1.default();
            form.append(fieldName, fs_1.default.createReadStream(filePath), {
                filename: preferredFilename,
                contentType,
            });
            await axios_1.default.post(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, form, {
                headers: {
                    Authorization: CLICKUP_API_TOKEN,
                    ...form.getHeaders(),
                },
            });
            return;
        }
        catch (error) {
            lastError = error;
            const code = error.response?.data?.ECODE || '';
            if (code !== 'UPLOAD_002') {
                break;
            }
        }
    }
    throw lastError || new Error('Attachment upload failed');
}
function attachmentTimestamp(attachment) {
    const candidates = [
        attachment?.date,
        attachment?.date_created,
        attachment?.date_added,
        attachment?.created_at,
    ];
    for (const value of candidates) {
        const num = Number(value);
        if (!Number.isNaN(num) && num > 0)
            return num;
        const parsed = Date.parse(String(value || ''));
        if (!Number.isNaN(parsed) && parsed > 0)
            return parsed;
    }
    return 0;
}
function isDocxAttachment(attachment) {
    const name = String(attachment?.title || attachment?.filename || attachment?.name || '').toLowerCase();
    const mime = String(attachment?.extension || attachment?.mime_type || '').toLowerCase();
    const url = String(attachment?.url || '').toLowerCase();
    return (name.endsWith('.docx') ||
        mime.includes('wordprocessingml') ||
        mime === 'docx' ||
        url.includes('.docx'));
}
function pickMostRecentCorrectedAttachment(attachments, submittedFilename) {
    if (!Array.isArray(attachments) || attachments.length === 0)
        return null;
    const submitted = String(submittedFilename || '').toLowerCase();
    const candidates = attachments
        .filter(isDocxAttachment)
        .sort((a, b) => attachmentTimestamp(b) - attachmentTimestamp(a));
    if (candidates.length === 0) {
        return attachments[attachments.length - 1] || null;
    }
    const correctedFirst = candidates.find((a) => {
        const title = String(a?.title || a?.filename || a?.name || '').toLowerCase();
        return submitted && title && title !== submitted;
    });
    return correctedFirst || candidates[0];
}
function normalizeStatus(value) {
    return String(value || '').trim().toLowerCase();
}
async function extractApprovedMenuContent(docxPath) {
    const scriptPath = path_1.default.resolve(__dirname, '..', '..', 'docx-redliner', 'extract_clean_menu_text.py');
    const venvPython = path_1.default.resolve(__dirname, '..', '..', 'docx-redliner', 'venv', 'bin', 'python');
    let command = `"${venvPython}" "${scriptPath}" "${docxPath}"`;
    if (!fs_1.default.existsSync(venvPython)) {
        command = `python3 "${scriptPath}" "${docxPath}"`;
    }
    const { stdout } = await execAsync(command, { timeout: 30000 });
    const parsed = JSON.parse(stdout || '{}');
    return {
        raw: parsed.menu_content || '',
        cleaned: parsed.cleaned_menu_content || parsed.menu_content || '',
    };
}
async function processApprovedTask(clickupTaskId, opts) {
    const taskResponse = await axios_1.default.get(`https://api.clickup.com/api/v2/task/${clickupTaskId}`, {
        headers: clickupHeaders,
    });
    const currentStatus = normalizeStatus(taskResponse.data?.status?.status);
    if (!opts?.skipStatusCheck && currentStatus !== CLICKUP_CORRECTIONS_STATUS) {
        return { processed: false, reason: `task status is "${currentStatus}"` };
    }
    const subResponse = await axios_1.default.get(`http://localhost:3004/submissions/by-clickup-task/${clickupTaskId}`);
    const submission = subResponse.data;
    console.log(`Found submission ${submission.id} for ClickUp task ${clickupTaskId}`);
    const attachments = taskResponse.data.attachments || [];
    if (attachments.length === 0) {
        return { processed: false, reason: 'no attachments on task', submissionId: submission.id };
    }
    const latestAttachment = pickMostRecentCorrectedAttachment(attachments, submission.filename);
    if (!latestAttachment) {
        return { processed: false, reason: 'no usable attachment found', submissionId: submission.id };
    }
    const submissionDocDir = getSubmissionDocumentDir(submission.project_name || '', submission.property || '', submission.id);
    const approvedDir = path_1.default.join(submissionDocDir, 'approved');
    await fs_1.default.promises.mkdir(approvedDir, { recursive: true });
    const correctedPath = path_1.default.join(approvedDir, `${submission.id}-corrected.docx`);
    const fileResponse = await axios_1.default.get(latestAttachment.url, {
        responseType: 'arraybuffer',
        headers: { Authorization: CLICKUP_API_TOKEN || '' },
    });
    await fs_1.default.promises.writeFile(correctedPath, fileResponse.data);
    console.log(`Downloaded corrected file to ${correctedPath}`);
    let extractedRaw = '';
    let extractedClean = '';
    try {
        const extracted = await extractApprovedMenuContent(correctedPath);
        extractedRaw = extracted.raw;
        extractedClean = extracted.cleaned;
    }
    catch (extractError) {
        console.warn(`Failed to extract approved text from corrected DOCX: ${extractError.message}`);
    }
    await axios_1.default.put(`http://localhost:3004/submissions/${submission.id}`, {
        status: 'approved',
        final_path: correctedPath,
        approved_menu_content_raw: extractedRaw || undefined,
        approved_menu_content: extractedClean || undefined,
        approved_text_extracted_at: extractedClean ? new Date().toISOString() : undefined,
    });
    console.log(`Updated submission ${submission.id} to approved`);
    axios_1.default.post('http://localhost:3004/assets', {
        submission_id: submission.id,
        asset_type: 'approved_docx',
        source: 'isabella_clickup',
        storage_provider: 'local',
        storage_path: correctedPath,
        file_name: path_1.default.basename(correctedPath),
        meta: {
            clickup_task_id: clickupTaskId,
            attachment_id: latestAttachment.id || null,
        },
    }).catch((err) => console.error('Failed to save approved_docx asset metadata:', err.message));
    sendCorrectionsReadyNotification({
        submitterEmail: submission.submitter_email,
        submitterName: submission.submitter_name,
        projectName: submission.project_name,
        correctedPath,
        filename: submission.filename,
    }).catch((err) => console.error('Failed to send corrections_ready notification:', err.message));
    axios_1.default.post('http://localhost:3006/compare', {
        ai_draft_path: submission.ai_draft_path,
        final_path: correctedPath,
        submission_id: submission.id,
    }).catch((err) => console.error('Failed to trigger differ comparison:', err.message));
    return { processed: true, submissionId: submission.id };
}
app.post('/create-task', async (req, res) => {
    try {
        if (!CLICKUP_API_TOKEN || !CLICKUP_LIST_ID) {
            console.log('ClickUp not configured, skipping task creation');
            return res.json({ skipped: true });
        }
        const { submissionId, submitterName, submitterEmail, submitterJobTitle, projectName, property, width, height, printWidth, printHeight, printRegion, printSize, folded, digitalWidth, digitalHeight, cropMarks, bleedMarks, fileSizeLimit, fileSizeLimitMb, fileDeliveryNotes, orientation, menuType, templateType, turnaroundDays, dateNeeded, hotelName, cityCountry, assetType, docxPath, menuImagePath, menuImageFileName, filename, submissionMode, revisionSource, revisionBaseSubmissionId, revisionBaselineDocPath, revisionBaselineFileName, criticalOverrides, approvals, } = req.body;
        const overriddenCriticals = Array.isArray(criticalOverrides)
            ? criticalOverrides.filter((o) => !!o)
            : [];
        const overrideLines = overriddenCriticals.map((o, idx) => {
            const issueType = (o.type || 'Unknown').toString();
            const item = (o.menuItem || '').toString().trim();
            const desc = (o.description || '').toString().trim();
            return `${idx + 1}. [${issueType}] ${item || 'No item specified'}${desc ? ` - ${desc}` : ''}`;
        });
        const taskPayload = {
            name: buildTaskName({ property, menuType, projectName, assetType, submissionMode }),
            description: buildTaskDescription({
                submissionId,
                submitterName,
                submitterEmail,
                submitterJobTitle,
                property,
                projectName,
                hotelName,
                cityCountry,
                menuType,
                templateType,
                assetType,
                width,
                height,
                printWidth,
                printHeight,
                printRegion,
                printSize,
                folded,
                digitalWidth,
                digitalHeight,
                orientation,
                turnaroundDays,
                dateNeeded,
                submissionMode,
                revisionSource,
                revisionBaseSubmissionId,
                fileDeliveryNotes,
                cropMarks,
                bleedMarks,
                fileSizeLimit,
                fileSizeLimitMb,
                overrideLines,
                approvals,
            }),
            status: 'to do',
        };
        if (CLICKUP_ASSIGNEE_ID) {
            taskPayload.assignees = [parseInt(CLICKUP_ASSIGNEE_ID, 10)];
        }
        if (dateNeeded) {
            taskPayload.due_date = new Date(dateNeeded).getTime();
        }
        const taskResponse = await axios_1.default.post(`https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`, taskPayload, { headers: clickupHeaders });
        const taskId = taskResponse.data.id;
        console.log(`ClickUp task created: ${taskId}`);
        let attachmentUploadFailed = false;
        let baselineUploadFailed = false;
        const warnings = [];
        if (docxPath && fs_1.default.existsSync(docxPath)) {
            const uploadFilename = sanitizeAttachmentFilename(filename || projectName, submissionId || 'menu-submission');
            try {
                await uploadTaskAttachment(taskId, docxPath, uploadFilename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                console.log(`DOCX attached to ClickUp task ${taskId}`);
            }
            catch (attachError) {
                attachmentUploadFailed = true;
                const errorDetail = attachError.response?.data?.err || attachError.message;
                warnings.push(`Primary DOCX upload failed: ${errorDetail}`);
                console.error(`Failed to attach DOCX to ClickUp task ${taskId}:`, errorDetail);
            }
        }
        if (revisionBaselineDocPath && fs_1.default.existsSync(revisionBaselineDocPath)) {
            try {
                await uploadTaskAttachment(taskId, revisionBaselineDocPath, sanitizeAttachmentFilename(revisionBaselineFileName || path_1.default.basename(revisionBaselineDocPath), `${submissionId || 'menu-submission'}-baseline`), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                console.log(`Baseline approved DOCX attached to ClickUp task ${taskId}`);
            }
            catch (baselineError) {
                baselineUploadFailed = true;
                const errorDetail = baselineError.response?.data?.err || baselineError.message;
                warnings.push(`Baseline DOCX upload failed: ${errorDetail}`);
                console.error(`Failed to attach baseline DOCX to ClickUp task ${taskId}:`, errorDetail);
            }
        }
        if (menuImagePath && fs_1.default.existsSync(menuImagePath)) {
            try {
                const fallbackName = `${submissionId || 'menu-submission'}-menu-image`;
                const ext = path_1.default.extname(menuImageFileName || menuImagePath) || '.png';
                const safeName = sanitizeAttachmentFilename(menuImageFileName || path_1.default.basename(menuImagePath), fallbackName, ext);
                await uploadTaskAttachment(taskId, menuImagePath, safeName, 'application/octet-stream');
                console.log(`Menu image attached to ClickUp task ${taskId}`);
            }
            catch (imageError) {
                const errorDetail = imageError.response?.data?.err || imageError.message;
                warnings.push(`Menu image upload failed: ${errorDetail}`);
                console.error(`Failed to attach menu image to ClickUp task ${taskId}:`, errorDetail);
            }
        }
        if (submissionId) {
            await axios_1.default.put(`http://localhost:3004/submissions/${submissionId}`, {
                clickup_task_id: taskId,
            });
            console.log(`Stored clickup_task_id ${taskId} on submission ${submissionId}`);
        }
        res.json({
            success: true,
            taskId,
            attachmentUploadFailed,
            baselineUploadFailed,
            warning: warnings.length ? warnings.join(' | ') : undefined,
        });
    }
    catch (error) {
        console.error('Error creating ClickUp task:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to create ClickUp task', details: error.message });
    }
});
app.post('/webhook/clickup', async (req, res) => {
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const signature = getClickUpSignatureHeader(req);
    if (!verifyClickUpSignature(rawBody, signature)) {
        console.warn('Rejected ClickUp webhook with invalid signature');
        return res.status(401).send('Invalid signature');
    }
    res.status(200).send('OK');
    try {
        const { event, task_id: clickupTaskId, history_items } = req.body;
        if (event !== 'taskStatusUpdated')
            return;
        const statusChange = history_items?.find((h) => h.field === 'status');
        const newStatus = (statusChange?.after?.status || '').toLowerCase();
        if (newStatus !== CLICKUP_CORRECTIONS_STATUS)
            return;
        console.log(`ClickUp task ${clickupTaskId} moved to "${newStatus}"`);
        const result = await processApprovedTask(String(clickupTaskId), { skipStatusCheck: true });
        if (!result.processed) {
            console.log(`Skipped ClickUp task ${clickupTaskId}: ${result.reason || 'not processed'}`);
        }
    }
    catch (error) {
        console.error('Error processing ClickUp webhook:', error.response?.data || error.message);
    }
});
app.post('/webhook/backfill-pending', async (_req, res) => {
    try {
        const pendingResponse = await axios_1.default.get('http://localhost:3004/submissions/pending');
        const pending = Array.isArray(pendingResponse.data) ? pendingResponse.data : [];
        const candidates = pending.filter((s) => !!s.clickup_task_id);
        const summary = {
            scanned_pending: pending.length,
            candidates_with_clickup: candidates.length,
            processed: 0,
            skipped: 0,
            failed: 0,
            details: [],
        };
        for (const submission of candidates) {
            const taskId = String(submission.clickup_task_id);
            try {
                const result = await processApprovedTask(taskId, { skipStatusCheck: false });
                if (result.processed) {
                    summary.processed += 1;
                    summary.details.push({
                        submission_id: result.submissionId || submission.id,
                        clickup_task_id: taskId,
                        status: 'processed',
                    });
                }
                else {
                    summary.skipped += 1;
                    summary.details.push({
                        submission_id: submission.id,
                        clickup_task_id: taskId,
                        status: 'skipped',
                        reason: result.reason,
                    });
                }
            }
            catch (error) {
                summary.failed += 1;
                summary.details.push({
                    submission_id: submission.id,
                    clickup_task_id: taskId,
                    status: 'failed',
                    reason: error.response?.data?.err || error.message,
                });
            }
        }
        res.json({ success: true, ...summary });
    }
    catch (error) {
        console.error('Error running pending webhook backfill:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to run pending backfill', details: error.message });
    }
});
app.post('/webhook/register', async (_req, res) => {
    try {
        if (!CLICKUP_API_TOKEN || !CLICKUP_TEAM_ID || !CLICKUP_WEBHOOK_URL) {
            return res.status(400).json({
                error: 'Missing required env vars: CLICKUP_API_TOKEN, CLICKUP_TEAM_ID, CLICKUP_WEBHOOK_URL',
            });
        }
        const response = await axios_1.default.post(`https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/webhook`, {
            endpoint: CLICKUP_WEBHOOK_URL,
            events: ['taskStatusUpdated'],
        }, { headers: clickupHeaders });
        console.log('ClickUp webhook registered:', response.data);
        if (response.data?.secret) {
            console.log('Set CLICKUP_WEBHOOK_SECRET in .env using the returned webhook secret.');
        }
        res.json({ success: true, webhook: response.data });
    }
    catch (error) {
        console.error('Error registering ClickUp webhook:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to register webhook', details: error.message });
    }
});
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'clickup-integration',
        configured: !!(CLICKUP_API_TOKEN && CLICKUP_LIST_ID),
    });
});
if (require.main === module) {
    app.listen(port, () => {
        console.log(`clickup-integration service listening at http://localhost:${port}`);
        if (!CLICKUP_API_TOKEN) {
            console.log('ClickUp API token not configured - task creation will be skipped');
        }
        if (CLICKUP_API_TOKEN && !CLICKUP_WEBHOOK_SECRET) {
            console.log('ClickUp webhook signature verification is disabled (CLICKUP_WEBHOOK_SECRET not set).');
        }
    });
}
exports.default = app;

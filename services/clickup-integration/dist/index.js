"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv = require("dotenv");
const nodemailer_1 = __importDefault(require("nodemailer"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const crypto_1 = __importDefault(require("crypto"));
const supabase_client_1 = require("@menumanager/supabase-client");
const approval_finalization_1 = require("./lib/approval-finalization");
const smtp_config_1 = require("./lib/smtp-config");
const sharepoint_filenames_1 = require("./lib/sharepoint-filenames");
const clickup_due_date_1 = require("./lib/clickup-due-date");
const internal_auth_1 = require("@menumanager/internal-auth");
dotenv.config({ path: path_1.default.join(__dirname, '..', '..', '..', '.env') });
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const app = express();
const port = 3007;
const DB_SERVICE_URL = process.env.DB_SERVICE_URL || 'http://localhost:3004';
const DIFFER_SERVICE_URL = process.env.DIFFER_SERVICE_URL || 'http://localhost:3006';
const internalApi = (0, internal_auth_1.createInternalApiClient)(axios_1.default);
const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;
const CLICKUP_ASSIGNEE_ID = process.env.CLICKUP_ASSIGNEE_ID;
const CLICKUP_TEAM_ID = process.env.CLICKUP_TEAM_ID;
const CLICKUP_WEBHOOK_URL = process.env.CLICKUP_WEBHOOK_URL;
const CLICKUP_WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET;
const CLICKUP_INITIAL_REVIEW_STATUS = (process.env.CLICKUP_INITIAL_REVIEW_STATUS || 'pending initial isa review').trim();
const CLICKUP_CORRECTIONS_STATUS = normalizeStatus(process.env.CLICKUP_CORRECTIONS_STATUS || 'to do');
const CLICKUP_POST_APPROVAL_STATUS = (process.env.CLICKUP_POST_APPROVAL_STATUS || 'to do').trim();
const CLICKUP_ISABELLA_DIRECT_STATUS = CLICKUP_POST_APPROVAL_STATUS || 'to do';
const CLICKUP_MARKETING_WATCHER_GROUP_NAME = (process.env.CLICKUP_MARKETING_WATCHER_GROUP_NAME || 'Marketing').trim();
const CLICKUP_MARKETING_WATCHER_GROUP_ID = process.env.CLICKUP_MARKETING_WATCHER_GROUP_ID || '';
const CLICKUP_WATCHER_USER_IDS = process.env.CLICKUP_WATCHER_USER_IDS || '';
const ISABELLA_SUBMITTER_EMAIL = 'isabella@richardsandoval.com';
const CLICKUP_REVIEW_COMPLETE_STATUSES = buildReviewCompleteStatuses();
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID;
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const smtpConfig = (0, smtp_config_1.buildSmtpRuntimeConfig)();
const hasSmtpConfig = smtpConfig.enabled;
const mailFromAddress = smtpConfig.fromAddress;
let cachedGraphToken = null;
const mailTransporter = hasSmtpConfig ? nodemailer_1.default.createTransport(smtpConfig.transportOptions) : null;
const ALERT_EMAIL = process.env.ALERT_EMAIL || '';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3005';
const alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
function sendAdminAlert(alert) {
    const lastSent = alertCooldowns.get(alert.alert_type) || 0;
    if (Date.now() - lastSent < ALERT_COOLDOWN_MS)
        return;
    alertCooldowns.set(alert.alert_type, Date.now());
    (0, supabase_client_1.logAlert)(alert);
    if (mailTransporter && ALERT_EMAIL) {
        const severityLabel = alert.severity.toUpperCase();
        mailTransporter.sendMail({
            from: `"Menu Manager Alerts" <${mailFromAddress}>`,
            to: ALERT_EMAIL,
            subject: `[${severityLabel}] ${alert.alert_type.replace(/_/g, ' ')} — Menu Manager`,
            html: (0, supabase_client_1.buildAlertEmailHtml)(alert, DASHBOARD_URL),
        }).catch((err) => console.error('Failed to send alert email:', err.message));
    }
}
function describeServiceError(error) {
    return Object.fromEntries(Object.entries({
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        response: error?.response?.data,
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}
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
function parseDelimitedList(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function parseClickUpUserIds(value) {
    return parseDelimitedList(value)
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item > 0);
}
function uniqueNumbers(values) {
    return Array.from(new Set(values));
}
function normalizeClickUpLabel(value) {
    return String(value || '').trim().toLowerCase();
}
function clickUpGroupMemberUserId(member) {
    const raw = (typeof member === 'number' || typeof member === 'string')
        ? member
        : (member?.user?.id ?? member?.id ?? member?.userid ?? member?.user_id);
    const parsed = Number.parseInt(String(raw || ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function isIsabellaSubmission(email) {
    return normalizeClickUpLabel(email) === ISABELLA_SUBMITTER_EMAIL;
}
function buildClickUpGroupUrl(groupIds) {
    const params = new URLSearchParams();
    if (CLICKUP_TEAM_ID) {
        params.set('team_id', CLICKUP_TEAM_ID);
    }
    for (const groupId of groupIds) {
        params.append('group_ids', groupId);
    }
    return `https://api.clickup.com/api/v2/group?${params.toString()}`;
}
async function resolveMarketingUserIds() {
    const watcherIds = parseClickUpUserIds(CLICKUP_WATCHER_USER_IDS);
    const groupIds = parseDelimitedList(CLICKUP_MARKETING_WATCHER_GROUP_ID);
    const groupName = normalizeClickUpLabel(CLICKUP_MARKETING_WATCHER_GROUP_NAME);
    if (!CLICKUP_TEAM_ID && (groupIds.length || groupName)) {
        console.warn('CLICKUP_TEAM_ID is required to resolve Marketing user group members.');
        return uniqueNumbers(watcherIds);
    }
    if (!CLICKUP_TEAM_ID || (!groupIds.length && !groupName)) {
        return uniqueNumbers(watcherIds);
    }
    const response = await axios_1.default.get(buildClickUpGroupUrl(groupIds), { headers: clickupHeaders });
    const groups = Array.isArray(response.data?.groups)
        ? response.data.groups
        : (Array.isArray(response.data) ? response.data : []);
    const targetGroupIds = new Set(groupIds.map(normalizeClickUpLabel));
    const matchedGroups = groups.filter((group) => {
        const id = normalizeClickUpLabel(group?.id);
        const name = normalizeClickUpLabel(group?.name);
        const handle = normalizeClickUpLabel(group?.handle);
        return targetGroupIds.has(id) || (groupName && (name === groupName || handle === groupName));
    });
    if (!matchedGroups.length) {
        console.warn(`ClickUp Marketing group "${CLICKUP_MARKETING_WATCHER_GROUP_NAME}" was not found.`);
    }
    for (const group of matchedGroups) {
        const members = Array.isArray(group?.members) ? group.members : [];
        for (const member of members) {
            const userId = clickUpGroupMemberUserId(member);
            if (userId)
                watcherIds.push(userId);
        }
    }
    return uniqueNumbers(watcherIds);
}
async function addMarketingWatchersToTask(taskId) {
    const watcherIds = await resolveMarketingUserIds();
    if (!watcherIds.length) {
        console.warn('No ClickUp watcher user IDs resolved for Marketing notifications.');
        return 0;
    }
    await axios_1.default.put(`https://api.clickup.com/api/v2/task/${taskId}`, { watchers: { add: watcherIds, rem: [] } }, { headers: clickupHeaders });
    return watcherIds.length;
}
async function assignMarketingToApprovedTask(taskId) {
    const marketingAssigneeIds = await resolveMarketingUserIds();
    if (!marketingAssigneeIds.length) {
        console.warn('No ClickUp user IDs resolved for Marketing assignment.');
        return 0;
    }
    const removeAssigneeIds = parseClickUpUserIds(CLICKUP_ASSIGNEE_ID)
        .filter((userId) => !marketingAssigneeIds.includes(userId));
    await axios_1.default.put(`https://api.clickup.com/api/v2/task/${taskId}`, { assignees: { add: marketingAssigneeIds, rem: removeAssigneeIds } }, { headers: clickupHeaders });
    return marketingAssigneeIds.length;
}
app.use(express.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));
app.use(['/create-task', '/approval/finalize', '/webhook/backfill-pending', '/webhook/register'], internal_auth_1.requireInternalServiceAuth);
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
    const servicePeriod = (input.servicePeriod || '').trim();
    const projectName = (input.projectName || '').trim();
    const assetType = (input.assetType || '').trim();
    const submissionMode = (input.submissionMode || '').trim();
    const menuTypeLabel = menuType && menuType !== 'standard'
        ? toTitleCase(menuType.replace(/_/g, ' '))
        : '';
    const menuLabelParts = [
        servicePeriod ? toTitleCase(servicePeriod.replace(/_/g, ' ')) : '',
        menuTypeLabel,
    ].filter(Boolean);
    const menuLabel = menuLabelParts.length ? `${menuLabelParts.join(' ')} Menu` : '';
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
function modificationWorkflowLabel(revisionSource, revisionBaseSubmissionId) {
    const normalizedSource = `${revisionSource || ''}`.trim();
    const effectiveSource = normalizedSource || (revisionBaseSubmissionId ? 'database' : 'uploaded_baseline');
    switch (effectiveSource) {
        case 'database':
            return "Modification to Existing Menu - I'll make menu changes here (Find in Database)";
        case 'uploaded_baseline':
            return "Modification to Existing Menu - I'll make menu changes here (Upload Prior Approved DOCX)";
        case 'uploaded_unapproved':
            return 'Modification to Existing Menu - I already made my menu edits on a doc (Upload Unapproved DOCX, Preserve Redlines)';
        default:
            return `Modification to Existing Menu - ${effectiveSource}`;
    }
}
function revisionSourceLabel(revisionSource, revisionBaseSubmissionId) {
    const normalizedSource = `${revisionSource || ''}`.trim();
    const effectiveSource = normalizedSource || (revisionBaseSubmissionId ? 'database' : 'uploaded_baseline');
    switch (effectiveSource) {
        case 'database':
            return 'Find in Database';
        case 'uploaded_baseline':
            return 'Uploaded prior approved DOCX';
        case 'uploaded_unapproved':
            return 'Uploaded DOCX with edits already made (preserve redlines)';
        default:
            return effectiveSource;
    }
}
function submissionModeLabel(input) {
    if (input.submissionMode === 'modification') {
        return modificationWorkflowLabel(input.revisionSource, input.revisionBaseSubmissionId);
    }
    return 'Brand New Menu Submission';
}
function buildTaskDescription(input) {
    const lines = [];
    // Overrides and attestations at the top for reviewer visibility
    if (input.overrideLines && input.overrideLines.length) {
        lines.push('## Critical Overrides', ...input.overrideLines, '');
    }
    if (Array.isArray(input.approvals) && input.approvals.length) {
        lines.push('## Approval Attestations');
        input.approvals.forEach((approval, index) => {
            const status = approval?.approved ? 'Approved' : 'Not approved';
            const name = (approval?.name || '').trim() || 'N/A';
            const position = (approval?.position || '').trim() || 'N/A';
            lines.push(`- Level ${index + 1}: ${status} by ${name} (${position})`);
        });
        lines.push('');
    }
    if (input.submissionId) {
        lines.push('## Browser Approval', `- Approval Editor: ${DASHBOARD_URL.replace(/\/+$/, '')}/approval/${input.submissionId}`, '');
    }
    lines.push('## Menu Submission', `- Submission ID: ${input.submissionId || 'N/A'}`, `- Submitter: ${input.submitterName || 'N/A'} (${input.submitterEmail || 'N/A'})`, `- Job Title: ${input.submitterJobTitle || 'N/A'}`, `- Property: ${input.property || 'N/A'}`, `- Project: ${input.projectName || 'N/A'}`, `- Hotel: ${input.hotelName || 'N/A'}`, `- Location: ${input.cityCountry || 'N/A'}`, `- Menu Type: ${input.menuType || 'standard'}`, `- Service Period: ${input.servicePeriod || 'other'}`, `- Template: ${input.templateType || 'food'}`, `- Asset Type: ${input.assetType || 'N/A'}`, `- Dimensions: ${input.width || 'N/A'} x ${input.height || 'N/A'} ${input.assetType === 'PRINT' ? 'in' : (input.assetType === 'BOTH' ? 'mixed' : 'px')}`, `- Orientation: ${input.orientation || 'N/A'}`, `- Turnaround: ${input.turnaroundDays || 'N/A'} day(s)`, `- Date Needed: ${formatDateNeeded(input.dateNeeded)}`, `- Submission Mode: ${submissionModeLabel(input)}`, '- ClickUp Watchers: Marketing group members are added automatically when the group is configured.');
    if (input.submissionMode === 'modification') {
        lines.push(`- Revision Source: ${revisionSourceLabel(input.revisionSource, input.revisionBaseSubmissionId)}`);
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
            const response = await axios_1.default.post(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, form, {
                headers: {
                    Authorization: CLICKUP_API_TOKEN,
                    ...form.getHeaders(),
                },
            });
            return response.data;
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
async function updateClickUpTaskStatus(taskId, status) {
    const normalizedStatus = String(status || '').trim();
    if (!normalizedStatus)
        return;
    await axios_1.default.put(`https://api.clickup.com/api/v2/task/${taskId}`, { status: normalizedStatus }, { headers: clickupHeaders });
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
function timestampFromSubmissionValue(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isNaN(parsed) ? 0 : parsed;
}
function finalizedTimestamp(submission) {
    return Math.max(timestampFromSubmissionValue(submission?.approved_text_extracted_at), timestampFromSubmissionValue(submission?.approved_at), timestampFromSubmissionValue(submission?.updated_at));
}
function isSubmissionAlreadyFinalizedForAttachment(submission, attachment) {
    if (normalizeStatus(submission?.status) !== 'approved' || !submission?.final_path) {
        return false;
    }
    const finalizedAt = finalizedTimestamp(submission);
    const attachmentAt = attachment ? attachmentTimestamp(attachment) : 0;
    if (!attachmentAt) {
        return true;
    }
    return finalizedAt >= attachmentAt;
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
function parseStatusList(value) {
    return String(value || '')
        .split(',')
        .map(normalizeStatus)
        .filter(Boolean);
}
function buildReviewCompleteStatuses() {
    const statuses = new Set();
    for (const status of parseStatusList(process.env.CLICKUP_CORRECTIONS_STATUSES)) {
        statuses.add(status);
    }
    if (CLICKUP_CORRECTIONS_STATUS) {
        statuses.add(CLICKUP_CORRECTIONS_STATUS);
    }
    const postApprovalStatus = normalizeStatus(CLICKUP_POST_APPROVAL_STATUS);
    if (postApprovalStatus) {
        statuses.add(postApprovalStatus);
    }
    if (statuses.size === 0) {
        statuses.add('to do');
    }
    return statuses;
}
function isReviewCompleteStatus(status) {
    return CLICKUP_REVIEW_COMPLETE_STATUSES.has(normalizeStatus(status));
}
function describeReviewCompleteStatuses() {
    return Array.from(CLICKUP_REVIEW_COMPLETE_STATUSES)
        .map((status) => `"${status}"`)
        .join(', ');
}
function normalizeFolderMatchKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s*&\s*/g, ' and ')
        .replace(/\s+/g, ' ');
}
function getAttachmentFilename(attachment) {
    return String(attachment?.title || attachment?.filename || attachment?.name || '').trim();
}
function getFallbackApprovedSourcePath(submission) {
    const candidates = [
        submission?.original_path,
        submission?.revision_baseline_doc_path,
        submission?.final_path,
    ];
    for (const candidate of candidates) {
        const filePath = `${candidate || ''}`.trim();
        if (filePath && fs_1.default.existsSync(filePath)) {
            return filePath;
        }
    }
    return null;
}
function parseSharePointSite(siteUrl) {
    const parsed = new URL(siteUrl);
    return {
        hostname: parsed.hostname,
        sitePath: parsed.pathname.replace(/\/+$/, ''),
    };
}
function encodeGraphPath(value) {
    return value
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}
function normalizeSharePointLibraryName(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'shared documents' ? 'documents' : normalized;
}
function sharePointLibraryNameMatches(actual, expected) {
    return normalizeSharePointLibraryName(actual) === normalizeSharePointLibraryName(expected);
}
async function getGraphAccessToken() {
    if (!GRAPH_CLIENT_ID || !GRAPH_TENANT_ID || !GRAPH_CLIENT_SECRET) {
        throw new Error('Missing GRAPH_CLIENT_ID, GRAPH_TENANT_ID, or GRAPH_CLIENT_SECRET');
    }
    if (cachedGraphToken && cachedGraphToken.expiresAt > Date.now() + 60000) {
        return cachedGraphToken.accessToken;
    }
    const tokenUrl = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id: GRAPH_CLIENT_ID,
        client_secret: GRAPH_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });
    const response = await axios_1.default.post(tokenUrl, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const accessToken = response.data?.access_token;
    const expiresIn = Number(response.data?.expires_in || 3600);
    if (!accessToken) {
        throw new Error('Graph token response did not include access_token');
    }
    cachedGraphToken = {
        accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
    };
    return accessToken;
}
async function graphRequest(config) {
    const token = await getGraphAccessToken();
    const response = await (0, axios_1.default)({
        method: config.method || 'GET',
        url: `https://graph.microsoft.com/v1.0${config.path}`,
        data: config.data,
        responseType: config.responseType || 'json',
        headers: {
            Authorization: `Bearer ${token}`,
            ...(config.headers || {}),
        },
    });
    return response.data;
}
function isDocxFileName(name) {
    return String(name || '').trim().toLowerCase().endsWith('.docx');
}
async function getPropertySharePointConfig(property) {
    if (!property.trim())
        return null;
    const response = await internalApi.get(`${DB_SERVICE_URL}/properties/validate`, {
        params: { name: property },
        timeout: 3000,
    });
    if (!response.data?.valid || !response.data?.property) {
        return null;
    }
    return response.data.property;
}
async function resolveSharePointDrive(config) {
    if (config.sharepoint_drive_id) {
        return {
            driveId: config.sharepoint_drive_id,
        };
    }
    if (!config.sharepoint_site_url || !config.sharepoint_library_name) {
        throw new Error('Property is missing SharePoint drive ID, or site URL and library name');
    }
    const { hostname, sitePath } = parseSharePointSite(config.sharepoint_site_url);
    const site = await graphRequest({
        path: `/sites/${hostname}:${sitePath}`,
    });
    const drives = await graphRequest({
        path: `/sites/${site.id}/drives`,
    });
    const drive = (drives.value || []).find((item) => sharePointLibraryNameMatches(item?.name, config.sharepoint_library_name));
    if (!drive?.id) {
        throw new Error(`SharePoint library "${config.sharepoint_library_name}" not found`);
    }
    return {
        siteId: site.id,
        driveId: drive.id,
    };
}
async function getDriveItemByPath(driveId, itemPath) {
    return graphRequest({
        path: `/drives/${driveId}/root:/${encodeGraphPath(itemPath)}`,
    });
}
async function listDriveChildrenByPath(driveId, itemPath) {
    const response = await graphRequest({
        path: `/drives/${driveId}/root:/${encodeGraphPath(itemPath)}:/children`,
    });
    return Array.isArray(response?.value) ? response.value : [];
}
async function ensureChildFolder(driveId, parentPath, folderName) {
    const existingChildren = await listDriveChildrenByPath(driveId, parentPath);
    const existing = existingChildren.find((item) => !!item?.folder && String(item?.name || '').trim().toLowerCase() === folderName.trim().toLowerCase());
    if (existing)
        return existing;
    const parentItem = await getDriveItemByPath(driveId, parentPath);
    return graphRequest({
        method: 'POST',
        path: `/drives/${driveId}/items/${parentItem.id}/children`,
        data: {
            name: folderName,
            folder: {},
        },
        headers: {
            'Content-Type': 'application/json',
        },
    });
}
async function moveDriveItemToFolder(driveId, itemId, parentId, targetName) {
    try {
        return await graphRequest({
            method: 'PATCH',
            path: `/drives/${driveId}/items/${itemId}`,
            data: {
                parentReference: { id: parentId },
                name: targetName,
            },
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
    catch (error) {
        const suffixedName = targetName.replace(/\.docx$/i, `_${Date.now()}.docx`);
        return graphRequest({
            method: 'PATCH',
            path: `/drives/${driveId}/items/${itemId}`,
            data: {
                parentReference: { id: parentId },
                name: suffixedName,
            },
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
}
async function archiveExistingDocxFilesInSharePointSubfolder(driveId, folderPath) {
    const children = await listDriveChildrenByPath(driveId, folderPath);
    const docxFiles = children.filter((item) => !!item?.file && isDocxFileName(item?.name));
    if (docxFiles.length === 0)
        return 0;
    const oldFolder = await ensureChildFolder(driveId, folderPath, 'old');
    let movedCount = 0;
    for (const item of docxFiles) {
        // TODO(security): Keep SharePoint routing on a strict "never delete" policy.
        // This workflow may move prior DOCX files into old/, but it must never issue
        // delete/remove calls against SharePoint content, even as part of cleanup,
        // replacement, retry, or future refactors.
        await moveDriveItemToFolder(driveId, item.id, oldFolder.id, String(item.name || 'archived.docx'));
        movedCount += 1;
    }
    return movedCount;
}
async function uploadApprovedDocToSharePoint(input) {
    if (!GRAPH_CLIENT_ID || !GRAPH_TENANT_ID || !GRAPH_CLIENT_SECRET) {
        return { uploaded: false, skipped: 'graph credentials not configured' };
    }
    const propertyConfig = await getPropertySharePointConfig(input.property);
    const canResolveDrive = !!propertyConfig?.sharepoint_drive_id || (!!propertyConfig?.sharepoint_site_url && !!propertyConfig?.sharepoint_library_name);
    if (!propertyConfig?.sharepoint_base_folder_path || !canResolveDrive) {
        return { uploaded: false, skipped: 'property has no sharepoint routing config' };
    }
    const serviceFolders = Array.isArray(propertyConfig.sharepoint_service_folders)
        ? propertyConfig.sharepoint_service_folders
        : [];
    const matchedFolder = serviceFolders.find((folder) => normalizeFolderMatchKey(folder) === normalizeFolderMatchKey(input.servicePeriod)) || null;
    const targetFolderPath = matchedFolder
        ? `${propertyConfig.sharepoint_base_folder_path}/${matchedFolder}`
        : propertyConfig.sharepoint_base_folder_path;
    const { siteId, driveId } = await resolveSharePointDrive(propertyConfig);
    let archivedDocxCount = 0;
    if (matchedFolder) {
        archivedDocxCount = await archiveExistingDocxFilesInSharePointSubfolder(driveId, targetFolderPath);
    }
    const canonicalFileName = (0, sharepoint_filenames_1.buildSharePointApprovedFilename)(input.submission || {
        property: input.property,
        service_period: input.servicePeriod,
    });
    const storagePath = `${targetFolderPath}/${canonicalFileName}`;
    const fileBuffer = await fs_1.default.promises.readFile(input.localFilePath);
    const uploadedItem = await graphRequest({
        method: 'PUT',
        path: `/drives/${driveId}/root:/${encodeGraphPath(storagePath)}:/content`,
        data: fileBuffer,
        responseType: 'json',
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
    });
    return {
        uploaded: true,
        storagePath,
        webUrl: uploadedItem?.webUrl || undefined,
        folderMatched: matchedFolder,
        driveId,
        siteId,
        archivedDocxCount,
        fileName: canonicalFileName,
    };
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
async function extractApprovedDishesForSubmission(input) {
    const response = await internalApi.post(`${DB_SERVICE_URL}/approved-dishes/extract`, {
        submissionId: input.submissionId,
        property: input.property,
        servicePeriod: input.servicePeriod,
        approvedMenuContent: input.approvedMenuContent,
    });
    const added = Number(response.data?.added || 0);
    console.log(`Approved dish extraction complete for ${input.submissionId}: ${added} dishes added`);
    return added;
}
async function finalizeApprovedSubmission(input) {
    const submission = input.submission;
    const clickupTaskId = `${input.clickupTaskId || submission?.clickup_task_id || ''}`.trim();
    const shouldUpdateClickupStatus = input.shouldUpdateClickupStatus !== false;
    const shouldRouteClickupToMarketing = input.shouldRouteClickupToMarketing !== false && !!CLICKUP_API_TOKEN;
    const warnings = [];
    let extractedRaw = '';
    let extractedClean = '';
    let clickupMarketingAssigneesUpdated = false;
    let marketingAssigneeCount = 0;
    try {
        const extracted = await extractApprovedMenuContent(input.approvedPath);
        extractedRaw = extracted.raw;
        extractedClean = extracted.cleaned;
    }
    catch (extractError) {
        console.warn(`Failed to extract approved text from approved DOCX: ${extractError.message}`);
    }
    await internalApi.put(`${DB_SERVICE_URL}/submissions/${submission.id}`, (0, approval_finalization_1.buildApprovedSubmissionUpdate)({
        approvedPath: input.approvedPath,
        extractedRaw,
        extractedClean,
    }));
    console.log(`Updated submission ${submission.id} to approved`);
    internalApi.post(`${DB_SERVICE_URL}/assets`, (0, approval_finalization_1.buildApprovedDocxAssetRecord)({
        submissionId: submission.id,
        approvedPath: input.approvedPath,
        source: input.approvedAssetSource || 'isabella_clickup',
        clickupTaskId,
        attachmentId: input.attachmentId || null,
    })).catch((err) => console.error('Failed to save approved_docx asset metadata:', err.message));
    try {
        const sharePointUpload = await uploadApprovedDocToSharePoint({
            property: submission.property || '',
            servicePeriod: submission.service_period || submission.raw_payload?.servicePeriod,
            localFilePath: input.approvedPath,
            uploadFileName: input.approvedFileName,
            submission,
        });
        if (sharePointUpload.uploaded && sharePointUpload.storagePath) {
            console.log(`Uploaded approved DOCX to SharePoint: ${sharePointUpload.storagePath}`);
            if (sharePointUpload.archivedDocxCount) {
                console.log(`Archived ${sharePointUpload.archivedDocxCount} existing DOCX file(s) into old/`);
            }
            internalApi.post(`${DB_SERVICE_URL}/assets`, (0, approval_finalization_1.buildSharePointApprovedDocxAssetRecord)({
                submissionId: submission.id,
                storagePath: sharePointUpload.storagePath,
                approvedFileName: sharePointUpload.fileName || input.approvedFileName,
                clickupTaskId,
                siteId: sharePointUpload.siteId,
                driveId: sharePointUpload.driveId,
                webUrl: sharePointUpload.webUrl || null,
                matchedFolder: sharePointUpload.folderMatched,
                archivedDocxCount: sharePointUpload.archivedDocxCount || 0,
            })).catch((err) => console.error('Failed to save SharePoint asset metadata:', err.message));
        }
        else if (sharePointUpload.uploaded) {
            console.warn(`SharePoint upload reported success for submission ${submission.id} without a storage path`);
        }
        else if (sharePointUpload.skipped) {
            console.log(`Skipped SharePoint upload for submission ${submission.id}: ${sharePointUpload.skipped}`);
        }
    }
    catch (sharePointError) {
        console.error('Failed to upload approved DOCX to SharePoint:', sharePointError.response?.data || sharePointError.message);
        sendAdminAlert({
            alert_type: 'sharepoint_upload_failed',
            severity: 'warning',
            service: 'clickup-integration',
            submission_id: submission.id,
            message: `Failed to upload approved DOCX to SharePoint for "${submission.project_name}"`,
            details: {
                error: sharePointError.response?.data || sharePointError.message,
                property: submission.property,
                servicePeriod: submission.service_period || submission.raw_payload?.servicePeriod || null,
            },
        });
    }
    if (clickupTaskId) {
        if (shouldRouteClickupToMarketing) {
            try {
                marketingAssigneeCount = await assignMarketingToApprovedTask(clickupTaskId);
                if (marketingAssigneeCount > 0) {
                    clickupMarketingAssigneesUpdated = true;
                    console.log(`Assigned ClickUp task ${clickupTaskId} to ${marketingAssigneeCount} Marketing user(s) after approval processing`);
                }
                else {
                    warnings.push('Skipped Marketing assignee update because no Marketing user IDs were resolved.');
                }
            }
            catch (assigneeError) {
                const assigneeErrorDetail = assigneeError.response?.data || assigneeError.message;
                warnings.push(`Marketing assignee update failed: ${typeof assigneeErrorDetail === 'string' ? assigneeErrorDetail : JSON.stringify(assigneeErrorDetail)}`);
                console.error('Failed to assign ClickUp task to Marketing after approval:', assigneeErrorDetail);
                sendAdminAlert({
                    alert_type: 'clickup_marketing_assignment_failed',
                    severity: 'warning',
                    service: 'clickup-integration',
                    submission_id: submission.id,
                    message: `Failed to assign ClickUp task ${clickupTaskId} to Marketing after approval`,
                    details: {
                        error: assigneeErrorDetail,
                        clickup_task_id: clickupTaskId,
                    },
                });
            }
        }
        else if (input.skipClickupMarketingReason) {
            warnings.push(input.skipClickupMarketingReason);
        }
        if (shouldUpdateClickupStatus) {
            try {
                await updateClickUpTaskStatus(clickupTaskId, CLICKUP_POST_APPROVAL_STATUS);
                console.log(`Moved ClickUp task ${clickupTaskId} to "${CLICKUP_POST_APPROVAL_STATUS}" after approval processing`);
            }
            catch (statusError) {
                const statusErrorDetail = statusError.response?.data || statusError.message;
                warnings.push(`ClickUp status update failed: ${typeof statusErrorDetail === 'string' ? statusErrorDetail : JSON.stringify(statusErrorDetail)}`);
                console.error('Failed to move ClickUp task after approval:', statusErrorDetail);
                sendAdminAlert({
                    alert_type: 'clickup_status_transition_failed',
                    severity: 'warning',
                    service: 'clickup-integration',
                    submission_id: submission.id,
                    message: `Failed to move ClickUp task ${clickupTaskId} to "${CLICKUP_POST_APPROVAL_STATUS}" after approval`,
                    details: {
                        error: statusErrorDetail,
                        target_status: CLICKUP_POST_APPROVAL_STATUS,
                    },
                });
            }
        }
        else {
            warnings.push(input.skipClickupStatusReason || `Skipped ClickUp status update to "${CLICKUP_POST_APPROVAL_STATUS}" because the approved DOCX was not uploaded to the task.`);
        }
    }
    sendCorrectionsReadyNotification({
        submitterEmail: submission.submitter_email,
        submitterName: submission.submitter_name,
        projectName: submission.project_name,
        correctedPath: input.approvedPath,
        filename: input.approvedFileName,
    }).catch((err) => {
        console.error('Failed to send corrections_ready notification:', err.message);
        sendAdminAlert({
            alert_type: 'notification_email_failed',
            severity: 'warning',
            service: 'clickup-integration',
            submission_id: submission.id,
            message: `Failed to send corrections email to ${submission.submitter_email} for "${submission.project_name}"`,
            details: { error: err.message },
        });
    });
    internalApi.post(`${DIFFER_SERVICE_URL}/compare`, {
        ai_draft_path: submission.ai_draft_path,
        final_path: input.approvedPath,
        submission_id: submission.id,
    }).catch((err) => console.error('Failed to trigger differ comparison:', err.message));
    try {
        await extractApprovedDishesForSubmission({
            submissionId: submission.id,
            property: submission.property,
            servicePeriod: submission.service_period || submission.raw_payload?.servicePeriod,
            approvedMenuContent: extractedClean || submission.approved_menu_content || submission.menu_content,
        });
    }
    catch (err) {
        console.error('Failed to extract approved dishes:', err.response?.data || err.message);
        sendAdminAlert({
            alert_type: 'approved_dish_extraction_failed',
            severity: 'error',
            service: 'clickup-integration',
            submission_id: submission.id,
            message: `Failed to extract approved dishes for "${submission.project_name}"`,
            details: {
                error: err.response?.data || err.message,
                property: submission.property,
                servicePeriod: submission.service_period || submission.raw_payload?.servicePeriod || null,
                clickup_task_id: clickupTaskId || null,
            },
        });
    }
    return {
        processed: true,
        submissionId: submission.id,
        clickupStatusUpdated: !!clickupTaskId && shouldUpdateClickupStatus && !warnings.some((warning) => warning.startsWith('ClickUp status update failed')),
        clickupMarketingAssigneesUpdated,
        marketingAssigneeCount,
        warnings,
    };
}
async function processApprovedTask(clickupTaskId, opts) {
    const taskResponse = await axios_1.default.get(`https://api.clickup.com/api/v2/task/${clickupTaskId}`, {
        headers: clickupHeaders,
    });
    const currentStatus = normalizeStatus(taskResponse.data?.status?.status);
    if (!opts?.skipStatusCheck && !isReviewCompleteStatus(currentStatus)) {
        return { processed: false, reason: `task status is "${currentStatus}", expected ${describeReviewCompleteStatuses()}` };
    }
    const subResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/by-clickup-task/${clickupTaskId}`);
    const submission = subResponse.data;
    console.log(`Found submission ${submission.id} for ClickUp task ${clickupTaskId}`);
    const attachments = taskResponse.data.attachments || [];
    const latestAttachment = pickMostRecentCorrectedAttachment(attachments, submission.filename);
    if (isSubmissionAlreadyFinalizedForAttachment(submission, latestAttachment)) {
        return {
            processed: false,
            reason: 'submission is already approved for the latest ClickUp DOCX attachment',
            submissionId: submission.id,
        };
    }
    const submissionDocDir = getSubmissionDocumentDir(submission.project_name || '', submission.property || '', submission.id);
    const approvedDir = path_1.default.join(submissionDocDir, 'approved');
    await fs_1.default.promises.mkdir(approvedDir, { recursive: true });
    const approvedPath = path_1.default.join(approvedDir, `${submission.id}-approved.docx`);
    let approvedFileName = submission.filename || `${submission.project_name || submission.id}.docx`;
    if (latestAttachment?.url) {
        const fileResponse = await axios_1.default.get(latestAttachment.url, {
            responseType: 'arraybuffer',
            headers: { Authorization: CLICKUP_API_TOKEN || '' },
        });
        await fs_1.default.promises.writeFile(approvedPath, fileResponse.data);
        approvedFileName = getAttachmentFilename(latestAttachment) || approvedFileName;
        console.log(`Downloaded approved file from ClickUp to ${approvedPath}`);
    }
    else {
        const fallbackSourcePath = getFallbackApprovedSourcePath(submission);
        if (!fallbackSourcePath) {
            return { processed: false, reason: 'no usable ClickUp or local approved DOCX source found', submissionId: submission.id };
        }
        await fs_1.default.promises.copyFile(fallbackSourcePath, approvedPath);
        approvedFileName = path_1.default.basename(fallbackSourcePath) || approvedFileName;
        console.log(`Copied fallback approved file from ${fallbackSourcePath} to ${approvedPath}`);
    }
    return finalizeApprovedSubmission({
        submission,
        approvedPath,
        approvedFileName,
        clickupTaskId,
        attachmentId: latestAttachment?.id || null,
        approvedAssetSource: 'isabella_clickup',
        shouldUpdateClickupStatus: currentStatus !== normalizeStatus(CLICKUP_POST_APPROVAL_STATUS),
        skipClickupStatusReason: `Skipped ClickUp status update to "${CLICKUP_POST_APPROVAL_STATUS}" because the task is already in that status.`,
    });
}
app.post('/create-task', async (req, res) => {
    try {
        if (!CLICKUP_API_TOKEN || !CLICKUP_LIST_ID) {
            console.log('ClickUp not configured, skipping task creation');
            return res.json({ skipped: true });
        }
        const { submissionId, submitterName, submitterEmail, submitterJobTitle, projectName, property, width, height, printWidth, printHeight, printRegion, printSize, folded, digitalWidth, digitalHeight, cropMarks, bleedMarks, fileSizeLimit, fileSizeLimitMb, fileDeliveryNotes, orientation, menuType, servicePeriod, templateType, turnaroundDays, dateNeeded, hotelName, cityCountry, assetType, docxPath, menuImagePath, menuImageFileName, filename, submissionMode, revisionSource, revisionBaseSubmissionId, criticalOverrides, approvals, } = req.body;
        const overriddenCriticals = Array.isArray(criticalOverrides)
            ? criticalOverrides.filter((o) => !!o)
            : [];
        const overrideLines = overriddenCriticals.map((o, idx) => {
            const issueType = (o.type || 'Unknown').toString();
            const item = (o.menuItem || '').toString().trim();
            const desc = (o.description || '').toString().trim();
            return `${idx + 1}. [${issueType}] ${item || 'No item specified'}${desc ? ` - ${desc}` : ''}`;
        });
        const warnings = [];
        const routeToMarketing = isIsabellaSubmission(submitterEmail);
        let marketingAssigneeIds = [];
        if (routeToMarketing) {
            try {
                marketingAssigneeIds = await resolveMarketingUserIds();
            }
            catch (marketingError) {
                const errorDetail = marketingError.response?.data?.err || marketingError.message;
                warnings.push(`Marketing assignee resolution failed: ${errorDetail}`);
                console.error('Failed to resolve Marketing assignees for Isabella submission:', errorDetail);
            }
        }
        const taskPayload = {
            name: buildTaskName({ property, menuType, servicePeriod, projectName, assetType, submissionMode }),
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
                servicePeriod,
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
            status: routeToMarketing ? CLICKUP_ISABELLA_DIRECT_STATUS : CLICKUP_INITIAL_REVIEW_STATUS,
        };
        if (routeToMarketing) {
            if (marketingAssigneeIds.length) {
                taskPayload.assignees = marketingAssigneeIds;
            }
            else {
                warnings.push('No Marketing user IDs resolved for Isabella submission assignment.');
            }
        }
        else if (CLICKUP_ASSIGNEE_ID) {
            taskPayload.assignees = [parseInt(CLICKUP_ASSIGNEE_ID, 10)];
        }
        if (dateNeeded) {
            const dueMs = (0, clickup_due_date_1.clickUpDueDateMillis)(dateNeeded);
            if (dueMs != null) {
                taskPayload.due_date = dueMs;
            }
        }
        const taskResponse = await axios_1.default.post(`https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`, taskPayload, { headers: clickupHeaders });
        const taskId = taskResponse.data.id;
        console.log(`ClickUp task created: ${taskId}`);
        let attachmentUploadFailed = false;
        try {
            const watcherCount = await addMarketingWatchersToTask(taskId);
            if (watcherCount > 0) {
                console.log(`Added ${watcherCount} ClickUp watcher(s) to task ${taskId}`);
            }
        }
        catch (watcherError) {
            const errorDetail = watcherError.response?.data?.err || watcherError.message;
            warnings.push(`Marketing watcher update failed: ${errorDetail}`);
            console.error(`Failed to add Marketing watchers to ClickUp task ${taskId}:`, errorDetail);
        }
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
        // Chef-uploaded modification baseline is intentionally NOT attached to
        // the ClickUp task — the design team works from the generated DOCX, and
        // surfacing the chef's source file alongside it caused confusion. The
        // file is still persisted locally and recorded in DB assets for audit.
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
            const submissionUpdate = { clickup_task_id: taskId };
            if (routeToMarketing) {
                submissionUpdate.status = 'sent_to_marketing';
            }
            await internalApi.put(`${DB_SERVICE_URL}/submissions/${submissionId}`, submissionUpdate);
            console.log(`Stored clickup_task_id ${taskId} on submission ${submissionId}`);
        }
        res.json({
            success: true,
            taskId,
            attachmentUploadFailed,
            warning: warnings.length ? warnings.join(' | ') : undefined,
        });
    }
    catch (error) {
        const errorDetails = describeServiceError(error);
        console.error('Error creating ClickUp task:', errorDetails.response || errorDetails.message);
        res.status(500).json({ error: 'Failed to create ClickUp task', details: errorDetails });
    }
});
app.post('/approval/finalize', async (req, res) => {
    try {
        const submissionId = `${req.body?.submissionId || ''}`.trim();
        const approvedPath = `${req.body?.approvedPath || ''}`.trim();
        const requestedFileName = `${req.body?.approvedFileName || ''}`.trim();
        if (!submissionId || !approvedPath) {
            return res.status(400).json({ error: 'submissionId and approvedPath are required' });
        }
        if (!fs_1.default.existsSync(approvedPath)) {
            return res.status(400).json({ error: 'Approved DOCX file does not exist on disk' });
        }
        const subResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
        const submission = subResponse.data;
        if (!submission?.id) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        const clickupTaskId = `${submission.clickup_task_id || ''}`.trim();
        const approvedFileName = sanitizeAttachmentFilename(requestedFileName || submission.filename || path_1.default.basename(approvedPath), submission.id || 'approved-menu');
        const warnings = [];
        let attachmentUploaded = false;
        let uploadedAttachmentId = null;
        const canUpdateClickupTask = !!(clickupTaskId && CLICKUP_API_TOKEN);
        if (canUpdateClickupTask) {
            try {
                const attachmentResponse = await uploadTaskAttachment(clickupTaskId, approvedPath, approvedFileName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                attachmentUploaded = true;
                uploadedAttachmentId = `${attachmentResponse?.id || attachmentResponse?.attachment?.id || ''}`.trim() || null;
                console.log(`Browser-approved DOCX attached to ClickUp task ${clickupTaskId}`);
            }
            catch (attachError) {
                const errorDetail = attachError.response?.data?.err || attachError.message;
                warnings.push(`ClickUp attachment upload failed: ${errorDetail}`);
                console.error(`Failed to attach browser-approved DOCX to ClickUp task ${clickupTaskId}:`, errorDetail);
                sendAdminAlert({
                    alert_type: 'clickup_attachment_upload_failed',
                    severity: 'warning',
                    service: 'clickup-integration',
                    submission_id: submission.id,
                    message: `Failed to upload browser-approved DOCX to ClickUp for "${submission.project_name}"`,
                    details: { error: errorDetail, clickup_task_id: clickupTaskId },
                });
            }
        }
        else if (!clickupTaskId) {
            warnings.push('No ClickUp task was linked to this submission; finalized locally only.');
        }
        else {
            warnings.push('ClickUp API token not configured; finalized locally only.');
        }
        const result = await finalizeApprovedSubmission({
            submission,
            approvedPath,
            approvedFileName,
            clickupTaskId: clickupTaskId || undefined,
            attachmentId: uploadedAttachmentId,
            approvedAssetSource: 'browser_approval_editor',
            shouldUpdateClickupStatus: canUpdateClickupTask && attachmentUploaded,
            shouldRouteClickupToMarketing: canUpdateClickupTask && attachmentUploaded,
            skipClickupMarketingReason: canUpdateClickupTask && !attachmentUploaded
                ? 'Skipped Marketing assignee update because the approved DOCX was not uploaded to the task.'
                : undefined,
        });
        warnings.push(...(result.warnings || []));
        res.json({
            success: true,
            processed: result.processed,
            submissionId: result.submissionId,
            attachmentUploaded,
            clickupMarketingAssigneesUpdated: result.clickupMarketingAssigneesUpdated,
            marketingAssigneeCount: result.marketingAssigneeCount,
            clickupStatusUpdated: result.clickupStatusUpdated,
            warning: warnings.length ? warnings.join(' | ') : undefined,
        });
    }
    catch (error) {
        console.error('Error finalizing browser approval:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to finalize browser approval', details: error.message });
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
        if (!isReviewCompleteStatus(newStatus))
            return;
        console.log(`ClickUp task ${clickupTaskId} moved to "${newStatus}"`);
        const result = await processApprovedTask(String(clickupTaskId), { skipStatusCheck: true });
        if (!result.processed) {
            console.log(`Skipped ClickUp task ${clickupTaskId}: ${result.reason || 'not processed'}`);
        }
    }
    catch (error) {
        console.error('Error processing ClickUp webhook:', error.response?.data || error.message);
        sendAdminAlert({
            alert_type: 'clickup_webhook_failed',
            severity: 'error',
            service: 'clickup-integration',
            message: `Failed to process ClickUp webhook for task ${req.body?.task_id || 'unknown'}`,
            details: { error: error.response?.data || error.message, event: req.body?.event },
        });
    }
});
app.post('/webhook/backfill-pending', async (_req, res) => {
    try {
        const pendingResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/pending`);
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

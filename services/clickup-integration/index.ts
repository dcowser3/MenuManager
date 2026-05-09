import express = require('express');
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import dotenv = require('dotenv');
import nodemailer from 'nodemailer';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import {
    logAlert,
    buildAlertEmailHtml,
    SystemAlert,
} from '@menumanager/supabase-client';
import {
    buildApprovedDocxAssetRecord,
    buildApprovedSubmissionUpdate,
    buildSharePointApprovedDocxAssetRecord,
} from './lib/approval-finalization';
import { createInternalApiClient, requireInternalServiceAuth } from '@menumanager/internal-auth';

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const execAsync = promisify(exec);

const app = express();
const port = 3007;
const DB_SERVICE_URL = process.env.DB_SERVICE_URL || 'http://localhost:3004';
const DIFFER_SERVICE_URL = process.env.DIFFER_SERVICE_URL || 'http://localhost:3006';
const internalApi = createInternalApiClient(axios);

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;
const CLICKUP_ASSIGNEE_ID = process.env.CLICKUP_ASSIGNEE_ID;
const CLICKUP_TEAM_ID = process.env.CLICKUP_TEAM_ID;
const CLICKUP_WEBHOOK_URL = process.env.CLICKUP_WEBHOOK_URL;
const CLICKUP_WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET;
const CLICKUP_INITIAL_REVIEW_STATUS = (process.env.CLICKUP_INITIAL_REVIEW_STATUS || 'pending initial isa review').trim();
const CLICKUP_CORRECTIONS_STATUS = (process.env.CLICKUP_CORRECTIONS_STATUS || 'corrections complete').toLowerCase();
const CLICKUP_POST_APPROVAL_STATUS = (process.env.CLICKUP_POST_APPROVAL_STATUS || 'to do').trim();
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID;
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const hasSmtpConfig = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailFromAddress = process.env.GRAPH_MAILBOX_ADDRESS || process.env.SMTP_USER || 'no-reply@example.com';
let cachedGraphToken: { accessToken: string; expiresAt: number } | null = null;

const mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const ALERT_EMAIL = process.env.ALERT_EMAIL || '';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3005';
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

function sendAdminAlert(alert: SystemAlert): void {
    const lastSent = alertCooldowns.get(alert.alert_type) || 0;
    if (Date.now() - lastSent < ALERT_COOLDOWN_MS) return;
    alertCooldowns.set(alert.alert_type, Date.now());

    logAlert(alert);

    if (hasSmtpConfig && ALERT_EMAIL) {
        const severityLabel = alert.severity.toUpperCase();
        mailTransporter.sendMail({
            from: `"Menu Manager Alerts" <${process.env.SMTP_USER}>`,
            to: ALERT_EMAIL,
            subject: `[${severityLabel}] ${alert.alert_type.replace(/_/g, ' ')} — Menu Manager`,
            html: buildAlertEmailHtml(alert, DASHBOARD_URL),
        }).catch((err: any) => console.error('Failed to send alert email:', err.message));
    }
}

function getRepoRoot(): string {
    const candidates = [
        path.resolve(__dirname, '..', '..'),
        path.resolve(__dirname, '..', '..', '..')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'services')) && fs.existsSync(path.join(candidate, 'samples'))) {
            return candidate;
        }
    }

    return candidates[0];
}

function getDocumentStorageRoot(): string {
    return process.env.DOCUMENT_STORAGE_ROOT || path.join(getRepoRoot(), 'tmp', 'documents');
}

function slugifyStorageSegment(value: string): string {
    const cleaned = (value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || 'unknown';
}

function getSubmissionDocumentDir(projectName: string, property: string, submissionId: string): string {
    return path.join(
        getDocumentStorageRoot(),
        slugifyStorageSegment(property),
        slugifyStorageSegment(projectName),
        submissionId
    );
}

const clickupHeaders = {
    Authorization: CLICKUP_API_TOKEN || '',
    'Content-Type': 'application/json',
};

app.use(express.json({
    verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));
app.use(['/create-task', '/approval/finalize', '/webhook/backfill-pending', '/webhook/register'], requireInternalServiceAuth);

function safeTimingEqual(a: string, b: string): boolean {
    try {
        const ab = Buffer.from(a);
        const bb = Buffer.from(b);
        if (ab.length !== bb.length) return false;
        return crypto.timingSafeEqual(ab, bb);
    } catch {
        return false;
    }
}

function verifyClickUpSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!CLICKUP_WEBHOOK_SECRET) return true;
    if (!signatureHeader) return false;

    const expectedHex = crypto
        .createHmac('sha256', CLICKUP_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');
    const expectedBase64 = crypto
        .createHmac('sha256', CLICKUP_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('base64');
    const expectedBase64Url = expectedBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

    const rawProvided = signatureHeader.trim();
    const provided = rawProvided.replace(/^sha256=/i, '').trim();
    const providedLower = provided.toLowerCase();

    // Accept common encodings/header styles observed in webhook providers.
    if (safeTimingEqual(providedLower, expectedHex.toLowerCase())) return true;
    if (safeTimingEqual(provided, expectedBase64)) return true;
    if (safeTimingEqual(provided, expectedBase64Url)) return true;

    return false;
}

function getClickUpSignatureHeader(req: any): string | undefined {
    return (
        req.header('X-Signature') ||
        req.header('x-signature') ||
        req.header('X-Webhook-Signature') ||
        req.header('x-webhook-signature') ||
        undefined
    );
}

function toTitleCase(value: string): string {
    return value
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}

function formatDateNeeded(value: string | undefined): string {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString().slice(0, 10);
}

function buildTaskName(input: {
    property?: string;
    menuType?: string;
    servicePeriod?: string;
    projectName?: string;
    assetType?: string;
    submissionMode?: string;
}): string {
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

    if (property) parts.push(property);
    if (menuLabel) parts.push(menuLabel);
    parts.push(projectLabel);
    if (submissionMode && submissionMode !== 'new') parts.push('Modification');

    return parts.join(' - ');
}

function buildTaskDescription(input: {
    submissionId?: string;
    submitterName?: string;
    submitterEmail?: string;
    submitterJobTitle?: string;
    property?: string;
    projectName?: string;
    hotelName?: string;
    cityCountry?: string;
    menuType?: string;
    servicePeriod?: string;
    templateType?: string;
    assetType?: string;
    width?: string;
    height?: string;
    printWidth?: string;
    printHeight?: string;
    printRegion?: string;
    printSize?: string;
    folded?: string;
    digitalWidth?: string;
    digitalHeight?: string;
    orientation?: string;
    turnaroundDays?: string | number;
    dateNeeded?: string;
    submissionMode?: string;
    revisionSource?: string;
    revisionBaseSubmissionId?: string;
    fileDeliveryNotes?: string;
    cropMarks?: string;
    bleedMarks?: string;
    fileSizeLimit?: string;
    fileSizeLimitMb?: string;
    overrideLines?: string[];
    approvals?: Array<{
        approved?: boolean;
        name?: string;
        position?: string;
    }>;
}): string {
    const lines: string[] = [];

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
        lines.push(
            '## Browser Approval',
            `- Approval Editor: ${DASHBOARD_URL.replace(/\/+$/, '')}/approval/${input.submissionId}`,
            ''
        );
    }

    lines.push(
        '## Menu Submission',
        `- Submission ID: ${input.submissionId || 'N/A'}`,
        `- Submitter: ${input.submitterName || 'N/A'} (${input.submitterEmail || 'N/A'})`,
        `- Job Title: ${input.submitterJobTitle || 'N/A'}`,
        `- Property: ${input.property || 'N/A'}`,
        `- Project: ${input.projectName || 'N/A'}`,
        `- Hotel: ${input.hotelName || 'N/A'}`,
        `- Location: ${input.cityCountry || 'N/A'}`,
        `- Menu Type: ${input.menuType || 'standard'}`,
        `- Service Period: ${input.servicePeriod || 'other'}`,
        `- Template: ${input.templateType || 'food'}`,
        `- Asset Type: ${input.assetType || 'N/A'}`,
        `- Dimensions: ${input.width || 'N/A'} x ${input.height || 'N/A'} ${input.assetType === 'PRINT' ? 'in' : (input.assetType === 'BOTH' ? 'mixed' : 'px')}`,
        `- Orientation: ${input.orientation || 'N/A'}`,
        `- Turnaround: ${input.turnaroundDays || 'N/A'} day(s)`,
        `- Date Needed: ${formatDateNeeded(input.dateNeeded)}`,
        `- Submission Mode: ${input.submissionMode || 'new'}`,
        '- ClickUp Watchers: TODO add Marketing Team as watcher when watcher mapping/API is configured.'
    );

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
        } else {
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

function sanitizeAttachmentFilename(rawName: string | undefined, fallbackBase: string, defaultExtension = '.docx'): string {
    const base = (rawName || '').trim() || fallbackBase;
    const cleaned = base
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    const lower = cleaned.toLowerCase();
    const withExt = lower.endsWith(defaultExtension.toLowerCase()) ? cleaned : `${cleaned}${defaultExtension}`;
    return withExt || `${fallbackBase}${defaultExtension}`;
}

async function sendCorrectionsReadyNotification(payload: {
    submitterEmail?: string;
    submitterName?: string;
    projectName?: string;
    correctedPath: string;
    filename?: string;
}): Promise<void> {
    if (!hasSmtpConfig) {
        console.warn('SMTP not configured. Skipping corrections_ready notification.');
        return;
    }

    if (!payload.submitterEmail) {
        console.warn('No submitter email on submission. Skipping corrections_ready notification.');
        return;
    }

    const correctedBuffer = await fs.promises.readFile(payload.correctedPath);
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

async function uploadTaskAttachment(
    taskId: string,
    filePath: string,
    preferredFilename: string,
    contentType: string
): Promise<any> {
    const fieldCandidates = ['attachment[]', 'attachment'];
    let lastError: any;

    for (const fieldName of fieldCandidates) {
        try {
            const form = new FormData();
            form.append(fieldName, fs.createReadStream(filePath), {
                filename: preferredFilename,
                contentType,
            });

            const response = await axios.post(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, form, {
                headers: {
                    Authorization: CLICKUP_API_TOKEN,
                    ...form.getHeaders(),
                },
            });
            return response.data;
        } catch (error: any) {
            lastError = error;
            const code = error.response?.data?.ECODE || '';
            if (code !== 'UPLOAD_002') {
                break;
            }
        }
    }

    throw lastError || new Error('Attachment upload failed');
}

async function updateClickUpTaskStatus(taskId: string, status: string): Promise<void> {
    const normalizedStatus = String(status || '').trim();
    if (!normalizedStatus) return;

    await axios.put(
        `https://api.clickup.com/api/v2/task/${taskId}`,
        { status: normalizedStatus },
        { headers: clickupHeaders }
    );
}

function attachmentTimestamp(attachment: any): number {
    const candidates = [
        attachment?.date,
        attachment?.date_created,
        attachment?.date_added,
        attachment?.created_at,
    ];
    for (const value of candidates) {
        const num = Number(value);
        if (!Number.isNaN(num) && num > 0) return num;
        const parsed = Date.parse(String(value || ''));
        if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
    return 0;
}

function isDocxAttachment(attachment: any): boolean {
    const name = String(attachment?.title || attachment?.filename || attachment?.name || '').toLowerCase();
    const mime = String(attachment?.extension || attachment?.mime_type || '').toLowerCase();
    const url = String(attachment?.url || '').toLowerCase();
    return (
        name.endsWith('.docx') ||
        mime.includes('wordprocessingml') ||
        mime === 'docx' ||
        url.includes('.docx')
    );
}

function pickMostRecentCorrectedAttachment(
    attachments: any[],
    submittedFilename: string | undefined
): any | null {
    if (!Array.isArray(attachments) || attachments.length === 0) return null;

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

function normalizeStatus(value: any): string {
    return String(value || '').trim().toLowerCase();
}

function normalizeFolderMatchKey(value: string | undefined): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s*&\s*/g, ' and ')
        .replace(/\s+/g, ' ');
}

function getAttachmentFilename(attachment: any): string {
    return String(attachment?.title || attachment?.filename || attachment?.name || '').trim();
}

function getFallbackApprovedSourcePath(submission: any): string | null {
    const candidates = [
        submission?.original_path,
        submission?.revision_baseline_doc_path,
        submission?.final_path,
    ];

    for (const candidate of candidates) {
        const filePath = `${candidate || ''}`.trim();
        if (filePath && fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return null;
}

type PropertySharePointConfig = {
    name: string;
    sharepoint_site_url?: string;
    sharepoint_library_name?: string;
    sharepoint_drive_id?: string;
    sharepoint_base_folder_path?: string;
    sharepoint_service_folders?: string[];
};

function parseSharePointSite(siteUrl: string): { hostname: string; sitePath: string } {
    const parsed = new URL(siteUrl);
    return {
        hostname: parsed.hostname,
        sitePath: parsed.pathname.replace(/\/+$/, ''),
    };
}

function encodeGraphPath(value: string): string {
    return value
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

async function getGraphAccessToken(): Promise<string> {
    if (!GRAPH_CLIENT_ID || !GRAPH_TENANT_ID || !GRAPH_CLIENT_SECRET) {
        throw new Error('Missing GRAPH_CLIENT_ID, GRAPH_TENANT_ID, or GRAPH_CLIENT_SECRET');
    }

    if (cachedGraphToken && cachedGraphToken.expiresAt > Date.now() + 60_000) {
        return cachedGraphToken.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id: GRAPH_CLIENT_ID,
        client_secret: GRAPH_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });

    const response = await axios.post(tokenUrl, body.toString(), {
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

async function graphRequest<T = any>(config: {
    method?: 'GET' | 'PUT' | 'POST' | 'PATCH';
    path: string;
    data?: any;
    headers?: Record<string, string>;
    responseType?: 'json' | 'arraybuffer';
}): Promise<T> {
    const token = await getGraphAccessToken();
    const response = await axios({
        method: config.method || 'GET',
        url: `https://graph.microsoft.com/v1.0${config.path}`,
        data: config.data,
        responseType: config.responseType || 'json',
        headers: {
            Authorization: `Bearer ${token}`,
            ...(config.headers || {}),
        },
    });
    return response.data as T;
}

function isDocxFileName(name: string | undefined): boolean {
    return String(name || '').trim().toLowerCase().endsWith('.docx');
}

function formatSharePointDateSegment(value: string | undefined): string {
    const candidate = `${value || ''}`.trim();
    const parsed = candidate ? new Date(candidate) : new Date();
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = String(date.getFullYear()).slice(-2);
    return `${month}.${day}.${year}`;
}

function sanitizeSharePointFilenameSegment(value: string | undefined): string {
    return String(value || '')
        .trim()
        .replace(/[\\/:*?"<>|#%]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildSharePointApprovedFilename(submission: any): string {
    const propertyLabel = sanitizeSharePointFilenameSegment(
        String(submission?.property || '').split(' - ')[0] || submission?.property || 'Menu'
    );
    const rawService = submission?.service_period || submission?.raw_payload?.servicePeriod || 'Other';
    const serviceLabel = sanitizeSharePointFilenameSegment(String(rawService).replace(/_/g, ' ')) || 'Other';
    const dateLabel = formatSharePointDateSegment(submission?.date_needed);
    return `${propertyLabel}_${serviceLabel}_${dateLabel}.docx`;
}

async function getPropertySharePointConfig(property: string): Promise<PropertySharePointConfig | null> {
    if (!property.trim()) return null;
    const response = await internalApi.get(`${DB_SERVICE_URL}/properties/validate`, {
        params: { name: property },
        timeout: 3000,
    });

    if (!response.data?.valid || !response.data?.property) {
        return null;
    }

    return response.data.property as PropertySharePointConfig;
}

async function resolveSharePointDrive(config: PropertySharePointConfig): Promise<{
    siteId: string;
    driveId: string;
}> {
    if (!config.sharepoint_site_url || !config.sharepoint_library_name) {
        throw new Error('Property is missing SharePoint site URL or library name');
    }

    const { hostname, sitePath } = parseSharePointSite(config.sharepoint_site_url);
    const site = await graphRequest<any>({
        path: `/sites/${hostname}:${sitePath}`,
    });

    if (config.sharepoint_drive_id) {
        return {
            siteId: site.id,
            driveId: config.sharepoint_drive_id,
        };
    }

    const drives = await graphRequest<any>({
        path: `/sites/${site.id}/drives`,
    });
    const drive = (drives.value || []).find((item: any) =>
        String(item?.name || '').trim().toLowerCase() === config.sharepoint_library_name!.trim().toLowerCase()
    );

    if (!drive?.id) {
        throw new Error(`SharePoint library "${config.sharepoint_library_name}" not found`);
    }

    return {
        siteId: site.id,
        driveId: drive.id,
    };
}

async function getDriveItemByPath(driveId: string, itemPath: string): Promise<any> {
    return graphRequest<any>({
        path: `/drives/${driveId}/root:/${encodeGraphPath(itemPath)}`,
    });
}

async function listDriveChildrenByPath(driveId: string, itemPath: string): Promise<any[]> {
    const response = await graphRequest<any>({
        path: `/drives/${driveId}/root:/${encodeGraphPath(itemPath)}:/children`,
    });
    return Array.isArray(response?.value) ? response.value : [];
}

async function ensureChildFolder(driveId: string, parentPath: string, folderName: string): Promise<any> {
    const existingChildren = await listDriveChildrenByPath(driveId, parentPath);
    const existing = existingChildren.find((item: any) =>
        !!item?.folder && String(item?.name || '').trim().toLowerCase() === folderName.trim().toLowerCase()
    );
    if (existing) return existing;

    const parentItem = await getDriveItemByPath(driveId, parentPath);
    return graphRequest<any>({
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

async function moveDriveItemToFolder(driveId: string, itemId: string, parentId: string, targetName: string): Promise<any> {
    try {
        return await graphRequest<any>({
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
    } catch (error: any) {
        const suffixedName = targetName.replace(/\.docx$/i, `_${Date.now()}.docx`);
        return graphRequest<any>({
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

async function archiveExistingDocxFilesInSharePointSubfolder(driveId: string, folderPath: string): Promise<number> {
    const children = await listDriveChildrenByPath(driveId, folderPath);
    const docxFiles = children.filter((item: any) =>
        !!item?.file && isDocxFileName(item?.name)
    );
    if (docxFiles.length === 0) return 0;

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

async function uploadApprovedDocToSharePoint(input: {
    property: string;
    servicePeriod?: string;
    localFilePath: string;
    uploadFileName: string;
    submission?: any;
}): Promise<{
    uploaded: boolean;
    skipped?: string;
    storagePath?: string;
    webUrl?: string;
    folderMatched?: string | null;
    driveId?: string;
    siteId?: string;
    archivedDocxCount?: number;
}> {
    if (!GRAPH_CLIENT_ID || !GRAPH_TENANT_ID || !GRAPH_CLIENT_SECRET) {
        return { uploaded: false, skipped: 'graph credentials not configured' };
    }

    const propertyConfig = await getPropertySharePointConfig(input.property);
    if (!propertyConfig?.sharepoint_site_url || !propertyConfig?.sharepoint_library_name || !propertyConfig?.sharepoint_base_folder_path) {
        return { uploaded: false, skipped: 'property has no sharepoint routing config' };
    }

    const serviceFolders = Array.isArray(propertyConfig.sharepoint_service_folders)
        ? propertyConfig.sharepoint_service_folders
        : [];
    const matchedFolder = serviceFolders.find((folder) =>
        normalizeFolderMatchKey(folder) === normalizeFolderMatchKey(input.servicePeriod)
    ) || null;

    const targetFolderPath = matchedFolder
        ? `${propertyConfig.sharepoint_base_folder_path}/${matchedFolder}`
        : propertyConfig.sharepoint_base_folder_path;
    const { siteId, driveId } = await resolveSharePointDrive(propertyConfig);
    let archivedDocxCount = 0;

    if (matchedFolder) {
        archivedDocxCount = await archiveExistingDocxFilesInSharePointSubfolder(driveId, targetFolderPath);
    }

    const canonicalFileName = buildSharePointApprovedFilename(input.submission || {
        property: input.property,
        service_period: input.servicePeriod,
    });
    const storagePath = `${targetFolderPath}/${canonicalFileName}`;
    const fileBuffer = await fs.promises.readFile(input.localFilePath);

    const uploadedItem = await graphRequest<any>({
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
    };
}

async function extractApprovedMenuContent(docxPath: string): Promise<{ raw: string; cleaned: string }> {
    const scriptPath = path.resolve(__dirname, '..', '..', 'docx-redliner', 'extract_clean_menu_text.py');
    const venvPython = path.resolve(__dirname, '..', '..', 'docx-redliner', 'venv', 'bin', 'python');

    let command = `"${venvPython}" "${scriptPath}" "${docxPath}"`;
    if (!fs.existsSync(venvPython)) {
        command = `python3 "${scriptPath}" "${docxPath}"`;
    }

    const { stdout } = await execAsync(command, { timeout: 30000 });
    const parsed = JSON.parse(stdout || '{}');
    return {
        raw: parsed.menu_content || '',
        cleaned: parsed.cleaned_menu_content || parsed.menu_content || '',
    };
}

async function extractApprovedDishesForSubmission(input: {
    submissionId: string;
    property?: string;
    servicePeriod?: string;
    approvedMenuContent?: string;
}): Promise<number> {
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

async function finalizeApprovedSubmission(input: {
    submission: any;
    approvedPath: string;
    approvedFileName: string;
    clickupTaskId?: string;
    attachmentId?: string | null;
    approvedAssetSource?: string;
    shouldUpdateClickupStatus?: boolean;
}): Promise<{
    processed: boolean;
    submissionId: string;
    clickupStatusUpdated: boolean;
    warnings: string[];
}> {
    const submission = input.submission;
    const clickupTaskId = `${input.clickupTaskId || submission?.clickup_task_id || ''}`.trim();
    const shouldUpdateClickupStatus = input.shouldUpdateClickupStatus !== false;
    const warnings: string[] = [];
    let extractedRaw = '';
    let extractedClean = '';

    try {
        const extracted = await extractApprovedMenuContent(input.approvedPath);
        extractedRaw = extracted.raw;
        extractedClean = extracted.cleaned;
    } catch (extractError: any) {
        console.warn(`Failed to extract approved text from approved DOCX: ${extractError.message}`);
    }

    await internalApi.put(
        `${DB_SERVICE_URL}/submissions/${submission.id}`,
        buildApprovedSubmissionUpdate({
            approvedPath: input.approvedPath,
            extractedRaw,
            extractedClean,
        })
    );
    console.log(`Updated submission ${submission.id} to approved`);

    internalApi.post(
        `${DB_SERVICE_URL}/assets`,
        buildApprovedDocxAssetRecord({
            submissionId: submission.id,
            approvedPath: input.approvedPath,
            source: input.approvedAssetSource || 'isabella_clickup',
            clickupTaskId,
            attachmentId: input.attachmentId || null,
        })
    ).catch((err: any) => console.error('Failed to save approved_docx asset metadata:', err.message));

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
            internalApi.post(
                `${DB_SERVICE_URL}/assets`,
                buildSharePointApprovedDocxAssetRecord({
                    submissionId: submission.id,
                    storagePath: sharePointUpload.storagePath,
                    approvedFileName: input.approvedFileName,
                    clickupTaskId,
                    siteId: sharePointUpload.siteId,
                    driveId: sharePointUpload.driveId,
                    webUrl: sharePointUpload.webUrl || null,
                    matchedFolder: sharePointUpload.folderMatched,
                    archivedDocxCount: sharePointUpload.archivedDocxCount || 0,
                })
            ).catch((err: any) => console.error('Failed to save SharePoint asset metadata:', err.message));
        } else if (sharePointUpload.uploaded) {
            console.warn(`SharePoint upload reported success for submission ${submission.id} without a storage path`);
        } else if (sharePointUpload.skipped) {
            console.log(`Skipped SharePoint upload for submission ${submission.id}: ${sharePointUpload.skipped}`);
        }
    } catch (sharePointError: any) {
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
        if (shouldUpdateClickupStatus) {
            try {
                await updateClickUpTaskStatus(clickupTaskId, CLICKUP_POST_APPROVAL_STATUS);
                console.log(`Moved ClickUp task ${clickupTaskId} to "${CLICKUP_POST_APPROVAL_STATUS}" after approval processing`);
            } catch (statusError: any) {
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
        } else {
            warnings.push(`Skipped ClickUp status update to "${CLICKUP_POST_APPROVAL_STATUS}" because the approved DOCX was not uploaded to the task.`);
        }
    }

    sendCorrectionsReadyNotification({
        submitterEmail: submission.submitter_email,
        submitterName: submission.submitter_name,
        projectName: submission.project_name,
        correctedPath: input.approvedPath,
        filename: input.approvedFileName,
    }).catch((err: any) => {
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
    }).catch((err: any) => console.error('Failed to trigger differ comparison:', err.message));

    try {
        await extractApprovedDishesForSubmission({
            submissionId: submission.id,
            property: submission.property,
            servicePeriod: submission.service_period || submission.raw_payload?.servicePeriod,
            approvedMenuContent: extractedClean || submission.approved_menu_content || submission.menu_content,
        });
    } catch (err: any) {
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
        warnings,
    };
}

async function processApprovedTask(clickupTaskId: string, opts?: { skipStatusCheck?: boolean }): Promise<{
    processed: boolean;
    reason?: string;
    submissionId?: string;
}> {
    const taskResponse = await axios.get(`https://api.clickup.com/api/v2/task/${clickupTaskId}`, {
        headers: clickupHeaders,
    });

    const currentStatus = normalizeStatus(taskResponse.data?.status?.status);
    if (!opts?.skipStatusCheck && currentStatus !== CLICKUP_CORRECTIONS_STATUS) {
        return { processed: false, reason: `task status is "${currentStatus}"` };
    }

    const subResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/by-clickup-task/${clickupTaskId}`);
    const submission = subResponse.data;
    console.log(`Found submission ${submission.id} for ClickUp task ${clickupTaskId}`);

    const attachments = taskResponse.data.attachments || [];
    const latestAttachment = pickMostRecentCorrectedAttachment(attachments, submission.filename);
    const submissionDocDir = getSubmissionDocumentDir(submission.project_name || '', submission.property || '', submission.id);
    const approvedDir = path.join(submissionDocDir, 'approved');
    await fs.promises.mkdir(approvedDir, { recursive: true });
    const approvedPath = path.join(approvedDir, `${submission.id}-approved.docx`);
    let approvedFileName = submission.filename || `${submission.project_name || submission.id}.docx`;

    if (latestAttachment?.url) {
        const fileResponse = await axios.get(latestAttachment.url, {
            responseType: 'arraybuffer',
            headers: { Authorization: CLICKUP_API_TOKEN || '' },
        });
        await fs.promises.writeFile(approvedPath, fileResponse.data);
        approvedFileName = getAttachmentFilename(latestAttachment) || approvedFileName;
        console.log(`Downloaded approved file from ClickUp to ${approvedPath}`);
    } else {
        const fallbackSourcePath = getFallbackApprovedSourcePath(submission);
        if (!fallbackSourcePath) {
            return { processed: false, reason: 'no usable ClickUp or local approved DOCX source found', submissionId: submission.id };
        }
        await fs.promises.copyFile(fallbackSourcePath, approvedPath);
        approvedFileName = path.basename(fallbackSourcePath) || approvedFileName;
        console.log(`Copied fallback approved file from ${fallbackSourcePath} to ${approvedPath}`);
    }

    return finalizeApprovedSubmission({
        submission,
        approvedPath,
        approvedFileName,
        clickupTaskId,
        attachmentId: latestAttachment?.id || null,
        approvedAssetSource: 'isabella_clickup',
    });
}

app.post('/create-task', async (req, res) => {
    try {
        if (!CLICKUP_API_TOKEN || !CLICKUP_LIST_ID) {
            console.log('ClickUp not configured, skipping task creation');
            return res.json({ skipped: true });
        }

        const {
            submissionId,
            submitterName,
            submitterEmail,
            submitterJobTitle,
            projectName,
            property,
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
            orientation,
            menuType,
            servicePeriod,
            templateType,
            turnaroundDays,
            dateNeeded,
            hotelName,
            cityCountry,
            assetType,
            docxPath,
            menuImagePath,
            menuImageFileName,
            filename,
            submissionMode,
            revisionSource,
            revisionBaseSubmissionId,
            revisionBaselineDocPath,
            revisionBaselineFileName,
            criticalOverrides,
            approvals,
        } = req.body;

        const overriddenCriticals = Array.isArray(criticalOverrides)
            ? criticalOverrides.filter((o: any) => !!o)
            : [];

        const overrideLines = overriddenCriticals.map((o: any, idx: number) => {
            const issueType = (o.type || 'Unknown').toString();
            const item = (o.menuItem || '').toString().trim();
            const desc = (o.description || '').toString().trim();
            return `${idx + 1}. [${issueType}] ${item || 'No item specified'}${desc ? ` - ${desc}` : ''}`;
        });

        const taskPayload: any = {
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
            status: CLICKUP_INITIAL_REVIEW_STATUS,
        };

        if (CLICKUP_ASSIGNEE_ID) {
            taskPayload.assignees = [parseInt(CLICKUP_ASSIGNEE_ID, 10)];
        }

        if (dateNeeded) {
            taskPayload.due_date = new Date(dateNeeded).getTime();
        }

        const taskResponse = await axios.post(
            `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`,
            taskPayload,
            { headers: clickupHeaders }
        );

        const taskId = taskResponse.data.id;
        console.log(`ClickUp task created: ${taskId}`);

        let attachmentUploadFailed = false;
        let baselineUploadFailed = false;
        const warnings: string[] = [];

        if (docxPath && fs.existsSync(docxPath)) {
            const uploadFilename = sanitizeAttachmentFilename(
                filename || projectName,
                submissionId || 'menu-submission'
            );
            try {
                await uploadTaskAttachment(
                    taskId,
                    docxPath,
                    uploadFilename,
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                );
                console.log(`DOCX attached to ClickUp task ${taskId}`);
            } catch (attachError: any) {
                attachmentUploadFailed = true;
                const errorDetail = attachError.response?.data?.err || attachError.message;
                warnings.push(`Primary DOCX upload failed: ${errorDetail}`);
                console.error(`Failed to attach DOCX to ClickUp task ${taskId}:`, errorDetail);
            }
        }

        if (revisionBaselineDocPath && fs.existsSync(revisionBaselineDocPath)) {
            try {
                await uploadTaskAttachment(
                    taskId,
                    revisionBaselineDocPath,
                    sanitizeAttachmentFilename(
                        revisionBaselineFileName || path.basename(revisionBaselineDocPath),
                        `${submissionId || 'menu-submission'}-baseline`
                    ),
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                );
                console.log(`Baseline approved DOCX attached to ClickUp task ${taskId}`);
            } catch (baselineError: any) {
                baselineUploadFailed = true;
                const errorDetail = baselineError.response?.data?.err || baselineError.message;
                warnings.push(`Baseline DOCX upload failed: ${errorDetail}`);
                console.error(`Failed to attach baseline DOCX to ClickUp task ${taskId}:`, errorDetail);
            }
        }

        if (menuImagePath && fs.existsSync(menuImagePath)) {
            try {
                const fallbackName = `${submissionId || 'menu-submission'}-menu-image`;
                const ext = path.extname(menuImageFileName || menuImagePath) || '.png';
                const safeName = sanitizeAttachmentFilename(menuImageFileName || path.basename(menuImagePath), fallbackName, ext);
                await uploadTaskAttachment(
                    taskId,
                    menuImagePath,
                    safeName,
                    'application/octet-stream'
                );
                console.log(`Menu image attached to ClickUp task ${taskId}`);
            } catch (imageError: any) {
                const errorDetail = imageError.response?.data?.err || imageError.message;
                warnings.push(`Menu image upload failed: ${errorDetail}`);
                console.error(`Failed to attach menu image to ClickUp task ${taskId}:`, errorDetail);
            }
        }

        if (submissionId) {
            await internalApi.put(`${DB_SERVICE_URL}/submissions/${submissionId}`, {
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
    } catch (error: any) {
        console.error('Error creating ClickUp task:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to create ClickUp task', details: error.message });
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

        if (!fs.existsSync(approvedPath)) {
            return res.status(400).json({ error: 'Approved DOCX file does not exist on disk' });
        }

        const subResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
        const submission = subResponse.data;
        if (!submission?.id) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        const clickupTaskId = `${submission.clickup_task_id || ''}`.trim();
        const approvedFileName = sanitizeAttachmentFilename(
            requestedFileName || submission.filename || path.basename(approvedPath),
            submission.id || 'approved-menu'
        );
        const warnings: string[] = [];
        let attachmentUploaded = false;
        let uploadedAttachmentId: string | null = null;
        const canUpdateClickupTask = !!(clickupTaskId && CLICKUP_API_TOKEN);

        if (canUpdateClickupTask) {
            try {
                const attachmentResponse = await uploadTaskAttachment(
                    clickupTaskId,
                    approvedPath,
                    approvedFileName,
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                );
                attachmentUploaded = true;
                uploadedAttachmentId = `${attachmentResponse?.id || attachmentResponse?.attachment?.id || ''}`.trim() || null;
                console.log(`Browser-approved DOCX attached to ClickUp task ${clickupTaskId}`);
            } catch (attachError: any) {
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
        } else if (!clickupTaskId) {
            warnings.push('No ClickUp task was linked to this submission; finalized locally only.');
        } else {
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
        });
        warnings.push(...(result.warnings || []));

        res.json({
            success: true,
            processed: result.processed,
            submissionId: result.submissionId,
            attachmentUploaded,
            clickupStatusUpdated: result.clickupStatusUpdated,
            warning: warnings.length ? warnings.join(' | ') : undefined,
        });
    } catch (error: any) {
        console.error('Error finalizing browser approval:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to finalize browser approval', details: error.message });
    }
});

app.post('/webhook/clickup', async (req: any, res) => {
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const signature = getClickUpSignatureHeader(req);
    if (!verifyClickUpSignature(rawBody, signature)) {
        console.warn('Rejected ClickUp webhook with invalid signature');
        return res.status(401).send('Invalid signature');
    }

    res.status(200).send('OK');

    try {
        const { event, task_id: clickupTaskId, history_items } = req.body;

        if (event !== 'taskStatusUpdated') return;

        const statusChange = history_items?.find((h: any) => h.field === 'status');
        const newStatus = (statusChange?.after?.status || '').toLowerCase();
        if (newStatus !== CLICKUP_CORRECTIONS_STATUS) return;

        console.log(`ClickUp task ${clickupTaskId} moved to "${newStatus}"`);
        const result = await processApprovedTask(String(clickupTaskId), { skipStatusCheck: true });
        if (!result.processed) {
            console.log(`Skipped ClickUp task ${clickupTaskId}: ${result.reason || 'not processed'}`);
        }
    } catch (error: any) {
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
        const candidates = pending.filter((s: any) => !!s.clickup_task_id);

        const summary = {
            scanned_pending: pending.length,
            candidates_with_clickup: candidates.length,
            processed: 0,
            skipped: 0,
            failed: 0,
            details: [] as Array<{ submission_id?: string; clickup_task_id: string; status: 'processed' | 'skipped' | 'failed'; reason?: string }>,
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
                } else {
                    summary.skipped += 1;
                    summary.details.push({
                        submission_id: submission.id,
                        clickup_task_id: taskId,
                        status: 'skipped',
                        reason: result.reason,
                    });
                }
            } catch (error: any) {
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
    } catch (error: any) {
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

        const response = await axios.post(
            `https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/webhook`,
            {
                endpoint: CLICKUP_WEBHOOK_URL,
                events: ['taskStatusUpdated'],
            },
            { headers: clickupHeaders }
        );

        console.log('ClickUp webhook registered:', response.data);
        if (response.data?.secret) {
            console.log('Set CLICKUP_WEBHOOK_SECRET in .env using the returned webhook secret.');
        }
        res.json({ success: true, webhook: response.data });
    } catch (error: any) {
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

export default app;

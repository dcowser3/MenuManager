import express from 'express';
import multer from 'multer';
import axios from 'axios';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

// Supabase client for dish extraction and alerting (optional - gracefully handles if not configured)
import {
    isSupabaseConfigured,
    extractAndStoreDishes,
    logAlert,
    buildAlertEmailHtml,
    SystemAlert
} from '@menumanager/supabase-client';
import nodemailer from 'nodemailer';
import {
    loadApprovalBaselineFromSubmission,
    resolveApprovalSourceDocument,
    textToParagraphHtml,
} from './lib/approval-baseline';
import {
    ALLOWED_DOCX_EXTENSIONS,
    ALLOWED_MENU_IMAGE_EXTENSIONS,
    ALLOWED_PDF_EXTENSIONS,
    MAX_LONG_TEXT_LENGTH,
    MAX_UPLOAD_BYTES,
    assertUploadedFileType,
    hasAllowedExtension,
    isClientInputError,
    resolveSafeStoredPath,
    sanitizePlainTextInput,
    sanitizeRichTextHtml,
    sanitizeStoredFileName,
} from './lib/upload-security';
import { createInternalApiClient } from '@menumanager/internal-auth';
import { createSubmissionWorkflowHandlers } from './lib/submission-workflow';
import { createApprovalWorkflowHandlers } from './lib/approval-workflow';
import { createDesignApprovalWorkflowHandlers } from './lib/design-approval-workflow';
import { getApprovedMenuDownload, listApprovedMenus } from './lib/approved-menus';
import {
    buildClickUpTaskPayloadFromStoredSubmission,
    describeServiceError,
    mergeClickUpHandoffMetadata,
    normalizeRawPayload,
} from './lib/clickup-handoff';
import {
    buildFallbackPropertyCatalog,
    normalizePropertyCatalogRecord,
    PropertyCatalogRecord,
} from './lib/property-catalog';
import { applyHighConfidenceSuggestionsToMenu } from './lib/apply-high-confidence-suggestions';

export {
    sanitizePlainTextInput,
    sanitizeRichTextHtml,
    sanitizeStoredFileName,
} from './lib/upload-security';

const execAsync = promisify(exec);
const DEFAULT_ALLERGEN_KEY = 'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan';
const RAW_NOTICE_TEXT = '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.';
const RAW_NOTICE_PATTERN = /\*?\s*consuming raw or undercooked meats,\s*poultry,\s*seafood(?:,\s*shellfish)?,\s*or eggs may increase your risk of foodborne illness\.?/i;
const DB_SERVICE_URL = process.env.DB_SERVICE_URL || 'http://localhost:3004';
const AI_REVIEW_URL = process.env.AI_REVIEW_URL || 'http://localhost:3002';
const DIFFER_SERVICE_URL = process.env.DIFFER_SERVICE_URL || 'http://localhost:3006';
const CLICKUP_SERVICE_URL = process.env.CLICKUP_SERVICE_URL || 'http://localhost:3007';
const ALERT_EMAIL = process.env.ALERT_EMAIL || '';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3005';
const internalApi = createInternalApiClient(axios);

// SMTP for admin alerts (reuses existing SMTP config)
const hasSmtpConfig = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const alertTransporter = hasSmtpConfig ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
} as any) : null;

// Alert dedup: 15-min cooldown per alert_type
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Send an admin alert: logs to Supabase + sends email (both fire-and-forget).
 * Deduplicates by alert_type with a 15-minute cooldown.
 */
function sendAdminAlert(alert: SystemAlert): void {
    const lastSent = alertCooldowns.get(alert.alert_type) || 0;
    if (Date.now() - lastSent < ALERT_COOLDOWN_MS) return;
    alertCooldowns.set(alert.alert_type, Date.now());

    // Log to Supabase
    logAlert(alert);

    // Send email
    if (alertTransporter && ALERT_EMAIL) {
        const severityLabel = alert.severity.toUpperCase();
        alertTransporter.sendMail({
            from: `"Menu Manager Alerts" <${process.env.SMTP_USER}>`,
            to: ALERT_EMAIL,
            subject: `[${severityLabel}] ${alert.alert_type.replace(/_/g, ' ')} — Menu Manager`,
            html: buildAlertEmailHtml(alert, DASHBOARD_URL),
        }).catch((err: any) => console.error('Failed to send alert email:', err.message));
    }
}

function getRepoRoot(): string {
    const candidates = [
        path.resolve(__dirname, '..', '..'),      // ts-node from services/dashboard
        path.resolve(__dirname, '..', '..', '..') // compiled from services/dashboard/dist
    ];

    for (const candidate of candidates) {
        if (
            fsSync.existsSync(path.join(candidate, 'package.json')) &&
            fsSync.existsSync(path.join(candidate, 'services', 'dashboard')) &&
            fsSync.existsSync(path.join(candidate, 'services', 'docx-redliner'))
        ) {
            return candidate;
        }
    }

    return candidates[0];
}

function getDocxRedlinerDir(): string {
    return path.join(getRepoRoot(), 'services', 'docx-redliner');
}

function getDocumentStorageRoot(): string {
    return process.env.DOCUMENT_STORAGE_ROOT || path.join(getRepoRoot(), 'tmp', 'documents');
}

function getTrainingStorageRoot(): string {
    return path.join(getRepoRoot(), 'tmp', 'training');
}

function getTempUploadsDir(): string {
    return path.join(getRepoRoot(), 'tmp', 'uploads');
}

function getStoredPathCandidates(candidatePath: string): string[] {
    const trimmed = `${candidatePath || ''}`.trim();
    if (!trimmed) {
        return [];
    }

    const candidates = new Set<string>();
    const resolved = path.resolve(
        trimmed.startsWith('../')
            ? path.resolve(__dirname, trimmed)
            : trimmed
    );
    candidates.add(resolved);

    if (trimmed.startsWith('/app/tmp/')) {
        candidates.add(path.join(getRepoRoot(), 'tmp', trimmed.slice('/app/tmp/'.length)));
    }

    return Array.from(candidates);
}

function resolveDashboardStoredPath(candidatePath: string, label: string, allowedExtensions?: Set<string>): string {
    let lastError: Error | null = null;

    for (const candidate of getStoredPathCandidates(candidatePath)) {
        try {
            return resolveSafeStoredPath(
                candidate,
                label,
                [getDocumentStorageRoot(), path.join(getRepoRoot(), 'tmp')],
                allowedExtensions
            );
        } catch (error: any) {
            lastError = error;
        }
    }

    throw lastError || new Error(`${label} path is unavailable`);
}

type ExtractedProjectDetails = {
    projectName: string;
    property: string;
    outlet: string;
    hotel: string;
    city: string;
    orientation: string;
    dateNeeded: string;
    size: string;
};

const EMPTY_EXTRACTED_PROJECT: ExtractedProjectDetails = {
    projectName: '',
    property: '',
    outlet: '',
    hotel: '',
    city: '',
    orientation: '',
    dateNeeded: '',
    size: '',
};

type MenuFooterMetadata = {
    body: string;
    normalizedAllergenLine: string;
    hadRawNotice: boolean;
    preservedFooterText: string;
};

function normalizeWhitespace(value: string): string {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function isLikelyAllergenLegendLine(line: string): boolean {
    const normalized = normalizeWhitespace(line);
    if (!normalized || !normalized.includes('|')) return false;
    const parts = normalized.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) return false;
    const codeParts = parts.filter((part) => /^\*?[A-Z]{1,3}\s+.+/.test(part));
    return codeParts.length >= Math.max(2, Math.floor(parts.length * 0.6));
}

function isLikelyRawNoticeLine(line: string): boolean {
    const normalized = normalizeWhitespace(line).toLowerCase();
    if (!normalized) return false;
    return normalized.includes('raw or undercooked') && normalized.includes('foodborne illness');
}

function parseParenthesizedAllergenLegend(line: string): string {
    const normalized = normalizeWhitespace(line);
    if (!normalized || !normalized.includes('(') || !normalized.includes(')')) return '';

    const footerBody = normalized.split(
        /\b(?:ALL\s+PRICES|WE\s+WELCOME|CONSUMPTION\s+OF\s+RAW|CONSUMING\s+RAW|FOODBORNE\s+ILLNESS)\b/i
    )[0];
    const pattern = /\(\s*([A-Za-z]{1,3})\s*\)\s*([A-Za-z][A-Za-z\s/&-]*?)(?=\s*\(\s*[A-Za-z]{1,3}\s*\)|$)/g;
    const pairs: Array<{ code: string; label: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(footerBody)) !== null) {
        const code = match[1].toUpperCase();
        const label = normalizeWhitespace(match[2]).toLowerCase();
        if (label) {
            pairs.push({ code, label });
        }
    }

    if (pairs.length < 4) return '';
    const keywordHits = pairs.filter(({ label }) =>
        /(allergen|gluten|dairy|fish|nuts?|egg|vegan|vegetarian|crustacean|soy|sesame|celery|mustard|shellfish|sulphites?|lupin)/i.test(label)
    ).length;
    if (keywordHits < 2) return '';

    return pairs.map(({ code, label }) => `${code} ${label}`).join(' | ');
}

function isLikelyAllergenLegendHeader(line: string): boolean {
    return /^allergen\s+key(?:\s+\(optional\))?$/i.test(normalizeWhitespace(line));
}

function extractAllergenLegendLine(line: string): string {
    if (isLikelyAllergenLegendLine(line)) {
        return normalizeAllergenLegend(line);
    }
    return parseParenthesizedAllergenLegend(line);
}

function normalizeAllergenLegend(text: string): string {
    const normalized = (text || '').trim();
    if (!normalized) return '';

    const lines = normalized
        .split('\n')
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean);

    if (lines.length === 1 && lines[0].includes('|')) {
        return lines[0]
            .split('|')
            .map((part) => normalizeWhitespace(part))
            .filter(Boolean)
            .join(' | ');
    }

    return lines.join(' | ');
}

function normalizeMenuFooter(text: string, fallbackAllergens = ''): MenuFooterMetadata {
    const lines = (text || '').split('\n').map((line) => line.trim());
    const menuLines: string[] = [];
    let allergenLines: string[] = [];
    const preservedFooterLines: string[] = [];
    let hadRawNotice = false;
    let inFooter = false;

    for (const line of lines) {
        const allergenLine = extractAllergenLegendLine(line);
        const isHeader = isLikelyAllergenLegendHeader(line);
        const isRawNotice = isLikelyRawNoticeLine(line);
        const isPriceFooter = /^all\s+prices\b/i.test(normalizeWhitespace(line));
        const isWelcomeFooter = /^we\s+welcome\s+enquiries\b/i.test(normalizeWhitespace(line));

        if (allergenLine || isHeader) {
            inFooter = true;
            if (allergenLine) allergenLines.push(allergenLine);
            continue;
        }

        if (isRawNotice) hadRawNotice = true;

        if (inFooter || isPriceFooter || isWelcomeFooter || isRawNotice) {
            if (line) preservedFooterLines.push(line);
            continue;
        }

        menuLines.push(line);
    }

    while (menuLines.length && menuLines[0] === '') menuLines.shift();
    while (menuLines.length && menuLines[menuLines.length - 1] === '') menuLines.pop();

    const collapsed: string[] = [];
    let prevEmpty = false;
    for (const line of menuLines) {
        if (!line) {
            if (!prevEmpty) collapsed.push('');
            prevEmpty = true;
        } else {
            collapsed.push(line);
            prevEmpty = false;
        }
    }

    const extractedAllergenLine = allergenLines.join(' | ');
    return {
        body: collapsed.join('\n'),
        normalizedAllergenLine: normalizeAllergenLegend(extractedAllergenLine || fallbackAllergens),
        hadRawNotice,
        preservedFooterText: preservedFooterLines.join('\n'),
    };
}

function decodeHtmlText(html: string): string {
    return (html || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/<[^>]+>/g, ' ');
}

function stripManagedFooterFromHtml(html: string): string {
    if (!html) return html;
    const regex = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
    let match: RegExpExecArray | null;
    let stripped = '';
    let lastIndex = 0;
    while ((match = regex.exec(html)) !== null) {
        const text = normalizeWhitespace(decodeHtmlText(match[0]));
        const isPriceFooter = /^all\s+prices\b/i.test(text);
        const isWelcomeFooter = /^we\s+welcome\s+enquiries\b/i.test(text);
        if (
            isLikelyAllergenLegendLine(text) ||
            parseParenthesizedAllergenLegend(text) ||
            isLikelyAllergenLegendHeader(text) ||
            isPriceFooter ||
            isWelcomeFooter ||
            isLikelyRawNoticeLine(text)
        ) {
            stripped += html.substring(lastIndex, match.index);
            lastIndex = regex.lastIndex;
        }
    }
    return stripped ? `${stripped}${html.substring(lastIndex)}` : html;
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

function coalesceString(...values: any[]): string {
    for (const value of values) {
        const normalized = `${value ?? ''}`.trim();
        if (normalized) return normalized;
    }
    return '';
}

function getSubmissionBoolean(submission: any, key: string, rawKey?: string): boolean {
    if (typeof submission?.[key] === 'boolean') return submission[key];
    const rawValue = submission?.raw_payload?.[rawKey || key];
    if (typeof rawValue === 'boolean') return rawValue;
    return `${rawValue || ''}`.toLowerCase() === 'true';
}

function escapeHtml(value: string): string {
    return `${value || ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function getPropertyCatalogFromDb(): Promise<PropertyCatalogRecord[]> {
    try {
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/properties`, { timeout: 3000 });
        const raw = Array.isArray(dbResponse?.data?.catalog) ? dbResponse.data.catalog : [];
        const catalog = raw
            .map((item: any) => normalizePropertyCatalogRecord(item))
            .filter((item: PropertyCatalogRecord) => !!item.name);
        if (catalog.length) return catalog;
        console.warn('DB property catalog was empty; using dashboard fallback catalog');
    } catch (error: any) {
        console.warn('Failed to load DB property catalog; using dashboard fallback catalog:', error?.message || error);
    }
    return buildFallbackPropertyCatalog();
}

function resolveCityCountryFromCatalog(property: string, catalog: PropertyCatalogRecord[]): string {
    const match = catalog.find((item) => item.name.toLowerCase() === property.toLowerCase());
    if (!match) return '';
    return match.city_country || '';
}

/**
 * Extract dishes from approved menu and store in database
 * Fails silently if Supabase is not configured
 */
async function extractDishesAfterApproval(
    submissionId: string,
    menuContent: string | undefined,
    property: string,
    finalPath: string,
    servicePeriod?: string
): Promise<void> {
    if (!isSupabaseConfigured()) {
        console.log('Supabase not configured - skipping dish extraction');
        return;
    }

    try {
        // If we don't have menu content, try to extract from the final document
        let content = menuContent;
        if (!content && finalPath) {
            try {
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ path: finalPath });
                content = result.value;
            } catch (err) {
                console.error('Failed to extract text from final document:', err);
                return;
            }
        }

        if (!content) {
            console.log('No menu content available for dish extraction');
            return;
        }

        const result = await extractAndStoreDishes(content, property, submissionId, {
            servicePeriod,
        });
        console.log(`Dish extraction complete: ${result.added} dishes added`);
    } catch (error) {
        console.error('Error extracting dishes:', error);
        // Don't throw - dish extraction is not critical to approval
    }
}

const app = express();
const port = 3005;

// Configure multer for file uploads
const upload = multer({
    dest: getTempUploadsDir(),
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 4,
    },
});

// Serve static files and use EJS for templates
app.get('/js/diff-core.js', (_req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(getRepoRoot(), 'services', 'diff-core', 'src', 'index.js'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

export async function extractBaselineFromDocx(filePath: string): Promise<{
    approvedMenuContent: string;
    approvedMenuContentRaw: string;
    approvedMenuContentHtml: string;
    extractedAllergenKey: string;
    containsRawNotice: boolean;
    extractedProject: ExtractedProjectDetails;
}> {
    const docxRedlinerDir = getDocxRedlinerDir();
    const venvPython = path.join(docxRedlinerDir, 'venv', 'bin', 'python');
    const extractCleanScript = path.join(docxRedlinerDir, 'extract_clean_menu_text.py');
    const extractDetailsScript = path.join(docxRedlinerDir, 'extract_project_details.py');

    let pythonCmd = 'python3';
    try {
        await fs.access(venvPython);
        pythonCmd = `"${venvPython}"`;
    } catch {
        // use system python
    }

    const cleanCommand = `${pythonCmd} "${extractCleanScript}" "${filePath}"`;
    const detailsCommand = `${pythonCmd} "${extractDetailsScript}" "${filePath}"`;

    const [{ stdout: cleanStdout }, detailsResult] = await Promise.all([
        execAsync(cleanCommand, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }),
        execAsync(detailsCommand, { timeout: 8000, maxBuffer: 2 * 1024 * 1024 })
            .then(({ stdout }) => ({ stdout }))
            .catch((error: any) => {
                console.warn('Project details extraction failed during baseline upload:', error?.stderr || error?.message || error);
                return { stdout: '{}' };
            }),
    ]);

    const cleanData = JSON.parse((cleanStdout || '{}').trim() || '{}');
    const detailsData = JSON.parse((detailsResult.stdout || '{}').trim() || '{}');

    if (cleanData.error) {
        throw new Error(cleanData.error);
    }

    const projectDetails = detailsData.project_details || {};
    const rawCleanedText = cleanData.cleaned_menu_content || cleanData.menu_content || '';
    const rawCleanedHtml = cleanData.cleaned_menu_html || '';
    const footer = normalizeMenuFooter(rawCleanedText, detailsData.allergen_key || '');
    const approvedMenuContent = [footer.body, footer.preservedFooterText].filter(Boolean).join('\n');
    return {
        approvedMenuContent,
        approvedMenuContentRaw: cleanData.menu_content || '',
        approvedMenuContentHtml: stripManagedFooterFromHtml(rawCleanedHtml),
        extractedAllergenKey: footer.normalizedAllergenLine || detailsData.allergen_key || '',
        containsRawNotice: footer.hadRawNotice,
        extractedProject: {
            projectName: projectDetails.project_name || '',
            property: projectDetails.property || '',
            outlet: projectDetails.outlet || '',
            hotel: projectDetails.hotel || '',
            city: projectDetails.city || '',
            orientation: projectDetails.orientation || '',
            dateNeeded: projectDetails.date_needed || '',
            size: projectDetails.size || '',
        },
    };
}

export async function extractUnapprovedFromDocx(filePath: string): Promise<{
    visibleText: string;
    cleanVisibleText: string;
    unapprovedHtml: string;
    annotations: Array<Array<{ start: number; end: number; type: string }>>;
    extractedAllergenKey: string;
    extractedProject: ExtractedProjectDetails;
}> {
    const docxRedlinerDir = getDocxRedlinerDir();
    const venvPython = path.join(docxRedlinerDir, 'venv', 'bin', 'python');
    const extractCleanScript = path.join(docxRedlinerDir, 'extract_clean_menu_text.py');
    const extractDetailsScript = path.join(docxRedlinerDir, 'extract_project_details.py');

    let pythonCmd = 'python3';
    try {
        await fs.access(venvPython);
        pythonCmd = `"${venvPython}"`;
    } catch {
        // use system python
    }

    const unapprovedCommand = `${pythonCmd} "${extractCleanScript}" "${filePath}" --mode unapproved`;
    const detailsCommand = `${pythonCmd} "${extractDetailsScript}" "${filePath}"`;

    const [{ stdout: unapprovedStdout }, detailsResult] = await Promise.all([
        execAsync(unapprovedCommand, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }),
        execAsync(detailsCommand, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
            .then(({ stdout }) => ({ stdout }))
            .catch((error: any) => {
                console.warn('Project details extraction failed during unapproved upload:', error?.stderr || error?.message || error);
                return { stdout: '{}' };
            }),
    ]);

    const unapprovedData = JSON.parse((unapprovedStdout || '{}').trim() || '{}');
    const detailsData = JSON.parse((detailsResult.stdout || '{}').trim() || '{}');

    if (unapprovedData.error) {
        throw new Error(unapprovedData.error);
    }

    const projectDetails = detailsData.project_details || {};
    return {
        visibleText: unapprovedData.visible_text || '',
        cleanVisibleText: unapprovedData.clean_visible_text || unapprovedData.visible_text || '',
        unapprovedHtml: unapprovedData.unapproved_html || '',
        annotations: unapprovedData.annotations || [],
        extractedAllergenKey: detailsData.allergen_key || '',
        extractedProject: {
            ...EMPTY_EXTRACTED_PROJECT,
            projectName: projectDetails.project_name || '',
            property: projectDetails.property || '',
            outlet: projectDetails.outlet || '',
            hotel: projectDetails.hotel || '',
            city: projectDetails.city || '',
            orientation: projectDetails.orientation || '',
            dateNeeded: projectDetails.date_needed || '',
            size: projectDetails.size || '',
        },
    };
}

/**
 * Dashboard Home - List all pending reviews
 */
app.get('/', (_req, res) => {
    res.render('welcome', {
        title: 'Welcome - RSH Menu Manager'
    });
});

/**
 * Welcome / Landing Page - Magic link entry point
 */
app.get('/submit/:token', (req, res) => {
    res.render('welcome', {
        title: 'Welcome - RSH Menu Manager'
    });
});

/**
 * Form Submission Page - New menu submission via form
 */
app.get('/form', async (_req, res) => {
    const propertyCatalog = await getPropertyCatalogFromDb();
    const propertyOptions = propertyCatalog.map((item) => item.name);
    res.render('form', {
        title: 'Submit New Menu',
        defaultAllergenKey: DEFAULT_ALLERGEN_KEY,
        propertyOptions,
        propertyCatalog,
    });
});

/**
 * Design Approval Page - Compare DOCX against PDF
 */
app.get('/design-approval', (req, res) => {
    res.render('design-approval', {
        title: 'Design Approval'
    });
});

app.get('/approved-menus', async (req, res) => {
    try {
        const q = sanitizePlainTextInput(req.query.q, { maxLength: 120 }).trim();
        const approvedMenus = await listApprovedMenus(getRepoRoot(), q, 150);

        res.render('approved-menus', {
            title: 'Approved Menus',
            approvedMenus,
            searchQuery: q,
        });
    } catch (error: any) {
        console.error('Error loading approved menus:', error.response?.data || error.message);
        res.status(500).render('error', {
            message: 'Failed to load approved menus',
        });
    }
});

/**
 * Review Detail Page - View specific submission
 */
app.get('/review/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        // Get submission details from DB
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).render('error', { 
                message: 'Submission not found' 
        });
        }

        const reviewableStatuses = new Set(['pending_human_review', 'submitted_no_ai_review']);
        if (!reviewableStatuses.has(submission.status)) {
            return res.render('error', { 
                message: 'This submission has already been reviewed' 
        });
        }

        const clickupHandoff = normalizeRawPayload(submission.raw_payload).clickup_handoff || {};
        res.render('review', { 
            submission,
            clickupHandoff,
            title: `Review: ${submission.filename}` 
        });
    } catch (error) {
        console.error('Error loading review:', error);
        res.status(500).render('error', { 
            message: 'Failed to load review details' 
        });
    }
});

app.post('/api/submissions/:submissionId/retry-clickup', async (req, res) => {
    const { submissionId } = req.params;
    try {
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        if (`${submission.clickup_task_id || ''}`.trim()) {
            return res.status(409).json({
                error: 'Submission already has a ClickUp task',
                taskId: submission.clickup_task_id,
            });
        }

        let assets: any[] = [];
        try {
            const assetResponse = await internalApi.get(`${DB_SERVICE_URL}/assets/by-submission/${encodeURIComponent(submission.id || submissionId)}`);
            assets = Array.isArray(assetResponse.data) ? assetResponse.data : [];
        } catch (assetError: any) {
            console.warn('Retry ClickUp could not load submission assets:', assetError.response?.data || assetError.message);
        }

        const clickupPayload = buildClickUpTaskPayloadFromStoredSubmission(submission, assets);
        if (!clickupPayload.docxPath) {
            return res.status(400).json({ error: 'Submission does not have an original DOCX path to send to ClickUp' });
        }

        const rawPayload = normalizeRawPayload(submission.raw_payload);
        const previousHandoff = normalizeRawPayload(rawPayload.clickup_handoff);
        const retryCount = Number(previousHandoff.retry_count || 0) + 1;
        const attemptedAt = new Date().toISOString();
        const retryRawPayload = mergeClickUpHandoffMetadata(rawPayload, {
            status: 'retrying',
            retry_count: retryCount,
            last_attempt_at: attemptedAt,
            last_payload: clickupPayload,
            triggered_by: 'dashboard_retry',
        });

        await internalApi.put(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submission.id || submissionId)}`, {
            raw_payload: retryRawPayload,
        });

        try {
            const clickupResponse = await internalApi.post(`${CLICKUP_SERVICE_URL}/create-task`, clickupPayload);
            const clickupData = clickupResponse.data || {};
            const taskId = clickupData.taskId;
            const completedRawPayload = mergeClickUpHandoffMetadata(retryRawPayload, {
                status: clickupData.skipped ? 'skipped_not_configured' : (clickupData.warning || clickupData.attachmentUploadFailed ? 'task_created_with_warning' : 'task_created'),
                retry_count: retryCount,
                task_id: taskId,
                last_response: clickupData,
                last_attempt_at: attemptedAt,
                last_payload: clickupPayload,
                triggered_by: 'dashboard_retry',
            });

            await internalApi.put(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submission.id || submissionId)}`, {
                raw_payload: completedRawPayload,
                ...(taskId ? { clickup_task_id: taskId } : {}),
            });

            return res.json({
                success: true,
                taskId,
                warning: clickupData.warning,
                attachmentUploadFailed: clickupData.attachmentUploadFailed,
                skipped: clickupData.skipped,
            });
        } catch (clickupError: any) {
            const errorDetails = describeServiceError(clickupError);
            const failedRawPayload = mergeClickUpHandoffMetadata(retryRawPayload, {
                status: 'failed',
                retry_count: retryCount,
                last_error: errorDetails,
                last_attempt_at: attemptedAt,
                last_payload: clickupPayload,
                triggered_by: 'dashboard_retry',
                diagnosticReference: submission.id || submissionId,
            });

            await internalApi.put(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submission.id || submissionId)}`, {
                raw_payload: failedRawPayload,
            }).catch((metadataError: any) => {
                console.error('Failed to save ClickUp retry failure metadata:', metadataError.response?.data || metadataError.message);
            });

            sendAdminAlert({
                alert_type: 'clickup_task_retry_failed',
                severity: 'error',
                service: 'dashboard',
                submission_id: submission.id || submissionId,
                message: `ClickUp task retry failed for "${submission.project_name}" (${submission.property})`,
                details: {
                    error: errorDetails,
                    submitter: submission.submitter_email,
                    projectName: submission.project_name,
                    property: submission.property,
                    filename: submission.filename,
                    diagnosticReference: submission.id || submissionId,
                },
            });

            return res.status(502).json({
                error: 'ClickUp task retry failed',
                details: errorDetails,
            });
        }
    } catch (error: any) {
        console.error('Error retrying ClickUp task creation:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to retry ClickUp task creation', details: error.message });
    }
});

app.get('/approval/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).render('error', {
                message: 'Submission not found'
            });
        }

        const baseline = await loadApprovalBaselineFromSubmission(submission, {
            extractApprovedFromDocx: extractBaselineFromDocx,
            extractUnapprovedFromDocx,
            resolveStoredPath: (storedPath) => resolveDashboardStoredPath(storedPath, 'Stored approval source document', ALLOWED_DOCX_EXTENSIONS),
        });
        const approvalUrl = `${DASHBOARD_URL.replace(/\/+$/, '')}/approval/${submission.id || submissionId}`;
        res.render('approval-editor', {
            title: `Approval Editor: ${submission.project_name || submission.filename || submissionId}`,
            submission,
            editorHtml: baseline.editorHtml,
            visibleText: baseline.visibleText,
            previewText: baseline.previewText,
            sourceMode: baseline.sourceMode,
            sourceLabel: baseline.sourceLabel,
            approvalUrl,
        });
    } catch (error: any) {
        console.error('Error loading approval editor:', error);
        res.status(500).render('error', {
            message: `Failed to load approval editor: ${error.message}`
        });
    }
});

/**
 * Download Original Submission
 */
app.get('/download/original/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${submissionId}`);
        const submission = dbResponse.data;

        if (!submission) {
            return res.status(404).send('File not found');
        }

        const sourceDoc = await resolveApprovalSourceDocument(submission, {
            resolveStoredPath: (storedPath) => resolveDashboardStoredPath(storedPath, 'Original submission', ALLOWED_DOCX_EXTENSIONS),
        });
        if (!sourceDoc) {
            return res.status(404).send('File not found');
        }

        console.log(`Downloading original from: ${sourceDoc.absolutePath}`);
        res.download(sourceDoc.absolutePath, sourceDoc.fileName || submission.filename || path.basename(sourceDoc.absolutePath));
    } catch (error) {
        console.error('Error downloading original:', error);
        res.status(500).send('Error downloading file');
    }
});

app.get('/download/approved/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const approvedMenu = await getApprovedMenuDownload(getRepoRoot(), submissionId);
        if (!approvedMenu) {
            return res.status(404).send('Approved file not found');
        }
        const candidatePaths = [approvedMenu.storagePath, approvedMenu.finalPath].filter(Boolean);
        let absolutePath = '';

        for (const candidatePath of candidatePaths) {
            try {
                const resolvedPath = resolveDashboardStoredPath(candidatePath, 'Approved submission', ALLOWED_DOCX_EXTENSIONS);
                await fs.access(resolvedPath);
                absolutePath = resolvedPath;
                break;
            } catch {
                // Try the next candidate path.
            }
        }

        if (!absolutePath) {
            return res.status(404).send('Approved file not found');
        }

        const downloadName = sanitizeStoredFileName(
            approvedMenu.approvedFileName || approvedMenu.filename || path.basename(absolutePath),
            'approved-menu.docx'
        );

        console.log(`Downloading approved file from: ${absolutePath}`);
        res.download(absolutePath, downloadName);
    } catch (error) {
        console.error('Error downloading approved file:', error);
        res.status(500).send('Error downloading file');
    }
});

const submissionWorkflowHandlers = createSubmissionWorkflowHandlers({
    axios: internalApi,
    fs,
    DB_SERVICE_URL,
    AI_REVIEW_URL,
    CLICKUP_SERVICE_URL,
    DEFAULT_ALLERGEN_KEY,
    INTERNAL_REVIEWER_EMAIL: process.env.INTERNAL_REVIEWER_EMAIL,
    getTempUploadsDir,
    getSubmissionDocumentDir,
    getPropertyCatalogFromDb,
    resolveCityCountryFromCatalog,
    normalizeMenuFooter,
    stripManagedFooterFromHtml,
    detectRawUndercookedContent,
    generateDocxFromForm,
    sendAdminAlert,
    isClientInputError,
});

const approvalWorkflowHandlers = createApprovalWorkflowHandlers({
    axios: internalApi,
    fs,
    pathModule: path,
    DB_SERVICE_URL,
    DIFFER_SERVICE_URL,
    CLICKUP_SERVICE_URL,
    DEFAULT_ALLERGEN_KEY,
    getSubmissionDocumentDir,
    extractDishesAfterApproval,
    coalesceString,
    normalizeMenuFooter,
    stripManagedFooterText,
    stripManagedFooterFromHtml,
    normalizeAllergenLegend,
    detectRawUndercookedContent,
    textToParagraphHtml,
    generateDocxFromForm,
});

const designApprovalWorkflowHandlers = createDesignApprovalWorkflowHandlers({
    axios: internalApi,
    fs,
    pathModule: path,
    execAsync,
    DB_SERVICE_URL,
    getDocxRedlinerDir,
    resolveStoredPath: resolveDashboardStoredPath,
    compareMenuTexts,
    extractDishesAfterApproval,
    isClientInputError,
});

/**
 * Quick Approve - AI draft is perfect, no changes needed
 */
app.post('/approve/:submissionId', approvalWorkflowHandlers.quickApprove);

/**
 * Upload Corrected Version - Reviewer made additional corrections
 */
app.post('/upload/:submissionId', upload.single('finalDocument') as any, approvalWorkflowHandlers.uploadCorrectedVersion);

/**
 * API endpoint to get submission status (for AJAX polling)
 */
app.get('/api/submission/:submissionId/status', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/${submissionId}`);
        res.json(dbResponse.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get status' });
    }
});

/**
 * Training Dashboard - Manage training data and sessions
 */
app.get('/training', async (req, res) => {
    try {
        // Read training sessions from tmp/training directory
        const trainingDir = getTrainingStorageRoot();
        await fs.mkdir(trainingDir, { recursive: true });

        const files = await fs.readdir(trainingDir);
        const sessionFiles = files.filter(f => f.startsWith('session_') && f.endsWith('.json'));

        const sessions = await Promise.all(
            sessionFiles.map(async (file) => {
                const content = await fs.readFile(path.join(trainingDir, file), 'utf-8');
                return JSON.parse(content);
        })
        );

        // Sort by session ID (timestamp) descending
        sessions.sort((a, b) => b.session_id.localeCompare(a.session_id));

        res.render('training', {
            title: 'Training Dashboard',
            sessions: sessions
        });
    } catch (error) {
        console.error('Error loading training dashboard:', error);
        res.status(500).render('error', {
            message: 'Failed to load training dashboard'
        });
    }
});

/**
 * Upload Training Pair - Add new document pair for training
 */
app.post('/training/upload-pair', upload.fields([
    { name: 'original', maxCount: 1 },
    { name: 'redlined', maxCount: 1 }
]) as any, async (req, res) => {
    try {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        
        if (!files.original || !files.redlined) {
            return res.status(400).json({ 
                error: 'Both original and redlined documents are required' 
        });
        }

        const originalFile = files.original[0];
        const redlinedFile = files.redlined[0];
        await assertUploadedFileType(originalFile.path, ['docx']);
        await assertUploadedFileType(redlinedFile.path, ['docx']);

        // Create pairs directory if it doesn't exist
        const pairsDir = path.join(getTrainingStorageRoot(), 'pairs');
        await fs.mkdir(pairsDir, { recursive: true });

        // Generate pair name
        const timestamp = Date.now();
        const pairName = sanitizeStoredFileName(req.body.pairName || `pair_${timestamp}`, `pair_${timestamp}`);

        // Move files to pairs directory with standard naming
        const originalDest = path.join(pairsDir, `${pairName}_original.docx`);
        const redlinedDest = path.join(pairsDir, `${pairName}_redlined.docx`);

        await fs.rename(originalFile.path, originalDest);
        await fs.rename(redlinedFile.path, redlinedDest);

        console.log(`Training pair added: ${pairName}`);

        res.json({
            success: true,
            message: 'Training pair uploaded successfully',
            pairName: pairName
        });

    } catch (error) {
        console.error('Error uploading training pair:', error);
        res.status(500).json({ error: 'Failed to upload training pair' });
    }
});

/**
 * Get Training Session Details
 */
app.get('/training/session/:sessionId', async (req, res) => {
    try {
        const sessionId = sanitizePlainTextInput(req.params.sessionId, { maxLength: 64 });
        if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
            return res.status(400).json({ error: 'Invalid session ID' });
        }
        const trainingDir = getTrainingStorageRoot();
        const sessionFile = path.join(trainingDir, `session_${sessionId}.json`);

        const content = await fs.readFile(sessionFile, 'utf-8');
        const session = JSON.parse(content);

        res.json(session);
    } catch (error) {
        console.error('Error loading session:', error);
        res.status(404).json({ error: 'Session not found' });
    }
});

/**
 * Download Training Rules
 */
app.get('/training/download-rules/:sessionId', async (req, res) => {
    try {
        const sessionId = sanitizePlainTextInput(req.params.sessionId, { maxLength: 64 });
        if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
            return res.status(400).send('Invalid session ID');
        }
        const trainingDir = getTrainingStorageRoot();
        const rulesFile = path.join(trainingDir, `learned_rules_${sessionId}.json`);

        res.download(rulesFile, `learned_rules_${sessionId}.json`);
    } catch (error) {
        console.error('Error downloading rules:', error);
        res.status(404).send('Rules file not found');
    }
});

/**
 * Download Optimized Prompt
 */
app.get('/training/download-prompt/:sessionId', async (req, res) => {
    try {
        const sessionId = sanitizePlainTextInput(req.params.sessionId, { maxLength: 64 });
        if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
            return res.status(400).send('Invalid session ID');
        }
        const trainingDir = getTrainingStorageRoot();
        const promptFile = path.join(trainingDir, `optimized_prompt_${sessionId}.txt`);

        res.download(promptFile, `optimized_prompt_${sessionId}.txt`);
    } catch (error) {
        console.error('Error downloading prompt:', error);
        res.status(404).send('Prompt file not found');
    }
});

/**
 * Learning Rules Dashboard
 */
app.get('/learning', async (_req, res) => {
    try {
        const [rulesResult, trainingResult, submissionsResult, correctionRulesResult, propertiesResult] = await Promise.all([
            internalApi.get(`${DIFFER_SERVICE_URL}/learning/rules`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: {}, error: e?.message || 'request failed' })),
            internalApi.get(`${DIFFER_SERVICE_URL}/training-data`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: { count: 0, data: [] }, error: e?.message || 'request failed' })),
            internalApi.get(`${DIFFER_SERVICE_URL}/learning/submissions`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: { submissions: [] }, error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/correction-rules`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: [], error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/properties`, { timeout: 2500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: { properties: [] }, error: e?.message || 'request failed' })),
        ]);

        const rulesData = (rulesResult as any).data || {};
        const trainingData = (trainingResult as any).data || { count: 0, data: [] };
        const learningSubmissions = (submissionsResult as any).data?.submissions || [];
        const correctionRules: any[] = (correctionRulesResult as any).data || [];
        const propertyOptions: string[] = (propertiesResult as any).data?.properties || [];
        const qaPromptPath = path.join(getRepoRoot(), 'sop-processor', 'qa_prompt.txt');
        const basePrompt = await fs.readFile(qaPromptPath, 'utf-8');

        // v2: detected patterns from differ (read-only reference, not auto-injected)
        const decorate = (category: string, items: any[]) =>
            (items || []).map((r: any) => ({
                ...r,
                key: `${r.source_norm}=>${r.target_norm}`,
                category,
            }));

        const detectedPatterns = [
            ...decorate('active', rulesData.active_rules || []),
            ...decorate('weak', rulesData.weak_rules || []),
            ...decorate('conflicted', rulesData.conflicted_rules || []),
        ];
        const recentSubmissions = (trainingData.data || []).slice(-25).reverse();

        // Split correction rules by status for the dashboard
        const pendingRules = correctionRules.filter((r: any) => r.status === 'pending');
        const acceptedRules = correctionRules.filter((r: any) => r.status === 'accepted');

        const differStatus = {
            rulesOk: !!(rulesResult as any).ok,
            trainingOk: !!(trainingResult as any).ok,
            submissionsOk: !!(submissionsResult as any).ok,
            rulesError: (rulesResult as any).error || '',
            trainingError: (trainingResult as any).error || '',
            submissionsError: (submissionsResult as any).error || '',
        };

        res.render('learning', {
            title: 'Learning Rules',
            generatedAt: rulesData.generated_at || null,
            minOccurrences: rulesData.min_occurrences || 2,
            totalEntries: rulesData.total_entries_analyzed || 0,
            totalRules: rulesData.total_rules || 0,
            detectedPatterns,
            pendingRules,
            acceptedRules,
            recentSubmissions,
            learningSubmissions,
            propertyOptions,
            differStatus,
            basePrompt,
            documentStorageRoot: process.env.DOCUMENT_STORAGE_ROOT || '',
        });
    } catch (error: any) {
        console.error('Error loading learning dashboard:', error.message);
        res.status(500).render('error', {
            message: 'Failed to load learning dashboard'
        });
    }
});

app.get('/learning/submission/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const [learningDetailResult, submissionResult, correctionRulesResult, propertiesResult] = await Promise.all([
            internalApi.get(`${DIFFER_SERVICE_URL}/learning/submissions/${encodeURIComponent(submissionId)}`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: null, error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/submissions/${encodeURIComponent(submissionId)}`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: null, error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/correction-rules?submission_id=${encodeURIComponent(submissionId)}`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: [], error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/properties`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: { properties: [] }, error: e?.message || 'request failed' })),
        ]);

        if (!(learningDetailResult as any).ok || !(learningDetailResult as any).data) {
            return res.status(404).render('error', { message: 'Learning details not found for this submission' });
        }

        const learningDetail = (learningDetailResult as any).data;
        const submissionMeta = (submissionResult as any).data || {};
        const savedCorrectionRules: any[] = (correctionRulesResult as any).data || [];
        const locationOptions: string[] = (propertiesResult as any).data?.properties || [];

        res.render('learning-submission', {
            title: `Learning Review: ${submissionId}`,
            submissionId,
            learningDetail,
            submissionMeta,
            savedCorrectionRules,
            locationOptions,
        });
    } catch (error: any) {
        console.error('Error loading learning submission detail page:', error.message);
        res.status(500).render('error', {
            message: 'Failed to load learning submission details'
        });
    }
});

/**
 * Correction rules: create (human-annotated or accept system proposal)
 */
app.post('/api/learning/correction-rules', async (req, res) => {
    try {
        const payload = req.body || {};
        const catalog = await getPropertyCatalogFromDb();
        const propertyNames = new Set(catalog.map((item) => item.name.toLowerCase()));
        const location = `${payload.location || ''}`.trim();

        if (location && !propertyNames.has(location.toLowerCase())) {
            return res.status(400).json({ error: 'location must be one of the configured properties' });
        }

        const otherLocations = Array.isArray(payload.other_applicable_locations)
            ? payload.other_applicable_locations.map((s: any) => `${s || ''}`.trim()).filter(Boolean)
            : [];

        const record = {
            submission_id: `${payload.submission_id || ''}`.trim(),
            correction_id: `${payload.correction_id || ''}`.trim(),
            original_text: `${payload.original_text || payload.before_line || ''}`.trim(),
            corrected_text: `${payload.corrected_text || payload.after_line || ''}`.trim(),
            change_type: `${payload.change_type || ''}`.trim() || null,
            rule: `${payload.rule || ''}`.trim(),
            is_location_specific: !!payload.is_location_specific,
            project_name: `${payload.project_name || ''}`.trim() || null,
            restaurant_name: `${payload.restaurant_name || ''}`.trim(),
            location: location || 'All properties (global rule)',
            other_applicable_locations: otherLocations,
            reviewer_name: `${payload.reviewer_name || ''}`.trim() || null,
            source: payload.source || 'human',
            status: payload.source === 'system' ? 'pending' : 'accepted',
        };

        if (!record.submission_id || !record.correction_id || !record.original_text || !record.corrected_text || !record.rule) {
            return res.status(400).json({ error: 'submission_id, correction_id, original_text, corrected_text, and rule are required' });
        }

        const response = await internalApi.post(`${DB_SERVICE_URL}/correction-rules`, record, { timeout: 3000 });
        res.json(response.data);
    } catch (error: any) {
        console.error('Error saving correction rule:', error.message);
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to save correction rule' });
    }
});

/**
 * Correction rules: update status (accept/reject/modify)
 */
app.put('/api/learning/correction-rules/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const response = await internalApi.put(`${DB_SERVICE_URL}/correction-rules/${encodeURIComponent(id)}`, req.body || {}, { timeout: 3000 });
        res.json(response.data);
    } catch (error: any) {
        console.error('Error updating correction rule:', error.message);
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to update correction rule' });
    }
});

/**
 * Learning submissions: delete one differ training entry and its comparison detail.
 */
app.delete('/api/learning/submissions/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const response = await internalApi.delete(`${DIFFER_SERVICE_URL}/learning/submissions/${encodeURIComponent(submissionId)}`, { timeout: 3500 });
        res.json(response.data);
    } catch (error: any) {
        console.error('Error deleting learning submission:', error.message);
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to delete learning submission' });
    }
});

/**
 * Prompt Proposal review page
 */
app.get('/learning/prompt-proposal', async (_req, res) => {
    try {
        const [proposalResult, historyResult] = await Promise.all([
            internalApi.get(`${DB_SERVICE_URL}/prompt-proposals/latest`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: null, error: e?.message || 'request failed' })),
            internalApi.get(`${DB_SERVICE_URL}/prompt-proposals`, { timeout: 3500 })
                .then((r: any) => ({ ok: true, data: r.data, error: '' }))
                .catch((e: any) => ({ ok: false, data: [], error: e?.message || 'request failed' })),
        ]);

        const proposal = (proposalResult as any).data;
        const history: any[] = (historyResult as any).data || [];

        res.render('prompt-proposal', {
            title: 'Prompt Proposal Review',
            proposal,
            history,
        });
    } catch (error: any) {
        console.error('Error loading prompt proposal page:', error.message);
        res.status(500).render('error', { message: 'Failed to load prompt proposal page' });
    }
});

/**
 * Approve or reject a prompt proposal
 */
app.post('/api/learning/prompt-proposal/:id/review', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reviewer_name, reviewer_notes, final_prompt } = req.body || {};

        if (!status || !['approved', 'approved_modified', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'status must be approved, approved_modified, or rejected' });
        }

        // Update proposal status
        const response = await internalApi.put(`${DB_SERVICE_URL}/prompt-proposals/${encodeURIComponent(id)}`, {
            status,
            reviewer_name: reviewer_name || null,
            reviewer_notes: reviewer_notes || null,
            final_prompt: final_prompt || null,
            reviewed_at: new Date().toISOString(),
        }, { timeout: 5000 });

        // If approved, write the new prompt to qa_prompt.txt
        if (status === 'approved' || status === 'approved_modified') {
            const promptToWrite = final_prompt || response.data?.proposed_prompt;
            if (promptToWrite) {
                const qaPromptPath = path.join(getRepoRoot(), 'sop-processor', 'qa_prompt.txt');
                await fs.writeFile(qaPromptPath, promptToWrite, 'utf-8');
                console.log(`Base prompt updated from proposal ${id} (status: ${status})`);
            }
        }

        res.json({ success: true, proposal: response.data });
    } catch (error: any) {
        console.error('Error reviewing prompt proposal:', error.message);
        res.status(500).json({ error: 'Failed to review prompt proposal' });
    }
});

/**
 * System Alerts page
 */
app.get('/alerts', async (_req, res) => {
    try {
        let alerts: any[] = [];
        if (isSupabaseConfigured()) {
            const supabase = (await import('@menumanager/supabase-client')).getSupabaseClient();
            const { data, error } = await supabase
                .from('system_alerts')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);
            if (!error && data) alerts = data;
        }
        res.render('alerts', { title: 'System Alerts', alerts });
    } catch (error: any) {
        console.error('Error loading alerts page:', error.message);
        res.status(500).render('error', { message: 'Failed to load alerts page' });
    }
});

app.put('/api/alerts/:id/acknowledge', async (req, res) => {
    try {
        const { id } = req.params;
        const { acknowledged_by } = req.body || {};
        if (!isSupabaseConfigured()) {
            return res.status(503).json({ error: 'Supabase not configured' });
        }
        const supabase = (await import('@menumanager/supabase-client')).getSupabaseClient();
        const { error } = await supabase
            .from('system_alerts')
            .update({
                acknowledged: true,
                acknowledged_by: acknowledged_by || 'admin',
                acknowledged_at: new Date().toISOString(),
            })
            .eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/learning/location-rules', async (req, res) => {
    try {
        const payload = req.body || {};
        const catalog = await getPropertyCatalogFromDb();
        const propertyNames = new Set(catalog.map((item) => item.name.toLowerCase()));
        const location = `${payload.location || ''}`.trim();
        const sharedLocations = Array.isArray(payload.shared_locations)
            ? payload.shared_locations.map((item: any) => `${item || ''}`.trim()).filter((item: string) => !!item)
            : [];

        if (!location || !propertyNames.has(location.toLowerCase())) {
            return res.status(400).json({ error: 'location must be one of the configured properties' });
        }
        const invalidShared = sharedLocations.find((item: string) => !propertyNames.has(item.toLowerCase()));
        if (invalidShared) {
            return res.status(400).json({ error: `shared location "${invalidShared}" is not in configured properties` });
        }

        const response = await internalApi.post(`${DIFFER_SERVICE_URL}/learning/location-rules`, {
            ...payload,
            location,
            shared_locations: sharedLocations,
        }, { timeout: 3000 });
        res.json(response.data);
    } catch (error: any) {
        console.error('Error saving location-specific rule:', error.message);
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to save location-specific rule' });
    }
});

/**
 * Proxy: Submitter profile search
 */
app.get('/api/submitter-profiles/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submitter-profiles/search`, {
            params: { q }
        });
        res.json(dbResponse.data);
    } catch (error) {
        res.json([]);
    }
});

/**
 * Proxy: Recent projects
 */
app.get('/api/recent-projects', async (req, res) => {
    try {
        const limit = req.query.limit || 20;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/recent-projects`, {
            params: { limit }
        });
        res.json(dbResponse.data);
    } catch (error) {
        res.json([]);
    }
});

/**
 * Proxy: Canonical properties catalog
 */
app.get('/api/properties', async (_req, res) => {
    const catalog = await getPropertyCatalogFromDb();
    res.json({
        properties: catalog.map((item) => item.name),
        catalog,
    });
});

/**
 * Proxy: Search approved submissions for modification flow
 */
app.get('/api/submissions/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        const limit = req.query.limit || 20;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/search`, {
            params: { q, limit }
        });
        res.json(dbResponse.data);
    } catch (error: any) {
        console.error('Failed to search approved submissions:', error?.response?.data || error.message);
        res.status(error?.response?.status || 500).json({
            error: 'Failed to search approved submissions'
        });
    }
});

/**
 * Proxy: Get latest approved submission for a project/property pair
 */
app.get('/api/submissions/latest-approved', async (req, res) => {
    try {
        const { projectName, property } = req.query;
        const dbResponse = await internalApi.get(`${DB_SERVICE_URL}/submissions/latest-approved`, {
            params: { projectName, property }
        });
        res.json(dbResponse.data);
    } catch (error: any) {
        res.status(error?.response?.status || 500).json(error?.response?.data || { error: 'Failed to fetch approved submission' });
    }
});

/**
 * Modification Flow: Upload approved baseline DOCX when no prior record exists in DB.
 * Extracts cleaned menu text + project details to prefill the form.
 */
app.post('/api/modification/baseline-upload', upload.single('baselineDoc') as any, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No baseline document uploaded' });
        }

        if (!hasAllowedExtension(req.file.originalname || req.file.path, ALLOWED_DOCX_EXTENSIONS)) {
            return res.status(400).json({ error: 'Only .docx files are accepted' });
        }
        await assertUploadedFileType(req.file.path, ['docx']);

        const extracted = await extractBaselineFromDocx(req.file.path);
        res.json({
            success: true,
            baselineDocPath: req.file.path,
            baselineFileName: sanitizeStoredFileName(req.file.originalname, 'baseline.docx'),
            approvedMenuContent: extracted.approvedMenuContent,
            approvedMenuContentRaw: extracted.approvedMenuContentRaw,
            approvedMenuContentHtml: extracted.approvedMenuContentHtml,
            extractedAllergenKey: extracted.extractedAllergenKey,
            containsRawNotice: extracted.containsRawNotice,
            extractedProject: extracted.extractedProject,
        });
    } catch (error: any) {
        console.error('Error extracting baseline document:', error);
        res.status(isClientInputError(error) ? 400 : 500).json({ error: 'Failed to process baseline document', details: error.message });
    }
});

/**
 * Modification Flow: Upload unapproved DOCX — preserves existing redlines/highlights.
 * Returns visible text (including deletions), HTML with existing-del/existing-ins spans,
 * and per-paragraph annotation ranges for the persistent preview.
 */
app.post('/api/modification/unapproved-upload', upload.single('baselineDoc') as any, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No document uploaded' });
        }

        if (!hasAllowedExtension(req.file.originalname || req.file.path, ALLOWED_DOCX_EXTENSIONS)) {
            return res.status(400).json({ error: 'Only .docx files are accepted' });
        }
        await assertUploadedFileType(req.file.path, ['docx']);

        const extracted = await extractUnapprovedFromDocx(req.file.path);
        res.json({
            success: true,
            baselineDocPath: req.file.path,
            baselineFileName: sanitizeStoredFileName(req.file.originalname, 'baseline.docx'),
            visibleText: extracted.visibleText,
            cleanVisibleText: extracted.cleanVisibleText,
            unapprovedHtml: extracted.unapprovedHtml,
            annotations: extracted.annotations,
            extractedAllergenKey: extracted.extractedAllergenKey,
            extractedProject: extracted.extractedProject,
        });
    } catch (error: any) {
        console.error('Error extracting unapproved document:', error);
        res.status(isClientInputError(error) ? 400 : 500).json({ error: 'Failed to process unapproved document', details: error.message });
    }
});

/**
 * Form API: Basic AI Check - Run QA check on menu content
 */
app.post('/api/form/basic-check', async (req, res) => {
    try {
        const menuContent = sanitizePlainTextInput(req.body?.menuContent, { multiline: true, maxLength: MAX_LONG_TEXT_LENGTH });
        const allergens = sanitizePlainTextInput(req.body?.allergens, { multiline: true, maxLength: 2000 });
        const menuType = sanitizePlainTextInput(req.body?.menuType, { maxLength: 64 });
        const baselineMenuContent = sanitizePlainTextInput(req.body?.baselineMenuContent, { multiline: true, maxLength: MAX_LONG_TEXT_LENGTH });
        const reviewMode = sanitizePlainTextInput(req.body?.reviewMode, { maxLength: 64 });

        if (!menuContent || !menuContent.trim()) {
            return res.status(400).json({ error: 'Menu content is required' });
        }

        const changedOnlyMode = reviewMode === 'changed_only' && !!baselineMenuContent;
        let textForReview = menuContent;
        let changedLineCount = 0;

        if (changedOnlyMode) {
            const changedOnlyText = extractChangedLinesForReview(baselineMenuContent, menuContent);
            changedLineCount = changedOnlyText.changedLineCount;

            if (changedLineCount === 0) {
                return res.json({
                    success: true,
                    originalMenu: menuContent,
                    correctedMenu: menuContent,
                    suggestions: [],
                    hasChanges: false,
                    hasCriticalErrors: false,
                    reviewMode: 'changed_only',
                    changedLineCount: 0
                });
            }

            textForReview = changedOnlyText.text;
        }

        const reviewFooterMetadata = normalizeMenuFooter(textForReview, allergens || '');
        const sanitizedMenuContent = normalizeMenuFooter(menuContent, allergens || '');

        // Debug logging
        console.log('=== BASIC CHECK REQUEST ===');
        console.log('Menu content length:', menuContent.length);
        console.log('First 200 chars:', menuContent.substring(0, 200));
        console.log('Menu type:', menuType || 'standard');
        console.log('Custom allergens:', allergens ? 'Yes' : 'No (using defaults)');
        console.log('===========================');

        // Load QA prompt
        const qaPromptPath = path.join(getRepoRoot(), 'sop-processor', 'qa_prompt.txt');
        let qaPrompt = await fs.readFile(qaPromptPath, 'utf-8');

        // If prix fixe menu type, inject special rules
        if (menuType === 'prix_fixe') {
            const prixFixeSection = `
**PRIX FIXE / PRE-FIX MENU RULES:**
This is a PRIX FIXE (pre-fix) menu. Apply these special rules:

1. **PRICING STRUCTURE**: Prix fixe menus should have:
   - A single prix fixe price at the TOP of the menu (format: 00.00PP, 00.00pp, or just a whole number)
   - Treat PP/pp as "per person" and count prices like "50.00pp" as valid top-level prices
   - Optional wine/alcohol pairing price listed alongside (e.g., "185 | 85 wine pairing")
   - Individual dishes do NOT need their own prices - this is CORRECT for prix fixe menus
   - Do NOT flag missing prices on individual courses/dishes

2. **COURSE NUMBERING**: Prix fixe menus MUST have numbered courses:
   - Each course should be preceded by its course number (1, 2, 3, etc.)
   - Numbers can be on their own line above the course name
   - Example format:
     1
     First Course
     dish name, description

     2
     Second Course
     dish name, description
   - FLAG if course numbers are missing

3. **COURSE STRUCTURE**: Look for proper course progression:
   - Courses should flow logically (appetizer → main → dessert, or similar)
   - Each course section should have clear separation

4. **WHAT TO CHECK**:
   - Prix fixe price present at top (FLAG if missing)
   - Course numbers present (FLAG if missing)
   - All other standard rules still apply (spelling, accents, allergens, etc.)

5. **WHAT NOT TO FLAG**:
   - Missing prices on individual dishes (this is normal for prix fixe)
   - Individual items without their own pricing
   - Do NOT set severity to "critical" for missing individual dish prices on prix fixe menus
`;
            // Insert at the beginning of the rules section
            qaPrompt = qaPrompt.replace(
                '## RSH MENU GUIDELINES - COMPREHENSIVE RULES',
                `## RSH MENU GUIDELINES - COMPREHENSIVE RULES\n${prixFixeSection}`
            );
            console.log('Injected prix fixe rules into prompt');
        }

        const effectiveReviewAllergens = allergens || reviewFooterMetadata.normalizedAllergenLine;

        // If custom or extracted allergens are provided, inject them into the prompt
        if (effectiveReviewAllergens && effectiveReviewAllergens.trim()) {
            const allergenSection = `
**CUSTOM ALLERGEN KEY FOR THIS MENU:**
Use the following allergen codes for reviewing this menu:
${effectiveReviewAllergens}

Note: Use ONLY these allergen codes when checking allergen compliance. Do not use any other allergen codes not defined above.
`;
            // Insert after "### 7. ALLERGENS" when present; append for test/minimal prompts.
            qaPrompt = qaPrompt.includes('### 7. ALLERGENS')
                ? qaPrompt.replace('### 7. ALLERGENS', `### 7. ALLERGENS\n${allergenSection}`)
                : `${qaPrompt}\n${allergenSection}`;
            console.log('Injected custom allergens into prompt');
        }

        // Call AI Review service's QA endpoint
        let finalPrompt = qaPrompt;
        if (changedOnlyMode) {
            finalPrompt = `${qaPrompt}\n\nIMPORTANT SCOPE FOR THIS REVIEW:\nYou are reviewing ONLY changed excerpts from a menu revision.\nDo NOT flag unchanged baseline content.\nReturn issues only for the changed excerpts provided.\nThe CORRECTED MENU section MUST contain exactly the same lines you received, in the same order, with high-confidence corrections applied to each line. Do not add, remove, merge, split, or reorder lines.`;
        }
        finalPrompt = `${finalPrompt}\n\nIMPORTANT FOOTER RULES:\n- Do NOT review or suggest changes for the allergen legend/footer boilerplate.\n- Do NOT review or suggest changes for the standard foodborne illness warning/footer boilerplate.\n- The canonical foodborne illness warning is: ${RAW_NOTICE_TEXT}\n- Those footer lines are system-managed outside this review scope.`;

        const qaResponse = await internalApi.post(`${AI_REVIEW_URL}/run-qa-check`, {
            text: reviewFooterMetadata.body,
            prompt: finalPrompt
        });

        const feedback = qaResponse.data.feedback;

        // Debug: Log raw feedback to see format
        console.log('=== RAW AI FEEDBACK ===');
        console.log(feedback);
        console.log('=== END RAW FEEDBACK ===');

        // Parse the new format: corrected menu + suggestions
        const parsed = parseAIResponse(feedback, reviewFooterMetadata.body);
        const appliedHc = applyHighConfidenceSuggestionsToMenu(parsed.correctedMenu, parsed.suggestions);
        const correctedAfterHighConfidence = appliedHc.menuText;
        const suggestionsAfterAutoApply = appliedHc.suggestions;

        const correctedMenuSanitized = stripManagedFooterText(correctedAfterHighConfidence);
        const originalMenuSanitized = sanitizedMenuContent.body;
        const reconciledSuggestions = reconcileCriticalSuggestionsAgainstCorrectedMenu(
            correctedMenuSanitized,
            suggestionsAfterAutoApply
        );

        console.log('=== PARSED RESPONSE ===');
        console.log('Corrected menu length:', correctedMenuSanitized.length);
        console.log('Suggestions count:', parsed.suggestions.length);
        console.log('Reconciled suggestions count:', reconciledSuggestions.length);
        console.log('Has changes:', correctedMenuSanitized !== originalMenuSanitized);
        console.log('===========================');

        let finalSuggestions = reconciledSuggestions;

        if (menuType === 'prix_fixe') {
            finalSuggestions = enforcePrixFixeCriticalChecks(correctedMenuSanitized, finalSuggestions);
        }

        const hasCriticalErrors = finalSuggestions.some(s => s.severity === 'critical');

        let changedOnlyMergedMenu = menuContent;
        if (changedOnlyMode) {
            const mergeResult = mergeChangedLineCorrections(
                menuContent,
                baselineMenuContent,
                correctedAfterHighConfidence
            );
            changedOnlyMergedMenu = mergeResult.merged;
            if (mergeResult.bailed) {
                console.warn('changed_only merge bailed: AI corrected line count did not match extracted changed line count; falling back to original menu text');
            } else {
                console.log(`changed_only merge applied ${mergeResult.correctionsApplied} line correction(s)`);
            }
        }

        res.json({
            success: true,
            originalMenu: menuContent,
            correctedMenu: changedOnlyMode ? changedOnlyMergedMenu : correctedMenuSanitized,
            suggestions: finalSuggestions,
            hasChanges: changedOnlyMode
                ? changedOnlyMergedMenu !== menuContent
                : correctedMenuSanitized !== originalMenuSanitized,
            hasCriticalErrors,
            reviewMode: changedOnlyMode ? 'changed_only' : 'full',
            changedLineCount
        });

    } catch (error: any) {
        console.error('Error running basic check:', error);
        res.status(500).json({
            error: 'Failed to run basic AI check',
            details: error.message
        });
    }
});

function enforcePrixFixeCriticalChecks(
    menuContent: string,
    suggestions: Array<{
        type?: string;
        confidence?: string;
        severity?: string;
        menuItem?: string;
        description?: string;
        recommendation?: string;
    }>
): Array<{
    type?: string;
    confidence?: string;
    severity?: string;
    menuItem?: string;
    description?: string;
    recommendation?: string;
}> {
    const existing = [...(suggestions || [])];
    const nonEmptyLines = (menuContent || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const topWindow = nonEmptyLines.slice(0, 5);

    const topPricePattern = /^\$?\d+(?:[.,]\d+)?(?:\s*\|\s*\$?\d+(?:[.,]\d+)?)?(?:\s*(?:pp|per\s*person|wine\s*pairing))?$/i;
    const hasTopPrixFixePrice = topWindow.some((line) => topPricePattern.test(line));

    const headingPattern = /\b(appetizers?|starters?|specialties|mains?|entrees?|desserts?|first course|second course|third course|course)\b/i;
    const headingIndexes = nonEmptyLines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => headingPattern.test(line));

    const hasCourseHeadings = headingIndexes.length >= 2;
    let missingCourseNumbers = false;
    if (hasCourseHeadings) {
        missingCourseNumbers = headingIndexes.some(({ idx, line }) => {
            const thisLineNumbered = /^\d+\b/.test(line);
            const prevLine = idx > 0 ? nonEmptyLines[idx - 1] : '';
            const prevLineNumberOnly = /^\d+$/.test(prevLine);
            return !(thisLineNumbered || prevLineNumberOnly);
        });
    }

    const hasTopPriceSuggestion = existing.some((s) => {
        const combined = `${s.type || ''} ${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
        return /prix\s*fixe/.test(combined) && /price.*top|top.*price|single.*price/.test(combined);
    });
    const hasCourseNumberSuggestion = existing.some((s) => {
        const combined = `${s.type || ''} ${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
        return /course numbering|numbered courses|course number/.test(combined);
    });

    if (!hasTopPrixFixePrice && !hasTopPriceSuggestion) {
        existing.push({
            type: 'PRICING STRUCTURE',
            confidence: 'high',
            severity: 'critical',
            menuItem: 'Prix Fixe Menu',
            description: 'Prix fixe menu is missing a single top-level price at the top of the menu.',
            recommendation: 'Add a single prix fixe price at the top (optionally with pairing price, e.g., "185 | 85 wine pairing").'
        });
    }

    if (hasCourseHeadings && missingCourseNumbers && !hasCourseNumberSuggestion) {
        existing.push({
            type: 'COURSE NUMBERING',
            confidence: 'high',
            severity: 'critical',
            menuItem: 'Course Headings',
            description: 'Prix fixe courses are present but not numbered.',
            recommendation: 'Prefix course headings with numbers (1, 2, 3...) or place a number line directly above each course heading.'
        });
    }

    // Remove course numbering suggestions if numbers ARE present (AI false positive)
    if (hasCourseHeadings && !missingCourseNumbers) {
        return existing.filter((s) => {
            const combined = `${s.type || ''} ${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
            return !/course numbering|numbered courses|course number|not numbered/.test(combined);
        });
    }

    return existing;
}

function extractChangedLinesForReview(baselineText: string, currentText: string): { text: string; changedLineCount: number } {
    const baseLines = baselineText.split('\n').map(l => l.trim()).filter(Boolean);
    const currLines = currentText.split('\n').map(l => l.trim()).filter(Boolean);

    const baseSet = new Set(baseLines.map(normalizeReviewLine));
    const changedLines: string[] = [];

    for (const line of currLines) {
        const norm = normalizeReviewLine(line);
        if (!baseSet.has(norm)) {
            changedLines.push(line);
        }
    }

    return {
        text: changedLines.join('\n'),
        changedLineCount: changedLines.length
    };
}

function mergeChangedLineCorrections(
    fullText: string,
    baselineText: string,
    correctedChangedText: string
): { merged: string; correctionsApplied: number; bailed: boolean } {
    const baseLines = baselineText.split('\n').map(l => l.trim()).filter(Boolean);
    const baseSet = new Set(baseLines.map(normalizeReviewLine));
    const correctedChangedLines = (correctedChangedText || '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

    const fullLines = fullText.split('\n');
    const changedIndices: number[] = [];
    for (let i = 0; i < fullLines.length; i++) {
        const trimmed = fullLines[i].trim();
        if (!trimmed) continue;
        if (!baseSet.has(normalizeReviewLine(trimmed))) {
            changedIndices.push(i);
        }
    }

    if (changedIndices.length !== correctedChangedLines.length) {
        return { merged: fullText, correctionsApplied: 0, bailed: true };
    }

    let correctionsApplied = 0;
    const mergedLines = [...fullLines];
    for (let k = 0; k < changedIndices.length; k++) {
        const idx = changedIndices[k];
        const original = mergedLines[idx];
        const leadingWs = original.match(/^\s*/)?.[0] ?? '';
        const trailingWs = original.match(/\s*$/)?.[0] ?? '';
        const corrected = correctedChangedLines[k];
        if (original.trim() !== corrected) {
            mergedLines[idx] = leadingWs + corrected + trailingWs;
            correctionsApplied++;
        }
    }

    return { merged: mergedLines.join('\n'), correctionsApplied, bailed: false };
}

function normalizeReviewLine(line: string): string {
    return (line || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[“”"]/g, '"')
        .replace(/[’']/g, "'")
        .trim();
}

function stripDiacritics(input: string): string {
    return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// fetchLearnedPromptOverlay() removed in Learning Pipeline v2.
// Rules now flow through correction_rules table, not auto-injected overlay.

function normalizeForSuggestionMatch(input: string): string {
    return stripDiacritics(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function looksLikePriceOnLine(line: string): boolean {
    const compact = (line || '').trim();
    // Handles "... - 8", "... 14", "... $12", "... 12.50"
    return /(?:^|[\s\-|])\$?\d{1,3}(?:[.,]\d{1,2})?\s*$/.test(compact);
}

function findCorrectedLineForMenuItem(correctedMenu: string, menuItem: string): string | null {
    const itemNorm = normalizeForSuggestionMatch(menuItem || '');
    if (!itemNorm) return null;

    const lines = (correctedMenu || '').split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const lineNorm = normalizeForSuggestionMatch(line);
        if (lineNorm.includes(itemNorm)) {
            return line;
        }
    }
    return null;
}

function isCriticalResolvedByCorrectedMenu(
    suggestion: { type?: string; menuItem?: string; description?: string; recommendation?: string },
    correctedMenu: string
): boolean {
    const type = (suggestion.type || '').toLowerCase();
    const line = findCorrectedLineForMenuItem(correctedMenu, suggestion.menuItem || '');
    if (!line) return false;

    if (type.includes('missing price')) {
        return looksLikePriceOnLine(line);
    }

    if (type.includes('incomplete dish name')) {
        const itemNorm = normalizeForSuggestionMatch(suggestion.menuItem || '');
        const lineNorm = normalizeForSuggestionMatch(line);
        const remainder = lineNorm.replace(itemNorm, '').trim();

        if (remainder.length >= 6) {
            return true;
        }

        // If AI explicitly referenced a malformed token and it's now gone, treat as resolved.
        const combined = `${suggestion.description || ''} ${suggestion.recommendation || ''}`;
        const quotedTokenMatch = combined.match(/['"]([^'"]{2,30})['"]/);
        if (quotedTokenMatch && quotedTokenMatch[1]) {
            const tokenNorm = normalizeForSuggestionMatch(quotedTokenMatch[1]);
            if (tokenNorm && !lineNorm.includes(tokenNorm)) {
                return true;
            }
        }
    }

    return false;
}

function reconcileCriticalSuggestionsAgainstCorrectedMenu(
    correctedMenu: string,
    suggestions: Array<{
        type?: string;
        confidence?: string;
        severity?: string;
        menuItem?: string;
        description?: string;
        recommendation?: string;
    }>
): Array<{
    type?: string;
    confidence?: string;
    severity?: string;
    menuItem?: string;
    description?: string;
    recommendation?: string;
}> {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return [];
    }

    return suggestions.filter((s) => {
        if (s.severity !== 'critical') return true;
        return !isCriticalResolvedByCorrectedMenu(s, correctedMenu);
    });
}

/**
 * Form API: Menu image upload (optional)
 */
app.post('/api/form/menu-image-upload', upload.single('menuImage') as any, submissionWorkflowHandlers.uploadMenuImage);

/**
 * Form API: Submit Menu - Create docx from form and trigger review workflow
 */
app.post('/api/form/submit', submissionWorkflowHandlers.submitMenu);

app.post('/api/approval/:submissionId/submit', approvalWorkflowHandlers.submitBrowserApproval);

/**
 * NEW: Parse AI response that contains corrected menu + suggestions
 */
function parseAIResponse(feedback: string, originalMenu: string): {
    correctedMenu: string,
    suggestions: Array<{
        type: string,
        confidence: string,
        severity?: string,
        menuItem: string,
        description: string,
        recommendation: string
    }>
} {
    // Extract corrected menu between markers
    const correctedMenuMatch = feedback.match(/=== CORRECTED MENU ===\s*\n([\s\S]*?)\n=== END CORRECTED MENU ===/);
    const correctedMenuRaw = correctedMenuMatch ? correctedMenuMatch[1].trim() : originalMenu;

    // Extract suggestions JSON between markers
    const suggestionsMatch = feedback.match(/=== SUGGESTIONS ===\s*\n([\s\S]*?)\n=== END SUGGESTIONS ===/);
    let suggestions: Array<any> = [];

    if (suggestionsMatch) {
        try {
            const jsonStr = suggestionsMatch[1].trim();
            suggestions = JSON.parse(jsonStr);
            console.log(`Parsed ${suggestions.length} suggestions from JSON`);
        } catch (e) {
            console.error('Failed to parse suggestions JSON:', e);
            console.log('Raw suggestions text:', suggestionsMatch[1]);
        }
    }

    // Normalize severity on all suggestions
    suggestions = suggestions.map(s => {
        const type = (s.type || '').toString().trim().toLowerCase();
        const descLower = (s.description || '').toLowerCase();
        const recLower = (s.recommendation || '').toLowerCase();
        const combined = `${descLower} ${recLower}`;

        // Default missing severity to "normal"
        if (!s.severity) {
            s.severity = 'normal';
        }

        const isPrixFixeTopPriceIssue =
            /prix\s*fixe/.test(combined) &&
            /(price at the top|single price at the top|include a prix fixe price at the top|top of the menu)/.test(combined);
        const isCourseNumberingIssue =
            type === 'course numbering' ||
            (/prix\s*fixe/.test(combined) && /course number|numbered courses|preceded by its course number/.test(combined));

        // Force critical severity for known critical types (safety net)
        if (
            s.type === 'Missing Price' ||
            s.type === 'Incomplete Dish Name' ||
            type === 'course progression' ||
            type === 'pricing structure' ||
            isPrixFixeTopPriceIssue ||
            isCourseNumberingIssue
        ) {
            s.severity = 'critical';
        }

        // Fallback regex: if description mentions missing price/dish name but type/severity wasn't set
        if (s.severity !== 'critical') {
            if (/missing\s+price|no\s+price|price\s+is\s+missing/.test(descLower) && s.type !== 'Missing Price') {
                s.type = 'Missing Price';
                s.severity = 'critical';
            } else if (/missing\s+dish\s+name|incomplete\s+dish\s+name|no\s+dish\s+name/.test(descLower) && s.type !== 'Incomplete Dish Name') {
                s.type = 'Incomplete Dish Name';
                s.severity = 'critical';
            }
        }

        return s;
    });

    const correctedMenu = normalizeRawAsteriskPlacement(correctedMenuRaw);

    return {
        correctedMenu,
        suggestions
    };
}

function normalizeRawAsteriskPlacement(text: string): string {
    const lines = (text || '').split('\n');
    return lines
        .map((line) => normalizeRawAsteriskPlacementForLine(line))
        .join('\n');
}

function normalizeRawAsteriskPlacementForLine(line: string): string {
    const original = line || '';
    const trimmed = original.trim();
    if (!trimmed) return original;
    if (RAW_NOTICE_PATTERN.test(trimmed)) return original;
    if (!trimmed.includes('*')) return original;

    // Remove all raw markers first; we'll reinsert exactly one at canonical position.
    let working = trimmed.replace(/\*/g, '').replace(/\s{2,}/g, ' ').trim();

    // Skip obvious non-dish lines (titles/legends).
    if (/^[A-Za-zÀ-ÖØ-öø-ÿ0-9 '&\-]+$/.test(working) && !working.includes(',')) {
        return original;
    }
    if (working.includes(' | ') && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(working)) {
        return original;
    }

    let trailingPrice = '';
    let trailingAllergens = '';

    const priceMatch = working.match(/\s+(\$?\d+(?:[.,]\d+)?(?:\s*\|\s*\d+(?:[.,]\d+)?)?)\s*$/);
    if (priceMatch) {
        trailingPrice = priceMatch[1];
        working = working.slice(0, priceMatch.index).trim();
    }

    const allergenMatch = working.match(/\s+([A-Z]{1,3}(?:,[A-Z]{1,3})*)\s*$/);
    if (allergenMatch) {
        trailingAllergens = allergenMatch[1];
        working = working.slice(0, allergenMatch.index).trim();
    }

    // If we extracted any suffix, place marker before suffix; otherwise keep at line end.
    if (trailingAllergens || trailingPrice) {
        return `${working} *${trailingAllergens ? ` ${trailingAllergens}` : ''}${trailingPrice ? ` ${trailingPrice}` : ''}`.trim();
    }

    return `${working}*`;
}

function stripManagedFooterText(text: string, fallbackAllergens = ''): string {
    return normalizeMenuFooter(text, fallbackAllergens).body;
}

function stripRawNoticeFromHtml(html: string): string {
    return stripManagedFooterFromHtml(html);
}

function detectRawUndercookedContent(text: string): boolean {
    const normalized = (text || '').toLowerCase();
    if (!normalized.trim()) return false;
    if (/\*/.test(normalized)) return true;
    const terms = [
        'raw',
        'undercooked',
        'carpaccio',
        'tartare',
        'ceviche',
        'tiradito',
        'crudo',
        'sashimi',
        'oyster',
        'oysters',
        'rare'
    ];
    return terms.some((term) => normalized.includes(term));
}

/**
 * OLD: Parse AI feedback into structured suggestions with confidence levels (DEPRECATED - keeping for fallback)
 */
function parseFeedbackToSuggestions(feedback: string): Array<{
    type: string,
    description: string,
    change?: string,
    confidence?: 'high' | 'medium' | 'low',
    menuItem?: string,
    recommendation?: string,
    originalText?: string,
    correctedText?: string
}> {
    const suggestions: Array<any> = [];

    // Extract each item block that has Menu Item + Description + Recommendation
    // Pattern: look for "- **Menu Item:" or "- **Menu Item:**" followed by description and recommendation
    // Match until we hit another Menu Item, Menu Category, or end of feedback
    const itemBlocks = feedback.match(/- \*\*Menu Item:?\*\*[^]*?(?=(?:\n\s*- \*\*Menu (?:Item|Category):?|$))/gi);

    if (!itemBlocks || itemBlocks.length === 0) {
        console.log('⚠️  No structured suggestions found in feedback');
        console.log('First 500 chars of feedback:', feedback.substring(0, 500));
        return [];
    }

    console.log(`Found ${itemBlocks.length} suggestion blocks`);

    itemBlocks.forEach((block, blockIdx) => {
        console.log(`\nParsing block ${blockIdx + 1}:`);
        console.log(block.substring(0, 200));

        // Extract components from each block (handle both "Item:" and "Item:**" formats)
        const menuItemMatch = block.match(/- \*\*Menu Item:?\*\*\s*(.+?)(?=\n|$)/i);
        const descriptionMatch = block.match(/- \*\*Description of Issue:?\*\*\s*(.+?)(?=\n\s*- \*\*Recommendation:|$)/is);
        const recommendationMatch = block.match(/- \*\*Recommendation:?\*\*\s*(.+?)(?=\n\s*(?:-|\n)|$)/is);

        const menuItem = menuItemMatch ? menuItemMatch[1].trim() : '';

        if (!descriptionMatch) {
            console.log('⚠️  No description found in block');
            return;
        }

        const description = descriptionMatch[1].trim();
        const recommendation = recommendationMatch ? recommendationMatch[1].trim() : '';

        // Determine confidence level based on keywords
        let confidence: 'high' | 'medium' | 'low' = 'medium';

        // High confidence: spelling errors, typos, missing commas, clear factual errors
        if (description.match(/spelling|misspell|typo|incorrect spelling|correct spelling/i)) {
            confidence = 'high';
        } else if (description.match(/missing comma|missing punctuation/i)) {
            confidence = 'high';
        } else if (recommendation.match(/correct\s+(?:spelling\s+)?to/i) && description.match(/should\s+(?:be|likely be)/i)) {
            confidence = 'high';
        }
        // Low confidence: suggestions, could, might, consider
        else if (description.match(/consider|could|might|suggest|may want|unclear|ensure/i)) {
            confidence = 'low';
        }

        // Try to extract original and corrected text from recommendation and description
        let originalText = '';
        let correctedText = '';

        // Pattern 1: Correct to "X"  or Correct spelling to "X"
        const correctToPattern = recommendation.match(/correct(?:\s+(?:to|spelling\s+to))?\s+["']([^"']+)["']/i);
        if (correctToPattern) {
                correctedText = correctToPattern[1];
                // Try to find the incorrect word in the description
                const incorrectMatch = description.match(/["']([^"']+)["']\s+(?:is|should be|appears)/i);
                if (incorrectMatch) {
                    originalText = incorrectMatch[1];
                }
        }

        // Pattern 2: "X" should be "Y"
        if (!correctedText) {
                const shouldBePattern = recommendation.match(/["']([^"']+)["']\s+should be\s+["']([^"']+)["']/i);
                if (shouldBePattern) {
                    originalText = shouldBePattern[1];
                    correctedText = shouldBePattern[2];
                }
        }

        // Pattern 3: Look in description for misspelling patterns
        if (!correctedText && description.match(/misspell/i)) {
                // "Hibik" is a likely misspelling of "Hibiki"
                const misspellPattern = description.match(/["']([^"']+)["']\s+is\s+a\s+(?:likely\s+)?misspelling/i);
                if (misspellPattern) {
                    originalText = misspellPattern[1];
                }
                // Look for correct spelling in recommendation
                const correctPattern = recommendation.match(/correct\s+(?:to|spelling\s+to)?\s*["']([^"']+)["']/i);
                if (correctPattern) {
                    correctedText = correctPattern[1];
                }
        }

        // Pattern 4: Correct spelling to "X" (extract from description)
        if (!correctedText) {
                const correctSpellingPattern = recommendation.match(/correct\s+spelling\s+to\s+["']([^"']+)["']/i);
                if (correctSpellingPattern) {
                    correctedText = correctSpellingPattern[1];
                    // Extract the misspelled word from description
                    // Look for quoted words that appear multiple times or standalone
                    const quotedWords = description.match(/["']([^"']+)["']/g);
                    if (quotedWords && quotedWords.length > 0) {
                        // Get the first quoted word (usually the incorrect one)
                        const firstWord = quotedWords[0].replace(/["']/g, '');
                        // Check if it's similar to the correction (edit distance)
                        if (firstWord.toLowerCase().replace(/s$/, '') === correctedText.toLowerCase().replace(/s$/, '').replace(/\.$/, '')) {
                            originalText = firstWord.split(',')[0].trim(); // Handle "biters" in "biters, orange biters"
                        }
                    }
                }
        }

        // Pattern 5: "X" is likely a typo for "Y"
        if (!originalText || !correctedText) {
                const typoPattern = description.match(/["']([^"']+)["']\s+is\s+likely\s+a\s+typo\s+for\s+["']([^"']+)["']/i);
                if (typoPattern) {
                    originalText = typoPattern[1];
                    correctedText = typoPattern[2];
                }
        }

        // Pattern 6: "X" should be "Y" in description
        if (!originalText || !correctedText) {
                const descShouldBePattern = description.match(/["']([^"']+)["']\s+should\s+(?:be|likely be)\s+["']([^"']+)["']/i);
                if (descShouldBePattern) {
                    originalText = descShouldBePattern[1];
                    correctedText = descShouldBePattern[2];
                }
        }

        // Pattern 7: Extract word pairs when correctedText is a phrase like "mole bitters, orange bitters"
        // and description mentions the incorrect version
        if (correctedText && !originalText && correctedText.includes(',')) {
                // Try to find common misspelling in description
                const descQuoted = description.match(/["']([^"']+)["']/);
                if (descQuoted) {
                    const descText = descQuoted[1];
                    // Extract the repeated incorrect word (e.g., "biters" from "mole biters, orange biters")
                    const correctedWords = correctedText.split(/,\s*/);
                    const descWords = descText.split(/,\s*/);
                    // Find the differing word between original and corrected
                    if (correctedWords[0] && descWords[0]) {
                        const corrParts = correctedWords[0].split(' ');
                        const descParts = descWords[0].split(' ');
                        // Find the word that differs (e.g., "biters" vs "bitters")
                        for (let i = 0; i < Math.min(corrParts.length, descParts.length); i++) {
                            if (corrParts[i] !== descParts[i]) {
                                originalText = descParts[i];
                                correctedText = corrParts[i];
                                break;
                            }
                        }
                    }
                }
        }

            // Try to identify the type based on content
        let type = 'General';
        if (description.toLowerCase().includes('diacritic') || description.toLowerCase().includes('accent')) {
                type = 'Diacritics';
        } else if (description.toLowerCase().includes('allergen')) {
                type = 'Allergen Code';
        } else if (description.toLowerCase().includes('spelling')) {
                type = 'Spelling';
        } else if (description.toLowerCase().includes('format')) {
                type = 'Formatting';
        } else if (description.toLowerCase().includes('raw') || description.toLowerCase().includes('asterisk')) {
                type = 'Raw Item Marker';
        } else if (description.toLowerCase().includes('comma') || description.toLowerCase().includes('punctuation')) {
                type = 'Punctuation';
        }

        suggestions.push({
                type: type,
                description: description,
                recommendation: recommendation,
                confidence: confidence,
                menuItem: menuItem,
                originalText: originalText || undefined,
                correctedText: correctedText || undefined
        });
    });

    // If no structured issues found, create general feedback
    if (suggestions.length === 0 && feedback && !feedback.includes('No feedback generated')) {
        const lines = feedback.split('\n').filter(line =>
            line.trim() &&
            !line.includes('---') &&
            !line.startsWith('Here is') &&
            line.length > 20
        );

        lines.slice(0, 5).forEach(line => {
        suggestions.push({
                type: 'Suggestion',
                description: line.trim(),
                confidence: 'low'
        });
        });
    }

    return suggestions;
}

/**
 * Helper: Generate Word document from form data using Python
 */
async function generateDocxFromForm(
    submissionId: string,
    formData: any,
    options?: { outputPath?: string }
): Promise<string> {
    const tempUploadsDir = path.join(__dirname, '..', '..', '..', 'tmp', 'uploads');
    await fs.mkdir(tempUploadsDir, { recursive: true });

    let outputPath = options?.outputPath || '';
    if (!outputPath) {
        const submissionDir = getSubmissionDocumentDir(formData.projectName || '', formData.property || '', submissionId);
        const originalDir = path.join(submissionDir, 'original');
        await fs.mkdir(originalDir, { recursive: true });
        outputPath = path.join(originalDir, `${submissionId}.docx`);
    } else {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
    }

    // Create Python script to generate docx
    const repoRoot = getRepoRoot();
    const docxRedlinerDir = getDocxRedlinerDir();
    const pythonScript = path.join(docxRedlinerDir, 'generate_from_form.py');

    // Select template based on templateType (food or beverage)
    const templateType = formData.templateType || 'food';
    const templatePath = templateType === 'beverage'
        ? path.join(repoRoot, 'samples', 'RSH Design Brief Beverage Template.docx')
        : path.join(repoRoot, 'samples', 'RSH_DESIGN BRIEF_FOOD_Menu_Template .docx');

    console.log(`Using ${templateType} template: ${templatePath}`);

    const venvPython = path.join(docxRedlinerDir, 'venv', 'bin', 'python');

    // Create a temp JSON file with form data
    const formDataPath = path.join(tempUploadsDir, `${submissionId}_formdata.json`);
    await fs.writeFile(formDataPath, JSON.stringify(formData, null, 2));

    // Try venv python first, fallback to system python3
    let command = `"${venvPython}" "${pythonScript}" "${templatePath}" "${formDataPath}" "${outputPath}"`;

    try {
        await fs.access(venvPython);
    } catch {
        command = `python3 "${pythonScript}" "${templatePath}" "${formDataPath}" "${outputPath}"`;
    }

    console.log(`Executing: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
        env: { ...process.env },
        timeout: 60000
    });

    if (stdout) console.log('Document generation output:', stdout);
    if (stderr) console.error('Document generation stderr:', stderr);

    // Clean up temp file
    await fs.unlink(formDataPath).catch(() => {});

    return outputPath;
}

/**
 * Design Approval API: Compare DOCX against PDF
 */
app.post('/api/design-approval/compare', upload.fields([
    { name: 'docxFile', maxCount: 1 },
    { name: 'pdfFile', maxCount: 1 }
]) as any, designApprovalWorkflowHandlers.compare);

app.post('/api/design-approval/:submissionId/override', designApprovalWorkflowHandlers.saveOverride);

// ---- Design Approval comparison helpers ----

// Load design comparison rules
const designRulesPath = path.join(__dirname, 'design-comparison-rules.json');
let designComparisonRules: any = {};
try {
    designComparisonRules = JSON.parse(require('fs').readFileSync(designRulesPath, 'utf8')).rules || {};
} catch { /* use defaults */ }

interface Difference {
    type: string;
    severity: string;
    description: string;
    docxValue?: string;
    pdfValue?: string;
    docxLineNum?: number;
    pdfLineNum?: number;
}

interface AlignmentEntry {
    type: 'match' | 'docx_only' | 'pdf_only';
    docxLine?: string;
    pdfLine?: string;
    docxIdx?: number;
    pdfIdx?: number;
    wordDiffs?: WordDiff[];
}

interface WordDiff {
    type: 'same' | 'changed' | 'missing' | 'added';
    text?: string;
    docxText?: string;
    pdfText?: string;
    classification?: { type: string; severity: string };
}

const PRICE_REGEX = /\$?\d+\.?\d*/g;
const ALLERGEN_CODES = new Set(['GF', 'V', 'VG', 'DF', 'N', 'SF', 'S', 'G', 'C', 'D', 'E', 'F']);

function stripAccents(str: string): string {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function classifyWordDiff(docxWord: string, pdfWord: string): { type: string; severity: string } {
    // Price difference
    if (PRICE_REGEX.test(docxWord) || PRICE_REGEX.test(pdfWord)) {
        // Reset regex lastIndex
        PRICE_REGEX.lastIndex = 0;
        const docxPrices = docxWord.match(PRICE_REGEX) || [];
        const pdfPrices = pdfWord.match(PRICE_REGEX) || [];
        if (docxPrices.join() !== pdfPrices.join()) {
            return { type: 'price', severity: 'critical' };
        }
    }
    PRICE_REGEX.lastIndex = 0;

    // Allergen code
    const docxUpper = docxWord.replace(/[^A-Za-z]/g, '').toUpperCase();
    const pdfUpper = pdfWord.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (ALLERGEN_CODES.has(docxUpper) || ALLERGEN_CODES.has(pdfUpper)) {
        if (docxUpper !== pdfUpper) {
            return { type: 'allergen', severity: 'critical' };
        }
    }

    // Case-only difference — treat as info if rules say so
    if (docxWord.toLowerCase() === pdfWord.toLowerCase()) {
        if (designComparisonRules.treatCaseOnlyAsInfo) {
            return { type: 'formatting', severity: 'info' };
        }
        return { type: 'formatting', severity: 'warning' };
    }

    // Diacritical difference
    if (stripAccents(docxWord).toLowerCase() === stripAccents(pdfWord).toLowerCase() &&
        docxWord.toLowerCase() !== pdfWord.toLowerCase()) {
        return { type: 'diacritical', severity: 'warning' };
    }

    // Punctuation-only difference (e.g., trailing comma vs none)
    if (designComparisonRules.ignorePunctuationDifferences) {
        const docxStripped = docxWord.replace(/[^\w]/g, '').toLowerCase();
        const pdfStripped = pdfWord.replace(/[^\w]/g, '').toLowerCase();
        if (docxStripped === pdfStripped && docxStripped.length > 0) {
            return { type: 'formatting', severity: 'info' };
        }
    }

    // Spelling
    return { type: 'spelling', severity: 'warning' };
}

function compareMenuTexts(docxText: string, pdfText: string): { differences: Difference[]; alignments: AlignmentEntry[] } {
    const differences: Difference[] = [];
    const alignments: AlignmentEntry[] = [];

    const docxLines = docxText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const pdfLines = pdfText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Build LCS alignment between lines
    const m = docxLines.length;
    const n = pdfLines.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (linesMatchFuzzy(docxLines[i - 1], pdfLines[j - 1])) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find alignment
    type Alignment = { type: 'match' | 'docx_only' | 'pdf_only'; docxIdx?: number; pdfIdx?: number };
    const aligned: Alignment[] = [];
    let i = m, j = n;

    while (i > 0 && j > 0) {
        if (linesMatchFuzzy(docxLines[i - 1], pdfLines[j - 1])) {
            aligned.unshift({ type: 'match', docxIdx: i - 1, pdfIdx: j - 1 });
            i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            aligned.unshift({ type: 'docx_only', docxIdx: i - 1 });
            i--;
        } else {
            aligned.unshift({ type: 'pdf_only', pdfIdx: j - 1 });
            j--;
        }
    }
    while (i > 0) {
        aligned.unshift({ type: 'docx_only', docxIdx: i - 1 });
        i--;
    }
    while (j > 0) {
        aligned.unshift({ type: 'pdf_only', pdfIdx: j - 1 });
        j--;
    }

    // Reordering detection: try to match docx_only lines with pdf_only lines
    if (designComparisonRules.reorderingTolerance) {
        const docxOnlyIndices = aligned
            .map((a, idx) => a.type === 'docx_only' ? idx : -1)
            .filter(idx => idx >= 0);
        const pdfOnlyIndices = aligned
            .map((a, idx) => a.type === 'pdf_only' ? idx : -1)
            .filter(idx => idx >= 0);

        const matchedPdfIndices = new Set<number>();
        for (const dIdx of docxOnlyIndices) {
            const docxLine = docxLines[aligned[dIdx].docxIdx!];
            for (const pIdx of pdfOnlyIndices) {
                if (matchedPdfIndices.has(pIdx)) continue;
                const pdfLine = pdfLines[aligned[pIdx].pdfIdx!];
                if (linesMatchFuzzy(docxLine, pdfLine)) {
                    // Convert both to a match pair
                    aligned[dIdx] = {
                        type: 'match',
                        docxIdx: aligned[dIdx].docxIdx,
                        pdfIdx: aligned[pIdx].pdfIdx
                    };
                    aligned[pIdx] = { type: 'match', docxIdx: -1, pdfIdx: -1 }; // mark for removal
                    matchedPdfIndices.add(pIdx);
                    break;
                }
            }
        }
        // Remove the placeholder entries (matched pdf_only that became redundant)
        const filteredAligned = aligned.filter(a => !(a.type === 'match' && a.docxIdx === -1 && a.pdfIdx === -1));
        aligned.length = 0;
        aligned.push(...filteredAligned);
    }

    // Pre-process: merge price-only docx lines into adjacent match pairs
    // e.g., DOCX has "BOTTOMLESS ENHANCEMENTS" + "+ 10" on separate lines,
    // PDF has "BOTTOMLESS ENHANCEMENTS +10" on one line — merge the DOCX lines
    if (designComparisonRules.ignoreWhitespaceInPrices) {
        const mergedIndices = new Set<number>();
        for (let ai = 0; ai < aligned.length; ai++) {
            if (aligned[ai].type !== 'docx_only') continue;
            const docxLine = docxLines[aligned[ai].docxIdx!];
            const isPriceLine = /^[\+\$\s]*\d+\.?\d*$/.test(docxLine.trim());
            if (!isPriceLine) continue;

            // Find adjacent match pair and merge the price into it
            for (let adj = ai - 1; adj <= ai + 1; adj += 2) {
                if (adj < 0 || adj >= aligned.length) continue;
                if (aligned[adj].type !== 'match') continue;
                const pdfLine = pdfLines[aligned[adj].pdfIdx!];
                const priceVal = docxLine.trim().replace(/[\s\+\$]/g, '').replace(/^0+/, '');
                const pPrices = (pdfLine.match(/[\+\$]?\d+\.?\d*/g) || []).map(p => p.replace(/[\$\+\s]/g, '').replace(/^0+/, ''));
                if (pPrices.includes(priceVal)) {
                    // Merge: update the DOCX line in the match to include the price
                    const origDocxLine = docxLines[aligned[adj].docxIdx!];
                    // Normalize price format to match PDF (e.g., "+ 10" → "+10")
                    const normalizedPrice = docxLine.trim().replace(/\s+/g, '');
                    docxLines[aligned[adj].docxIdx!] = origDocxLine + ' ' + normalizedPrice;
                    mergedIndices.add(ai);
                    break;
                }
            }
        }
        // Remove merged price lines from alignment
        const filtered = aligned.filter((_, idx) => !mergedIndices.has(idx));
        aligned.length = 0;
        aligned.push(...filtered);
    }

    // Process aligned pairs
    const ignorableWords = new Set((designComparisonRules.ignorableWords || []).map((w: string) => w.toLowerCase()));
    const minWordLen = designComparisonRules.minWordLengthForMissing || 0;

    for (const pair of aligned) {
        if (pair.type === 'docx_only') {
            const docxLine = docxLines[pair.docxIdx!];
            // Check if this is just a leading phrase that got stripped
            const stripped = stripLeadingPhrases(docxLine).trim();
            if (stripped.length === 0) {
                // Entire line was just a leading phrase — info level
                alignments.push({ type: 'docx_only', docxLine, docxIdx: pair.docxIdx });
                differences.push({
                    type: 'missing',
                    severity: 'info',
                    description: `Line missing in PDF (ignorable prefix only)`,
                    docxValue: docxLine,
                    docxLineNum: pair.docxIdx
                });
                continue;
            }

            // Check if line is only short ignorable words
            const words = docxLine.split(/\s+/);
            const allIgnorable = words.every(w =>
                ignorableWords.has(w.toLowerCase().replace(/[^\w]/g, '')) || w.replace(/[^\w]/g, '').length < minWordLen
            );

            alignments.push({ type: 'docx_only', docxLine, docxIdx: pair.docxIdx });
            differences.push({
                type: 'missing',
                severity: allIgnorable ? 'info' : 'critical',
                description: `Line missing in PDF`,
                docxValue: docxLine,
                docxLineNum: pair.docxIdx
            });
        } else if (pair.type === 'pdf_only') {
            const pdfLine = pdfLines[pair.pdfIdx!];

            // Check if it's just a price that was on the previous line in docx
            const isPriceOnly = /^[\+\$\s]*\d+\.?\d*$/.test(pdfLine.trim());

            alignments.push({ type: 'pdf_only', pdfLine, pdfIdx: pair.pdfIdx });
            differences.push({
                type: 'extra',
                severity: isPriceOnly ? 'info' : 'warning',
                description: isPriceOnly ? `Price on separate line in PDF` : `Extra line in PDF`,
                pdfValue: pdfLine,
                pdfLineNum: pair.pdfIdx
            });
        } else if (pair.type === 'match') {
            const docxLine = docxLines[pair.docxIdx!];
            const pdfLine = pdfLines[pair.pdfIdx!];

            // Even if lines "match" fuzzy, check word-by-word for differences
            if (docxLine !== pdfLine) {
                const { diffs: wordDiffs, wordAlignments } = compareWords(docxLine, pdfLine);
                for (const wd of wordDiffs) {
                    differences.push({
                        ...wd,
                        docxLineNum: pair.docxIdx,
                        pdfLineNum: pair.pdfIdx
                    });
                }
                alignments.push({
                    type: 'match',
                    docxLine,
                    pdfLine,
                    docxIdx: pair.docxIdx,
                    pdfIdx: pair.pdfIdx,
                    wordDiffs: wordAlignments
                });
            } else {
                alignments.push({
                    type: 'match',
                    docxLine,
                    pdfLine,
                    docxIdx: pair.docxIdx,
                    pdfIdx: pair.pdfIdx
                });
            }
        }
    }

    return { differences, alignments };
}

function stripLeadingPhrases(line: string): string {
    const phrases = designComparisonRules.ignoreLeadingPhrases || [];
    let result = line;
    for (const phrase of phrases) {
        if (result.toLowerCase().startsWith(phrase.toLowerCase())) {
            result = result.slice(phrase.length).trim();
        }
    }
    return result;
}

function stripPricesFromLine(line: string): string {
    // Remove standalone prices like "29", "$29", "+10", "+ 10", "$29.00"
    return line.replace(/[\+]?\s*\$?\d+\.?\d*/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeLine(line: string): string {
    let norm = stripAccents(line).toLowerCase().replace(/\s+/g, ' ').trim();
    norm = stripLeadingPhrases(norm);
    // Remove ignorable conjunction words for matching purposes
    if (designComparisonRules.ignoreConjunctionChanges) {
        const ignorable = new Set(designComparisonRules.ignorableWords || []);
        norm = norm.split(/\s+/).filter((w: string) => !ignorable.has(w.replace(/[^\w]/g, ''))).join(' ');
    }
    if (designComparisonRules.ignorePunctuationDifferences) {
        norm = norm.replace(/[,;:.\-–—]/g, '').replace(/\s+/g, ' ').trim();
    }
    return norm;
}

function linesMatchFuzzy(a: string, b: string): boolean {
    if (a === b) return true;
    // Normalize: strip accents, lowercase, collapse whitespace
    const normA = stripAccents(a).toLowerCase().replace(/\s+/g, ' ').trim();
    const normB = stripAccents(b).toLowerCase().replace(/\s+/g, ' ').trim();
    if (normA === normB) return true;

    // Try matching after stripping leading phrases and applying rules
    const deepNormA = normalizeLine(a);
    const deepNormB = normalizeLine(b);
    if (deepNormA === deepNormB) return true;

    // Try matching with prices stripped (price on different line)
    if (designComparisonRules.ignoreWhitespaceInPrices) {
        const noPriceA = stripPricesFromLine(deepNormA);
        const noPriceB = stripPricesFromLine(deepNormB);
        if (noPriceA.length > 0 && noPriceA === noPriceB) return true;
    }

    // Similarity based on common words
    const wordsA = deepNormA.split(/\s+/);
    const wordsB = deepNormB.split(/\s+/);
    if (wordsA.length === 0 || wordsB.length === 0) return false;

    let common = 0;
    const setB = new Set(wordsB);
    for (const w of wordsA) {
        if (setB.has(w)) common++;
    }

    return common / Math.max(wordsA.length, wordsB.length) > 0.5;
}

function compareWords(docxLine: string, pdfLine: string): { diffs: Difference[]; wordAlignments: WordDiff[] } {
    const diffs: Difference[] = [];
    const wordAlignments: WordDiff[] = [];
    const ignorableWords = new Set((designComparisonRules.ignorableWords || []).map((w: string) => w.toLowerCase()));
    const minWordLen = designComparisonRules.minWordLengthForMissing || 0;

    // Strip leading phrases before comparing words
    let processedDocx = docxLine;
    let processedPdf = pdfLine;
    if (designComparisonRules.ignoreLeadingPhrases) {
        processedDocx = stripLeadingPhrases(processedDocx);
        processedPdf = stripLeadingPhrases(processedPdf);
    }

    const docxWords = processedDocx.split(/\s+/).filter(w => w.length > 0);
    const pdfWords = processedPdf.split(/\s+/).filter(w => w.length > 0);

    // LCS on words — use case-insensitive matching for alignment
    const m = docxWords.length;
    const n = pdfWords.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    const wordsMatch = (a: string, b: string): boolean => {
        if (a === b) return true;
        if (designComparisonRules.ignoreCaseDifferences && a.toLowerCase() === b.toLowerCase()) return true;
        if (designComparisonRules.ignorePunctuationDifferences) {
            const aStripped = a.replace(/[^\w]/g, '').toLowerCase();
            const bStripped = b.replace(/[^\w]/g, '').toLowerCase();
            if (aStripped === bStripped && aStripped.length > 0) return true;
        }
        return false;
    };

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (wordsMatch(docxWords[i - 1], pdfWords[j - 1])) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack
    type WAlign = { type: 'same' | 'docx' | 'pdf' | 'changed'; dIdx?: number; pIdx?: number };
    const waligned: WAlign[] = [];
    let wi = m, wj = n;

    while (wi > 0 && wj > 0) {
        if (wordsMatch(docxWords[wi - 1], pdfWords[wj - 1])) {
            waligned.unshift({ type: 'same', dIdx: wi - 1, pIdx: wj - 1 });
            wi--; wj--;
        } else if (dp[wi - 1][wj] > dp[wi][wj - 1]) {
            waligned.unshift({ type: 'docx', dIdx: wi - 1 });
            wi--;
        } else {
            waligned.unshift({ type: 'pdf', pIdx: wj - 1 });
            wj--;
        }
    }
    while (wi > 0) { waligned.unshift({ type: 'docx', dIdx: wi - 1 }); wi--; }
    while (wj > 0) { waligned.unshift({ type: 'pdf', pIdx: wj - 1 }); wj--; }

    // Pair up adjacent docx/pdf removals/additions as changes
    let idx = 0;
    while (idx < waligned.length) {
        const cur = waligned[idx];
        if (cur.type === 'docx' && idx + 1 < waligned.length && waligned[idx + 1].type === 'pdf') {
            // This is a word change
            const docxW = docxWords[cur.dIdx!];
            const pdfW = pdfWords[waligned[idx + 1].pIdx!];
            const classification = classifyWordDiff(docxW, pdfW);
            diffs.push({
                type: classification.type,
                severity: classification.severity,
                description: `"${docxW}" changed to "${pdfW}"`,
                docxValue: docxW,
                pdfValue: pdfW
            });
            wordAlignments.push({
                type: 'changed',
                docxText: docxW,
                pdfText: pdfW,
                classification
            });
            idx += 2;
        } else if (cur.type === 'pdf' && idx + 1 < waligned.length && waligned[idx + 1].type === 'docx') {
            const docxW = docxWords[waligned[idx + 1].dIdx!];
            const pdfW = pdfWords[cur.pIdx!];
            const classification = classifyWordDiff(docxW, pdfW);
            diffs.push({
                type: classification.type,
                severity: classification.severity,
                description: `"${docxW}" changed to "${pdfW}"`,
                docxValue: docxW,
                pdfValue: pdfW
            });
            wordAlignments.push({
                type: 'changed',
                docxText: docxW,
                pdfText: pdfW,
                classification
            });
            idx += 2;
        } else if (cur.type === 'docx') {
            const word = docxWords[cur.dIdx!];
            const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
            const isIgnorable = ignorableWords.has(cleanWord) || cleanWord.length < minWordLen;
            diffs.push({
                type: 'missing',
                severity: isIgnorable ? 'info' : 'critical',
                description: `Word missing in PDF: "${word}"`,
                docxValue: word
            });
            wordAlignments.push({ type: 'missing', text: word });
            idx++;
        } else if (cur.type === 'pdf') {
            const word = pdfWords[cur.pIdx!];
            const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
            const isIgnorable = ignorableWords.has(cleanWord) || (designComparisonRules.ignoreConjunctionChanges && ['and', 'or', '&'].includes(cleanWord));
            diffs.push({
                type: 'extra',
                severity: isIgnorable ? 'info' : 'info',
                description: `Extra word in PDF: "${word}"`,
                pdfValue: word
            });
            wordAlignments.push({ type: 'added', text: word });
            idx++;
        } else {
            // 'same' type — but if the actual strings differ (case only), emit formatting info
            if (cur.type === 'same' && cur.dIdx !== undefined && cur.pIdx !== undefined) {
                const docxW = docxWords[cur.dIdx];
                const pdfW = pdfWords[cur.pIdx];
                if (docxW !== pdfW) {
                    const classification = classifyWordDiff(docxW, pdfW);
                    diffs.push({
                        type: classification.type,
                        severity: classification.severity,
                        description: `"${docxW}" changed to "${pdfW}"`,
                        docxValue: docxW,
                        pdfValue: pdfW
                    });
                    wordAlignments.push({
                        type: 'changed',
                        docxText: docxW,
                        pdfText: pdfW,
                        classification
                    });
                } else {
                    wordAlignments.push({ type: 'same', text: docxW });
                }
            } else {
                idx++;
                continue;
            }
            idx++;
        }
    }

    return { diffs, wordAlignments };
}

if (require.main === module) {
    app.listen(port, () => {
        console.log(`📊 Dashboard service listening at http://localhost:${port}`);
        console.log(`   Access dashboard: http://localhost:${port}`);
        console.log(`   Form submission: http://localhost:${port}/form`);
        console.log(`   Design approval: http://localhost:${port}/design-approval`);
        console.log(`   Training dashboard: http://localhost:${port}/training`);
    });
}

export default app;

import { sanitizePlainTextInput } from './upload-security';

// User-initiated problem reports from the public submission form.
// The client sends a full-page screenshot (data URL) plus a JSON snapshot of
// everything filled out on the page so failures can be debugged without
// asking the submitter to reproduce anything.

export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // decoded image bytes
const MAX_STATE_STRING_LENGTH = 200_000;
const MAX_STATE_KEYS = 250;
const MAX_STATE_ARRAY_ITEMS = 250;
const MAX_STATE_DEPTH = 6;
const MAX_RECENT_ALERTS = 25;

export interface NormalizedErrorReport {
    attemptId: string;
    context: string;
    trigger: string;
    pageUrl: string;
    userAgent: string;
    viewport: string;
    submitterName: string;
    submitterEmail: string;
    projectName: string;
    property: string;
    submissionMode: string;
    recentAlerts: Array<{ time: string; type: string; message: string }>;
    screenshotError: string;
    state: any;
}

export interface DecodedScreenshot {
    buffer: Buffer;
    contentType: 'image/png' | 'image/jpeg';
    extension: 'png' | 'jpg';
}

export interface ErrorReportIncidentMetadata {
    incidentId: string;
    savedTo?: string | null;
    stateJsonLength?: number;
    screenshotBytes?: number;
}

function text(value: unknown, maxLength: number, multiline = false): string {
    return sanitizePlainTextInput(value, { maxLength, multiline });
}

/**
 * Recursively bound the client state snapshot so a hostile or buggy client
 * cannot blow up the email attachment / disk copy. Strings keep generous
 * limits because menu text and redline HTML are the most useful fields.
 */
export function truncateStateForReport(value: unknown, depth = 0): any {
    if (value === null || value === undefined) return value ?? null;
    if (depth >= MAX_STATE_DEPTH) return '[max depth reached]';
    if (typeof value === 'string') {
        if (value.length <= MAX_STATE_STRING_LENGTH) return value;
        return `${value.slice(0, MAX_STATE_STRING_LENGTH)}… [truncated ${value.length - MAX_STATE_STRING_LENGTH} chars]`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_STATE_ARRAY_ITEMS).map((item) => truncateStateForReport(item, depth + 1));
        if (value.length > MAX_STATE_ARRAY_ITEMS) items.push(`[+${value.length - MAX_STATE_ARRAY_ITEMS} more items truncated]`);
        return items;
    }
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .slice(0, MAX_STATE_KEYS)
                .map(([key, entryValue]) => [key.slice(0, 200), truncateStateForReport(entryValue, depth + 1)])
        );
    }
    return `${value}`;
}

function normalizeRecentAlerts(value: unknown): Array<{ time: string; type: string; message: string }> {
    if (!Array.isArray(value)) return [];
    return value.slice(-MAX_RECENT_ALERTS).map((alert: any) => ({
        time: text(alert?.time, 40),
        type: text(alert?.type, 20),
        message: text(alert?.message, 1000),
    })).filter((alert) => alert.message);
}

export function normalizeErrorReport(body: any): NormalizedErrorReport {
    const source = body || {};
    return {
        attemptId: text(source.attemptId, 100) || `report-${Date.now()}`,
        context: text(source.context, 1000, true),
        trigger: text(source.trigger, 100),
        pageUrl: text(source.pageUrl, 500),
        userAgent: text(source.userAgent, 400),
        viewport: text(source.viewport, 120),
        submitterName: text(source.submitterName, 255),
        submitterEmail: text(source.submitterEmail, 255).toLowerCase(),
        projectName: text(source.projectName, 255),
        property: text(source.property, 255),
        submissionMode: text(source.submissionMode, 50),
        recentAlerts: normalizeRecentAlerts(source.recentAlerts),
        screenshotError: text(source.screenshotError, 300),
        state: truncateStateForReport(source.state ?? null),
    };
}

/**
 * Decode a `data:image/png;base64,...` / `data:image/jpeg;base64,...` URL.
 * Returns null for anything else (other MIME types, malformed base64,
 * oversized payloads) — the report is still accepted without a screenshot.
 */
export function decodeScreenshotDataUrl(dataUrl: unknown, maxBytes = MAX_SCREENSHOT_BYTES): DecodedScreenshot | null {
    if (typeof dataUrl !== 'string') return null;
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!match) return null;
    // Base64 expands ~4/3, so reject before decoding anything way oversized.
    if (match[2].length > maxBytes * 1.4) return null;
    let buffer: Buffer;
    try {
        buffer = Buffer.from(match[2], 'base64');
    } catch {
        return null;
    }
    if (!buffer.length || buffer.length > maxBytes) return null;
    const isPng = match[1] === 'png';
    return {
        buffer,
        contentType: isPng ? 'image/png' : 'image/jpeg',
        extension: isPng ? 'png' : 'jpg',
    };
}

/**
 * User reports email whenever SMTP + a recipient are configured in
 * production. Outside production, ERROR_REPORT_FORCE_EMAIL=true opts in
 * (mirrors the form-attempt failure email's production gate so local dev
 * does not send real mail by accident).
 */
export function shouldEmailErrorReport(env: Record<string, string | undefined> = process.env): boolean {
    if (env.NODE_ENV === 'production') return true;
    return ['1', 'true', 'yes', 'on'].includes(`${env.ERROR_REPORT_FORCE_EMAIL || ''}`.trim().toLowerCase());
}

export function shouldRunErrorReportAiTriage(env: Record<string, string | undefined> = process.env): boolean {
    const disabled = ['1', 'true', 'yes', 'on'].includes(`${env.ERROR_REPORT_AI_TRIAGE_DISABLED || ''}`.trim().toLowerCase());
    if (disabled) return false;
    const hasKey = !!env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'your-openai-api-key-here';
    if (!hasKey) return false;
    if (env.NODE_ENV === 'production') return true;
    return ['1', 'true', 'yes', 'on'].includes(`${env.ERROR_REPORT_AI_TRIAGE_FORCE || ''}`.trim().toLowerCase());
}

function escapeHtml(value: unknown): string {
    return `${value ?? ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function buildErrorReportEmail(
    report: NormalizedErrorReport,
    options: { hasScreenshot: boolean; dashboardUrl?: string } & ErrorReportIncidentMetadata
): { subject: string; html: string } {
    const subjectTarget = report.projectName || report.property || report.submitterEmail || report.attemptId;
    const subject = `[Menu Manager] Incident ${options.incidentId}: ${subjectTarget}`;

    const rows: Array<[string, string]> = [
        ['Incident ID', options.incidentId],
        ['Reported By', [report.submitterName, report.submitterEmail].filter(Boolean).join(' — ')],
        ['Property', report.property],
        ['Project', report.projectName],
        ['Mode', report.submissionMode],
        ['Triggered From', report.trigger],
        ['Error On Screen', report.context],
        ['Attempt', report.attemptId],
        ['Page', report.pageUrl],
        ['Viewport', report.viewport],
        ['Browser', report.userAgent],
        ['Saved On Server', options.savedTo || 'not saved'],
        ['State JSON', `${options.stateJsonLength || 0} chars saved`],
        ['Screenshot', options.hasScreenshot ? `${options.screenshotBytes || 0} bytes saved on server` : `Not captured${report.screenshotError ? ` (${report.screenshotError})` : ''}`],
    ];

    const htmlRows = rows
        .filter(([, value]) => value)
        .map(([label, value]) => `<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold;width:160px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 12px">${escapeHtml(value)}</td></tr>`)
        .join('');

    const alertItems = report.recentAlerts
        .map((alert) => `<li><code>${escapeHtml(alert.time)}</code> [${escapeHtml(alert.type)}] ${escapeHtml(alert.message)}</li>`)
        .join('');
    const alertsBlock = alertItems
        ? `<h3 style="margin:18px 0 6px">Recent on-page alerts (newest last)</h3><ul style="margin:0;padding-left:20px">${alertItems}</ul>`
        : '';

    const dashboardLink = options.dashboardUrl
        ? `<p style="margin-top:18px"><a href="${escapeHtml(options.dashboardUrl)}/learning">Open form attempts dashboard</a></p>`
        : '';

    const html = [
        '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">',
        `<h2 style="margin:0 0 12px">Incident ${escapeHtml(options.incidentId)} reported from the public form</h2>`,
        '<p style="margin:0 0 14px">The full report is saved by the dashboard. Use the incident id with Codex/support to inspect the saved JSON, screenshot, and attempt telemetry.</p>',
        `<table style="border-collapse:collapse;border:1px solid #ddd">${htmlRows}</table>`,
        alertsBlock,
        dashboardLink,
        '</div>',
    ].join('');

    return { subject, html };
}

function compactForPrompt(value: unknown, depth = 0): any {
    if (value === null || value === undefined) return value ?? null;
    if (depth >= 4) return '[max depth reached]';
    if (typeof value === 'string') {
        if (value.length <= 5000) return value;
        return `${value.slice(0, 5000)}... [truncated ${value.length - 5000} chars]`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => compactForPrompt(item, depth + 1));
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .slice(0, 80)
                .map(([key, entryValue]) => [key, compactForPrompt(entryValue, depth + 1)])
        );
    }
    return `${value}`;
}

export function buildErrorReportTriagePrompt(
    report: NormalizedErrorReport,
    incident: ErrorReportIncidentMetadata
): string {
    const state = report.state || {};
    const compactState = {
        page: state.page,
        appState: state.appState,
        aiCheck: state.aiCheck,
        menuEditor: state.menuEditor
            ? {
                menuTextLength: state.menuEditor.menuTextLength,
                menuHtmlLength: state.menuEditor.menuHtmlLength,
                menuTextPreview: compactForPrompt(state.menuEditor.menuText || ''),
                menuHtmlPreview: compactForPrompt(state.menuEditor.menuHtml || ''),
            }
            : undefined,
        recentAlerts: state.recentAlerts || report.recentAlerts,
    };

    return [
        'You are triaging a production Menu Manager public-form incident.',
        '',
        'App context:',
        '- Menu Manager is an Express/EJS microservice app for chef menu submission review.',
        '- Dashboard service runs the public form, Basic AI Check, modification/redline flows, and ClickUp handoff.',
        '- Problem reports are saved under tmp/error-reports/<incidentId>/ with report.json, client-state.json, and screenshot when captured.',
        '- Common failure areas: payload/body limits, stale Basic AI Check state, uploaded-unapproved redline extraction, critical AI suggestions, form validation, DB/Supabase persistence, ClickUp handoff, Graph/SMTP alert mail.',
        '',
        'Write a concise engineering triage proposal with:',
        '1. likely cause',
        '2. evidence from the incident',
        '3. immediate operator action',
        '4. recommended code/config fix',
        '5. what to verify next',
        '',
        'Incident metadata:',
        JSON.stringify({
            incidentId: incident.incidentId,
            savedTo: incident.savedTo || null,
            stateJsonLength: incident.stateJsonLength || 0,
            screenshotBytes: incident.screenshotBytes || 0,
            attemptId: report.attemptId,
            trigger: report.trigger,
            context: report.context,
            pageUrl: report.pageUrl,
            submitterEmail: report.submitterEmail,
            property: report.property,
            projectName: report.projectName,
            submissionMode: report.submissionMode,
            userAgent: report.userAgent,
            viewport: report.viewport,
            screenshotError: report.screenshotError,
            recentAlerts: report.recentAlerts,
        }, null, 2),
        '',
        'Compact client state:',
        JSON.stringify(compactForPrompt(compactState), null, 2),
    ].join('\n');
}

export function buildErrorReportTriageEmail(
    report: NormalizedErrorReport,
    incident: ErrorReportIncidentMetadata,
    proposal: string,
    options: { model: string; dashboardUrl?: string }
): { subject: string; html: string } {
    const subjectTarget = report.projectName || report.property || report.submitterEmail || report.attemptId;
    const subject = `[Menu Manager] AI triage for ${incident.incidentId}: ${subjectTarget}`;
    const dashboardLink = options.dashboardUrl
        ? `<p style="margin-top:18px"><a href="${escapeHtml(options.dashboardUrl)}/learning">Open form attempts dashboard</a></p>`
        : '';
    const html = [
        '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">',
        `<h2 style="margin:0 0 12px">AI triage proposal for ${escapeHtml(incident.incidentId)}</h2>`,
        `<p style="margin:0 0 12px;color:#555">Model: ${escapeHtml(options.model)}. Saved report: ${escapeHtml(incident.savedTo || 'not saved')}.</p>`,
        `<pre style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #ddd;padding:12px">${escapeHtml(proposal)}</pre>`,
        dashboardLink,
        '</div>',
    ].join('');
    return { subject, html };
}

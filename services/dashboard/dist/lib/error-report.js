"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SCREENSHOT_BYTES = void 0;
exports.truncateStateForReport = truncateStateForReport;
exports.normalizeErrorReport = normalizeErrorReport;
exports.decodeScreenshotDataUrl = decodeScreenshotDataUrl;
exports.shouldEmailErrorReport = shouldEmailErrorReport;
exports.buildErrorReportEmail = buildErrorReportEmail;
const upload_security_1 = require("./upload-security");
// User-initiated problem reports from the public submission form.
// The client sends a full-page screenshot (data URL) plus a JSON snapshot of
// everything filled out on the page so failures can be debugged without
// asking the submitter to reproduce anything.
exports.MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // decoded image bytes
const MAX_STATE_STRING_LENGTH = 200000;
const MAX_STATE_KEYS = 250;
const MAX_STATE_ARRAY_ITEMS = 250;
const MAX_STATE_DEPTH = 6;
const MAX_RECENT_ALERTS = 25;
function text(value, maxLength, multiline = false) {
    return (0, upload_security_1.sanitizePlainTextInput)(value, { maxLength, multiline });
}
/**
 * Recursively bound the client state snapshot so a hostile or buggy client
 * cannot blow up the email attachment / disk copy. Strings keep generous
 * limits because menu text and redline HTML are the most useful fields.
 */
function truncateStateForReport(value, depth = 0) {
    if (value === null || value === undefined)
        return value ?? null;
    if (depth >= MAX_STATE_DEPTH)
        return '[max depth reached]';
    if (typeof value === 'string') {
        if (value.length <= MAX_STATE_STRING_LENGTH)
            return value;
        return `${value.slice(0, MAX_STATE_STRING_LENGTH)}… [truncated ${value.length - MAX_STATE_STRING_LENGTH} chars]`;
    }
    if (typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_STATE_ARRAY_ITEMS).map((item) => truncateStateForReport(item, depth + 1));
        if (value.length > MAX_STATE_ARRAY_ITEMS)
            items.push(`[+${value.length - MAX_STATE_ARRAY_ITEMS} more items truncated]`);
        return items;
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .slice(0, MAX_STATE_KEYS)
            .map(([key, entryValue]) => [key.slice(0, 200), truncateStateForReport(entryValue, depth + 1)]));
    }
    return `${value}`;
}
function normalizeRecentAlerts(value) {
    if (!Array.isArray(value))
        return [];
    return value.slice(-MAX_RECENT_ALERTS).map((alert) => ({
        time: text(alert?.time, 40),
        type: text(alert?.type, 20),
        message: text(alert?.message, 1000),
    })).filter((alert) => alert.message);
}
function normalizeErrorReport(body) {
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
function decodeScreenshotDataUrl(dataUrl, maxBytes = exports.MAX_SCREENSHOT_BYTES) {
    if (typeof dataUrl !== 'string')
        return null;
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!match)
        return null;
    // Base64 expands ~4/3, so reject before decoding anything way oversized.
    if (match[2].length > maxBytes * 1.4)
        return null;
    let buffer;
    try {
        buffer = Buffer.from(match[2], 'base64');
    }
    catch {
        return null;
    }
    if (!buffer.length || buffer.length > maxBytes)
        return null;
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
function shouldEmailErrorReport(env = process.env) {
    if (env.NODE_ENV === 'production')
        return true;
    return ['1', 'true', 'yes', 'on'].includes(`${env.ERROR_REPORT_FORCE_EMAIL || ''}`.trim().toLowerCase());
}
function escapeHtml(value) {
    return `${value ?? ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function buildErrorReportEmail(report, options) {
    const subjectTarget = report.projectName || report.property || report.submitterEmail || report.attemptId;
    const subject = `[Menu Manager] User problem report: ${subjectTarget}`;
    const rows = [
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
        ['Screenshot', options.hasScreenshot ? 'Attached' : `Not captured${report.screenshotError ? ` (${report.screenshotError})` : ''}`],
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
        '<h2 style="margin:0 0 12px">A submitter clicked “Report this problem”</h2>',
        '<p style="margin:0 0 14px">The full client-side form state is attached as <strong>client-state.json</strong>; the page screenshot is attached when capture succeeded.</p>',
        `<table style="border-collapse:collapse;border:1px solid #ddd">${htmlRows}</table>`,
        alertsBlock,
        dashboardLink,
        '</div>',
    ].join('');
    return { subject, html };
}

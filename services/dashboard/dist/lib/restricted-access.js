"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESTRICTED_DASHBOARD_SESSION_MS = exports.RESTRICTED_DASHBOARD_ERROR = exports.RESTRICTED_DASHBOARD_DEFAULT_NEXT = exports.RESTRICTED_DASHBOARD_COOKIE = void 0;
exports.buildRestrictedDashboardCookieValue = buildRestrictedDashboardCookieValue;
exports.parseCookieHeader = parseCookieHeader;
exports.isRestrictedDashboardPinValid = isRestrictedDashboardPinValid;
exports.sanitizeRestrictedDashboardNext = sanitizeRestrictedDashboardNext;
exports.isRestrictedDashboardRequestAuthorized = isRestrictedDashboardRequestAuthorized;
exports.requireRestrictedDashboardAccess = requireRestrictedDashboardAccess;
const crypto_1 = require("crypto");
const LEARNING_DASHBOARD_PIN = `${process.env.LEARNING_DASHBOARD_PIN || '4826'}`.trim();
exports.RESTRICTED_DASHBOARD_COOKIE = 'mm_restricted_dashboard_access';
exports.RESTRICTED_DASHBOARD_DEFAULT_NEXT = '/learning';
exports.RESTRICTED_DASHBOARD_ERROR = 'A valid 4-digit PIN is required to access learning and training tools.';
exports.RESTRICTED_DASHBOARD_SESSION_MS = 12 * 60 * 60 * 1000;
function buildRestrictedDashboardCookieValue(pin = LEARNING_DASHBOARD_PIN) {
    return (0, crypto_1.createHash)('sha256')
        .update(`${exports.RESTRICTED_DASHBOARD_COOKIE}:${pin}`)
        .digest('hex');
}
function parseCookieHeader(cookieHeader = '') {
    return `${cookieHeader || ''}`
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .reduce((cookies, entry) => {
        const separatorIdx = entry.indexOf('=');
        if (separatorIdx <= 0)
            return cookies;
        const key = entry.substring(0, separatorIdx).trim();
        const rawValue = entry.substring(separatorIdx + 1).trim();
        if (!key)
            return cookies;
        try {
            cookies[key] = decodeURIComponent(rawValue);
        }
        catch {
            cookies[key] = rawValue;
        }
        return cookies;
    }, {});
}
function constantTimeEqual(left, right) {
    const leftBuffer = Buffer.from(`${left || ''}`);
    const rightBuffer = Buffer.from(`${right || ''}`);
    if (leftBuffer.length !== rightBuffer.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(leftBuffer, rightBuffer);
}
function isRestrictedDashboardPinValid(pin) {
    const trimmed = `${pin || ''}`.trim();
    return /^\d{4}$/.test(trimmed) && constantTimeEqual(trimmed, LEARNING_DASHBOARD_PIN);
}
function sanitizeRestrictedDashboardNext(nextPath) {
    const trimmed = `${nextPath || ''}`.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//'))
        return exports.RESTRICTED_DASHBOARD_DEFAULT_NEXT;
    if (trimmed.startsWith('/restricted-access'))
        return exports.RESTRICTED_DASHBOARD_DEFAULT_NEXT;
    return trimmed;
}
function isRestrictedDashboardRequestAuthorized(req) {
    const cookies = parseCookieHeader(req.headers.cookie || '');
    return constantTimeEqual(cookies[exports.RESTRICTED_DASHBOARD_COOKIE] || '', buildRestrictedDashboardCookieValue());
}
function buildRestrictedDashboardRedirect(req) {
    const nextPath = sanitizeRestrictedDashboardNext(req.originalUrl || req.url || exports.RESTRICTED_DASHBOARD_DEFAULT_NEXT);
    return `/restricted-access?next=${encodeURIComponent(nextPath)}`;
}
function requireRestrictedDashboardAccess(req, res, next) {
    if (isRestrictedDashboardRequestAuthorized(req)) {
        next();
        return;
    }
    if ((req.originalUrl || '').startsWith('/api/')) {
        res.status(401).json({ error: exports.RESTRICTED_DASHBOARD_ERROR });
        return;
    }
    res.redirect(buildRestrictedDashboardRedirect(req));
}

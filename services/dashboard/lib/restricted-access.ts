import { createHash, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

const LEARNING_DASHBOARD_PIN = `${process.env.LEARNING_DASHBOARD_PIN || '4826'}`.trim();
export const RESTRICTED_DASHBOARD_COOKIE = 'mm_restricted_dashboard_access';
export const RESTRICTED_DASHBOARD_DEFAULT_NEXT = '/learning';
export const RESTRICTED_DASHBOARD_ERROR = 'A valid 4-digit PIN is required to access learning and training tools.';
export const RESTRICTED_DASHBOARD_SESSION_MS = 12 * 60 * 60 * 1000;

export function buildRestrictedDashboardCookieValue(pin = LEARNING_DASHBOARD_PIN): string {
    return createHash('sha256')
        .update(`${RESTRICTED_DASHBOARD_COOKIE}:${pin}`)
        .digest('hex');
}

export function parseCookieHeader(cookieHeader = ''): Record<string, string> {
    return `${cookieHeader || ''}`
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .reduce((cookies, entry) => {
            const separatorIdx = entry.indexOf('=');
            if (separatorIdx <= 0) return cookies;
            const key = entry.substring(0, separatorIdx).trim();
            const rawValue = entry.substring(separatorIdx + 1).trim();
            if (!key) return cookies;
            try {
                cookies[key] = decodeURIComponent(rawValue);
            } catch {
                cookies[key] = rawValue;
            }
            return cookies;
        }, {} as Record<string, string>);
}

function constantTimeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(`${left || ''}`);
    const rightBuffer = Buffer.from(`${right || ''}`);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isRestrictedDashboardPinValid(pin: string): boolean {
    const trimmed = `${pin || ''}`.trim();
    return /^\d{4}$/.test(trimmed) && constantTimeEqual(trimmed, LEARNING_DASHBOARD_PIN);
}

export function sanitizeRestrictedDashboardNext(nextPath: string): string {
    const trimmed = `${nextPath || ''}`.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return RESTRICTED_DASHBOARD_DEFAULT_NEXT;
    if (trimmed.startsWith('/restricted-access')) return RESTRICTED_DASHBOARD_DEFAULT_NEXT;
    return trimmed;
}

export function isRestrictedDashboardRequestAuthorized(req: Request): boolean {
    const cookies = parseCookieHeader(req.headers.cookie || '');
    return constantTimeEqual(
        cookies[RESTRICTED_DASHBOARD_COOKIE] || '',
        buildRestrictedDashboardCookieValue()
    );
}

function buildRestrictedDashboardRedirect(req: Request): string {
    const nextPath = sanitizeRestrictedDashboardNext(req.originalUrl || req.url || RESTRICTED_DASHBOARD_DEFAULT_NEXT);
    return `/restricted-access?next=${encodeURIComponent(nextPath)}`;
}

export function requireRestrictedDashboardAccess(req: Request, res: Response, next: NextFunction): void {
    if (isRestrictedDashboardRequestAuthorized(req)) {
        next();
        return;
    }

    if ((req.originalUrl || '').startsWith('/api/')) {
        res.status(401).json({ error: RESTRICTED_DASHBOARD_ERROR });
        return;
    }

    res.redirect(buildRestrictedDashboardRedirect(req));
}

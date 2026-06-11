"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSmtpRuntimeConfig = buildSmtpRuntimeConfig;
function readBoolean(value, fallback) {
    if (value === undefined || value === '')
        return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
function readPort(value, fallback) {
    const parsed = Number.parseInt(`${value || ''}`, 10);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return parsed;
}
function buildSmtpRuntimeConfig(env = process.env) {
    const authMode = `${env.SMTP_AUTH || ''}`.trim().toLowerCase() === 'none' ? 'none' : 'login';
    const host = `${env.SMTP_HOST || ''}`.trim();
    const user = `${env.SMTP_USER || ''}`.trim();
    const pass = env.SMTP_PASS || '';
    const enabled = authMode === 'none'
        ? !!host
        : !!(host && user && pass);
    const fromAddress = `${env.SMTP_FROM || env.GRAPH_MAILBOX_ADDRESS || env.SMTP_USER || 'no-reply@richardsandoval.com'}`.trim();
    if (!enabled) {
        return {
            enabled,
            authMode,
            fromAddress,
            transportOptions: null,
        };
    }
    const transportOptions = {
        host,
        port: readPort(env.SMTP_PORT, authMode === 'none' ? 25 : 587),
        secure: readBoolean(env.SMTP_SECURE, false),
        // Fail fast instead of nodemailer's multi-minute defaults: an
        // unreachable relay (e.g. blocked outbound port 25) must not hold
        // sockets open while callers fire-and-forget.
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 60000,
    };
    if (readBoolean(env.SMTP_REQUIRE_TLS, authMode === 'none')) {
        transportOptions.requireTLS = true;
    }
    if (authMode !== 'none') {
        transportOptions.auth = { user, pass };
    }
    return {
        enabled,
        authMode,
        fromAddress,
        transportOptions,
    };
}

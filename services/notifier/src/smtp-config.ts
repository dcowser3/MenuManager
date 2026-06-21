import { getTenantConfig } from '@menumanager/tenant-config';

type Env = Record<string, string | undefined>;

export type SmtpAuthMode = 'login' | 'none';

export interface SmtpRuntimeConfig {
    enabled: boolean;
    authMode: SmtpAuthMode;
    fromAddress: string;
    transportOptions: Record<string, any> | null;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readPort(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(`${value || ''}`, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

export function buildSmtpRuntimeConfig(env: Env = process.env as Env): SmtpRuntimeConfig {
    const authMode: SmtpAuthMode = `${env.SMTP_AUTH || ''}`.trim().toLowerCase() === 'none' ? 'none' : 'login';
    const host = `${env.SMTP_HOST || ''}`.trim();
    const user = `${env.SMTP_USER || ''}`.trim();
    const pass = env.SMTP_PASS || '';
    const enabled = authMode === 'none'
        ? !!host
        : !!(host && user && pass);
    const fromAddress = `${env.SMTP_FROM || env.GRAPH_MAILBOX_ADDRESS || env.SMTP_USER || getTenantConfig().emails.from}`.trim();

    if (!enabled) {
        return {
            enabled,
            authMode,
            fromAddress,
            transportOptions: null,
        };
    }

    const transportOptions: Record<string, any> = {
        host,
        port: readPort(env.SMTP_PORT, authMode === 'none' ? 25 : 587),
        secure: readBoolean(env.SMTP_SECURE, false),
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

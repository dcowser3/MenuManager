import crypto from 'crypto';

export const INTERNAL_SERVICE_AUTH_HEADER = 'x-menumanager-internal-token';

function safeTimingEqual(a: string, b: string): boolean {
    try {
        const left = Buffer.from(a);
        const right = Buffer.from(b);
        if (left.length !== right.length) return false;
        return crypto.timingSafeEqual(left, right);
    } catch {
        return false;
    }
}

export function getInternalServiceToken(): string {
    return `${process.env.INTERNAL_API_TOKEN || ''}`.trim();
}

export function buildInternalServiceHeaders(headers: Record<string, any> = {}): Record<string, any> {
    const token = getInternalServiceToken();
    if (!token) {
        return { ...headers };
    }

    return {
        ...headers,
        [INTERNAL_SERVICE_AUTH_HEADER]: token,
    };
}

export function withInternalServiceAuth<T extends { headers?: Record<string, any> }>(config?: T): T {
    return {
        ...((config || {}) as T),
        headers: buildInternalServiceHeaders(config?.headers || {}),
    };
}

export function attachInternalServiceAuth(client: any): any {
    if (!client?.interceptors?.request?.use) {
        return client;
    }

    client.interceptors.request.use((config: any) => withInternalServiceAuth(config || {}));
    return client;
}

export function createInternalApiClient(axiosModule: any): any {
    const client = typeof axiosModule?.create === 'function' ? axiosModule.create() : axiosModule;
    return attachInternalServiceAuth(client);
}

export function requireInternalServiceAuth(req: any, res: any, next: any): void {
    const configuredToken = getInternalServiceToken();
    if (!configuredToken) {
        console.error('Rejected internal request because INTERNAL_API_TOKEN is not configured');
        res.status(503).json({ error: 'Internal service auth token not configured' });
        return;
    }

    const presentedToken = `${req.header?.(INTERNAL_SERVICE_AUTH_HEADER) || req.get?.(INTERNAL_SERVICE_AUTH_HEADER) || ''}`.trim();
    if (!presentedToken || !safeTimingEqual(presentedToken, configuredToken)) {
        res.status(401).json({ error: 'Unauthorized internal request' });
        return;
    }

    next();
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTERNAL_SERVICE_AUTH_HEADER = void 0;
exports.getInternalServiceToken = getInternalServiceToken;
exports.buildInternalServiceHeaders = buildInternalServiceHeaders;
exports.withInternalServiceAuth = withInternalServiceAuth;
exports.attachInternalServiceAuth = attachInternalServiceAuth;
exports.createInternalApiClient = createInternalApiClient;
exports.requireInternalServiceAuth = requireInternalServiceAuth;
const crypto_1 = __importDefault(require("crypto"));
exports.INTERNAL_SERVICE_AUTH_HEADER = 'x-menumanager-internal-token';
function safeTimingEqual(a, b) {
    try {
        const left = Buffer.from(a);
        const right = Buffer.from(b);
        if (left.length !== right.length)
            return false;
        return crypto_1.default.timingSafeEqual(left, right);
    }
    catch {
        return false;
    }
}
function getInternalServiceToken() {
    return `${process.env.INTERNAL_API_TOKEN || ''}`.trim();
}
function buildInternalServiceHeaders(headers = {}) {
    const token = getInternalServiceToken();
    if (!token) {
        return { ...headers };
    }
    return {
        ...headers,
        [exports.INTERNAL_SERVICE_AUTH_HEADER]: token,
    };
}
function withInternalServiceAuth(config) {
    return {
        ...(config || {}),
        headers: buildInternalServiceHeaders(config?.headers || {}),
    };
}
function attachInternalServiceAuth(client) {
    if (!client?.interceptors?.request?.use) {
        return client;
    }
    client.interceptors.request.use((config) => withInternalServiceAuth(config || {}));
    return client;
}
function createInternalApiClient(axiosModule) {
    const client = typeof axiosModule?.create === 'function' ? axiosModule.create() : axiosModule;
    return attachInternalServiceAuth(client);
}
function requireInternalServiceAuth(req, res, next) {
    const configuredToken = getInternalServiceToken();
    if (!configuredToken) {
        console.error('Rejected internal request because INTERNAL_API_TOKEN is not configured');
        res.status(503).json({ error: 'Internal service auth token not configured' });
        return;
    }
    const presentedToken = `${req.header?.(exports.INTERNAL_SERVICE_AUTH_HEADER) || req.get?.(exports.INTERNAL_SERVICE_AUTH_HEADER) || ''}`.trim();
    if (!presentedToken || !safeTimingEqual(presentedToken, configuredToken)) {
        res.status(401).json({ error: 'Unauthorized internal request' });
        return;
    }
    next();
}
//# sourceMappingURL=index.js.map
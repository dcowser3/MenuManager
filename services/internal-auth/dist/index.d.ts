export declare const INTERNAL_SERVICE_AUTH_HEADER = "x-menumanager-internal-token";
export declare const DEFAULT_INTERNAL_API_TIMEOUT_MS = 5000;
export declare function getInternalServiceToken(): string;
export declare function getInternalApiTimeoutMs(): number;
export declare function buildInternalServiceHeaders(headers?: Record<string, any>): Record<string, any>;
export declare function withInternalServiceAuth<T extends {
    headers?: Record<string, any>;
}>(config?: T): T;
export declare function withInternalServiceDefaults<T extends {
    headers?: Record<string, any>;
    timeout?: number;
}>(config?: T): T;
export declare function attachInternalServiceAuth(client: any): any;
export declare function createInternalApiClient(axiosModule: any): any;
export declare function requireInternalServiceAuth(req: any, res: any, next: any): void;
//# sourceMappingURL=index.d.ts.map
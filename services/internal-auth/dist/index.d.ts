export declare const INTERNAL_SERVICE_AUTH_HEADER = "x-menumanager-internal-token";
export declare function getInternalServiceToken(): string;
export declare function buildInternalServiceHeaders(headers?: Record<string, any>): Record<string, any>;
export declare function withInternalServiceAuth<T extends {
    headers?: Record<string, any>;
}>(config?: T): T;
export declare function attachInternalServiceAuth(client: any): any;
export declare function createInternalApiClient(axiosModule: any): any;
export declare function requireInternalServiceAuth(req: any, res: any, next: any): void;
//# sourceMappingURL=index.d.ts.map
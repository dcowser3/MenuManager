import {
    INTERNAL_SERVICE_AUTH_HEADER,
    buildInternalServiceHeaders,
    createInternalApiClient,
    requireInternalServiceAuth,
    withInternalServiceAuth,
} from '../src';

describe('internal service auth helpers', () => {
    const originalToken = process.env.INTERNAL_API_TOKEN;

    beforeEach(() => {
        process.env.INTERNAL_API_TOKEN = 'test-internal-token';
    });

    afterEach(() => {
        if (originalToken === undefined) {
            delete process.env.INTERNAL_API_TOKEN;
        } else {
            process.env.INTERNAL_API_TOKEN = originalToken;
        }
        jest.restoreAllMocks();
    });

    test('buildInternalServiceHeaders adds the configured token header', () => {
        expect(buildInternalServiceHeaders({ existing: 'value' })).toEqual({
            existing: 'value',
            [INTERNAL_SERVICE_AUTH_HEADER]: 'test-internal-token',
        });
    });

    test('withInternalServiceAuth preserves config and injects the auth header', () => {
        expect(withInternalServiceAuth({
            timeout: 3000,
            headers: { foo: 'bar' },
        })).toEqual({
            timeout: 3000,
            headers: {
                foo: 'bar',
                [INTERNAL_SERVICE_AUTH_HEADER]: 'test-internal-token',
            },
        });
    });

    test('createInternalApiClient attaches a request interceptor', () => {
        const use = jest.fn();
        const client = {
            interceptors: {
                request: { use },
            },
        };
        const axiosModule = {
            create: jest.fn(() => client),
        };

        expect(createInternalApiClient(axiosModule)).toBe(client);
        expect(use).toHaveBeenCalledTimes(1);

        const interceptor = use.mock.calls[0][0];
        expect(interceptor({ headers: { hello: 'world' } })).toEqual({
            headers: {
                hello: 'world',
                [INTERNAL_SERVICE_AUTH_HEADER]: 'test-internal-token',
            },
        });
    });

    test('requireInternalServiceAuth rejects missing tokens', () => {
        const req = {
            header: jest.fn(() => ''),
            get: jest.fn(() => ''),
        };
        const json = jest.fn();
        const res = {
            status: jest.fn(() => ({ json })),
        };
        const next = jest.fn();

        requireInternalServiceAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(json).toHaveBeenCalledWith({ error: 'Unauthorized internal request' });
        expect(next).not.toHaveBeenCalled();
    });

    test('requireInternalServiceAuth accepts the configured token', () => {
        const req = {
            header: jest.fn((name: string) => name === INTERNAL_SERVICE_AUTH_HEADER ? 'test-internal-token' : ''),
            get: jest.fn(() => ''),
        };
        const res = {
            status: jest.fn(),
        };
        const next = jest.fn();

        requireInternalServiceAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });
});

process.env.INTERNAL_API_TOKEN = 'test-internal-token';
process.env.GRAPH_CLIENT_ID = 'graph-client-id';
process.env.GRAPH_TENANT_ID = 'graph-tenant-id';
process.env.GRAPH_CLIENT_SECRET = 'graph-client-secret';

jest.mock('axios', () => {
    const client = jest.fn();
    client.get = jest.fn();
    client.post = jest.fn();
    client.put = jest.fn();
    client.create = jest.fn(() => client);
    client.interceptors = { request: { use: jest.fn() } };
    return { __esModule: true, default: client };
});

jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn() })) }));
jest.mock('@menumanager/supabase-client', () => ({ __esModule: true, logAlert: jest.fn(), buildAlertEmailHtml: jest.fn(() => '') }));

const axios = require('axios').default;
const app = require('../index').default;

function getHandler(routePath) {
    const layer = app._router.stack.find((entry) => entry.route?.path === routePath && entry.route.methods.get);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function invoke(handler, query) {
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolve({ statusCode: this.statusCode, payload }); },
            type: jest.fn(() => this),
            send(payload) { resolve({ statusCode: this.statusCode, payload }); },
        };
        Promise.resolve(handler({ query }, res)).catch(reject);
    });
}

describe('GET /sharepoint/file', () => {
    beforeEach(() => jest.clearAllMocks());

    test('proxies the newest approved SharePoint DOCX without exposing Graph credentials', async () => {
        axios.get.mockResolvedValue({ data: [{
            asset_type: 'sharepoint_approved_docx',
            storage_path: 'Menus/Brunch/Tan.docx',
            created_at: '2026-07-13T16:53:00Z',
            meta: { drive_id: 'drive-123' },
        }] });
        axios.post.mockResolvedValue({ data: { access_token: 'graph-token', expires_in: 3600 } });
        axios.mockResolvedValue({ data: Buffer.from('docx') });

        const result = await invoke(getHandler('/sharepoint/file'), { submissionId: 'sub-123' });

        expect(result.statusCode).toBe(200);
        expect(result.payload).toEqual(Buffer.from('docx'));
        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://graph.microsoft.com/v1.0/drives/drive-123/root:/Menus/Brunch/Tan.docx:/content',
            responseType: 'arraybuffer',
        }));
    });

    test('returns a clear 404 when no SharePoint asset exists', async () => {
        axios.get.mockResolvedValue({ data: [] });

        await expect(invoke(getHandler('/sharepoint/file'), { submissionId: 'sub-123' }))
            .resolves.toEqual({ statusCode: 404, payload: { error: 'SharePoint approved file not found' } });
    });
});

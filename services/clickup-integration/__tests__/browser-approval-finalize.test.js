process.env.CLICKUP_API_TOKEN = 'test-clickup-token';
process.env.CLICKUP_POST_APPROVAL_STATUS = 'to do';

jest.mock('axios', () => {
    const client = {
        post: jest.fn(),
        get: jest.fn(),
        put: jest.fn(),
        create: jest.fn(),
        interceptors: {
            request: {
                use: jest.fn(),
            },
        },
    };
    client.create.mockReturnValue(client);
    return {
        __esModule: true,
        default: client,
    };
});

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    const { Readable } = require('stream');
    return {
        ...actual,
        existsSync: jest.fn((target) => String(target).includes('.docx') && !String(target).includes('/venv/')),
        createReadStream: jest.fn(() => Readable.from(Buffer.from('docx'))),
        promises: {
            ...actual.promises,
            readFile: jest.fn().mockResolvedValue(Buffer.from('docx')),
        },
    };
});

jest.mock('child_process', () => ({
    exec: jest.fn((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, JSON.stringify({ menu_content: 'RAW MENU', cleaned_menu_content: 'Clean Menu' }), '');
    }),
}));

jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    logAlert: jest.fn(),
    buildAlertEmailHtml: jest.fn(() => ''),
}));

const axios = require('axios').default;
const app = require('../index').default;

function getRouteHandler(method, routePath) {
    const layer = app._router.stack.find(
        (l) =>
            l.route &&
            l.route.path === routePath &&
            l.route.methods &&
            l.route.methods[method.toLowerCase()]
    );
    if (!layer) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
    }
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function invokeJsonHandler(handler, { body = {}, params = {} } = {}) {
    return new Promise((resolve, reject) => {
        const req = { body, params };
        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                resolve({ status: this.statusCode || 200, body: payload });
                return this;
            },
        };
        Promise.resolve(handler(req, res)).catch(reject);
    });
}

describe('browser approval finalize route', () => {
    const finalizeHandler = getRouteHandler('post', '/approval/finalize');

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        axios.get.mockReset();
        axios.post.mockReset();
        axios.put.mockReset();

        axios.get.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('/submissions/sub_approval_1')) {
                return {
                    data: {
                        id: 'sub_approval_1',
                        clickup_task_id: 'cu_123',
                        project_name: 'Spring Menu',
                        property: 'Toro - Chicago',
                        service_period: 'dinner',
                        submitter_email: 'chef@example.com',
                        submitter_name: 'Chef Test',
                        filename: 'Spring Menu.docx',
                        raw_payload: {},
                    },
                };
            }
            if (urlStr.includes('/properties')) {
                return { data: { catalog: [] } };
            }
            return { data: null };
        });

        axios.post.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('/attachment')) {
                return { data: { id: 'att_456' } };
            }
            return { data: {} };
        });

        axios.put.mockResolvedValue({ data: {} });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('uploads the approved docx back to clickup and moves the task to to do', async () => {
        const response = await invokeJsonHandler(finalizeHandler, {
            body: {
                submissionId: 'sub_approval_1',
                approvedPath: '/tmp/documents/sub_approval_1-approved.docx',
                approvedFileName: 'Spring Menu.docx',
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.attachmentUploaded).toBe(true);
        expect(response.body.clickupStatusUpdated).toBe(true);
        expect(response.body.warning).toBeUndefined();

        const attachmentCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123/attachment')
        );
        expect(attachmentCall).toBeTruthy();

        const statusCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123')
        );
        expect(statusCall).toBeTruthy();
        expect(statusCall[1]).toEqual({ status: 'to do' });
    });

    test('does not move the clickup task when the approved docx upload fails', async () => {
        axios.post.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('/attachment')) {
                const error = new Error('upload failed');
                error.response = { data: { err: 'upload failed' } };
                throw error;
            }
            return { data: {} };
        });

        const response = await invokeJsonHandler(finalizeHandler, {
            body: {
                submissionId: 'sub_approval_1',
                approvedPath: '/tmp/documents/sub_approval_1-approved.docx',
                approvedFileName: 'Spring Menu.docx',
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.attachmentUploaded).toBe(false);
        expect(response.body.clickupStatusUpdated).toBe(false);
        expect(response.body.warning).toContain('ClickUp attachment upload failed');
        expect(response.body.warning).toContain('Skipped ClickUp status update to "to do"');

        const statusCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123')
        );
        expect(statusCall).toBeFalsy();
    });
});

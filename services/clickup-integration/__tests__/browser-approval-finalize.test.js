process.env.CLICKUP_API_TOKEN = 'test-clickup-token';
process.env.CLICKUP_LIST_ID = 'list_123';
process.env.CLICKUP_TEAM_ID = 'team_123';
process.env.CLICKUP_ASSIGNEE_ID = '114079264';
process.env.CLICKUP_MARKETING_WATCHER_GROUP_NAME = 'Marketing';
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
            mkdir: jest.fn().mockResolvedValue(undefined),
            writeFile: jest.fn().mockResolvedValue(undefined),
            copyFile: jest.fn().mockResolvedValue(undefined),
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

function invokeWebhookHandler(handler, { body = {} } = {}) {
    return new Promise((resolve, reject) => {
        const req = {
            body,
            rawBody: JSON.stringify(body),
            header: jest.fn(() => undefined),
        };
        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            send(payload) {
                this.payload = payload;
                return this;
            },
            json(payload) {
                this.payload = payload;
                return this;
            },
        };
        Promise.resolve(handler(req, res))
            .then(() => resolve({ status: res.statusCode || 200, body: res.payload }))
            .catch(reject);
    });
}

describe('browser approval finalize route', () => {
    const createTaskHandler = getRouteHandler('post', '/create-task');
    const finalizeHandler = getRouteHandler('post', '/approval/finalize');
    const webhookHandler = getRouteHandler('post', '/webhook/clickup');

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

    test('creates tasks assigned to Isabella and adds Marketing group members as watchers', async () => {
        axios.get.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('https://api.clickup.com/api/v2/group')) {
                return {
                    data: {
                        groups: [
                            {
                                id: 'grp_marketing',
                                name: 'Marketing',
                                members: [
                                    { user: { id: 201 } },
                                    { user: { id: 202 } },
                                ],
                            },
                        ],
                    },
                };
            }
            return { data: null };
        });
        axios.post.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('https://api.clickup.com/api/v2/list/list_123/task')) {
                return { data: { id: 'cu_123' } };
            }
            return { data: {} };
        });

        const response = await invokeJsonHandler(createTaskHandler, {
            body: {
                submissionId: '',
                submitterName: 'Chef Test',
                submitterEmail: 'chef@example.com',
                projectName: 'Spring Menu',
                property: 'Toro - Chicago',
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.taskId).toBe('cu_123');

        const createCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/list/list_123/task')
        );
        expect(createCall).toBeTruthy();
        expect(createCall[1].assignees).toEqual([114079264]);

        const groupCall = axios.get.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/group?')
        );
        expect(groupCall).toBeTruthy();
        expect(String(groupCall[0])).toContain('team_id=team_123');

        const watcherCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123') &&
            call[1]?.watchers
        );
        expect(watcherCall).toBeTruthy();
        expect(watcherCall[1]).toEqual({ watchers: { add: [201, 202], rem: [] } });
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

    test('processes corrected ClickUp uploads when the task moves to to do', async () => {
        axios.get.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr === 'https://api.clickup.com/api/v2/task/cu_todo') {
                return {
                    data: {
                        id: 'cu_todo',
                        status: { status: 'to do' },
                        attachments: [
                            {
                                id: 'att_corrected.docx',
                                title: 'Corrected Menu.docx',
                                extension: 'docx',
                                url: 'https://clickup.example/attachment/corrected.docx',
                                date: '1778457980067',
                            },
                        ],
                    },
                };
            }
            if (urlStr === 'https://clickup.example/attachment/corrected.docx') {
                return { data: Buffer.from('corrected docx') };
            }
            if (urlStr.includes('/submissions/by-clickup-task/cu_todo')) {
                return {
                    data: {
                        id: 'sub_todo_1',
                        clickup_task_id: 'cu_todo',
                        project_name: 'Dinner Menu',
                        property: 'Maya - Dubai',
                        service_period: 'dinner',
                        submitter_email: 'chef@example.com',
                        submitter_name: 'Chef Test',
                        filename: 'Original Menu.docx',
                        ai_draft_path: '/tmp/documents/sub_todo_1-draft.docx',
                        raw_payload: {},
                    },
                };
            }
            if (urlStr.includes('/properties')) {
                return { data: { catalog: [] } };
            }
            return { data: null };
        });

        const response = await invokeWebhookHandler(webhookHandler, {
            body: {
                event: 'taskStatusUpdated',
                task_id: 'cu_todo',
                history_items: [
                    {
                        field: 'status',
                        after: { status: 'to do' },
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        expect(response.body).toBe('OK');

        const compareCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('http://localhost:3006/compare')
        );
        expect(compareCall).toBeTruthy();
        expect(compareCall[1]).toEqual(
            expect.objectContaining({
                submission_id: 'sub_todo_1',
                ai_draft_path: '/tmp/documents/sub_todo_1-draft.docx',
            })
        );
        expect(compareCall[1].final_path).toContain('/sub_todo_1/approved/sub_todo_1-approved.docx');

        const statusCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_todo')
        );
        expect(statusCall).toBeFalsy();
    });

    test('ignores a to do webhook when the latest ClickUp DOCX was already finalized', async () => {
        axios.get.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr === 'https://api.clickup.com/api/v2/task/cu_done') {
                return {
                    data: {
                        id: 'cu_done',
                        status: { status: 'to do' },
                        attachments: [
                            {
                                id: 'att_done.docx',
                                title: 'Corrected Menu.docx',
                                extension: 'docx',
                                url: 'https://clickup.example/attachment/done.docx',
                                date: '1778457980067',
                            },
                        ],
                    },
                };
            }
            if (urlStr.includes('/submissions/by-clickup-task/cu_done')) {
                return {
                    data: {
                        id: 'sub_done_1',
                        status: 'approved',
                        final_path: '/tmp/documents/sub_done_1-approved.docx',
                        approved_text_extracted_at: '2026-05-11T00:06:30.000Z',
                        clickup_task_id: 'cu_done',
                        project_name: 'Dinner Menu',
                        property: 'Maya - Dubai',
                        filename: 'Original Menu.docx',
                        ai_draft_path: '/tmp/documents/sub_done_1-draft.docx',
                        raw_payload: {},
                    },
                };
            }
            return { data: null };
        });

        await invokeWebhookHandler(webhookHandler, {
            body: {
                event: 'taskStatusUpdated',
                task_id: 'cu_done',
                history_items: [
                    {
                        field: 'status',
                        after: { status: 'to do' },
                    },
                ],
            },
        });

        const compareCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('http://localhost:3006/compare')
        );
        expect(compareCall).toBeFalsy();
    });
});

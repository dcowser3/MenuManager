process.env.CLICKUP_API_TOKEN = 'test-clickup-token';
process.env.CLICKUP_LIST_ID = 'list_123';
process.env.CLICKUP_TEAM_ID = 'team_123';
process.env.CLICKUP_ASSIGNEE_ID = '114079264';
process.env.CLICKUP_MARKETING_WATCHER_GROUP_NAME = 'Marketing';
process.env.CLICKUP_CORRECTIONS_STATUS = 'approved';
process.env.CLICKUP_POST_APPROVAL_STATUS = 'to do';
process.env.CLICKUP_WEBHOOK_SUBMISSION_LOOKUP_RETRIES = '2';
process.env.CLICKUP_WEBHOOK_SUBMISSION_LOOKUP_RETRY_DELAY_MS = '1';
process.env.GRAPH_CLIENT_ID = 'graph-client-id';
process.env.GRAPH_TENANT_ID = 'graph-tenant-id';
process.env.GRAPH_CLIENT_SECRET = 'graph-client-secret';

jest.mock('axios', () => {
    const client = jest.fn();
    client.post = jest.fn();
    client.get = jest.fn();
    client.put = jest.fn();
    client.create = jest.fn();
    client.interceptors = {
        request: {
            use: jest.fn(),
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
        cb(null, JSON.stringify({ menu_content: 'RAW MENU', cleaned_menu_content: 'Clean Menu', cleaned_menu_html: '<p><strong>Clean</strong> Menu</p>' }), '');
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
const { logAlert } = require('@menumanager/supabase-client');
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
        axios.mockReset();
        logAlert.mockClear();

        axios.mockImplementation(async (config) => {
            const urlStr = String(config?.url || '');
            if (urlStr.includes('https://graph.microsoft.com/v1.0/drives/drive_selected/')) {
                if (urlStr.includes(':/children')) {
                    return { data: { value: [] } };
                }
                if (urlStr.includes(':/content')) {
                    return { data: { webUrl: 'https://sharepoint.example/Toro_Dinner_11.6.23.docx' } };
                }
            }
            return { data: {} };
        });

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
            if (urlStr.includes('login.microsoftonline.com')) {
                return { data: { access_token: 'graph-token', expires_in: 3600 } };
            }
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
        expect(createCall[1].notify_all).toBe(true);

        const notificationCommentCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123/comment')
        );
        expect(notificationCommentCall).toBeTruthy();
        expect(notificationCommentCall[1]).toEqual({
            comment_text: [
                'New Menu Manager submission is ready for Isabella review.',
                'Project: Spring Menu',
                'Property: Toro - Chicago',
            ].join('\n'),
            assignee: 114079264,
            notify_all: true,
        });

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

    test('keeps task creation successful when reviewer notification comment fails', async () => {
        axios.post.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('https://api.clickup.com/api/v2/list/list_123/task')) {
                return { data: { id: 'cu_notify_fail' } };
            }
            if (urlStr.includes('https://api.clickup.com/api/v2/task/cu_notify_fail/comment')) {
                const error = new Error('ClickUp comment rejected');
                error.response = { data: { err: 'comment permission denied' } };
                throw error;
            }
            return { data: {} };
        });

        const response = await invokeJsonHandler(createTaskHandler, {
            body: {
                submissionId: 'sub-notify-fail',
                submitterName: 'Chef Test',
                submitterEmail: 'chef@example.com',
                projectName: 'Spring Menu',
                property: 'Toro - Chicago',
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.taskId).toBe('cu_notify_fail');
        expect(response.body.warning).toContain('Reviewer notification comment failed: comment permission denied');
    });

    test('routes Isabella submissions directly to To Do with Marketing as assignees when corrections status is approved', async () => {
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
                return { data: { id: 'cu_isa' } };
            }
            return { data: {} };
        });

        const response = await invokeJsonHandler(createTaskHandler, {
            body: {
                submissionId: 'form-isa',
                submitterName: 'Isabella Sandoval',
                submitterEmail: 'isabella@richardsandoval.com',
                projectName: 'Final Review Menu',
                property: 'Toro - Chicago',
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.taskId).toBe('cu_isa');

        const createCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/list/list_123/task')
        );
        expect(createCall).toBeTruthy();
        expect(createCall[1].status).toBe('to do');
        expect(createCall[1].status).not.toBe('approved');
        expect(createCall[1].assignees).toEqual([201, 202]);
        expect(createCall[1].assignees).not.toContain(114079264);
        expect(createCall[1].notify_all).toBeUndefined();
        expect(axios.post.mock.calls.some((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_isa/comment')
        )).toBe(false);

        const dbUpdateCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('http://localhost:3004/submissions/form-isa')
        );
        expect(dbUpdateCall).toBeTruthy();
        expect(dbUpdateCall[1]).toEqual({
            clickup_task_id: 'cu_isa',
            status: 'sent_to_marketing',
        });
    });

    test('describes modification workflow source with human-readable ClickUp labels', async () => {
        axios.post.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('https://api.clickup.com/api/v2/list/list_123/task')) {
                return { data: { id: 'cu_mod' } };
            }
            return { data: {} };
        });

        const response = await invokeJsonHandler(createTaskHandler, {
            body: {
                submitterName: 'Chef Test',
                submitterEmail: 'chef@example.com',
                projectName: 'Updated Dinner Menu',
                property: 'Toro - Chicago',
                submissionMode: 'modification',
                revisionSource: 'uploaded_baseline',
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const createCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/list/list_123/task')
        );
        expect(createCall).toBeTruthy();
        expect(createCall[1].description).toContain(
            "- Submission Mode: Modification to Existing Menu - I'll make menu changes here (Upload Prior Approved DOCX)"
        );
        expect(createCall[1].description).toContain('- Revision Source: Uploaded prior approved DOCX');
        expect(createCall[1].description).not.toContain('- Submission Mode: modification');
        expect(createCall[1].description).not.toContain('- Revision Source: uploaded_baseline');
    });

    test('uploads the approved docx back to clickup, assigns Marketing, and moves the task to to do', async () => {
        const response = await invokeJsonHandler(finalizeHandler, {
            body: {
                submissionId: 'sub_approval_1',
                approvedPath: '/tmp/documents/sub_approval_1-approved.docx',
                approvedFileName: 'Spring Menu.docx',
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.attachmentUploaded).toBe(true);
        expect(response.body.clickupMarketingAssigneesUpdated).toBe(true);
        expect(response.body.marketingAssigneeCount).toBe(2);
        expect(response.body.clickupStatusUpdated).toBe(true);
        expect(response.body.warning).toBeUndefined();

        const attachmentCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123/attachment')
        );
        expect(attachmentCall).toBeTruthy();

        const assigneeCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123') &&
            call[1]?.assignees
        );
        expect(assigneeCall).toBeTruthy();
        expect(assigneeCall[1]).toEqual({ assignees: { add: [201, 202], rem: [114079264] } });

        const statusCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123') &&
            call[1]?.status
        );
        expect(statusCall).toBeTruthy();
        expect(statusCall[1]).toEqual({ status: 'to do' });

        const approvedUpdateCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('/submissions/sub_approval_1') && call[1]?.status === 'approved'
        );
        expect(approvedUpdateCall[1]).toEqual(expect.objectContaining({
            approved_menu_content: 'Clean Menu',
            approved_menu_content_html: '<p><strong>Clean</strong> Menu</p>',
        }));
    });

    test('triggers differ compare for uploaded-baseline modifications finalized from the approval editor', async () => {
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
            if (urlStr.includes('/submissions/sub_uploaded_baseline_1')) {
                return {
                    data: {
                        id: 'sub_uploaded_baseline_1',
                        clickup_task_id: 'cu_uploaded_baseline',
                        project_name: 'Uploaded Baseline Dinner Menu',
                        property: 'Toro - Chicago',
                        service_period: 'dinner',
                        submitter_email: 'chef@example.com',
                        submitter_name: 'Chef Test',
                        filename: 'Uploaded Baseline Dinner Menu.docx',
                        submission_mode: 'modification',
                        revision_source: 'uploaded_baseline',
                        revision_baseline_doc_path: '/tmp/documents/sub_uploaded_baseline_1/baseline/legacy-approved.docx',
                        original_path: '/tmp/documents/sub_uploaded_baseline_1/original/submitted-generated.docx',
                        ai_draft_path: '/tmp/documents/sub_uploaded_baseline_1/ai-draft.docx',
                        raw_payload: {},
                    },
                };
            }
            if (urlStr.includes('/properties')) {
                return { data: { catalog: [] } };
            }
            return { data: null };
        });

        const approvedPath = '/tmp/documents/sub_uploaded_baseline_1/approved/browser-approved.docx';
        const response = await invokeJsonHandler(finalizeHandler, {
            body: {
                submissionId: 'sub_uploaded_baseline_1',
                approvedPath,
                approvedFileName: 'Uploaded Baseline Dinner Menu.docx',
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const compareCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('http://localhost:3006/compare')
        );
        expect(compareCall).toBeTruthy();
        expect(compareCall[1]).toEqual({
            submission_id: 'sub_uploaded_baseline_1',
            ai_draft_path: '/tmp/documents/sub_uploaded_baseline_1/ai-draft.docx',
            final_path: approvedPath,
            original_path: '/tmp/documents/sub_uploaded_baseline_1/original/submitted-generated.docx',
            comparison_source: 'human_review_final_approval',
            review_source: 'browser_approval_editor',
            review_completed_at: expect.any(String),
            changed_by_human: true,
        });
        expect(compareCall[1].final_path).not.toBe('/tmp/documents/sub_uploaded_baseline_1/baseline/legacy-approved.docx');
    });

    test('still moves the task to to do when Marketing assignment fails', async () => {
        axios.put.mockImplementation(async (_url, payload) => {
            if (payload?.assignees) {
                const error = new Error('assignment failed');
                error.response = { data: { err: 'assignment failed' } };
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
        expect(response.body.attachmentUploaded).toBe(true);
        expect(response.body.clickupMarketingAssigneesUpdated).toBe(false);
        expect(response.body.marketingAssigneeCount).toBe(0);
        expect(response.body.clickupStatusUpdated).toBe(true);
        expect(response.body.warning).toContain('Marketing assignee update failed');

        const statusCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123') &&
            call[1]?.status
        );
        expect(statusCall).toBeTruthy();
        expect(statusCall[1]).toEqual({ status: 'to do' });
    });

    test('uploads approved docx to a pre-synced SharePoint drive and keeps the local fallback asset', async () => {
        axios.get.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('/submissions/sub_approval_1')) {
                return {
                    data: {
                        id: 'sub_approval_1',
                        clickup_task_id: 'cu_123',
                        project_name: 'Spring Menu',
                        property: 'Toro - Fairmont Millennium Park - Chicago',
                        service_period: 'Dinner',
                        date_needed: '2023-11-06',
                        submitter_email: 'chef@example.com',
                        submitter_name: 'Chef Test',
                        filename: 'Spring Menu.docx',
                        raw_payload: {},
                    },
                };
            }
            if (urlStr.includes('/properties/validate')) {
                return {
                    data: {
                        valid: true,
                        property: {
                            name: 'Toro - Fairmont Millennium Park - Chicago',
                            sharepoint_drive_id: 'drive_selected',
                            sharepoint_base_folder_path: 'Toro by Chef Richard Sandoval/Marketing - Locations/Chicago/Menus',
                            sharepoint_service_folders: ['Dinner', 'Lunch'],
                        },
                    },
                };
            }
            return { data: null };
        });

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
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[sharepoint-upload] start '));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[sharepoint-upload] target_resolved '));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[sharepoint-upload] success '));

        const graphUrls = axios.mock.calls.map((call) => String(call[0]?.url || ''));
        expect(graphUrls.some((url) => url.includes('/sites/'))).toBe(false);
        expect(graphUrls.some((url) =>
            url.includes('/drives/drive_selected/root:/') && url.includes('/Dinner:/children')
        )).toBe(true);
        expect(graphUrls.some((url) =>
            url.includes('/drives/drive_selected/root:/') && url.includes('/Toro_Dinner_11.6.23.docx:/content')
        )).toBe(true);

        const localAssetCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('http://localhost:3004/assets') &&
            call[1]?.asset_type === 'approved_docx'
        );
        expect(localAssetCall).toBeTruthy();

        const sharePointAssetCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('http://localhost:3004/assets') &&
            call[1]?.asset_type === 'sharepoint_approved_docx'
        );
        expect(sharePointAssetCall).toBeTruthy();
        expect(sharePointAssetCall[1]).toEqual(expect.objectContaining({
            storage_provider: 'sharepoint',
            storage_path: expect.stringContaining('Toro_Dinner_11.6.23.docx'),
            file_name: 'Toro_Dinner_11.6.23.docx',
        }));
    });

    test('resolves the default SharePoint document library when Graph names it Documents', async () => {
        axios.mockImplementation(async (config) => {
            const urlStr = String(config?.url || '');
            if (urlStr.includes('/sites/richardsandoval.sharepoint.com:/sites/Toro2')) {
                return { data: { id: 'site_alias' } };
            }
            if (urlStr.includes('/sites/site_alias/drives')) {
                return { data: { value: [{ id: 'drive_documents', name: 'Documents' }] } };
            }
            if (urlStr.includes('https://graph.microsoft.com/v1.0/drives/drive_documents/')) {
                if (urlStr.includes(':/children')) {
                    return { data: { value: [] } };
                }
                if (urlStr.includes(':/content')) {
                    return { data: { webUrl: 'https://sharepoint.example/Toro_Dinner_11.6.23.docx' } };
                }
            }
            return { data: {} };
        });
        axios.get.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('/submissions/sub_approval_1')) {
                return {
                    data: {
                        id: 'sub_approval_1',
                        clickup_task_id: 'cu_123',
                        project_name: 'Spring Menu',
                        property: 'Toro - Fairmont Millennium Park - Chicago',
                        service_period: 'Dinner',
                        date_needed: '2023-11-06',
                        submitter_email: 'chef@example.com',
                        submitter_name: 'Chef Test',
                        filename: 'Spring Menu.docx',
                        raw_payload: {},
                    },
                };
            }
            if (urlStr.includes('/properties/validate')) {
                return {
                    data: {
                        valid: true,
                        property: {
                            name: 'Toro - Fairmont Millennium Park - Chicago',
                            sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/Toro2',
                            sharepoint_library_name: 'Shared Documents',
                            sharepoint_base_folder_path: 'Toro by Chef Richard Sandoval/Marketing - Locations/Chicago/Menus',
                            sharepoint_service_folders: ['Dinner', 'Lunch'],
                        },
                    },
                };
            }
            return { data: null };
        });

        const response = await invokeJsonHandler(finalizeHandler, {
            body: {
                submissionId: 'sub_approval_1',
                approvedPath: '/tmp/documents/sub_approval_1-approved.docx',
                approvedFileName: 'Spring Menu.docx',
            },
        });

        expect(response.status).toBe(200);
        const graphUrls = axios.mock.calls.map((call) => String(call[0]?.url || ''));
        expect(graphUrls.some((url) => url.includes('/sites/site_alias/drives'))).toBe(true);
        expect(graphUrls.some((url) =>
            url.includes('/drives/drive_documents/root:/') && url.includes('/Toro_Dinner_11.6.23.docx:/content')
        )).toBe(true);
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
        expect(response.body.clickupMarketingAssigneesUpdated).toBe(false);
        expect(response.body.marketingAssigneeCount).toBe(0);
        expect(response.body.clickupStatusUpdated).toBe(false);
        expect(response.body.warning).toContain('ClickUp attachment upload failed');
        expect(response.body.warning).toContain('Skipped Marketing assignee update');
        expect(response.body.warning).toContain('Skipped ClickUp status update to "to do"');

        const taskUpdateCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_123')
        );
        expect(taskUpdateCall).toBeFalsy();
    });

    test('processes corrected ClickUp uploads when the task moves to to do', async () => {
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
                comparison_source: 'human_review_final_approval',
                review_source: 'isabella_clickup',
                review_completed_at: expect.any(String),
                changed_by_human: true,
            })
        );
        expect(compareCall[1].final_path).toContain('/sub_todo_1/approved/sub_todo_1-approved.docx');

        const assigneeCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_todo') &&
            call[1]?.assignees
        );
        expect(assigneeCall).toBeTruthy();
        expect(assigneeCall[1]).toEqual({ assignees: { add: [201, 202], rem: [114079264] } });

        const statusCall = axios.put.mock.calls.find((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_todo') &&
            call[1]?.status
        );
        expect(statusCall).toBeFalsy();
    });

    test('ignores approved status webhooks without loading or mutating the task', async () => {
        const response = await invokeWebhookHandler(webhookHandler, {
            body: {
                event: 'taskStatusUpdated',
                task_id: 'cu_manual_approved',
                history_items: [
                    {
                        field: 'status',
                        before: { status: 'pending initial isa review' },
                        after: { status: 'approved' },
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        expect(response.body).toBe('OK');
        expect(axios.get).not.toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
        expect(axios.put).not.toHaveBeenCalled();
    });

    test('skips Isabella direct handoff when a review-complete webhook is received later', async () => {
        axios.get.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr === 'https://api.clickup.com/api/v2/task/cu_isa_direct') {
                return {
                    data: {
                        id: 'cu_isa_direct',
                        status: { status: 'to do' },
                        list: { id: 'list_123' },
                        attachments: [
                            {
                                id: 'att_isa_corrected.docx',
                                title: 'Isabella Event Menu.docx',
                                extension: 'docx',
                                url: 'https://clickup.example/attachment/isabella-event.docx',
                                date: '1778457980067',
                            },
                        ],
                    },
                };
            }
            if (urlStr.includes('/submissions/by-clickup-task/cu_isa_direct')) {
                return {
                    data: {
                        id: 'form-isa',
                        clickup_task_id: 'cu_isa_direct',
                        status: 'sent_to_marketing',
                        project_name: 'Final Review Menu',
                        property: 'Toro - Chicago',
                        service_period: 'dinner',
                        submitter_email: 'isabella@richardsandoval.com',
                        submitter_name: 'Isabella Sandoval',
                        filename: 'Final Review Menu.docx',
                        raw_payload: {},
                    },
                };
            }
            if (urlStr === 'https://clickup.example/attachment/isabella-event.docx') {
                return { data: Buffer.from('should not download') };
            }
            return { data: null };
        });

        const response = await invokeWebhookHandler(webhookHandler, {
            body: {
                event: 'taskStatusUpdated',
                task_id: 'cu_isa_direct',
                history_items: [
                    {
                        field: 'status',
                        before: { status: 'approved' },
                        after: { status: 'to do' },
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        expect(response.body).toBe('OK');
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('direct Isabella-to-Marketing handoff')
        );
        expect(axios.get.mock.calls.some((call) =>
            String(call[0]) === 'https://clickup.example/attachment/isabella-event.docx'
        )).toBe(false);
        expect(axios.post.mock.calls.some((call) =>
            String(call[0]).includes('http://localhost:3006/compare')
        )).toBe(false);
        expect(axios.put.mock.calls.some((call) =>
            String(call[0]).includes('https://api.clickup.com/api/v2/task/cu_isa_direct')
        )).toBe(false);
        expect(axios.put.mock.calls.some((call) =>
            String(call[0]).includes('http://localhost:3004/submissions/form-isa')
        )).toBe(false);
    });

    test('ignores review-complete webhooks for tasks outside the configured menu list', async () => {
        axios.get.mockImplementation(async (url) => {
            const urlStr = String(url);
            if (urlStr === 'https://api.clickup.com/api/v2/task/cu_other_list') {
                return {
                    data: {
                        id: 'cu_other_list',
                        status: { status: 'to do' },
                        list: { id: 'marketing_list' },
                        attachments: [],
                    },
                };
            }
            return { data: null };
        });

        const response = await invokeWebhookHandler(webhookHandler, {
            body: {
                event: 'taskStatusUpdated',
                task_id: 'cu_other_list',
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
        expect(axios.get.mock.calls.some((call) =>
            String(call[0]).includes('/submissions/by-clickup-task/cu_other_list')
        )).toBe(false);
        expect(logAlert).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not configured Menu Manager list'));
    });

    test('retries a menu-task webhook submission lookup before alerting', async () => {
        let lookupAttempts = 0;
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
            if (urlStr === 'https://api.clickup.com/api/v2/task/cu_retry') {
                return {
                    data: {
                        id: 'cu_retry',
                        status: { status: 'to do' },
                        list: { id: 'list_123' },
                        attachments: [
                            {
                                id: 'att_retry.docx',
                                title: 'Corrected Retry Menu.docx',
                                extension: 'docx',
                                url: 'https://clickup.example/attachment/retry.docx',
                                date: '1778457980067',
                            },
                        ],
                    },
                };
            }
            if (urlStr === 'https://clickup.example/attachment/retry.docx') {
                return { data: Buffer.from('corrected docx') };
            }
            if (urlStr.includes('/submissions/by-clickup-task/cu_retry')) {
                lookupAttempts += 1;
                if (lookupAttempts === 1) {
                    const notFound = new Error('Request failed with status code 404');
                    notFound.response = {
                        status: 404,
                        data: { error: 'No submission found for this ClickUp task' },
                    };
                    throw notFound;
                }
                return {
                    data: {
                        id: 'sub_retry_1',
                        clickup_task_id: 'cu_retry',
                        project_name: 'Retry Dinner Menu',
                        property: 'Maya - Dubai',
                        service_period: 'dinner',
                        submitter_email: 'chef@example.com',
                        submitter_name: 'Chef Test',
                        filename: 'Original Retry Menu.docx',
                        ai_draft_path: '/tmp/documents/sub_retry_1-draft.docx',
                        raw_payload: {},
                    },
                };
            }
            if (urlStr.includes('/properties')) {
                return { data: { catalog: [] } };
            }
            return { data: null };
        });

        await invokeWebhookHandler(webhookHandler, {
            body: {
                event: 'taskStatusUpdated',
                task_id: 'cu_retry',
                history_items: [
                    {
                        field: 'status',
                        after: { status: 'to do' },
                    },
                ],
            },
        });

        expect(lookupAttempts).toBe(2);
        expect(logAlert).not.toHaveBeenCalledWith(expect.objectContaining({
            alert_type: 'clickup_webhook_failed',
        }));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('retrying lookup 1/2'));

        const compareCall = axios.post.mock.calls.find((call) =>
            String(call[0]).includes('http://localhost:3006/compare')
        );
        expect(compareCall).toBeTruthy();
        expect(compareCall[1]).toEqual(expect.objectContaining({
            submission_id: 'sub_retry_1',
            review_source: 'isabella_clickup',
        }));
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
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[sharepoint-upload] source_attachment_selected '));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[sharepoint-upload] not_attempted '));
    });
});

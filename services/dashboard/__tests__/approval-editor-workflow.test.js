jest.mock('axios', () => ({
    __esModule: true,
    default: {
        post: jest.fn(),
        get: jest.fn(),
        put: jest.fn(),
    },
}));
jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            mkdir: jest.fn().mockResolvedValue(undefined),
            writeFile: jest.fn().mockResolvedValue(undefined),
            unlink: jest.fn().mockResolvedValue(undefined),
            access: jest.fn().mockRejectedValue(new Error('not found')),
            copyFile: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
            readFile: jest.fn().mockResolvedValue(''),
            readdir: jest.fn().mockResolvedValue([]),
        },
    };
});
jest.mock('child_process', () => ({
    exec: jest.fn((cmd, opts, cb) => {
        if (typeof opts === 'function') {
            cb = opts;
        }
        cb(null, '', '');
    }),
}));
jest.mock('mammoth', () => ({
    extractRawText: jest.fn().mockResolvedValue({ value: 'Guacamole - $12' }),
}));
jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    isSupabaseConfigured: jest.fn(() => false),
    extractAndStoreDishes: jest.fn().mockResolvedValue({ added: 0 }),
    logAlert: jest.fn().mockResolvedValue(undefined),
    buildAlertEmailHtml: jest.fn(() => ''),
}));

const axios = require('axios').default;
const fs = require('fs');
const actualFs = jest.requireActual('fs');
const path = jest.requireActual('path');
const app = require('../index').default;
const mockedAxios = axios;

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

describe('Browser Approval Editor Workflow (local, mocked externals)', () => {
    const submitHandler = getRouteHandler('post', '/api/approval/:submissionId/submit');

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        fs.promises.mkdir.mockClear();
        fs.promises.writeFile.mockClear();
        fs.promises.unlink.mockClear();
        fs.promises.access.mockClear();
        fs.promises.copyFile.mockClear();
        fs.promises.rename.mockClear();
        fs.promises.readFile.mockClear();
        fs.promises.readdir.mockClear();

        mockedAxios.post = jest.fn(async (url, payload) => {
            const urlStr = String(url);

            if (urlStr.includes('http://localhost:3007/approval/finalize')) {
                return { data: { success: true, processed: true } };
            }

            return { data: {} };
        });

        mockedAxios.get = jest.fn(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('http://localhost:3004/submissions/sub_approval_1')) {
                return {
                    data: {
                        id: 'sub_approval_1',
                        project_name: 'Spring Menu',
                        property: 'Toro - Chicago',
                        orientation: 'Portrait',
                        menu_type: 'standard',
                        template_type: 'food',
                        date_needed: '2026-05-06',
                        asset_type: 'PRINT',
                        width: '8.5',
                        height: '11',
                        print_width: '8.5',
                        print_height: '11',
                        print_region: 'US',
                        filename: 'Spring Menu.docx',
                        clickup_task_id: 'cu_123',
                        raw_payload: {
                            allergens: 'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan',
                            menuContent: 'Toro Tartare 18',
                            printWidth: '8.5',
                            printHeight: '11',
                            assetType: 'PRINT',
                            templateType: 'food',
                            menuType: 'standard',
                        },
                    },
                };
            }

            return { data: null };
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('generates approved docx from editor HTML and forwards it to clickup finalization', async () => {
        const response = await invokeJsonHandler(submitHandler, {
            params: { submissionId: 'sub_approval_1' },
            body: {
                editorHtml: '<p>Toro <span class="existing-del">Taratre</span><span class="existing-ins">Tartare</span> 18</p>',
                menuContentText: 'Toro Tartare 18',
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const finalizeCall = mockedAxios.post.mock.calls.find((call) =>
            String(call[0]).includes('http://localhost:3007/approval/finalize')
        );
        expect(finalizeCall).toBeTruthy();
        expect(finalizeCall[1].submissionId).toBe('sub_approval_1');
        expect(finalizeCall[1].approvedFileName).toBe('Spring Menu.docx');
        expect(finalizeCall[1].approvedPath).toContain('/approved/sub_approval_1-approved.docx');

        const formDataWrite = fs.promises.writeFile.mock.calls.find((call) =>
            String(call[0]).includes('sub_approval_1_formdata.json')
        );
        expect(formDataWrite).toBeTruthy();
        const serialized = JSON.parse(formDataWrite[1]);
        expect(serialized.menuContent).toBe('Toro Tartare 18');
        expect(serialized.menuContentHtml).toContain('existing-ins');
        expect(serialized.allergens).toContain('D contains dairy');
    });

    test('rejects empty editor submissions', async () => {
        const response = await invokeJsonHandler(submitHandler, {
            params: { submissionId: 'sub_approval_1' },
            body: {
                editorHtml: '',
                menuContentText: '',
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Approval editor content is required');
    });

    test('approval editor uses reusable worker-backed preview controller', () => {
        const template = actualFs.readFileSync(
            path.join(__dirname, '..', 'views', 'approval-editor.ejs'),
            'utf8'
        );
        const controller = actualFs.readFileSync(
            path.join(__dirname, '..', 'public', 'js', 'approval-preview-controller.js'),
            'utf8'
        );
        const worker = actualFs.readFileSync(
            path.join(__dirname, '..', 'public', 'js', 'approval-preview-worker.js'),
            'utf8'
        );

        expect(template).toContain('previewAnnotationsJson');
        expect(template).toContain('/js/approval-preview-controller.js');
        expect(template).toContain('previewLoading');
        expect(template).toContain('Updating Preview');
        expect(template).toContain('createApprovalPreviewController');
        expect(template).not.toContain('refreshPreviewBtn');
        expect(controller).toContain('new global.Worker');
        expect(controller).toContain('approval-preview-worker.js');
        expect(controller).toContain('forceRichPreview');
        expect(controller).toContain('queuedRequest');
        expect(controller).toContain('workerTimeoutMs');
        expect(controller).toContain('superseded');
        expect(controller).toContain('buildAnnotationMapFromParagraphAnnotations');
        expect(controller).toContain('buildAnnotationMapFromHtml');
        expect(worker).toContain("importScripts('/js/diff-core.js', '/js/redline-preview.js')");
        expect(worker).toContain('renderPersistentPreview');
    });
});

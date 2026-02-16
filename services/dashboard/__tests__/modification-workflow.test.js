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

const axios = require('axios').default;
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
    // Route stack can include multiple handlers; here submit route has one function.
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function invokeJsonHandler(handler, body) {
    return new Promise((resolve, reject) => {
        const req = { body };
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

describe('Dashboard Modification Workflow (local, mocked externals)', () => {
    const submitHandler = getRouteHandler('post', '/api/form/submit');

    beforeEach(() => {
        mockedAxios.post = jest.fn(async (url, payload) => {
            const urlStr = String(url);

            if (urlStr.includes('http://localhost:3004/submissions')) {
                return { data: { id: payload.id || 'form-test-id' } };
            }
            if (urlStr.includes('http://localhost:3004/submitter-profiles')) {
                return { data: { ok: true } };
            }
            if (urlStr.includes('http://localhost:3004/assets')) {
                return { data: { id: 'asset_123' } };
            }
            if (urlStr.includes('http://localhost:3002/ai-review')) {
                throw new Error('AI service mocked unavailable');
            }
            if (urlStr.includes('http://localhost:3007/create-task')) {
                return { data: { success: true } };
            }

            return { data: {} };
        });

        mockedAxios.put = jest.fn(async () => ({ data: { ok: true } }));
        mockedAxios.get = jest.fn(async () => ({ data: [] }));
    });

    test('accepts modification submission using DB baseline and persists revision fields', async () => {
        const payload = {
            submitterName: 'Chef Test',
            submitterEmail: 'chef@example.com',
            submitterJobTitle: 'Executive Chef',
            projectName: 'Test Project',
            property: 'Test Property',
            width: '8.5',
            height: '11',
            cropMarks: 'no',
            bleedMarks: 'no',
            fileSizeLimit: 'no',
            fileSizeLimitMb: '',
            fileDeliveryNotes: '',
            orientation: 'Portrait',
            menuType: 'standard',
            templateType: 'food',
            dateNeeded: '2026-03-01',
            hotelName: '',
            cityCountry: 'Denver, USA',
            assetType: 'PRINT',
            menuContent: 'Guacamole - $12',
            menuContentHtml: '<p>Guacamole - $12</p>',
            approvals: [{ approved: true, name: 'GM', position: 'GM' }],
            criticalOverrides: [],
            submissionMode: 'modification',
            revisionSource: 'database',
            revisionBaseSubmissionId: 'sub_approved_1',
            revisionBaselineDocPath: '',
            revisionBaselineFileName: '',
            baseApprovedMenuContent: 'Guacamole - $10',
            chefPersistentDiff: { insertions: 1, deletions: 1 },
        };

        const response = await invokeJsonHandler(submitHandler, payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const submissionCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('http://localhost:3004/submissions')
        );
        expect(submissionCall).toBeTruthy();
        expect(submissionCall[1].submission_mode).toBe('modification');
        expect(submissionCall[1].revision_source).toBe('database');
        expect(submissionCall[1].revision_base_submission_id).toBe('sub_approved_1');
        expect(submissionCall[1].base_approved_menu_content).toBe('Guacamole - $10');
    });

    test('accepts modification submission using uploaded baseline and forwards baseline file to clickup payload', async () => {
        const payload = {
            submitterName: 'Chef Test',
            submitterEmail: 'chef@example.com',
            submitterJobTitle: 'Executive Chef',
            projectName: 'Legacy Project',
            property: 'Legacy Property',
            width: '1080',
            height: '1920',
            cropMarks: 'no',
            bleedMarks: 'no',
            fileSizeLimit: 'no',
            fileSizeLimitMb: '',
            fileDeliveryNotes: '',
            orientation: 'Portrait',
            menuType: 'standard',
            templateType: 'food',
            dateNeeded: '2026-03-02',
            hotelName: '',
            cityCountry: 'Miami, USA',
            assetType: 'DIGITAL',
            menuContent: 'Ceviche - $15',
            menuContentHtml: '<p>Ceviche - $15</p>',
            approvals: [{ approved: true, name: 'GM', position: 'GM' }],
            criticalOverrides: [],
            submissionMode: 'modification',
            revisionSource: 'uploaded_baseline',
            revisionBaseSubmissionId: null,
            revisionBaselineDocPath: '/tmp/uploads/legacy-approved.docx',
            revisionBaselineFileName: 'legacy-approved.docx',
            baseApprovedMenuContent: 'Ceviche - $14',
            chefPersistentDiff: { insertions: 2, deletions: 1 },
        };

        const response = await invokeJsonHandler(submitHandler, payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const clickupCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('http://localhost:3007/create-task')
        );
        expect(clickupCall).toBeTruthy();
        expect(clickupCall[1].revisionSource).toBe('uploaded_baseline');
        expect(clickupCall[1].revisionBaselineDocPath).toBe('/tmp/uploads/legacy-approved.docx');
        expect(clickupCall[1].revisionBaselineFileName).toBe('legacy-approved.docx');
    });
});

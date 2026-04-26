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
    const basicCheckHandler = getRouteHandler('post', '/api/form/basic-check');

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
        fs.promises.readFile.mockResolvedValue('');

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
            if (urlStr.includes('http://localhost:3002/run-qa-check')) {
                return {
                    data: {
                        feedback: '=== CORRECTED MENU ===\nNO CHANGES\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ==='
                    }
                };
            }
            if (urlStr.includes('http://localhost:3007/create-task')) {
                return { data: { success: true } };
            }

            return { data: {} };
        });

        mockedAxios.put = jest.fn(async () => ({ data: { ok: true } }));
        mockedAxios.get = jest.fn(async (url) => {
            const urlStr = String(url);

            if (urlStr.includes('http://localhost:3004/properties')) {
                return {
                    data: {
                        catalog: [
                            { name: 'Test Property', city_country: 'Denver, USA' },
                            { name: 'Legacy Property', city_country: 'Miami, USA' },
                        ],
                    },
                };
            }

            return { data: [] };
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
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
            printWidth: '8.5',
            printHeight: '11',
            printRegion: 'US',
            printSize: '',
            folded: 'no',
            digitalWidth: '',
            digitalHeight: '',
            cropMarks: 'no',
            bleedMarks: 'no',
            fileSizeLimit: 'no',
            fileSizeLimitMb: '',
            fileDeliveryNotes: '',
            orientation: 'Portrait',
            menuType: 'standard',
            servicePeriod: 'dinner',
            templateType: 'food',
            turnaroundDays: 2,
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
            printWidth: '',
            printHeight: '',
            printRegion: '',
            printSize: '',
            folded: '',
            digitalWidth: '1080',
            digitalHeight: '1920',
            cropMarks: 'no',
            bleedMarks: 'no',
            fileSizeLimit: 'no',
            fileSizeLimitMb: '',
            fileDeliveryNotes: '',
            orientation: 'Portrait',
            menuType: 'standard',
            servicePeriod: 'dinner',
            templateType: 'food',
            turnaroundDays: 2,
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
        expect(clickupCall[1].criticalOverrides).toEqual([]);
    });

    test('submission strips existing footer boilerplate and reuses it without duplication', async () => {
        const payload = {
            submitterName: 'Chef Test',
            submitterEmail: 'chef@example.com',
            submitterJobTitle: 'Executive Chef',
            projectName: 'Footer Project',
            property: 'Test Property',
            width: '8.5',
            height: '11',
            printWidth: '8.5',
            printHeight: '11',
            printRegion: 'US',
            printSize: '',
            folded: 'no',
            digitalWidth: '',
            digitalHeight: '',
            cropMarks: 'no',
            bleedMarks: 'no',
            fileSizeLimit: 'no',
            fileSizeLimitMb: '',
            fileDeliveryNotes: '',
            orientation: 'Portrait',
            menuType: 'standard',
            servicePeriod: 'dinner',
            templateType: 'food',
            turnaroundDays: 5,
            dateNeeded: '2026-03-03',
            hotelName: '',
            cityCountry: 'Denver, USA',
            assetType: 'PRINT',
            allergens: '',
            containsRawUndercooked: false,
            suppressRawNotice: true,
            menuContent: [
                'STARTERS',
                'Guacamole - $12',
                '',
                'C crustaceans | D dairy | E egg | F fish | G gluten | N nuts | V vegetarian | VG vegan',
                '*consuming raw or undercooked meats, poultry, seafood, or eggs may increase your risk of foodborne illness.',
            ].join('\n'),
            menuContentHtml: [
                '<p>STARTERS</p>',
                '<p>Guacamole - $12</p>',
                '<p>C crustaceans | D dairy | E egg | F fish | G gluten | N nuts | V vegetarian | VG vegan</p>',
                '<p>*consuming raw or undercooked meats, poultry, seafood, or eggs may increase your risk of foodborne illness.</p>',
            ].join(''),
            approvals: [{ approved: true, name: 'GM', position: 'GM' }],
            criticalOverrides: [],
            submissionMode: 'new',
            revisionSource: 'database',
            revisionBaseSubmissionId: '',
            revisionBaselineDocPath: '',
            revisionBaselineFileName: '',
            baseApprovedMenuContent: '',
            chefPersistentDiff: { insertions: 0, deletions: 0 },
        };

        const response = await invokeJsonHandler(submitHandler, payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const formDataWrite = fs.promises.writeFile.mock.calls.find(([filePath]) =>
            String(filePath).endsWith('_formdata.json')
        );
        expect(formDataWrite).toBeTruthy();

        const generatedFormData = JSON.parse(formDataWrite[1]);
        expect(generatedFormData.menuContent).toBe('STARTERS\nGuacamole - $12');
        expect(generatedFormData.allergens).toBe('C crustaceans | D dairy | E egg | F fish | G gluten | N nuts | V vegetarian | VG vegan');
        expect(generatedFormData.shouldAddRawNotice).toBe(true);
        expect(generatedFormData.menuContentHtml).toContain('<p>STARTERS</p>');
        expect(generatedFormData.menuContentHtml).toContain('<p>Guacamole - $12</p>');
        expect(generatedFormData.menuContentHtml).not.toContain('foodborne illness');
        expect(generatedFormData.menuContentHtml).not.toContain('crustaceans');
    });

    test('basic-check changed_only short-circuits when there are no changed lines', async () => {
        const payload = {
            menuContent: 'Guacamole - $12',
            baselineMenuContent: 'Guacamole - $12',
            reviewMode: 'changed_only',
            allergens: '',
            menuType: 'standard',
        };

        const response = await invokeJsonHandler(basicCheckHandler, payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.reviewMode).toBe('changed_only');
        expect(response.body.changedLineCount).toBe(0);
        expect(response.body.suggestions).toEqual([]);

        const qaCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('http://localhost:3002/run-qa-check')
        );
        expect(qaCall).toBeUndefined();
    });

    test('basic-check changed_only sends only changed lines to AI', async () => {
        const payload = {
            menuContent: 'Guacamole - $12\nCeviche - $15',
            baselineMenuContent: 'Guacamole - $12',
            reviewMode: 'changed_only',
            allergens: '',
            menuType: 'standard',
        };

        const response = await invokeJsonHandler(basicCheckHandler, payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.reviewMode).toBe('changed_only');
        expect(response.body.changedLineCount).toBe(1);

        const qaCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('http://localhost:3002/run-qa-check')
        );
        expect(qaCall).toBeTruthy();
        expect(qaCall[1].text).toBe('Ceviche - $15');
    });

    test('basic-check strips managed footer lines before sending content to AI', async () => {
        fs.promises.readFile.mockResolvedValueOnce('QA prompt body');

        const payload = {
            menuContent: [
                'STARTERS',
                'Guacamole - $12',
                '',
                'C crustaceans | D dairy | E egg | F fish | G gluten | N nuts | V vegetarian | VG vegan',
                '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.',
            ].join('\n'),
            baselineMenuContent: '',
            reviewMode: 'full',
            allergens: '',
            menuType: 'standard',
        };

        const response = await invokeJsonHandler(basicCheckHandler, payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const qaCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('http://localhost:3002/run-qa-check')
        );
        expect(qaCall).toBeTruthy();
        expect(qaCall[1].text).toBe('STARTERS\nGuacamole - $12');
        expect(qaCall[1].prompt).toContain('IMPORTANT FOOTER RULES');
        expect(qaCall[1].prompt).toContain('shellfish');
    });
});

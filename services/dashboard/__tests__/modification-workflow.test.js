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
const path = require('path');
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

function invokeJsonHandler(handler, body, options = {}) {
    return new Promise((resolve, reject) => {
        const headers = options.headers || {};
        const req = {
            body,
            query: options.query || {},
            headers,
            hostname: options.hostname,
            get(name) {
                return headers[String(name).toLowerCase()] || headers[name];
            },
        };
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

function postJsonOverHttp(routePath, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, async () => {
            try {
                const address = server.address();
                const port = typeof address === 'object' && address ? address.port : 0;
                const response = await fetch(`http://127.0.0.1:${port}${routePath}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const payload = await response.json();
                resolve({ status: response.status, body: payload });
            } catch (error) {
                reject(error);
            } finally {
                server.close();
            }
        });
    });
}

describe('Dashboard Modification Workflow (local, mocked externals)', () => {
    const submitHandler = getRouteHandler('post', '/api/form/submit');
    const basicCheckHandler = getRouteHandler('post', '/api/form/basic-check');
    const submissionSearchHandler = getRouteHandler('get', '/api/submissions/search');
    const baselineUploadPath = path.join(process.cwd(), 'tmp', 'uploads', 'legacy-approved.docx');
    const originalNodeEnv = process.env.NODE_ENV;

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

            if (urlStr.includes('/submissions')) {
                return { data: { id: payload.id || 'form-test-id' } };
            }
            if (urlStr.includes('/submitter-profiles')) {
                return { data: { ok: true } };
            }
            if (urlStr.includes('/assets')) {
                return { data: { id: 'asset_123' } };
            }
            if (urlStr.includes('/run-qa-check')) {
                const echoText = (payload && typeof payload.text === 'string') ? payload.text : '';
                return {
                    data: {
                        feedback: `=== CORRECTED MENU ===\n${echoText}\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===`
                    }
                };
            }
            if (urlStr.includes('/ai-review')) {
                throw new Error('AI service mocked unavailable');
            }
            if (urlStr.includes('/create-task')) {
                return { data: { success: true } };
            }

            return { data: {} };
        });

        mockedAxios.put = jest.fn(async () => ({ data: { ok: true } }));
        mockedAxios.get = jest.fn(async (url) => {
            const urlStr = String(url);

            if (urlStr.includes('/properties')) {
                return {
                    data: {
                        catalog: [
                            { name: 'Test Property', city_country: 'Denver, USA' },
                            { name: 'Legacy Property', city_country: 'Miami, USA' },
                            { name: 'Aqimero - Ritz-Carlton - Philadelphia', city_country: 'Philadelphia, USA' },
                        ],
                    },
                };
            }

            return { data: [] };
        });
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        jest.restoreAllMocks();
    });

    function buildNewSubmissionPayload(overrides = {}) {
        return {
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
            turnaroundDays: 5,
            dateNeeded: '2026-03-01',
            hotelName: '',
            cityCountry: 'Denver, USA',
            assetType: 'PRINT',
            menuContent: 'Guacamole - $12',
            menuContentHtml: '<p>Guacamole - $12</p>',
            approvals: [{ approved: true, name: 'GM', position: 'GM' }],
            criticalOverrides: [],
            submissionMode: 'new',
            revisionSource: 'database',
            revisionBaseSubmissionId: '',
            revisionBaselineDocPath: '',
            revisionBaselineFileName: '',
            baseApprovedMenuContent: '',
            chefPersistentDiff: { insertions: 0, deletions: 0 },
            ...overrides,
        };
    }

    test('stores generated menu filenames as restaurant, service period, and date', async () => {
        process.env.NODE_ENV = 'production';
        const payload = buildNewSubmissionPayload({
            projectName: 'Seasonal Breakfast Update',
            property: 'Aqimero - Ritz-Carlton - Philadelphia',
            servicePeriod: 'breakfast',
            dateNeeded: '2023-11-06',
        });

        const response = await postJsonOverHttp('/api/form/submit', payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const expectedFilename = 'Aqimero_Breakfast_11.6.23.docx';
        const submissionCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('/submissions')
        );
        expect(submissionCall[1].filename).toBe(expectedFilename);

        const assetCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('/assets') && c[1].asset_type === 'original_docx'
        );
        expect(assetCall[1].file_name).toBe(expectedFilename);

        const aiReviewCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('/ai-review')
        );
        expect(aiReviewCall[1].filename).toBe(expectedFilename);

        const clickupCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('/create-task')
        );
        expect(clickupCall[1].filename).toBe(expectedFilename);
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
            String(c[0]).includes('/submissions')
        );
        expect(submissionCall).toBeTruthy();
        expect(submissionCall[1].submission_mode).toBe('modification');
        expect(submissionCall[1].revision_source).toBe('database');
        expect(submissionCall[1].revision_base_submission_id).toBe('sub_approved_1');
        expect(submissionCall[1].base_approved_menu_content).toBe('Guacamole - $10');
    });

    test('returns local testing download and approval links only for localhost submissions', async () => {
        process.env.NODE_ENV = 'development';
        const response = await invokeJsonHandler(
            submitHandler,
            buildNewSubmissionPayload(),
            { headers: { host: 'localhost:3005' } }
        );

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.localTesting).toEqual({
            downloadUrl: `/download/original/${encodeURIComponent(response.body.submissionId)}`,
            approvalUrl: `/approval/${encodeURIComponent(response.body.submissionId)}`,
        });
        expect(response.body.clickup.taskId).toBeUndefined();
        expect(response.body.clickup.warning).toContain('Local testing mode');
        expect(mockedAxios.post.mock.calls.some((c) =>
            String(c[0]).includes('/create-task')
        )).toBe(false);
    });

    test('does not return local testing links for production or non-local submissions', async () => {
        process.env.NODE_ENV = 'production';
        const productionResponse = await invokeJsonHandler(
            submitHandler,
            buildNewSubmissionPayload({ projectName: 'Production Project' }),
            { headers: { host: 'localhost:3005' } }
        );

        process.env.NODE_ENV = 'development';
        const remoteResponse = await invokeJsonHandler(
            submitHandler,
            buildNewSubmissionPayload({ projectName: 'Remote Project' }),
            { headers: { host: 'menus.example.com' } }
        );

        expect(productionResponse.status).toBe(200);
        expect(productionResponse.body.localTesting).toBeUndefined();
        expect(remoteResponse.status).toBe(200);
        expect(remoteResponse.body.localTesting).toBeUndefined();
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
            revisionBaselineDocPath: baselineUploadPath,
            revisionBaselineFileName: 'legacy-approved.docx',
            baseApprovedMenuContent: 'Ceviche - $14',
            chefPersistentDiff: { insertions: 2, deletions: 1 },
        };

        const response = await invokeJsonHandler(submitHandler, payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const clickupCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('/create-task')
        );
        expect(clickupCall).toBeTruthy();
        expect(clickupCall[1].revisionSource).toBe('uploaded_baseline');
        // Chef-uploaded baseline is no longer forwarded to ClickUp — it's
        // stored locally and recorded in DB assets, but the design team works
        // from the generated DOCX only.
        expect(clickupCall[1].revisionBaselineDocPath).toBeUndefined();
        expect(clickupCall[1].revisionBaselineFileName).toBeUndefined();
        expect(clickupCall[1].criticalOverrides).toEqual([]);
    });

    test('approved submission search forwards DB failures instead of returning empty results', async () => {
        mockedAxios.get = jest.fn(async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('/submissions/search')) {
                const error = new Error('DB unavailable');
                error.response = { status: 503, data: { error: 'DB unavailable' } };
                throw error;
            }
            return { data: [] };
        });

        const response = await invokeJsonHandler(
            submissionSearchHandler,
            {},
            { query: { q: 'derian', limit: '20' } }
        );

        expect(response.status).toBe(503);
        expect(response.body.error).toBe('Failed to search approved submissions');
    });

    test('returns uploaded-baseline modification submit response before Tier 2 AI review completes', async () => {
        let resolveAiReview;
        mockedAxios.post = jest.fn((url, payload) => {
            const urlStr = String(url);

            if (urlStr.includes('/submissions')) {
                return Promise.resolve({ data: { id: payload.id || 'form-test-id' } });
            }
            if (urlStr.includes('/submitter-profiles')) {
                return Promise.resolve({ data: { ok: true } });
            }
            if (urlStr.includes('/assets')) {
                return Promise.resolve({ data: { id: 'asset_123' } });
            }
            if (urlStr.includes('/ai-review')) {
                return new Promise((resolve) => {
                    resolveAiReview = resolve;
                });
            }
            if (urlStr.includes('/create-task')) {
                return Promise.resolve({ data: { success: true, taskId: 'cu_123' } });
            }

            return Promise.resolve({ data: {} });
        });

        const payload = buildNewSubmissionPayload({
            projectName: 'Legacy Project',
            property: 'Legacy Property',
            cityCountry: 'Miami, USA',
            assetType: 'DIGITAL',
            width: '1080',
            height: '1920',
            printWidth: '',
            printHeight: '',
            printRegion: '',
            folded: '',
            digitalWidth: '1080',
            digitalHeight: '1920',
            turnaroundDays: 2,
            submissionMode: 'modification',
            revisionSource: 'uploaded_baseline',
            revisionBaseSubmissionId: '',
            revisionBaselineDocPath: baselineUploadPath,
            revisionBaselineFileName: 'legacy-approved.docx',
            baseApprovedMenuContent: 'Guacamole - $10',
            chefPersistentDiff: { insertions: 1, deletions: 1 },
        });

        const response = await invokeJsonHandler(submitHandler, payload);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.clickup.taskId).toBe('cu_123');
        expect(mockedAxios.post.mock.calls.some((c) =>
            String(c[0]).includes('/ai-review')
        )).toBe(true);
        expect(resolveAiReview).toBeDefined();

        resolveAiReview({ data: { success: true } });
        await Promise.resolve();
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
                'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan',
                '*consuming raw or undercooked meats, poultry, seafood, or eggs may increase your risk of foodborne illness.',
            ].join('\n'),
            menuContentHtml: [
                '<p>STARTERS</p>',
                '<p>Guacamole - $12</p>',
                '<p>G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan</p>',
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
        expect(generatedFormData.allergens).toBe('G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan');
        expect(generatedFormData.footerText).toBe('*consuming raw or undercooked meats, poultry, seafood, or eggs may increase your risk of foodborne illness.');
        expect(generatedFormData.shouldAddRawNotice).toBe(false);
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
            String(c[0]).includes('/run-qa-check')
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
            String(c[0]).includes('/run-qa-check')
        );
        expect(qaCall).toBeTruthy();
        expect(qaCall[1].text).toBe('Ceviche - $15');
    });

    test('basic-check full review sends all text even when modification baseline content exists', async () => {
        const payload = {
            menuContent: 'Guacamole - $12\nMarket Salad, avocado, halloumi cheee, cucumber V 70',
            baselineMenuContent: 'Guacamole - $12\nMarket Salad, avocado, halloumi cheee, cucumber V 70',
            reviewMode: 'full',
            allergens: '',
            menuType: 'standard',
        };

        const response = await invokeJsonHandler(basicCheckHandler, payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.reviewMode).toBe('full');
        expect(response.body.changedLineCount).toBe(0);

        const qaCall = mockedAxios.post.mock.calls.find((c) =>
            String(c[0]).includes('/run-qa-check')
        );
        expect(qaCall).toBeTruthy();
        expect(qaCall[1].text).toBe(payload.menuContent);
    });

    test('basic-check changed_only merges AI high-confidence corrections back into the full menu', async () => {
        mockedAxios.post = jest.fn(async (url, payload) => {
            const urlStr = String(url);
            if (urlStr.includes('/run-qa-check')) {
                // Simulate AI correcting the misspellings on the one changed line.
                return {
                    data: {
                        feedback: '=== CORRECTED MENU ===\nMarket Salad, avocado, heirloom tomatoes, halloumi cheese, cucumber, red onion D, V 70\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ==='
                    }
                };
            }
            return { data: {} };
        });

        const payload = {
            menuContent: 'Guacamole - $12\nMarket Salad, avocado, heirloom tomats, halloumi cheese, cucumbr, red onion D, V 70',
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
        expect(response.body.hasChanges).toBe(true);
        expect(response.body.correctedMenu).toBe(
            'Guacamole - $12\nMarket Salad, avocado, heirloom tomatoes, halloumi cheese, cucumber, red onion D, V 70'
        );
    });

    test('basic-check changed_only bails to original menu when AI returns mismatched line count', async () => {
        mockedAxios.post = jest.fn(async (url, payload) => {
            const urlStr = String(url);
            if (urlStr.includes('/run-qa-check')) {
                // AI returned two lines for a single changed line — unsafe to merge.
                return {
                    data: {
                        feedback: '=== CORRECTED MENU ===\nCeviche - $15\nExtra inserted line\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ==='
                    }
                };
            }
            return { data: {} };
        });

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
        expect(response.body.hasChanges).toBe(false);
        expect(response.body.correctedMenu).toBe('Guacamole - $12\nCeviche - $15');
    });

    test('basic-check strips managed footer lines before sending content to AI', async () => {
        fs.promises.readFile.mockResolvedValueOnce('QA prompt body');

        const payload = {
            menuContent: [
                'STARTERS',
                'Guacamole - $12',
                '',
                'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan',
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
            String(c[0]).includes('/run-qa-check')
        );
        expect(qaCall).toBeTruthy();
        expect(qaCall[1].text).toBe('STARTERS\nGuacamole - $12');
        expect(qaCall[1].prompt).toContain('IMPORTANT FOOTER RULES');
        expect(qaCall[1].prompt).toContain('shellfish');
    });

    test('basic-check strips parenthesized allergen key while preserving legal footer for generation', async () => {
        fs.promises.readFile.mockResolvedValueOnce('QA prompt body');

        const payload = {
            menuContent: [
                'DESSERT',
                'Ice Cream & Sorbets D,E,G,PN,SY,TN 35',
                '(C) CELERY (D) DAIRY (E) EGGS (F) FISH (G) GLUTEN (V) VEGETARIAN',
                'ALL PRICES ARE IN AED, INCLUSIVE OF 7% MUNICIPALITY FEES, 10% SERVICE CHARGE AND 5% VAT.',
                'We welcome enquiries from diners who wish to know whether any dishes contain particular ingredients. Please inform your order-taker of any allergy or special dietary requirements we should be made aware of when preparing your menu request. Consumption of raw or undercooked meat, seafood or poultry products such as eggs may increase your risk of foodborne illness',
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
            String(c[0]).includes('/run-qa-check')
        );
        expect(qaCall).toBeTruthy();
        expect(qaCall[1].text).toBe('DESSERT\nIce Cream & Sorbets D,E,G,PN,SY,TN 35');
        expect(qaCall[1].prompt).toContain('C celery | D dairy | E eggs | F fish | G gluten | V vegetarian');
    });

    test('submit normalizes parenthesized allergen key and preserves AED footer copy', async () => {
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
            menuContent: [
                'DESSERT',
                'Ice Cream & Sorbets D,E,G,PN,SY,TN 35',
                '(C) CELERY (D) DAIRY (E) EGGS (F) FISH (G) GLUTEN (V) VEGETARIAN',
                'ALL PRICES ARE IN AED, INCLUSIVE OF 7% MUNICIPALITY FEES, 10% SERVICE CHARGE AND 5% VAT.',
                'We welcome enquiries from diners who wish to know whether any dishes contain particular ingredients. Please inform your order-taker of any allergy or special dietary requirements we should be made aware of when preparing your menu request. Consumption of raw or undercooked meat, seafood or poultry products such as eggs may increase your risk of foodborne illness',
            ].join('\n'),
            menuContentHtml: [
                '<p>DESSERT</p>',
                '<p>Ice Cream & Sorbets D,E,G,PN,SY,TN 35</p>',
                '<p>(C) CELERY (D) DAIRY (E) EGGS (F) FISH (G) GLUTEN (V) VEGETARIAN</p>',
                '<p>ALL PRICES ARE IN AED, INCLUSIVE OF 7% MUNICIPALITY FEES, 10% SERVICE CHARGE AND 5% VAT.</p>',
                '<p>We welcome enquiries from diners who wish to know whether any dishes contain particular ingredients. Please inform your order-taker of any allergy or special dietary requirements we should be made aware of when preparing your menu request. Consumption of raw or undercooked meat, seafood or poultry products such as eggs may increase your risk of foodborne illness</p>',
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
        const generatedFormData = JSON.parse(formDataWrite[1]);
        expect(generatedFormData.menuContent).toBe('DESSERT\nIce Cream & Sorbets D,E,G,PN,SY,TN 35');
        expect(generatedFormData.allergens).toBe('C celery | D dairy | E eggs | F fish | G gluten | V vegetarian');
        expect(generatedFormData.footerText).toContain('ALL PRICES ARE IN AED');
        expect(generatedFormData.footerText).toContain('We welcome enquiries');
        expect(generatedFormData.shouldAddRawNotice).toBe(false);
        expect(generatedFormData.menuContentHtml).not.toContain('ALL PRICES ARE IN AED');
        expect(generatedFormData.menuContentHtml).not.toContain('(C) CELERY');
    });

    test('submit preserves structured footer text even when editor body was stripped for preview', async () => {
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
            turnaroundDays: 2,
            dateNeeded: '2026-03-03',
            hotelName: '',
            cityCountry: 'Denver, USA',
            assetType: 'PRINT',
            allergens: 'C celery | D dairy | E eggs | F fish | G gluten | V vegetarian',
            containsRawUndercooked: false,
            menuContent: [
                'DESSERT',
                'Ice Cream & Sorbets D,E,G,PN,SY,TN 35',
            ].join('\n'),
            menuContentHtml: [
                '<p>DESSERT</p>',
                '<p>Ice Cream & Sorbets D,E,G,PN,SY,TN 35</p>',
            ].join(''),
            persistentDiffHtml: [
                '<p>DESSERT</p>',
                '<p>Ice Cream & Sorbets D,E,G,PN,SY,TN 35</p>',
            ].join(''),
            preservedFooterText: [
                'ALL PRICES ARE IN AED, INCLUSIVE OF 7% MUNICIPALITY FEES, 10% SERVICE CHARGE AND 5% VAT.',
                'We welcome enquiries from diners who wish to know whether any dishes contain particular ingredients. Please inform your order-taker of any allergy or special dietary requirements we should be made aware of when preparing your menu request. Consumption of raw or undercooked meat, seafood or poultry products such as eggs may increase your risk of foodborne illness',
            ].join('\n'),
            approvals: [{ approved: true, name: 'GM', position: 'GM' }],
            criticalOverrides: [],
            submissionMode: 'modification',
            revisionSource: 'uploaded_unapproved',
            revisionBaseSubmissionId: '',
            revisionBaselineDocPath: baselineUploadPath,
            revisionBaselineFileName: 'unapproved.docx',
            baseApprovedMenuContent: 'DESSERT\nIce Cream & Sorbets D,E,G,PN,SY,TN 35',
            chefPersistentDiff: { insertions: 0, deletions: 0 },
        };

        const response = await invokeJsonHandler(submitHandler, payload);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const formDataWrite = fs.promises.writeFile.mock.calls.find(([filePath]) =>
            String(filePath).endsWith('_formdata.json')
        );
        const generatedFormData = JSON.parse(formDataWrite[1]);
        expect(generatedFormData.menuContent).toBe('DESSERT\nIce Cream & Sorbets D,E,G,PN,SY,TN 35');
        expect(generatedFormData.footerText).toContain('ALL PRICES ARE IN AED');
        expect(generatedFormData.footerText).toContain('We welcome enquiries');
        expect(generatedFormData.shouldAddRawNotice).toBe(false);
        expect(generatedFormData.menuContentHtml).not.toContain('ALL PRICES ARE IN AED');
        expect(generatedFormData.menuContentHtml).not.toContain('We welcome enquiries');
    });
});

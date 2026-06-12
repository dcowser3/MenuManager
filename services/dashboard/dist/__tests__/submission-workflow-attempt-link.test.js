"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const submission_workflow_1 = require("../lib/submission-workflow");
function buildDeps(overrides = {}) {
    const axios = {
        post: jest.fn().mockResolvedValue({ data: {} }),
        put: jest.fn().mockResolvedValue({ data: {} }),
    };
    return {
        axios,
        fs: {
            access: jest.fn().mockResolvedValue(undefined),
            mkdir: jest.fn().mockResolvedValue(undefined),
            copyFile: jest.fn().mockResolvedValue(undefined),
        },
        DB_SERVICE_URL: 'http://db.test',
        AI_REVIEW_URL: 'http://ai.test',
        CLICKUP_SERVICE_URL: 'http://clickup.test',
        DEFAULT_ALLERGEN_KEY: 'V - Vegetarian',
        AI_REVIEW_SUBMIT_TIMEOUT_MS: 1000,
        CLICKUP_TASK_CREATE_TIMEOUT_MS: 1000,
        getTempUploadsDir: () => '/tmp/uploads',
        getSubmissionDocumentDir: () => '/tmp/docs',
        getPropertyCatalogFromDb: jest.fn().mockResolvedValue([{ name: 'Maya - New York' }]),
        resolveCityCountryFromCatalog: () => 'New York, USA',
        normalizeMenuFooter: (text) => ({
            body: text,
            normalizedAllergenLine: '',
            hadRawNotice: false,
            preservedFooterText: '',
        }),
        stripManagedFooterFromHtml: (html) => html,
        detectRawUndercookedContent: () => false,
        generateDocxFromForm: jest.fn().mockResolvedValue('/tmp/docs/test.docx'),
        sendAdminAlert: jest.fn(),
        isClientInputError: () => false,
        linkBasicAiCheckAuditsToSubmission: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}
function buildRequest(headers = {}) {
    return {
        hostname: 'localhost',
        get: (name) => headers[name.toLowerCase()] || '',
        body: {
            submitterName: 'Chef Test',
            submitterEmail: 'chef@example.com',
            submitterJobTitle: 'Executive Chef',
            projectName: 'Spring Menu',
            property: 'Maya - New York',
            orientation: 'portrait',
            menuType: 'standard',
            servicePeriod: 'dinner',
            templateType: 'food',
            dateNeeded: '2026-07-01',
            assetType: 'DIGITAL',
            digitalWidth: '1080',
            digitalHeight: '1920',
            turnaroundDays: '5',
            menuContent: 'GUACAMOLE\nfresh avocado, lime 12',
            skipAiReview: true,
        },
    };
}
function buildResponse() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    return res;
}
describe('submitMenu form attempt linkage', () => {
    test('stores form_attempt_id from the attempt header and links audits to the submission', async () => {
        const deps = buildDeps();
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const req = buildRequest({ 'x-menumanager-attempt-id': 'attempt-link-1' });
        const res = buildResponse();
        await handlers.submitMenu(req, res);
        expect(res.statusCode).toBe(200);
        const submissionPost = deps.axios.post.mock.calls.find(([url]) => url === 'http://db.test/submissions');
        expect(submissionPost).toBeDefined();
        expect(submissionPost[1].form_attempt_id).toBe('attempt-link-1');
        expect(deps.linkBasicAiCheckAuditsToSubmission).toHaveBeenCalledTimes(1);
        const [attemptId, submissionId] = deps.linkBasicAiCheckAuditsToSubmission.mock.calls[0];
        expect(attemptId).toBe('attempt-link-1');
        expect(submissionId).toBe(submissionPost[1].id);
    });
    test('omits the audit link when no attempt id is provided', async () => {
        const deps = buildDeps();
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const req = buildRequest();
        const res = buildResponse();
        await handlers.submitMenu(req, res);
        expect(res.statusCode).toBe(200);
        const submissionPost = deps.axios.post.mock.calls.find(([url]) => url === 'http://db.test/submissions');
        expect(submissionPost[1].form_attempt_id).toBeNull();
        expect(deps.linkBasicAiCheckAuditsToSubmission).not.toHaveBeenCalled();
    });
});

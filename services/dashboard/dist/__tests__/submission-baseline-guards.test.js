"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const submission_workflow_1 = require("../lib/submission-workflow");
const nodePath = require('path');
const nodeFsSync = require('fs');
// Strand-shaped fixture (2026-11-16 incident). Tenant names live only here.
const strand = JSON.parse(nodeFsSync.readFileSync(nodePath.join(__dirname, '..', '..', 'db', '__fixtures__', 'strand-incident.json'), 'utf8'));
const K = strand.keys;
const row = (key) => strand.submissions[K[key]];
// Client shape the db service returns as draft.baseline (subset used here).
function toClientBaseline(submission) {
    return {
        id: submission.legacy_id || submission.id,
        idAliases: [submission.legacy_id, submission.id].filter(Boolean),
        projectName: submission.project_name,
        templateType: submission.template_type,
        servicePeriod: submission.service_period,
        property: submission.property,
    };
}
function activeDraftFor(key, overrides = {}) {
    return {
        id: `draft-${key}`,
        token: `token-${key}`,
        status: 'active',
        base_submission_id: K[key],
        baseline: toClientBaseline(row(key)),
        baselineFreshness: { stale: false, basis: 'menu_pointer', baselineIdForms: [K[key], row(key).id], newerVersion: null },
        ...overrides,
    };
}
function buildDeps(overrides = {}) {
    const axios = {
        post: jest.fn(async (url, payload) => {
            if (String(url).includes('/create-task'))
                return { data: { taskId: `task-${payload.submissionId}` } };
            if (String(url).includes('/submissions'))
                return { data: { id: payload.id } };
            return { data: {} };
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        get: jest.fn().mockResolvedValue({ data: {} }),
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
        getPropertyCatalogFromDb: jest.fn().mockResolvedValue([{ name: strand.property }]),
        resolveCityCountryFromCatalog: () => 'Grace Bay, Turks and Caicos',
        normalizeMenuFooter: (text, allergens) => ({
            body: `${text || ''}`.trim(),
            normalizedAllergenLine: allergens || '',
            hadRawNotice: false,
            preservedFooterText: '',
        }),
        stripManagedFooterFromHtml: (html) => html,
        detectRawUndercookedContent: () => false,
        generateDocxFromForm: jest.fn().mockResolvedValue('/tmp/docs/test.docx'),
        sendAdminAlert: jest.fn(),
        isClientInputError: () => false,
        getDraftSession: jest.fn(),
        getBaselineFreshness: jest.fn(),
        getApprovedBaseline: jest.fn(async (id) => {
            const found = Object.values(strand.submissions).find((s) => s.legacy_id === id || s.id === id);
            if (!found)
                throw Object.assign(new Error('not found'), { response: { status: 404 } });
            return found;
        }),
        logFormAttemptEvent: jest.fn(),
        lockDraftSession: jest.fn(async (_token, submittedId) => ({ id: 'draft-locked', submitted_submission_id: submittedId })),
        ...overrides,
    };
}
// A modification body prefilled from a baseline exactly as the form does.
function modificationBodyFrom(key, overrides = {}) {
    const base = row(key);
    return {
        submitterName: 'Chef Test',
        submitterEmail: 'chef@example.com',
        submitterJobTitle: 'Executive Chef',
        projectName: base.project_name,
        property: base.property,
        orientation: base.orientation,
        menuType: base.menu_type,
        servicePeriod: base.service_period,
        templateType: base.template_type,
        dateNeeded: '2026-11-30',
        assetType: base.asset_type,
        printRegion: 'US',
        printWidth: base.print_width,
        printHeight: base.print_height,
        folded: 'no',
        cropMarks: 'no',
        bleedMarks: 'no',
        fileSizeLimit: 'no',
        turnaroundDays: '2',
        allergens: '',
        menuContent: base.approved_menu_content,
        menuContentHtml: '',
        approvals: [{ approved: true, name: 'Grace GM', position: 'General Manager', email: 'grace@example.com' }],
        skipAiReview: true,
        submissionMode: 'modification',
        revisionSource: 'database',
        revisionBaseSubmissionId: K[key],
        baseApprovedMenuContent: base.approved_menu_content,
        chefPersistentDiff: { insertions: 0, deletions: 0 },
        ...overrides,
    };
}
function buildRequest(body, headers = {}) {
    return {
        hostname: 'menus.example.com',
        get: (name) => headers[name.toLowerCase()] || '',
        body,
    };
}
function buildResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
}
const submissionCreates = (deps) => deps.axios.post.mock.calls.filter((c) => String(c[0]) === 'http://db.test/submissions');
const clickupCreates = (deps) => deps.axios.post.mock.calls.filter((c) => String(c[0]).includes('/create-task'));
function expectNothingCreated(deps) {
    expect(deps.generateDocxFromForm).not.toHaveBeenCalled();
    expect(submissionCreates(deps)).toHaveLength(0);
    expect(clickupCreates(deps)).toHaveLength(0);
    expect(deps.lockDraftSession).not.toHaveBeenCalled();
}
describe('submit guards: draft must match its baseline (item 3)', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => jest.restoreAllMocks());
    test('incident replay: draft for the Cocktail Menu, body for the Sunset Lounge -> 409, nothing created', async () => {
        const deps = buildDeps({ getDraftSession: jest.fn().mockResolvedValue(activeDraftFor('cocktail')) });
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        await handlers.submitMenu(buildRequest(modificationBodyFrom('sunset', { draftSessionToken: 'token-cocktail' }), { 'x-menumanager-attempt-id': 'attempt-incident' }), res);
        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('draft_baseline_mismatch');
        expect(res.body.error).toContain('The Del Mar Cocktail Menu');
        expect(res.body.error).toContain('Nothing was submitted');
        expectNothingCreated(deps);
        expect(deps.sendAdminAlert).not.toHaveBeenCalled();
        expect(deps.logFormAttemptEvent).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'submit_rejected',
            attemptId: 'attempt-incident',
            statusCode: 409,
            details: expect.objectContaining({ code: 'draft_baseline_mismatch', draftBaseSubmissionId: K.cocktail, revisionBaseSubmissionId: K.sunset }),
        }));
    });
    test('accepts the draft baseline addressed by its other public id form (uuid)', async () => {
        const deps = buildDeps({ getDraftSession: jest.fn().mockResolvedValue(activeDraftFor('cocktail')) });
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        const edited = `${row('cocktail').approved_menu_content}\nPineapple Daiquiri - $18`;
        await handlers.submitMenu(buildRequest(modificationBodyFrom('cocktail', {
            draftSessionToken: 'token-cocktail', revisionBaseSubmissionId: row('cocktail').id, menuContent: edited,
        })), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });
    test('stale at submit -> 409 naming the newer version and its approval date', async () => {
        const newer = { id: 'form-1794900000001', projectName: 'The Del Mar Cocktail Menu', reviewedAt: '2026-11-10T09:00:00.000Z' };
        const deps = buildDeps({
            getDraftSession: jest.fn().mockResolvedValue(activeDraftFor('cocktail', {
                baselineFreshness: { stale: true, basis: 'menu_pointer', newerVersion: newer },
            })),
        });
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        await handlers.submitMenu(buildRequest(modificationBodyFrom('cocktail', {
            draftSessionToken: 'token-cocktail', menuContent: `${row('cocktail').approved_menu_content}\nNew Drink - $15`,
        })), res);
        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('draft_baseline_stale');
        expect(res.body.error).toContain('2026-11-10');
        expect(res.body.newerVersion.id).toBe(newer.id);
        expectNothingCreated(deps);
    });
    test('stale at submit is re-checked through the db when the draft payload lacks freshness', async () => {
        const draft = activeDraftFor('cocktail');
        delete draft.baselineFreshness;
        const deps = buildDeps({
            getDraftSession: jest.fn().mockResolvedValue(draft),
            getBaselineFreshness: jest.fn().mockResolvedValue({ stale: true, newerVersion: { id: 'form-x', projectName: 'The Del Mar Cocktail Menu', reviewedAt: '2026-11-11T00:00:00Z' } }),
        });
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        await handlers.submitMenu(buildRequest(modificationBodyFrom('cocktail', {
            draftSessionToken: 'token-cocktail', menuContent: `${row('cocktail').approved_menu_content}\nNew Drink - $15`,
        })), res);
        expect(deps.getBaselineFreshness).toHaveBeenCalledWith(K.cocktail);
        expect(res.statusCode).toBe(409);
        expectNothingCreated(deps);
    });
    test('project name or template type change in a draft requires metadataChangeConfirmed', async () => {
        const deps = buildDeps({ getDraftSession: jest.fn().mockResolvedValue(activeDraftFor('cocktail')) });
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const body = modificationBodyFrom('cocktail', {
            draftSessionToken: 'token-cocktail', projectName: 'The Del Mar Sunset Lounge', templateType: 'food',
        });
        const res = buildResponse();
        await handlers.submitMenu(buildRequest(body), res);
        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('metadata_change_unconfirmed');
        expect(res.body.error).toContain('from "The Del Mar Cocktail Menu" to "The Del Mar Sunset Lounge"');
        expect(res.body.error).toContain('from "beverage" to "food"');
        expectNothingCreated(deps);
        const confirmed = buildResponse();
        await handlers.submitMenu(buildRequest({ ...body, metadataChangeConfirmed: true }), confirmed);
        expect(confirmed.statusCode).toBe(200);
        expect(confirmed.body.success).toBe(true);
    });
});
describe('submit guards: zero-change modifications (item 4)', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => jest.restoreAllMocks());
    test('incident submissions (0 insertions, 0 deletions, no detail change) are rejected', async () => {
        const deps = buildDeps();
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        // The request body's baseApprovedMenuContent is ignored: the guard reads the db row.
        await handlers.submitMenu(buildRequest(modificationBodyFrom('sunset', { baseApprovedMenuContent: 'something else entirely' })), res);
        expect(deps.getApprovedBaseline).toHaveBeenCalledWith(K.sunset);
        expect(res.statusCode).toBe(422);
        expect(res.body.code).toBe('no_changes');
        expect(res.body.error).toContain('The Del Mar Sunset Lounge');
        expectNothingCreated(deps);
    });
    test('whitespace/case-only differences still count as zero change (same comparison as the AI check)', async () => {
        const deps = buildDeps();
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        const noisy = row('wine').approved_menu_content.split('\n').map((l) => `  ${l.toUpperCase()}  `).join('\n\n');
        await handlers.submitMenu(buildRequest(modificationBodyFrom('wine', { menuContent: noisy })), res);
        expect(res.statusCode).toBe(422);
    });
    test('a one-word edit is accepted', async () => {
        const deps = buildDeps();
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        const edited = row('sunset').approved_menu_content.replace('Tuna Crudo', 'Salmon Crudo');
        await handlers.submitMenu(buildRequest(modificationBodyFrom('sunset', { menuContent: edited })), res);
        expect(res.statusCode).toBe(200);
        expect(submissionCreates(deps)).toHaveLength(1);
    });
    test('a deletion-only edit is accepted', async () => {
        const deps = buildDeps();
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        const edited = row('sunset').approved_menu_content.split('\n').filter((l) => !l.startsWith('Truffle')).join('\n');
        await handlers.submitMenu(buildRequest(modificationBodyFrom('sunset', { menuContent: edited })), res);
        expect(res.statusCode).toBe(200);
    });
    test('a size-only change is accepted', async () => {
        const deps = buildDeps();
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        await handlers.submitMenu(buildRequest(modificationBodyFrom('sunset', { printWidth: '11', printHeight: '17' })), res);
        expect(res.statusCode).toBe(200);
        expect((0, submission_workflow_1.listProjectDetailChanges)(row('sunset'), { ...modificationBodyFrom('sunset'), printWidth: '11' })).toEqual(['print width']);
    });
    test('brand-new and unapproved-upload flows are not gated', async () => {
        const deps = buildDeps();
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const fresh = buildResponse();
        await handlers.submitMenu(buildRequest(modificationBodyFrom('sunset', {
            submissionMode: 'new', revisionBaseSubmissionId: '', revisionSource: '', turnaroundDays: '5',
        })), fresh);
        expect(fresh.statusCode).toBe(200);
        const unapproved = buildResponse();
        await handlers.submitMenu(buildRequest(modificationBodyFrom('sunset', { unapprovedMode: true })), unapproved);
        expect(unapproved.statusCode).toBe(200);
        expect(deps.getApprovedBaseline).not.toHaveBeenCalled();
    });
    test('an unavailable baseline fails toward keeping the submission', async () => {
        const deps = buildDeps({ getApprovedBaseline: jest.fn().mockRejectedValue(new Error('db down')) });
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const res = buildResponse();
        await handlers.submitMenu(buildRequest(modificationBodyFrom('sunset')), res);
        expect(res.statusCode).toBe(200);
    });
});
describe('submit idempotency (item 6)', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => jest.restoreAllMocks());
    const editedBody = () => modificationBodyFrom('cocktail', {
        draftSessionToken: 'token-cocktail',
        menuContent: `${row('cocktail').approved_menu_content}\nPineapple Daiquiri - $18`,
    });
    test('two submit clicks 300 ms apart produce one submission and one ClickUp task', async () => {
        const deps = buildDeps({
            getDraftSession: jest.fn().mockResolvedValue(activeDraftFor('cocktail')),
            generateDocxFromForm: jest.fn(() => new Promise((resolve) => setTimeout(() => resolve('/tmp/docs/test.docx'), 600))),
        });
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const headers = { 'x-menumanager-attempt-id': 'attempt-double' };
        const first = buildResponse();
        const second = buildResponse();
        const firstRun = handlers.submitMenu(buildRequest(editedBody(), headers), first);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const secondRun = handlers.submitMenu(buildRequest(editedBody(), headers), second);
        await Promise.all([firstRun, secondRun]);
        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(200);
        expect(second.body.submissionId).toBe(first.body.submissionId);
        expect(second.body.duplicateOfFirstSubmission).toBe(true);
        expect(submissionCreates(deps)).toHaveLength(1);
        expect(clickupCreates(deps)).toHaveLength(1);
        expect(deps.generateDocxFromForm).toHaveBeenCalledTimes(1);
    });
    test('a different attempt id is a separate submission; a failed first attempt does not block a retry', async () => {
        let failNext = true;
        const deps = buildDeps({
            getDraftSession: jest.fn().mockResolvedValue(activeDraftFor('cocktail')),
            generateDocxFromForm: jest.fn(async () => {
                if (failNext) {
                    failNext = false;
                    throw new Error('disk full');
                }
                return '/tmp/docs/test.docx';
            }),
        });
        const handlers = (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps);
        const failed = buildResponse();
        await handlers.submitMenu(buildRequest(editedBody(), { 'x-menumanager-attempt-id': 'attempt-retry' }), failed);
        expect(failed.statusCode).toBe(500);
        const retried = buildResponse();
        await handlers.submitMenu(buildRequest(editedBody(), { 'x-menumanager-attempt-id': 'attempt-retry' }), retried);
        expect(retried.statusCode).toBe(200);
        expect(retried.body.duplicateOfFirstSubmission).toBeUndefined();
        const other = buildResponse();
        await handlers.submitMenu(buildRequest(editedBody(), { 'x-menumanager-attempt-id': 'attempt-other' }), other);
        expect(other.statusCode).toBe(200);
        expect(submissionCreates(deps)).toHaveLength(2);
    });
});

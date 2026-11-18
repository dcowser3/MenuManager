"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// End-to-end regression for the 2026-11-16 "Load Newer Menu" incident.
//
// Replays the chef's sequence through the real pieces, with only HTTP removed:
//   db service handlers (JSON fallback, Strand-shaped fixture)
//   -> client decision/dialog/lock logic (public/js/baseline-freshness.js)
//   -> dashboard submit workflow (lib/submission-workflow.ts)
// and asserts the chef's edited text is what gets submitted, or that the
// submission is refused. Never a silent swap.
jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    getSupabaseClient: jest.fn(),
    isSupabaseConfigured: jest.fn(() => false),
    logAlert: jest.fn(),
    extractAndStoreDishes: jest.fn(),
}));
jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readFile: jest.fn(),
            writeFile: jest.fn().mockResolvedValue(undefined),
            mkdir: jest.fn().mockResolvedValue(undefined),
            access: jest.fn().mockResolvedValue(undefined),
        },
    };
});
const fs_1 = __importDefault(require("fs"));
const submission_workflow_1 = require("../lib/submission-workflow");
const realFs = jest.requireActual('fs');
const nodePath = require('path');
const vm = require('vm');
// Loaded by path (not a static import) so the dashboard tsc build, whose
// rootDir is services/dashboard, does not pull the db service sources in.
const dbApp = require(nodePath.join(__dirname, '..', '..', 'db', 'index')).default;
const strand = JSON.parse(realFs.readFileSync(nodePath.join(__dirname, '..', '..', 'db', '__fixtures__', 'strand-incident.json'), 'utf8'));
const K = strand.keys;
function loadClientModule() {
    const window = {};
    vm.runInNewContext(realFs.readFileSync(nodePath.join(__dirname, '..', 'public', 'js', 'baseline-freshness.js'), 'utf8'), { window, Set, Date, Number, String, Array, Promise, Object });
    return window.MenuBaselineFreshness;
}
function dbHandler(method, routePath) {
    const layer = dbApp._router.stack.find((entry) => entry.route && entry.route.path === routePath && entry.route.methods?.[method]);
    if (!layer)
        throw new Error(`db route not found: ${method} ${routePath}`);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
// Calls a db route handler like an HTTP client (axios semantics: non-2xx throws).
function callDb(method, routePath, { params = {}, query = {}, body = {} } = {}) {
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { this.finish(payload); return this; },
            send(payload) { this.finish(payload); return this; },
            finish(payload) {
                if (this.statusCode >= 400)
                    reject(Object.assign(new Error(`db ${this.statusCode}`), { response: { status: this.statusCode, data: payload } }));
                else
                    resolve(payload);
            },
        };
        Promise.resolve(dbHandler(method, routePath)({ params, query, body }, res)).catch(reject);
    });
}
describe('incident replay: Cocktail Menu draft in a multi-menu service period', () => {
    const M = loadClientModule();
    let submissions;
    let menus;
    let drafts;
    beforeEach(() => {
        submissions = JSON.parse(JSON.stringify(strand.submissions));
        menus = JSON.parse(JSON.stringify(strand.menus));
        drafts = {};
        fs_1.default.promises.readFile.mockImplementation(async (target) => {
            const name = String(target);
            if (name.endsWith('submissions.json'))
                return JSON.stringify(submissions);
            if (name.endsWith('menus.json'))
                return JSON.stringify(menus);
            if (name.endsWith('draft_sessions.json'))
                return JSON.stringify(drafts);
            if (name.endsWith('properties.json'))
                return '[]';
            if (name.endsWith('assets.json'))
                return '[]';
            return '{}';
        });
        fs_1.default.promises.writeFile.mockImplementation(async (target, payload) => {
            const name = String(target);
            if (name.endsWith('submissions.json'))
                submissions = JSON.parse(payload);
            if (name.endsWith('menus.json'))
                menus = JSON.parse(payload);
            if (name.endsWith('draft_sessions.json'))
                drafts = JSON.parse(payload);
        });
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => jest.restoreAllMocks());
    function buildWorkflow() {
        const created = [];
        const clickup = [];
        const axios = {
            post: jest.fn(async (url, payload) => {
                if (url === 'http://db.test/submissions') {
                    created.push(payload);
                    return { data: { id: payload.id } };
                }
                if (url.includes('/create-task')) {
                    clickup.push(payload);
                    return { data: { taskId: `task-${clickup.length}` } };
                }
                return { data: {} };
            }),
            put: jest.fn().mockResolvedValue({ data: {} }),
            get: jest.fn().mockResolvedValue({ data: {} }),
        };
        const deps = {
            axios,
            fs: { access: jest.fn(), mkdir: jest.fn(), copyFile: jest.fn() },
            DB_SERVICE_URL: 'http://db.test',
            AI_REVIEW_URL: 'http://ai.test',
            CLICKUP_SERVICE_URL: 'http://clickup.test',
            DEFAULT_ALLERGEN_KEY: '',
            AI_REVIEW_SUBMIT_TIMEOUT_MS: 1000,
            CLICKUP_TASK_CREATE_TIMEOUT_MS: 1000,
            getTempUploadsDir: () => '/tmp/uploads',
            getSubmissionDocumentDir: () => '/tmp/docs',
            getPropertyCatalogFromDb: async () => [{ name: strand.property }],
            resolveCityCountryFromCatalog: () => 'Grace Bay, Turks and Caicos',
            normalizeMenuFooter: (text, allergens) => ({ body: `${text || ''}`.trim(), normalizedAllergenLine: allergens || '', hadRawNotice: false, preservedFooterText: '' }),
            stripManagedFooterFromHtml: (html) => html,
            detectRawUndercookedContent: () => false,
            generateDocxFromForm: jest.fn(() => new Promise((resolve) => setTimeout(() => resolve('/tmp/docs/menu.docx'), 500))),
            sendAdminAlert: jest.fn(),
            isClientInputError: () => false,
            logFormAttemptEvent: jest.fn(),
            // Real db handlers in place of HTTP:
            getDraftSession: (token) => callDb('get', '/draft-sessions/:token', { params: { token } }),
            getBaselineFreshness: (id) => callDb('get', '/submissions/baseline-freshness', { query: { id } }),
            getApprovedBaseline: (id) => callDb('get', '/submissions/:id', { params: { id } }),
            lockDraftSession: (token, submittedSubmissionId) => callDb('post', '/draft-sessions/:token/submit', { params: { token }, body: { submittedSubmissionId } }),
        };
        return { handlers: (0, submission_workflow_1.createSubmissionWorkflowHandlers)(deps), deps, created, clickup };
    }
    // What the form sends, built from the editor state the way submitMenu() does.
    function formBody(baseline, menuContent, draftToken) {
        const row = submissions[K.cocktail];
        return {
            submitterName: 'Chef Test', submitterEmail: 'chef@example.com', submitterJobTitle: 'Executive Chef',
            projectName: baseline.projectName, property: baseline.property, orientation: baseline.orientation,
            menuType: baseline.menuType, servicePeriod: baseline.servicePeriod, templateType: baseline.templateType,
            dateNeeded: '2026-11-30', assetType: baseline.assetType, printRegion: 'US',
            printWidth: row.print_width, printHeight: row.print_height, folded: 'no', cropMarks: 'no', bleedMarks: 'no', fileSizeLimit: 'no',
            turnaroundDays: '2', allergens: '', menuContent, menuContentHtml: '',
            approvals: [{ approved: true, name: 'Grace GM', position: 'General Manager', email: 'grace@example.com' }],
            skipAiReview: true, submissionMode: 'modification', revisionSource: 'database',
            revisionBaseSubmissionId: baseline.id, baseApprovedMenuContent: baseline.approvedMenuContent,
            chefPersistentDiff: { insertions: 3, deletions: 1 }, draftSessionToken: draftToken,
        };
    }
    const request = (body, attemptId) => ({ hostname: 'menus.example.com', get: (n) => (n.toLowerCase() === 'x-menumanager-attempt-id' ? attemptId : ''), body });
    const response = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } });
    test('the chef\'s edited Cocktail Menu text is what gets submitted; the Sunset Lounge is never swapped in', async () => {
        // 1. Chef opens a draft of The Del Mar Cocktail Menu (dinner, beverage).
        const draftCreated = await callDb('post', '/draft-sessions', { body: { baseSubmissionId: K.cocktail } });
        const draft = await callDb('get', '/draft-sessions/:token', { params: { token: draftCreated.token } });
        expect(draft.baseline.projectName).toBe('The Del Mar Cocktail Menu');
        // 2. Draft-open check and the continue/submit check: no banner, no dialog,
        //    although three other dinner menus share property + service period.
        const issue = M.classifyIssue({
            submissionMode: 'modification', revisionSource: 'database', selected: draft.baseline,
            selectedId: draft.baseline.id, property: strand.property, servicePeriod: 'dinner',
            freshness: draft.baselineFreshness,
        });
        expect(issue).toBeNull();
        const shown = [];
        const el = () => ({ textContent: '', hidden: false, onclick: null, classList: { add: (c) => shown.push(c), remove: () => { }, contains: () => false }, focus() { }, appendChild() { } });
        const dialog = M.createFreshnessDialog({ elements: { modal: el(), title: el(), message: el(), detail: el(), list: el(), loadBtn: el(), continueBtn: el(), cancelBtn: el() }, onLoad: jest.fn() });
        await expect(dialog.ask(issue, { inDraft: true, editedLineCount: 24 })).resolves.toBe(true);
        expect(shown).not.toContain('show');
        // 3. Whatever happens in the UI, the draft cannot take on another baseline.
        const lock = M.createDraftBaselineLock({ id: draft.base_submission_id, idAliases: draft.baseline.idAliases });
        const sunsetLounge = await callDb('get', '/submissions/:id', { params: { id: K.sunset } });
        expect(lock.allows(sunsetLounge.legacy_id)).toBe(false);
        expect(lock.allows(draft.baseline.id)).toBe(true);
        // 4. Chef's edits (lines changed + added) are a real change.
        const edited = draft.baseline.approvedMenuContent
            .replace('Smoked Negroni - $20', 'Smoked Negroni - $21')
            + '\nSunset Paloma - $18\nGuava Collins - $17';
        expect(M.isZeroChangeModification({
            submissionMode: 'modification', revisionSource: 'database', baseline: draft.baseline,
            baselineText: draft.baseline.approvedMenuContent, currentText: edited, details: {},
        })).toBe(false);
        // 5. Two submit clicks 300 ms apart.
        const { handlers, created, clickup } = buildWorkflow();
        const body = formBody(draft.baseline, edited, draftCreated.token);
        const first = response();
        const second = response();
        const run1 = handlers.submitMenu(request(body, 'attempt-e2e'), first);
        await new Promise((r) => setTimeout(r, 300));
        const run2 = handlers.submitMenu(request(body, 'attempt-e2e'), second);
        await Promise.all([run1, run2]);
        expect(first.statusCode).toBe(200);
        expect(second.body.submissionId).toBe(first.body.submissionId);
        expect(created).toHaveLength(1);
        expect(clickup).toHaveLength(1);
        expect(created[0].menu_content).toBe(edited.trim());
        expect(created[0].project_name).toBe('The Del Mar Cocktail Menu');
        expect(created[0].template_type).toBe('beverage');
        expect(created[0].revision_base_submission_id).toBe(K.cocktail);
        expect(drafts[draft.id].status).toBe('submitted');
    });
    test('replaying the old client\'s swapped payload (draft for Cocktail Menu, body for Sunset Lounge) is refused', async () => {
        const draftCreated = await callDb('post', '/draft-sessions', { body: { baseSubmissionId: K.cocktail } });
        const sunset = (await callDb('get', '/submissions/baseline-freshness', { query: { id: K.sunset } }));
        expect(sunset.stale).toBe(false); // Sunset Lounge is its own current menu, not "newer"
        const sunsetRow = submissions[K.sunset];
        const sunsetBaseline = {
            id: sunsetRow.legacy_id, projectName: sunsetRow.project_name, property: sunsetRow.property,
            servicePeriod: sunsetRow.service_period, templateType: sunsetRow.template_type, menuType: sunsetRow.menu_type,
            orientation: sunsetRow.orientation, assetType: sunsetRow.asset_type, approvedMenuContent: sunsetRow.approved_menu_content,
        };
        const { handlers, created, clickup, deps } = buildWorkflow();
        const res = response();
        await handlers.submitMenu(request(formBody(sunsetBaseline, sunsetRow.approved_menu_content, draftCreated.token), 'attempt-swap'), res);
        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('draft_baseline_mismatch');
        expect(created).toHaveLength(0);
        expect(clickup).toHaveLength(0);
        expect(deps.generateDocxFromForm).not.toHaveBeenCalled();
        expect(drafts[draftCreated.id].status).toBe('active'); // draft untouched
        // Without a draft, the same unchanged Sunset Lounge body is a zero-change modification.
        const noDraft = response();
        const { handlers: h2, created: created2 } = buildWorkflow();
        await h2.submitMenu(request({ ...formBody(sunsetBaseline, sunsetRow.approved_menu_content, ''), chefPersistentDiff: { insertions: 0, deletions: 0 } }, 'attempt-empty'), noDraft);
        expect(noDraft.statusCode).toBe(422);
        expect(created2).toHaveLength(0);
    });
});

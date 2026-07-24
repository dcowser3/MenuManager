const redlinePreview = require('../public/js/redline-preview');

// Regression cover for the loss scenario that started this: a reviewer spent an evening in
// the approval editor, hit a submit error, and had no way back to their work because this
// editor never persisted anything until submit succeeded.

class FakeWorker {
    static instances = [];
    constructor(url) {
        this.url = url;
        this.messages = [];
        FakeWorker.instances.push(this);
    }
    postMessage(message) { this.messages.push(message); }
    terminate() {}
}

function createElement(overrides = {}) {
    return {
        innerHTML: '',
        textContent: '',
        children: [],
        hidden: false,
        disabled: false,
        addEventListener: jest.fn(),
        focus: jest.fn(),
        ...overrides,
    };
}

function setEditorLines(editor, lines) {
    editor.children = lines.map((line) => ({ textContent: line }));
    editor.textContent = lines.join('\n');
    editor.innerHTML = lines.map((line) => `<p>${line}</p>`).join('');
}

function createMemoryStorage(seed = {}) {
    const data = { ...seed };
    return {
        data,
        getItem: jest.fn((key) => (key in data ? data[key] : null)),
        setItem: jest.fn((key, value) => { data[key] = String(value); }),
        removeItem: jest.fn((key) => { delete data[key]; }),
    };
}

function loadController() {
    jest.resetModules();
    global.MenuRedlinePreview = redlinePreview;
    global.Worker = FakeWorker;
    global.performance = { now: jest.fn(() => Date.now()) };
    global.scrollTo = jest.fn();
    return require('../public/js/approval-preview-controller');
}

const BASELINE_TEXT = 'ALPHA 13';
const BASELINE_HTML = '<p>ALPHA 13</p>';

function createController(options = {}) {
    const controllerApi = loadController();
    const editor = createElement();
    const alertBox = createElement();
    const submitBtn = createElement({ textContent: 'Submit Approval' });
    const restoreBtn = createElement();
    setEditorLines(editor, [BASELINE_TEXT]);

    const controller = controllerApi.createApprovalPreviewController({
        submissionId: 'sub-42',
        baselineText: BASELINE_TEXT,
        baselinePreviewText: BASELINE_TEXT,
        baselineAnnotations: [],
        baselineHtml: BASELINE_HTML,
        submitUrl: '/api/approval/sub-42/submit',
        learningUrlBase: '/learning/submission/',
        debounceMs: 0,
        workerTimeoutMs: 50,
        elements: {
            editor,
            preview: createElement(),
            loading: createElement({ hidden: true }),
            submitBtn,
            restoreBtn,
            alertBox,
            diffSummary: createElement({ textContent: '' }),
        },
        ...options,
    });

    return { controller, editor, alertBox, submitBtn, restoreBtn, controllerApi };
}

describe('approval draft helpers', () => {
    const { fingerprintText, isRestorableDraft, draftStorageKey, formatDraftAge } = loadController();

    test('namespaces the storage key per submission', () => {
        expect(draftStorageKey('sub-42')).toBe('menumanager.approvalDraft.v1:sub-42');
        expect(draftStorageKey('sub-42')).not.toBe(draftStorageKey('sub-43'));
    });

    test('fingerprint distinguishes different baselines', () => {
        expect(fingerprintText('ALPHA 13')).toBe(fingerprintText('ALPHA 13'));
        expect(fingerprintText('ALPHA 13')).not.toBe(fingerprintText('ALPHA 14'));
    });

    const expected = {
        baselineFingerprint: fingerprintText(BASELINE_TEXT),
        baselineText: BASELINE_TEXT,
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
        now: 1_000_000,
    };
    const goodDraft = {
        html: '<p>ALPHA 99</p>',
        text: 'ALPHA 99',
        savedAt: expected.now - 60_000,
        baseline: expected.baselineFingerprint,
    };

    test('accepts a recent draft taken against the same baseline', () => {
        expect(isRestorableDraft(goodDraft, expected)).toBe(true);
    });

    // Restoring across a changed baseline would submit edits against a document the
    // reviewer never saw.
    test('rejects a draft whose baseline no longer matches', () => {
        expect(isRestorableDraft({ ...goodDraft, baseline: 'other' }, expected)).toBe(false);
    });

    test('rejects a stale draft past the max age', () => {
        expect(isRestorableDraft({ ...goodDraft, savedAt: expected.now - (8 * 24 * 60 * 60 * 1000) }, expected)).toBe(false);
    });

    test('rejects a draft identical to the submitted text, and malformed rows', () => {
        expect(isRestorableDraft({ ...goodDraft, text: BASELINE_TEXT }, expected)).toBe(false);
        expect(isRestorableDraft(null, expected)).toBe(false);
        expect(isRestorableDraft({ html: '' }, expected)).toBe(false);
    });

    test('describes draft age in human terms', () => {
        const now = 1_000_000_000;
        expect(formatDraftAge(now - 30_000, now)).toBe('moments ago');
        expect(formatDraftAge(now - (5 * 60_000), now)).toBe('5 minutes ago');
        expect(formatDraftAge(now - (2 * 3_600_000), now)).toBe('2 hours ago');
    });
});

describe('approval draft autosave', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        FakeWorker.instances = [];
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.MenuRedlinePreview;
        delete global.Worker;
        delete global.performance;
        delete global.scrollTo;
    });

    test('persists edited content after the debounce window', () => {
        const storage = createMemoryStorage();
        const { controller, editor } = createController({ storage, draftSaveDebounceMs: 1500 });

        setEditorLines(editor, ['ALPHA 99']);
        const inputHandler = editor.addEventListener.mock.calls.find(([type]) => type === 'input')[1];
        inputHandler();

        expect(storage.setItem).not.toHaveBeenCalled(); // debounced, not per keystroke
        jest.advanceTimersByTime(1500);

        const saved = JSON.parse(storage.data['menumanager.approvalDraft.v1:sub-42']);
        expect(saved.text).toBe('ALPHA 99');
        expect(saved.html).toBe('<p>ALPHA 99</p>');
        expect(saved.baseline).toBeTruthy();
        controller.destroy();
    });

    test('restores a saved draft into the editor on load and tells the reviewer', () => {
        const storage = createMemoryStorage({
            'menumanager.approvalDraft.v1:sub-42': JSON.stringify({
                html: '<p>ALPHA 99</p>',
                text: 'ALPHA 99',
                savedAt: Date.now() - 60_000,
                baseline: loadController().fingerprintText(BASELINE_TEXT),
            }),
        });

        const { editor, alertBox, controller } = createController({ storage });

        expect(editor.innerHTML).toBe('<p>ALPHA 99</p>');
        expect(alertBox.textContent).toMatch(/Restored your unsaved edits/i);
        controller.destroy();
    });

    test('ignores a draft saved against a different baseline', () => {
        const storage = createMemoryStorage({
            'menumanager.approvalDraft.v1:sub-42': JSON.stringify({
                html: '<p>STALE</p>',
                text: 'STALE',
                savedAt: Date.now(),
                baseline: 'fingerprint-of-some-other-document',
            }),
        });

        const { editor, alertBox, controller } = createController({ storage });

        expect(editor.innerHTML).toBe(BASELINE_HTML);
        expect(alertBox.textContent).not.toMatch(/Restored/i);
        controller.destroy();
    });

    // The draft must survive a failed submit — that is the case it exists for.
    test('keeps the draft when submit fails, and clears it only once approval succeeds', async () => {
        jest.useRealTimers(); // submit awaits a preview refresh; no debounce under test here
        const storage = createMemoryStorage();
        const key = 'menumanager.approvalDraft.v1:sub-42';
        const { controller, editor, submitBtn } = createController({ storage });
        const clickSubmit = submitBtn.addEventListener.mock.calls.find(([type]) => type === 'click')[1];

        setEditorLines(editor, ['ALPHA 99']);
        controller.saveDraftNow();
        expect(storage.data[key]).toBeTruthy();

        global.fetch = jest.fn(async () => { throw new Error('network down'); });
        await clickSubmit();
        expect(global.fetch).toHaveBeenCalled();
        expect(storage.data[key]).toBeTruthy(); // survived the failure — still recoverable

        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ submissionId: 'sub-42' }) }));
        global.location = { assign: jest.fn() };
        await clickSubmit();
        expect(storage.data[key]).toBeUndefined(); // approval landed — draft retired

        delete global.fetch;
        delete global.location;
        controller.destroy();
    });

    test('drops the draft once the editor matches the submitted text again', () => {
        const storage = createMemoryStorage({ 'menumanager.approvalDraft.v1:sub-42': '{"stale":true}' });
        const { controller, editor } = createController({ storage });

        setEditorLines(editor, [BASELINE_TEXT]);
        controller.saveDraftNow();

        expect(storage.data['menumanager.approvalDraft.v1:sub-42']).toBeUndefined();
        controller.destroy();
    });

    test('editing still works when storage is unavailable', () => {
        const storage = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('quota exceeded'); },
            removeItem: () => { throw new Error('blocked'); },
        };
        const { controller, editor } = createController({ storage });

        setEditorLines(editor, ['ALPHA 99']);
        expect(() => controller.saveDraftNow()).not.toThrow();
        controller.destroy();
    });
});

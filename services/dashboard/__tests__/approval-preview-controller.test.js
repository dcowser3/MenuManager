const redlinePreview = require('../public/js/redline-preview');

class FakeWorker {
    static instances = [];

    constructor(url) {
        this.url = url;
        this.messages = [];
        this.terminated = false;
        FakeWorker.instances.push(this);
    }

    postMessage(message) {
        this.messages.push(message);
    }

    terminate() {
        this.terminated = true;
    }

    respond(message, overrides = {}) {
        const payload = {
            type: 'rendered',
            requestId: message.requestId,
            html: `<p>${message.revisedText}</p>`,
            insertions: 1,
            deletions: 0,
            revisedText: message.revisedText,
            revisedHtml: message.revisedHtml,
            durationMs: 12,
            ...overrides,
        };
        this.onmessage({ data: payload });
    }
}

function createElement(overrides = {}) {
    return {
        innerHTML: '',
        textContent: '',
        children: [],
        hidden: false,
        disabled: false,
        textContentValue: '',
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

function loadController() {
    jest.resetModules();
    global.MenuRedlinePreview = redlinePreview;
    global.Worker = FakeWorker;
    global.performance = { now: jest.fn(() => Date.now()) };
    global.scrollTo = jest.fn();
    return require('../public/js/approval-preview-controller');
}

function createController(options = {}) {
    const controllerApi = loadController();
    const editor = createElement();
    const preview = createElement();
    const loading = createElement({ hidden: true });
    const diffSummary = createElement({ textContent: '' });
    const submitBtn = createElement({ textContent: 'Submit Approval' });
    const restoreBtn = createElement();
    const alertBox = createElement();

    setEditorLines(editor, ['ALPHA 13']);

    const controller = controllerApi.createApprovalPreviewController({
        submissionId: 'fixture-submission',
        baselineText: 'ALPHA 13',
        baselinePreviewText: 'ALPHA 1213',
        baselineAnnotations: [[
            { start: 6, end: 8, type: 'del' },
            { start: 8, end: 10, type: 'ins' },
        ]],
        baselineHtml: '<p>ALPHA <span class="existing-del">12</span><span class="existing-ins">13</span></p>',
        submitUrl: '/api/approval/fixture-submission/submit',
        learningUrlBase: '/learning/submission/',
        debounceMs: 0,
        workerTimeoutMs: 50,
        elements: {
            editor,
            preview,
            loading,
            submitBtn,
            restoreBtn,
            alertBox,
            diffSummary,
        },
        ...options,
    });

    return { controller, editor, preview, loading, diffSummary };
}

describe('approval preview controller worker queue', () => {
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

    test('coalesces rapid renders and applies only the latest worker result', async () => {
        const { controller, preview, loading } = createController();
        const worker = FakeWorker.instances[0];

        const firstRender = controller.renderLatestPreview({
            revisedText: 'ALPHA first',
            revisedHtml: '<p>ALPHA first</p>',
            forceRender: true,
        });
        const secondRender = controller.renderLatestPreview({
            revisedText: 'ALPHA second',
            revisedHtml: '<p>ALPHA second</p>',
            forceRender: true,
        });

        expect(worker.messages).toHaveLength(1);
        worker.respond(worker.messages[0], { html: '<p>stale</p>' });

        expect(preview.innerHTML).not.toBe('<p>stale</p>');
        expect(worker.messages).toHaveLength(2);

        worker.respond(worker.messages[1], { html: '<p>latest</p>' });

        await expect(firstRender).resolves.toMatchObject({ html: '<p>latest</p>' });
        await expect(secondRender).resolves.toMatchObject({ html: '<p>latest</p>' });
        expect(preview.innerHTML).toBe('<p>latest</p>');
        expect(loading.hidden).toBe(true);
    });

    test('ignores worker responses for stale request ids', async () => {
        const { controller, preview } = createController();
        const worker = FakeWorker.instances[0];

        const render = controller.renderLatestPreview({
            revisedText: 'ALPHA current',
            revisedHtml: '<p>ALPHA current</p>',
            forceRender: true,
        });
        const message = worker.messages[0];

        worker.respond(message, {
            requestId: message.requestId + 99,
            html: '<p>wrong request</p>',
        });
        expect(preview.innerHTML).not.toBe('<p>wrong request</p>');

        worker.respond(message, { html: '<p>right request</p>' });
        await expect(render).resolves.toMatchObject({ html: '<p>right request</p>' });
        expect(preview.innerHTML).toBe('<p>right request</p>');
    });

    test('sends canonical original text to the worker instead of replay resolver state', async () => {
        const { controller } = createController();
        const worker = FakeWorker.instances[0];

        const render = controller.renderLatestPreview({
            revisedText: 'ALPHA 14',
            revisedHtml: '<p>ALPHA 14</p>',
            forceRender: true,
        });
        const message = worker.messages[0];

        expect(message.baselineOriginalText).toBe('ALPHA 12');
        expect(message.baselineOriginalHtml).toContain('ALPHA 12');
        expect(message).not.toHaveProperty('baselineResolverText');
        expect(message).toHaveProperty('baselinePreviewText', 'ALPHA 1213');

        worker.respond(message, { html: '<p>canonical</p>' });
        await expect(render).resolves.toMatchObject({ html: '<p>canonical</p>' });
    });

    test('times out a stuck worker render and clears the loading state', async () => {
        const { controller, loading, diffSummary } = createController();
        const worker = FakeWorker.instances[0];

        const render = controller.renderLatestPreview({
            revisedText: 'ALPHA stuck',
            revisedHtml: '<p>ALPHA stuck</p>',
            forceRender: true,
        });

        expect(worker.messages).toHaveLength(1);
        jest.advanceTimersByTime(51);

        await expect(render).rejects.toThrow('Preview render timed out');
        expect(worker.terminated).toBe(true);
        expect(FakeWorker.instances).toHaveLength(2);
        expect(loading.hidden).toBe(true);
        expect(diffSummary.textContent).toContain('preview error');
    });
});

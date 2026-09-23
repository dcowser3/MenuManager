const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'form-submit-diagnostics.js'), 'utf8');
const form = fs.readFileSync(path.join(__dirname, '..', 'views', 'form.ejs'), 'utf8');

function makeClient(fetchImpl) {
    const values = new Map();
    const listeners = {};
    const window = {
        fetch: fetchImpl,
        localStorage: {
            getItem: (key) => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
        },
        addEventListener: (name, callback) => { listeners[name] = callback; },
    };
    vm.runInNewContext(source, { window, AbortController, setTimeout, clearTimeout, Date, JSON });
    return { api: window.MenuSubmitDiagnostics, values, listeners };
}

describe('final-submit diagnostics', () => {
    const event = {
        attemptId: 'test-attempt', eventType: 'submit_client_exception',
        route: '/api/form/submit', requestBodyLength: 42000,
        submitterEmail: 'chef@example.com', menuContent: 'private menu text',
        errorMessage: 'Failed to fetch',
        details: { clientTime: '2026-09-23T16:20:00Z', phase: 'fetch_submit', online: false,
            menuHtmlLength: 10000, persistentDiffHtmlLength: 30000, secret: 'private' },
    };

    test('confirms server receipt for submit telemetry', async () => {
        const calls = [];
        const { api, values } = makeClient(async (_url, options) => {
            calls.push(JSON.parse(options.body));
            return { ok: true };
        });
        expect(await api.send(event)).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].attemptId).toBe('test-attempt');
        expect(values.size).toBe(0);
    });

    test('retains a bounded metadata-only failure and sends it when online', async () => {
        const calls = [];
        let connected = false;
        const { api, values, listeners } = makeClient(async (_url, options) => {
            if (!connected) throw new TypeError('Failed to fetch');
            calls.push(JSON.parse(options.body));
            return { ok: true };
        });
        expect(await api.send(event)).toBe(false);
        const stored = [...values.values()][0];
        expect(stored).toContain('test-attempt');
        expect(stored).not.toContain('private menu text');
        expect(stored).not.toContain('chef@example.com');
        expect(stored).not.toContain('private');
        connected = true;
        listeners.online();
        await api.flush();
        expect(calls).toHaveLength(1);
        expect(calls[0].details).toMatchObject({ phase: 'fetch_submit', delayedDelivery: true, online: false });
        expect(JSON.parse([...values.values()][0])).toHaveLength(0);
    });

    test('keeps only the latest twelve failed events', async () => {
        const { api, values } = makeClient(async () => { throw new Error('offline'); });
        for (let i = 0; i < 15; i++) {
            await api.send({ ...event, attemptId: `attempt-${i}`, details: { clientTime: `time-${i}` } });
        }
        const stored = JSON.parse([...values.values()][0]);
        expect(stored).toHaveLength(12);
        expect(stored[0].attemptId).toBe('attempt-3');
        expect(stored[11].attemptId).toBe('attempt-14');
    });

    test('the canonical form records the phase on both sides of the submit request', () => {
        expect(form).toContain('/js/form-submit-diagnostics.js?v=20260923');
        const start = form.indexOf("await logSubmitDiagnostic('submit_started'");
        const submit = form.indexOf('const response = await MenuSubmission.sendPreparedMenuSubmission(preparedSubmission)', start);
        const failure = form.indexOf("await logSubmitDiagnostic('submit_client_exception'", submit);
        expect(start).toBeGreaterThan(0);
        expect(submit).toBeGreaterThan(start);
        expect(failure).toBeGreaterThan(submit);
        expect(form.slice(start, failure)).toContain("submitPhase = 'fetch_submit'");
    });
});

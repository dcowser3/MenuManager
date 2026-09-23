/* Confirm final-submit telemetry delivery and retain a small failure record for later retry. */
(function (global) {
    const STORAGE_KEY = 'menumanager_pending_submit_diagnostics_v1';
    const MAX_PENDING = 12;
    const SEND_TIMEOUT_MS = 3500;
    let flushPromise = null;

    function storage() {
        try { return global.localStorage; } catch (_) { return null; }
    }

    function pending() {
        try {
            const value = JSON.parse(storage()?.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(value) ? value.slice(-MAX_PENDING) : [];
        } catch (_) { return []; }
    }

    // Persist only diagnostic metadata. Menu content, contact details, and AI text
    // must never be copied into browser storage by this retry path.
    function compact(event) {
        const detail = event.details || {};
        return {
            attemptId: String(event.attemptId || '').slice(0, 100),
            eventType: String(event.eventType || '').slice(0, 80),
            route: '/api/form/submit',
            requestBodyLength: Number(event.requestBodyLength) || null,
            details: {
                clientTime: String(detail.clientTime || new Date().toISOString()).slice(0, 40),
                phase: String(detail.phase || '').slice(0, 60),
                elapsedMs: Number(detail.elapsedMs) || 0,
                online: detail.online === true ? true : detail.online === false ? false : null,
                visibilityState: String(detail.visibilityState || '').slice(0, 30),
                errorName: String(detail.errorName || '').slice(0, 80),
                errorCode: String(detail.errorCode || '').slice(0, 80),
                menuHtmlLength: Number(detail.menuHtmlLength) || 0,
                persistentDiffHtmlLength: Number(detail.persistentDiffHtmlLength) || 0,
                delayedDelivery: true,
            },
        };
    }

    function enqueue(event) {
        try {
            const current = pending();
            current.push(compact(event));
            storage()?.setItem(STORAGE_KEY, JSON.stringify(current.slice(-MAX_PENDING)));
        } catch (_) { /* Diagnostics must never block a submission. */ }
    }

    async function post(event) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
        try {
            const response = await global.fetch('/api/form/attempt-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event),
                keepalive: true,
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Telemetry HTTP ${response.status}`);
        } finally {
            clearTimeout(timer);
        }
    }

    async function flush() {
        if (flushPromise) return flushPromise;
        flushPromise = (async () => {
            for (const event of pending()) {
                try {
                    await post(event);
                    const current = pending();
                    const index = current.findIndex((entry) =>
                        entry.attemptId === event.attemptId && entry.eventType === event.eventType
                        && entry.details?.clientTime === event.details?.clientTime);
                    if (index >= 0) {
                        current.splice(index, 1);
                        storage()?.setItem(STORAGE_KEY, JSON.stringify(current));
                    }
                } catch (_) { break; }
            }
        })();
        try { await flushPromise; } finally { flushPromise = null; }
    }

    async function send(event) {
        try {
            await post(event);
            void flush();
            return true;
        } catch (_) {
            enqueue(event);
            return false;
        }
    }

    const api = { send, flush };
    global.MenuSubmitDiagnostics = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global.addEventListener) global.addEventListener('online', () => { void flush(); });
    void flush();
})(typeof window !== 'undefined' ? window : globalThis);

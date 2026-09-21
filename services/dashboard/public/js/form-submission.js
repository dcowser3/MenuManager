(function (global) {
    function sanitizeMenuHtmlForSubmission(htmlContent) {
        let html = htmlContent || '';
        html = html.replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '');
        return html.replace(/<\/p>\s+<p\b/gi, '</p><p').trim();
    }
    function captureMenuSubmission(state) {
        const html = sanitizeMenuHtmlForSubmission(state && state.html || '');
        const text = state && state.element && global.MenuRedlinePreview
            ? global.MenuRedlinePreview.extractCleanTextFromElement(state.element)
            : String(state && state.text || '').trim();
        return { menuContent: text, menuContentHtml: html };
    }
    function prepareMenuSubmissionRequest(formData, headers) {
        return { url: '/api/form/submit', init: { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(formData) } };
    }
    async function sendPreparedMenuSubmission(request, fetchImpl) {
        if (!request || request.url !== '/api/form/submit' || !request.init || request.init.method !== 'POST' || typeof request.init.body !== 'string') throw new Error('Invalid prepared submission request');
        const send = fetchImpl || global.fetch.bind(global);
        return send(request.url, request.init);
    }
    global.MenuSubmission = Object.freeze({ sanitizeMenuHtmlForSubmission, captureMenuSubmission, prepareMenuSubmissionRequest, sendPreparedMenuSubmission });
})(window);

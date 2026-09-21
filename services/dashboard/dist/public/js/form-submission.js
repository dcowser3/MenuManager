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
    global.MenuSubmission = Object.freeze({ sanitizeMenuHtmlForSubmission, captureMenuSubmission });
})(window);

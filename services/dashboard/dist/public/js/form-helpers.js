(function (global) {
    function clampExtractedDateNeeded(extractedStr, minStr) {
        const extracted = String(extractedStr || '').trim();
        const min = String(minStr || '').trim();
        if (!extracted) return { value: min, warning: null };
        if (!min || extracted >= min) return { value: extracted, warning: null };
        return {
            value: min,
            warning: `Date in document (${extracted}) is earlier than the minimum turnaround allows. Using ${min} instead.`,
        };
    }

    function parseExtractedSize(text) {
        const raw = String(text || '').trim();
        if (!raw) return null;
        const match = raw.match(/(\d+(?:\.\d+)?)\s*(?:"|inches?|in|px|pixels?)?\s*[x\u00d7]\s*(\d+(?:\.\d+)?)/i);
        if (!match) return null;
        const isPrint = /inch|"|in\b/i.test(raw);
        const isDigital = /pixel|px\b/i.test(raw);
        if (!isPrint && !isDigital) return null;
        return {
            width: match[1],
            height: match[2],
            unit: isPrint ? 'print' : 'digital',
        };
    }

    const api = { clampExtractedDateNeeded, parseExtractedSize };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.formHelpers = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

(function (global) {
    function isValidDateInputValue(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const [year, month, day] = value.split('-').map(Number);
        const parsed = new Date(year, month - 1, day);
        return parsed.getFullYear() === year &&
            parsed.getMonth() === month - 1 &&
            parsed.getDate() === day;
    }

    function isBusinessDay(date) {
        const day = date.getDay();
        return day !== 0 && day !== 6;
    }

    function addBusinessDays(date, days) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const count = Math.max(0, Number.parseInt(String(days || 0), 10) || 0);
        let added = 0;

        while (added < count) {
            d.setDate(d.getDate() + 1);
            if (isBusinessDay(d)) {
                added += 1;
            }
        }

        return d;
    }

    function clampExtractedDateNeeded(extractedStr, minStr) {
        const extracted = String(extractedStr || '').trim();
        const min = String(minStr || '').trim();
        if (!extracted) return { value: min, warning: null };
        if (!isValidDateInputValue(extracted)) {
            return {
                value: min,
                warning: `Date in document (${extracted}) is not a valid date field value. Using ${min} instead.`,
            };
        }
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

    function tokenizePropertyHint(text) {
        if (!text) return [];
        const noise = new Set(['uae', 'usa', 'uk', 'us', 'and', 'the', 'of']);
        return String(text)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((token) => token.length >= 2 && !noise.has(token));
    }

    function findCatalogMatchesFromHints(catalog, hints) {
        if (!Array.isArray(catalog) || !catalog.length) return [];
        const outletTokens = tokenizePropertyHint(hints && hints.outlet);
        const hotelTokens = tokenizePropertyHint(hints && hints.hotel);
        const cityTokens = tokenizePropertyHint(hints && hints.city);
        if (!outletTokens.length && !hotelTokens.length && !cityTokens.length) return [];

        return catalog.filter((entry) => {
            const name = String((entry && entry.name) || '').trim();
            const outletPart = name.split(' - ')[0] || '';
            const outletPartTokens = tokenizePropertyHint(outletPart);
            const nameTokens = tokenizePropertyHint(name);
            const entryHotelTokens = tokenizePropertyHint((entry && entry.hotel) || '');
            const entryCityTokens = tokenizePropertyHint((entry && (entry.cityCountry || entry.city_country)) || '');

            if (outletTokens.length) {
                const outletHint = outletTokens.slice().sort().join(' ');
                const catalogOutlet = outletPartTokens.slice().sort().join(' ');
                if (outletHint !== catalogOutlet) return false;
            }
            if (hotelTokens.length && !hotelTokens.every((token) => entryHotelTokens.includes(token) || nameTokens.includes(token))) {
                return false;
            }
            if (cityTokens.length && !cityTokens.every((token) => entryCityTokens.includes(token) || nameTokens.includes(token))) {
                return false;
            }
            return true;
        }).map((entry) => entry.name);
    }

    const api = {
        addBusinessDays,
        clampExtractedDateNeeded,
        isValidDateInputValue,
        parseExtractedSize,
        tokenizePropertyHint,
        findCatalogMatchesFromHints,
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.formHelpers = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

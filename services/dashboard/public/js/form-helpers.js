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
                warning: null,
            };
        }
        if (!min || extracted >= min) return { value: extracted, warning: null };
        return {
            value: min,
            warning: null,
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

    function normalizeSearchText(text) {
        return String(text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    function searchTextIncludes(text, query) {
        const normalizedQuery = normalizeSearchText(query).trim();
        if (!normalizedQuery) return false;
        if (normalizeSearchText(text).includes(normalizedQuery)) return true;

        const compactQuery = normalizedQuery.replace(/\s+/g, '');
        if (!compactQuery) return false;
        return normalizeSearchText(text).replace(/\s+/g, '').includes(compactQuery);
    }

    function buildSearchIndex(text, options) {
        const raw = String(text || '');
        const compact = !!(options && options.compact);
        let normalizedText = '';
        const indexMap = [];
        let originalIndex = 0;
        let pendingSeparatorStart = null;
        let lastOutputWasSpace = true;

        for (const char of Array.from(raw)) {
            const start = originalIndex;
            const end = start + char.length;
            originalIndex = end;

            const normalizedChar = char
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();

            for (const normalizedPart of Array.from(normalizedChar)) {
                if (/^[a-z0-9]$/.test(normalizedPart)) {
                    if (!compact && pendingSeparatorStart !== null && !lastOutputWasSpace && normalizedText.length > 0) {
                        normalizedText += ' ';
                        indexMap.push({ start: pendingSeparatorStart, end: start });
                    }
                    normalizedText += normalizedPart;
                    indexMap.push({ start, end });
                    pendingSeparatorStart = null;
                    lastOutputWasSpace = false;
                } else if (!lastOutputWasSpace && pendingSeparatorStart === null) {
                    pendingSeparatorStart = start;
                }
            }
        }

        return { normalizedText, indexMap };
    }

    function findSearchMatchRange(text, query) {
        const raw = String(text || '');
        const normalizedQuery = normalizeSearchText(query).trim();
        if (!raw || !normalizedQuery) return null;

        const { normalizedText, indexMap } = buildSearchIndex(raw);

        let activeText = normalizedText;
        let activeIndexMap = indexMap;
        let activeQuery = normalizedQuery;
        let normalizedStart = activeText.indexOf(activeQuery);
        if (normalizedStart < 0) {
            activeQuery = normalizedQuery.replace(/\s+/g, '');
            if (!activeQuery) return null;
            const compactIndex = buildSearchIndex(raw, { compact: true });
            activeText = compactIndex.normalizedText;
            activeIndexMap = compactIndex.indexMap;
            normalizedStart = activeText.indexOf(activeQuery);
        }
        if (normalizedStart < 0) return null;

        const normalizedEnd = normalizedStart + activeQuery.length - 1;
        const start = activeIndexMap[normalizedStart]?.start;
        const end = activeIndexMap[normalizedEnd]?.end;
        if (start === undefined || end === undefined || end <= start) return null;
        return { start, end };
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

    function normalizeMenuSizeLookupKey(value) {
        const normalized = normalizeSearchText(value);
        if (!normalized) return '';
        return normalized
            .replace(/\bmenus?\b/g, ' ')
            .replace(/\bevents?\b/g, ' ')
            .replace(/\band\b/g, ' ')
            .replace(/\bholiday\b/g, 'holidays')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeMenuSizeBoolean(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (['y', 'yes', 'true', '1'].includes(normalized)) return 'yes';
        if (['n', 'no', 'false', '0'].includes(normalized)) return 'no';
        return '';
    }

    function compactMenuSizeDefault(row) {
        if (!row || typeof row !== 'object') return null;
        const menuType = String(row.menu_type || row.menuType || '').trim();
        const width = String(row.width || '').trim();
        const height = String(row.height || '').trim();
        if (!menuType || !width || !height) return null;
        return {
            menuType,
            width,
            height,
            folded: normalizeMenuSizeBoolean(row.folded),
            cropMarks: normalizeMenuSizeBoolean(row.crop_marks || row.cropMarks),
            bleedMarks: normalizeMenuSizeBoolean(row.bleed_marks || row.bleedMarks),
        };
    }

    function findMenuSizeDefault(defaults, selectors) {
        const rows = Array.isArray(defaults)
            ? defaults.map(compactMenuSizeDefault).filter(Boolean)
            : [];
        if (!rows.length) return null;

        const serviceLabel = String((selectors && (selectors.serviceLabel || selectors.servicePeriod)) || '').trim();
        const templateValue = String((selectors && selectors.templateType) || '').trim();
        const templateLabel = String((selectors && selectors.templateLabel) || '').trim();
        const templateIsBeverage = /beverage/i.test(`${templateValue} ${templateLabel}`);
        const templateIsFood = /food/i.test(`${templateValue} ${templateLabel}`) && !templateIsBeverage;

        const candidates = [];
        if (serviceLabel && templateIsBeverage) candidates.push(`${serviceLabel} beverage`);
        if (serviceLabel) candidates.push(serviceLabel);
        if (templateIsBeverage) candidates.push('beverage');
        if (templateIsFood) candidates.push('food');

        const keys = candidates
            .map(normalizeMenuSizeLookupKey)
            .filter(Boolean);
        const seen = new Set();
        const uniqueKeys = keys.filter((key) => {
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        for (const key of uniqueKeys) {
            const exact = rows.find((row) => normalizeMenuSizeLookupKey(row.menuType) === key);
            if (exact) return exact;
        }
        for (const key of uniqueKeys) {
            const contained = rows.find((row) => {
                const rowKey = normalizeMenuSizeLookupKey(row.menuType);
                return rowKey && (rowKey.includes(key) || key.includes(rowKey));
            });
            if (contained) return contained;
        }
        return null;
    }

    function shouldBlockSubmitForStaleAiCheck(requiresAiRerun, completedCheckCount, unlockAfterCount) {
        if (!requiresAiRerun) return false;
        const completed = Number.parseInt(String(completedCheckCount || 0), 10) || 0;
        const unlockAfter = Number.parseInt(String(unlockAfterCount || 2), 10) || 2;
        return completed < unlockAfter;
    }

    function extractSuggestionChangePair(recommendation) {
        const text = String(recommendation || '').trim();
        if (!text) return null;

        const patterns = [
            /change\s+['']([^'']+)['']\s+to\s+['']([^'']+)['']/i,
            /change\s+"([^"]+)"\s+to\s+"([^"]+)"/i,
            /replace\s+['']([^'']+)['']\s+with\s+['']([^'']+)['']/i,
            /replace\s+"([^"]+)"\s+with\s+"([^"]+)"/i,
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (!match || match[1] === undefined || match[2] === undefined) continue;
            const from = match[1].trim();
            const to = match[2].trim();
            if (from && to && from !== to) {
                return { from, to };
            }
        }
        return null;
    }

    function normalizeSuggestionLineMatch(text) {
        return String(text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function replaceFirstLiteral(text, from, to) {
        const source = String(text || '');
        const idx = source.indexOf(from);
        if (idx < 0) return { applied: false, text: source };
        return {
            applied: true,
            text: `${source.slice(0, idx)}${to}${source.slice(idx + from.length)}`,
        };
    }

    function countLiteralOccurrences(text, needle) {
        if (!needle) return 0;
        let count = 0;
        let cursor = 0;
        const source = String(text || '');
        while (cursor <= source.length) {
            const idx = source.indexOf(needle, cursor);
            if (idx < 0) break;
            count += 1;
            cursor = idx + Math.max(needle.length, 1);
        }
        return count;
    }

    function collectLiteralOccurrenceRanges(text, needle) {
        const ranges = [];
        if (!needle) return ranges;
        const source = String(text || '');
        let cursor = 0;
        while (cursor <= source.length) {
            const idx = source.indexOf(needle, cursor);
            if (idx < 0) break;
            ranges.push({ start: idx, end: idx + needle.length });
            cursor = idx + Math.max(needle.length, 1);
        }
        return ranges;
    }

    function isSuggestionAlreadyApplied(menuText, suggestion) {
        const source = String(menuText || '');
        const pair = extractSuggestionChangePair(suggestion && suggestion.recommendation);
        if (!pair) return false;
        if (countLiteralOccurrences(source, pair.to) === 0) return false;

        const fromRanges = collectLiteralOccurrenceRanges(source, pair.from);
        if (fromRanges.length === 0) return true;

        // `from` may still appear as a substring of the replacement
        // (e.g. change 'Potato' to 'Loaded Potato'). Treat the suggestion as
        // applied when every remaining `from` occurrence sits inside an
        // occurrence of `to`.
        if (!pair.to.includes(pair.from)) return false;
        const toRanges = collectLiteralOccurrenceRanges(source, pair.to);
        return fromRanges.every(({ start, end }) =>
            toRanges.some((range) => start >= range.start && end <= range.end)
        );
    }

    function applySuggestionChangeToText(menuText, suggestion) {
        const sourceText = String(menuText || '');
        const pair = extractSuggestionChangePair(suggestion && suggestion.recommendation);
        if (!pair) {
            return {
                applied: false,
                menuText: sourceText,
                pair: null,
                reason: 'no_direct_change',
            };
        }

        const lines = sourceText.split('\n');
        const itemNorm = normalizeSuggestionLineMatch(suggestion && suggestion.menuItem);
        const lineIndexesWithFrom = lines
            .map((line, index) => ({ line, index }))
            .filter(({ line }) => line.includes(pair.from));

        const itemLineCandidates = itemNorm
            ? lineIndexesWithFrom.filter(({ line }) => normalizeSuggestionLineMatch(line).includes(itemNorm))
            : [];
        const startingItemLineCandidates = itemNorm
            ? itemLineCandidates.filter(({ line }) => normalizeSuggestionLineMatch(line).startsWith(itemNorm))
            : [];

        const targetLine = startingItemLineCandidates.length === 1
            ? startingItemLineCandidates[0]
            : itemLineCandidates.length === 1
            ? itemLineCandidates[0]
            : (lineIndexesWithFrom.length === 1 ? lineIndexesWithFrom[0] : null);

        if (targetLine) {
            const replaced = replaceFirstLiteral(targetLine.line, pair.from, pair.to);
            if (!replaced.applied) {
                return {
                    applied: false,
                    menuText: sourceText,
                    pair,
                    reason: 'target_not_found',
                };
            }
            const nextLines = lines.slice();
            nextLines[targetLine.index] = replaced.text;
            return {
                applied: true,
                menuText: nextLines.join('\n'),
                pair,
                reason: 'line_replacement',
            };
        }

        if (countLiteralOccurrences(sourceText, pair.from) === 1) {
            const replaced = replaceFirstLiteral(sourceText, pair.from, pair.to);
            return {
                applied: replaced.applied,
                menuText: replaced.text,
                pair,
                reason: replaced.applied ? 'unique_replacement' : 'target_not_found',
            };
        }

        return {
            applied: false,
            menuText: sourceText,
            pair,
            reason: lineIndexesWithFrom.length > 1 ? 'ambiguous_match' : 'target_not_found',
        };
    }

    const api = {
        addBusinessDays,
        applySuggestionChangeToText,
        clampExtractedDateNeeded,
        extractSuggestionChangePair,
        isSuggestionAlreadyApplied,
        isValidDateInputValue,
        normalizeSearchText,
        parseExtractedSize,
        searchTextIncludes,
        findSearchMatchRange,
        findMenuSizeDefault,
        tokenizePropertyHint,
        findCatalogMatchesFromHints,
        shouldBlockSubmitForStaleAiCheck,
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.formHelpers = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

const {
    addBusinessDays,
    clampExtractedDateNeeded,
    findCatalogMatchesFromHints,
    isValidDateInputValue,
    parseExtractedSize,
    shouldBlockSubmitForStaleAiCheck,
    tokenizePropertyHint,
} = require('../public/js/form-helpers');

describe('addBusinessDays', () => {
    test('skips Saturday and Sunday when calculating turnaround', () => {
        const friday = new Date(2026, 4, 15);
        expect(addBusinessDays(friday, 1)).toEqual(new Date(2026, 4, 18));
        expect(addBusinessDays(friday, 5)).toEqual(new Date(2026, 4, 22));
    });

    test('returns the same local date for zero or invalid day counts', () => {
        const date = new Date(2026, 4, 13);
        expect(addBusinessDays(date, 0)).toEqual(new Date(2026, 4, 13));
        expect(addBusinessDays(date, 'abc')).toEqual(new Date(2026, 4, 13));
    });
});

describe('clampExtractedDateNeeded', () => {
    test('returns extracted date when it meets the minimum', () => {
        const result = clampExtractedDateNeeded('2026-05-01', '2026-04-20');
        expect(result.value).toBe('2026-05-01');
        expect(result.warning).toBeNull();
    });

    test('returns extracted date when it equals the minimum', () => {
        const result = clampExtractedDateNeeded('2026-04-20', '2026-04-20');
        expect(result.value).toBe('2026-04-20');
        expect(result.warning).toBeNull();
    });

    test('clamps past date to the minimum without warning', () => {
        const result = clampExtractedDateNeeded('2026-04-13', '2026-04-20');
        expect(result.value).toBe('2026-04-20');
        expect(result.warning).toBeNull();
    });

    test('falls back to minimum when extracted date is empty', () => {
        const result = clampExtractedDateNeeded('', '2026-04-20');
        expect(result.value).toBe('2026-04-20');
        expect(result.warning).toBeNull();
    });

    test('falls back to minimum when extracted date is not an input-date value', () => {
        const result = clampExtractedDateNeeded('May 20, 2026', '2026-04-20');
        expect(result.value).toBe('2026-04-20');
        expect(result.warning).toBeNull();
    });

    test('falls back to minimum when extracted date is an impossible ISO date', () => {
        const result = clampExtractedDateNeeded('2026-02-31', '2026-04-20');
        expect(result.value).toBe('2026-04-20');
        expect(result.warning).toBeNull();
    });

    test('returns extracted date when min is empty', () => {
        const result = clampExtractedDateNeeded('2026-05-01', '');
        expect(result.value).toBe('2026-05-01');
        expect(result.warning).toBeNull();
    });

    test('trims whitespace from inputs', () => {
        const result = clampExtractedDateNeeded('  2026-04-13  ', '  2026-04-20  ');
        expect(result.value).toBe('2026-04-20');
        expect(result.warning).toBeNull();
    });
});

describe('isValidDateInputValue', () => {
    test('accepts valid date input values only', () => {
        expect(isValidDateInputValue('2026-05-20')).toBe(true);
        expect(isValidDateInputValue('05/20/2026')).toBe(false);
        expect(isValidDateInputValue('May 20, 2026')).toBe(false);
        expect(isValidDateInputValue('2026-02-31')).toBe(false);
    });
});

describe('parseExtractedSize', () => {
    test('parses print size with inches', () => {
        expect(parseExtractedSize('8.5 x 11 inches')).toEqual({
            width: '8.5',
            height: '11',
            unit: 'print',
        });
    });

    test('parses print size with double-quote unit', () => {
        expect(parseExtractedSize('8.5" x 11"')).toEqual({
            width: '8.5',
            height: '11',
            unit: 'print',
        });
    });

    test('parses digital size with pixels', () => {
        expect(parseExtractedSize('1920 x 1080 pixels')).toEqual({
            width: '1920',
            height: '1080',
            unit: 'digital',
        });
    });

    test('parses digital size with px suffix', () => {
        expect(parseExtractedSize('1920px x 1080px')).toEqual({
            width: '1920',
            height: '1080',
            unit: 'digital',
        });
    });

    test('accepts unicode multiplication sign', () => {
        expect(parseExtractedSize('8.5 \u00d7 11 inches')).toEqual({
            width: '8.5',
            height: '11',
            unit: 'print',
        });
    });

    test('returns null when no dimensions are present', () => {
        expect(parseExtractedSize('large')).toBeNull();
    });

    test('returns null when unit is ambiguous', () => {
        expect(parseExtractedSize('8 x 10')).toBeNull();
    });

    test('returns null for empty input', () => {
        expect(parseExtractedSize('')).toBeNull();
        expect(parseExtractedSize(null)).toBeNull();
        expect(parseExtractedSize(undefined)).toBeNull();
    });
});

describe('property catalog hint matching', () => {
    const catalog = [
        {
            name: 'Maya - Le Royal Meridien - Dubai',
            hotel: 'Le Royal Meridien',
            cityCountry: 'Dubai',
        },
        {
            name: 'Maya - Le Meridien - Dubai',
            hotel: 'Le Meridien',
            cityCountry: 'Dubai',
        },
        {
            name: 'Toro - St. Regis Kanai - Riviera Maya',
            hotel: 'St. Regis Kanai',
            cityCountry: 'Riviera Maya',
        },
        {
            name: 'Toro Toro - Four Seasons - Doha',
            hotel: 'Four Seasons',
            cityCountry: 'Doha',
        },
        {
            name: 'Toro - Four Seasons - Doha',
            hotel: 'Four Seasons',
            cityCountry: 'Doha',
        },
    ];

    test('tokenizes punctuation, diacritics, and short country noise', () => {
        expect(tokenizePropertyHint('Le Royal Méridien, Dubai UAE')).toEqual(['le', 'royal', 'meridien', 'dubai']);
    });

    test('resolves the Maya Royal Meridien Dubai property from split template hints', () => {
        expect(findCatalogMatchesFromHints(catalog, {
            outlet: 'Maya',
            hotel: 'Le Royal Meridien',
            city: 'Dubai',
        })).toEqual(['Maya - Le Royal Meridien - Dubai']);
    });

    test('does not match an outlet hint against city text', () => {
        expect(findCatalogMatchesFromHints(catalog, {
            outlet: 'Maya',
            hotel: 'St. Regis Kanai',
            city: 'Riviera Maya',
        })).toEqual([]);
    });

    test('keeps repeated outlet tokens distinct', () => {
        expect(findCatalogMatchesFromHints(catalog, {
            outlet: 'Toro',
            hotel: 'Four Seasons',
            city: 'Doha',
        })).toEqual(['Toro - Four Seasons - Doha']);
        expect(findCatalogMatchesFromHints(catalog, {
            outlet: 'Toro Toro',
            hotel: 'Four Seasons',
            city: 'Doha',
        })).toEqual(['Toro Toro - Four Seasons - Doha']);
    });

    test('returns multiple matches when hints are genuinely ambiguous', () => {
        expect(findCatalogMatchesFromHints(catalog, {
            outlet: 'Maya',
            city: 'Dubai',
        })).toEqual([
            'Maya - Le Royal Meridien - Dubai',
            'Maya - Le Meridien - Dubai',
        ]);
    });
});

describe('stale AI check submit gate', () => {
    test('does not block when the menu has not changed after AI check', () => {
        expect(shouldBlockSubmitForStaleAiCheck(false, 1)).toBe(false);
    });

    test('blocks a stale menu after only one completed AI check', () => {
        expect(shouldBlockSubmitForStaleAiCheck(true, 1)).toBe(true);
    });

    test('allows stale edits after the second completed AI check', () => {
        expect(shouldBlockSubmitForStaleAiCheck(true, 2)).toBe(false);
        expect(shouldBlockSubmitForStaleAiCheck(true, 3)).toBe(false);
    });
});

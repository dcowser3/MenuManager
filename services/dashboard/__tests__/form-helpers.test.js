const { clampExtractedDateNeeded, parseExtractedSize } = require('../public/js/form-helpers');

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

    test('clamps past date to the minimum and returns a warning', () => {
        const result = clampExtractedDateNeeded('2026-04-13', '2026-04-20');
        expect(result.value).toBe('2026-04-20');
        expect(result.warning).toContain('2026-04-13');
        expect(result.warning).toContain('2026-04-20');
    });

    test('falls back to minimum when extracted date is empty', () => {
        const result = clampExtractedDateNeeded('', '2026-04-20');
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
        expect(result.warning).toContain('2026-04-13');
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

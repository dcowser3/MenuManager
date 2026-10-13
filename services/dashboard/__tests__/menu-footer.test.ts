import {
    RAW_NOTICE_PATTERN,
    isGenericMissingCanonicalRawNoticeFinding,
    ensureRawNoticeInMenu,
    menuNeedsRawNotice,
    containsAnyRawNotice,
    readRawNoticeNotNeeded,
    isLikelyAllergenLegendLine,
    isLikelyRawNoticeLine,
    normalizeMenuFooter,
    stripManagedFooterText,
} from '../lib/menu-footer';

describe('menu-footer (extracted from index.ts)', () => {
    test('normalizeMenuFooter extracts the allergen legend and preserves footer lines', () => {
        const result = normalizeMenuFooter([
            'DINNER MENU',
            '',
            'GUACAMOLE',
            'fresh avocado, lime 12',
            '',
            'G contains gluten | V vegetarian | D contains dairy',
            '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.',
        ].join('\n'));

        expect(result.body).toBe('DINNER MENU\n\nGUACAMOLE\nfresh avocado, lime 12');
        expect(result.normalizedAllergenLine).toBe('G contains gluten | V vegetarian | D contains dairy');
        expect(result.hadRawNotice).toBe(true);
        expect(result.preservedFooterText).toContain('foodborne illness');
    });

    test('normalizeMenuFooter falls back to provided allergens and collapses blank runs', () => {
        const result = normalizeMenuFooter('TACOS\n\n\n\nal pastor 14', 'G gluten | V veg | N nuts');
        expect(result.body).toBe('TACOS\n\nal pastor 14');
        expect(result.normalizedAllergenLine).toBe('G gluten | V veg | N nuts');
        expect(result.hadRawNotice).toBe(false);
    });

    test('stripManagedFooterText returns only the menu body', () => {
        const stripped = stripManagedFooterText(
            'CEVICHE 16\nAll prices are in USD\nWe welcome enquiries for private events'
        );
        expect(stripped).toBe('CEVICHE 16');
    });

    test('raw notice detection matches the canonical warning with and without shellfish', () => {
        expect(RAW_NOTICE_PATTERN.test('*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.')).toBe(true);
        expect(RAW_NOTICE_PATTERN.test('consuming raw or undercooked meats, poultry, seafood, or eggs may increase your risk of foodborne illness')).toBe(true);
        expect(isLikelyRawNoticeLine('Consuming raw or undercooked items may increase your risk of foodborne illness')).toBe(false);
        expect(isLikelyRawNoticeLine('GUACAMOLE fresh avocado')).toBe(false);
    });

    test('allergen legend detection requires multiple coded segments', () => {
        expect(isLikelyAllergenLegendLine('G contains gluten | V vegetarian | D dairy')).toBe(true);
        expect(isLikelyAllergenLegendLine('add chorizo 5 | mushrooms 4')).toBe(false);
    });
});

describe('isGenericMissingCanonicalRawNoticeFinding wording', () => {
    // Tan CRS DDLM Event (2026-10-13): the managed notice still raised a critical
    // because the model called it an "advisory" / "footer", not a warning or notice.
    test.each([
        ['The required raw and undercooked foodborne-illness advisory is not included.', 'Add the standard footer: *CONSUMING RAW OR UNDERCOOKED MEATS, POULTRY, SEAFOOD, SHELLFISH, OR EGGS MAY INCREASE YOUR RISK OF FOODBORNE ILLNESS'],
        ['The required raw and undercooked food warning is not included.', 'Add: *CONSUMING RAW OR UNDERCOOKED MEATS, POULTRY, SEAFOOD, SHELLFISH, OR EGGS MAY INCREASE YOUR RISK OF FOODBORNE ILLNESS'],
        ['The standard raw consumption disclaimer is missing.', 'Include the foodborne illness statement at the bottom.'],
    ])('recognizes "%s"', (description, recommendation) => {
        expect(isGenericMissingCanonicalRawNoticeFinding({ type: 'General', menuItem: 'Entire menu', severity: 'critical', description, recommendation } as any)).toBe(true);
    });

    test('still keeps a dish-specific raw marker finding', () => {
        expect(isGenericMissingCanonicalRawNoticeFinding({
            type: 'Raw Item', menuItem: 'Entire menu',
            description: 'The tiradito needs a raw marker asterisk; the required advisory references it.',
            recommendation: 'Add an asterisk to the dish.',
        })).toBe(false);
    });
});

// The foodborne notice is owned by code and stays visible (Tan CRS DDLM Event, 2026-10-13).
describe('code-owned foodborne notice', () => {
    const notice = '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.';

    test('a menu needs the notice when a dish has a raw marker or a raw preparation', () => {
        expect(menuNeedsRawNotice('Salmon tiradito, saffron aguachile*')).toBe(true);
        expect(menuNeedsRawNotice('Beef carpaccio, arugula D 18')).toBe(true);
        expect(menuNeedsRawNotice('Short rib enchiladas, zucchini blossom sauce D')).toBe(false);
    });

    test('ordinary words do not count as raw items', () => {
        expect(menuNeedsRawNotice('Strawberry shortcake, drawn butter, raw honey, rare bourbon glaze 14')).toBe(false);
        expect(menuNeedsRawNotice(notice)).toBe(false);
    });

    test('adds the standard notice to a raw menu that lacks it', () => {
        const result = ensureRawNoticeInMenu('Canapes\nSalmon tiradito*', 'Canapes\nSalmon tiradito*');
        expect(result.added).toBe(true);
        expect(result.text.split('\n').pop()).toMatch(/foodborne illness/);
    });

    test('puts back the notice the chef wrote instead of a new one', () => {
        const chefNotice = 'CONSUMING RAW OR UNDERCOOKED MEATS, POULTRY, SEAFOOD, SHELLFISH, OR EGGS MAY INCREASE YOUR RISK OF FOODBORNE ILLNESS';
        const result = ensureRawNoticeInMenu('Canapes\nSalmon tiradito*', `Canapes\nSalmon tiradito*\n\n${chefNotice}`);
        expect(result).toEqual({ text: `Canapes\nSalmon tiradito*\n\n${chefNotice}`, added: false });
    });

    test('respects "this menu does not need the notice"', () => {
        expect(ensureRawNoticeInMenu('Salmon tiradito*', 'Salmon tiradito*', { notNeeded: true })).toEqual({ text: 'Salmon tiradito*', added: false });
    });

    test('never adds a second notice next to a venue-worded one', () => {
        const venue = 'Consuming raw or undercooked items may increase your risk of foodborne illness.';
        expect(containsAnyRawNotice(venue)).toBe(true);
        expect(ensureRawNoticeInMenu(`Salmon tiradito*\n\n${venue}`, '').added).toBe(false);
    });

    test('adds nothing to a menu without raw items', () => {
        expect(ensureRawNoticeInMenu('Short rib D 24', 'Short rib D 24')).toEqual({ text: 'Short rib D 24', added: false });
    });

    test('reads the opt-out from a form body or its stored JSON copy', () => {
        expect(readRawNoticeNotNeeded({ rawNoticeNotNeeded: true })).toBe(true);
        expect(readRawNoticeNotNeeded(JSON.stringify({ suppressRawNotice: true }))).toBe(true);
        expect(readRawNoticeNotNeeded({})).toBe(false);
    });
});

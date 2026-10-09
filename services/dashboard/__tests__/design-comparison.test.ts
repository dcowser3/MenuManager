import { compareMenuTexts, DesignComparisonIntent, normalizeExtractedText } from '../lib/design-comparison';
import { getDesignComparisonSource, parseExtractorJson } from '../lib/design-approval-workflow';

function actionable(docx: string, pdf: string, intent?: DesignComparisonIntent) {
    return compareMenuTexts(docx, pdf, intent).differences.filter((difference) => difference.severity !== 'info');
}

describe('design approval comparison', () => {
    test('accepts casing, punctuation, and line wrapping without losing structured values', () => {
        const source = 'TACO AL PASTOR, pork, onion D,G 18';
        const proof = [
            '(D) DAIRY | (G) GLUTEN | (V) VEGETARIAN',
            'TACO AL PASTOR D,G 18',
            'pork, onion',
        ].join('\n');

        expect(actionable(source, proof)).toEqual([]);
    });

    test('keeps price and allergen changes blocking', () => {
        const differences = actionable(
            'TACO AL PASTOR, pork D 18',
            'TACO AL PASTOR G 20\npork',
        );

        expect(differences).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'price', severity: 'critical' }),
            expect.objectContaining({ type: 'allergen', severity: 'critical', docxValue: 'D' }),
            expect.objectContaining({ type: 'allergen', severity: 'critical', pdfValue: 'G' }),
        ]));
    });

    test('does not classify a punctuation-only year change as a price change', () => {
        const differences = actionable(
            'Tuesday October 21st, 2026.',
            'TUESDAY OCTOBER 21ST, 2026',
        );

        expect(differences.filter((difference) => difference.type === 'price')).toEqual([]);
    });

    test('normalizes PDF ligatures and non-printing separators', () => {
        expect(normalizeExtractedText('shellﬁsh ﬂour MAHI\u001fMAHI')).toBe('shellfish flour MAHI-MAHI');
        expect(actionable('shellfish flour MAHI-MAHI', 'shellﬁsh ﬂour MAHI\u001fMAHI')).toEqual([]);
    });

    test('excludes managed footer copy and editorial instructions from actionable results', () => {
        const source = [
            'TACO, pork D 18',
            '(remove old taco)',
            'G contains gluten | D contains dairy | V vegetarian',
            '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.',
        ].join('\n');
        const proof = [
            '(D) DAIRY | (G) GLUTEN | (V) VEGETARIAN',
            '*CONSUMING RAW OR UNDERCOOKED MEATS, POULTRY, SEAFOOD, SHELLFISH, OR EGGS MAY INCREASE YOUR RISK OF FOODBORNE ILLNESS.',
            'TACO D 18',
            'pork',
        ].join('\n');

        expect(actionable(source, proof)).toEqual([]);
    });

    test('passes red or struck content that was successfully removed from the proof', () => {
        const source = 'Maduros, plantains D,V';
        const proof = 'Maduros D,V\nplantains';
        const intent: DesignComparisonIntent = {
            removedContent: [
                { text: 'Kale Salad, apple D', scope: 'line', markers: ['red'] },
                {
                    text: 'tomatillo salsa',
                    context: 'Maduros, plantains, tomatillo salsa D,V',
                    active_text: source,
                    scope: 'fragment',
                    markers: ['strikethrough'],
                },
            ],
        };

        expect(actionable(source, proof, intent)).toEqual([]);
    });

    test('blocks red or struck content that remains in the proof', () => {
        const source = 'Shrimp Ceviche, avocado, tomato S';
        const proof = 'Shrimp Ceviche S\navocado, cherry tomato\nYUCATAN KIBIS D\nseasoned beef';
        const intent: DesignComparisonIntent = {
            removedContent: [
                { text: 'Yucatan Kibis, seasoned beef D', scope: 'line', markers: ['red'] },
                {
                    text: 'cherry',
                    context: 'Shrimp Ceviche, avocado, cherry tomato S',
                    active_text: source,
                    scope: 'fragment',
                    markers: ['strikethrough'],
                },
            ],
        };

        const differences = actionable(source, proof, intent);
        expect(differences).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'removal_failed', severity: 'critical', docxValue: expect.stringContaining('Yucatan Kibis') }),
            expect.objectContaining({ type: 'removal_failed', severity: 'critical', docxValue: 'cherry' }),
        ]));
    });

    test('labels missing yellow-highlighted content as a required addition', () => {
        const source = 'Maduros, plantains, crema D,V';
        const intent: DesignComparisonIntent = {
            requiredContent: [{
                text: source,
                context: source,
                active_text: source,
                scope: 'line',
                markers: ['yellow'],
            }],
        };

        expect(actionable(source, '', intent)).toEqual([
            expect.objectContaining({
                type: 'required_addition_missing',
                severity: 'critical',
                docxValue: source,
            }),
        ]);
    });
});

describe('extractor JSON contract', () => {
    test('uses an intentionally empty formatted baseline when every source line is marked for removal', () => {
        expect(getDesignComparisonSource({
            menu_content: 'Kale Salad, apple D',
            comparison_menu_content: '',
        })).toBe('');
    });

    test('parses strict JSON output', () => {
        expect(parseExtractorJson('{"full_text":"menu"}', 'PDF extractor')).toEqual({ full_text: 'menu' });
    });

    test('recovers a final JSON object after an upstream warning', () => {
        expect(parseExtractorJson(
            'deprecated library warning\n{"full_text":"menu"}\n',
            'PDF extractor',
        )).toEqual({ full_text: 'menu' });
    });

    test('returns a stable error for invalid output', () => {
        expect(() => parseExtractorJson('warning only', 'PDF extractor'))
            .toThrow('PDF extractor returned invalid JSON');
    });
});

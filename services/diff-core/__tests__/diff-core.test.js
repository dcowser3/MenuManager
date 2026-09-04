const diffCore = require('../src');

describe('diff core', () => {
    test('keeps newly added Toro allergen suffixes on the exact corrected rows', () => {
        const fixture = require('../../dashboard/__fixtures__/basic-check/toro-holiday.json');
        const sourceHtml = fixture.originalLines.map((line) => `<p>${line.replace(/&/g, '&amp;')}</p>`).join('');
        const target = fixture.modelCorrectedLines.join('\n');
        const html = diffCore.projectRichTextHtml(sourceHtml, target);
        // Literal newlines in HTML collapse in the browser: every target row
        // boundary must be serialized as a break, with no source breaks reused.
        const displayed = diffCore.createRichTextIndexFromHtml(html.replace(/\n/g, ' ')).plain;
        expect(displayed).toBe(target);
        expect(html.match(/<br>/g)).toHaveLength(fixture.modelCorrectedLines.length - 1);
    });

    test.each([
        ['<p>First dish</p><p>Second dish</p>', 'First dish S\nSecond dish VG'],
        ['<p>First dish S</p><p>Second dish VG</p>', 'First dish\nSecond dish'],
        ['<p>Old dish</p>', 'New dish\n\nAnother dish'],
        ['', 'New dish\n\nAnother dish'],
        ['<p><strong>Chef’s Special</strong></p>', "Chef's Special"],
    ])('projection preserves target text independently of matched source whitespace', (source, target) => {
        const html = diffCore.projectRichTextHtml(source, target);
        expect(diffCore.createRichTextIndexFromHtml(html.replace(/\n/g, ' ')).plain).toBe(target);
    });

    test('tokenizes words, separators, punctuation, and whitespace with offsets', () => {
        expect(diffCore.tokenizeDiffText('pickled jalapeño D, G').map((token) => ({
            value: token.value,
            type: token.type,
            start: token.start,
            end: token.end,
        }))).toEqual([
            { value: 'pickled', type: 'word', start: 0, end: 7 },
            { value: ' ', type: 'whitespace', start: 7, end: 8 },
            { value: 'jalapeño', type: 'word', start: 8, end: 16 },
            { value: ' ', type: 'whitespace', start: 16, end: 17 },
            { value: 'D', type: 'word', start: 17, end: 18 },
            { value: ',', type: 'separator', start: 18, end: 19 },
            { value: ' ', type: 'whitespace', start: 19, end: 20 },
            { value: 'G', type: 'word', start: 20, end: 21 },
        ]);
    });

    test('builds grouped token edits from shared LCS alignment', () => {
        const before = diffCore.tokenizeDiffText('sugar, cinnamon ice cream');
        const after = diffCore.tokenizeDiffText('sugar, ice cream');

        expect(diffCore.buildTokenEdits(before, after).map((edit) => ({
            type: edit.type,
            text: edit.tokens.map((token) => token.value).join(''),
        }))).toEqual([
            { type: 'equal', text: 'sugar, ' },
            { type: 'delete', text: 'cinnamon ' },
            { type: 'equal', text: 'ice cream' },
        ]);
    });

    test('indexes rich HTML text ranges so shared diff renderers can preserve inline styles', () => {
        const index = diffCore.createRichTextIndexFromHtml([
            '<p><strong>COLD STARTERS</strong></p>',
            '<p><strong>Guacamole Traditional</strong>, avocado &amp; tomato</p>',
        ].join(''));

        expect(index.plain).toBe([
            'COLD STARTERS',
            'Guacamole Traditional, avocado & tomato',
        ].join('\n'));

        const start = index.plain.indexOf('Guacamole');
        const end = index.plain.indexOf(', avocado');

        expect(diffCore.renderRichTextRange(index.entries, start, end, 'Guacamole Traditional'))
            .toBe('<strong>Guacamole Traditional</strong>');
    });

    test('projects source inline formatting onto corrected menu text', () => {
        const sourceHtml = [
            '<p><strong>COLD STARTERS</strong></p>',
            '<p><strong>Guacamole Traditional</strong>, avocado, tomato, lime V 85</p>',
            '<p><strong>Market Salad</strong>, avocado, heirloom tomatoes V 70</p>',
        ].join('');
        const correctedText = [
            'COLD STARTERS',
            'Guacamole Traditional, avocado, tomato, lime V 95',
            'Market Salad, avocado, heirloom tomatoes V 70',
        ].join('\n');

        const html = diffCore.projectRichTextHtml(sourceHtml, correctedText);

        expect(html).toContain('<strong>Guacamole</strong><strong> </strong><strong>Traditional</strong>');
        expect(html).toContain('<strong>Market</strong><strong> </strong><strong>Salad</strong>');
        expect(html).toContain('lime V 95');
    });
});

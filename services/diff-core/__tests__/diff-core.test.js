const diffCore = require('../src');

describe('diff core', () => {
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
});

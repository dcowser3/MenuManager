const redlinePreview = require('../public/js/redline-preview');

describe('redline preview helpers', () => {
    test('re-inserts imported deletions for preview without requiring them in editor text', () => {
        const previewText = 'green aguachile, avocadoavocad, wakame';
        const cleanText = 'green aguachile, avocad, wakame';
        const deletionStart = previewText.indexOf('avocado');
        const annotationMap = {};

        for (let i = deletionStart; i < deletionStart + 'avocado'.length; i++) {
            annotationMap[i] = 'del';
        }

        expect(redlinePreview.stripExistingDeletions(previewText, annotationMap)).toBe(cleanText);
        expect(
            redlinePreview.reinsertExistingDeletions(cleanText, cleanText, previewText, annotationMap)
        ).toBe(previewText);
        expect(
            redlinePreview.reinsertExistingDeletions(
                cleanText,
                'green aguachile, avocado, wakame',
                previewText,
                annotationMap
            )
        ).toBe('green aguachile, avocadoavocado, wakame');
    });
});

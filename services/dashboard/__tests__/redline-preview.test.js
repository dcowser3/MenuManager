const redlinePreview = require('../public/js/redline-preview');

describe('redline preview helpers', () => {
    test('extracts one logical newline per rendered menu row', () => {
        const element = {
            children: [
                { innerText: 'COLD STARTERS' },
                { innerText: 'Guacamole Traditional, avocado, tomato, onion, cilantro, lime V 85' },
                { innerText: 'Market Salad, avocado, heirloom tomatoes, halloumi cheee, cucumber, red onion D, V 70' },
            ],
        };

        expect(redlinePreview.extractCleanTextFromElement(element)).toBe([
            'COLD STARTERS',
            'Guacamole Traditional, avocado, tomato, onion, cilantro, lime V 85',
            'Market Salad, avocado, heirloom tomatoes, halloumi cheee, cucumber, red onion D, V 70',
        ].join('\n'));
    });

    test('collapses browser-rendered empty spacer rows during clean extraction', () => {
        const element = {
            children: [
                { innerText: 'COLD STARTERS' },
                { innerText: '' },
                { innerText: '' },
                { innerText: 'Guacamole Traditional, avocado, tomato, onion, cilantro, lime V 85' },
            ],
        };

        expect(redlinePreview.extractCleanTextFromElement(element)).toBe([
            'COLD STARTERS',
            '',
            'Guacamole Traditional, avocado, tomato, onion, cilantro, lime V 85',
        ].join('\n'));
    });

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

    test('keeps adjacent imported deletion/insertion pairs separated after a new edit', () => {
        const baselinePreviewText = [
            'Chimichanga, adobo marinated chicken, black beans, sour cream, pico de gallo, red pickled onions, cotija cheese, pickled jalapenojalapeño D, G,ET M ,SL 160',
            'DESSERT',
            'Choco-Flan, neapolitanNeapolitan flan, abuelita chocolate sauce, cinnamon ice cream D,E,G,PN,SY,TN,V 60',
        ].join('\n');
        const baselineText = [
            'Chimichanga, adobo marinated chicken, black beans, sour cream, pico de gallo, red pickled onions, cotija cheese, pickled jalapeño D, G, M ,SL 160',
            'DESSERT',
            'Choco-Flan, Neapolitan flan, abuelita chocolate sauce, cinnamon ice cream D,E,G,PN,SY,TN,V 60',
        ].join('\n');
        const revisedText = [
            'Chimichanga, adobo marinated chicken, black beans, sour cream, pico de gallo, red pickled onions, cotija cheese, pickled jalapeño D, G, M ,SL 160',
            'DESSERT',
            'Choco-Flan, Neapolitan flan, abuelita chocolate sauce, ice cream D,E,G,PN,SY,TN,V 60',
        ].join('\n');
        const annotationMap = {};

        function mark(text, type) {
            const start = baselinePreviewText.indexOf(text);
            expect(start).toBeGreaterThanOrEqual(0);
            for (let i = start; i < start + text.length; i++) {
                annotationMap[i] = type;
            }
        }

        mark('jalapeno', 'del');
        mark('jalapeño', 'ins');
        mark('ET', 'del');
        mark('neapolitan', 'del');
        mark('Neapolitan', 'ins');

        const revisedPreviewText = redlinePreview.reinsertExistingDeletions(
            baselineText,
            revisedText,
            baselinePreviewText,
            annotationMap
        );
        const rendered = redlinePreview.renderPersistentPreview(baselinePreviewText, revisedPreviewText, {
            annotationMap,
            includeExistingAnnotations: true,
        });

        expect(rendered.html).toContain('<span class="existing-del">jalapeno</span><span class="existing-ins">jalapeño</span>');
        expect(rendered.html).toContain('<span class="existing-del">neapolitan</span><span class="existing-ins">Neapolitan</span>');
        expect(rendered.html).toContain('<span class="persistent-del">cinnamon</span>');
        expect(rendered.insertions).toBe(0);
        expect(rendered.deletions).toBe(1);
    });
});

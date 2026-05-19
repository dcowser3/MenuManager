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

    test('extracts text from an edited rich surface without child blocks', () => {
        const element = {
            children: [],
            textContent: '  COLD STARTERS\n\nGuacamole Traditional 85  ',
        };

        expect(redlinePreview.extractCleanTextFromElement(element)).toBe([
            'COLD STARTERS',
            '',
            'Guacamole Traditional 85',
        ].join('\n'));
    });

    test('builds clean editable HTML that preserves bold source formatting', () => {
        const baselineHtml = [
            '<p><strong>Dinner Menu</strong></p>',
            '<p><strong>Smoked Guacamole</strong>, tomato, red onion VG 18</p>',
        ].join('');
        const cleanText = [
            'Dinner Menu',
            'Smoked Guacamole, tomato, red onion VG 18',
        ].join('\n');

        const editableHtml = redlinePreview.buildEditableHtmlFromBaseline(baselineHtml, cleanText);

        expect(editableHtml).toContain('<p><strong>Dinner</strong><strong> </strong><strong>Menu</strong></p>');
        expect(editableHtml).toContain('<strong>Smoked</strong><strong> </strong><strong>Guacamole</strong>');
        expect(editableHtml).toContain(', tomato, red onion VG 18');
    });

    test('restores leading dish-name bold after AI text projection', () => {
        const sourceHtml = [
            '<p><strong>Mexican Chopped Salad,</strong> mixed greens, panela cheese D,N 16</p>',
            '<p><strong>Tortilla Soup,</strong> shredded chicken, crema fresca espuma D,G 13</p>',
        ].join('');
        const projectedHtml = [
            '<p>Mexican Chopped Salad, mixed greens, panela cheese D,N 16</p>',
            '<p>Tortilla Soup, shredded chicken, crema fresca espuma D,G 13</p>',
        ].join('');

        const restored = redlinePreview.restoreLeadingBoldFromSource(sourceHtml, projectedHtml);

        expect(restored).toContain('<strong>Mexican Chopped Salad,</strong> mixed greens');
        expect(restored).toContain('<strong>Tortilla Soup,</strong> shredded chicken');
    });

    test('strips transient AI review highlights without removing real redlines or bold', () => {
        const baselineHtml = [
            '<p><strong>Margaritas</strong></p>',
            '<p><span style="background-color: rgba(74, 124, 89, 0.2);">Fresh</span>',
            '<span style="background-color: rgba(74, 124, 89, 0.2);">Fruit</span> 15</p>',
            '<p><span class="existing-del">old</span><span class="existing-ins">new</span></p>',
        ].join('');

        const displayHtml = redlinePreview.stripTransientReviewHighlights(baselineHtml);

        expect(displayHtml).toContain('<strong>Margaritas</strong>');
        expect(displayHtml).toContain('FreshFruit 15');
        expect(displayHtml).not.toContain('rgba(74, 124, 89');
        expect(displayHtml).toContain('<span class="existing-del">old</span>');
        expect(displayHtml).toContain('<span class="existing-ins">new</span>');
    });

    test('builds editable HTML without imported redline styling', () => {
        const baselineHtml = [
            '<p><strong>Sword <span class="existing-del">Fishh</span><span class="existing-ins">Fish</span> Dip</strong>, chips D 22</p>',
        ].join('');
        const cleanText = 'Sword Fish Dip, chips D 22';

        const editableHtml = redlinePreview.buildEditableHtmlFromBaseline(baselineHtml, cleanText);

        expect(editableHtml).not.toContain('existing-del');
        expect(editableHtml).not.toContain('existing-ins');
        expect(editableHtml).not.toContain('Fishh');
        expect(editableHtml).toContain('<strong>Fish</strong>');
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

    test('collapses an imported redline when reviewer edits accepted text back to the original value', () => {
        const baselinePreviewText = 'Jamon Iberico, shredded tomato sauce G 2425';
        const baselineText = 'Jamon Iberico, shredded tomato sauce G 25';
        const revisedText = 'Jamon Iberico, shredded tomato sauce G 24';
        const annotationMap = {};
        const deletedStart = baselinePreviewText.indexOf('24');
        const insertedStart = baselinePreviewText.indexOf('25', deletedStart + 2);

        for (let i = deletedStart; i < deletedStart + 2; i++) {
            annotationMap[i] = 'del';
        }
        for (let i = insertedStart; i < insertedStart + 2; i++) {
            annotationMap[i] = 'ins';
        }

        const resolved = redlinePreview.resolveExistingAnnotationRevisions(
            baselineText,
            revisedText,
            baselinePreviewText,
            annotationMap
        );
        const rendered = redlinePreview.renderPersistentPreview(resolved.basePreviewText, resolved.revisedPreviewText, {
            annotationMap: resolved.annotationMap,
            includeExistingAnnotations: true,
        });

        expect(resolved.basePreviewText).toBe(revisedText);
        expect(resolved.revisedPreviewText).toBe(revisedText);
        expect(rendered.html).toContain('sauce G 24');
        expect(rendered.html).not.toContain('existing-del');
        expect(rendered.html).not.toContain('existing-ins');
        expect(rendered.html).not.toContain('persistent-del');
        expect(rendered.html).not.toContain('persistent-ins');
        expect(rendered.insertions).toBe(0);
        expect(rendered.deletions).toBe(0);
    });

    test('collapses a reverted imported redline when accepted text is a prefix of the original value', () => {
        const baselinePreviewText = 'Sword Fish DippDip, homemade pickled chili';
        const baselineText = 'Sword Fish Dip, homemade pickled chili';
        const revisedText = 'Sword Fish Dipp, homemade pickled chili';
        const annotationMap = {};
        const deletedStart = baselinePreviewText.indexOf('Dipp');
        const insertedStart = baselinePreviewText.indexOf('Dip', deletedStart + 4);

        for (let i = deletedStart; i < deletedStart + 4; i++) {
            annotationMap[i] = 'del';
        }
        for (let i = insertedStart; i < insertedStart + 3; i++) {
            annotationMap[i] = 'ins';
        }

        const resolved = redlinePreview.resolveExistingAnnotationRevisions(
            baselineText,
            revisedText,
            baselinePreviewText,
            annotationMap
        );
        const rendered = redlinePreview.renderPersistentPreview(resolved.basePreviewText, resolved.revisedPreviewText, {
            annotationMap: resolved.annotationMap,
            includeExistingAnnotations: true,
        });

        expect(resolved.basePreviewText).toBe(revisedText);
        expect(resolved.revisedPreviewText).toBe(revisedText);
        expect(rendered.html).toContain('Sword Fish Dipp, homemade');
        expect(rendered.html).not.toContain('existing-del');
        expect(rendered.html).not.toContain('existing-ins');
        expect(rendered.html).not.toContain('persistent-del');
        expect(rendered.html).not.toContain('persistent-ins');
        expect(rendered.insertions).toBe(0);
        expect(rendered.deletions).toBe(0);
    });

    test('does not collapse when reviewer keeps both original and accepted text', () => {
        const baselinePreviewText = 'Sword Fish DippDip, homemade pickled chili';
        const baselineText = 'Sword Fish Dip, homemade pickled chili';
        const revisedText = 'Sword Fish DippDip, homemade pickled chili';
        const annotationMap = {};
        const deletedStart = baselinePreviewText.indexOf('Dipp');
        const insertedStart = baselinePreviewText.indexOf('Dip', deletedStart + 4);

        for (let i = deletedStart; i < deletedStart + 4; i++) {
            annotationMap[i] = 'del';
        }
        for (let i = insertedStart; i < insertedStart + 3; i++) {
            annotationMap[i] = 'ins';
        }

        const resolved = redlinePreview.resolveExistingAnnotationRevisions(
            baselineText,
            revisedText,
            baselinePreviewText,
            annotationMap
        );
        const rendered = redlinePreview.renderPersistentPreview(resolved.basePreviewText, resolved.revisedPreviewText, {
            annotationMap: resolved.annotationMap,
            includeExistingAnnotations: true,
        });

        expect(resolved.basePreviewText).toBe(baselinePreviewText);
        expect(rendered.html).toContain('<span class="existing-del">Dipp</span><span class="existing-ins">Dip</span>');
    });

    test('keeps imported redlines when accepted inserted text is unchanged', () => {
        const baselinePreviewText = 'Jamon Iberico, shredded tomato sauce G 2425';
        const baselineText = 'Jamon Iberico, shredded tomato sauce G 25';
        const annotationMap = {};
        const deletedStart = baselinePreviewText.indexOf('24');
        const insertedStart = baselinePreviewText.indexOf('25', deletedStart + 2);

        for (let i = deletedStart; i < deletedStart + 2; i++) {
            annotationMap[i] = 'del';
        }
        for (let i = insertedStart; i < insertedStart + 2; i++) {
            annotationMap[i] = 'ins';
        }

        const resolved = redlinePreview.resolveExistingAnnotationRevisions(
            baselineText,
            baselineText,
            baselinePreviewText,
            annotationMap
        );
        const rendered = redlinePreview.renderPersistentPreview(resolved.basePreviewText, resolved.revisedPreviewText, {
            annotationMap: resolved.annotationMap,
            includeExistingAnnotations: true,
        });

        expect(resolved.basePreviewText).toBe(baselinePreviewText);
        expect(resolved.revisedPreviewText).toBe(baselinePreviewText);
        expect(rendered.html).toContain('<span class="existing-del">24</span><span class="existing-ins">25</span>');
        expect(rendered.insertions).toBe(0);
        expect(rendered.deletions).toBe(0);
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

    test('tracks deletion of an imported highlighted dish from the editable text', () => {
        const baselineText = [
            'COLD STARTERS',
            'Punta Mita, prawns C,F,S 95',
            'Queso Fundido, melted cheese D,G,V 95',
            'Tuna Tostada, avocado 100',
        ].join('\n');
        const revisedText = [
            'COLD STARTERS',
            'Punta Mita, prawns C,F,S 95',
            'Tuna Tostada, avocado 100',
        ].join('\n');
        const annotationMap = {};

        ['Punta Mita, prawns C,F,S 95', 'Queso Fundido, melted cheese D,G,V 95'].forEach((text) => {
            const start = baselineText.indexOf(text);
            expect(start).toBeGreaterThanOrEqual(0);
            for (let i = start; i < start + text.length; i++) {
                annotationMap[i] = 'ins';
            }
        });

        const rendered = redlinePreview.renderPersistentPreview(baselineText, revisedText, {
            annotationMap,
            includeExistingAnnotations: true,
        });

        expect(revisedText).not.toContain('Queso Fundido');
        expect(rendered.html).toContain('<span class="existing-ins">Punta</span>');
        expect(rendered.html).toContain('<span class="persistent-del">Queso</span>');
        expect(rendered.html).toContain('<span class="persistent-del">Fundido</span>');
        expect(rendered.deletions).toBeGreaterThan(0);
    });

    test('preserves uploaded baseline inline formatting in the persistent preview', () => {
        const baselineHtml = [
            '<p><strong>COLD STARTERS</strong></p>',
            '<p><strong>Guacamole Traditional</strong>, avocado, tomato, onion, cilantro, lime V 85</p>',
        ].join('');
        const baselineText = [
            'COLD STARTERS',
            'Guacamole Traditional, avocado, tomato, onion, cilantro, lime V 85',
        ].join('\n');
        const revisedText = [
            'COLD STARTERS',
            'Guacamole Traditional, avocado, tomato, onion, cilantro, lime V 95',
        ].join('\n');

        const unchanged = redlinePreview.renderPersistentPreview(baselineText, baselineText, {
            baselineHtml,
        });
        expect(unchanged.html).toBe([
            '<strong>COLD</strong><strong> </strong><strong>STARTERS</strong>',
            '<strong>Guacamole</strong><strong> </strong><strong>Traditional</strong>, avocado, tomato, onion, cilantro, lime V 85',
        ].join('<br>'));
        expect(unchanged.insertions).toBe(0);
        expect(unchanged.deletions).toBe(0);

        const edited = redlinePreview.renderPersistentPreview(baselineText, revisedText, {
            baselineHtml,
        });
        expect(edited.html).toContain('<strong>COLD</strong><strong> </strong><strong>STARTERS</strong>');
        expect(edited.html).toContain('<strong>Guacamole</strong><strong> </strong><strong>Traditional</strong>');
        expect(edited.html).toContain('<span class="persistent-del">85</span>');
        expect(edited.html).toContain('<span class="persistent-ins">95</span>');
    });

    test('preserves baseline formatting when DOCX text contains non-breaking spaces', () => {
        const baselineHtml = '<p><strong>Raspberry Sorbet</strong>, strawberry sauce V 16</p>';
        const baselineText = 'Raspberry Sorbet, strawberry\u00A0sauce V 16';

        const rendered = redlinePreview.renderPersistentPreview(baselineText, baselineText, {
            baselineHtml,
        });

        expect(rendered.html).toContain('<strong>Raspberry</strong><strong> </strong><strong>Sorbet</strong>');
        expect(rendered.html).toContain('strawberry sauce V 16');
        expect(rendered.insertions).toBe(0);
        expect(rendered.deletions).toBe(0);
    });

    test('preserves body formatting when baseline text includes stripped footer copy', () => {
        const baselineHtml = [
            '<p><strong>COLD STARTERS</strong></p>',
            '<p><strong>Guacamole Traditional, </strong>avocado, tomato, onion, cilantro, lime V 85</p>',
        ].join('');
        const baselineText = [
            'COLD STARTERS',
            'Guacamole Traditional, avocado, tomato, onion, cilantro, lime V 85',
            'ALL PRICES ARE IN AED, INCLUSIVE OF FEES.',
        ].join('\n');
        const revisedText = baselineText.replace(
            'Guacamole Traditional,',
            'Guacamole Traditional, roasted tomato,'
        );

        const rendered = redlinePreview.renderPersistentPreview(baselineText, revisedText, {
            baselineHtml,
        });

        expect(rendered.html).toContain('<strong>COLD</strong><strong> </strong><strong>STARTERS</strong>');
        expect(rendered.html).toContain('<strong>Guacamole</strong><strong> </strong><strong>Traditional</strong>');
        expect(rendered.html).toContain('<span class="persistent-ins">roasted</span>');
        expect(rendered.html).toContain('ALL PRICES ARE IN AED');
    });

    test('preserves unapproved formatting when browser text offsets differ from extracted HTML', () => {
        const baselineHtml = [
            '<p><br></p>',
            '<p><strong>COLD STARTERS</strong></p>',
            '<p><strong>Guacamole Traditional, </strong>avocado, tomato, onion, cilantro, lime V 85</p>',
            '<p><span class="existing-ins"><strong>Watermelon,</strong></span><span class="existing-ins"> Jocoque</span></p>',
        ].join('');
        const baselineText = [
            '',
            '',
            'COLD STARTERS',
            'Guacamole Traditional, avocado, tomato, onion, cilantro, lime V 85',
            'Watermelon, Jocoque',
        ].join('\n');
        const revisedText = baselineText.replace('Jocoque', 'Jocoque, pine nut');
        const annotationMap = {};
        const insertedStart = baselineText.indexOf('Watermelon');
        for (let i = insertedStart; i < baselineText.length; i++) {
            annotationMap[i] = 'ins';
        }

        const rendered = redlinePreview.renderPersistentPreview(baselineText, revisedText, {
            baselineHtml,
            annotationMap,
            includeExistingAnnotations: true,
        });

        expect(rendered.html).toContain('<strong>COLD</strong><strong> </strong><strong>STARTERS</strong>');
        expect(rendered.html).toContain('<strong>Guacamole</strong><strong> </strong><strong>Traditional</strong>');
        expect(rendered.html).toContain('<span class="existing-ins"><strong>Watermelon</strong></span>');
        expect(rendered.html).not.toContain('<span class="existing-ins"><span class="existing-ins">');
        expect(rendered.html).toContain('<span class="persistent-ins">pine</span>');
    });
});

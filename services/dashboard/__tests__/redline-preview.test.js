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

    test('builds synthetic original and current text from uploaded redline HTML', () => {
        const baselineHtml = [
            '<p><strong>Alambre <span class="existing-ins">Skewers</span>,</strong> steak D 30</p>',
            '<p><strong>Carne Asada,</strong> grilled <span class="existing-del"><strong>skirt</strong></span><span class="existing-ins"><strong>flank</strong></span> steak D 19</p>',
        ].join('');

        const comparison = redlinePreview.buildRevisionComparisonFromAnnotatedHtml(baselineHtml);
        const rendered = redlinePreview.renderPersistentPreview(comparison.originalText, comparison.currentText, {
            baselineHtml: comparison.originalHtml,
        });

        expect(comparison.originalText).toContain('Alambre, steak D 30');
        expect(comparison.originalText).toContain('grilled skirt steak D 19');
        expect(comparison.originalText).not.toContain('Skewers');
        expect(comparison.originalText).not.toContain('flank');
        expect(comparison.currentText).toContain('Alambre Skewers, steak D 30');
        expect(comparison.currentText).toContain('grilled flank steak D 19');
        expect(comparison.currentText).not.toContain('skirt');
        expect(comparison.editorHtml).toContain('<strong>Alambre Skewers,</strong>');
        expect(comparison.editorHtml).toContain('<strong>flank</strong>');
        expect(comparison.editorHtml).not.toContain('existing-del');
        expect(comparison.editorHtml).not.toContain('existing-ins');
        expect(comparison.originalHtml).toContain('<strong>skirt</strong>');
        expect(comparison.originalHtml).not.toContain('existing-del');
        expect(comparison.originalHtml).not.toContain('existing-ins');
        expect(rendered.html).toContain('<span class="persistent-ins">Skewers</span>');
        expect(rendered.html).toContain('<span class="persistent-del"><strong>skirt</strong></span><span class="persistent-ins">flank</span>');
    });

    test('uses the synthetic original for later AI changes without offset artifacts', () => {
        const baselineHtml = [
            '<p><em>enhance your salad - add grilled chicken G 9 / salmon* G 12 / steak 5 oz* G 12 / shrimp S 12</em></p>',
            '<p><strong>Alambre <span class="existing-ins">Skewers</span>,</strong> steak, chorizo, bacon, bell pepper, avocado, Oaxacan cheeses D 30</p>',
            '<p><strong>Carne Asada,</strong> grilled <span class="existing-del">skirt</span><span class="existing-ins">flank</span> steak, costra-style cheese D 19</p>',
        ].join('');

        const comparison = redlinePreview.buildRevisionComparisonFromAnnotatedHtml(baselineHtml);
        const aiCorrectedText = comparison.currentText.replace('shrimp S 12', 'shrimp* S 12');
        const rendered = redlinePreview.renderPersistentPreview(comparison.originalText, aiCorrectedText, {
            baselineHtml: comparison.originalHtml,
        });

        expect(rendered.html).toContain('<span class="persistent-ins">Skewers</span>');
        expect(rendered.html).toContain('<span class="persistent-del">skirt</span><span class="persistent-ins">flank</span>');
        expect(rendered.html).toContain('<em>shrimp</em><span class="persistent-ins">*</span>');
        expect(rendered.html).not.toContain('existing-del');
        expect(rendered.html).not.toContain('existing-ins');
        expect(rendered.html).not.toContain('skirtflank');
        expect(rendered.html).not.toContain('shri<span class="persistent-ins">*</span>mp');
        expect(rendered.html).not.toContain('avocadMexican');
        expect(rendered.html).not.toContain('Mexicancan');
    });

    test('keeps adjacent inserted and deleted menu rows from interleaving in the preview', () => {
        const baselineHtml = [
            '<p><strong>Mexican Chopped Salad,</strong> mixed greens, bacon, yellow corn, cherry tomato, black beans, panela cheese, caramelized almond, avocado dressing D,N <span class="existing-ins">16</span></p>',
            '<p><span class="existing-ins"><strong>Rainbow Quinoa Bowl,</strong> cherry tomato, yellow corn, beets, avocado, radishes, cilantro, red onion, cucumber, lemon vinaigrette VG 15</span></p>',
            '<p><span class="existing-del"><strong>Grilled Caesar Salad,</strong> pickled vegetables, pepitas, salsa macha hard-boiled egg, cotija cheese D,G,V14</span></p>',
            '<p><strong>Tortilla Soup,</strong> shredded chicken, panela cheese, crema fresca espuma, avocado, tortilla strips D,G 13</p>',
        ].join('');

        const comparison = redlinePreview.buildRevisionComparisonFromAnnotatedHtml(baselineHtml);
        const rendered = redlinePreview.renderPersistentPreview(comparison.originalText, comparison.currentText, {
            baselineHtml: comparison.originalHtml,
        });

        expect(rendered.html).toContain('<span class="persistent-ins">Rainbow Quinoa Bowl, cherry tomato');
        expect(rendered.html).toContain('<span class="persistent-del"><strong>Grilled Caesar Salad,</strong>');
        expect(rendered.html.indexOf('Rainbow')).toBeLessThan(rendered.html.indexOf('Grilled'));
        expect(rendered.html).not.toContain('Grilled16');
        expect(rendered.html).not.toContain('CaesarRainbow');
        expect(rendered.html).not.toContain('SaladQuinoa');
        expect(rendered.html).not.toContain('vegetablescorn');
        expect(rendered.html).not.toContain('cheesered');
    });

    test('renders unrelated same-position menu rows as row-level insert/delete without token interleaving', () => {
        const originalText = [
            'Mexican Chopped Salad, mixed greens, bacon, yellow corn, cherry tomato, black beans, panela cheese, caramelized almond, avocado dressing D,N',
            'Grilled Caesar Salad, pickled vegetables, pepitas, salsa macha hard-boiled egg, cotija cheese D,G,V14',
            'Tortilla Soup, shredded chicken, panela cheese, crema fresca espuma, avocado, tortilla strips D,G 13',
        ].join('\n');
        const currentText = [
            'Mexican Chopped Salad, mixed greens, bacon, yellow corn, cherry tomato, black beans, panela cheese, caramelized almond, avocado dressing D,N 16',
            'Rainbow Quinoa Bowl, cherry tomato, yellow corn, beets, avocado, radishes, cilantro, red onion, cucumber, lemon vinaigrette VG 15',
            'Tortilla Soup, shredded chicken, panela cheese, crema fresca espuma, avocado, tortilla strips D,G 13',
        ].join('\n');
        const originalHtml = [
            '<p><strong>Mexican Chopped Salad,</strong> mixed greens, bacon, yellow corn, cherry tomato, black beans, panela cheese, caramelized almond, avocado dressing D,N</p>',
            '<p><strong>Grilled Caesar Salad,</strong> pickled vegetables, pepitas, salsa macha hard-boiled egg, cotija cheese D,G,V14</p>',
            '<p><strong>Tortilla Soup,</strong> shredded chicken, panela cheese, crema fresca espuma, avocado, tortilla strips D,G 13</p>',
        ].join('');

        const rendered = redlinePreview.renderPersistentPreview(originalText, currentText, {
            baselineHtml: originalHtml,
        });

        expect(rendered.html).toContain('<span class="persistent-ins">16</span>');
        expect(rendered.html).toContain('<span class="persistent-ins">Rainbow Quinoa Bowl, cherry tomato');
        expect(rendered.html).toContain('<br><span class="persistent-del"><strong>Grilled Caesar Salad,</strong>');
        expect(rendered.html.indexOf('Rainbow Quinoa Bowl')).toBeLessThan(rendered.html.indexOf('Grilled'));
        expect(rendered.html).not.toContain('Grilled16');
        expect(rendered.html).not.toContain('CaesarRainbow');
        expect(rendered.html).not.toContain('SaladQuinoa');
        expect(rendered.html).not.toContain('vegetablescorn');
        expect(rendered.html).not.toContain('pepitas,yellow');
        expect(rendered.html).not.toContain('salsacorn');
        expect(rendered.html).not.toContain('cheesered');
    });

    test('keeps similar menu-row edits as token-level redlines', () => {
        const originalText = 'Carne Asada, grilled skirt steak, costra-style cheese D 19';
        const currentText = 'Carne Asada, grilled flank steak, costra-style cheese D 19';
        const originalHtml = '<p><strong>Carne Asada,</strong> grilled <strong>skirt</strong> steak, costra-style cheese D 19</p>';

        const rendered = redlinePreview.renderPersistentPreview(originalText, currentText, {
            baselineHtml: originalHtml,
        });

        expect(rendered.html).toContain('Carne');
        expect(rendered.html).toContain('<span class="persistent-del"><strong>skirt</strong></span>');
        expect(rendered.html).toContain('<span class="persistent-ins">flank</span>');
        expect(rendered.html).not.toContain('<span class="persistent-ins">Carne Asada, grilled flank steak');
        expect(rendered.html).not.toContain('<span class="persistent-del"><strong>Carne</strong>');
        expect(rendered.html).not.toContain('skirtflank');
    });

    test('keeps the final character of deleted menu rows and tokens', () => {
        const originalText = [
            'Chicken Tinga Enchiladas, tomatillo salsa, Chihuahua cheese, black bean purée, crema fresca D 27',
            '',
            'Coliflor Rostizada, peanut chili sauce, creamy poblano sae, chichurri, roasted pepitas D,N,V 23',
            'Roasted Mushrooms al Ajillo D,VG 9',
            'Fajitas',
        ].join('\n');
        const currentText = [
            'Chicken Tinga Enchiladas, tomatillo salsa, Chihuahua cheese, black bean purée, crema fresca D 27',
            'Grilled Tlayuda, vegan chorizo, black bean purée, avocado, cherry tomato, Oaxacan cheese, pickled veggies, crema fresca D,V 25',
            '',
            '',
            'Fajitas',
        ].join('\n');
        const originalHtml = [
            '<p><strong>Chicken Tinga Enchiladas,</strong> tomatillo salsa, Chihuahua cheese, black bean purée, crema fresca D 27</p>',
            '<p><span class="existing-del"><strong>Coliflor Rostizada,</strong> peanut chili sauce, creamy poblano sae, chichurri, roasted pepitas D,N,V 23</span></p>',
            '<p><span class="existing-del"><strong>Roasted Mushrooms al Ajillo</strong> D,VG 9</span></p>',
            '<p><strong>Fajitas</strong></p>',
        ].join('');

        const rendered = redlinePreview.renderPersistentPreview(originalText, currentText, {
            baselineHtml: originalHtml,
        });
        const renderedText = redlinePreview.previewHtmlToPlainText(rendered.html);

        expect(renderedText).toContain('roasted pepitas D,N,V 23');
        expect(renderedText).toContain('D,VG 9');
        expect(renderedText).toContain('D,N,V 23\nRoasted Mushrooms');
        expect(renderedText).toContain('D,VG 9\nFajitas');
        expect(rendered.html).not.toContain('roasted pepitas D,N,V 2</span>');
        expect(rendered.html).not.toContain('D,VG </span>');
        expect(renderedText).not.toContain('23Fajitas');
    });

    test('preserves preview line breaks when serializing preview HTML to text', () => {
        const previewHtml = [
            '<span class="persistent-del"><strong>Coliflor Rostizada,</strong> roasted pepitas D,N,V 23</span>',
            '<strong>Fajitas</strong>',
            '<span class="persistent-ins">Skirt Steak* G 29</span>',
        ].join('<br>');

        const unsafeText = previewHtml.replace(/<[^>]+>/g, '');
        const safeText = redlinePreview.previewHtmlToPlainText(previewHtml);

        expect(unsafeText).toContain('23Fajitas');
        expect(safeText).toContain('D,N,V 23\nFajitas');
        expect(safeText).toContain('Fajitas\nSkirt Steak* G 29');
        expect(safeText).not.toContain('23Fajitas');
    });

    test('computes full AI-highlight ranges after rich editor text normalization', () => {
        const originalText = [
            'Alambre Skewers, steak, chorizo, bacon, bell pepper, avocado can cheeses, tomatillo chili morita sauce * D 30',
            'Chicken Tinga Enchiladas, tomatillo salsa, Chihuahuahua cheese, black bean purée, crema fresca D 27',
            'Grilled Tlayuda, vegan chorizo, black bean purée, avocado, cherry tomato, Oaxacancan cheese, pickled veggies, crema fresca D,V 25',
        ].join('\n');
        const quillNormalizedCorrectedText = [
            'Alambre Skewers, steak, chorizo, bacon, bell pepper, avocado, Mexican cheeses, tomatillo chili morita sauce * D 30',
            'Chicken Tinga Enchiladas, tomatillo salsa, Chihuahua cheese, black bean purée, crema fresca D 27',
            'Grilled Tlayuda, vegan chorizo, black bean purée, avocado, cherry tomato, Oaxacan cheese, pickled veggies, crema fresca D,V 25',
        ].join('\n');

        const ranges = redlinePreview.computeInsertedTokenRanges(originalText, quillNormalizedCorrectedText);
        const highlightedWords = ranges.map((range) => range.word);

        expect(highlightedWords).toContain('Mexican');
        expect(highlightedWords).toContain('Chihuahua');
        expect(highlightedWords).toContain('Oaxacan');
        expect(highlightedWords).not.toContain('Mexica');
        expect(highlightedWords).not.toContain('Chihuahu');
        expect(highlightedWords).not.toContain('Oaxaca');
        expect(quillNormalizedCorrectedText.slice(ranges.find((range) => range.word === 'Oaxacan').start, ranges.find((range) => range.word === 'Oaxacan').start + ranges.find((range) => range.word === 'Oaxacan').length)).toBe('Oaxacan');
    });

    test('aligns matching rows when the current menu has an extra inserted row', () => {
        const originalText = [
            'Mexican Chopped Salad, mixed greens, panela cheese D,N 16',
            'Tortilla Soup, shredded chicken, crema fresca espuma D,G 13',
        ].join('\n');
        const currentText = [
            'Mexican Chopped Salad, mixed greens, panela cheese D,N 16',
            'Rainbow Quinoa Bowl, cherry tomato, cucumber, lemon vinaigrette VG 15',
            'Tortilla Soup, shredded chicken, crema fresca espuma D,G 13',
        ].join('\n');
        const originalHtml = [
            '<p><strong>Mexican Chopped Salad,</strong> mixed greens, panela cheese D,N 16</p>',
            '<p><strong>Tortilla Soup,</strong> shredded chicken, crema fresca espuma D,G 13</p>',
        ].join('');

        const rendered = redlinePreview.renderPersistentPreview(originalText, currentText, {
            baselineHtml: originalHtml,
        });

        expect(rendered.html).toContain('<span class="persistent-ins">Rainbow Quinoa Bowl, cherry tomato');
        expect(rendered.html).toContain('<br><strong>Tortilla</strong>');
        expect(rendered.html).not.toContain('SaladRainbow');
        expect(rendered.html).not.toContain('15Tortilla');
        expect(rendered.html).not.toContain('persistent-del');
    });

    test('uses line matching even when AI output has the same line count but shifted rows', () => {
        const originalText = [
            'Tacos',
            'Pescado, adobo, napa cabbage slaw, chipotle aioli, avocado G 18',
            'Carne Asada, grilled skirt steak, costra-style cheese, red onion, cilantro, scallion * D 19',
            'Adobo Chicken, radish, red onion, cilantro, tomatillo salsa verde G 17',
            'Crispy Tofu, artisan cilantro-poblano tortilla, shiitake vinaigrette, romaine lettuce, pasilla chili sauce G,V 16',
            'Especialidades',
        ].join('\n');
        const aiReviewedText = [
            '',
            'Tacos',
            'Pescado, adobo, napa cabbage slaw, chipotle aioli, avocado G 18',
            'Carne Asada, grilled flank steak, costra-style cheese, red onion, cilantro, scallion * D 19',
            'Adobo Chicken, radish, red onion, cilantro, tomatillo salsa verde G 17',
            'Crispy Tofu, artisan cilantro-poblano tortilla, shiitake vinaigrette, romaine lettuce, pasilla chili sauce G,V 16',
        ].join('\n');
        const originalHtml = [
            '<p><strong>Tacos</strong></p>',
            '<p><strong>Pescado,</strong> adobo, napa cabbage slaw, chipotle aioli, avocado G 18</p>',
            '<p><strong>Carne Asada,</strong> grilled <strong>skirt</strong> steak, costra-style cheese, red onion, cilantro, scallion * D 19</p>',
            '<p><strong>Adobo Chicken,</strong> radish, red onion, cilantro, tomatillo salsa verde G 17</p>',
            '<p><strong>Crispy Tofu,</strong> artisan cilantro-poblano tortilla, shiitake vinaigrette, romaine lettuce, pasilla chili sauce G,V 16</p>',
            '<p><strong>Especialidades</strong></p>',
        ].join('');

        const rendered = redlinePreview.renderPersistentPreview(originalText, aiReviewedText, {
            baselineHtml: originalHtml,
        });
        const renderedText = redlinePreview.previewHtmlToPlainText(rendered.html);

        expect(renderedText).toContain('Tacos\nPescado');
        expect(rendered.html).toContain('<span class="persistent-del"><strong>skirt</strong></span><span class="persistent-ins">flank</span>');
        expect(rendered.html).not.toContain('<span class="persistent-del"><strong>Tacos</strong></span>');
        expect(rendered.html).not.toContain('<span class="persistent-ins">Tacos</span>');
        expect(rendered.html).not.toContain('<span class="persistent-del"><strong>Pescado');
        expect(rendered.html).not.toContain('<span class="persistent-ins">Pescado, adobo');
        expect(rendered.html).not.toContain('PescadoPescado');
        expect(rendered.html).not.toContain('TacosTacos');
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

    test('keeps inline deletions anchored inside a fully inserted row after a nearby edit', () => {
        const baselineHtml = [
            '<p><strong>Menu</strong></p>',
            '<p><strong>Snacks &amp; Shares</strong></p>',
            '<p><strong>Pimento Dip,</strong> <span class="existing-del">Cheese</span><span class="existing-ins">cheese</span>, crudité, pickled veggies, crackers D,G,V 16</p>',
            '<p><span class="existing-ins"><strong>Shrimp Cocktail,</strong> horseradish &amp; Harrison </span><span class="existing-del">Brother’s</span><span class="existing-ins">Brothers’ cocktail sauce, marinated green olives 22</span></p>',
            '<p><strong>Sorghum -Glazed Pork Belly,</strong> spicy sorghum glaze, little gem lettuce, chive 22</p>',
        ].join('');
        const baselinePreviewText = [
            'Menu',
            'Snacks & Shares',
            'Pimento Dip, Cheesecheese, crudité, pickled veggies, crackers D,G,V 16',
            'Shrimp Cocktail, horseradish & Harrison Brother’sBrothers’ cocktail sauce, marinated green olives 22',
            'Sorghum -Glazed Pork Belly, spicy sorghum glaze, little gem lettuce, chive 22',
        ].join('\n');
        const baselineText = [
            'Menu',
            'Snacks & Shares',
            'Pimento Dip, cheese, crudité, pickled veggies, crackers D,G,V 16',
            'Shrimp Cocktail, horseradish & Harrison Brothers’ cocktail sauce, marinated green olives 22',
            'Sorghum -Glazed Pork Belly, spicy sorghum glaze, little gem lettuce, chive 22',
        ].join('\n');
        const revisedText = baselineText.replace('pickled veggies', 'pickled vegetables');
        const annotationMap = {};

        function markRange(start, end, type) {
            expect(start).toBeGreaterThanOrEqual(0);
            expect(end).toBeGreaterThan(start);
            for (let i = start; i < end; i++) {
                annotationMap[i] = type;
            }
        }

        function mark(text, type) {
            const start = baselinePreviewText.indexOf(text);
            markRange(start, start + text.length, type);
        }

        mark('Cheese', 'del');
        mark('cheese', 'ins');
        const shrimpStart = baselinePreviewText.indexOf('Shrimp Cocktail');
        const deletedBrotherStart = baselinePreviewText.indexOf('Brother’s');
        const insertedBrothersStart = baselinePreviewText.indexOf('Brothers’');
        const shrimpLineEnd = baselinePreviewText.indexOf('\nSorghum');
        markRange(shrimpStart, deletedBrotherStart, 'ins');
        markRange(deletedBrotherStart, deletedBrotherStart + 'Brother’s'.length, 'del');
        markRange(insertedBrothersStart, shrimpLineEnd, 'ins');

        const resolved = redlinePreview.resolveExistingAnnotationRevisions(
            baselineText,
            revisedText,
            baselinePreviewText,
            annotationMap,
            { baselineHtml }
        );
        const rendered = redlinePreview.renderPersistentPreview(resolved.basePreviewText, resolved.revisedPreviewText, {
            annotationMap: resolved.annotationMap,
            includeExistingAnnotations: true,
            baselineHtml: resolved.baselineHtml,
        });
        const renderedText = redlinePreview.previewHtmlToPlainText(rendered.html);

        expect(resolved.revisedPreviewText).toContain(
            'Shrimp Cocktail, horseradish & Harrison Brother’sBrothers’ cocktail sauce, marinated green olives 22'
        );
        expect(renderedText).toContain(
            'Shrimp Cocktail, horseradish & Harrison Brother’sBrothers’ cocktail sauce, marinated green olives 22'
        );
        expect(rendered.html).toContain('<span class="existing-del">Brother’s</span>');
        expect(renderedText).not.toContain('ShrimpBrother’sShrimp');
        expect(renderedText).not.toContain('Brother’sBrothersBrothers’');
        expect(resolved.revisedPreviewText).not.toContain('Brother’sShrimp Cocktail');
    });

    test('keeps whole imported deleted rows separate after a later word edit', () => {
        const baselinePreviewText = [
            'Ahi Tuna Tiradito, almond leche de tigre, katsubushi, snow beans, lemon oil, cucumber pickles* N',
            'Nikkei Tuna Tiradito, sesame oil, chili chalquita, ponzu, cucumber and daikon G 26',
            'Peruvian Ceviche, snapper, leche de tigre, sweet potato, red onion, canchas* 25',
            'Snapper Tiradito, yuzu-goma sauce, green apple, caviar, torched avocado, gochujang aioli* G',
            'Bison Tiradito, togarashi, spiced pepitas, shimeji pickled, chipotle ponzu sauce, greens * 24',
            'Acevichado Nikkei Roll, fish tiradito, leche de tigre, togarashi aioli, shrimp tempura, kabayaki* S,G 26',
        ].join('\n');
        const baselineText = [
            'Ahi Tuna Tiradito, almond leche de tigre, katsubushi, snow beans, lemon oil, cucumber pickles* N',
            '',
            'Snapper Tiradito, yuzu-goma sauce, green apple, caviar, torched avocado, gochujang aioli* G',
            '',
            'Acevichado Nikkei Roll, fish tiradito, leche de tigre, togarashi aioli, shrimp tempura, kabayaki* S,G 26',
        ].join('\n');
        const revisedText = baselineText.replace(', cucumber', '');
        const annotationMap = {};

        function markDeletedRow(rowText) {
            const start = baselinePreviewText.indexOf(rowText);
            expect(start).toBeGreaterThanOrEqual(0);
            for (let i = start; i < start + rowText.length; i++) {
                annotationMap[i] = 'del';
            }
        }

        markDeletedRow('Nikkei Tuna Tiradito, sesame oil, chili chalquita, ponzu, cucumber and daikon G 26');
        markDeletedRow('Peruvian Ceviche, snapper, leche de tigre, sweet potato, red onion, canchas* 25');
        markDeletedRow('Bison Tiradito, togarashi, spiced pepitas, shimeji pickled, chipotle ponzu sauce, greens * 24');

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
        const renderedText = redlinePreview.previewHtmlToPlainText(rendered.html);

        expect(resolved.revisedPreviewText).toContain('canchas* 25\nSnapper Tiradito');
        expect(resolved.revisedPreviewText).toContain('greens * 24\nAcevichado Nikkei Roll');
        expect(resolved.revisedPreviewText).not.toContain('25Snapper');
        expect(resolved.revisedPreviewText).not.toContain('24Acevichado');
        expect(renderedText).not.toContain('25Snapper');
        expect(renderedText).not.toContain('24Acevichado');
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
        expect(rendered.html).toContain('<span class="persistent-del">Queso Fundido, melted cheese D,G,V 95</span>');
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

    test('reflects live editor bolding on unchanged approval preview text', () => {
        const baselineText = 'Pimento Dip, cheese, crudité, pickled veggies, crackers D,G,V 16';
        const baselineHtml = '<p>Pimento Dip, cheese, crudité, pickled veggies, crackers D,G,V 16</p>';
        const revisedHtml = '<p>Pimento Dip, <strong>cheese</strong>, crudité, pickled veggies, crackers D,G,V 16</p>';

        const rendered = redlinePreview.renderPersistentPreview(baselineText, baselineText, {
            baselineHtml,
            revisedHtml,
        });

        expect(rendered.html).toContain('<strong>cheese</strong>');
        expect(rendered.html).not.toContain('persistent-ins');
        expect(rendered.html).not.toContain('persistent-del');
        expect(rendered.insertions).toBe(0);
        expect(rendered.deletions).toBe(0);
    });

    test('reflects live editor bolding on inserted approval preview text', () => {
        const baselineText = 'Pimento Dip, cheese, crudité, pickled veggies, crackers D,G,V 16';
        const revisedText = 'Pimento Dip, cheese, crudité, pickled vegetables, crackers D,G,V 16';
        const baselineHtml = '<p>Pimento Dip, cheese, crudité, pickled veggies, crackers D,G,V 16</p>';
        const revisedHtml = '<p>Pimento Dip, cheese, crudité, pickled <strong>vegetables</strong>, crackers D,G,V 16</p>';

        const rendered = redlinePreview.renderPersistentPreview(baselineText, revisedText, {
            baselineHtml,
            revisedHtml,
        });

        expect(rendered.html).toContain('<span class="persistent-ins"><strong>vegetables</strong></span>');
        expect(rendered.html).toContain('<span class="persistent-del">veggies</span>');
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

import {
    extractBoldFormattingSignals,
    htmlToRichTextLines,
} from '../lib/formatting-signals';

describe('formatting signals', () => {
    test('extracts leading bold prefixes from cleaned DOCX HTML', () => {
        const lines = htmlToRichTextLines('<p><strong>Guacamole</strong> avocado &amp; lime</p>');

        expect(lines).toEqual([
            {
                text: 'Guacamole avocado & lime',
                leadingBoldText: 'Guacamole',
                boldRanges: [{ start: 0, end: 9, text: 'Guacamole' }],
            },
        ]);
    });

    test('flags when final approval restores bolding the submitter already had', () => {
        const signals = extractBoldFormattingSignals({
            originalHtml: '<p><strong>Guacamole</strong> avocado, lime</p>',
            aiDraftHtml: '<p>Guacamole avocado, lime</p>',
            finalHtml: '<p><strong>Guacamole</strong> avocado, lime</p>',
        });

        expect(signals).toEqual([
            expect.objectContaining({
                change_type: 'bold_added',
                line_text: 'Guacamole avocado, lime',
                ai_bold_prefix: '',
                final_bold_prefix: 'Guacamole',
                original_bold_prefix: 'Guacamole',
                submitter_had_final_bold: true,
                ai_changed_submitter_bold: true,
            }),
        ]);
    });

    test('flags when AI bolded too much and final approval returns to submitter bolding', () => {
        const signals = extractBoldFormattingSignals({
            originalHtml: '<p><strong>Punta Mita</strong>, prawns, tomato</p>',
            aiDraftHtml: '<p><strong>Punta Mita, prawns</strong>, tomato</p>',
            finalHtml: '<p><strong>Punta Mita</strong>, prawns, tomato</p>',
        });

        expect(signals).toEqual([
            expect.objectContaining({
                change_type: 'bold_changed',
                ai_bold_prefix: 'Punta Mita, prawns',
                final_bold_prefix: 'Punta Mita',
                original_bold_prefix: 'Punta Mita',
                submitter_had_final_bold: true,
                ai_changed_submitter_bold: true,
            }),
        ]);
    });

    test('skips duplicate line text to avoid ambiguous formatting evidence', () => {
        const signals = extractBoldFormattingSignals({
            originalHtml: [
                '<p><strong>Guacamole</strong> avocado</p>',
                '<p><strong>Guacamole</strong> avocado</p>',
            ].join(''),
            aiDraftHtml: [
                '<p>Guacamole avocado</p>',
                '<p>Guacamole avocado</p>',
            ].join(''),
            finalHtml: [
                '<p><strong>Guacamole</strong> avocado</p>',
                '<p><strong>Guacamole</strong> avocado</p>',
            ].join(''),
        });

        expect(signals).toEqual([]);
    });
});

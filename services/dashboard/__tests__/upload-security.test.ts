import { buildMenuFilename, sanitizeStoredFileName } from '../lib/upload-security';

describe('buildMenuFilename', () => {
    test('names generated menus as restaurant, service period, and date', () => {
        expect(buildMenuFilename(
            'Seasonal Breakfast Update',
            'Aqimero - Ritz-Carlton - Philadelphia',
            'Breakfast',
            '2023-11-06'
        )).toBe('Aqimero_Breakfast_11.6.23.docx');
    });

    test('normalizes service period underscores and unsafe filename characters', () => {
        expect(buildMenuFilename(
            'Spring Menu',
            'Toro/Toro - Four Seasons - Doha',
            'late_night',
            '2026-05-11'
        )).toBe('Toro Toro_Late Night_5.11.26.docx');
    });

    test('preserves Unicode tone marks and accents in generated menu filenames', () => {
        expect(buildMenuFilename(
            'Dinner Update',
            'Tān - Midtown - New York',
            'dinner',
            '2026-05-14'
        )).toBe('Tān_Dinner_5.14.26.docx');
    });

    test('keeps the legacy format when service period and date are not supplied', () => {
        expect(buildMenuFilename('Spring Menu', 'Aqimero')).toBe('Aqimero - Spring Menu.docx');
    });
});

describe('sanitizeStoredFileName', () => {
    test('preserves Unicode letters while removing reserved filename characters', () => {
        expect(sanitizeStoredFileName('Tān/Dinner:5.14.26.docx')).toBe('Dinner_5.14.26.docx');
        expect(sanitizeStoredFileName('Tān_Dinner_5.14.26.docx')).toBe('Tān_Dinner_5.14.26.docx');
    });
});

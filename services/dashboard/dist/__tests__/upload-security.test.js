"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const upload_security_1 = require("../lib/upload-security");
describe('buildMenuFilename', () => {
    test('names generated menus as restaurant, service period, and date', () => {
        expect((0, upload_security_1.buildMenuFilename)('Seasonal Breakfast Update', 'Aqimero - Ritz-Carlton - Philadelphia', 'Breakfast', '2023-11-06')).toBe('Aqimero_Breakfast_11.6.23.docx');
    });
    test('normalizes service period underscores and unsafe filename characters', () => {
        expect((0, upload_security_1.buildMenuFilename)('Spring Menu', 'Toro/Toro - Four Seasons - Doha', 'late_night', '2026-05-11')).toBe('Toro Toro_Late Night_5.11.26.docx');
    });
    test('preserves Unicode tone marks and accents in generated menu filenames', () => {
        expect((0, upload_security_1.buildMenuFilename)('Dinner Update', 'Tān - Midtown - New York', 'dinner', '2026-05-14')).toBe('Tān_Dinner_5.14.26.docx');
    });
    test('keeps the legacy format when service period and date are not supplied', () => {
        expect((0, upload_security_1.buildMenuFilename)('Spring Menu', 'Aqimero')).toBe('Aqimero - Spring Menu.docx');
    });
});
describe('sanitizeStoredFileName', () => {
    test('preserves Unicode letters while removing reserved filename characters', () => {
        expect((0, upload_security_1.sanitizeStoredFileName)('Tān/Dinner:5.14.26.docx')).toBe('Dinner_5.14.26.docx');
        expect((0, upload_security_1.sanitizeStoredFileName)('Tān_Dinner_5.14.26.docx')).toBe('Tān_Dinner_5.14.26.docx');
    });
});

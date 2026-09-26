"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const raw_marker_integrity_guard_1 = require("../lib/raw-marker-integrity-guard");
describe('guardCorrectedMenuRawMarkers', () => {
    test('restores a submitted asterisk the corrected line dropped (tan dinner 2026-09-21)', () => {
        const original = 'Seabass & Shrimp Ceviche, cucumber, red onion, macha-aguachile, cilantro, avocado* S 23';
        const result = (0, raw_marker_integrity_guard_1.guardCorrectedMenuRawMarkers)(original, 'Seabass & Shrimp Ceviche, cucumber, red onion, macha-aguachile, cilantro, avocado S 23');
        expect(result.correctedMenu).toBe(original);
        expect(result.changes).toHaveLength(1);
    });
    test('keeps the submitted placement when only the marker moved', () => {
        const result = (0, raw_marker_integrity_guard_1.guardCorrectedMenuRawMarkers)('Seabass & Shrimp Ceviche, cilantro, avocado* S 23', 'Seabass & Shrimp Ceviche*, cilantro, avocado S 23');
        expect(result.correctedMenu).toBe('Seabass & Shrimp Ceviche, cilantro, avocado* S 23');
    });
    test('keeps a corrected line that also changed text and still has its marker', () => {
        const result = (0, raw_marker_integrity_guard_1.guardCorrectedMenuRawMarkers)('Ceviche Amarillo*, tuna, mango 22', 'Ceviche Amarillo, tuna, mango, orange* 22');
        expect(result.correctedMenu).toBe('Ceviche Amarillo, tuna, mango, orange* 22');
        expect(result.changes).toEqual([]);
    });
    test('allows the model to add a marker', () => {
        const result = (0, raw_marker_integrity_guard_1.guardCorrectedMenuRawMarkers)('Tuna Tartare, soy 19', 'Tuna Tartare, soy* 19');
        expect(result.correctedMenu).toBe('Tuna Tartare, soy* 19');
    });
    test('ignores the foodborne-illness footer line', () => {
        const footer = '*Consuming raw or undercooked meats, poultry, seafood or eggs may increase your risk of foodborne illness';
        const result = (0, raw_marker_integrity_guard_1.guardCorrectedMenuRawMarkers)(footer, footer.slice(1));
        expect(result.changes).toEqual([]);
    });
    test('fails closed to the submitted menu when rows are misaligned and a marker was lost', () => {
        const original = 'Crudo, citrus* 18\nSoup D 12';
        const result = (0, raw_marker_integrity_guard_1.guardCorrectedMenuRawMarkers)(original, 'Crudo, citrus 18');
        expect(result.correctedMenu).toBe(original);
        expect(result.usedFullMenuFallback).toBe(true);
    });
    test('inserts before allergen codes and price', () => {
        expect((0, raw_marker_integrity_guard_1.insertRawMarker)('Oysters, mignonette S 24')).toBe('Oysters, mignonette* S 24');
        expect((0, raw_marker_integrity_guard_1.insertRawMarker)('Crudo, citrus 18')).toBe('Crudo, citrus* 18');
        expect((0, raw_marker_integrity_guard_1.insertRawMarker)('Crudo, citrus')).toBe('Crudo, citrus*');
        expect((0, raw_marker_integrity_guard_1.insertRawMarker)('Crudo, citrus D,G,S MKT')).toBe('Crudo, citrus* D,G,S MKT');
    });
});

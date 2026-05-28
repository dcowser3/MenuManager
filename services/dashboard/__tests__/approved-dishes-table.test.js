const {
    compareDishRows,
    normalizeCellText,
    rowMatchesFilters,
} = require('../public/js/approved-dishes');

function makeRow(values) {
    return {
        cells: values.map((value) => ({
            textContent: value,
        })),
    };
}

describe('approved dish table controls', () => {
    test('normalizes rendered cell whitespace', () => {
        expect(normalizeCellText('  Brunch\n Beverage  ')).toBe('Brunch Beverage');
    });

    test('matches rows by one or more column filters', () => {
        const row = makeRow([
            'Clean',
            'Aperol Spritz',
            'aperol, campari, prosecco',
            'Cocktails',
            'Brunch Beverage',
            'Tamayo Brunch Menu ClickUp task-1',
            '20',
            'None',
        ]);

        expect(rowMatchesFilters(row, [
            { column: 1, value: 'spritz' },
            { column: 5, value: 'tamayo brunch' },
        ])).toBe(true);
        expect(rowMatchesFilters(row, [
            { column: 3, value: 'dessert' },
        ])).toBe(false);
    });

    test('sorts rows using natural text and numeric ordering', () => {
        const rowA = makeRow(['Dish 2']);
        const rowB = makeRow(['Dish 10']);

        expect(compareDishRows(rowA, rowB, 0, 'asc')).toBeLessThan(0);
        expect(compareDishRows(rowA, rowB, 0, 'desc')).toBeGreaterThan(0);
    });
});

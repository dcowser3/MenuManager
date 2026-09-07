const {
    compareDishRows,
    initApprovedDishesTableControls,
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

function makeTable(values) {
    const rows = values.map(makeRow);
    const count = { textContent: '' };
    const controls = (column) => ({
        dataset: { column: String(column) },
        value: '',
        textContent: '',
        addEventListener(event, handler) { this[event] = handler; },
    });
    const filters = [0, 1, 2].map(controls);
    const buttons = [0, 1, 2].map(controls);
    const indicators = [0, 1, 2].map(controls);
    const tbody = {
        querySelectorAll: () => rows.slice(),
        appendChild: jest.fn((row) => {
            rows.splice(rows.indexOf(row), 1);
            rows.push(row);
        }),
    };
    const table = {
        dataset: {},
        closest: () => ({ querySelector: () => count }),
        querySelectorAll(selector) {
            if (selector === '.dish-column-filter') return filters;
            if (selector === '.dish-sort') return buttons;
            if (selector === '.dish-sort-indicator') return indicators;
            throw new Error(`Unexpected selector: ${selector}`);
        },
        querySelector(selector) {
            if (selector === 'tbody') return tbody;
            const column = selector.match(/data-column="(\d+)"/);
            return column ? indicators[Number(column[1])] : null;
        },
    };
    const doc = { querySelectorAll: () => [table] };
    return { doc, rows, tbody, filters, buttons, indicators, count };
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

    test('filter input preserves row order without sorting or moving rows', () => {
        const table = makeTable([
            ['Clean', 'Dish 10', 'Dessert'],
            ['Clean', 'Dish 2', 'Starter'],
            ['Review', 'Dish 1', 'Starter'],
        ]);
        initApprovedDishesTableControls(table.doc);
        const sortedRows = table.rows.slice();
        expect(sortedRows.map((row) => row.cells[1].textContent)).toEqual(['Dish 1', 'Dish 2', 'Dish 10']);
        expect(table.count.textContent).toBe('3 dishes');
        expect(table.indicators[1].textContent).toBe('▲');
        table.tbody.appendChild.mockClear();
        // The filter below only uses category/quality; reading the dish column
        // would mean the unchanged sort order is being recomputed.
        const sortColumnReads = table.rows.map((row) => {
            const value = row.cells[1].textContent;
            const read = jest.fn(() => value);
            Object.defineProperty(row.cells[1], 'textContent', { get: read });
            return read;
        });

        table.filters[2].value = ' starter ';
        table.filters[2].input({ type: 'input' });
        expect(table.rows.map((row) => row.hidden)).toEqual([false, false, true]);
        expect(table.count.textContent).toBe('2 dishes');

        table.filters[0].value = 'clean';
        table.filters[0].input({ type: 'input' });
        expect(table.rows.map((row) => row.hidden)).toEqual([true, false, true]);
        expect(table.count.textContent).toBe('1 dish');

        table.filters[2].value = 'missing';
        table.filters[2].input({ type: 'input' });
        expect(table.count.textContent).toBe('0 dishes');
        expect(table.rows.every((row) => row.hidden)).toBe(true);

        table.filters.forEach((filter) => { filter.value = ''; });
        table.filters[2].input({ type: 'input' });
        expect(table.rows.map((row) => row.hidden)).toEqual([false, false, false]);
        expect(table.count.textContent).toBe('3 dishes');
        expect(table.rows).toEqual(sortedRows);
        expect(table.tbody.appendChild).not.toHaveBeenCalled();
        sortColumnReads.forEach((read) => expect(read).not.toHaveBeenCalled());
    });

    test('header clicks still toggle direction and apply active filters', () => {
        const table = makeTable([
            ['Clean', 'Dish 10', 'Dessert'],
            ['Review', 'Dish 2', 'Starter'],
            ['Clean', 'Dish 1', 'Starter'],
        ]);
        initApprovedDishesTableControls(table.doc);
        table.filters[2].value = 'starter';
        table.filters[2].input({ type: 'input' });
        table.buttons[1].click();
        expect(table.rows.map((row) => row.cells[1].textContent)).toEqual(['Dish 10', 'Dish 2', 'Dish 1']);
        expect(table.rows.filter((row) => !row.hidden).map((row) => row.cells[1].textContent)).toEqual(['Dish 2', 'Dish 1']);
        expect(table.count.textContent).toBe('2 dishes');
        expect(table.indicators[1].textContent).toBe('▼');

        table.buttons[1].click();
        expect(table.rows.map((row) => row.cells[1].textContent)).toEqual(['Dish 1', 'Dish 2', 'Dish 10']);
        expect(table.indicators[1].textContent).toBe('▲');

        table.buttons[0].click();
        expect(table.rows.map((row) => row.cells[0].textContent)).toEqual(['Clean', 'Clean', 'Review']);
        expect(table.indicators[0].textContent).toBe('▲');
        expect(table.indicators[1].textContent).toBe('');
    });

    test('empty tables remain usable and repeated initialization does not reorder rows', () => {
        const table = makeTable([]);
        initApprovedDishesTableControls(table.doc);
        table.filters[1].value = 'dish';
        table.filters[1].input({ type: 'input' });
        table.buttons[1].click();
        expect(table.count.textContent).toBe('0 dishes');
        expect(table.tbody.appendChild).not.toHaveBeenCalled();

        const populated = makeTable([['Clean', 'Dish 1', 'Starter']]);
        initApprovedDishesTableControls(populated.doc);
        populated.tbody.appendChild.mockClear();
        initApprovedDishesTableControls(populated.doc);
        expect(populated.tbody.appendChild).not.toHaveBeenCalled();
    });
});

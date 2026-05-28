(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.approvedDishesTable = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const collator = new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: 'base',
    });

    function normalizeCellText(value) {
        return `${value || ''}`.replace(/\s+/g, ' ').trim();
    }

    function getRowCellText(row, columnIndex) {
        if (!row || !row.cells || !row.cells[columnIndex]) return '';
        return normalizeCellText(row.cells[columnIndex].textContent);
    }

    function rowMatchesFilters(row, filters) {
        return filters.every((filter) => {
            const query = normalizeCellText(filter.value).toLowerCase();
            if (!query) return true;
            return getRowCellText(row, filter.column).toLowerCase().includes(query);
        });
    }

    function compareDishRows(a, b, column, direction) {
        const left = getRowCellText(a, column);
        const right = getRowCellText(b, column);
        const result = collator.compare(left, right);
        return direction === 'desc' ? result * -1 : result;
    }

    function updateSortIndicators(table, activeColumn, direction) {
        table.querySelectorAll('.dish-sort-indicator').forEach((indicator) => {
            indicator.textContent = '';
        });

        const active = table.querySelector(`.dish-sort[data-column="${activeColumn}"] .dish-sort-indicator`);
        if (active) {
            active.textContent = direction === 'asc' ? '▲' : '▼';
        }
    }

    function updateGroupCount(table, visibleCount) {
        const group = table.closest('.dish-group');
        const countEl = group ? group.querySelector('.dish-count') : null;
        if (!countEl) return;
        countEl.textContent = `${visibleCount} ${visibleCount === 1 ? 'dish' : 'dishes'}`;
    }

    function initApprovedDishesTableControls(doc) {
        const rootDoc = doc || (typeof document !== 'undefined' ? document : null);
        if (!rootDoc) return;

        rootDoc.querySelectorAll('.dish-table').forEach((table) => {
            if (table.dataset.controlsReady === 'true') return;
            table.dataset.controlsReady = 'true';

            const tbody = table.querySelector('tbody');
            if (!tbody) return;

            let sortColumn = 1;
            let sortDirection = 'asc';

            const applyTableState = () => {
                const filters = Array.from(table.querySelectorAll('.dish-column-filter')).map((input) => ({
                    column: Number(input.dataset.column || 0),
                    value: input.value,
                }));

                const rows = Array.from(tbody.querySelectorAll('tr'));
                rows.sort((a, b) => compareDishRows(a, b, sortColumn, sortDirection));
                rows.forEach((row) => tbody.appendChild(row));

                let visibleCount = 0;
                rows.forEach((row) => {
                    const visible = rowMatchesFilters(row, filters);
                    row.hidden = !visible;
                    if (visible) visibleCount += 1;
                });

                updateGroupCount(table, visibleCount);
                updateSortIndicators(table, sortColumn, sortDirection);
            };

            table.querySelectorAll('.dish-sort').forEach((button) => {
                button.addEventListener('click', () => {
                    const column = Number(button.dataset.column || 0);
                    if (sortColumn === column) {
                        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        sortColumn = column;
                        sortDirection = 'asc';
                    }
                    applyTableState();
                });
            });

            table.querySelectorAll('.dish-column-filter').forEach((input) => {
                input.addEventListener('input', applyTableState);
            });

            applyTableState();
        });
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', () => initApprovedDishesTableControls(document));
    }

    return {
        compareDishRows,
        getRowCellText,
        initApprovedDishesTableControls,
        normalizeCellText,
        rowMatchesFilters,
    };
});

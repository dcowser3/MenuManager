// Runs a synthetic table in an isolated browser page; starts no app or service.
// Usage: node scripts/approved-dishes-benchmark.js <baseline-git-ref>
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = 'services/dashboard/public/js/approved-dishes.js';
const baselineRef = process.argv[2] || 'HEAD';
const baseline = execFileSync('git', ['show', `${baselineRef}:${sourcePath}`], { cwd: repoRoot, encoding: 'utf8' });
const candidate = fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8');
const rowCount = 1000;
const queries = ['s', 'st', 'sta', 'star', 'start', 'starter', '', 'dessert', 'missing', ''];
const tableHtml = `<section class="dish-group"><span class="dish-count"></span><table class="dish-table">
    <thead><tr>${Array.from({ length: 8 }, (_, column) => `<th>
        <button class="dish-sort" data-column="${column}">Sort<span class="dish-sort-indicator"></span></button>
        <input class="dish-column-filter" data-column="${column}">
    </th>`).join('')}</tr></thead><tbody>${Array.from({ length: rowCount }, (_, index) => {
        const id = rowCount - index;
        return `<tr data-id="${id}">${['Clean', `Dish ${id}`, 'Avocado, tomato and lime',
            id % 2 ? 'Starter' : 'Dessert', 'Dinner', `Menu ${id % 10}`, String(id % 50), 'D G']
            .map((value) => `<td>${value}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></section>`;

async function measure(browser, source) {
    const page = await browser.newPage();
    try {
        await page.route('**/*', (route) => route.abort());
        await page.setContent(tableHtml);
        await page.evaluate(() => {
            window.operations = { comparisons: 0, rowMoves: 0 };
            const OriginalCollator = Intl.Collator;
            Intl.Collator = function (...args) {
                const collator = new OriginalCollator(...args);
                return { compare(left, right) {
                    window.operations.comparisons++;
                    return collator.compare(left, right);
                } };
            };
            const tbody = document.querySelector('tbody');
            const append = tbody.appendChild;
            tbody.appendChild = function (row) {
                window.operations.rowMoves++;
                return append.call(this, row);
            };
        });
        await page.addScriptTag({ content: source });
        return await page.evaluate((values) => {
            window.approvedDishesTable.initApprovedDishesTableControls(document);
            const tbody = document.querySelector('tbody');
            const filter = document.querySelector('.dish-column-filter[data-column="3"]');
            void tbody.offsetHeight;
            window.operations = { comparisons: 0, rowMoves: 0 };
            const states = [];
            let durationMs = 0;
            for (const value of values) {
                const started = performance.now();
                filter.value = value;
                filter.dispatchEvent(new Event('input', { bubbles: true }));
                void tbody.offsetHeight;
                durationMs += performance.now() - started;
                states.push({
                    count: document.querySelector('.dish-count').textContent,
                    rows: Array.from(tbody.rows, (row) => `${row.dataset.id}:${row.hidden}`),
                });
            }
            return { durationMs, ...window.operations, states };
        }, queries);
    } finally {
        await page.close();
    }
}

async function main() {
    const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || 'chrome', headless: true });
    try {
        const runs = { baseline: [], candidate: [] };
        for (let iteration = 0; iteration < 7; iteration++) {
            const sources = iteration % 2 ? { candidate, baseline } : { baseline, candidate };
            const measured = {};
            for (const [name, source] of Object.entries(sources)) {
                measured[name] = await measure(browser, source);
                if (iteration) runs[name].push(measured[name]);
            }
            assert.deepEqual(measured.candidate.states, measured.baseline.states, 'Filtering changed row order or visibility');
            assert.equal(measured.candidate.comparisons, 0, 'Filtering must not sort rows');
            assert.equal(measured.candidate.rowMoves, 0, 'Filtering must not move rows');
        }
        const summary = Object.fromEntries(Object.entries(runs).map(([name, samples]) => {
            const times = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
            return [name, { medianMs: Number(((times[2] + times[3]) / 2).toFixed(2)),
                comparisonsPerRun: samples[0].comparisons, rowMovesPerRun: samples[0].rowMoves }];
        }));
        console.log(JSON.stringify({ baselineRef, rowCount, filterEvents: queries.length,
            measuredRuns: runs.candidate.length, browser: browser.version(), ...summary }, null, 2));
    } finally {
        await browser.close();
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

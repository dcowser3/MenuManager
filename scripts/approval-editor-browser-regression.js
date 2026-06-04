const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const port = Number(process.env.APPROVAL_EDITOR_HARNESS_PORT || 3016);
const fixtureId = process.env.APPROVAL_EDITOR_FIXTURE_ID || 'approval-editor-venga-venga';
const url = `http://localhost:${port}/approval/${fixtureId}?debugPreview=1`;
const badPreviewStrings = [
    'make it a pitcher 65S',
    'SPICYPICY SWINGER 18',
    'MakemakemaMakeke',
    '73727273',
];

function waitForHarness() {
    const deadline = Date.now() + 10000;
    return new Promise((resolve, reject) => {
        function check() {
            const req = http.get(url, (res) => {
                res.resume();
                if (res.statusCode && res.statusCode < 500) {
                    resolve();
                    return;
                }
                retry();
            });
            req.on('error', retry);
            req.setTimeout(750, () => {
                req.destroy();
                retry();
            });
        }

        function retry() {
            if (Date.now() > deadline) {
                reject(new Error(`Timed out waiting for approval editor harness at ${url}`));
                return;
            }
            setTimeout(check, 150);
        }

        check();
    });
}

function startHarness() {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'approval-editor-harness.js')], {
        cwd: repoRoot,
        env: {
            ...process.env,
            APPROVAL_EDITOR_HARNESS_PORT: String(port),
            APPROVAL_EDITOR_FIXTURE_ID: fixtureId,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));

    return child;
}

async function launchBrowser() {
    const channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || 'chrome';
    try {
        return await chromium.launch({ channel, headless: true });
    } catch (error) {
        if (process.env.PLAYWRIGHT_CHROMIUM_CHANNEL) {
            throw error;
        }
        return chromium.launch({ headless: true });
    }
}

async function waitForPreviewIdle(page) {
    await page.waitForFunction(() => {
        const loading = document.getElementById('previewLoading');
        return !!loading && loading.hidden;
    }, null, { timeout: 9000 });
}

async function editMenuText(page, transform) {
    return page.evaluate((source) => {
        const editor = document.getElementById('approvalEditorInput');
        const cleanText = window.MenuRedlinePreview.extractCleanTextFromElement(editor).replace(/\r/g, '');
        const transformText = new Function('text', `return (${source})(text);`);
        const nextText = transformText(cleanText);
        const html = nextText
            .split('\n')
            .map((line) => line.trim()
                ? `<p>${line
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')}</p>`
                : '<p><br></p>')
            .join('');
        const startedAt = performance.now();
        editor.innerHTML = html;
        editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: null,
        }));
        return {
            dispatchMs: performance.now() - startedAt,
            text: nextText,
        };
    }, transform.toString());
}

async function assertPreviewHealthy(page, label) {
    await waitForPreviewIdle(page);
    const result = await page.evaluate((badStrings) => {
        const preview = document.getElementById('approvalPreview');
        const loading = document.getElementById('previewLoading');
        const text = preview && window.MenuRedlinePreview
            ? window.MenuRedlinePreview.previewHtmlToPlainText(preview.innerHTML || '')
            : '';
        return {
            text,
            loadingHidden: !!loading && loading.hidden,
            badMatches: badStrings.filter((value) => text.includes(value)),
        };
    }, badPreviewStrings);

    if (!result.loadingHidden) {
        throw new Error(`${label}: preview spinner remained visible`);
    }
    if (result.badMatches.length) {
        throw new Error(`${label}: preview contains corrupted strings: ${result.badMatches.join(', ')}`);
    }
    return result.text;
}

async function run() {
    const harness = startHarness();
    let browser = null;
    try {
        await waitForHarness();
        browser = await launchBrowser();
        const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
        await page.addInitScript(() => {
            window.__approvalLongTasks = [];
            if ('PerformanceObserver' in window) {
                try {
                    const observer = new PerformanceObserver((list) => {
                        for (const entry of list.getEntries()) {
                            window.__approvalLongTasks.push({
                                name: entry.name,
                                duration: entry.duration,
                                startTime: entry.startTime,
                            });
                        }
                    });
                    observer.observe({ type: 'longtask', buffered: true });
                } catch (_error) {
                    window.__approvalLongTasksUnsupported = true;
                }
            }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#approvalEditorInput', { timeout: 10000 });
        await assertPreviewHealthy(page, 'initial render');

        const deleteBlankLine = await editMenuText(page, (text) => text.replace(
            'make it a pitcher 80\n\nSPICY SWINGER 18',
            'make it a pitcher 80\nSPICY SWINGER 18'
        ));
        await assertPreviewHealthy(page, 'blank-line deletion');

        const twoLineEdit = await editMenuText(page, (text) => text.replace(
            'PALOMA 15\nblanco tequila, jarritos grapefruit, lime',
            'PALOMA 15\nburger\ntwo\nblanco tequila, jarritos grapefruit, lime'
        ));
        await assertPreviewHealthy(page, 'two-line insertion');

        const rapidOne = editMenuText(page, (text) => text.replace('VENGA VENGA 15', 'VENGA VENGA 15 fresh'));
        const rapidTwo = editMenuText(page, (text) => text.replace('SPICY VENGA 17', 'SPICY VENGA 17 bright'));
        const rapidResults = await Promise.all([rapidOne, rapidTwo]);
        await assertPreviewHealthy(page, 'rapid edits');

        const metrics = await page.evaluate(() => ({
            longTasks: window.__approvalLongTasks || [],
            spinnerHidden: !!document.getElementById('previewLoading')?.hidden,
            status: document.getElementById('diffSummary')?.textContent || '',
        }));
        const dispatchTimes = [
            deleteBlankLine.dispatchMs,
            twoLineEdit.dispatchMs,
            ...rapidResults.map((result) => result.dispatchMs),
        ];
        const maxDispatchMs = Math.max(...dispatchTimes);
        const maxLongTaskMs = Math.max(0, ...metrics.longTasks.map((entry) => entry.duration || 0));

        if (maxDispatchMs > 50) {
            throw new Error(`Editor input dispatch took ${maxDispatchMs.toFixed(1)}ms; expected <= 50ms`);
        }

        console.log(JSON.stringify({
            ok: true,
            url,
            maxDispatchMs: Number(maxDispatchMs.toFixed(1)),
            maxLongTaskMs: Number(maxLongTaskMs.toFixed(1)),
            longTaskCount: metrics.longTasks.length,
            status: metrics.status,
        }, null, 2));
    } finally {
        if (browser) {
            await browser.close();
        }
        harness.kill('SIGTERM');
    }
}

run().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});

#!/usr/bin/env node
// Run against the Docker dev app. No submissions, emails, or new model calls.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fixture = require('../services/dashboard/__fixtures__/basic-check/toro-holiday.json');

async function main() {
    const baseUrl = process.env.BASIC_CHECK_TEST_URL || 'http://localhost:3005';
    assert(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname), 'Use a local test app');
    const corrected = fixture.modelCorrectedLines.join('\n');
    // This route's no-changes branch runs the real formatting-anchor builder
    // without charging for an AI call or changing an existing submission.
    const response = await fetch(`${baseUrl}/api/form/basic-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            menuContent: corrected, baselineMenuContent: corrected,
            reviewMode: 'changed_only', templateType: 'food',
        }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.correctedMenu, corrected);
    assert.deepEqual(result.dishNameFormatting.map((anchor) => anchor.dishName), fixture.expectedDishNames);

    let browser;
    try {
        try {
            browser = await chromium.launch({ channel: 'chrome', headless: true });
        } catch (_) {
            browser = await chromium.launch({ headless: true });
        }
        const page = await browser.newPage({ viewport: { width: 1560, height: 1150 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        for (const route of ['/form-new', '/form-legacy']) {
            await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
            await page.waitForFunction(() => typeof quill !== 'undefined' && quill && window.MenuRedlinePreview);
            for (const crabOriginallyBold of [false, true]) {
                const actual = await page.evaluate(({ fixture, result, crabOriginallyBold }) => {
                    const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    const original = fixture.originalLines.join('\n');
                    const corrected = fixture.modelCorrectedLines.join('\n');
                    // The uploaded DOCX is unavailable; use reconstructed source
                    // HTML with the same line boundaries and both crab styles.
                    const source = fixture.originalLines.map((line, index) => {
                        if (index === 0 || (index === 2 && crabOriginallyBold)) return `<p><strong>${escape(line)}</strong></p>`;
                        return `<p>${escape(line)}</p>`;
                    }).join('');
                    quill.clipboard.dangerouslyPasteHTML(source);
                    const originalHtml = quill.root.innerHTML;
                    submissionMode = 'modification';
                    baseApprovedMenuContent = original;
                    baseApprovedMenuContentHtml = originalHtml;
                    aiCheckHasRun = true;
                    aiCheckResults = { ...result, originalMenu: original, hasChanges: true };
                    // Run the same result handler as a completed Basic AI Check.
                    showStep2(aiCheckResults);
                    if (typeof floatMenuToBottom === 'function') floatMenuToBottom();
                    const preview = document.getElementById('persistentPreviewBody').innerHTML;
                    // Persistent preview uses inline HTML + <br>; the imported
                    // revision helper expects paragraph blocks like Quill/DOCX.
                    const accepted = redlinePreview.buildRevisionComparisonFromAnnotatedHtml(htmlLinesToParagraphs(preview));
                    const submissionHtml = sanitizeMenuHtmlForSubmission(document.getElementById('reviewedContentArea').innerHTML);
                    const boldByCharacter = (html) => {
                        const root = document.createElement('div');
                        root.innerHTML = html;
                        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                        const values = [];
                        let node;
                        while ((node = walker.nextNode())) {
                            for (const char of node.textContent) values.push({ char, bold: !!node.parentElement.closest('b,strong') });
                        }
                        return values;
                    };
                    const inspectNames = (html) => {
                        const chars = boldByCharacter(html);
                        const text = chars.map((value) => value.char).join('');
                        return fixture.expectedDishNames.map((name) => {
                            const start = text.indexOf(name);
                            const row = fixture.modelCorrectedLines.find((line) => line.startsWith(name));
                            const suffix = row.slice(name.length);
                            return {
                                name,
                                nameBold: start >= 0 && chars.slice(start, start + name.length).every((value) => value.bold),
                                suffixPlain: chars.slice(start + name.length, start + name.length + suffix.length)
                                    .filter((value) => value.char.trim()).every((value) => !value.bold),
                            };
                        });
                    };
                    return {
                        editorText: quill.getText().replace(/\n$/, ''),
                        acceptedText: accepted.currentText,
                        submissionText: redlinePreview.buildRevisionComparisonFromAnnotatedHtml(submissionHtml).currentText,
                        editorNames: inspectNames(quill.root.innerHTML),
                        acceptedNames: inspectNames(accepted.editorHtml),
                        submittedNames: inspectNames(submissionHtml),
                    };
                }, { fixture, result, crabOriginallyBold });
                assert.equal(actual.editorText, corrected, `${route}: editor text`);
                assert.equal(actual.acceptedText, corrected, `${route}: accepted preview text`);
                assert.equal(actual.submissionText, corrected, `${route}: submission text`);
                for (const format of [...actual.editorNames, ...actual.acceptedNames, ...actual.submittedNames]) {
                    assert(format.nameBold, `${route}: ${format.name} must be bold`);
                    assert(format.suffixPlain, `${route}: ${format.name} description/codes must stay plain`);
                }
                console.log(`PASS ${route}: original crab bold=${crabOriginallyBold}; 6 independent bold dish names; exact editor/preview/submission text`);
            }
            if (process.env.BASIC_CHECK_SCREENSHOT && route === '/form-new') {
                await page.locator('.step2-container').screenshot({ path: process.env.BASIC_CHECK_SCREENSHOT });
            }
        }
        assert.deepEqual(errors, [], 'Browser errors');
    } finally {
        if (browser) await browser.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

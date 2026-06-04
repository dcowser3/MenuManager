const fs = require('fs');
const path = require('path');
const redlinePreview = require('../services/dashboard/public/js/redline-preview');

const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.resolve(
    process.env.APPROVAL_EDITOR_FIXTURE ||
    path.join(repoRoot, 'services', 'dashboard', '__fixtures__', 'approval-editor', 'venga-unapproved.json')
);
const iterations = Number(process.env.APPROVAL_PREVIEW_BENCHMARK_ITERATIONS || 5);

function normalizeApprovalEditorText(text) {
    const lines = `${text || ''}`
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.replace(/\u00A0/g, ' ').replace(/[ \t]+$/g, ''));

    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

    const normalized = [];
    let previousBlank = false;
    for (const line of lines) {
        if (!line.trim()) {
            if (!previousBlank) normalized.push('');
            previousBlank = true;
            continue;
        }
        normalized.push(line);
        previousBlank = false;
    }

    return normalized.join('\n');
}

function normalizeApprovalEditorTextWithAnnotations(text, annotations) {
    const lines = `${text || ''}`
        .replace(/\r/g, '')
        .split('\n')
        .map((line, index) => ({
            text: line.replace(/\u00A0/g, ' ').replace(/[ \t]+$/g, ''),
            annotations: Array.isArray(annotations && annotations[index])
                ? annotations[index].filter((annotation) =>
                    (annotation.type === 'del' || annotation.type === 'ins') &&
                    Number.isFinite(annotation.start) &&
                    Number.isFinite(annotation.end) &&
                    annotation.end > annotation.start)
                : [],
        }));

    while (lines.length && !lines[0].text.trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].text.trim()) lines.pop();

    const normalized = [];
    let previousBlank = false;
    for (const line of lines) {
        if (!line.text.trim()) {
            if (!previousBlank) normalized.push({ text: '', annotations: [] });
            previousBlank = true;
            continue;
        }
        normalized.push(line);
        previousBlank = false;
    }

    return {
        text: normalized.map((line) => line.text).join('\n'),
        annotations: normalized.map((line) => line.annotations),
    };
}

function buildVengaCase() {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const preview = normalizeApprovalEditorTextWithAnnotations(
        fixture.visible_text || '',
        fixture.annotations || []
    );
    const clean = normalizeApprovalEditorText(fixture.clean_visible_text || fixture.visible_text || '');
    const annotationMap = redlinePreview.buildAnnotationMapFromParagraphAnnotations(
        preview.text,
        preview.annotations
    );
    const resolverText = redlinePreview.stripExistingDeletions(preview.text, annotationMap);
    const revisedText = clean.replace(
        'make it a pitcher 80\n\nSPICY SWINGER 18',
        'make it a pitcher 80\nSPICY SWINGER 18'
    );

    return {
        fixture,
        previewText: preview.text,
        resolverText,
        revisedText,
        annotationMap,
    };
}

function runSharedRenderer(sample) {
    const start = performance.now();
    const resolved = redlinePreview.resolveExistingAnnotationRevisions(
        sample.resolverText,
        sample.revisedText,
        sample.previewText,
        sample.annotationMap,
        { baselineHtml: sample.fixture.unapproved_html || '' }
    );
    const resolvedAt = performance.now();
    const rendered = redlinePreview.renderPersistentPreview(
        resolved.basePreviewText,
        resolved.revisedPreviewText,
        {
            annotationMap: resolved.annotationMap,
            includeExistingAnnotations: true,
            baselineHtml: resolved.baselineHtml || sample.fixture.unapproved_html || '',
            revisedHtml: '',
        }
    );
    const renderedAt = performance.now();

    return {
        resolveMs: renderedAt >= resolvedAt ? resolvedAt - start : 0,
        renderMs: renderedAt - resolvedAt,
        totalMs: renderedAt - start,
        htmlChars: rendered.html.length,
    };
}

function summarize(rows) {
    const totals = rows.map((row) => row.totalMs).sort((a, b) => a - b);
    return {
        iterations: rows.length,
        minMs: Number(totals[0].toFixed(1)),
        medianMs: Number(totals[Math.floor(totals.length / 2)].toFixed(1)),
        maxMs: Number(totals[totals.length - 1].toFixed(1)),
        runs: rows.map((row) => ({
            resolveMs: Number(row.resolveMs.toFixed(1)),
            renderMs: Number(row.renderMs.toFixed(1)),
            totalMs: Number(row.totalMs.toFixed(1)),
            htmlChars: row.htmlChars,
        })),
    };
}

const sample = buildVengaCase();
const runs = [];
for (let i = 0; i < iterations; i++) {
    runs.push(runSharedRenderer(sample));
}

console.log(JSON.stringify({
    fixture: path.relative(repoRoot, fixturePath),
    renderer: 'shared redline-preview + diff-core',
    summary: summarize(runs),
    note: 'This benchmark covers the imported-redline approval editor hot path. Package swaps should beat this output without changing redline correctness before replacing diff-core.',
}, null, 2));

const http = require('http');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const repoRoot = path.resolve(__dirname, '..');
const templatePath = path.join(repoRoot, 'services', 'dashboard', 'views', 'approval-editor.ejs');
const publicRoot = path.join(repoRoot, 'services', 'dashboard', 'public');
const diffCorePath = path.join(repoRoot, 'services', 'diff-core', 'src', 'index.js');
const defaultFixturePath = path.join(
    repoRoot,
    'services',
    'dashboard',
    '__fixtures__',
    'approval-editor',
    'venga-unapproved.json'
);

const fixturePath = path.resolve(process.env.APPROVAL_EDITOR_FIXTURE || defaultFixturePath);
const port = Number(process.env.APPROVAL_EDITOR_HARNESS_PORT || 3015);
const fixtureId = process.env.APPROVAL_EDITOR_FIXTURE_ID || 'approval-editor-venga-venga';

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': contentType });
    res.end(body);
}

function sendFile(res, filePath, contentType) {
    fs.readFile(filePath, (err, body) => {
        if (err) {
            send(res, 404, 'Not found');
            return;
        }
        send(res, 200, body, contentType);
    });
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

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

function normalizeApprovalEditorHtml(html) {
    const value = `${html || ''}`.trim();
    if (!value) return value;
    const leadingBlankParagraphs = /^(?:\s*<p>\s*(?:<br\s*\/?>|&nbsp;|\s*)<\/p>\s*)+/i;
    const trailingBlankParagraphs = /(?:\s*<p>\s*(?:<br\s*\/?>|&nbsp;|\s*)<\/p>\s*)+$/i;
    return value.replace(leadingBlankParagraphs, '').replace(trailingBlankParagraphs, '').trim();
}

function buildFallbackHtml(text) {
    return normalizeApprovalEditorText(text)
        .split('\n')
        .map((line) => line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>')
        .join('');
}

function loadFixture() {
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function renderApprovalEditor(res) {
    const extraction = loadFixture();
    const normalizedPreview = normalizeApprovalEditorTextWithAnnotations(
        extraction.visible_text || '',
        extraction.annotations || []
    );
    const visibleText = normalizeApprovalEditorText(
        extraction.clean_visible_text || extraction.visible_text || extraction.menu_content || ''
    );
    const previewText = normalizedPreview.text || visibleText;
    const previewAnnotations = normalizedPreview.annotations || [];
    const editorHtml = normalizeApprovalEditorHtml(extraction.unapproved_html || '') ||
        buildFallbackHtml(visibleText);
    const submission = {
        id: fixtureId,
        project_name: 'Venga Venga Snowmass Beverage Menu',
        property: 'Venga Venga Snowmass',
        filename: 'Venga Venga Snowmass Beverage Menu.docx',
        raw_payload: {},
    };

    ejs.renderFile(templatePath, {
        title: `Approval Editor Harness: ${submission.project_name}`,
        submission,
        editorHtml,
        visibleText,
        previewText,
        previewAnnotations,
        previewAnnotationsJson: JSON.stringify(previewAnnotations),
        sourceMode: 'fixture_unapproved_docx',
        sourceLabel: 'Checked-in Venga unapproved DOCX redline fixture',
        approvalUrl: `http://localhost:${port}/approval/${fixtureId}`,
    }, (err, html) => {
        if (err) {
            send(res, 500, err.stack || err.message);
            return;
        }
        send(res, 200, html, 'text/html; charset=utf-8');
    });
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'GET' && (pathname === '/' || pathname === `/approval/${fixtureId}`)) {
        renderApprovalEditor(res);
        return;
    }

    if (req.method === 'POST' && pathname.startsWith('/api/approval/')) {
        send(res, 200, JSON.stringify({
            success: true,
            submissionId: fixtureId,
            harness: true,
        }), 'application/json; charset=utf-8');
        return;
    }

    if (req.method === 'GET' && pathname === '/js/diff-core.js') {
        sendFile(res, diffCorePath, 'application/javascript; charset=utf-8');
        return;
    }

    if (req.method === 'GET' && pathname.startsWith('/js/')) {
        sendFile(res, path.join(publicRoot, pathname), 'application/javascript; charset=utf-8');
        return;
    }

    if (req.method === 'GET' && pathname.startsWith('/css/')) {
        sendFile(res, path.join(publicRoot, pathname), 'text/css; charset=utf-8');
        return;
    }

    if (req.method === 'GET' && pathname.startsWith('/download/original/')) {
        send(res, 404, 'Original DOCX download is disabled in the approval editor harness.');
        return;
    }

    send(res, 404, 'Not found');
});

server.listen(port, () => {
    console.log(`Approval editor harness listening at http://localhost:${port}/approval/${fixtureId}`);
});

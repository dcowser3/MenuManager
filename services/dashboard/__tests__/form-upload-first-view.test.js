const fs = require('fs');
const path = require('path');

function readForm() {
    return fs.readFileSync(path.join(__dirname, '..', 'views', 'form.ejs'), 'utf8');
}

describe('upload-first submission form structure', () => {
    test('loads the pure stage-logic module', () => {
        const t = readForm();
        expect(t).toContain('/js/form-stage.js');
    });

    test('opens with a single menu-upload dropzone as the landing stage', () => {
        const t = readForm();
        expect(t).toContain('id="uploadStage"');
        expect(t).toContain('id="menuUploadInput" accept=".docx" onchange="onMenuUpload()"');
        expect(t).toContain('id="uploadDropzone"');
    });

    test('wraps the progressively-revealed sections in reveal containers', () => {
        const t = readForm();
        expect(t).toContain('id="menuSplitBlock" class="reveal"');
        expect(t).toContain('id="detailsStage" class="reveal"');
        expect(t).toContain('id="approvalStage" class="reveal"');
        expect(t).toContain('id="aiActionStage" class="reveal"');
        expect(t).toContain('id="submitStage" class="reveal"');
        expect(t).toContain('id="menuBottomSlot"');
    });

    test('the AI review action is a single Review-with-AI button', () => {
        const t = readForm();
        expect(t).toContain('id="reviewWithAiBtn"');
        expect(t).toContain('Review with AI');
    });

    test('drops the Menu Image Upload from the flow', () => {
        const t = readForm();
        expect(t).not.toContain('id="menuImageUpload"');
        expect(t).not.toContain('Menu Image Upload (Optional)');
    });

    test('wires the upload-first JavaScript', () => {
        const t = readForm();
        expect(t).toContain('async function onMenuUpload()');
        expect(t).toContain('function applyUnapprovedUploadData(data, file)');
        expect(t).toContain('function applyStageReveals()');
        expect(t).toContain('function setSectionRevealed(id, shouldReveal)');
        expect(t).toContain('function floatMenuToBottom()');
        expect(t).toContain('function initUploadFirstLayout()');
        expect(t).toContain('initUploadFirstLayout();');
        // single upload path always uses the preserve-redlines extraction
        expect(t).toContain("fetch('/api/modification/unapproved-upload'");
    });

    test('reuses the shared redline diff engine (still loaded)', () => {
        const t = readForm();
        expect(t).toContain('/js/redline-preview.js');
        expect(t).toContain('redlinePreview.buildRevisionComparisonFromAnnotatedHtml(unapprovedBaseHtml)');
    });

    test('hides the legacy submission-mode + workflow chooser instead of showing it', () => {
        const t = readForm();
        // mode toggle + workflow panel are no longer visible in the flow
        expect(t).toContain('class="submission-mode" style="display:none"');
        expect(t).toContain('id="modificationSearchSection" class="modification-search show" style="display:none"');
        // legacy menu-composition (paste) editor kept only as a hidden backing store
        expect(t).toContain('id="step1MenuCompositionSection" style="display:none"');
    });
});

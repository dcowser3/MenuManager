const assert = require('assert/strict');
const path = require('path');
const { Given, When, Then } = require('@cucumber/cucumber');
const {
    getApprovalSourceDocCandidates,
    loadApprovalBaselineFromSubmission,
} = require('../../../services/dashboard/lib/approval-baseline');
const redlinePreview = require('../../../services/dashboard/public/js/redline-preview');

function baselinePath(name) {
    return path.join(__dirname, '..', '..', '..', 'samples', name);
}

Given('a modification submission selected {string}', function (optionLabel) {
    const optionToSource = {
        'Upload Prior Approved DOCX': 'uploaded_baseline',
        'Upload Unapproved DOCX': 'uploaded_unapproved',
    };
    this.uploadOption = optionLabel;
    this.submission = {
        id: 'sub-business-upload',
        filename: 'Uploaded Menu.docx',
        submission_mode: 'modification',
        revision_source: optionToSource[optionLabel],
        revision_baseline_doc_path: baselinePath('demo-toro-chicago.docx'),
        revision_baseline_file_name: 'Uploaded Menu.docx',
        raw_payload: {},
    };
});

When('the approval baseline is loaded from the uploaded DOCX', async function () {
    this.extractorCalls = [];
    const candidates = getApprovalSourceDocCandidates(this.submission);
    this.selectedCandidate = candidates.find((candidate) =>
        candidate.sourceMode === 'revision_baseline_docx'
    );

    this.baseline = await loadApprovalBaselineFromSubmission(this.submission, {
        resolveStoredPath: (filePath) => filePath,
        extractApprovedFromDocx: async () => {
            this.extractorCalls.push('approved');
            return {
                approvedMenuContent: 'Guacamole 14',
                approvedMenuContentHtml: '<p>Guacamole 14</p>',
            };
        },
        extractUnapprovedFromDocx: async () => {
            this.extractorCalls.push('unapproved');
            return {
                visibleText: 'Guacamole 12\nQuesadilla oldnew 16',
                cleanVisibleText: 'Guacamole 12\nQuesadilla new 16',
                unapprovedHtml: '<p>Guacamole 12</p><p>Quesadilla <span class="existing-del">old</span><span class="existing-ins">new</span> 16</p>',
                annotations: [
                    [],
                    [
                        { start: 11, end: 14, type: 'del' },
                        { start: 14, end: 17, type: 'ins' },
                    ],
                ],
            };
        },
    });
});

Then('the approved DOCX extractor is used', function () {
    assert.equal(this.selectedCandidate.extractionMode, 'approved');
    assert.deepEqual(this.extractorCalls, ['approved']);
});

Then('the unapproved DOCX extractor is used', function () {
    assert.equal(this.selectedCandidate.extractionMode, 'unapproved');
    assert.deepEqual(this.extractorCalls, ['unapproved']);
});

Then('imported redlines are stripped from the editable menu', function () {
    assert.equal(this.baseline.visibleText, 'Guacamole 14');
    assert.equal(this.baseline.previewText, 'Guacamole 14');
    assert.deepEqual(this.baseline.previewAnnotations, []);
});

Then('imported redlines are preserved in the approval preview', function () {
    assert.equal(this.baseline.previewText, 'Guacamole 12\nQuesadilla oldnew 16');
    assert.equal(this.baseline.previewAnnotations[1][0].type, 'del');
    assert.equal(this.baseline.previewAnnotations[1][1].type, 'ins');
});

Then('the editable menu uses the clean accepted text', function () {
    assert.equal(this.baseline.visibleText, 'Guacamole 12\nQuesadilla new 16');
});

Then('reviewer edits add approval highlights', function () {
    const revisedText = `${this.baseline.visibleText}\nDessert 9`;
    const preview = redlinePreview.renderPersistentPreview(this.baseline.visibleText, revisedText, {
        baselineHtml: this.baseline.editorHtml,
    });
    assert.match(preview.html, /persistent-ins/);
    assert.equal(preview.insertions, 1);
});

const fs = require('fs');
const path = require('path');

describe('dashboard form modification source chooser', () => {
    test('defaults to modification mode without choosing a modification source', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('id="submissionModeModification" value="modification" checked');
        expect(template).toContain('id="modificationSearchSection" class="modification-search show"');
        expect(template).toContain('let submissionMode = \'modification\';');
        expect(template).not.toContain('id="submissionModeNew" value="new" checked');
    });

    test('groups database and prior approved upload under edit-here flow', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain("I'll make menu changes here");
        expect(template).toContain('Upload Prior Approved DOCX');
        expect(template).toContain('Choose from database (recommended)');
        expect(template).toContain('My menu is not in database yet');
        expect(template).toContain('I already made my menu edits on a doc');
        expect(template).toContain('Upload Unapproved DOCX (Preserve Redlines)');
        expect(template).toContain('name="approvedBaselineSource"');
        expect(template).toContain('id="modWorkflowEditHere" value="edit_here" onchange=');
        expect(template).toContain('id="modSourceDatabase" value="database" onchange=');
        expect(template).toContain('id="baselineDocUpload" accept=".docx" onchange="uploadBaselineDoc()"');
        expect(template).toContain('id="unapprovedDocUpload" accept=".docx" onchange="uploadUnapprovedDoc()"');
        expect(template).not.toContain('id="modSourceUpload" value="upload" onchange="onModificationSourceChange()">\n                            Upload Prior Approved DOCX');
        expect(template).not.toContain('Upload Approved DOCX (Preserve Redlines)');
        expect(template).not.toContain('id="modWorkflowEditHere" value="edit_here" checked');
        expect(template).not.toContain('id="modSourceDatabase" value="database" checked');
    });

    test('keeps imported redline and highlight spans editable in revision mode', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('reviewedArea.contentEditable = \'true\';');
        expect(template).not.toContain('span.contentEditable = \'false\';');
        expect(template).not.toContain('querySelectorAll(\'.existing-del, .existing-ins\').forEach(span => {');
    });

    test('uses a full-screen decision dialog for existing approved menu conflicts', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('id="baselineFreshnessModal"');
        expect(template).toContain('role="dialog" aria-modal="true"');
        expect(template).toContain('id="baselineFreshnessCancelBtn" class="btn btn-quiet">Cancel</button>');
        expect(template).toContain('Continue as Brand New');
        expect(template).toContain('Use Existing Menu');
        expect(template).toContain('latestBaselineFreshnessIssue = issue;');
        expect(template).not.toContain('if (issue) showBaselineFreshnessWarning(issue);');
    });

    test('keeps docx metadata extraction misses silent', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).not.toContain('function showUploadNotice(message)');
        expect(template).not.toContain('alert-growl-progress');
        expect(template).not.toContain('alertGrowlCountdown');
        expect(template).not.toContain('We weren\'t able to fill in the property from your Word doc');
        expect(template).not.toContain('Extracted orientation "');
        expect(template).not.toContain('could not be parsed — please enter dimensions manually');
        expect(template).not.toContain('showUploadNotice(warning)');
        expect(template).toContain('window.formHelpers.isValidDateInputValue(extractedDate)');
        expect(template).not.toContain('markFieldAsExtracted(\'dateNeeded\');\n        }');
    });

    test('shows support email guidance in blocking form errors', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('If this keeps happening or blocks your submission, email');
        expect(template).toContain('supportLink.href = \'mailto:<%= supportEmail %>\';');
        expect(template).toContain('If you are stuck, email <a href="mailto:<%= supportEmail %>"><%= supportEmail %></a>.');
        expect(template).toContain('Need help? Email <a href="mailto:<%= supportEmail %>"><%= supportEmail %></a>.');
    });
});

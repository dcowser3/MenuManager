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
        expect(template).toContain('Upload Approved DOCX (Preserve Redlines)');
        expect(template).toContain('name="approvedBaselineSource"');
        expect(template).toContain('id="modWorkflowEditHere" value="edit_here" onchange=');
        expect(template).toContain('id="modSourceDatabase" value="database" onchange=');
        expect(template).not.toContain('id="modSourceUpload" value="upload" onchange="onModificationSourceChange()">\n                            Upload Prior Approved DOCX');
        expect(template).not.toContain('Upload Unapproved DOCX (Preserve Redlines)');
        expect(template).not.toContain('id="modWorkflowEditHere" value="edit_here" checked');
        expect(template).not.toContain('id="modSourceDatabase" value="database" checked');
    });
});

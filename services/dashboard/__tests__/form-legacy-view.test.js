const fs = require('fs');
const path = require('path');

function readLegacyForm() {
    return fs.readFileSync(path.join(__dirname, '..', 'views', 'form-legacy.ejs'), 'utf8');
}

describe('legacy submission form (/form-legacy)', () => {
    test('is the pre-redesign flow, not the upload-first one', () => {
        const t = readLegacyForm();
        // legacy mode/workflow chooser is present...
        expect(t).toContain('name="approvedBaselineSource"');
        // ...and the upload-first stage scaffolding is not.
        expect(t).not.toContain('id="uploadStage"');
    });

    test('collects the approver email (parity with the new form)', () => {
        const t = readLegacyForm();
        expect(t).toContain('id="approver1Email" required');
        expect(t).toContain('id="approver1EmailError"');
        expect(t).toContain('id="approver2Email"');
        // validated on submit and carried in the approvals payload
        expect(t).toContain('function isValidEmailAddress(value)');
        expect(t).toContain("setGenericFieldError('approver1Email', approver1Email ? '' : 'Please enter the approver email')");
        expect(t).toContain("email: document.getElementById('approver1Email').value.trim()");
    });
});

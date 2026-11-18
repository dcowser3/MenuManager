const fs = require('fs');
const path = require('path');

function readForm() {
    return fs.readFileSync(path.join(__dirname, '..', 'views', 'form.ejs'), 'utf8');
}

// Draft sessions must round-trip the fields users actually retype the most.
// See docs/design-docs/draft-concurrency-and-lineage.md.
describe('draft session resume behavior (form view)', () => {
    test('draft form_state persists submitter information fields', () => {
        const t = readForm();
        expect(t).toContain("submitterName: valueFor('submitterName')");
        expect(t).toContain("submitterEmail: valueFor('submitterEmail')");
        expect(t).toContain("submitterJobTitle: valueFor('submitterJobTitle')");
    });

    test('draft form_state persists required-approval fields (both approvers)', () => {
        const t = readForm();
        expect(t).toContain("approval1: valueFor('approval1')");
        expect(t).toContain("approver1Name: valueFor('approver1Name')");
        expect(t).toContain("approver1Position: valueFor('approver1Position')");
        expect(t).toContain("approver1Email: valueFor('approver1Email')");
        expect(t).toContain("approval2: valueFor('approval2')");
        expect(t).toContain("approver2Name: valueFor('approver2Name')");
        expect(t).toContain("approver2Position: valueFor('approver2Position')");
        expect(t).toContain("approver2Email: valueFor('approver2Email')");
        expect(t).toContain('additionalApproverVisible');
    });

    test('applyDraftFormState restores submitter + approver fields and re-opens the additional approver group', () => {
        const t = readForm();
        expect(t).toContain("submitterName: 'submitterName'");
        expect(t).toContain("approver1Name: 'approver1Name'");
        expect(t).toContain("approver2Email: 'approver2Email'");
        expect(t).toContain('wantsAdditionalApprover');
    });

    test('resuming a previously saved draft shows an explicit banner', () => {
        const t = readForm();
        expect(t).toContain('resumedPriorSave');
        expect(t).toContain('You are resuming an in-progress draft last saved');
        expect(t).toContain('Enter your own Submitter Information before submitting');
    });

    test('resuming a saved draft clears inherited submitter identity and suppresses remembered-profile prefill', () => {
        const t = readForm();
        expect(t).toContain('isPreviouslySavedActiveDraft(draftSession)');
        expect(t).toContain('clearResumedDraftSubmitterIdentity();');
        expect(t).toContain('if (draftRequiresFreshSubmitterIdentity) return;');
        expect(t).toMatch(/clearResumedDraftSubmitterIdentity\(\)[\s\S]*submitterName[\s\S]*submitterEmail[\s\S]*submitterJobTitle/);
    });

    test('active draft restore refreshes the derived read-only date after applying saved form state', () => {
        const t = readForm();
        expect(t).toMatch(/applyDraftFormState\(draftSession\.form_state \|\| \{\}\);[\s\S]*draftSession\.status === 'active'[\s\S]*setDateNeededMinimumFromTurnaround\(true\);/);
    });

    // Contract changed 2026-11-16 (Load Newer Menu incident): staleness at open
    // is decided by menu identity (draftSession.baselineFreshness from the db),
    // and the banner names the newer version instead of a property + service
    // "latest". See baseline-freshness-client.test.js for behavior coverage.
    test('opening a draft on a superseded baseline warns at open, not only at continue', () => {
        const t = readForm();
        expect(t).toContain('Draft baseline staleness check failed');
        expect(t).toContain('was approved after this draft started. This draft can\'t be checked or submitted.');
    });
});

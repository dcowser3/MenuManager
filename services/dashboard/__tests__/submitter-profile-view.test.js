const fs = require('fs');
const path = require('path');

function readView(name) {
    return fs.readFileSync(path.join(__dirname, '..', 'views', name), 'utf8');
}

// Phase 4 — remembered submitter profile (localStorage, no accounts).
// See docs/design-docs/menu-entity-and-identity.md (Identity Stage 1).
describe('remembered submitter profile (form view)', () => {
    test('uses a versioned localStorage key shared across pages', () => {
        expect(readView('form.ejs')).toContain("SUBMITTER_PROFILE_KEY = 'menumanager.submitterProfile.v1'");
        expect(readView('design-approval.ejs')).toContain("SUBMITTER_PROFILE_KEY = 'menumanager.submitterProfile.v1'");
    });

    test('saves the profile on autocomplete selection and on successful submit', () => {
        const t = readView('form.ejs');
        // selectSubmitter ends by remembering the picked profile.
        expect(t).toContain('submitterHighlightIndex = -1;\n            saveSubmitterProfile();');
        // Submit success path saves before preparing the next submission.
        expect(t).toContain('// Remember this submitter for next time (Phase 4).\n                saveSubmitterProfile();');
    });

    test('prefill runs after draft restore and only fills empty fields (draft form_state wins)', () => {
        const t = readView('form.ejs');
        // Ordering: applyDraftSession() then prefillSubmitterProfile().
        expect(t).toMatch(/applyDraftSession\(\);[\s\S]*prefillSubmitterProfile\(\);/);
        // fillIfEmpty guards on the field already being non-empty.
        expect(t).toContain('const fillIfEmpty = (id, value) => {');
        expect(t).toContain("if (el && !`${el.value || ''}`.trim() && `${value || ''}`.trim())");
    });

    test('draft autosave last_edited_by falls back to the stored profile name', () => {
        const t = readView('form.ejs');
        expect(t).toContain("lastEditedBy: (document.getElementById('submitterName')?.value || '').trim() || storedSubmitterName()");
        expect(t).toContain('function storedSubmitterName()');
    });

    test('design approval prefills on load and saves after compare', () => {
        const t = readView('design-approval.ejs');
        expect(t).toContain('prefillSubmitterProfile();');
        expect(t).toContain('// Remember this submitter for next time (Phase 4).\n            saveSubmitterProfile();');
    });
});

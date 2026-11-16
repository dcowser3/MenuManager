'use strict';

// Client coverage for the 2026-11-16 "Load Newer Menu" incident fix. The
// decision logic and dialog controller live in public/js/baseline-freshness.js
// (shared by form.ejs and form-legacy.ejs) and are exercised here directly;
// the views are checked for the wiring.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dashboardRoot = path.resolve(__dirname, '..');
const strand = JSON.parse(fs.readFileSync(path.join(dashboardRoot, '..', 'db', '__fixtures__', 'strand-incident.json'), 'utf8'));
const K = strand.keys;

function loadModule() {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(dashboardRoot, 'public/js/baseline-freshness.js'), 'utf8'), { window, Set, Date, Number, String, Array, Promise, Object });
    return window.MenuBaselineFreshness;
}

// Client baseline shape (db mapApprovedSubmissionForClient subset).
function clientBaseline(key) {
    const row = strand.submissions[K[key]];
    return {
        id: row.legacy_id,
        idAliases: [row.legacy_id, row.id],
        projectName: row.project_name,
        property: row.property,
        servicePeriod: row.service_period,
        templateType: row.template_type,
        menuType: row.menu_type,
        orientation: row.orientation,
        assetType: row.asset_type,
        printWidth: row.print_width,
        printHeight: row.print_height,
        printRegion: row.print_region,
        folded: row.folded,
        cropMarks: row.crop_marks,
        bleedMarks: row.bleed_marks,
        fileSizeLimit: row.file_size_limit,
        allergens: row.allergens,
        approvedMenuContent: row.approved_menu_content,
        reviewedAt: row.reviewed_at,
        menuId: row.menu_id,
    };
}

function fakeElement() {
    const classes = new Set();
    return {
        textContent: '',
        innerHTML: '',
        hidden: false,
        style: { display: '' },
        disabled: false,
        value: '',
        onclick: null,
        children: [],
        focused: 0,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
        },
        focus() { this.focused += 1; fakeElement.lastFocused = this; },
        appendChild(child) { this.children.push(child); },
    };
}

function buildDialog(MenuBaselineFreshness, overrides = {}) {
    const elements = {
        modal: fakeElement(), title: fakeElement(), message: fakeElement(), detail: fakeElement(),
        list: fakeElement(), loadBtn: fakeElement(), continueBtn: fakeElement(), cancelBtn: fakeElement(),
        openCurrentForm: fakeElement(), openCurrentInput: fakeElement(),
    };
    elements.loadBtn.classList.add('btn-primary');
    const onLoad = jest.fn();
    const onKeep = jest.fn();
    const document = { createElement: () => fakeElement() };
    const dialog = MenuBaselineFreshness.createFreshnessDialog({ elements, document, onLoad, onKeep, ...overrides });
    return { dialog, elements, onLoad, onKeep };
}

const strandForm = (key) => ({ property: strand.property, servicePeriod: strand.submissions[K[key]].service_period });

describe('baseline freshness decision (menu identity only)', () => {
    const M = loadModule();

    test('Strand fixture: editing Sunset Lounge Cocktail Menu raises no issue although In Room Dining shares property + service and is newer', () => {
        const selected = clientBaseline('slc');
        const issue = M.classifyIssue({
            submissionMode: 'modification', revisionSource: 'database',
            selected, selectedId: selected.id, ...strandForm('slc'),
            // Server answer by menu identity: same menu pointer -> not stale.
            freshness: { stale: false, basis: 'menu_pointer', newerVersion: null },
            // Even if something passed the other menus in, they are ignored in modification mode.
            existingMenus: [clientBaseline('ird'), clientBaseline('pool')],
        });
        expect(issue).toBeNull();
    });

    test('stale only from the server answer; a newer version of the same menu is named', () => {
        const selected = clientBaseline('cocktail');
        const newer = { ...clientBaseline('cocktail'), id: 'form-1794900000001', idAliases: ['form-1794900000001'], reviewedAt: '2026-11-10T09:00:00Z' };
        const issue = M.classifyIssue({
            submissionMode: 'modification', revisionSource: 'database', selected, selectedId: selected.id,
            ...strandForm('cocktail'), freshness: { stale: true, basis: 'menu_pointer', newerVersion: newer },
        });
        expect(issue).toEqual(expect.objectContaining({ type: 'stale', latest: newer }));
    });

    test('a server answer naming the selected baseline itself (other id form) is not stale', () => {
        const selected = clientBaseline('cocktail');
        const self = { id: selected.idAliases[1] };
        expect(M.classifyIssue({
            submissionMode: 'modification', revisionSource: 'database', selected, selectedId: selected.id,
            ...strandForm('cocktail'), freshness: { stale: true, newerVersion: self },
        })).toBeNull();
        expect(M.sameSubmission(selected, selected.idAliases[1])).toBe(true);
    });

    test('unapproved uploads never gate', () => {
        expect(M.classifyIssue({ submissionMode: 'modification', revisionSource: 'uploaded_unapproved', freshness: { stale: true, newerVersion: {} } })).toBeNull();
    });

    test('brand-new mode with several menus in the service period lists them all by name', () => {
        const menus = ['dinner', 'sunset', 'cocktail', 'wine'].map(clientBaseline);
        const issue = M.classifyIssue({ submissionMode: 'new', property: strand.property, servicePeriod: 'dinner', existingMenus: menus });
        expect(issue.type).toBe('existing');
        const model = M.buildDialogModel(issue, { editedLineCount: 0 });
        expect(model.title).toBe('4 approved menus already exist for dinner');
        expect(model.loadLabel).toBeNull(); // never silently pick one
        expect(model.candidates.map((c) => c.label)).toEqual([
            'Replace with "The Del Mar Dinner Menu"',
            'Replace with "The Del Mar Sunset Lounge"',
            'Replace with "The Del Mar Cocktail Menu"',
            'Replace with "The Del Mar Wine Bottle List"',
        ]);
    });
});

describe('freshness dialog behavior', () => {
    const M = loadModule();
    const staleIssue = () => ({
        type: 'stale',
        selected: clientBaseline('cocktail'),
        latest: { id: 'form-1794900000001', projectName: 'The Del Mar Cocktail Menu', reviewedAt: '2026-11-10T09:00:00Z' },
    });

    test('no dialog for the Strand fixture (null issue resolves immediately)', async () => {
        const { dialog, elements } = buildDialog(M);
        await expect(dialog.ask(null, {})).resolves.toBe(true);
        expect(elements.modal.classList.contains('show')).toBe(false);
    });

    test('no load action in a draft: stale draft blocks with the newer version, its date, and an open-current link', async () => {
        const { dialog, elements, onLoad } = buildDialog(M);
        const pending = dialog.ask(staleIssue(), { inDraft: true, editedLineCount: 12 });
        expect(elements.loadBtn.hidden).toBe(true);
        // Inline display too: `.btn` CSS would otherwise override `hidden`
        // (caught in the stubbed browser regression).
        expect(elements.loadBtn.style.display).toBe('none');
        expect(elements.loadBtn.onclick).toBeNull();
        expect(elements.continueBtn.hidden).toBe(true);
        expect(elements.continueBtn.style.display).toBe('none');
        expect(elements.list.children).toHaveLength(0);
        expect(elements.message.textContent).toContain('"The Del Mar Cocktail Menu" was approved on');
        expect(elements.message.textContent).toContain(new Date('2026-11-10T09:00:00Z').toLocaleDateString());
        expect(elements.openCurrentForm.hidden).toBe(false);
        expect(elements.openCurrentInput.value).toBe('form-1794900000001');
        elements.cancelBtn.onclick();
        await expect(pending).resolves.toBe(false);
        expect(onLoad).not.toHaveBeenCalled();
        // Blocking issues are never remembered: asking again blocks again.
        const again = dialog.ask(staleIssue(), { inDraft: true });
        expect(elements.modal.classList.contains('show')).toBe(true);
        elements.cancelBtn.onclick();
        await expect(again).resolves.toBe(false);
    });

    test('default focus is Cancel and the replacing button is not primary-styled', async () => {
        const { dialog, elements } = buildDialog(M);
        const pending = dialog.ask(staleIssue(), { inDraft: false, editedLineCount: 0 });
        expect(fakeElement.lastFocused).toBe(elements.cancelBtn);
        expect(elements.loadBtn.classList.contains('btn-primary')).toBe(false);
        expect(elements.title.textContent).toBe('Replace your menu with "The Del Mar Cocktail Menu"?');
        elements.cancelBtn.onclick();
        await pending;
    });

    test('edits require a second explicit confirmation that states how many lines are discarded', async () => {
        const { dialog, elements, onLoad } = buildDialog(M);
        const pending = dialog.ask(staleIssue(), { inDraft: false, editedLineCount: 24 });
        expect(elements.message.textContent).toContain('discard 24 edited lines');
        elements.loadBtn.onclick();
        expect(onLoad).not.toHaveBeenCalled();
        expect(elements.title.textContent).toBe('Discard 24 edited lines?');
        expect(fakeElement.lastFocused).toBe(elements.cancelBtn);
        elements.loadBtn.onclick();
        expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ id: 'form-1794900000001' }));
        await expect(pending).resolves.toBe(false);
    });

    test('single prompt: "keep" is honored for the same issue at submit (no forced re-prompt)', async () => {
        const { dialog, elements, onKeep } = buildDialog(M);
        const first = dialog.ask(staleIssue(), { inDraft: false });
        elements.continueBtn.onclick();
        await expect(first).resolves.toBe(true);
        expect(onKeep).toHaveBeenCalledTimes(1);
        elements.modal.classList.remove('show');
        await expect(dialog.ask(staleIssue(), { inDraft: false })).resolves.toBe(true);
        expect(elements.modal.classList.contains('show')).toBe(false);
    });

    test('choosing one menu from a multi-menu list loads exactly that menu', async () => {
        const { dialog, elements, onLoad } = buildDialog(M);
        const menus = ['dinner', 'sunset', 'cocktail', 'wine'].map(clientBaseline);
        const pending = dialog.ask({ type: 'existing', property: strand.property, servicePeriod: 'dinner', candidates: menus }, { editedLineCount: 0 });
        expect(elements.list.hidden).toBe(false);
        expect(elements.loadBtn.hidden).toBe(true);
        elements.list.children[2].onclick();
        expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ projectName: 'The Del Mar Cocktail Menu' }));
        await pending;
    });
});

describe('zero-change block, draft lock, synchronous submit guard', () => {
    const M = loadModule();

    function detailsFrom(baseline) {
        return {
            projectName: baseline.projectName, templateType: baseline.templateType, menuType: baseline.menuType,
            servicePeriod: baseline.servicePeriod, orientation: baseline.orientation, assetType: baseline.assetType,
            printWidth: baseline.printWidth, printHeight: baseline.printHeight, printRegion: baseline.printRegion,
            folded: 'no', cropMarks: 'no', bleedMarks: 'no', fileSizeLimit: 'no', allergens: baseline.allergens,
        };
    }

    test('zero changed lines and no detail change is blocked; a one-word edit, a deletion, or a size change is not', () => {
        const baseline = clientBaseline('sunset');
        const base = { submissionMode: 'modification', revisionSource: 'database', baseline, baselineText: baseline.approvedMenuContent };
        expect(M.isZeroChangeModification({ ...base, currentText: baseline.approvedMenuContent, details: detailsFrom(baseline) })).toBe(true);
        expect(M.isZeroChangeModification({ ...base, currentText: baseline.approvedMenuContent.replace('Tuna', 'Salmon'), details: detailsFrom(baseline) })).toBe(false);
        expect(M.isZeroChangeModification({ ...base, currentText: baseline.approvedMenuContent.split('\n').slice(0, -1).join('\n'), details: detailsFrom(baseline) })).toBe(false);
        expect(M.isZeroChangeModification({ ...base, currentText: baseline.approvedMenuContent, details: { ...detailsFrom(baseline), printWidth: '11' } })).toBe(false);
        expect(M.isZeroChangeModification({ ...base, submissionMode: 'new', currentText: baseline.approvedMenuContent, details: detailsFrom(baseline) })).toBe(false);
        expect(M.isZeroChangeModification({ ...base, revisionSource: 'uploaded_unapproved', currentText: baseline.approvedMenuContent, details: detailsFrom(baseline) })).toBe(false);
    });

    test('draft lock accepts only the draft baseline, by either id form', () => {
        const lock = M.createDraftBaselineLock({ id: K.cocktail, idAliases: [K.cocktail, strand.submissions[K.cocktail].id] });
        expect(lock.allows(K.cocktail)).toBe(true);
        expect(lock.allows(strand.submissions[K.cocktail].id)).toBe(true);
        expect(lock.allows(clientBaseline('sunset'))).toBe(false);
        expect(lock.allows(null)).toBe(false);
        expect(M.createDraftBaselineLock(null).allows(clientBaseline('sunset'))).toBe(true);
    });

    test('submit disabled synchronously at click; a second click while in flight is ignored; restored on failure', () => {
        const button = { disabled: false };
        const guard = M.createSubmitGuard(() => button);
        expect(guard.begin()).toBe(true);
        expect(button.disabled).toBe(true); // before any await
        expect(guard.begin()).toBe(false);
        guard.end();
        expect(button.disabled).toBe(false);
        expect(guard.begin()).toBe(true);
    });
});

describe.each(['form.ejs', 'form-legacy.ejs'])('%s wiring', (view) => {
    const source = fs.readFileSync(path.join(dashboardRoot, 'views', view), 'utf8');

    test('loads the shared module and no longer decides staleness by property + service period', () => {
        expect(source).toContain('<script src="/js/baseline-freshness.js?v=20261116"></script>');
        expect(source).toContain('/api/submissions/baseline-freshness');
        expect(source).not.toContain('/api/submissions/latest-approved');
        expect(source).not.toContain('isLatestForPropertyService');
        expect(source).not.toContain('older than latest for this service');
        expect(source).not.toMatch(/showBaselineFreshnessWarning\(issue, \{ force: true \}\)/);
        expect(source).toContain('MenuBaselineFreshness.createFreshnessDialog(');
    });

    test('dialog markup: Cancel is not quiet, the replace button is not primary', () => {
        expect(source).toMatch(/id="baselineFreshnessCancelBtn" class="btn btn-secondary"/);
        expect(source).toMatch(/id="baselineFreshnessLoadBtn" class="btn btn-quiet"/);
        expect(source).not.toMatch(/id="baselineFreshnessLoadBtn" class="btn btn-primary"/);
    });

    test('submit takes the synchronous guard before any await and blocks zero-change modifications', () => {
        const submitStart = source.indexOf('async function submitMenu(skipAiReview = false) {');
        const firstAwait = source.indexOf('await', submitStart);
        const guard = source.indexOf('if (!submitGuard.begin()) return;', submitStart);
        expect(guard).toBeGreaterThan(submitStart);
        expect(guard).toBeLessThan(firstAwait);
        expect(source).toContain('MenuBaselineFreshness.isZeroChangeModification({');
    });
});

describe('form.ejs draft protections', () => {
    const source = fs.readFileSync(path.join(dashboardRoot, 'views', 'form.ejs'), 'utf8');

    test('every write to revisionBaseSubmissionId goes through the draft-locked setter', () => {
        const writes = source.match(/(?<![\w.])revisionBaseSubmissionId = /g) || [];
        // Exactly two: the declaration and the setter body.
        expect(writes).toHaveLength(2);
        expect(source).toContain('let revisionBaseSubmissionId = null;');
        expect(source).toMatch(/function setRevisionBaseSubmissionId\(nextId\) \{\n\s+if \(draftSessionToken && draftBaselineLock\.active && !draftBaselineLock\.allows\(nextId\)\)/);
    });

    test('applyApprovedBaseline and applyProjectPrefill refuse another baseline in a draft; autosave refuses a foreign baseline', () => {
        expect(source).toMatch(/function applyApprovedBaseline\(selected, options = \{\}\) \{\n\s+if \(!selected\) return false;[\s\S]{0,300}draftBaselineLock\.allows\(selected\)/);
        expect(source).toMatch(/function applyProjectPrefill\(p\) \{\n\s+if \(!p\) return;[\s\S]{0,200}draftBaselineLock\.allows\(p\)/);
        expect(source).toMatch(/async function saveDraftNow\(\) \{[\s\S]{0,300}draftBaselineLock\.allows\(revisionBaseSubmissionId\)/);
        expect(source).toMatch(/async function loadLatestApprovedBaseline\(latest\) \{[\s\S]{0,200}if \(draftSessionToken\) return;/);
    });

    test('draft-open banner uses the menu-identity freshness answer and offers the current version in a new tab', () => {
        expect(source).toContain('draftSession.baselineFreshness');
        expect(source).toContain("label: 'Open the current version in a new tab'");
        expect(source).toContain('id="baselineFreshnessOpenCurrentForm" method="POST" action="/api/drafts" target="_blank"');
        expect(source).not.toContain('This draft is editing an older version of the menu.');
    });

    test('a draft name/template change is confirmed with old and new values before submit', () => {
        expect(source).toContain('metadataChangeConfirmed');
        expect(source).toMatch(/window\.confirm\(`This draft started from/);
    });
});

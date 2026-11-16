// Shared baseline-freshness logic for form.ejs and form-legacy.ejs.
//
// 2026-11-16 incident: the "A newer approved menu exists" dialog decided
// "newer" by property + service period, pointed a chef at a different menu,
// and its focused "Load Newer Menu" button replaced his edited beverage menu
// with a food menu. Rules enforced here:
//   1. "Newer" comes only from the server's menu-identity freshness answer
//      (/api/submissions/baseline-freshness). Property + service period is
//      never an input to "stale".
//   2. In a draft session nothing may replace the editor content or project
//      fields; a stale draft is blocked with a link to the current version.
//   5. Where "load" still exists: name the menu, count the edits that would be
//      discarded and ask twice when there are any, focus Cancel, never style the
//      replacing button as primary, ask once per issue.
(function (global) {
    'use strict';

    function text(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    // Both public id forms of a client baseline record (legacy id + uuid).
    function idForms(record) {
        if (!record) return [];
        if (typeof record === 'string') return text(record) ? [text(record)] : [];
        const values = [record.id, record.legacyId, record.uuid]
            .concat(Array.isArray(record.idAliases) ? record.idAliases : [])
            .concat(Array.isArray(record.baselineIdForms) ? record.baselineIdForms : []);
        return values.map(text).filter(Boolean).filter((v, i, all) => all.indexOf(v) === i);
    }

    function sameSubmission(a, b) {
        const left = idForms(a);
        const right = idForms(b);
        return left.some((id) => right.indexOf(id) !== -1);
    }

    // Same normalization as the server's normalizeReviewLine (lib/changed-lines.ts).
    function normalizeLine(line) {
        return String(line || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[“”"]/g, '"')
            .replace(/[’']/g, "'")
            .trim();
    }

    function lineSet(value) {
        const set = new Set();
        String(value || '').split('\n').forEach((line) => {
            const normalized = normalizeLine(line);
            if (normalized) set.add(normalized);
        });
        return set;
    }

    function countOneWay(fromText, toText) {
        const base = lineSet(fromText);
        let count = 0;
        String(toText || '').split('\n').forEach((line) => {
            const normalized = normalizeLine(line);
            if (normalized && !base.has(normalized)) count += 1;
        });
        return count;
    }

    function countMenuLineChanges(baselineText, currentText) {
        const added = countOneWay(baselineText, currentText);
        const removed = countOneWay(currentText, baselineText);
        return { added, removed, total: added + removed };
    }

    function normalizeDetail(value) {
        if (value === true) return 'yes';
        if (value === false || value === null || value === undefined) return '';
        return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function normalizeFlag(value) {
        const v = normalizeDetail(value);
        return v === 'yes' || v === 'true' ? 'yes' : '';
    }

    // Project details that make a modification a real change. Mirrors
    // listProjectDetailChanges() in lib/submission-workflow.ts. `baseline` is
    // the client baseline shape (projectName, templateType, ...).
    function listDetailChanges(baseline, current) {
        const b = baseline || {};
        const c = current || {};
        const rows = [
            ['project name', b.projectName, c.projectName, 'text'],
            ['template type', b.templateType || 'food', c.templateType, 'text'],
            ['menu type', b.menuType || 'standard', c.menuType || 'standard', 'text'],
            ['service period', b.servicePeriod, c.servicePeriod, 'text'],
            ['orientation', b.orientation, c.orientation, 'text'],
            ['asset type', b.assetType, c.assetType, 'text'],
            ['print width', b.printWidth, c.printWidth, 'text'],
            ['print height', b.printHeight, c.printHeight, 'text'],
            ['print region', b.printRegion, c.printRegion, 'text'],
            ['print size', b.printSize, c.printSize, 'text'],
            ['digital width', b.digitalWidth, c.digitalWidth, 'text'],
            ['digital height', b.digitalHeight, c.digitalHeight, 'text'],
            ['folded', b.folded, c.folded, 'flag'],
            ['crop marks', b.cropMarks, c.cropMarks, 'flag'],
            ['bleed marks', b.bleedMarks, c.bleedMarks, 'flag'],
            ['file size limit', b.fileSizeLimit, c.fileSizeLimit, 'flag'],
            ['file size limit (MB)', b.fileSizeLimitMb, c.fileSizeLimitMb, 'text'],
            ['file delivery notes', b.fileDeliveryNotes, c.fileDeliveryNotes, 'text'],
            ['allergen line', b.allergens, c.allergens, 'text'],
        ];
        return rows
            .filter((r) => (r[3] === 'flag' ? normalizeFlag(r[1]) !== normalizeFlag(r[2]) : normalizeDetail(r[1]) !== normalizeDetail(r[2])))
            .map((r) => r[0]);
    }

    // Item 4 (client side): an edit of an approved database baseline with zero
    // changed lines and no project-detail change is not a submission.
    function isZeroChangeModification(input) {
        const state = input || {};
        if (state.submissionMode !== 'modification') return false;
        if (state.unapprovedMode || state.revisionSource !== 'database') return false;
        if (!state.baseline || !text(state.baselineText)) return false;
        if (countMenuLineChanges(state.baselineText, state.currentText).total > 0) return false;
        return listDetailChanges(state.baseline, state.details).length === 0;
    }

    function normalizeKey(value) {
        return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    // Decide the freshness issue for the current form state.
    //   state.freshness       server answer for the selected baseline (menu identity)
    //   state.existingMenus   approved menus for the form's property + service (new mode only)
    function classifyIssue(state) {
        const s = state || {};
        if (s.unapprovedMode || s.revisionSource === 'uploaded_unapproved') return null;
        if (s.submissionMode === 'modification') {
            const selected = s.selected;
            if (!selected || !text(s.selectedId)) return null;
            const property = text(s.property);
            const servicePeriod = text(s.servicePeriod);
            if (property && servicePeriod && (normalizeKey(selected.property) !== normalizeKey(property)
                || normalizeKey(selected.servicePeriod) !== normalizeKey(servicePeriod))) {
                return { type: 'mismatch', property, servicePeriod, selected };
            }
            const freshness = s.freshness;
            if (freshness && freshness.stale === true && freshness.newerVersion
                && !sameSubmission(freshness.newerVersion, selected)) {
                return { type: 'stale', selected, latest: freshness.newerVersion, basis: freshness.basis || '' };
            }
            return null;
        }
        const candidates = Array.isArray(s.existingMenus) ? s.existingMenus.filter(Boolean) : [];
        if (!candidates.length) return null;
        return { type: 'existing', property: text(s.property), servicePeriod: text(s.servicePeriod), candidates };
    }

    function issueKey(issue) {
        if (!issue) return '';
        const ids = issue.type === 'existing'
            ? (issue.candidates || []).map((c) => idForms(c)[0] || '').sort().join(',')
            : (idForms(issue.latest)[0] || '');
        return [issue.type, normalizeKey(issue.property), normalizeKey(issue.servicePeriod), idForms(issue.selected)[0] || '', ids].join('|');
    }

    function formatDate(value) {
        const parsed = Date.parse(text(value));
        if (Number.isNaN(parsed)) return 'an unknown date';
        return new Date(parsed).toLocaleDateString();
    }

    function menuName(record) {
        return text(record && (record.projectName || record.filename)) || 'Untitled menu';
    }

    function pluralLines(count) {
        return `${count} edited line${count === 1 ? '' : 's'}`;
    }

    // Copy + available actions for an issue. No action that replaces content
    // is ever offered in a draft session.
    function buildDialogModel(issue, options) {
        const opts = options || {};
        const inDraft = !!opts.inDraft;
        const edited = Math.max(0, Number(opts.editedLineCount) || 0);
        const discardNote = edited > 0
            ? ` Loading it will discard ${pluralLines(edited)} in your editor.`
            : '';
        if (!issue) return null;

        if (issue.type === 'stale') {
            const latest = issue.latest || {};
            if (inDraft) {
                return {
                    title: 'A newer version of this menu was approved',
                    message: `"${menuName(latest)}" was approved on ${formatDate(latest.reviewedAt || latest.updatedAt)}, after this draft started. This draft can no longer be checked or submitted.`,
                    detail: 'Your draft and its saved text are untouched. Open the current version in a new tab and copy what you need from this draft.',
                    candidates: [],
                    loadLabel: null,
                    continueLabel: null,
                    cancelLabel: 'Close',
                    openCurrentId: idForms(latest)[0] || '',
                    blocking: true,
                };
            }
            return {
                title: `Replace your menu with "${menuName(latest)}"?`,
                message: `A newer approved version of this same menu exists: "${menuName(latest)}", approved ${formatDate(latest.reviewedAt || latest.updatedAt)}.${discardNote}`,
                detail: `Your baseline: ${menuName(issue.selected)}.`,
                candidates: [{ record: latest, label: `Replace with "${menuName(latest)}"` }],
                loadLabel: `Replace with "${menuName(latest)}"`,
                continueLabel: 'Keep my baseline',
                cancelLabel: 'Cancel',
                openCurrentId: '',
                blocking: false,
            };
        }

        if (issue.type === 'mismatch') {
            return {
                title: 'This baseline does not match the form',
                message: `The loaded baseline "${menuName(issue.selected)}" is for ${text(issue.selected && issue.selected.property) || 'another property'} / ${text(issue.selected && issue.selected.servicePeriod) || 'another service'}, but the form is set to ${issue.property} / ${issue.servicePeriod}.`,
                detail: inDraft
                    ? 'Set the restaurant and service period back to match this draft.'
                    : 'Set the restaurant and service period back, or search for the right approved menu.',
                candidates: [],
                loadLabel: null,
                continueLabel: inDraft ? null : 'Keep current baseline',
                cancelLabel: 'Cancel',
                openCurrentId: '',
                blocking: inDraft,
            };
        }

        // existing (brand-new mode)
        const candidates = (issue.candidates || []).map((record) => ({
            record,
            label: `Replace with "${menuName(record)}"`,
        }));
        const single = candidates.length === 1 ? candidates[0].record : null;
        return {
            title: single
                ? `Replace your menu with "${menuName(single)}"?`
                : `${candidates.length} approved menus already exist for ${issue.servicePeriod}`,
            message: single
                ? `An approved menu named "${menuName(single)}" already exists for ${issue.property} / ${issue.servicePeriod}. If this is a revision of it, start from that menu.${discardNote}`
                : `${issue.property} has ${candidates.length} different approved menus for ${issue.servicePeriod}. If this is a revision of one of them, choose it by name.${discardNote}`,
            detail: single ? '' : 'Choose a menu below, or continue as a brand-new menu.',
            candidates,
            loadLabel: single ? candidates[0].label : null,
            continueLabel: 'Continue as brand new',
            cancelLabel: 'Cancel',
            openCurrentId: '',
            blocking: false,
        };
    }

    // Dialog controller. `elements` are DOM nodes (or test doubles exposing
    // textContent, hidden, onclick, focus, classList, appendChild).
    function createFreshnessDialog(config) {
        const cfg = config || {};
        const el = cfg.elements || {};
        const doc = cfg.document || global.document;
        const keptKeys = new Set();
        let state = null;

        // `.btn { display: ... }` beats the bare `hidden` attribute, so also
        // set an inline display.
        function setVisible(node, visible) {
            if (!node) return;
            node.hidden = !visible;
            if (node.style) node.style.display = visible ? '' : 'none';
        }

        function setButton(button, label, onClick) {
            if (!button) return;
            if (!label) {
                setVisible(button, false);
                button.onclick = null;
                return;
            }
            setVisible(button, true);
            button.textContent = label;
            button.onclick = onClick;
        }

        function close(result) {
            if (el.modal && el.modal.classList) el.modal.classList.remove('show');
            const current = state;
            state = null;
            if (current) current.resolve(result);
        }

        function renderCandidateList(model, onPick) {
            if (!el.list) return;
            el.list.innerHTML = '';
            setVisible(el.list, false);
            if (model.candidates.length <= 1 || !doc || typeof doc.createElement !== 'function') return;
            setVisible(el.list, true);
            model.candidates.forEach((candidate) => {
                const button = doc.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-quiet baseline-freshness-candidate';
                button.textContent = candidate.label;
                button.onclick = () => onPick(candidate.record);
                el.list.appendChild(button);
            });
        }

        function confirmDiscard(record, edited, model) {
            // Second, explicit confirmation before discarding edits.
            if (el.title) el.title.textContent = `Discard ${pluralLines(edited)}?`;
            if (el.message) el.message.textContent = `Replacing your menu with "${menuName(record)}" throws away ${pluralLines(edited)}. This cannot be undone.`;
            if (el.detail) el.detail.textContent = '';
            if (el.list) { el.list.innerHTML = ''; setVisible(el.list, false); }
            setButton(el.continueBtn, null);
            setButton(el.loadBtn, `Yes, discard my edits and load "${menuName(record)}"`, () => finishLoad(record));
            setButton(el.cancelBtn, 'Cancel', () => close(false));
            if (el.cancelBtn && typeof el.cancelBtn.focus === 'function') el.cancelBtn.focus();
            if (state) state.confirming = true;
            return model;
        }

        function finishLoad(record) {
            close(false);
            if (typeof cfg.onLoad === 'function') cfg.onLoad(record);
        }

        function ask(issue, options) {
            const opts = options || {};
            if (!issue) return Promise.resolve(true);
            const key = issueKey(issue);
            const model = buildDialogModel(issue, opts);
            if (!model) return Promise.resolve(true);
            // Ask once: a "keep" answer for the same issue is honored later
            // (including at submit). Blocking issues are never remembered.
            if (!model.blocking && keptKeys.has(key)) return Promise.resolve(true);
            if (state && state.key === key) return state.promise;
            if (state) close(false);
            if (!el.modal || !el.title || !el.message || !el.cancelBtn) return Promise.resolve(!model.blocking);

            let resolve;
            const promise = new Promise((r) => { resolve = r; });
            state = { key, resolve, promise, confirming: false };

            el.title.textContent = model.title;
            el.message.textContent = model.message;
            if (el.detail) el.detail.textContent = model.detail;

            const edited = Math.max(0, Number(opts.editedLineCount) || 0);
            const pick = (record) => {
                if (opts.inDraft) return; // never replace content in a draft
                if (edited > 0) return confirmDiscard(record, edited, model);
                return finishLoad(record);
            };
            renderCandidateList(model, pick);
            setButton(el.loadBtn, model.loadLabel, () => pick(model.candidates[0] && model.candidates[0].record));
            if (el.loadBtn && el.loadBtn.classList) {
                el.loadBtn.classList.remove('btn-primary');
                el.loadBtn.classList.add('btn-quiet');
            }
            setButton(el.continueBtn, model.continueLabel, () => {
                keptKeys.add(key);
                if (typeof cfg.onKeep === 'function') cfg.onKeep(issue);
                close(true);
            });
            setButton(el.cancelBtn, model.cancelLabel || 'Cancel', () => close(false));

            if (el.openCurrentForm) {
                setVisible(el.openCurrentForm, !!model.openCurrentId);
                if (el.openCurrentInput) el.openCurrentInput.value = model.openCurrentId || '';
            }

            if (el.modal.classList) el.modal.classList.add('show');
            const focusTarget = el.cancelBtn;
            const doFocus = () => { if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus(); };
            if (typeof cfg.defer === 'function') cfg.defer(doFocus); else doFocus();
            return promise;
        }

        return {
            ask,
            close,
            isOpen: () => !!state,
            hasKept: (issue) => keptKeys.has(issueKey(issue)),
            forget: () => keptKeys.clear(),
        };
    }

    // Item 2 guard: in a draft session, the baseline id is pinned to the
    // draft's base. Returns true when `nextId` may be applied.
    function createDraftBaselineLock(draftBase) {
        const pinned = idForms(draftBase);
        return {
            active: pinned.length > 0,
            allows(next) {
                if (!pinned.length) return true;
                return idForms(next).some((id) => pinned.indexOf(id) !== -1);
            },
            pinnedId: pinned[0] || '',
        };
    }

    // Item 6: synchronous in-flight guard for the submit button. `begin()`
    // must be called before any await; it disables the button immediately.
    function createSubmitGuard(getButton) {
        let inFlight = false;
        let wasDisabled = false;
        return {
            begin() {
                if (inFlight) return false;
                inFlight = true;
                const button = typeof getButton === 'function' ? getButton() : null;
                wasDisabled = !!(button && button.disabled);
                if (button) button.disabled = true;
                return true;
            },
            // Failure or cancel: restore the button to how it was at click.
            end() {
                inFlight = false;
                const button = typeof getButton === 'function' ? getButton() : null;
                if (button) button.disabled = wasDisabled;
            },
            // Success path: keep the flag clear but let the caller decide on the button.
            release() { inFlight = false; },
            isInFlight: () => inFlight,
        };
    }

    global.MenuBaselineFreshness = Object.freeze({
        idForms,
        sameSubmission,
        normalizeLine,
        countMenuLineChanges,
        listDetailChanges,
        isZeroChangeModification,
        classifyIssue,
        issueKey,
        buildDialogModel,
        createFreshnessDialog,
        createDraftBaselineLock,
        createSubmitGuard,
    });
})(typeof window !== 'undefined' ? window : globalThis);

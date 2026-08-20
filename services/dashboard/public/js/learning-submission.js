(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.MenuLearningSubmission = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function createLearningSubmissionController(options) {
        const doc = options.document;
        const storage = options.storage;
        const fetchImpl = options.fetch;
        const dishes = Array.isArray(options.dishCorrections) ? options.dishCorrections : [];
        const context = options.submissionContext || {};
        const savedCorrectionIds = new Set(options.savedCorrectionIds || []);
        const savedIndexes = new Set();
        const storageKey = `menumanager.learningExplanationDraft.v1:${context.submissionId || 'unknown'}`;

        function element(id) {
            return doc.getElementById(id);
        }

        function setStatus(idx, message, kind) {
            const status = element(`save-status-${idx}`);
            if (!status) return;
            status.textContent = message;
            status.className = `save-status${kind ? ` ${kind}` : ''}`;
        }

        function setBulkStatus(message, kind) {
            const status = element('bulk-save-status');
            if (!status) return;
            status.textContent = message;
            status.className = `save-status${kind ? ` ${kind}` : ''}`;
        }

        function readStoredDraft() {
            if (!storage) return { reviewerName: '', entries: {} };
            try {
                const parsed = JSON.parse(storage.getItem(storageKey) || '{}');
                return {
                    reviewerName: `${parsed.reviewerName || ''}`,
                    entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
                };
            } catch (_error) {
                return { reviewerName: '', entries: {} };
            }
        }

        function selectedValues(select) {
            return Array.from(select && select.selectedOptions ? select.selectedOptions : []).map((option) => option.value);
        }

        function readEntry(idx) {
            return {
                rule: `${element(`rule-${idx}`)?.value || ''}`,
                menuScope: `${element(`menu-scope-${idx}`)?.value || 'all'}`,
                changeType: `${element(`change-type-${idx}`)?.value || ''}`,
                isLocationSpecific: !!element(`loc-specific-${idx}`)?.checked,
                location: `${element(`location-${idx}`)?.value || ''}`,
                otherLocations: selectedValues(element(`shared-${idx}`)),
            };
        }

        function writeEntry(idx, entry) {
            if (!entry || savedIndexes.has(idx)) return;
            const rule = element(`rule-${idx}`);
            const menuScope = element(`menu-scope-${idx}`);
            const changeType = element(`change-type-${idx}`);
            const locationSpecific = element(`loc-specific-${idx}`);
            const location = element(`location-${idx}`);
            const shared = element(`shared-${idx}`);
            if (rule) rule.value = entry.rule || '';
            if (menuScope) menuScope.value = entry.menuScope || 'all';
            if (changeType) changeType.value = entry.changeType || '';
            if (locationSpecific) locationSpecific.checked = !!entry.isLocationSpecific;
            if (location) location.value = entry.location || '';
            if (shared && shared.options) {
                const selected = new Set(entry.otherLocations || []);
                Array.from(shared.options).forEach((option) => { option.selected = selected.has(option.value); });
            }
            const locationFields = element(`loc-fields-${idx}`);
            if (locationFields) locationFields.classList.toggle('open', !!entry.isLocationSpecific);
        }

        function persistDraft() {
            if (!storage) return;
            const draft = {
                reviewerName: `${element('bulk-reviewer-name')?.value || ''}`,
                entries: {},
            };
            dishes.forEach((_dish, idx) => {
                if (!savedIndexes.has(idx)) draft.entries[idx] = readEntry(idx);
            });
            try {
                storage.setItem(storageKey, JSON.stringify(draft));
            } catch (_error) {
                // Draft protection is best-effort when browser storage is unavailable.
            }
        }

        function restoreDraft() {
            const draft = readStoredDraft();
            const reviewer = element('bulk-reviewer-name');
            if (reviewer && !reviewer.value) reviewer.value = draft.reviewerName || '';
            Object.keys(draft.entries).forEach((idx) => writeEntry(Number(idx), draft.entries[idx]));
        }

        function removeDraftEntry(idx) {
            if (!storage) return;
            const draft = readStoredDraft();
            delete draft.entries[idx];
            try {
                storage.setItem(storageKey, JSON.stringify(draft));
            } catch (_error) {
                // Best-effort cleanup only.
            }
        }

        function markSaved(idx, label) {
            savedIndexes.add(idx);
            const button = doc.querySelector(`.save-rule-btn[data-dish-index="${idx}"]`);
            if (button) {
                button.disabled = true;
                button.textContent = label || 'Explanation Saved';
            }
            removeDraftEntry(idx);
        }

        function buildPayload(idx, reviewerName) {
            const dish = dishes[idx];
            const entry = readEntry(idx);
            return {
                submission_id: context.submissionId,
                correction_id: dish?.correction_id,
                original_text: dish?.before_line,
                corrected_text: dish?.after_line,
                change_type: entry.changeType.trim() || null,
                rule: entry.rule.trim(),
                applies_to_menu_type: entry.menuScope.trim() || 'all',
                is_location_specific: entry.isLocationSpecific,
                project_name: context.projectName,
                restaurant_name: context.restaurantName,
                location: entry.isLocationSpecific ? entry.location.trim() : '',
                other_applicable_locations: entry.isLocationSpecific ? entry.otherLocations : [],
                reviewer_name: reviewerName,
            };
        }

        async function saveDishRule(idx, settings) {
            const opts = settings || {};
            const reviewerName = `${element('bulk-reviewer-name')?.value || ''}`.trim();
            const dish = dishes[idx];
            const rule = `${element(`rule-${idx}`)?.value || ''}`.trim();

            // Snapshot every unfinished card before any validation or request. A missing
            // name or a later network error must never cost text entered elsewhere.
            persistDraft();

            if (!dish) {
                setStatus(idx, 'Correction details are missing.', 'err');
                return false;
            }
            if (!rule) {
                setStatus(idx, 'Explanation is required.', 'err');
                return false;
            }
            if (!reviewerName) {
                setStatus(idx, 'Enter the reviewer name in the Save All section below.', 'err');
                element('bulk-reviewer-name')?.focus();
                return false;
            }

            setStatus(idx, 'Saving...', '');
            try {
                const response = await fetchImpl('/api/learning/correction-rules', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildPayload(idx, reviewerName)),
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to save explanation');
                setStatus(idx, 'Saved.', 'ok');
                markSaved(idx);
                return true;
            } catch (error) {
                setStatus(idx, error.message || 'Save failed.', 'err');
                if (!opts.bulk) setBulkStatus('Nothing else on this page was cleared. Your draft is still saved.', 'err');
                return false;
            }
        }

        async function saveAll() {
            const reviewerName = `${element('bulk-reviewer-name')?.value || ''}`.trim();
            const candidates = dishes
                .map((_dish, idx) => idx)
                .filter((idx) => !savedIndexes.has(idx) && `${element(`rule-${idx}`)?.value || ''}`.trim());

            if (!reviewerName) {
                setBulkStatus('Reviewer name is required.', 'err');
                element('bulk-reviewer-name')?.focus();
                return { saved: 0, failed: 0 };
            }
            if (!candidates.length) {
                setBulkStatus('Add at least one explanation above before saving.', 'err');
                return { saved: 0, failed: 0 };
            }

            persistDraft();
            const button = element('save-all-explanations');
            if (button) {
                button.disabled = true;
                button.textContent = 'Saving...';
            }
            setBulkStatus(`Saving ${candidates.length} explanation${candidates.length === 1 ? '' : 's'}...`, '');

            let saved = 0;
            let failed = 0;
            for (const idx of candidates) {
                if (await saveDishRule(idx, { bulk: true })) saved += 1;
                else failed += 1;
            }

            if (button) {
                button.disabled = false;
                button.textContent = 'Save All Explanations';
            }
            if (failed) {
                setBulkStatus(`${saved} saved; ${failed} failed. Failed and unfinished drafts remain on this page.`, 'err');
            } else {
                setBulkStatus(`${saved} explanation${saved === 1 ? '' : 's'} saved.`, 'ok');
            }
            return { saved, failed };
        }

        function init() {
            dishes.forEach((dish, idx) => {
                if (savedCorrectionIds.has(dish?.correction_id)) {
                    savedIndexes.add(idx);
                    markSaved(idx, 'Already Saved');
                }
            });
            restoreDraft();

            doc.querySelectorAll('.save-rule-btn').forEach((button) => {
                const idx = Number(button.getAttribute('data-dish-index'));
                button.addEventListener('click', () => saveDishRule(idx));
            });
            element('save-all-explanations')?.addEventListener('click', saveAll);

            const tracked = ['input', 'change'];
            dishes.forEach((_dish, idx) => {
                [`rule-${idx}`, `menu-scope-${idx}`, `change-type-${idx}`, `loc-specific-${idx}`, `location-${idx}`, `shared-${idx}`]
                    .forEach((id) => tracked.forEach((eventName) => element(id)?.addEventListener(eventName, persistDraft)));
            });
            tracked.forEach((eventName) => element('bulk-reviewer-name')?.addEventListener(eventName, persistDraft));
        }

        return { init, persistDraft, restoreDraft, saveDishRule, saveAll, buildPayload };
    }

    return { createLearningSubmissionController };
});

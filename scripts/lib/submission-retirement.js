'use strict';

/**
 * Pure planning for scripts/retire-submission.js (no I/O).
 *
 * Retiring a submission (status -> 'deleted') must move its menu's
 * current_submission_id back in the same run. Otherwise the pointer is left on
 * a deleted row: the menu drops out of /menus/design-eligible and
 * POST /draft-sessions returns 409 for it (2026-11-16 Strand cleanup).
 */

const APPROVED_STATUSES = ['approved', 'approved_override'];
const BASELINE_SOURCES = ['', 'form', 'clickup_history_import'];

function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function idForms(row) {
    return [row && row.legacy_id, row && row.id].map(text).filter(Boolean).filter((v, i, all) => all.indexOf(v) === i);
}

function publicId(row) {
    return text(row && (row.legacy_id || row.id));
}

function approvedTimestamp(row) {
    for (const value of [row && row.reviewed_at, row && row.approved_text_extracted_at, row && row.updated_at, row && row.created_at]) {
        const parsed = Date.parse(text(value));
        if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
}

function isApprovedBaseline(row) {
    return APPROVED_STATUSES.includes(text(row && row.status).toLowerCase())
        && BASELINE_SOURCES.includes(text(row && row.source));
}

/**
 * @param {object} input
 * @param {object} input.submission  row to retire
 * @param {object|null} input.menu   its menu row (when submission.menu_id is set)
 * @param {object[]} input.menuVersions  all submissions with the same menu_id
 * @param {string} [input.now]
 * @returns {{ submissionUpdate: object|null, menuUpdate: object|null, notes: string[] }}
 */
function planRetirement({ submission, menu = null, menuVersions = [], now = new Date().toISOString() }) {
    if (!submission) throw new Error('planRetirement: submission is required');
    const notes = [];
    const targetIds = idForms(submission);
    const currentStatus = text(submission.status).toLowerCase();

    const submissionUpdate = currentStatus === 'deleted'
        ? null
        : { status: 'deleted', updated_at: now, expectedStatus: currentStatus };
    if (!submissionUpdate) notes.push(`${publicId(submission)} is already deleted; only the menu pointer is checked.`);

    let menuUpdate = null;
    if (menu) {
        const pointer = text(menu.current_submission_id);
        if (pointer && targetIds.includes(pointer)) {
            const replacement = menuVersions
                .filter((row) => !idForms(row).some((id) => targetIds.includes(id)))
                .filter(isApprovedBaseline)
                .sort((a, b) => approvedTimestamp(b) - approvedTimestamp(a))[0] || null;
            menuUpdate = {
                menuId: menu.id,
                expectedPointer: pointer,
                current_submission_id: replacement ? publicId(replacement) : null,
                updated_at: now,
            };
            notes.push(replacement
                ? `Menu "${menu.name}" pointer moves back from ${pointer} to ${publicId(replacement)} (${replacement.project_name || 'untitled'}, approved ${text(replacement.reviewed_at) || 'unknown'}).`
                : `Menu "${menu.name}" has no other approved version; its pointer is cleared.`);
        } else {
            notes.push(`Menu "${menu.name}" pointer (${pointer || 'none'}) does not reference this submission; unchanged.`);
        }
    } else if (text(submission.menu_id)) {
        notes.push(`Submission links to menu ${submission.menu_id}, which was not found; no pointer change.`);
    } else {
        notes.push('Submission is not linked to a menu; no pointer change.');
    }

    return { submissionUpdate, menuUpdate, notes };
}

module.exports = { planRetirement, idForms, publicId, isApprovedBaseline };

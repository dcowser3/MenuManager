"use strict";
// Pure grouping algorithm for the one-time menu backfill (Phase 1).
//
// Given the full set of approved submissions, decide which submissions are
// versions of the same menu. The rules (spec §1.3), applied oldest-first:
//   1. Lineage chains (revision_base_submission_id) group deterministically.
//   2. Lineage-unknown submissions text-match against already-grouped menus
//      (same property, narrowed by service period when set).
//   3. Remaining submissions group by exact property + service + name equality.
//   4. Anything matching >1 group is ambiguous → review sheet, never auto-linked
//      (invariant 2).
//   5. Everything still unmatched becomes its own single-version menu.
//
// Kept side-effect free so it can be unit-tested on fixtures and reused by the
// backfill script for both the Supabase and JSON-fallback stores.
Object.defineProperty(exports, "__esModule", { value: true });
exports.approvedTimestamp = approvedTimestamp;
exports.isNearExactMatch = isNearExactMatch;
exports.planMenuBackfill = planMenuBackfill;
const NEAR_EXACT_THRESHOLD = 0.95;
function publicId(submission) {
    return `${submission.legacy_id || submission.id || ''}`.trim();
}
function normalizeLookup(value) {
    return `${value || ''}`.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}
function servicePeriodOf(submission) {
    return `${submission.service_period || submission.raw_payload?.servicePeriod || ''}`.trim();
}
function approvedTimestamp(submission) {
    const candidates = [
        submission.reviewed_at,
        submission.approved_text_extracted_at,
        submission.updated_at,
        submission.created_at,
    ];
    for (const value of candidates) {
        const parsed = Date.parse(`${value || ''}`);
        if (!Number.isNaN(parsed))
            return parsed;
    }
    return 0;
}
function matchLines(value) {
    return new Set(`${value || ''}`
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean));
}
// Same near-exact heuristic used for doc-upload baseline matching in the db
// service (isNearExactBaselineMatch): symmetric ≥95% line overlap.
function isNearExactMatch(a, b) {
    const aLines = matchLines(a);
    const bLines = matchLines(b);
    if (!aLines.size || !bLines.size)
        return false;
    const intersection = [...aLines].filter((line) => bLines.has(line)).length;
    return intersection / aLines.size >= NEAR_EXACT_THRESHOLD && intersection / bLines.size >= NEAR_EXACT_THRESHOLD;
}
function currentOf(group) {
    let current = null;
    let best = -Infinity;
    for (const id of group.memberIds) {
        const submission = group.byId.get(id);
        const ts = approvedTimestamp(submission);
        if (ts >= best) {
            best = ts;
            current = submission;
        }
    }
    return current;
}
function nameKey(submission) {
    return normalizeLookup(submission.project_name);
}
/**
 * Plan the backfill. `submissions` may include non-approved rows; the caller is
 * responsible for filtering to approved baseline sources — this function groups
 * whatever it is handed, oldest-first.
 */
function planMenuBackfill(submissions) {
    const byId = new Map();
    for (const submission of submissions) {
        const id = publicId(submission);
        if (id)
            byId.set(id, submission);
    }
    const ordered = [...byId.values()].sort((a, b) => approvedTimestamp(a) - approvedTimestamp(b));
    // --- Step 1: lineage chains via union-find over revision_base links -------
    const parent = new Map();
    for (const id of byId.keys())
        parent.set(id, id);
    const find = (x) => {
        let root = x;
        while (parent.get(root) !== root)
            root = parent.get(root);
        let node = x;
        while (parent.get(node) !== root) {
            const next = parent.get(node);
            parent.set(node, root);
            node = next;
        }
        return root;
    };
    const union = (a, b) => { parent.set(find(a), find(b)); };
    for (const submission of ordered) {
        const base = `${submission.revision_base_submission_id || ''}`.trim();
        if (base && byId.has(base))
            union(publicId(submission), base);
    }
    const groups = new Map();
    const groupOf = new Map(); // submissionId -> group root
    for (const submission of ordered) {
        const id = publicId(submission);
        const root = find(id);
        if (!groups.has(root))
            groups.set(root, { memberIds: [], byId: new Map() });
        const group = groups.get(root);
        group.memberIds.push(id);
        group.byId.set(id, submission);
        groupOf.set(id, root);
    }
    // Submissions whose lineage is unknown = they landed in a singleton group.
    const lineageSingletons = new Set();
    for (const [root, group] of groups) {
        if (group.memberIds.length === 1)
            lineageSingletons.add(root);
    }
    const ambiguous = [];
    const dropped = new Set(); // ambiguous singleton roots removed from menu output
    const mergeInto = (targetRoot, singletonRoot) => {
        const target = groups.get(targetRoot);
        const singleton = groups.get(singletonRoot);
        for (const id of singleton.memberIds) {
            target.memberIds.push(id);
            target.byId.set(id, singleton.byId.get(id));
            groupOf.set(id, targetRoot);
        }
        groups.delete(singletonRoot);
    };
    // --- Step 2: text-match lineage-unknown singletons to existing groups -----
    // Process oldest-first so earlier groups are available as match targets.
    for (const submission of ordered) {
        const id = publicId(submission);
        const root = groupOf.get(id);
        if (!lineageSingletons.has(root) || dropped.has(root))
            continue;
        const propertyKey = normalizeLookup(submission.property);
        const serviceKey = normalizeLookup(servicePeriodOf(submission));
        const candidates = [];
        for (const [otherRoot, group] of groups) {
            if (otherRoot === root)
                continue;
            const current = currentOf(group);
            if (normalizeLookup(current.property) !== propertyKey)
                continue;
            if (serviceKey && normalizeLookup(servicePeriodOf(current)) !== serviceKey)
                continue;
            if (isNearExactMatch(submission.approved_menu_content, current.approved_menu_content)) {
                candidates.push(otherRoot);
            }
        }
        if (candidates.length === 1) {
            mergeInto(candidates[0], root);
            lineageSingletons.delete(root);
        }
        else if (candidates.length > 1) {
            ambiguous.push({
                submissionId: id,
                property: `${submission.property || ''}`,
                servicePeriod: servicePeriodOf(submission),
                name: `${submission.project_name || ''}`,
                reason: 'text-match-multiple',
                candidateCurrentIds: candidates.map((r) => publicId(currentOf(groups.get(r)))),
            });
            dropped.add(root);
            lineageSingletons.delete(root);
        }
    }
    // --- Step 3: exact property + service + name equality --------------------
    // Group remaining singletons by the tuple; join a single existing group,
    // flag when >1 existing group shares the tuple, else form a fresh menu.
    for (const submission of ordered) {
        const id = publicId(submission);
        const root = groupOf.get(id);
        if (!lineageSingletons.has(root) || dropped.has(root))
            continue;
        const propertyKey = normalizeLookup(submission.property);
        const serviceKey = normalizeLookup(servicePeriodOf(submission));
        const key = nameKey(submission);
        const candidates = [];
        for (const [otherRoot, group] of groups) {
            if (otherRoot === root)
                continue;
            const current = currentOf(group);
            if (normalizeLookup(current.property) !== propertyKey)
                continue;
            if (normalizeLookup(servicePeriodOf(current)) !== serviceKey)
                continue;
            if (nameKey(current) !== key)
                continue;
            candidates.push(otherRoot);
        }
        if (candidates.length === 1) {
            mergeInto(candidates[0], root);
            lineageSingletons.delete(root);
        }
        else if (candidates.length > 1) {
            ambiguous.push({
                submissionId: id,
                property: `${submission.property || ''}`,
                servicePeriod: servicePeriodOf(submission),
                name: `${submission.project_name || ''}`,
                reason: 'name-match-multiple',
                candidateCurrentIds: candidates.map((r) => publicId(currentOf(groups.get(r)))),
            });
            dropped.add(root);
            lineageSingletons.delete(root);
        }
        // candidates.length === 0 → stays a fresh single-version menu (step 5).
    }
    // --- Emit menus (skip ambiguous singletons) ------------------------------
    const menus = [];
    for (const [root, group] of groups) {
        if (dropped.has(root))
            continue;
        const orderedMembers = [...group.memberIds].sort((a, b) => approvedTimestamp(group.byId.get(a)) - approvedTimestamp(group.byId.get(b)));
        const current = currentOf(group);
        menus.push({
            property: `${current.property || ''}`,
            servicePeriod: servicePeriodOf(current),
            name: `${current.project_name || ''}`,
            memberIds: orderedMembers,
            currentSubmissionId: publicId(current),
        });
    }
    return { menus, ambiguous };
}

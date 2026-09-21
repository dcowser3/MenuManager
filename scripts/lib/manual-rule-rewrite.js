'use strict';

const crypto = require('crypto');
const fsp = require('fs/promises');
const fs = require('fs');

const OLD_IDS = Object.freeze([
    'ce9e56a4-12c4-46aa-a12e-606df66b6b43',
    '3f338cf9-483e-4d66-afde-d9c46fb285b2',
    'fc08d1d2-2145-4cf8-b44b-55ea830d6e07',
]);
const NEW_ID = 'manual-rule-walnut-pistou-herb-singularization';
const NEW_SUBMISSION_ID = 'manual-submission-walnut-pistou-herb-singularization';
const NEW_ROW_ID = '9aa748ca-1d8f-4bed-9cc3-84ed25e48693';
const RULE = "Singularize ‘walnuts’ and ‘pistou herbs’ to ‘walnut’ and ‘pistou herb’ in ingredient lists.";
const DIGEST = /^[a-f0-9]{64}$/;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
let productionBehaviorHash;
try { productionBehaviorHash = require('../../services/dashboard/dist/lib/learning-behavior-tests').hashBehaviorArtifact; } catch { /* source-only checkout */ }
const behaviorHash = (value) => (productionBehaviorHash || ((input) => hash(canonical(input))))(value);
let verificationFingerprint;
try { verificationFingerprint = require('../../services/dashboard/dist/lib/code-proposal-verification').codeProposalVerificationFingerprint; } catch { /* source-only checkout */ }

function stripOldMembership(value) {
    if (Array.isArray(value)) return value.filter((row) => !OLD_IDS.includes(row?.correction_id) && !OLD_IDS.includes(row?.correctionId)).map(stripOldMembership);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
        if ((key === 'correction_id' || key === 'correctionId') && OLD_IDS.includes(child)) return undefined;
        const next = stripOldMembership(child);
        if (next !== undefined) output[key] = next;
    }
    return output;
}

function refreshBehaviorCounts(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(refreshBehaviorCounts);
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = refreshBehaviorCounts(child);
    for (const [plural, child] of Object.entries(out)) {
        if (Array.isArray(child) && ['records', 'tests', 'contextualTests'].includes(plural)) {
            out[`${plural}_count`] = child.length;
            out[`${plural.replace(/s$/, '')}_count`] = child.length;
        }
    }
    return out;
}

function removeTargetRows(rows) {
    return Array.isArray(rows) ? rows.filter((row) => !OLD_IDS.includes(row?.correction_id) && !OLD_IDS.includes(row?.correctionId)) : rows;
}

function patchKnownProposalFields(proposal) {
    const next = { ...proposal };
    for (const field of ['correction_routing', 'replay_evidence', 'coverage_claims', 'code_recommendations']) {
        if (Array.isArray(next[field])) next[field] = removeTargetRows(next[field]);
    }
    const behavior = next.eval_summary?.behavior_tests;
    if (behavior && typeof behavior === 'object') {
        const patchedBehavior = { ...behavior };
        for (const field of ['records', 'tests', 'contextualTests']) if (Array.isArray(patchedBehavior[field])) patchedBehavior[field] = removeTargetRows(patchedBehavior[field]);
        const provenance = patchedBehavior.provenanceBackfill;
        if (provenance && typeof provenance === 'object') {
            const patchedProvenance = { ...provenance };
            if (Array.isArray(patchedProvenance.sourceCorrectionIds)) patchedProvenance.sourceCorrectionIds = patchedProvenance.sourceCorrectionIds.filter((id) => !OLD_IDS.includes(id));
            const backfill = patchedProvenance.caseBindingBackfill;
            if (backfill && typeof backfill === 'object') patchedProvenance.caseBindingBackfill = {
                ...backfill,
                unresolved: removeTargetRows(backfill.unresolved),
                bindings: removeTargetRows(backfill.bindings),
            };
            patchedBehavior.provenanceBackfill = patchedProvenance;
        }
        next.eval_summary = { ...next.eval_summary, behavior_tests: refreshBehaviorCounts(patchedBehavior) };
    }
    if (Array.isArray(next.eval_summary?.candidate_rule_activations)) next.eval_summary = {
        ...next.eval_summary,
        candidate_rule_activations: next.eval_summary.candidate_rule_activations.map((entry) => ({
            ...entry,
            correction_ids: Array.isArray(entry?.correction_ids) ? entry.correction_ids.filter((id) => !OLD_IDS.includes(id)) : entry?.correction_ids,
        })).filter((entry) => !Array.isArray(entry.correction_ids) || entry.correction_ids.length),
    };
    return clearDerivedVerification(next);
}

function assertNoOldIds(value) {
    if (OLD_IDS.some((id) => JSON.stringify(value).includes(id))) throw new Error('Rewrite proposal still contains a target correction ID.');
}

function buildNewManualRule(oldRow, reviewerName = 'Derian', buildCorrectionRuleRecord) {
    const payload = {
        correction_id: NEW_ID, submission_id: NEW_SUBMISSION_ID, original_text: null, corrected_text: null,
        example_original: null, example_corrected: null, source_binding: null, rule: RULE,
        applies_to_menu_type: 'all', is_location_specific: false, location: 'All properties (global rule)',
        other_applicable_locations: [], reviewer_name: reviewerName, source: 'human', status: 'pending',
    };
    if (typeof buildCorrectionRuleRecord === 'function') {
        const built = buildCorrectionRuleRecord(payload, []);
        return { ...built, id: NEW_ROW_ID, correction_id: NEW_ID, submission_id: NEW_SUBMISSION_ID, source: 'human', status: 'pending', source_binding: null };
    }
    return {
        id: NEW_ROW_ID, correction_id: NEW_ID, submission_id: NEW_SUBMISSION_ID,
        original_text: null, corrected_text: null, example_original: null, example_corrected: null,
        force_target_case: false, change_type: null, project_name: null, restaurant_name: '',
        source_binding: null, rule: RULE, applies_to_menu_type: 'all', is_location_specific: false,
        location: 'All properties (global rule)', other_applicable_locations: [], reviewer_name: reviewerName,
        source: 'human', status: 'pending', prompt_cycle_id: null, consumed_at: null,
    };
}

function proposalMemberIds(proposal) {
    const ids = new Set();
    const visit = (value) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if ((key === 'correction_id' || key === 'correctionId') && typeof child === 'string') ids.add(child);
            else visit(child);
        }
    };
    visit(proposal);
    return ids;
}

function clearDerivedVerification(proposal) {
    const next = { ...proposal, eval_summary: { ...(proposal.eval_summary || {}) } };
    delete next.eval_summary.code_candidate;
    delete next.eval_summary.code_verification;
    return next;
}

function buildManualRuleRewritePlan({ correctionRules, proposal, expectedProposalFingerprint, reviewerName = 'Derian', buildCorrectionRuleRecord, expectedTargetHashes, codeProposalVerificationFingerprint } = {}) {
    const rows = Array.isArray(correctionRules) ? correctionRules : [];
    if (!proposal || proposal.status !== 'pending') throw new Error('Rewrite requires a pending proposal.');
    if (proposal.eval_summary?.code_candidate || proposal.eval_summary?.code_verification) throw new Error('Rewrite refuses a proposal with an owned or derived code candidate.');
    if (!DIGEST.test(expectedProposalFingerprint || '')) throw new Error('Rewrite requires a verified proposal fingerprint.');
    if (typeof codeProposalVerificationFingerprint !== 'function' || codeProposalVerificationFingerprint(proposal) !== expectedProposalFingerprint) throw new Error('Rewrite proposal fingerprint is stale or the canonical verifier is unavailable.');
    const routingIds = (proposal.correction_routing || []).map((row) => row?.correction_id);
    const replayIds = (proposal.replay_evidence || []).map((row) => row?.correction_id);
    const exactThirty = (ids) => ids.length === 30 && ids.every(Boolean) && new Set(ids).size === 30 && OLD_IDS.every((id) => ids.includes(id));
    if (!exactThirty(routingIds) || !exactThirty(replayIds) || JSON.stringify([...routingIds].sort()) !== JSON.stringify([...replayIds].sort())) throw new Error('Rewrite requires matching unique 30-member routing and replay inventories.');
    const oldRows = OLD_IDS.map((id) => rows.filter((row) => row?.correction_id === id));
    if (oldRows.some((matches) => matches.length !== 1)) throw new Error('Rewrite requires one exact correction_rules row per old id.');
    if (!expectedTargetHashes || OLD_IDS.some((id) => !DIGEST.test(expectedTargetHashes[id] || ''))) throw new Error('Rewrite requires exact target correction_rules shape hashes.');
    for (const id of OLD_IDS) if (expectedTargetHashes[id] !== hash(oldRows[OLD_IDS.indexOf(id)][0])) throw new Error(`Target correction_rules shape is stale for ${id}.`);
    const salmon = oldRows.slice(0, 2).map((matches) => matches[0]);
    if (salmon[0].submission_id !== salmon[1].submission_id || salmon.some((row) => row.original_text !== 'Salmon' || row.corrected_text !== 'Salmon*')) throw new Error('Salmon target shapes are not the exact duplicate pair.');
    const beet = oldRows[2][0];
    if (!/Roasted Heirloom Beet Salad/.test(beet.original_text || '') || !/caramelized walnuts/.test(beet.original_text || '') || !/pistou herbs/.test(beet.original_text || '') || !/caramelized walnut/.test(beet.corrected_text || '') || !/pistou herb/.test(beet.corrected_text || '')) throw new Error('Beet target shape is not the exact plural-to-singular correction.');
    const routing = Array.isArray(proposal.correction_routing) ? proposal.correction_routing : [];
    const replay = Array.isArray(proposal.replay_evidence) ? proposal.replay_evidence : [];
    if (routing.length !== 30 || replay.length !== 30) throw new Error('Rewrite requires the exact 30-member pending proposal.');
    const before = { correction_rules: oldRows.flat(), proposal };
    const nextProposal = patchKnownProposalFields(proposal);
    assertNoOldIds(nextProposal);
    nextProposal.correction_rule_count = 27;
    if (nextProposal.eval_summary?.behavior_tests && typeof nextProposal.eval_summary.behavior_tests === 'object') {
        const { sha256: _oldHash, ...behaviorBody } = nextProposal.eval_summary.behavior_tests;
        nextProposal.eval_summary.behavior_tests = { ...behaviorBody, sha256: behaviorHash(behaviorBody) };
    }
    const freeformRow = oldRows[2][0];
    return Object.freeze({
        schema_version: 1, source: 'user_directed_manual_rule_rewrite', phase: 'planned', proposal_id: proposal.id,
        expected_proposal_fingerprint: expectedProposalFingerprint, old_ids: [...OLD_IDS], new_id: NEW_ID,
        target_hashes: Object.freeze(Object.fromEntries(OLD_IDS.map((id) => [id, hash(oldRows[OLD_IDS.indexOf(id)][0])]))),
        recovery_snapshot: Object.freeze({ before, sha256: hash(before) }),
        correction_rule_deletes: Object.freeze(oldRows.flat().map((row) => ({ id: row.id, correction_id: row.correction_id, expected_sha256: hash(row) }))),
        replacement: Object.freeze({ old_id: freeformRow.id, expected_sha256: hash(freeformRow), row: buildNewManualRule(freeformRow, reviewerName, buildCorrectionRuleRecord) }),
        proposal_before_sha256: hash(proposal), proposal_after_sha256: hash(nextProposal), proposal_patch: Object.freeze(nextProposal),
    });
}

function buildPredeletedRecoveryPlan({ correctionRules, proposal, expectedProposalFingerprint, reviewerName = 'Derian', buildCorrectionRuleRecord, codeProposalVerificationFingerprint } = {}) {
    if ((correctionRules || []).some((row) => [...OLD_IDS, NEW_ID].includes(row.correction_id))) throw new Error('Predeleted recovery requires all old and replacement correction rows to be absent.');
    if (!proposal || proposal.status !== 'pending' || proposal.eval_summary?.code_candidate || proposal.eval_summary?.code_verification) throw new Error('Predeleted recovery requires an unowned pending proposal.');
    if (typeof codeProposalVerificationFingerprint !== 'function' || codeProposalVerificationFingerprint(proposal) !== expectedProposalFingerprint) throw new Error('Predeleted recovery proposal fingerprint is stale.');
    const routing = proposal.correction_routing || [], replay = proposal.replay_evidence || [];
    const exact = (rows) => rows.length === 30 && new Set(rows.map((row) => row?.correction_id)).size === 30 && OLD_IDS.every((id) => rows.some((row) => row?.correction_id === id));
    if (!exact(routing) || !exact(replay) || JSON.stringify(routing.map((row) => row.correction_id).sort()) !== JSON.stringify(replay.map((row) => row.correction_id).sort())) throw new Error('Predeleted recovery requires the exact matching 30-member proposal.');
    const salmonRoutes = OLD_IDS.slice(0, 2).map((id) => routing.find((row) => row.correction_id === id));
    if (salmonRoutes.some((row) => row.original_text !== 'Salmon' || row.corrected_text !== 'Salmon*')) throw new Error('Predeleted recovery Salmon proposal evidence changed.');
    const beet = routing.find((row) => row.correction_id === OLD_IDS[2]);
    if (!/caramelized walnuts/.test(beet?.original_text || '') || !/pistou herbs/.test(beet?.original_text || '') || !/caramelized walnut/.test(beet?.corrected_text || '') || !/pistou herb/.test(beet?.corrected_text || '')) throw new Error('Predeleted recovery Beet proposal evidence changed.');
    const behaviorRecords = proposal.eval_summary?.behavior_tests?.records || [];
    if (OLD_IDS.some((id) => behaviorRecords.filter((row) => row.correctionId === id).length !== 1)) throw new Error('Predeleted recovery behavior evidence is incomplete.');
    const nextProposal = patchKnownProposalFields(proposal);
    assertNoOldIds(nextProposal);
    nextProposal.correction_rule_count = 27;
    const { sha256: _oldHash, ...behaviorBody } = nextProposal.eval_summary.behavior_tests;
    nextProposal.eval_summary.behavior_tests = { ...behaviorBody, sha256: behaviorHash(behaviorBody) };
    const before = { correction_rules_absent: [...OLD_IDS, NEW_ID], proposal };
    return Object.freeze({
        schema_version: 1, source: 'user_directed_manual_rule_rewrite_predeleted_recovery', phase: 'planned', targets_predeleted: true,
        proposal_id: proposal.id, expected_proposal_fingerprint: expectedProposalFingerprint, old_ids: [...OLD_IDS], new_id: NEW_ID,
        target_hashes: Object.freeze({}), recovery_snapshot: Object.freeze({ before, sha256: hash(before) }), correction_rule_deletes: Object.freeze([]),
        replacement: Object.freeze({ old_id: OLD_IDS[2], expected_sha256: null, row: buildNewManualRule(null, reviewerName, buildCorrectionRuleRecord) }),
        proposal_before_sha256: hash(proposal), proposal_after_sha256: hash(nextProposal), proposal_patch: Object.freeze(nextProposal),
    });
}

function assertPlan(plan) {
    if (!plan || plan.schema_version !== 1 || plan.phase !== 'planned' || !DIGEST.test(plan.recovery_snapshot?.sha256 || '') || plan.old_ids.join('|') !== OLD_IDS.join('|')) throw new Error('Invalid manual-rule rewrite plan.');
    if (hash(plan.recovery_snapshot.before) !== plan.recovery_snapshot.sha256 || hash(plan.recovery_snapshot.before.proposal) !== plan.proposal_before_sha256 || hash(plan.proposal_patch) !== plan.proposal_after_sha256) throw new Error('Manual-rule rewrite plan hashes are invalid.');
    if (plan.targets_predeleted) {
        if (plan.source !== 'user_directed_manual_rule_rewrite_predeleted_recovery' || plan.correction_rule_deletes?.length !== 0 || plan.recovery_snapshot.before.correction_rules_absent?.join('|') !== [...OLD_IDS, NEW_ID].join('|')) throw new Error('Predeleted recovery plan is invalid.');
    } else if (plan.correction_rule_deletes?.length !== 3 || plan.correction_rule_deletes.some((row, index) => row.correction_id !== OLD_IDS[index] || row.expected_sha256 !== plan.target_hashes?.[row.correction_id])) throw new Error('Manual-rule rewrite delete targets are invalid.');
    if (plan.replacement?.row?.id !== NEW_ROW_ID || plan.replacement.row.correction_id !== NEW_ID || plan.replacement.row.status !== 'pending' || plan.replacement.row.source_binding !== null) throw new Error('Replacement row is not an unbound pending manual rule.');
    return true;
}

const PLAN_PHASES = new Set(['planned', 'snapshot', 'proposal_reconciled', 'inserted', 'updated', 'verified']);
const planDigest = (plan) => hash({ ...plan, phase: 'planned', plan_sha256: undefined, previous_phase: undefined });

async function writeRecoveryMarker(markerPath, plan) {
    const marker = { ...plan, plan_sha256: plan.plan_sha256 || planDigest(plan) };
    const bytes = Buffer.from(JSON.stringify(marker, null, 2));
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Recovery snapshot exceeds the bounded size.');
    await fsp.mkdir(require('path').dirname(markerPath), { recursive: true, mode: 0o700 });
    await fsp.chmod(require('path').dirname(markerPath), 0o700);
    const temporary = `${markerPath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    await fsp.rename(temporary, markerPath);
    await fsp.chmod(markerPath, 0o600);
}

async function advanceRewriteMarker(markerPath, expectedPlanSha256, phase) {
    const allowed = new Set(['planned', 'rules_reconciled', 'proposal_reconciled', 'verified']);
    if (!allowed.has(phase)) throw new Error('Unknown manual-rule rewrite phase.');
    const current = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
    const expectedMatches = hash(current) === expectedPlanSha256 || (current.phase === 'planned' && current.plan_sha256 === expectedPlanSha256);
    if (!expectedMatches) throw new Error('Rewrite marker changed concurrently.');
    const next = { ...current, phase, previous_phase: current.phase };
    await writeRecoveryMarker(markerPath, next);
    return next;
}

/**
 * Run the rewrite against an explicitly supplied adapter. The adapter is the
 * only live-data boundary, which keeps planning/tests provider-free and makes
 * each phase safely retryable after a process interruption.
 */
async function runManualRuleRewrite({ adapter, markerPath, plan, failAfterPhase, codeProposalVerificationFingerprint } = {}) {
    if (!adapter || typeof adapter.readState !== 'function') throw new Error('Rewrite adapter must provide readState.');
    if (!markerPath) throw new Error('Rewrite requires a private recovery marker path.');
    assertPlan(plan);
    const marker = markerPath && fs.existsSync(markerPath) ? JSON.parse(await fsp.readFile(markerPath, 'utf8')) : null;
    if (marker && (marker.proposal_id !== plan.proposal_id || marker.proposal_before_sha256 !== plan.proposal_before_sha256 || marker.plan_sha256 !== planDigest(plan) || !PLAN_PHASES.has(marker.phase))) throw new Error('Rewrite marker is stale or malformed.');
    let phase = marker?.phase || 'planned';
    const mark = async (next) => {
        phase = next;
        if (markerPath) await writeRecoveryMarker(markerPath, { ...plan, phase: next });
        if (failAfterPhase === next) throw new Error(`Injected failure after ${next}`);
    };
    if (phase === 'planned') {
        const state = await adapter.readState();
        if (plan.targets_predeleted) {
            if (state.correctionRules.some((row) => [...OLD_IDS, NEW_ID].includes(row.correction_id)) || hash(state.proposal) !== plan.proposal_before_sha256 || codeProposalVerificationFingerprint(state.proposal) !== plan.expected_proposal_fingerprint) throw new Error('Live predeleted recovery state changed before rewrite.');
        } else {
            const current = buildManualRuleRewritePlan({ correctionRules: state.correctionRules, proposal: state.proposal, expectedProposalFingerprint: plan.expected_proposal_fingerprint, reviewerName: plan.replacement.row.reviewer_name, expectedTargetHashes: plan.target_hashes, codeProposalVerificationFingerprint });
            if (current.proposal_before_sha256 !== plan.proposal_before_sha256) throw new Error('Live state changed before rewrite.');
        }
    }
    if (phase === 'planned') { if (markerPath) await writeRecoveryMarker(markerPath, { ...plan, phase: 'snapshot' }); await mark('snapshot'); }
    if (phase === 'snapshot') {
        // Reconcile the proposal first. This prevents preparation from ever
        // observing a proposal that references rows already deleted.
        const live = await adapter.readState();
        if (hash(live.proposal) === plan.proposal_before_sha256) await adapter.updateProposal(plan.proposal_patch, { expectedFingerprint: plan.expected_proposal_fingerprint, expectedProposal: live.proposal });
        else if (!proposalPatchMatches(live.proposal, plan.proposal_patch)) throw new Error('Proposal changed concurrently before CAS.');
        await mark('proposal_reconciled');
    }
    if (phase === 'proposal_reconciled') {
        // Adapter must make this insert idempotent by correction_id.
        await adapter.insertCorrectionRule(plan.replacement.row, { expectedSha256: plan.replacement.expected_sha256 });
        await mark('inserted');
    }
    if (phase === 'inserted') {
        // Delete only the two Salmon duplicates and the old Beet row after the
        // replacement is durably present. All deletes are exact-ID/CAS writes.
        for (const target of plan.correction_rule_deletes) await adapter.deleteCorrectionRule(target);
        await mark('updated');
    }
    if (phase === 'updated') {
        const after = await adapter.readState();
        verifyFinalState(after, plan);
        await mark('verified');
    }
    if (phase === 'verified') verifyFinalState(await adapter.readState(), plan);
    return { phase };
}

function proposalPatchProjection(value) { const { xmin: _rowVersion, ...stable } = value || {}; return stable; }
function proposalPatchMatches(actual, expected) { return hash(proposalPatchProjection(actual)) === hash(proposalPatchProjection(expected)); }
const replacementProjection = (row) => Object.fromEntries(['id', 'submission_id', 'correction_id', 'original_text', 'corrected_text', 'force_target_case', 'change_type', 'rule', 'applies_to_menu_type', 'is_location_specific', 'project_name', 'restaurant_name', 'location', 'other_applicable_locations', 'reviewer_name', 'source', 'status', 'example_original', 'example_corrected', 'source_binding', 'prompt_cycle_id', 'consumed_at'].map((field) => [field, row?.[field] ?? null]));
function verifyFinalState(state, plan) {
    if (!proposalPatchMatches(state.proposal, plan.proposal_patch) || JSON.stringify(state.proposal).includes(OLD_IDS[0]) || JSON.stringify(state.proposal).includes(OLD_IDS[1]) || JSON.stringify(state.proposal).includes(OLD_IDS[2])) throw new Error('Rewrite readback does not reconcile the exact proposal patch.');
    const routingIds = (state.proposal.correction_routing || []).map((row) => row.correction_id);
    const replayIds = (state.proposal.replay_evidence || []).map((row) => row.correction_id);
    if (routingIds.length !== 27 || new Set(routingIds).size !== 27 || JSON.stringify([...routingIds].sort()) !== JSON.stringify([...replayIds].sort())) throw new Error('Rewrite readback does not contain the exact 27-member inventory.');
    if (state.correctionRules.some((row) => OLD_IDS.includes(row.correction_id))) throw new Error('Rewrite readback still contains an old correction row.');
    const replacements = state.correctionRules.filter((row) => row.correction_id === NEW_ID);
    if (replacements.length !== 1 || hash(replacementProjection(replacements[0])) !== hash(replacementProjection(plan.replacement.row))) throw new Error('Rewrite readback replacement is missing or conflicting.');
    const behavior = state.proposal.eval_summary?.behavior_tests;
    if (!behavior?.sha256) throw new Error('Rewrite readback behavior artifact is missing.');
    const { sha256, ...body } = behavior;
    if (sha256 !== behaviorHash(body)) throw new Error('Rewrite readback behavior hash is invalid.');
}

function createSupabaseRewriteAdapter(client, proposalId) {
    if (!client?.from || !proposalId) throw new Error('Supabase rewrite adapter requires a client and proposal id.');
    return {
        async readState() {
            const [rulesResult, proposalResult] = await Promise.all([
                client.from('correction_rules').select('*').in('correction_id', [...OLD_IDS, NEW_ID]),
                client.from('prompt_proposals').select('*,xmin').eq('id', proposalId).single(),
            ]);
            if (rulesResult.error) throw new Error(`Read correction_rules failed: ${rulesResult.error.message}`);
            if (proposalResult.error) throw new Error(`Read prompt_proposals failed: ${proposalResult.error.message}`);
            return { correctionRules: rulesResult.data || [], proposal: proposalResult.data };
        },
        async updateProposal(next, guard) {
            const expected = guard?.expectedProposal;
            if (!expected?.xmin) throw new Error('Proposal CAS requires the original proposal row version.');
            const patch = { correction_routing: next.correction_routing, replay_evidence: next.replay_evidence, eval_summary: next.eval_summary, correction_rule_count: next.correction_rule_count };
            for (const field of ['coverage_claims', 'code_recommendations']) if (Object.prototype.hasOwnProperty.call(next, field)) patch[field] = next[field];
            const query = client.from('prompt_proposals').update(patch).eq('id', proposalId).eq('status', 'pending').eq('xmin', expected.xmin).select('id,xmin');
            const result = await query;
            if (result.error) throw new Error(`Proposal CAS failed: ${result.error.message}`);
            if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('Proposal CAS affected zero or multiple rows.');
            return result.data[0];
        },
        async insertCorrectionRule(row, guard) {
            const existing = await client.from('correction_rules').select('correction_id').eq('correction_id', row.correction_id);
            if (existing.error) throw new Error(`Replacement lookup failed: ${existing.error.message}`);
            if (existing.data?.length) {
                if (existing.data.length !== 1) throw new Error('Existing stable replacement is duplicated.');
                const full = await client.from('correction_rules').select('*').eq('correction_id', row.correction_id).single();
                if (full.error || hash(replacementProjection(full.data)) !== hash(replacementProjection(row))) throw new Error('Existing stable replacement conflicts with planned row.');
                return full.data;
            }
            const result = await client.from('correction_rules').insert(row).select('correction_id');
            if (result.error) throw new Error(`Replacement insert failed: ${result.error.message}`);
            if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('Replacement insert affected unexpected rows.');
            return result.data[0];
        },
        async deleteCorrectionRule(target) {
            const current = await client.from('correction_rules').select('*').eq('id', target.id).eq('correction_id', target.correction_id).maybeSingle();
            if (current.error) throw new Error(`Correction target read failed for ${target.correction_id}: ${current.error.message}`);
            if (!current.data) return { id: target.id, already_absent: true };
            if (hash(current.data) !== target.expected_sha256 || !current.data.updated_at) throw new Error(`Correction target is stale for ${target.correction_id}.`);
            const result = await client.from('correction_rules').delete().eq('id', target.id).eq('correction_id', target.correction_id).eq('status', 'pending').eq('updated_at', current.data.updated_at).select('id');
            if (result.error) throw new Error(`Correction delete failed: ${result.error.message}`);
            if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error(`Correction delete affected unexpected rows for ${target.correction_id}.`);
            return result.data[0];
        },
    };
}

module.exports = { OLD_IDS, NEW_ID, NEW_ROW_ID, NEW_SUBMISSION_ID, RULE, stripOldMembership, buildNewManualRule, buildManualRuleRewritePlan, buildPredeletedRecoveryPlan, proposalMemberIds, clearDerivedVerification, patchKnownProposalFields, createSupabaseRewriteAdapter, runManualRuleRewrite, assertPlan, writeRecoveryMarker, advanceRewriteMarker, verifyFinalState, proposalPatchMatches, replacementProjection, hash, behaviorHash, proposalFingerprint: verificationFingerprint };

'use strict';

const crypto = require('crypto');

const canonical = (value) => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : value;
const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function proposalFingerprint(proposal) {
    return sha({ cycle_id: proposal.cycle_id, current_prompt: proposal.current_prompt, proposed_prompt: proposal.proposed_prompt, proposed_rules: proposal.proposed_rules, correction_routing: proposal.correction_routing, eval_summary: proposal.eval_summary });
}

function assertFrozenRuntime(proposal, runtime) {
    const promptHash = crypto.createHash('sha256').update(`${proposal.proposed_prompt || ''}`).digest('hex');
    if (!runtime?.effective_prompt_sha256 || promptHash !== runtime.effective_prompt_sha256) throw new Error('effective prompt changed since successor preparation');
    if (!runtime?.accepted_rules_sha256 || runtime.accepted_rules_sha256 !== sha(runtime.accepted_rules || [])) throw new Error('accepted correction-rule snapshot is stale or self-inconsistent');
    if (!runtime?.implementation_sha256) throw new Error('deployed implementation identity is missing');
    return true;
}

function assertPendingInsertPayload(payload, plan, runtime) {
    const forbidden = ['id', 'source_provenance', 'preserved_parent_terminal_owner'];
    if (forbidden.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) throw new Error('successor payload contains non-schema fields');
    if (payload.status !== 'pending' || payload.accepted_rules !== null || payload.disposition !== 'rules_only') throw new Error('successor is not a pending rules-only proposal');
    if (payload.current_prompt !== payload.proposed_prompt) throw new Error('rules-only successor cannot alter the live prompt');
    if (!Array.isArray(payload.proposed_rules) || payload.proposed_rules.length !== 3 || !Array.isArray(payload.correction_routing) || payload.correction_routing.length !== 3) throw new Error('successor scope is not exactly the three approved rules');
    assertFrozenRuntime(payload, runtime);
    if (payload.eval_summary?.successor_provenance?.parent_proposal_id !== plan.parent_proposal_id) throw new Error('successor provenance is not linked to the parent');
    return true;
}

function classifyCreateReadback(existing, plan) {
    if (!existing) return { state: 'create_required' };
    if (existing.cycle_id !== plan.successor.cycle_id) return { state: 'conflict', reason: 'cycle_id_collision' };
    if (proposalFingerprint(existing) === plan.successor_sha256 && existing.status === 'pending' && existing.accepted_rules === null) return { state: 'already_created', proposal: existing };
    return { state: 'conflict', reason: 'existing_successor_fingerprint_mismatch' };
}

async function createOrRecoverSuccessor(client, plan, runtime) {
    assertPendingInsertPayload(plan.successor, plan, runtime);
    const existingResult = await client.from('prompt_proposals').select('*').eq('cycle_id', plan.successor.cycle_id).maybeSingle();
    if (existingResult.error) throw new Error(`successor lookup failed: ${existingResult.error.message}`);
    const existing = classifyCreateReadback(existingResult.data, plan);
    if (existing.state === 'already_created' || existing.state === 'conflict') return existing;
    const inserted = await client.from('prompt_proposals').insert(plan.successor).select('*').single();
    if (!inserted.error) return classifyCreateReadback(inserted.data, plan);
    const recovery = await client.from('prompt_proposals').select('*').eq('cycle_id', plan.successor.cycle_id).maybeSingle();
    if (recovery.error) throw new Error(`successor recovery lookup failed: ${recovery.error.message}`);
    return classifyCreateReadback(recovery.data, plan);
}

function prepareSingleApproval(proposal, runtime, acceptedRuleIndexes) {
    assertFrozenRuntime(proposal, runtime);
    if (proposal.status !== 'pending' || proposal.accepted_rules !== null || proposal.eval_status !== 'passed' || proposal.disposition !== 'rules_only') throw new Error('successor is not eligible for approval');
    if (JSON.stringify(acceptedRuleIndexes) !== '[0,1,2]') throw new Error('approval must select exactly all three successor rules');
    return { status: 'approved_modified', accepted_rule_indexes: [0, 1, 2], expected_cycle_id: proposal.cycle_id, expected_proposal_fingerprint: proposalFingerprint(proposal), effective_prompt_sha256: runtime.effective_prompt_sha256, accepted_rules_sha256: runtime.accepted_rules_sha256 };
}

function recoverApprovalReadback(row, request) {
    if (!row) return { state: 'retry_allowed' };
    if (row.cycle_id !== request.expected_cycle_id) return { state: 'conflict' };
    if (row.status === 'approved_modified' && row.accepted_rules?.length === 3) return { state: 'already_approved', proposal: row };
    if (row.status === 'pending' && row.accepted_rules === null) return { state: 'retry_allowed' };
    return { state: 'conflict' };
}

module.exports = { sha, proposalFingerprint, assertFrozenRuntime, assertPendingInsertPayload, classifyCreateReadback, createOrRecoverSuccessor, prepareSingleApproval, recoverApprovalReadback };

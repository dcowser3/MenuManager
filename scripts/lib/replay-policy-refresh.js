'use strict';

const crypto = require('crypto');
const replayRetirement = require('../../services/dashboard/dist/lib/replay-retirement');

const hashJson = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const UNRESOLVED = new Set(['still_missed', 'partially_correct']);

function prepareReplayPolicyRefresh({ proposal, expectedFingerprint, targetVersion, members, reassessCurrentVersion = false, provenance = null }) {
    if (!proposal || proposal.status !== 'pending') throw new Error('Replay refresh requires a pending proposal.');
    const existingCandidate = proposal.eval_summary?.code_candidate;
    if (existingCandidate && (!existingCandidate.closed_at || !['blocked', 'completed'].includes(existingCandidate.status))) throw new Error('Replay refresh refuses an active owned attempt.');
    const currentPolicy = proposal.eval_summary?.replay_retirement_policy_version;
    const versionRefresh = reassessCurrentVersion && Number.isInteger(currentPolicy) && currentPolicy === targetVersion;
    if (!Number.isInteger(targetVersion) || targetVersion < 1 || (currentPolicy != null && !versionRefresh)) throw new Error('Replay refresh version state is invalid or already set.');
    if (versionRefresh && (!provenance || provenance.refresh_mode !== 'zero_model_assess_replay_retirement' || provenance.member_count !== 30 || provenance.bound_correction_count !== 27 || provenance.unresolved_count !== 3 || !/^[a-f0-9]{64}$/.test(provenance.artifact_sha256 || ''))) {
        throw new Error('Current-version replay reassessment requires complete 30-member provenance.');
    }
    if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) throw new Error('Replay refresh fingerprint is missing.');
    const current = Array.isArray(proposal.replay_evidence) ? proposal.replay_evidence : [];
    const ids = current.map((row) => row?.correction_id).filter(Boolean);
    if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !UNRESOLVED.has(current.find((row) => row.correction_id === id)?.status))) throw new Error('Replay refresh requires unresolved-only evidence.');
    if (replayRetirement.unverifiedReplayResolutionIds(proposal).length) throw new Error('Replay refresh has unverified resolutions.');
    const routes = Array.isArray(proposal.correction_routing) ? proposal.correction_routing : [];
    const routeIds = routes.map((row) => row?.correction_id).filter(Boolean);
    if (routeIds.length !== ids.length || new Set(routeIds).size !== routeIds.length
        || routeIds.some((id) => !ids.includes(id))) throw new Error('Replay refresh requires exact evidence/routing membership.');
    const byId = new Map((members || []).map((member) => [member.correction_id, member]));
    if (ids.some((id) => !byId.has(id)) || byId.size !== ids.length) throw new Error('Replay refresh member scope is incomplete.');
    const refreshed = current.map((entry) => {
        const member = byId.get(entry.correction_id);
        const result = replayRetirement.assessReplayRetirement(member);
        return { ...entry, status: result.status, observed_status: result.observed_status, retirement_evidence: result.retirement_evidence };
    });
    const statusById = new Map(refreshed.map((row) => [row.correction_id, row.status]));
    const refreshedRouting = routes.map((route) => ({ ...route, replay_status: statusById.get(route.correction_id) }));
    const before = proposal.eval_summary || {};
    const after = { ...before, replay_retirement_policy_version: targetVersion };
    if (versionRefresh) after.replay_retirement_refresh = { ...provenance, model_calls: 0 };
    return Object.freeze({ proposal_fingerprint: expectedFingerprint, expected_eval_summary_sha256: hashJson(before), expected_replay_evidence_sha256: hashJson(current), patch: Object.freeze({ eval_summary: after, replay_evidence: refreshed, correction_routing: refreshedRouting }), model_calls: 0, statuses: refreshed.map((row) => ({ correction_id: row.correction_id, status: row.status })) });
}

/** Apply only when the exact pending row version still owns the proposal. */
async function applyReplayPolicyRefresh(client, proposalId, expectedXmin, patch) {
    if (!client?.from || !proposalId || expectedXmin == null) throw new Error('Replay refresh CAS requires client, proposal id, and xmin.');
    const result = await client.from('prompt_proposals')
        .update({ correction_routing: patch.correction_routing, replay_evidence: patch.replay_evidence, eval_summary: patch.eval_summary })
        .eq('id', proposalId).eq('status', 'pending').eq('xmin', expectedXmin).select('id,xmin');
    if (result.error) throw new Error(`Replay refresh CAS failed: ${result.error.message}`);
    if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('Replay refresh CAS affected zero or multiple rows.');
    return result.data[0];
}

module.exports = { prepareReplayPolicyRefresh, applyReplayPolicyRefresh, hashJson };

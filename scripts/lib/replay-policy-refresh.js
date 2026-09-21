'use strict';

const crypto = require('crypto');
const replayRetirement = require('../../services/dashboard/dist/lib/replay-retirement');

const hashJson = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const UNRESOLVED = new Set(['still_missed', 'partially_correct']);

function prepareReplayPolicyRefresh({ proposal, expectedFingerprint, targetVersion, members }) {
    if (!proposal || proposal.status !== 'pending') throw new Error('Replay refresh requires a pending proposal.');
    if (proposal.eval_summary?.code_candidate?.attempt_id || proposal.eval_summary?.code_candidate) throw new Error('Replay refresh refuses an owned attempt.');
    if (!Number.isInteger(targetVersion) || targetVersion < 1 || proposal.eval_summary?.replay_retirement_policy_version != null) throw new Error('Replay refresh version state is invalid or already set.');
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

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
    const byId = new Map((members || []).map((member) => [member.correction_id, member]));
    if (ids.some((id) => !byId.has(id)) || byId.size !== ids.length) throw new Error('Replay refresh member scope is incomplete.');
    const refreshed = current.map((entry) => {
        const member = byId.get(entry.correction_id);
        const result = replayRetirement.assessReplayRetirement(member);
        return { ...entry, status: result.status, observed_status: result.observed_status, retirement_evidence: result.retirement_evidence };
    });
    const before = proposal.eval_summary || {};
    const after = { ...before, replay_retirement_policy_version: targetVersion };
    return Object.freeze({ proposal_fingerprint: expectedFingerprint, expected_eval_summary_sha256: hashJson(before), expected_replay_evidence_sha256: hashJson(current), patch: Object.freeze({ eval_summary: after, replay_evidence: refreshed }), model_calls: 0, statuses: refreshed.map((row) => ({ correction_id: row.correction_id, status: row.status })) });
}

module.exports = { prepareReplayPolicyRefresh, hashJson };

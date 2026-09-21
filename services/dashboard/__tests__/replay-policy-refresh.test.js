'use strict';
const { prepareReplayPolicyRefresh } = require('../../../scripts/lib/replay-policy-refresh');
const H = (v) => require('crypto').createHash('sha256').update(v).digest('hex');
const base = (overrides = {}) => ({ id: 'p', status: 'pending', eval_summary: {}, replay_evidence: [{ correction_id: 'c1', status: 'still_missed' }], ...overrides });
const member = (status = 'still_missed') => ({ correction_id: 'c1', observedStatus: status, originalAudit: null, submissionAttemptId: null, submittedMenu: null, deterministicReplay: null, correctionApplied: () => false });
test('prepares zero-model replay evidence while preserving unresolved provenance', () => { const proposal = base(); const out = prepareReplayPolicyRefresh({ proposal, expectedFingerprint: H(JSON.stringify(proposal)), targetVersion: 2, members: [member()] }); expect(out.model_calls).toBe(0); expect(out.patch.replay_evidence[0].status).toBe('still_missed'); expect(out.patch.replay_evidence[0].retirement_evidence.model_calls).toBe(0); });
test.each([{ status: 'now_correct' }, { status: 'delivery_mismatch' }, { status: 'replay_unavailable' }])('rejects non-unresolved input %s', (row) => expect(() => prepareReplayPolicyRefresh({ proposal: base({ replay_evidence: [{ correction_id: 'c1', status: row.status }] }), expectedFingerprint: H('x'), targetVersion: 2, members: [member()] })).toThrow());

#!/usr/bin/env node
'use strict';

// Zero-model repair for one pending proposal. This command only updates replay
// bookkeeping and the policy identity; it never creates a candidate or sends mail.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const { requireSupabaseServiceKey } = require('./lib/supabase-key');
const { prepareReplayPolicyRefresh, applyReplayPolicyRefresh, hashJson } = require('./lib/replay-policy-refresh');
const replay = require('../services/dashboard/dist/lib/replay-retirement');
const binding = require('../services/dashboard/dist/lib/replay-audit-binding');
const verification = require('../services/dashboard/dist/lib/code-proposal-verification');

const proposalId = process.argv[process.argv.indexOf('--proposal-id') + 1] || process.env.REPLAY_POLICY_PROPOSAL_ID;
const execute = process.argv.includes('--execute');
const root = path.resolve(__dirname, '..');
const artifactRoot = path.join(root, 'tmp', 'replay-policy-refresh');
const sha = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const writePrivate = async (file, value) => { await fsp.writeFile(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await fsp.chmod(file, 0o600); };

function correctionApplied(original, corrected, menu) {
    const before = `${original || ''}`.trim().toLocaleLowerCase();
    const after = `${corrected || ''}`.trim().toLocaleLowerCase();
    const body = `${menu || ''}`.toLocaleLowerCase();
    return !!after && body.includes(after) && (!before || !body.includes(before));
}

async function loadMembers(client, proposal) {
    const accepted = (await client.from('correction_rules').select('*').eq('status', 'accepted')).data || [];
    const members = [];
    for (const entry of proposal.replay_evidence || []) {
        const sid = entry.submission_id;
        let submission = null;
        if (sid) {
            const result = await client.from('submissions').select('id,legacy_id,menu_content,approved_menu_content,form_attempt_id').or(`id.eq.${sid},legacy_id.eq.${sid}`).limit(1);
            submission = result.data?.[0] || null;
        }
        let originalAudit = null;
        if (submission?.form_attempt_id) {
            const result = await client.from('basic_ai_check_audits').select('id,attempt_id,created_at,event_type,review_mode,model,ai_request,ai_response,final_result').eq('attempt_id', submission.form_attempt_id);
            const bound = binding.bindReplayAudit(result.data || [], submission.form_attempt_id);
            if (bound.eligible) originalAudit = bound.audit;
        }
        const original = entry.original_text || entry.example_original || '';
        const corrected = entry.corrected_text || entry.example_corrected || '';
        members.push({
            correction_id: entry.correction_id,
            observedStatus: entry.observed_status || entry.status,
            originalAudit,
            submissionAttemptId: submission?.form_attempt_id || entry.attempt_id || null,
            submittedMenu: submission?.menu_content || null,
            deterministicReplay: null,
            correctionApplied: (menu) => correctionApplied(original, corrected, menu),
            correctionProgress: (menu) => ({ applied_changes: correctionApplied(original, corrected, menu) ? [`${original}->${corrected}`] : [] }),
            acceptedRules: accepted,
        });
    }
    return members;
}

async function main() {
    if (!proposalId) throw new Error('Pass --proposal-id <id>.');
    const key = requireSupabaseServiceKey(process.env);
    if (!process.env.SUPABASE_URL || !key) throw new Error('SUPABASE_URL and service key are required.');
    const client = createClient(process.env.SUPABASE_URL, key);
    const result = await client.from('prompt_proposals').select('*,xmin').eq('id', proposalId).single();
    if (result.error) throw new Error(result.error.message);
    const proposal = result.data;
    const members = await loadMembers(client, proposal);
    const expectedFingerprint = verification.codeProposalVerificationFingerprint(proposal);
    const input = { proposal: { ...proposal, xmin: undefined }, members: members.map(({ acceptedRules, ...m }) => ({ ...m, originalAudit: m.originalAudit ? { ...m.originalAudit } : null, deterministicReplay: null })) };
    const artifactDir = path.join(artifactRoot, `${Date.now()}-${proposalId}`);
    await fsp.mkdir(artifactDir, { recursive: true, mode: 0o700 }); await fsp.chmod(artifactDir, 0o700);
    await writePrivate(path.join(artifactDir, 'marker.json'), { state: 'prepared', proposal_id: proposalId, input_sha256: sha(input), model_calls: 0 });
    await writePrivate(path.join(artifactDir, 'before.json'), proposal);
    const prepared = prepareReplayPolicyRefresh({ proposal, expectedFingerprint, targetVersion: replay.REPLAY_RETIREMENT_POLICY_VERSION, members });
    await writePrivate(path.join(artifactDir, 'input.json'), { input_sha256: sha(input), members: members.map(({ acceptedRules, ...m }) => m), expected_xmin: proposal.xmin });
    await writePrivate(path.join(artifactDir, 'plan.json'), prepared);
    if (execute) {
        await applyReplayPolicyRefresh(client, proposalId, proposal.xmin, prepared.patch);
        const afterResult = await client.from('prompt_proposals').select('*,xmin').eq('id', proposalId).single();
        if (afterResult.error) throw new Error(afterResult.error.message);
        const after = afterResult.data;
        if (after.eval_summary?.replay_retirement_policy_version !== replay.REPLAY_RETIREMENT_POLICY_VERSION) throw new Error('Policy version readback mismatch.');
        await writePrivate(path.join(artifactDir, 'after.json'), after);
        await writePrivate(path.join(artifactDir, 'marker.json'), { state: 'applied', proposal_id: proposalId, input_sha256: sha(input), downstream_fingerprint: verification.codeProposalVerificationFingerprint(after), model_calls: 0 });
        console.log(JSON.stringify({ state: 'applied', artifactDir, input_sha256: sha(input), downstream_fingerprint: verification.codeProposalVerificationFingerprint(after), statuses: prepared.statuses }, null, 2));
    } else console.log(JSON.stringify({ state: 'dry-run', artifactDir, input_sha256: sha(input), statuses: prepared.statuses, model_calls: 0 }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { correctionApplied, loadMembers };

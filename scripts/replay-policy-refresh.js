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
const core = require('../services/dashboard/dist/lib/improvement-cycle-core');
const { extractReplacementSignals } = require('../services/differ/dist/lib/learning-signals');

const proposalId = process.argv[process.argv.indexOf('--proposal-id') + 1] || process.env.REPLAY_POLICY_PROPOSAL_ID;
const execute = process.argv.includes('--execute');
const root = path.resolve(__dirname, '..');
const artifactRoot = path.join(root, 'tmp', 'replay-policy-refresh');
const sha = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter((key) => key !== 'xmin').sort().map((key) => [key, canonical(value[key])])) : value;
const canonicalHash = (value) => sha(canonical(value));
const writePrivate = async (file, value) => { const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`; const temp = `${file}.tmp-${process.pid}`; await fsp.writeFile(temp, text, { mode: 0o600, flag: 'w' }); await fsp.chmod(temp, 0o600); await fsp.rename(temp, file); await fsp.chmod(file, 0o600); };

function replayCallbacks(entry, sourceText) {
    const original = entry.original_text || entry.example_original || '';
    const corrected = entry.corrected_text || entry.example_corrected || '';
    const signals = (menu) => extractReplacementSignals(sourceText, menu);
    return {
        correctionApplied: (menu) => core.analyzeReplayCorrection(original, corrected, menu, signals(menu)).status === 'now_correct',
        correctionProgress: (menu) => ({ applied_changes: signals(menu).map((signal) => `${signal.from_norm || signal.from || ''}->${signal.to_norm || signal.to || ''}`) }),
    };
}

function assertFinalReadback(actual, planned) {
    if (actual.status !== 'pending' || actual.eval_summary?.code_candidate || actual.eval_summary?.eval_status !== 'regressed' || actual.eval_summary?.disposition !== 'rules_only') throw new Error('Replay refresh readback violates pending/no-owner/regression guards.');
    if (canonicalHash(actual) !== canonicalHash(planned)) throw new Error('Replay refresh readback differs from the complete planned proposal.');
}

/** Recognize only an exact CAS-completed plan; safe to call on a second invocation. */
async function recoverAppliedRefresh({ proposal, proposalId, artifactDir }) {
    const planPath = path.join(artifactDir, 'plan.json');
    const afterPath = path.join(artifactDir, 'after.json');
    if (!fs.existsSync(planPath) || !fs.existsSync(afterPath)) return null;
    let plan; let after;
    try {
        plan = JSON.parse(await fsp.readFile(planPath, 'utf8'));
        after = JSON.parse(await fsp.readFile(afterPath, 'utf8'));
    } catch { return null; }
    if (plan.proposal_id !== proposalId || plan.planned_sha256 !== canonicalHash(plan.planned)
        || canonicalHash(after) !== plan.planned_sha256 || canonicalHash(proposal) !== plan.planned_sha256) return null;
    assertFinalReadback(proposal, plan.planned);
    await writePrivate(path.join(artifactDir, 'marker.json'), { state: 'recovered', proposal_id: proposalId, planned_sha256: plan.planned_sha256, model_calls: 0 });
    return { state: 'recovered', artifactDir, downstream_fingerprint: verification.codeProposalVerificationFingerprint(proposal), model_calls: 0 };
}

async function loadMembers(client, proposal) {
    const acceptedResult = await client.from('correction_rules').select('*').eq('status', 'accepted');
    if (acceptedResult.error) throw new Error(`Accepted-rule lookup failed: ${acceptedResult.error.message}`);
    const accepted = acceptedResult.data || [];
    const members = [];
    for (const entry of proposal.replay_evidence || []) {
        const sid = entry.submission_id;
        let submission = null;
        if (sid) {
            const result = await client.from('submissions').select('id,legacy_id,menu_content,approved_menu_content,form_attempt_id,property,template_type,menu_type,service_period,raw_payload').or(`id.eq.${sid},legacy_id.eq.${sid}`);
            if (result.error) throw new Error(`Submission lookup failed for ${sid}: ${result.error.message}`);
            if ((result.data || []).length > 1) throw new Error(`Ambiguous submission binding for ${sid}.`);
            submission = result.data?.[0] || null;
        }
        let originalAudit = null;
        if (submission?.form_attempt_id) {
            const result = await client.from('basic_ai_check_audits').select('id,attempt_id,created_at,event_type,review_mode,model,ai_request,ai_response,final_result').eq('attempt_id', submission.form_attempt_id);
            if (result.error) throw new Error(`Audit lookup failed for ${submission.form_attempt_id}: ${result.error.message}`);
            const bound = binding.bindReplayAudit(result.data || [], submission.form_attempt_id);
            if (bound.eligible) originalAudit = bound.audit;
        }
        const original = entry.original_text || entry.example_original || '';
        const corrected = entry.corrected_text || entry.example_corrected || '';
        const sourceText = originalAudit?.ai_request?.text || submission?.menu_content || '';
        const callbacks = replayCallbacks(entry, sourceText);
        const deterministicReplay = replay.replayOriginalResponseDeterministically(originalAudit, { property: submission?.property || '', templateType: submission?.template_type || 'food', menuType: submission?.menu_type || 'standard', allergens: submission?.raw_payload?.allergens || '' }, accepted);
        members.push({
            correction_id: entry.correction_id,
            observedStatus: entry.observed_status || entry.status,
            originalAudit,
            submissionAttemptId: submission?.form_attempt_id || entry.attempt_id || null,
            submittedMenu: submission?.menu_content || null,
            deterministicReplay,
            ...callbacks,
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
    const artifactDir = path.join(artifactRoot, `proposal-${sha(proposalId).slice(0, 32)}`);
    await fsp.mkdir(artifactDir, { recursive: true, mode: 0o700 }); await fsp.chmod(artifactDir, 0o700);
    const recovered = await recoverAppliedRefresh({ proposal, proposalId, artifactDir });
    if (recovered) { console.log(JSON.stringify(recovered, null, 2)); return; }
    const members = await loadMembers(client, proposal);
    const expectedFingerprint = verification.codeProposalVerificationFingerprint(proposal);
    const input = { proposal: { ...proposal, xmin: undefined }, members: members.map(({ acceptedRules, ...m }) => ({ ...m, originalAudit: m.originalAudit ? { ...m.originalAudit } : null, deterministicReplay: null })) };
    await writePrivate(path.join(artifactDir, 'marker.json'), { state: 'prepared', proposal_id: proposalId, input_sha256: sha(input), model_calls: 0 });
    await writePrivate(path.join(artifactDir, 'before.json'), proposal);
    const prepared = prepareReplayPolicyRefresh({ proposal, expectedFingerprint, targetVersion: replay.REPLAY_RETIREMENT_POLICY_VERSION, members });
    const planned = { ...proposal, ...prepared.patch };
    await writePrivate(path.join(artifactDir, 'input.json'), { input_sha256: sha(input), members: members.map(({ acceptedRules, ...m }) => m), expected_xmin: proposal.xmin });
    await writePrivate(path.join(artifactDir, 'plan.json'), { ...prepared, proposal_id: proposalId, input_sha256: sha(input), planned, planned_sha256: canonicalHash(planned) });
    if (execute) {
        await applyReplayPolicyRefresh(client, proposalId, proposal.xmin, prepared.patch);
        const afterResult = await client.from('prompt_proposals').select('*,xmin').eq('id', proposalId).single();
        if (afterResult.error) throw new Error(afterResult.error.message);
        const after = afterResult.data;
        assertFinalReadback(after, planned);
        if (after.eval_summary?.replay_retirement_policy_version !== replay.REPLAY_RETIREMENT_POLICY_VERSION) throw new Error('Policy version readback mismatch.');
        await writePrivate(path.join(artifactDir, 'after.json'), after);
        await writePrivate(path.join(artifactDir, 'marker.json'), { state: 'applied', proposal_id: proposalId, input_sha256: sha(input), downstream_fingerprint: verification.codeProposalVerificationFingerprint(after), model_calls: 0 });
        console.log(JSON.stringify({ state: 'applied', artifactDir, input_sha256: sha(input), downstream_fingerprint: verification.codeProposalVerificationFingerprint(after), statuses: prepared.statuses }, null, 2));
    } else console.log(JSON.stringify({ state: 'dry-run', artifactDir, input_sha256: sha(input), statuses: prepared.statuses, model_calls: 0 }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { loadMembers, replayCallbacks, assertFinalReadback, canonicalHash, recoverAppliedRefresh };

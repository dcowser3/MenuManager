#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: process.env.MENUMANAGER_ENV_FILE || path.join(process.cwd(), '.env'), quiet: true });

const rewrite = require('./lib/manual-rule-rewrite');
const verification = require('../services/dashboard/dist/lib/code-proposal-verification');
const { buildCorrectionRuleRecord } = require('../services/dashboard/dist/lib/learning-correction-rules');

const PROPOSAL_ID = '72c144aa-c33e-4873-85e8-6e48537e799e';
const apply = process.argv.includes('--apply');
const markerPath = process.env.MENUMANAGER_MANUAL_REWRITE_MARKER
    || path.join(process.cwd(), 'tmp', 'code-proposals', PROPOSAL_ID, 'manual-rule-rewrite', 'recovery.json');

async function main() {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!process.env.SUPABASE_URL || !key) throw new Error('Supabase service credentials are required.');
    const client = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const adapter = rewrite.createSupabaseRewriteAdapter(client, PROPOSAL_ID);
    const state = await adapter.readState();
    const oldRows = state.correctionRules.filter((row) => rewrite.OLD_IDS.includes(row.correction_id));
    const targetHashes = Object.fromEntries(oldRows.map((row) => [row.correction_id, rewrite.hash(row)]));
    const fingerprint = verification.codeProposalVerificationFingerprint(state.proposal);
    let plan;
    if (fs.existsSync(markerPath)) {
        plan = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        plan = { ...plan, phase: 'planned' };
        delete plan.plan_sha256;
        delete plan.previous_phase;
    } else if (oldRows.length === rewrite.OLD_IDS.length) {
        plan = rewrite.buildManualRuleRewritePlan({
            correctionRules: state.correctionRules,
            proposal: state.proposal,
            expectedProposalFingerprint: fingerprint,
            expectedTargetHashes: targetHashes,
            reviewerName: 'Derian',
            buildCorrectionRuleRecord,
            codeProposalVerificationFingerprint: verification.codeProposalVerificationFingerprint,
        });
    } else if (oldRows.length === 0 && !state.correctionRules.some((row) => row.correction_id === rewrite.NEW_ID)) {
        plan = rewrite.buildPredeletedRecoveryPlan({
            correctionRules: state.correctionRules,
            proposal: state.proposal,
            expectedProposalFingerprint: fingerprint,
            reviewerName: 'Derian',
            buildCorrectionRuleRecord,
            codeProposalVerificationFingerprint: verification.codeProposalVerificationFingerprint,
        });
    } else {
        throw new Error('Manual rewrite live rows are partially present or conflicting.');
    }
    if (!apply) {
        process.stdout.write(`${JSON.stringify({ status: 'ready', proposal_id: PROPOSAL_ID, old_ids: rewrite.OLD_IDS, new_id: rewrite.NEW_ID, proposal_before_sha256: plan.proposal_before_sha256, proposal_after_sha256: plan.proposal_after_sha256, marker_path: markerPath, model_calls: 0 }, null, 2)}\n`);
        return;
    }
    const result = await rewrite.runManualRuleRewrite({ adapter, markerPath, plan, codeProposalVerificationFingerprint: verification.codeProposalVerificationFingerprint });
    process.stdout.write(`${JSON.stringify({ status: result.phase, proposal_id: PROPOSAL_ID, marker_path: markerPath, model_calls: 0 }, null, 2)}\n`);
}

main().catch((error) => { console.error(`${error?.message || error}`); process.exitCode = 1; });

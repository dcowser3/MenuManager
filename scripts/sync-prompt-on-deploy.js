#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Deploy step: make the repo's QA prompt the approved prompt when the repo is newer.
 *
 * Runs in a one-off dashboard container before the stack is swapped (see
 * .github/workflows/deploy-lightsail.yml). The host writes tmp/prompt-lineage.txt (the
 * sha256 of every committed version of sop-processor/qa_prompt.txt) because the image has
 * no .git. Decision rules live in services/dashboard/lib/prompt-sync.ts:
 *
 *   in sync                          -> nothing
 *   DB copy is in the repo history   -> pin the repo file as a new approved row, so the
 *                                       new containers start on it
 *   DB copy is NOT in the history    -> a dashboard approval git has never seen: keep it,
 *                                       write a system_alert, print a GitHub warning
 *   no lineage                       -> warn only
 *
 * Never blocks a deploy (always exits 0): a prompt problem must not stop a code fix
 * from shipping. Background: prod ran the Jul 30 2026 prompt until Oct 13 because repo
 * edits were reverted by the startup sync and nothing pinned them.
 *
 * Usage: node scripts/sync-prompt-on-deploy.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const {
    PROMPT_PROPOSALS_TABLE,
    getSupabase,
    insertApprovedPrompt,
    pickEffective,
} = require('./commit-runtime-prompt');

function loadPromptSyncLib() {
    const distPath = path.join(repoRoot, 'services', 'dashboard', 'dist', 'lib', 'prompt-sync.js');
    if (!fs.existsSync(distPath)) {
        throw new Error(`prompt-sync lib not built at ${distPath}; run: npm run build --workspace=services/dashboard`);
    }
    return require(distPath);
}

function warn(message) {
    // ::warning:: surfaces as an annotation on the GitHub Actions run.
    console.log(`::warning::${message}`);
}

async function runPromptDeploySync({ dryRun = false, supabase, filePrompt, lineage, lib, commit = '' }) {
    const { data: rows, error } = await supabase
        .from(PROMPT_PROPOSALS_TABLE)
        .select('id, cycle_id, status, final_prompt, proposed_prompt, reviewed_at')
        .in('status', ['approved', 'approved_modified'])
        .order('reviewed_at', { ascending: false })
        .limit(5);
    if (error) throw new Error(`Failed to read prompt_proposals: ${error.message}`);

    const effective = pickEffective(rows);
    const decision = lib.decidePromptSync({
        filePrompt,
        dbPrompt: effective ? effective.prompt : null,
        lineage: lineage ? lineage.hashes : null,
    });
    const repoSha = lib.promptSha256(filePrompt);
    const dbSha = effective ? lib.promptSha256(effective.prompt) : '';
    console.log(`QA prompt: repo sha256 ${repoSha.slice(0, 12)}, DB approved sha256 ${dbSha.slice(0, 12) || '(none)'}, lineage ${lineage ? `${lineage.hashes.size} versions (${lineage.source})` : 'missing'}`);
    console.log(`Decision: ${decision.action} (${decision.reason})`);

    const shouldPin = decision.action === 'keep_file';
    if (shouldPin) {
        if (dryRun) {
            console.log('Dry run: would pin the repo prompt as the approved prompt.');
            return { decision, pinned: false };
        }
        const nowIso = new Date().toISOString();
        await insertApprovedPrompt(supabase, {
            prompt: filePrompt,
            previousPrompt: effective ? effective.prompt : filePrompt,
            cycleId: `repo-deploy-${repoSha.slice(0, 12)}-${nowIso.replace(/[:.]/g, '-')}`,
            reviewer: 'deploy (sync-prompt-on-deploy.js)',
            notes: `Pinned the repo qa_prompt.txt at deploy${commit ? ` of ${commit}` : ''}: the DB approved copy is an older version of this file.`,
            analysis: 'Deploy pin — no LLM analysis. Content is the committed repo prompt.',
            source: 'repo_deploy',
            reviewedAt: nowIso,
        });
        console.log('Pinned the repo prompt as the approved prompt.');
        return { decision, pinned: true };
    }

    if (decision.action === 'restore_db' && decision.reason === 'db_not_in_repo_history') {
        const message = `The approved QA prompt in the DB (proposal ${effective.row.id}, sha256 ${dbSha.slice(0, 12)}) is not in git, so prod keeps it and this deploy's prompt edits (repo sha256 ${repoSha.slice(0, 12)}) are NOT live. Run "node scripts/commit-runtime-prompt.js --pull", merge, commit, and redeploy.`;
        warn(message);
        if (!dryRun) {
            try {
                await supabase.from('system_alerts').insert({
                    alert_type: 'qa_prompt_not_in_git',
                    severity: 'warning',
                    service: 'deploy',
                    message,
                    details: { proposal_id: effective.row.id, db_sha256: dbSha, repo_sha256: repoSha, commit: commit || null },
                });
            } catch (e) {
                console.error(`(could not write system_alerts row: ${e.message})`);
            }
        }
    } else if (decision.action === 'restore_db') {
        warn('QA prompt lineage is missing (tmp/prompt-lineage.txt), so the deploy cannot tell whether the repo prompt is newer than the DB copy. Prod keeps the DB copy.');
    }
    return { decision, pinned: false };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const lib = loadPromptSyncLib();
    const promptPath = path.join(repoRoot, 'sop-processor', 'qa_prompt.txt');
    const filePrompt = fs.readFileSync(promptPath, 'utf8');
    const lineage = lib.loadPromptLineage(repoRoot);
    await runPromptDeploySync({
        dryRun,
        supabase: getSupabase(),
        filePrompt,
        lineage,
        lib,
        commit: `${process.env.DEPLOY_COMMIT || ''}`.trim(),
    });
}

if (require.main === module) {
    main().catch((err) => {
        warn(`QA prompt deploy sync failed: ${err.message || err}. Prod keeps whatever prompt the DB holds.`);
        process.exit(0);
    });
}

module.exports = { runPromptDeploySync };

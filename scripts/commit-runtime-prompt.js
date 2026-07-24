#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Make hand edits to the runtime QA prompt survive restarts.
 *
 * The dashboard treats the latest approved row in `prompt_proposals` as the
 * source of truth: on every startup `syncEffectivePromptFromDb()` restores that
 * row's prompt over `sop-processor/qa_prompt.txt`. So any edit made directly to
 * the runtime file (bypassing the proposal/approval flow) is silently reverted
 * on the next restart. See docs/design-docs/white-label-config.md
 * ("QA rulebook: seed vs. runtime vs. DB").
 *
 * This script closes the loop the app's own mechanism uses: it inserts a fresh
 * `approved` proposal whose prompt equals the current runtime file. After it
 * runs, DB-latest == runtime file, so the startup sync becomes a no-op and the
 * hand edits are durable. Re-run it any time you edit the runtime file by hand.
 *
 * Usage (from repo root, .env with SUPABASE_* must be present):
 *   node scripts/commit-runtime-prompt.js               # dry run — shows drift, writes nothing
 *   node scripts/commit-runtime-prompt.js --apply        # insert the approved row
 *   node scripts/commit-runtime-prompt.js --apply --reviewer "Derian" --note "re-apply allergen rules"
 *   node scripts/commit-runtime-prompt.js --file path/to/qa_prompt.txt --apply
 *
 * Inside a container (where the tmp/db volume lives), same script:
 *   docker compose -f docker-compose.dev.yml exec -T dashboard node /app/scripts/commit-runtime-prompt.js --apply
 *
 * Idempotent: if DB-latest already equals the runtime file, it reports "in sync"
 * and inserts nothing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const { createClient } = require('@supabase/supabase-js');
const { requireSupabaseServiceKey } = require('./lib/supabase-key');

const PROMPT_PROPOSALS_TABLE = 'prompt_proposals';

function parseArgs(argv) {
    const args = {
        apply: false,
        file: path.join(repoRoot, 'sop-processor', 'qa_prompt.txt'),
        reviewer: 'manual reconcile (commit-runtime-prompt.js)',
        note: null,
    };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--apply') args.apply = true;
        else if (arg === '--dry-run') args.apply = false;
        else if (arg === '--file') args.file = path.resolve(argv[++i] || args.file);
        else if (arg === '--reviewer') args.reviewer = `${argv[++i] || args.reviewer}`;
        else if (arg === '--note') args.note = `${argv[++i] || ''}`;
        else if (arg === '--help' || arg === '-h') args.help = true;
        else console.warn(`Ignoring unknown argument: ${arg}`);
    }
    return args;
}

function getSupabase() {
    const url = `${process.env.SUPABASE_URL || ''}`.trim();
    const key = requireSupabaseServiceKey(process.env);
    return createClient(url, key);
}

function sha(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Mirror pickEffectivePrompt() in services/dashboard/lib/improvement-cycle-core.ts:
// the effective prompt is the newest approved/approved_modified row that has a
// non-empty final_prompt||proposed_prompt.
function pickEffective(rows) {
    const approved = (rows || [])
        .filter((r) => ['approved', 'approved_modified'].includes(`${r.status || ''}`))
        .filter((r) => `${r.final_prompt || r.proposed_prompt || ''}`.trim())
        .sort((a, b) => Date.parse(b.reviewed_at || '') - Date.parse(a.reviewed_at || ''));
    if (!approved.length) return null;
    const top = approved[0];
    return { prompt: `${top.final_prompt || top.proposed_prompt}`, row: top };
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 34).join('\n').replace(/^ \*?/gm, ''));
        return;
    }

    if (!fs.existsSync(args.file)) {
        throw new Error(`Runtime prompt file not found: ${args.file}`);
    }
    const runtimePrompt = fs.readFileSync(args.file, 'utf8');
    if (!runtimePrompt.trim()) {
        throw new Error(`Runtime prompt file is empty: ${args.file}`);
    }

    const supabase = getSupabase();

    // Same query shape as syncEffectivePromptFromDb() so we compare against the
    // exact row the dashboard would restore on startup.
    const { data: rows, error } = await supabase
        .from(PROMPT_PROPOSALS_TABLE)
        .select('id, cycle_id, status, final_prompt, proposed_prompt, reviewed_at')
        .in('status', ['approved', 'approved_modified'])
        .order('reviewed_at', { ascending: false })
        .limit(5);
    if (error) throw new Error(`Failed to read prompt_proposals: ${error.message}`);

    const effective = pickEffective(rows);
    const runtimeHash = sha(runtimePrompt);

    console.log(`Runtime file:       ${args.file}`);
    console.log(`Runtime length:     ${runtimePrompt.length} chars  (sha256 ${runtimeHash.slice(0, 12)})`);
    if (effective) {
        const dbHash = sha(effective.prompt);
        console.log(`DB latest approved: proposal ${effective.row.id} (cycle ${effective.row.cycle_id || 'n/a'}, ${effective.row.status}, reviewed ${effective.row.reviewed_at || 'n/a'})`);
        console.log(`DB latest length:   ${effective.prompt.length} chars  (sha256 ${dbHash.slice(0, 12)})`);
        if (dbHash === runtimeHash) {
            console.log('\n✅ In sync — DB latest approved prompt already equals the runtime file. Nothing to do.');
            return;
        }
        console.log(`\n⚠️  DRIFT: DB latest approved differs from the runtime file by ${Math.abs(effective.prompt.length - runtimePrompt.length)} chars. A restart would REVERT the runtime file to the DB copy.`);
    } else {
        console.log('DB latest approved: (none found — no approved proposal exists yet)');
        console.log('\n⚠️  No approved proposal exists; a restart would not restore from DB, but committing the current runtime file makes it the durable source of truth going forward.');
    }

    if (!args.apply) {
        console.log('\nDry run — no changes written. Re-run with --apply to insert an approved proposal that pins the current runtime file as the source of truth.');
        return;
    }

    const nowIso = new Date().toISOString();
    const cycleId = `manual-reconcile-${nowIso.replace(/[:.]/g, '-')}`;
    const noteParts = [
        'Manual reconciliation: pinned the live runtime qa_prompt.txt as the approved source of truth so hand edits survive restarts.',
    ];
    if (args.note) noteParts.push(args.note);

    // Full row, then degrade gracefully if optional columns are missing on this
    // Supabase (mirrors improvement-cycle.js insert fallbacks).
    let row = {
        cycle_id: cycleId,
        current_prompt: effective ? effective.prompt : runtimePrompt,
        proposed_prompt: runtimePrompt,
        final_prompt: runtimePrompt,
        prompt_diff: null,
        correction_rule_count: 0,
        submission_count: 0,
        llm_analysis: 'Manual reconciliation — no LLM analysis. Content copied verbatim from the runtime prompt file.',
        llm_model: 'manual',
        status: 'approved',
        reviewer_name: args.reviewer,
        reviewer_notes: noteParts.join(' '),
        reviewed_at: nowIso,
        source: 'manual_reconcile',
        prompt_length: runtimePrompt.length,
    };

    const optionalCols = ['source', 'prompt_length', 'reviewer_notes', 'llm_analysis', 'prompt_diff', 'current_prompt', 'final_prompt'];
    let insertError;
    for (let attempt = 0; attempt < optionalCols.length + 1; attempt += 1) {
        ({ error: insertError } = await supabase.from(PROMPT_PROPOSALS_TABLE).insert(row));
        if (!insertError) break;
        // Strip whichever optional column PostgREST complained about and retry.
        const offending = optionalCols.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(insertError.message || '') && c in row);
        if (!offending) break;
        console.warn(`prompt_proposals.${offending} unavailable on this DB; retrying without it. (${insertError.message})`);
        const { [offending]: _dropped, ...rest } = row;
        row = rest;
    }
    if (insertError) throw new Error(`Failed to insert approved proposal: ${insertError.message}`);

    console.log(`\n✅ Inserted approved proposal (cycle_id ${cycleId}). DB latest approved now equals the runtime file.`);
    console.log('   Next dashboard restart: syncEffectivePromptFromDb() is a no-op and the hand edits persist.');
    console.log('   Verify: restart the stack, then re-run this script — it should report "In sync".');
}

main().catch((err) => {
    console.error(`\n❌ ${err.message || err}`);
    process.exit(1);
});

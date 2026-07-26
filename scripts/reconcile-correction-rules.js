#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Recover correction rules stranded in the db service's local JSON fallback.
 *
 * When a required Supabase column is missing (e.g. applies_to_menu_type before
 * migration 20260614), every dashboard correction-rule save fails its Supabase
 * insert and falls to tmp/db/correction_rules.json. The improvement cycle reads
 * Supabase directly, so those rules are invisible. After applying the migration,
 * run this once to upsert the local-only rules into Supabase.
 *
 * Must run where the local fallback volume is mounted (e.g. inside the dashboard
 * or db container, which mount menumanager_tmp:/app/tmp):
 *   docker compose exec -T dashboard node /app/scripts/reconcile-correction-rules.js          # dry run
 *   docker compose exec -T dashboard node /app/scripts/reconcile-correction-rules.js --apply
 *
 * Dedupe key is (submission_id, correction_id); re-running is safe.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const { createClient } = require('@supabase/supabase-js');

function parseArgs(argv) {
    const args = { apply: false, file: path.join(repoRoot, 'tmp', 'db', 'correction_rules.json') };
    for (let i = 2; i < argv.length; i += 1) {
        if (argv[i] === '--apply') args.apply = true;
        else if (argv[i] === '--dry-run') args.apply = false;
        else if (argv[i] === '--file') args.file = path.resolve(argv[++i] || args.file);
    }
    return args;
}

const { requireSupabaseServiceKey } = require('./lib/supabase-key');

function getSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = requireSupabaseServiceKey(process.env);
    if (!url || !key) throw new Error('SUPABASE_URL and a service key are required (SUPABASE_SERVICE_ROLE_KEY or legacy SUPABASE_SERVICE_KEY)');
    return createClient(url, key);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MENU_SCOPES = new Set(['all', 'food', 'beverage']);

// Normalize a local fallback record into a Supabase-insertable row. Mirrors the
// db service's buildCorrectionRuleStorageRecord defaults so constraints pass.
function toSupabaseRecord(local) {
    const scope = `${local.applies_to_menu_type || 'all'}`.toLowerCase();
    const record = {
        submission_id: `${local.submission_id || ''}`,
        correction_id: `${local.correction_id || ''}`,
        original_text: local.original_text || null,
        corrected_text: local.corrected_text || null,
        change_type: local.change_type || null,
        rule: `${local.rule || ''}`,
        applies_to_menu_type: MENU_SCOPES.has(scope) ? scope : 'all',
        is_location_specific: !!local.is_location_specific,
        project_name: local.project_name || null,
        restaurant_name: local.restaurant_name || '',
        location: local.location || 'All properties (global rule)',
        other_applicable_locations: Array.isArray(local.other_applicable_locations) ? local.other_applicable_locations : [],
        reviewer_name: local.reviewer_name || null,
        status: local.status || 'accepted',
        source: local.source || 'human',
        occurrences: Number(local.occurrences || 1),
        confidence: local.confidence ?? null,
        submission_ids: Array.isArray(local.submission_ids) ? local.submission_ids : null,
        prompt_cycle_id: local.prompt_cycle_id || null,
        consumed_at: local.consumed_at || null,
    };
    if (local.created_at) record.created_at = local.created_at;
    // Preserve a real UUID id; let Supabase generate one otherwise.
    if (local.id && UUID_REGEX.test(`${local.id}`)) record.id = local.id;
    return record;
}

function dedupeKey(rule) {
    return `${rule.submission_id || ''}${rule.correction_id || ''}`;
}

async function main() {
    const args = parseArgs(process.argv);

    if (!fs.existsSync(args.file)) {
        console.log(`No local correction_rules file at ${args.file}; nothing to reconcile.`);
        return;
    }
    let local;
    try {
        local = JSON.parse(fs.readFileSync(args.file, 'utf8'));
    } catch (error) {
        throw new Error(`Could not parse ${args.file}: ${error.message}`);
    }
    const localRules = Array.isArray(local) ? local : Object.values(local || {});
    console.log(`Local correction rules: ${localRules.length} (${args.file})`);
    if (!localRules.length) {
        console.log('Nothing to reconcile.');
        return;
    }

    const supabase = getSupabase();
    const existing = new Set();
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
            .from('correction_rules')
            .select('submission_id, correction_id')
            .range(from, from + 999);
        if (error) throw new Error(`Failed to read Supabase correction_rules: ${error.message}`);
        for (const row of data || []) existing.add(dedupeKey(row));
        if (!data || data.length < 1000) break;
    }
    console.log(`Existing Supabase rules: ${existing.size}`);

    const missing = localRules.filter((rule) => !existing.has(dedupeKey(rule)));
    console.log(`Local rules missing from Supabase: ${missing.length}${args.apply ? '' : ' (dry run; use --apply to write)'}`);
    for (const rule of missing.slice(0, 25)) {
        console.log(`  [${rule.status || 'accepted'}] ${(rule.original_text || '(freeform)').slice(0, 40)} -> ${(rule.corrected_text || '').slice(0, 40)}`);
    }

    if (!args.apply || !missing.length) return;

    let inserted = 0;
    let failed = 0;
    for (const rule of missing) {
        const { error } = await supabase.from('correction_rules').insert(toSupabaseRecord(rule));
        if (error) {
            failed += 1;
            console.error(`  insert failed (${rule.submission_id}/${rule.correction_id}): ${error.message}`);
        } else {
            inserted += 1;
        }
    }
    console.log(`Done. inserted=${inserted} failed=${failed}`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

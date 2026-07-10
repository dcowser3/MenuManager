#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Pre-deploy schema-drift gate (Phase A).
 *
 * Compares the repo's declared schema (supabase/schema.sql) against the LIVE
 * database and fails the deploy when a migration is behind — the exact trap that
 * silently stranded reviewer correction rules in the local JSON fallback four
 * times (missing table, missing columns, stale NOT NULL). See
 * docs/design-docs/schema-drift-gate.md.
 *
 * Access model: we only reach the DB through PostgREST, whose OpenAPI spec lists
 * every table's columns and its `required` set (NOT NULL without default). That is
 * enough to catch the missing-column / stale-nullability class; it is blind to
 * indexes, CHECK/FK constraints and defaults (call those out in the doc).
 *
 * Behavior is controlled by env (set in the host .env, so flipping is a one-liner):
 *   SCHEMA_DRIFT_GATE=warn    (default) → print + alert, but exit 0 (non-blocking)
 *   SCHEMA_DRIFT_GATE=block             → exit 1 on any error-severity drift
 *   SCHEMA_DRIFT_IGNORE_TABLES=a,b      → skip these tables (escape hatch)
 *
 * Ships defaulting to `warn` so the initial rollout reports drift without blocking
 * deploys (prod has a known pre-existing drift: submitter_profiles.name_normalized).
 * Flip to `block` in the host .env once the reported drift is triaged.
 *
 * On any error-severity drift it also writes a `supabase_schema_drift` row to
 * system_alerts (visible on /alerts) regardless of block/warn.
 *
 * Run standalone or, in deploy, inside the dashboard container which has the repo,
 * the compiled db lib, and the Supabase creds:
 *   node scripts/check-schema-drift.js
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const { createClient } = require('@supabase/supabase-js');
const { requireSupabaseServiceKey } = require('./lib/supabase-key');

// Pure parse/diff logic lives in the tested db lib; consume its compiled output
// (same dist-consumption pattern as improvement-cycle.js).
function loadSchemaDriftLib() {
    const distPath = path.join(repoRoot, 'services', 'db', 'dist', 'lib', 'schema-drift.js');
    if (!fs.existsSync(distPath)) {
        throw new Error(`schema-drift lib not built at ${distPath}; run: npm run build --workspace=services/db`);
    }
    return require(distPath);
}

async function fetchOpenApiSpec(url, key) {
    const resp = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) {
        throw new Error(`PostgREST OpenAPI fetch failed: HTTP ${resp.status}`);
    }
    return resp.json();
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const url = `${process.env.SUPABASE_URL || ''}`.trim();
    const key = requireSupabaseServiceKey(process.env);
    const mode = dryRun ? 'dry-run' : `${process.env.SCHEMA_DRIFT_GATE || 'warn'}`.trim().toLowerCase();
    const ignoreTables = new Set(
        `${process.env.SCHEMA_DRIFT_IGNORE_TABLES || ''}`
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );

    const { parseSchemaSql, parseOpenApiSpec, diffSchemas, diffNullableConstraints, NULLABLE_COLUMNS } = loadSchemaDriftLib();

    const schemaSql = fs.readFileSync(path.join(repoRoot, 'supabase', 'schema.sql'), 'utf8');
    const expected = parseSchemaSql(schemaSql);
    const spec = await fetchOpenApiSpec(url, key);
    const live = parseOpenApiSpec(spec);

    const findings = [
        ...diffSchemas(expected, live, ignoreTables),
        ...diffNullableConstraints(live, NULLABLE_COLUMNS, ignoreTables),
    ];
    const errors = findings.filter((f) => f.severity === 'error');
    const warnings = findings.filter((f) => f.severity === 'warning');

    console.log(`Schema-drift gate: ${expected.size} tables declared, ${live.size} live; ${errors.length} error(s), ${warnings.length} warning(s). Mode: ${mode}.`);
    for (const f of errors) console.error(`  ERROR   [${f.kind}] ${f.message}`);
    for (const f of warnings) console.warn(`  WARNING [${f.kind}] ${f.message}`);

    if (errors.length === 0) {
        console.log('Schema matches the repo. Proceeding.');
        return;
    }

    if (dryRun) {
        console.log('Dry run — not writing an alert or failing. (Findings above are advisory.)');
        return;
    }

    // Surface on the /alerts dashboard regardless of block/warn — never silent.
    try {
        const supabase = createClient(url, key);
        await supabase.from('system_alerts').insert({
            alert_type: 'supabase_schema_drift',
            severity: 'error',
            service: 'deploy',
            message: `Pre-deploy schema-drift gate found ${errors.length} error-severity mismatch(es) between supabase/schema.sql and the live database. Apply the pending migration(s) in supabase/migrations.`,
            details: { mode, errors: errors.map(({ table, column, kind, message }) => ({ table, column, kind, message })) },
        });
    } catch (e) {
        console.error(`(could not write system_alerts row: ${e.message})`);
    }

    if (mode === 'warn') {
        console.warn('SCHEMA_DRIFT_GATE=warn — not blocking the deploy, but the drift above must be fixed.');
        return;
    }
    console.error('Schema drift detected — blocking the deploy. Apply the pending migration(s) in supabase/migrations, then redeploy. (Set SCHEMA_DRIFT_GATE=warn to override temporarily.)');
    process.exitCode = 1;
}

main().catch((error) => {
    // A gate that can't run must not silently pass. But an infra hiccup (Supabase
    // unreachable) shouldn't hard-block every deploy: block only in the default
    // mode, and make the reason loud.
    console.error(`Schema-drift gate failed to run: ${error.message}`);
    if (`${process.env.SCHEMA_DRIFT_GATE || 'warn'}`.trim().toLowerCase() === 'block') {
        process.exitCode = 1;
    }
});

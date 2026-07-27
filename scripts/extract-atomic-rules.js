#!/usr/bin/env node
/**
 * Recover atomic replacement rules trapped inside whole-line corrections.
 *
 * Reviewers correct a menu line at a time, so the learned corpus stores whole lines.
 * "veggies -> vegetables" only ever existed inside two "Grilled Tlayuda, ..." rows, so
 * the improvement loop had nothing to generalize from and a reviewer had to re-explain
 * "Veggie -> Vegetable" from scratch months later.
 *
 * Usage:
 *   node scripts/extract-atomic-rules.js            # report only (default)
 *   node scripts/extract-atomic-rules.js --write    # insert candidates as PENDING
 *
 * Candidates are never inserted as accepted — they go through the same human review
 * gate as any other learned rule.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env'), quiet: true });

const { createClient } = require('@supabase/supabase-js');

function requireDashboardLib(relPath) {
    const sourcePath = path.join(repoRoot, 'services', 'dashboard', 'lib', `${relPath}.ts`);
    try {
        require(require.resolve('ts-node/register/transpile-only', {
            paths: [repoRoot, path.join(repoRoot, 'services', 'dashboard')],
        }));
        return require(sourcePath);
    } catch {
        // Fall back to build output in lean installs that do not include ts-node.
    }
    const distPath = path.join(repoRoot, 'services', 'dashboard', 'dist', 'lib', `${relPath}.js`);
    if (!fs.existsSync(distPath)) {
        throw new Error(`Dashboard lib ${relPath} unavailable; run npm run build --workspace=services/dashboard`);
    }
    return require(distPath);
}

const core = requireDashboardLib('improvement-cycle-core');

async function main() {
    const write = process.argv.includes('--write');
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and a service key are required.');
    const supabase = createClient(url, key);

    const { data, error } = await supabase
        .from('correction_rules')
        .select('id,original_text,corrected_text,status,applies_to_menu_type')
        .in('status', ['accepted', 'pending'])
        .limit(2000);
    if (error) throw new Error(`Failed to fetch correction rules: ${error.message}`);

    // Only human-approved knowledge is extracted FROM, but pending atomic rules still
    // count as coverage — otherwise re-running would re-propose what a previous run
    // already queued for review.
    const accepted = (data || []).filter((r) => r.status === 'accepted');
    const pendingAtomic = (data || []).filter((r) => r.status === 'pending' && core.isAtomicRuleText(r.original_text || ''));
    const report = core.extractAtomicRulesFromCorpus([...accepted, ...pendingAtomic]);

    console.log(`Scanned ${accepted.length} accepted rules (+${pendingAtomic.length} pending atomic rules counted as coverage).\n`);

    console.log(`CANDIDATES (${report.candidates.length}) — would be inserted as pending:`);
    for (const c of report.candidates) {
        console.log(`  ${JSON.stringify(c.original_text)} -> ${JSON.stringify(c.corrected_text)}  [${c.change_type}]  seen ${c.occurrences}x`);
    }
    if (!report.candidates.length) console.log('  (none)');

    console.log(`\nCONTEXT-DEPENDENT (${report.contextDependent.length}) — never proposed:`);
    for (const c of report.contextDependent) console.log(`  ${JSON.stringify(c.a)} / ${JSON.stringify(c.b)} — ${c.reason}`);
    if (!report.contextDependent.length) console.log('  (none)');

    console.log(`\nALREADY COVERED (${report.alreadyCovered.length}):`);
    for (const c of report.alreadyCovered) console.log(`  ${JSON.stringify(c.original_text)} -> ${JSON.stringify(c.corrected_text)}`);
    if (!report.alreadyCovered.length) console.log('  (none)');

    console.log(`\nSKIPPED (${report.skipped.length}):`);
    const skipReasons = {};
    for (const s of report.skipped) skipReasons[s.reason] = (skipReasons[s.reason] || 0) + 1;
    for (const [reason, count] of Object.entries(skipReasons)) console.log(`  ${count}x ${reason}`);
    if (!report.skipped.length) console.log('  (none)');

    if (!write) {
        console.log('\nReport only. Re-run with --write to insert the candidates as pending rules.');
        return;
    }
    if (!report.candidates.length) {
        console.log('\nNothing to write.');
        return;
    }

    const { getTenantConfig } = require('@menumanager/tenant-config');
    const allRestaurants = `All ${getTenantConfig().shortName} restaurants`;
    const stamp = new Date().toISOString();
    const payloads = report.candidates.map((c, i) => ({
        submission_id: `atomic-extraction-${stamp}`,
        correction_id: `atomic-extraction-${stamp}-${i}`,
        original_text: c.original_text,
        corrected_text: c.corrected_text,
        change_type: c.change_type,
        rule: `Recovered from ${c.occurrences} approved whole-line correction(s) (${c.source_rule_ids.join(', ') || 'no ids'}); the atomic pair was never stored on its own.`,
        applies_to_menu_type: 'all',
        is_location_specific: false,
        location: 'All properties (global rule)',
        other_applicable_locations: [],
        restaurant_name: allRestaurants,
        reviewer_name: 'atomic-extraction',
        source: 'system',
        status: 'pending',
        occurrences: c.occurrences,
    }));

    const { error: insertError } = await supabase.from('correction_rules').insert(payloads);
    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);
    console.log(`\nInserted ${payloads.length} candidate(s) as PENDING for human review.`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});

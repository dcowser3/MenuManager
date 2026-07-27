#!/usr/bin/env node
/**
 * Build the canonical menu vocabulary from accepted rules + approved menus, and report
 * what near-miss detection would flag.
 *
 * Usage:
 *   node scripts/canonical-vocabulary-report.js               # vocabulary summary
 *   node scripts/canonical-vocabulary-report.js --replay      # replay against past corrections
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

const vocabLib = requireDashboardLib('canonical-vocabulary');
const core = requireDashboardLib('improvement-cycle-core');

function loadApprovedTexts() {
    const datasetPath = path.join(repoRoot, 'tmp', 'review-eval', 'dataset.jsonl');
    if (!fs.existsSync(datasetPath)) return [];
    return fs.readFileSync(datasetPath, 'utf8').trim().split('\n')
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean)
        .map((c) => `${c.ground_truth || ''}`)
        .filter(Boolean);
}

async function main() {
    const replay = process.argv.includes('--replay');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

    const { data: accepted, error } = await supabase
        .from('correction_rules').select('original_text,corrected_text').eq('status', 'accepted').limit(2000);
    if (error) throw new Error(`Failed to fetch rules: ${error.message}`);

    const approvedTexts = loadApprovedTexts();
    const vocabulary = vocabLib.buildCanonicalVocabulary({
        acceptedRules: accepted || [],
        approvedTexts,
        seedAmbiguousTerms: core.CONTEXT_DEPENDENT_TERMS,
    });

    const ambiguous = vocabulary.entries.filter((e) => e.ambiguous);
    console.log(`Canonical vocabulary: ${vocabulary.entries.length} terms `
        + `(${ambiguous.length} context-dependent), built from ${(accepted || []).length} accepted rules `
        + `and ${approvedTexts.length} approved menus (${vocabulary.legitimate.size} legitimate forms).\n`);

    console.log('CONTEXT-DEPENDENT (reported as questions, never corrections):');
    for (const e of ambiguous) console.log(`  ${JSON.stringify(e.canonical)} <-> ${JSON.stringify(e.alternate || '?')}`);
    if (!ambiguous.length) console.log('  (none)');

    console.log('\nUNAMBIGUOUS CANONICAL FORMS (sample):');
    for (const e of vocabulary.entries.filter((x) => !x.ambiguous).slice(0, 12)) {
        console.log(`  ${JSON.stringify(e.canonical)}  <- ${e.variants.map((v) => JSON.stringify(v)).join(', ')}`);
    }

    if (!replay) {
        console.log('\nRe-run with --replay to test against past reviewer corrections.');
        return;
    }

    const { data: corrections } = await supabase
        .from('correction_rules').select('original_text,corrected_text')
        .not('prompt_cycle_id', 'is', null).order('created_at', { ascending: false }).limit(40);

    console.log('\n--- replay against past reviewer corrections ---');
    let flagged = 0;
    for (const c of corrections || []) {
        const findings = vocabLib.findNearMisses(c.original_text || '', vocabulary);
        const label = `${c.original_text}`.slice(0, 52);
        if (!findings.length) { console.log(`  no-flag  ${JSON.stringify(label)}`); continue; }
        flagged++;
        for (const f of findings.slice(0, 2)) console.log(`  ${f.kind.toUpperCase().padEnd(9)} ${f.message}`);
    }
    console.log(`\n${flagged}/${(corrections || []).length} corrections produced at least one finding.`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });

#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Generates the code-rules manifest:
 *   - docs/references/code-rules-manifest.md   (code-only, committed, drift-tested)
 *   - docs/references/code-rules-manifest.json (code-only, committed)
 *   - tmp/rules-manifest/manifest-full.json    (code + live accepted correction rules;
 *                                               the improvement-cycle LLM input)
 *
 * Usage: npm run rules:manifest
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

function requireDashboardLib(relPath) {
    const sourcePath = path.join(repoRoot, 'services', 'dashboard', 'lib', `${relPath}.ts`);
    try {
        const tsNodeRegister = require.resolve('ts-node/register/transpile-only', {
            paths: [repoRoot, path.join(repoRoot, 'services', 'dashboard')],
        });
        require(tsNodeRegister);
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

async function fetchAcceptedRules() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return [];
    try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(url, key);
        const { data, error } = await supabase
            .from('correction_rules')
            .select('*')
            .eq('status', 'accepted')
            .limit(1000);
        if (error) throw new Error(error.message);
        return data || [];
    } catch (error) {
        console.warn(`Accepted correction rules unavailable (${error.message}); full manifest will contain code rules only.`);
        return [];
    }
}

async function main() {
    const { buildReviewRulesManifest, renderRulesManifestMarkdown } = requireDashboardLib('review-rules-manifest');

    // Committed, code-only artifacts (deterministic; no timestamps so the drift test can diff).
    const codeManifest = buildReviewRulesManifest({ acceptedCorrectionRules: [] });
    const markdown = renderRulesManifestMarkdown(codeManifest, { includeDynamic: false });

    const referencesDir = path.join(repoRoot, 'docs', 'references');
    await fsp.mkdir(referencesDir, { recursive: true });
    await fsp.writeFile(path.join(referencesDir, 'code-rules-manifest.md'), markdown);
    await fsp.writeFile(
        path.join(referencesDir, 'code-rules-manifest.json'),
        JSON.stringify(codeManifest, null, 2) + '\n'
    );

    // Full manifest with live accepted rules (LLM input; not committed).
    const acceptedRules = await fetchAcceptedRules();
    const fullManifest = buildReviewRulesManifest({ acceptedCorrectionRules: acceptedRules });
    const fullDir = path.join(repoRoot, 'tmp', 'rules-manifest');
    await fsp.mkdir(fullDir, { recursive: true });
    await fsp.writeFile(
        path.join(fullDir, 'manifest-full.json'),
        JSON.stringify({ generatedAt: new Date().toISOString(), ...fullManifest }, null, 2) + '\n'
    );
    await fsp.writeFile(
        path.join(fullDir, 'manifest-full.md'),
        renderRulesManifestMarkdown(fullManifest, { includeDynamic: true })
    );

    const byLayer = codeManifest.entries.reduce((acc, entry) => {
        acc[entry.layer] = (acc[entry.layer] || 0) + 1;
        return acc;
    }, {});
    console.log(`Committed manifest: ${codeManifest.entries.length} code rules -> docs/references/code-rules-manifest.{md,json}`);
    console.log(`By layer: ${JSON.stringify(byLayer)}`);
    console.log(`Full manifest: +${acceptedRules.length} accepted DB rules -> tmp/rules-manifest/manifest-full.{json,md}`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

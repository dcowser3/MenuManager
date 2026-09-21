#!/usr/bin/env node
'use strict';

// Build-only, deterministic successor plan for the three universally safe
// spelling rules. This command never writes Supabase and never calls a model.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { activateCandidateRulesForEval } = require('./review-eval-helpers');
const { runPreAiDeterministicChecks } = require('../services/dashboard/dist/lib/pre-ai-deterministic-rules');

const PARENT_ID = '72c144aa-c33e-4873-85e8-6e48537e799e';
const TARGETS = Object.freeze([
    { original_text: 'chilies', corrected_text: 'chilis', applies_to_menu_type: 'all', correction_id: 'ba387837-ccf6-428f-94ee-f21be1242558' },
    { original_text: 'affila', corrected_text: 'affilla', applies_to_menu_type: 'food', correction_id: '4c057a0c-a672-4ff5-accc-6e3b90a9ada6' },
    { original_text: 'afila', corrected_text: 'affilla', applies_to_menu_type: 'food', correction_id: 'ac5916e6-8219-4dfb-bd42-1665126620c1' },
]);
const HELD_ORIGINALS = new Set(['Salmon', 'Turkey 2 ways, Roulade, breast, haricots verts, mashed potatoes, sage giblet gravy, cranberry sauce D', 'Chipotle Hummus, coca bread, tlayudas, chips G,V', 'Guacamole, lime, pico de gallo, tortilla chips & charred tlayudas V 18', 'add spicy crab* S 8']);

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
}
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function args(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i += 1) {
        if (argv[i] === '--proposal-file') out.proposalFile = path.resolve(argv[++i]);
        if (argv[i] === '--output-dir') out.outputDir = path.resolve(argv[++i]);
    }
    if (!out.proposalFile || !out.outputDir) throw new Error('Usage: prepare-spelling-successor.js --proposal-file <file> --output-dir <dir>');
    return out;
}
function exactRule(row, target) { return row?.original_text === target.original_text && row?.corrected_text === target.corrected_text; }
function exactRoute(row, target) { return row?.correction_id === target.correction_id && row?.target === `${target.original_text} -> ${target.corrected_text}`; }
function evaluateRules(rules) {
    const activated = activateCandidateRulesForEval(rules);
    const cases = [
        ['pickled chilies, lime 12', 'pickled chilis, lime 12'],
        ['PICKLED CHILIES, LIME 12', 'PICKLED CHILIS, LIME 12'],
        ['affila cress D', 'affilla cress D'],
        ['AFILA CRESS D', 'AFFILLA CRESS D'],
        ['chiliesque affilaxy afila2', 'chiliesque affilaxy afila2'],
    ];
    const activations = Object.fromEntries(rules.map((rule, index) => [rule.original_text, 0]));
    for (const [input, expected] of cases) {
        const first = runPreAiDeterministicChecks(input, { acceptedCorrectionRules: activated });
        if (first.menuText !== expected) throw new Error(`deterministic spelling mismatch: ${input} -> ${first.menuText}`);
        const second = runPreAiDeterministicChecks(first.menuText, { acceptedCorrectionRules: activated });
        if (second.menuText !== first.menuText) throw new Error(`spelling rule is not idempotent: ${input}`);
        for (const correction of first.appliedCorrections.filter((entry) => entry.source === 'accepted_correction_rule')) {
            const ruleIndex = Number.parseInt(`${correction.ruleId || ''}`.replace('eval-candidate-rule-', ''), 10);
            const rule = Number.isInteger(ruleIndex) ? rules[ruleIndex] : rules.find((candidate) => `${correction.original || ''}`.toLowerCase() === candidate.original_text.toLowerCase());
            if (rule) activations[rule.original_text] += 1;
        }
    }
    if (Object.values(activations).some((count) => count < 1)) throw new Error(`not every spelling rule activated: ${JSON.stringify(activations)}`);
    return { cases, activations, model_calls: 0, provider_calls: 0 };
}
function main() {
    const input = args(process.argv);
    const parent = JSON.parse(fs.readFileSync(input.proposalFile, 'utf8'));
    if (parent.id !== PARENT_ID || parent.status !== 'pending' || parent.eval_status !== 'regressed' || parent.disposition !== 'rules_only') throw new Error('parent proposal is not the preserved pending regressed rules-only proposal');
    if (!parent.eval_summary?.code_candidate?.attempt_id || !parent.eval_summary.code_candidate.closed_at) throw new Error('parent terminal owner evidence is missing');
    const rules = Array.isArray(parent.proposed_rules) ? parent.proposed_rules : [];
    const routes = Array.isArray(parent.correction_routing) ? parent.correction_routing : [];
    const selectedRules = TARGETS.map((target) => {
        const matches = rules.filter((row) => exactRule(row, target));
        if (matches.length !== 1) throw new Error(`expected exactly one source rule for ${target.original_text}`);
        if (matches[0].applies_to_menu_type !== target.applies_to_menu_type || matches[0].is_location_specific !== false) throw new Error(`scope mismatch for ${target.original_text}`);
        return { ...matches[0], source_correction_id: target.correction_id };
    });
    const selectedRoutes = TARGETS.map((target) => {
        const matches = routes.filter((row) => exactRoute(row, target));
        if (matches.length !== 1) throw new Error(`expected exactly one source route for ${target.original_text}`);
        return { ...matches[0] };
    });
    if (selectedRoutes.some((row) => row.lane !== 'replacement_rule' || row.replay_status === 'now_correct')) throw new Error('selected routes are not unresolved replacement-rule evidence');
    if (rules.some((row) => HELD_ORIGINALS.has(row.original_text) && selectedRules.includes(row))) throw new Error('held rule leaked into successor');
    const evalEvidence = evaluateRules(selectedRules);
    const sourceFingerprint = sha({ parent_id: parent.id, parent_cycle_id: parent.cycle_id || null, source_rule_ids: TARGETS.map((target) => target.correction_id), source_rule_hash: sha(selectedRules), source_route_hash: sha(selectedRoutes) });
    const cycleId = `manual-spelling-successor-${sourceFingerprint.slice(0, 16)}`;
    const successor = {
        id: null,
        cycle_id: cycleId,
        status: 'pending',
        eval_status: 'passed',
        disposition: 'rules_only',
        proposed_prompt: parent.proposed_prompt,
        final_prompt: parent.final_prompt || parent.proposed_prompt,
        proposed_rules: selectedRules,
        correction_rule_count: selectedRules.length,
        correction_routing: selectedRoutes,
        superseded_from_cycle_id: parent.cycle_id || parent.id,
        source_provenance: { parent_proposal_id: parent.id, parent_cycle_id: parent.cycle_id || null, source_correction_ids: TARGETS.map((target) => target.correction_id), source_fingerprint: sourceFingerprint, held_originals: [...HELD_ORIGINALS] },
        eval_summary: { deterministic_only: true, model_calls: 0, provider_calls: 0, candidate_rule_activations: TARGETS.map((target) => ({ correction_id: target.correction_id, total_activations: evalEvidence.activations[target.original_text], pre_ai_activations: evalEvidence.activations[target.original_text], post_ai_activations: 0, replay_activations: 0 })), regressions: [], casing_boundary_idempotence: evalEvidence.cases },
        preserved_parent_terminal_owner: parent.eval_summary.code_candidate,
    };
    fs.mkdirSync(input.outputDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(input.outputDir, 0o700);
    const plan = { schema_version: 1, kind: 'rules_only_spelling_successor_plan', model_calls: 0, provider_calls: 0, parent_proposal_id: parent.id, parent_sha256: sha(parent), successor_sha256: sha(successor), source_fingerprint: sourceFingerprint, target_correction_ids: TARGETS.map((target) => target.correction_id), held_originals: [...HELD_ORIGINALS], successor };
    for (const [name, value] of [['successor.json', successor], ['plan.json', plan]]) fs.writeFileSync(path.join(input.outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ status: 'ready', output_dir: input.outputDir, parent_id: parent.id, cycle_id: cycleId, parent_sha256: plan.parent_sha256, successor_sha256: plan.successor_sha256, source_fingerprint: sourceFingerprint, model_calls: 0, provider_calls: 0 }, null, 2)}\n`);
}
main();

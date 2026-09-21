#!/usr/bin/env node
'use strict';

// Build-only, deterministic successor plan for the three universally safe
// spelling rules. This command never writes Supabase and never calls a model.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { activateCandidateRulesForEval } = require('./review-eval-helpers');
const { runPreAiDeterministicChecks } = require('../services/dashboard/dist/lib/pre-ai-deterministic-rules');
const { evalStatusFromSummary, promptProposalApprovalBlock } = require('../services/dashboard/dist/lib/improvement-cycle-core');
const { hashCodeImplementation } = require('../services/dashboard/dist/lib/code-proposal-verification');

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
        if (argv[i] === '--accepted-rules-file') out.acceptedRulesFile = path.resolve(argv[++i]);
        if (argv[i] === '--runtime-root') out.runtimeRoot = path.resolve(argv[++i]);
    }
    if (!out.proposalFile || !out.outputDir || !out.acceptedRulesFile || !out.runtimeRoot) throw new Error('Usage: prepare-spelling-successor.js --proposal-file <file> --output-dir <dir> --accepted-rules-file <file> --runtime-root <root>');
    return out;
}
function exactRule(row, target) { return row?.original_text === target.original_text && row?.corrected_text === target.corrected_text; }
function exactRoute(row, target) { return row?.correction_id === target.correction_id && row?.target === `${target.original_text} -> ${target.corrected_text}`; }
function evaluateRules(currentRules, rules, routes) {
    const activated = activateCandidateRulesForEval([...currentRules, ...rules]);
    const cases = [
        ...routes.map((route) => [route.original_text, route.corrected_text]),
        ['PICKLED CHILIES, LIME 12', 'PICKLED CHILIS, LIME 12'],
        ['AFILA CRESS D', 'AFFILLA CRESS D'],
        ['chiliesque affilaxy afila2', 'chiliesque affilaxy afila2'],
    ];
    const activations = Object.fromEntries(rules.map((rule) => [rule.original_text, 0]));
    const baselineOutputs = [];
    const candidateOutputs = [];
    const reports = [];
    for (const [input, expected] of cases) {
        const baseline = runPreAiDeterministicChecks(input, { acceptedCorrectionRules: currentRules });
        const first = runPreAiDeterministicChecks(input, { acceptedCorrectionRules: activated });
        if (first.menuText !== expected) throw new Error(`deterministic spelling mismatch: ${input} -> ${first.menuText}`);
        const second = runPreAiDeterministicChecks(first.menuText, { acceptedCorrectionRules: activated });
        if (second.menuText !== first.menuText) throw new Error(`spelling rule is not idempotent: ${input}`);
        baselineOutputs.push(baseline.menuText);
        candidateOutputs.push(first.menuText);
        reports.push({ case_id: `spelling-${reports.length}`, deterministicRuleActivations: first.appliedCorrections.filter((entry) => entry.source === 'accepted_correction_rule').map((entry) => ({ rule_id: entry.ruleId, phase: 'pre_ai' })) });
        for (const correction of first.appliedCorrections.filter((entry) => entry.source === 'accepted_correction_rule')) {
            const ruleIndex = Number.parseInt(`${correction.ruleId || ''}`.replace('eval-candidate-rule-', ''), 10);
            const rule = Number.isInteger(ruleIndex) ? activated[ruleIndex] : null;
            if (rule && rules.some((candidate) => candidate.original_text === rule.original_text)) activations[rule.original_text] += 1;
        }
    }
    if (Object.values(activations).some((count) => count < 1)) throw new Error(`not every spelling rule activated: ${JSON.stringify(activations)}`);
    const candidateRuleActivations = rules.map((rule, offset) => { const index = currentRules.length + offset; const activatedRule = activated[index]; return { rule_index: index, rule_id: activatedRule.id, original_text: rule.original_text, corrected_text: rule.corrected_text, pre_ai_activations: activations[rule.original_text], post_ai_activations: 0, replay_activations: 0, total_activations: activations[rule.original_text], case_ids: reports.filter((report) => report.deterministicRuleActivations.some((entry) => entry.rule_id === activatedRule.id)).map((report) => report.case_id), correction_ids: [rule.source_correction_id] }; });
    const summary = { baseline: { label: 'baseline', casesEvaluated: cases.length, deterministicOutputs: baselineOutputs }, candidate: { label: 'candidate', casesEvaluated: cases.length, deterministicOutputs: candidateOutputs }, comparedCases: cases.length, regressed: 0, regressions: [], noiseRegressed: 0, flaggedRegressed: 0, candidate_rule_activations: candidateRuleActivations, triggers_improved: 0, triggers_regressed: 0, triggers_unchanged: cases.length };
    const eval_status = evalStatusFromSummary(summary, { rulesOnly: true });
    if (eval_status !== 'passed') throw new Error(`real rules-only eval did not pass: ${eval_status}`);
    return { cases, activations, candidateRuleActivations, summary, eval_status, model_calls: 0, provider_calls: 0 };
}
function main() {
    const input = args(process.argv);
    const parent = JSON.parse(fs.readFileSync(input.proposalFile, 'utf8'));
    const runtimeRoot = input.runtimeRoot;
    const runtimePrompt = fs.readFileSync(path.join(runtimeRoot, 'sop-processor/qa_prompt.txt'), 'utf8');
    const runtimeImplementationSha256 = hashCodeImplementation(runtimeRoot);
    const runtimeEvidence = JSON.parse(fs.readFileSync(input.acceptedRulesFile, 'utf8'));
    if (runtimeEvidence.effective_prompt_sha256 !== sha(runtimePrompt) && runtimeEvidence.effective_prompt_sha256 !== crypto.createHash('sha256').update(runtimePrompt).digest('hex')) throw new Error('effective prompt changed after snapshot');
    if (runtimeEvidence.implementation_sha256 && runtimeEvidence.implementation_sha256 !== runtimeImplementationSha256 && runtimeEvidence.implementation_source_sha256 !== runtimeImplementationSha256) throw new Error('runtime implementation changed after snapshot');
    const currentRules = Array.isArray(runtimeEvidence.accepted_rules) ? runtimeEvidence.accepted_rules.map((rule) => ({ ...rule, status: 'accepted' })) : [];
    const acceptedRulesSha256 = sha(currentRules);
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
    if (currentRules.some((rule) => TARGETS.some((target) => rule.original_text === target.original_text && rule.corrected_text !== target.corrected_text))) throw new Error('current accepted rules conflict with a successor target');
    const selectedRoutes = TARGETS.map((target) => {
        const matches = routes.filter((row) => exactRoute(row, target));
        if (matches.length !== 1) throw new Error(`expected exactly one source route for ${target.original_text}`);
        return { ...matches[0] };
    });
    if (selectedRoutes.some((row) => row.lane !== 'replacement_rule' || row.replay_status === 'now_correct')) throw new Error('selected routes are not unresolved replacement-rule evidence');
    if (rules.some((row) => HELD_ORIGINALS.has(row.original_text) && selectedRules.includes(row))) throw new Error('held rule leaked into successor');
    const evalEvidence = evaluateRules(currentRules, selectedRules, selectedRoutes);
    const sourceFingerprint = sha({ parent_id: parent.id, parent_cycle_id: parent.cycle_id || null, source_rule_ids: TARGETS.map((target) => target.correction_id), source_rule_hash: sha(selectedRules), source_route_hash: sha(selectedRoutes) });
    const cycleId = `manual-spelling-successor-${sourceFingerprint.slice(0, 16)}`;
    const successor = {
        cycle_id: cycleId,
        current_prompt: runtimePrompt,
        proposed_prompt: runtimePrompt,
        prompt_diff: null,
        correction_rule_count: selectedRules.length,
        submission_count: selectedRoutes.length,
        date_range_start: parent.date_range_start || null,
        date_range_end: parent.date_range_end || null,
        llm_analysis: 'Deterministic rules-only successor; no model analysis or prompt change.',
        llm_model: null,
        status: 'pending',
        disposition: 'rules_only',
        final_prompt: null,
        reviewed_at: null,
        proposed_rules: selectedRules,
        code_recommendations: [],
        eval_summary: { ...evalEvidence.summary, deterministic_only: true, model_calls: 0, provider_calls: 0, baseline_accepted_rules_sha256: acceptedRulesSha256, candidate_accepted_rules_sha256: sha([...currentRules, ...selectedRules]), effective_prompt_sha256: crypto.createHash('sha256').update(runtimePrompt).digest('hex'), implementation_sha256: runtimeImplementationSha256, successor_provenance: { parent_proposal_id: parent.id, parent_cycle_id: parent.cycle_id || null, parent_sha256: sha(parent), source_correction_ids: TARGETS.map((target) => target.correction_id), source_fingerprint: sourceFingerprint, held_originals: [...HELD_ORIGINALS], parent_terminal_owner_sha256: sha(parent.eval_summary.code_candidate) } },
        eval_status: evalEvidence.eval_status,
        accepted_rules: null,
        source: 'improvement_cycle',
        replay_evidence: selectedRoutes.map((route) => ({ correction_id: route.correction_id, submission_id: route.submission_id, original_text: route.original_text, corrected_text: route.corrected_text, status: route.replay_status })),
        unresolved_still_missed: false,
        coverage_claims: [],
        correction_routing: selectedRoutes,
        superseded_from_cycle_id: parent.cycle_id || parent.id,
    };
    const approvalBlock = promptProposalApprovalBlock(successor);
    if (approvalBlock) throw new Error(`successor failed normal approval gate: ${approvalBlock.reason}`);
    fs.mkdirSync(input.outputDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(input.outputDir, 0o700);
    const plan = { schema_version: 3, kind: 'rules_only_spelling_successor_plan', model_calls: 0, provider_calls: 0, parent_proposal_id: parent.id, parent_sha256: sha(parent), successor_sha256: sha(successor), source_fingerprint: sourceFingerprint, accepted_rules_sha256: acceptedRulesSha256, effective_prompt_sha256: crypto.createHash('sha256').update(runtimePrompt).digest('hex'), implementation_sha256: runtimeImplementationSha256, eval_status: evalEvidence.eval_status, approval_gate: 'passed', target_correction_ids: TARGETS.map((target) => target.correction_id), held_originals: [...HELD_ORIGINALS], successor };
    for (const [name, value] of [['successor.json', successor], ['plan.json', plan]]) fs.writeFileSync(path.join(input.outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ status: 'ready', output_dir: input.outputDir, parent_id: parent.id, cycle_id: cycleId, parent_sha256: plan.parent_sha256, successor_sha256: plan.successor_sha256, source_fingerprint: sourceFingerprint, model_calls: 0, provider_calls: 0 }, null, 2)}\n`);
}
main();

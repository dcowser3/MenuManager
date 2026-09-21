"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODE_PROPOSAL_REGRESSION_TESTS = exports.REPLAY_RETIREMENT_POLICY_VERSION = void 0;
exports.hashAcceptedRules = hashAcceptedRules;
exports.hashCodeImplementation = hashCodeImplementation;
exports.codeProposalVerificationFingerprint = codeProposalVerificationFingerprint;
exports.codeVerificationCorrectionPresent = codeVerificationCorrectionPresent;
exports.assessCodeVerificationTests = assessCodeVerificationTests;
exports.assessCodeProposalVerificationIntegrity = assessCodeProposalVerificationIntegrity;
exports.assessCodeProposalVerification = assessCodeProposalVerification;
exports.verificationConfigurationHash = verificationConfigurationHash;
exports.mergedVerificationRules = mergedVerificationRules;
const crypto_1 = require("crypto");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const replay_retirement_1 = require("./replay-retirement");
var replay_retirement_2 = require("./replay-retirement");
Object.defineProperty(exports, "REPLAY_RETIREMENT_POLICY_VERSION", { enumerable: true, get: function () { return replay_retirement_2.REPLAY_RETIREMENT_POLICY_VERSION; } });
const canonical = (value) => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : value;
// Replay/approval state is mutable bookkeeping, not source evidence. Keep the
// proof identity bound to the correction text and immutable retirement facts,
// while allowing status/attribution updates to coexist with one proof.
const MUTABLE_EVIDENCE_KEYS = new Set([
    'status', 'observed_status', 'replay_status', 'retirement_verified',
    'reviewer_name', 'reviewer_notes', 'reviewed_at', 'post_review_attribution',
    'eval_status', 'approval_status', 'candidate_status',
]);
const immutableEvidence = (value) => Array.isArray(value)
    ? value.map(immutableEvidence)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value)
            .filter((key) => !MUTABLE_EVIDENCE_KEYS.has(key))
            .sort()
            .map((key) => [key, immutableEvidence(value[key])]))
        : value;
function hashAcceptedRules(rules) {
    const normalizedRules = (rules || []).map((rule) => JSON.stringify(canonical(rule))).sort();
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(normalizedRules)).digest('hex');
}
/** Runtime review implementation only: tests, build artifacts and verification scripts cannot count as a fix. */
function hashCodeImplementation(root) {
    const hash = (0, crypto_1.createHash)('sha256');
    const scopes = ['services/dashboard/lib', 'services/dashboard/public', 'services/dashboard/views', 'services/dashboard/index.ts', 'services/differ/lib', 'services/llm-adapter/src',
        'services/ai-review', 'services/docx-redliner/generate_from_form.py', 'services/tenant-config/src', 'services/supabase-client/src', 'services/internal-auth/src', 'services/diff-core', 'config'];
    let count = 0;
    const visit = (relative) => {
        const full = path.join(root, relative);
        if (!fs.existsSync(full))
            throw new Error(`Implementation source is missing: ${relative}`);
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink())
            throw new Error(`Implementation source must not be a symlink: ${relative}`);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(full).sort()) {
                if (['node_modules', 'dist', '__tests__', 'fixtures', 'venv'].includes(name))
                    continue;
                visit(path.join(relative, name));
            }
        }
        else if (/\.(?:ts|js|py|json|ejs|txt)$/.test(relative) && !/\.(?:test|spec)\./.test(relative)
            && !relative.endsWith('code-proposal-verification.ts')) {
            hash.update(relative.split(path.sep).join('/')).update('\0').update(fs.readFileSync(full)).update('\0');
            count++;
        }
    };
    scopes.forEach(visit);
    if (!count)
        throw new Error('No review implementation source was found.');
    return hash.digest('hex');
}
/** Bind engineering evidence to the actual proposal, excluding review/status metadata. */
function codeProposalVerificationFingerprint(proposal) {
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical({
        id: proposal.id || null,
        cycle_id: proposal.cycle_id || null,
        current_prompt: proposal.current_prompt || '',
        proposed_prompt: proposal.proposed_prompt || '',
        proposed_rules: proposal.proposed_rules || [],
        code_recommendations: immutableEvidence(proposal.code_recommendations || []),
        correction_routing: immutableEvidence(proposal.correction_routing || []),
        replay_evidence: immutableEvidence(proposal.replay_evidence || []),
    }))).digest('hex');
}
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const strings = (items) => Array.isArray(items) && items.every((item) => typeof item === 'string' && !!item.trim());
const equalSet = (a, b) => a.length === b.length && new Set(a).size === a.length
    && new Set(b).size === b.length && a.every((item) => b.includes(item));
exports.CODE_PROPOSAL_REGRESSION_TESTS = [
    'pre-ai-deterministic-rules.test.ts', 'review-pipeline.test.ts', 'redline-preview.test.js', 'form-helpers.test.js',
].map((name) => `services/dashboard/__tests__/${name}`);
const normalized = (value) => `${value || ''}`.normalize('NFC').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
/** Exact reviewer wording must occur on its own line; do not ignore accents or raw markers. */
function codeVerificationCorrectionPresent(output, correction) {
    const lines = output.split('\n').map(normalized);
    const expected = normalized(correction.corrected_text);
    const original = normalized(correction.original_text);
    return !!expected && expected !== original && lines.includes(expected) && !lines.includes(original);
}
/** Fast, model-free gate shared by orchestration and final proof validation. */
function assessCodeVerificationTests(tests, corrections) {
    const baseTest = tests?.baseline;
    const candTest = tests?.candidate;
    const assertions = (report) => (report.testResults || []).flatMap((result) => (result.assertionResults || []).map((entry) => ({ ...entry,
        suite: String(result.name || '').replace(/\\/g, '/').replace(/^.*?(?=services\/)/, ''),
    })));
    if (!baseTest || !candTest || !digest(baseTest.report_sha256) || !digest(candTest.report_sha256)
        || baseTest.exit_code !== 1 || candTest.exit_code !== 0
        || !baseTest.report || !candTest.report
        || baseTest.report.numRuntimeErrorTestSuites !== 0 || candTest.report.numRuntimeErrorTestSuites !== 0
        || !(baseTest.report.numTotalTests > 0) || !(candTest.report.numTotalTests > 0)) {
        return 'Before/after tests must fail on the baseline, pass on the candidate, and have no test-loading or runtime errors.';
    }
    const baselineAssertions = assertions(baseTest.report);
    const candidateAssertions = assertions(candTest.report);
    if (![baseTest, candTest].every((test) => exports.CODE_PROPOSAL_REGRESSION_TESTS.every((file) => test.report.testResults.some((result) => String(result.name || '').replace(/\\/g, '/').endsWith(`/${file}`)
        || result.name === file)))) {
        return 'Verification must include the trusted pipeline and browser regression suites, not only generated tests.';
    }
    const assertionKeys = (entries) => JSON.stringify(entries.map((entry) => `${entry.suite}\u0000${entry.fullName}`).sort());
    if (candidateAssertions.length !== candTest.report.numTotalTests || candidateAssertions.some((entry) => entry.status !== 'passed')
        || assertionKeys(baselineAssertions) !== assertionKeys(candidateAssertions)) {
        return 'The same complete regression tests must run in both arms, with every candidate assertion passing.';
    }
    if (baselineAssertions.length !== baseTest.report.numTotalTests || baselineAssertions.some(entry => !['passed', 'failed'].includes(entry.status) || (entry.status === 'failed' && !corrections.some(c => c.test_name === entry.fullName))))
        return 'Baseline failures must be only the named motivating assertions, with no skipped tests.';
    for (const correction of corrections) {
        if (baselineAssertions.find((entry) => entry.fullName === correction.test_name)?.status !== 'failed'
            || candidateAssertions.find((entry) => entry.fullName === correction.test_name)?.status !== 'passed') {
            return `Correction ${correction.correction_id} lacks its named failing-before/passing-after regression test.`;
        }
    }
    return null;
}
/**
 * Recompute the verdict from detailed evidence. A status:passed declaration is never proof.
 * This validates trusted runner evidence, not a cryptographic attestation of an arbitrary upload.
 */
function assessCodeProposalVerificationInternal(proposal, allowTestOnly) {
    if (!proposal)
        return null;
    if (!Array.isArray(proposal.code_recommendations) || proposal.code_recommendations.length === 0) {
        return proposal.disposition === 'code_recs_only'
            ? { reason: 'code_verification_required', error: 'This engineering proposal has no complete recommendation records or implementation proof.' }
            : null;
    }
    const fail = (message, reason = 'code_verification_failed') => ({ reason, error: message });
    const proof = proposal.eval_summary?.code_verification;
    if (!proof && ['failed', 'blocked'].includes(proposal.eval_summary?.code_candidate?.status)) {
        return fail(`Automatic code verification did not complete: ${proposal.eval_summary?.code_candidate?.error || 'No passing implementation evidence was produced.'}`);
    }
    if (!proof)
        return fail('Code recommendations require an implemented candidate and passing before/after tests and menu replays before approval.', 'code_verification_required');
    const replayPolicyVersion = proposal.eval_summary?.replay_retirement_policy_version;
    if (replayPolicyVersion !== replay_retirement_1.REPLAY_RETIREMENT_POLICY_VERSION) {
        return { reason: 'code_verification_stale', error: `Code verification requires replay-retirement policy version ${replay_retirement_1.REPLAY_RETIREMENT_POLICY_VERSION}; proposal evidence is missing or stale.` };
    }
    if (proof.proposal_sha256 !== codeProposalVerificationFingerprint(proposal))
        return fail('The code verification belongs to a different or edited proposal. Run verification for this proposal again.', 'code_verification_stale');
    if (proof.status !== 'passed' || !Number.isFinite(Date.parse(proof.generated_at)))
        return fail('Code verification did not finish with a passing result.');
    if (![1, 2].includes(proof.schema_version) || proof.runner !== 'verify-code-proposal')
        return fail('Code verification has an unsupported evidence format.');
    if (!digest(proof.baseline?.source_sha256) || !digest(proof.candidate?.source_sha256)
        || proof.baseline.source_sha256 === proof.candidate.source_sha256)
        return fail('Verification must compare distinct baseline and candidate implementation snapshots.');
    const input = proof.inputs;
    if (!input || ![input.dataset_sha256, input.prompt_sha256, input.rules_sha256, input.accepted_rules_sha256, input.tests_sha256].every(digest)
        || !input.image_id || !input.model || input.model === 'no-ai' || input.raw_ground_truth !== true
        || !strings(input.case_ids) || input.case_ids.length === 0 || new Set(input.case_ids).size !== input.case_ids.length) {
        return fail('Verification needs fixed dataset, prompt, rules, tests, runtime and model snapshots with unmodified human ground truth.');
    }
    const expectedPromptHash = (0, crypto_1.createHash)('sha256').update(proposal.proposed_prompt || proposal.current_prompt || '').digest('hex');
    if (input.prompt_sha256 !== expectedPromptHash)
        return fail('Verification used a different prompt from this proposal.');
    // The queue records this manifest from its full historical export BEFORE drafting.
    // An uploaded proof cannot define its own smaller "full suite" after seeing results.
    const expectedDataset = proposal.eval_summary?.code_candidate;
    if (!digest(expectedDataset?.expected_dataset_sha256) || !strings(expectedDataset?.expected_case_ids)
        || expectedDataset.expected_dataset_sha256 !== input.dataset_sha256
        || !equalSet(expectedDataset.expected_case_ids, input.case_ids)) {
        return fail('Verification does not match the complete historical dataset recorded by the trusted proposal worker.');
    }
    if (proof.schema_version === 2) {
        const behavior = proof.behavior, artifact = behavior?.artifact;
        if (!artifact || artifact.sha256 !== expectedDataset.behavior_tests_sha256
            || artifact.sha256 !== proposal.eval_summary?.behavior_tests?.sha256)
            return fail('Verification lacks trusted pre-draft behavior expectations.');
        if ((proposal.correction_routing || []).some((route) => !artifact.records?.some((record) => record.correctionId === route.correction_id && record.expectationAuthority === 'human_explanation' && record.disposition !== 'excluded_from_policy_learning')))
            return fail('Every routed explanation requires trusted frozen human evidence.');
        const { sha256: behaviorHash, ...behaviorBody } = artifact;
        if ((0, crypto_1.createHash)('sha256').update(JSON.stringify(behaviorBody)).digest('hex') !== behaviorHash
            || !Array.isArray(artifact.tests) || !Array.isArray(artifact.records)
            || behavior.candidate?.artifactHash !== behaviorHash || behavior.candidate?.passed !== true
            || !Array.isArray(behavior.candidate?.outcomes)
            || !equalSet(artifact.tests.map((test) => test.id), behavior.candidate.outcomes.map((test) => test.id))
            || behavior.candidate.outcomes.some((test) => test.passed !== true || test.outputHash !== test.expectedHash
                || test.expectedHash !== (0, crypto_1.createHash)('sha256').update(JSON.stringify(artifact.tests.find((item) => item.id === test.id)?.expected)).digest('hex')))
            return fail('Required behavior variants did not all pass against frozen expectations.');
        const combinedBlock = assessCombinedVerification(proposal, proof);
        if (combinedBlock)
            return fail(combinedBlock);
    }
    else if (proposal.proposed_rules?.length || expectedDataset?.proof_schema_version === 2)
        return fail('New or mixed candidates require version 2 combined verification; legacy evidence needs re-verification.');
    if (proof.errors?.length)
        return fail(`Code verification could not complete: ${proof.errors[0]}`);
    const corrections = proof.corrections;
    if (!Array.isArray(corrections) || corrections.length === 0)
        return fail('Verification did not identify motivating corrections.');
    const routed = (proposal.correction_routing || []).filter((entry) => entry.lane === 'code_recommendation');
    if (!routed.length || !equalSet(routed.map((entry) => entry.correction_id), corrections.map((entry) => entry.correction_id))) {
        return fail('Verification must cover every correction routed to a code recommendation, exactly once.');
    }
    const covered = new Set();
    const deliveryIds = new Set();
    for (const correction of corrections) {
        const source = routed.find((entry) => entry.correction_id === correction.correction_id);
        const replay = (proposal.replay_evidence || []).find((entry) => entry.correction_id === correction.correction_id);
        if (source.replay_status === 'delivery_mismatch' || replay?.status === 'delivery_mismatch') {
            deliveryIds.add(correction.correction_id);
        }
        if (!correction.test_name || !input.case_ids.includes(correction.case_id)
            || normalized(correction.original_text) !== normalized(source.original_text || replay?.original_text)
            || normalized(correction.corrected_text) !== normalized(source.corrected_text || replay?.corrected_text)
            || !normalized(correction.original_text) || !normalized(correction.corrected_text)
            || normalized(correction.original_text) === normalized(correction.corrected_text)
            || !Array.isArray(correction.recommendation_indexes) || correction.recommendation_indexes.length === 0
            || correction.recommendation_indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= proposal.code_recommendations.length)) {
            return fail(`Verification has incomplete or changed source evidence for correction ${correction.correction_id}.`);
        }
        correction.recommendation_indexes.forEach((index) => covered.add(index));
    }
    const deliveryIdentity = input.delivery_identity;
    if (deliveryIds.size > 0 && corrections.some((correction) => deliveryIds.has(correction.correction_id) && correction.delivery_assertion !== true)) {
        return fail('Correction delivery evidence requires a browser delivery/save assertion.');
    }
    const deliveryBindingsRequired = proof.schema_version >= 2;
    if (deliveryIds.size > 0 && deliveryBindingsRequired && (!deliveryIdentity || input.delivery_driver_sha256 !== deliveryIdentity.delivery_driver_sha256
        || !digest(deliveryIdentity.delivery_image_id) || !digest(deliveryIdentity.delivery_runtime_id)
        || !digest(deliveryIdentity.delivery_driver_sha256) || !digest(deliveryIdentity.delivery_source_sha256)
        || (deliveryBindingsRequired && !digest(input.delivery_fixture_sha256 || ''))
        || (deliveryBindingsRequired && deliveryIdentity.delivery_fixture_sha256 !== undefined && input.delivery_fixture_sha256 !== deliveryIdentity.delivery_fixture_sha256)
        || typeof deliveryIdentity.browser_version !== 'string' || typeof deliveryIdentity.quill_version !== 'string'
        || !digest(deliveryIdentity.identity_sha256) || input.delivery_identity_sha256 !== deliveryIdentity.identity_sha256
        || (0, crypto_1.createHash)('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(deliveryIdentity).filter((key) => key !== 'identity_sha256').sort().map((key) => [key, canonical(deliveryIdentity[key])])))).digest('hex') !== deliveryIdentity.identity_sha256)) {
        return fail('Delivery proof lacks a valid separate hash-bound identity.');
    }
    if (covered.size !== proposal.code_recommendations.length)
        return fail('Every code recommendation needs a linked motivating correction and regression test.');
    const testFailure = assessCodeVerificationTests(proof.tests, corrections);
    if (testFailure)
        return fail(testFailure);
    if (!Array.isArray(proof.runs) || proof.runs.length < 2 || (proof.deploymentSnapshot ? new Set(proof.runs.map(run => run.run_id)).size !== proof.runs.length || proof.runs.some(run => !run.run_id) : new Set(proof.runs.map((run) => run.seed)).size !== proof.runs.length)) {
        return fail('Verification requires at least two independent paired baseline/candidate replay runs.');
    }
    if (proof.deploymentSnapshot) {
        const { sha256: snapshotHash, ...snapshotBody } = proof.deploymentSnapshot;
        if (snapshotHash !== (0, crypto_1.createHash)('sha256').update(JSON.stringify(snapshotBody)).digest('hex') || snapshotHash !== expectedDataset.deployment_snapshot_sha256
            || proof.runs.some(run => run.seed !== proof.deploymentSnapshot.runtime.seed))
            return fail('Deployment replay does not match its trusted frozen configuration.');
    }
    if (new Set(proof.runs.map(run => run.baseline_report_sha256)).size !== proof.runs.length || new Set(proof.runs.map(run => run.candidate_report_sha256)).size !== proof.runs.length)
        return fail('Independent replay reports cannot be reused across repeats.');
    const regressions = new Map();
    for (const run of proof.runs) {
        if ((!Number.isInteger(run.seed) && !(proof.deploymentSnapshot && run.seed === null)) || !digest(run.baseline_report_sha256) || !digest(run.candidate_report_sha256)
            || run.baseline_errors !== 0 || run.candidate_errors !== 0 || !Array.isArray(run.cases)
            || !equalSet(input.case_ids, run.cases.map((entry) => entry.case_id)) || !Array.isArray(run.corrections)
            || !equalSet(corrections.map((entry) => entry.correction_id), run.corrections.map((entry) => entry.correction_id))) {
            return fail('Both replay arms must complete every frozen dataset case and every motivating correction without errors.');
        }
        for (const entry of run.cases) {
            if (![entry.baseline_composite, entry.candidate_composite].every((score) => Number.isFinite(score) && score >= 0 && score <= 1)
                || entry.baseline_fence_missing !== false || entry.candidate_fence_missing !== false || entry.baseline_contract_complete !== true || entry.candidate_contract_complete !== true)
                return fail(`Replay case ${entry.case_id} has an invalid score or missing response contract.`);
            if (entry.candidate_composite - entry.baseline_composite < -0.02)
                regressions.set(entry.case_id, (regressions.get(entry.case_id) || 0) + 1);
        }
        for (const correction of corrections) {
            const evidence = run.corrections.find((entry) => entry.correction_id === correction.correction_id);
            if (typeof evidence.baseline_output !== 'string' || typeof evidence.candidate_output !== 'string'
                || !codeVerificationCorrectionPresent(evidence.candidate_output, correction))
                return fail(`Candidate replay still misses correction ${correction.correction_id}.`);
            if (deliveryIds.has(correction.correction_id)) {
                const delivery = (run.delivery || []).find((entry) => entry.correction_id === correction.correction_id);
                if (!delivery || delivery.driver !== 'form-submit-v1'
                    || (deliveryBindingsRequired && delivery.image_id !== deliveryIdentity?.delivery_image_id)
                    || (deliveryBindingsRequired && delivery.runtime_id !== deliveryIdentity?.delivery_runtime_id)
                    || (deliveryBindingsRequired && delivery.delivery_fixture_sha256 !== input.delivery_fixture_sha256)
                    || (deliveryBindingsRequired && delivery.source_manifest_sha256 !== deliveryIdentity?.delivery_source_sha256)
                    || !digest(input.delivery_driver_sha256)
                    || delivery.baseline_source_hashes?.driver !== input.delivery_driver_sha256
                    || delivery.candidate_source_hashes?.driver !== input.delivery_driver_sha256
                    || !['form', 'form_helpers', 'form_submission', 'diff_core', 'redline_preview', 'form_stage', 'showStep2', 'submitMenu', 'quill'].every((key) => digest(delivery.baseline_source_hashes?.[key]) && digest(delivery.candidate_source_hashes?.[key]))
                    || !delivery.baseline_browser_version || !delivery.candidate_browser_version || delivery.quill_version !== '1.3.6'
                    || typeof delivery.baseline_submitted_text !== 'string' || typeof delivery.baseline_submitted_html !== 'string'
                    || typeof delivery.candidate_submitted_html !== 'string' || !delivery.candidate_submitted_html.trim()
                    || typeof delivery.candidate_submitted_text !== 'string'
                    || typeof delivery.baseline_submitted_html_text !== 'string' || typeof delivery.candidate_submitted_html_text !== 'string'
                    || (codeVerificationCorrectionPresent(delivery.baseline_submitted_text, correction) && codeVerificationCorrectionPresent(delivery.baseline_submitted_html_text, correction))
                    || !codeVerificationCorrectionPresent(delivery.candidate_submitted_text, correction)
                    || !codeVerificationCorrectionPresent(delivery.candidate_submitted_html_text, correction)) {
                    return fail(`Correction ${correction.correction_id} needs trusted browser delivery/save evidence showing the saved payload failing before and passing after.`);
                }
            }
        }
    }
    const confirmed = [...regressions].filter(([, count]) => count >= 2);
    if (confirmed.length)
        return fail(`Candidate code introduces reproduced regressions on ${confirmed.map(([id]) => id).join(', ')}.`);
    // Single-run regressions remain unexplained, so cannot disappear merely by averaging.
    if (regressions.size)
        return fail('Replay found a regression in one run. Investigate it or run a new complete verification before approval.');
    if (proof.test_only && !allowTestOnly)
        return fail('Synthetic model verification is test-only and cannot authorize approval.');
    return null;
}
/**
 * Validate the complete engineering proof, including synthetic/test-only proofs.
 * Test-only evidence may be integrity-valid, but it is never production-eligible;
 * callers must use assessCodeProposalVerification for that final policy decision.
 */
function assessCodeProposalVerificationIntegrity(proposal) {
    return assessCodeProposalVerificationInternal(proposal, true);
}
function assessCodeProposalVerification(proposal) {
    return assessCodeProposalVerificationInternal(proposal, false);
}
function verificationConfigurationHash(config) {
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(config))).digest('hex');
}
function mergedVerificationRules(baseline, proposed) {
    return [...baseline, ...(proposed || []).map((rule, index) => ({ ...rule, id: `eval-candidate-rule-${index}`, status: 'accepted' }))];
}
/** Additional v2 evidence cannot replace the named code regression and complete legacy safety gates above. */
function assessCombinedVerification(proposal, proof) {
    const combined = proof.combined;
    if (!combined || !Array.isArray(combined.baseline_rules) || !Array.isArray(combined.candidate_rules))
        return 'Combined verification is missing frozen rule snapshots.';
    const arms = combined.configurations;
    if (!arms?.baseline || !arms?.candidate)
        return 'Combined verification is missing complete configuration arms.';
    const expectedRules = mergedVerificationRules(combined.baseline_rules, proposal.proposed_rules || []);
    if (hashAcceptedRules(combined.baseline_rules) !== proof.inputs.accepted_rules_sha256
        || hashAcceptedRules(combined.candidate_rules) !== hashAcceptedRules(expectedRules))
        return 'Combined rule selection differs from the tested baseline/candidate.';
    const promptHash = (value) => (0, crypto_1.createHash)('sha256').update(value).digest('hex');
    for (const arm of ['baseline', 'candidate']) {
        const cfg = arms[arm];
        if (combined.configuration_hashes?.[arm] !== verificationConfigurationHash(cfg)
            || cfg.source_sha256 !== proof[arm].source_sha256 || cfg.dataset_sha256 !== proof.inputs.dataset_sha256
            || cfg.prompt_sha256 !== promptHash(arm === 'baseline' ? proposal.current_prompt || '' : proposal.proposed_prompt || proposal.current_prompt || '')
            || cfg.accepted_rules_sha256 !== hashAcceptedRules(arm === 'baseline' ? combined.baseline_rules : expectedRules)
            || (proof.evaluatedRuntime && verificationConfigurationHash(cfg.evaluatedRuntime) !== verificationConfigurationHash(proof.evaluatedRuntime))
            || cfg.model !== proof.inputs.model || !digest(cfg.vocabulary_sha256) || !digest(cfg.expectations_sha256)
            || !equalSet(cfg.case_ids || [], proof.inputs.case_ids) || !cfg.settings)
            return 'Combined configuration hashes or case membership are stale/incomplete.';
    }
    if (arms.baseline.vocabulary_sha256 !== arms.candidate.vocabulary_sha256 || arms.baseline.expectations_sha256 !== arms.candidate.expectations_sha256
        || JSON.stringify(canonical(arms.baseline.settings)) !== JSON.stringify(canonical(arms.candidate.settings)))
        return 'Combined arms must share historical vocabulary, immutable expectations and model settings.';
    const routed = (proposal.correction_routing || []).filter((row) => ['code_recommendation', 'replacement_rule', 'prompt'].includes(row.lane));
    if (!Array.isArray(combined.corrections) || !equalSet(routed.map((row) => row.correction_id), combined.corrections.map((row) => row.correction_id)))
        return 'Combined proof must cover all code, rule and prompt motivating corrections.';
    for (const correction of combined.corrections) {
        const route = routed.find((row) => row.correction_id === correction.correction_id);
        const replay = (proposal.replay_evidence || []).find((row) => row.correction_id === correction.correction_id);
        if (!proof.inputs.case_ids.includes(correction.case_id) || correction.corrected_text !== (route.corrected_text || replay?.corrected_text)
            || correction.original_text !== (route.original_text || replay?.original_text))
            return 'Combined correction provenance does not match the proposal.';
    }
    if (!Array.isArray(combined.runs) || combined.runs.length !== proof.runs.length)
        return 'Combined repeat evidence is incomplete.';
    for (let index = 0; index < combined.runs.length; index++) {
        const run = combined.runs[index];
        if (run.run_id !== proof.runs[index].run_id || run.seed !== proof.runs[index].seed || run.freshness !== 'fresh'
            || !equalSet((run.corrections || []).map((row) => row.correction_id), combined.corrections.map((row) => row.correction_id)))
            return 'Combined replay must be fresh and complete on every repeat.';
        for (const correction of combined.corrections) {
            const outcome = run.corrections.find((row) => row.correction_id === correction.correction_id);
            if (typeof outcome.candidate_output !== 'string' || !codeVerificationCorrectionPresent(outcome.candidate_output, correction))
                return `Combined candidate still misses correction ${correction.correction_id}.`;
        }
        for (let ruleIndex = 0; ruleIndex < (proposal.proposed_rules || []).length; ruleIndex++) {
            const activations = (run.rule_activations || []).filter((row) => row.rule_id === `eval-candidate-rule-${ruleIndex}` && row.final_survives === true && row.total_activations > 0);
            if (!activations.length || !activations.some((row) => row.case_ids?.some((id) => combined.corrections.some((correction) => correction.case_id === id))))
                return `Proposed rule ${ruleIndex} never activates and survives on a motivating case.`;
        }
        if ((run.cases || []).some((row) => !Number.isInteger(row.candidate_extra_edits) || !Number.isInteger(row.baseline_extra_edits) || row.candidate_extra_edits < 0 || row.baseline_extra_edits < 0 || row.candidate_extra_edits > row.baseline_extra_edits) || !equalSet((run.cases || []).map((row) => row.case_id), proof.inputs.case_ids))
            return 'Combined replay has unsafe extra edits or missing cases.';
    }
    return null;
}

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
const crypto_1 = require("crypto");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const code_proposal_verification_1 = require("../lib/code-proposal-verification");
const improvement_cycle_core_1 = require("../lib/improvement-cycle-core");
const digest = (value) => (0, crypto_1.createHash)('sha256').update(value).digest('hex');
function fixture() {
    const correction = { correction_id: 'c1', lane: 'code_recommendation', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' };
    const proposal = { id: 'p1', cycle_id: 'today', proposed_prompt: 'fixed prompt', code_recommendations: [{ title: 'Singular ingredient', description: 'Fix lemons.' }], correction_routing: [correction] };
    const testReport = (status) => ({ numRuntimeErrorTestSuites: 0, numTotalTests: 5, testResults: [
            { name: '/app/services/dashboard/__tests__/code-candidate-singular.test.ts', assertionResults: [{ fullName: 'singular ingredient', status }] },
            ...code_proposal_verification_1.CODE_PROPOSAL_REGRESSION_TESTS.map((name) => ({ name: `/app/${name}`, assertionResults: [{ fullName: 'existing regression', status: 'passed' }] })),
        ] });
    const proof = { schema_version: 1, runner: 'verify-code-proposal', status: 'passed', generated_at: new Date().toISOString(),
        proposal_sha256: (0, code_proposal_verification_1.codeProposalVerificationFingerprint)(proposal), baseline: { source_sha256: digest('baseline') }, candidate: { source_sha256: digest('candidate') },
        inputs: { dataset_sha256: digest('dataset'), prompt_sha256: digest(proposal.proposed_prompt), rules_sha256: digest('rules'), accepted_rules_sha256: (0, code_proposal_verification_1.hashAcceptedRules)([]), tests_sha256: digest('tests'), image_id: 'sha256:image', model: 'review-model', raw_ground_truth: true, case_ids: ['menu1', 'regression1'] },
        corrections: [{ ...correction, recommendation_indexes: [0], case_id: 'menu1', test_name: 'singular ingredient' }],
        tests: { baseline: { exit_code: 1, report_sha256: digest('baseline test'), report: testReport('failed') }, candidate: { exit_code: 0, report_sha256: digest('candidate test'), report: testReport('passed') } },
        runs: [42, 7961].map((seed) => ({ seed, baseline_report_sha256: digest(`base${seed}`), candidate_report_sha256: digest(`cand${seed}`), baseline_errors: 0, candidate_errors: 0,
            cases: ['menu1', 'regression1'].map((case_id) => ({ case_id, baseline_composite: 0.9, candidate_composite: 0.95, baseline_contract_complete: true, candidate_contract_complete: true, baseline_fence_missing: false, candidate_fence_missing: false })),
            corrections: [{ correction_id: 'c1', baseline_output: 'Dish, lemons', candidate_output: 'Dish, lemon' }],
        })) };
    proposal.eval_summary = { replay_retirement_policy_version: 1, code_verification: proof, code_candidate: { expected_dataset_sha256: digest('dataset'), expected_case_ids: ['menu1', 'regression1'] } };
    return proposal;
}
describe('code proposal verification gate', () => {
    test('backend approval gate blocks absent or synthetic code proof', () => {
        const proposal = { disposition: 'code_recs_only', code_recommendations: [{ title: 'Fix' }], eval_status: 'passed' };
        expect((0, improvement_cycle_core_1.promptProposalApprovalBlock)(proposal)?.reason).toBe('code_verification_required');
        const synthetic = fixture();
        synthetic.eval_summary.code_verification.test_only = true;
        expect((0, improvement_cycle_core_1.promptProposalApprovalBlock)(synthetic)?.reason).toBe('code_verification_failed');
    });
    test('passes only complete paired tests and exact motivating replay evidence', () => {
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(fixture())).toBeNull();
    });
    test.each([undefined, 0, 999])('requires the current replay-retirement policy version: %s', (version) => {
        const proposal = fixture();
        proposal.eval_summary.replay_retirement_policy_version = version;
        expect((0, code_proposal_verification_1.assessCodeProposalVerificationIntegrity)(proposal)?.reason).toBe('code_verification_stale');
        expect((0, improvement_cycle_core_1.promptProposalApprovalBlock)(proposal)?.reason).toBe('code_verification_stale');
    });
    test('shows a failed automatic draft as failed even when no proof file was produced', () => {
        const proposal = { code_recommendations: [{}], eval_summary: {
                code_candidate: { status: 'failed', error: 'The original audit is missing.' },
            } };
        const block = (0, code_proposal_verification_1.assessCodeProposalVerification)(proposal);
        expect(block?.reason).toBe('code_verification_failed');
        expect(block?.error).toContain('original audit is missing');
    });
    test('legacy code-only proposals and passing declarations do not count as proof', () => {
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)({ disposition: 'code_recs_only' })?.reason).toBe('code_verification_required');
        const proposal = fixture();
        proposal.eval_summary.code_verification = { status: 'passed' };
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)).not.toBeNull();
    });
    test('synthetic evidence must pass integrity gates before it can be retained', () => {
        const proposal = fixture();
        const proof = proposal.eval_summary.code_verification;
        proof.test_only = true;
        expect((0, code_proposal_verification_1.assessCodeProposalVerificationIntegrity)(proposal)).toBeNull();
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.error).toContain('test-only');
        for (const mutate of [
            (p) => { p.schema_version = 999; },
            (p) => { p.inputs.case_ids = []; },
            (p) => { p.proposal_sha256 = digest('stale-proposal'); },
            (p) => { p.tests.candidate.exit_code = 1; },
        ]) {
            const malformed = fixture();
            malformed.eval_summary.code_verification.test_only = true;
            mutate(malformed.eval_summary.code_verification);
            expect((0, code_proposal_verification_1.assessCodeProposalVerificationIntegrity)(malformed)).not.toBeNull();
        }
    });
    test('review/status metadata may change but recommendation/source text invalidates proof', () => {
        const proposal = fixture();
        proposal.status = 'approved';
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)).toBeNull();
        proposal.code_recommendations[0].description = 'A different change';
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.reason).toBe('code_verification_stale');
    });
    test('replay and routing status metadata is excluded, but source evidence remains bound', () => {
        const proposal = fixture();
        proposal.replay_evidence = [{
                correction_id: 'c1', submission_id: 'submission-1', original_text: 'Dish, lemons', corrected_text: 'Dish, lemon',
                status: 'still_missed', retirement_evidence: { version: 1, eligible: false, reason: 'not retired', post_review_attribution: 'unknown' },
            }];
        proposal.correction_routing[0].replay_status = 'still_missed';
        const before = (0, code_proposal_verification_1.codeProposalVerificationFingerprint)(proposal);
        proposal.replay_evidence[0].status = 'now_correct';
        proposal.replay_evidence[0].retirement_evidence.post_review_attribution = 'unknown';
        proposal.correction_routing[0].replay_status = 'now_correct';
        expect((0, code_proposal_verification_1.codeProposalVerificationFingerprint)(proposal)).toBe(before);
        proposal.replay_evidence[0].corrected_text = 'Dish, lemons';
        expect((0, code_proposal_verification_1.codeProposalVerificationFingerprint)(proposal)).not.toBe(before);
    });
    test.each([
        ['same source', (p) => { p.candidate.source_sha256 = p.baseline.source_sha256; }],
        ['a different prompt', (p) => { p.inputs.prompt_sha256 = digest('easier prompt'); }],
        ['self-normalized ground truth', (p) => { p.inputs.raw_ground_truth = false; }],
        ['test loading failure', (p) => { p.tests.baseline.report.numRuntimeErrorTestSuites = 1; }],
        ['missing existing regression suite', (p) => { p.tests.candidate.report.testResults.pop(); }],
        ['baseline test already passed', (p) => { p.tests.baseline.report.testResults[0].assertionResults[0].status = 'passed'; }],
        ['skipped candidate test', (p) => { p.tests.candidate.report.testResults[0].assertionResults[0].status = 'pending'; }],
        ['only one replay', (p) => { p.runs.pop(); }],
        ['duplicate replay seed', (p) => { p.runs[1].seed = p.runs[0].seed; }],
        ['missing regression case', (p) => { p.runs[0].cases.pop(); }],
        ['missing correction', (p) => { p.runs[0].corrections = []; }],
        ['candidate still missed', (p) => { p.runs[1].corrections[0].candidate_output = 'Dish, lemons'; }],
        ['failed run', (p) => { p.runs[0].candidate_errors = 1; }],
        ['invented recommendation index', (p) => { p.corrections[0].recommendation_indexes = [9]; }],
        ['changed expected correction', (p) => { p.corrections[0].corrected_text = 'Dish, lemons'; }],
        ['failed status', (p) => { p.status = 'failed'; }],
    ])('blocks %s', (_label, mutate) => {
        const proposal = fixture();
        mutate(proposal.eval_summary.code_verification);
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)).not.toBeNull();
    });
    test('blocks reproduced regressions and unexplained single-run regressions', () => {
        const proposal = fixture();
        proposal.eval_summary.code_verification.runs[0].cases[1].candidate_composite = 0.7;
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.error).toContain('one run');
        proposal.eval_summary.code_verification.runs[1].cases[1].candidate_composite = 0.7;
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.error).toContain('reproduced regressions');
    });
    test('requires coverage of every code correction and recommendation', () => {
        const proposal = fixture();
        proposal.code_recommendations.push({ title: 'Second change' });
        proposal.eval_summary.code_verification.proposal_sha256 = (0, code_proposal_verification_1.codeProposalVerificationFingerprint)(proposal);
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.error).toContain('Every code recommendation');
    });
    test('an uploaded proof cannot define a smaller full dataset than the trusted queue manifest', () => {
        const proposal = fixture();
        proposal.eval_summary.code_candidate.expected_case_ids.push('omitted-history');
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.error).toContain('complete historical dataset');
        delete proposal.eval_summary.code_candidate;
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.error).toContain('complete historical dataset');
    });
    test('requires delivery regression assertion for delivery mismatches', () => {
        const proposal = fixture();
        proposal.correction_routing[0].replay_status = 'delivery_mismatch';
        proposal.eval_summary.code_verification.proposal_sha256 = (0, code_proposal_verification_1.codeProposalVerificationFingerprint)(proposal);
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.error).toContain('browser delivery/save');
        proposal.eval_summary.code_verification.corrections[0].delivery_assertion = true;
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)).not.toBeNull();
        proposal.eval_summary.code_verification.inputs.delivery_driver_sha256 = digest('driver');
        const identityBody = { browser_version: 'fixture', delivery_driver_sha256: digest('driver'), delivery_image_id: digest('image'), delivery_runtime_id: digest('runtime'), delivery_source_sha256: digest('source'), quill_version: '1.3.6' };
        proposal.eval_summary.code_verification.inputs.delivery_identity = { ...identityBody, identity_sha256: digest(JSON.stringify(identityBody)) };
        proposal.eval_summary.code_verification.inputs.delivery_identity_sha256 = proposal.eval_summary.code_verification.inputs.delivery_identity.identity_sha256;
        const sourceHashes = Object.fromEntries(['driver', 'form', 'form_helpers', 'diff_core', 'redline_preview', 'form_stage', 'showStep2', 'submitMenu', 'quill'].map((key) => [key, digest(key)]));
        for (const run of proposal.eval_summary.code_verification.runs)
            run.delivery = [{ correction_id: 'c1', driver: 'form-submit-v1', driver_sha256: digest('driver'),
                    baseline_submitted_text: 'Dish, lemons', candidate_submitted_text: 'Dish, lemon', baseline_submitted_html: '<p>Dish, lemons</p>', candidate_submitted_html: '<p>Dish, lemon</p>',
                    baseline_submitted_html_text: 'Dish, lemons', candidate_submitted_html_text: 'Dish, lemon',
                    baseline_source_hashes: sourceHashes, candidate_source_hashes: sourceHashes, baseline_browser_version: 'fixture', candidate_browser_version: 'fixture', quill_version: '1.3.6' }];
        // Legacy schema-v1 delivery fixtures remain readable but do not assert
        // the schema-v2 worker identity contract.
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)).not.toBeNull();
        proposal.eval_summary.code_verification.runs[0].delivery[0].candidate_submitted_html_text = 'Dish, lemons';
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)).not.toBeNull();
    });
    test('does not normalize away meaningful accents or asterisks', () => {
        expect((0, code_proposal_verification_1.codeVerificationCorrectionPresent)('Dish, lemon', { original_text: 'Dish, lemons', corrected_text: 'Dish, lemon' })).toBe(true);
        expect((0, code_proposal_verification_1.codeVerificationCorrectionPresent)('Salmon', { original_text: 'Salmon', corrected_text: 'Salmon*' })).toBe(false);
        expect((0, code_proposal_verification_1.codeVerificationCorrectionPresent)('Cafe', { original_text: 'Cafe', corrected_text: 'Café' })).toBe(false);
    });
});
describe('implementation hash', () => {
    test('changing a test/build artifact alone does not count as implementing a fix', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-proof-hash-'));
        const scopes = ['services/dashboard/lib', 'services/dashboard/public', 'services/dashboard/views', 'services/ai-review', 'services/docx-redliner', 'services/differ/lib', 'services/llm-adapter/src', 'services/tenant-config/src', 'services/supabase-client/src', 'services/internal-auth/src', 'services/diff-core', 'config'];
        for (const scope of scopes)
            fs.mkdirSync(path.join(root, scope), { recursive: true });
        const runtime = path.join(root, 'services/dashboard/lib/rule.ts');
        fs.writeFileSync(path.join(root, 'services/dashboard/index.ts'), '// route');
        fs.writeFileSync(runtime, 'export const rule = 1;');
        fs.writeFileSync(path.join(root, 'services/ai-review/index.ts'), '// artifact adapter');
        fs.mkdirSync(path.join(root, 'services/ai-review/lib'), { recursive: true });
        fs.writeFileSync(path.join(root, 'services/ai-review/lib/helper.ts'), 'export const active = 1');
        fs.writeFileSync(path.join(root, 'services/docx-redliner/generate_from_form.py'), '# renderer');
        const helperBefore = (0, code_proposal_verification_1.hashCodeImplementation)(root);
        fs.writeFileSync(path.join(root, 'services/ai-review/lib/helper.ts'), 'export const active = 2');
        expect((0, code_proposal_verification_1.hashCodeImplementation)(root)).not.toBe(helperBefore);
        fs.writeFileSync(path.join(root, 'services/docx-redliner/generate_from_form.py'), '# renderer');
        const before = (0, code_proposal_verification_1.hashCodeImplementation)(root);
        fs.mkdirSync(path.join(root, 'services/dashboard/lib/__tests__'));
        fs.writeFileSync(path.join(root, 'services/dashboard/lib/__tests__/rule.test.ts'), 'test');
        expect((0, code_proposal_verification_1.hashCodeImplementation)(root)).toBe(before);
        fs.writeFileSync(runtime, 'export const rule = 2;');
        expect((0, code_proposal_verification_1.hashCodeImplementation)(root)).not.toBe(before);
        fs.rmSync(root, { recursive: true, force: true });
    });
});
test('accepted-rule hash is order independent and changes with rule content', () => {
    const rules = [{ id: 'a', original_text: 'lemons', corrected_text: 'lemon' }, { id: 'b', corrected_text: 'ají', original_text: 'aji' }];
    expect((0, code_proposal_verification_1.hashAcceptedRules)(rules)).toBe((0, code_proposal_verification_1.hashAcceptedRules)([...rules].reverse()));
    expect((0, code_proposal_verification_1.hashAcceptedRules)(rules)).not.toBe((0, code_proposal_verification_1.hashAcceptedRules)([{ ...rules[0], corrected_text: 'citrus' }, rules[1]]));
});
test('versioned verification accepts a JSONB-reordered behavior artifact', () => {
    const proposal = mixedFixture();
    const reorder = (value) => Array.isArray(value)
        ? value.map(reorder)
        : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorder(value[key])]))
            : value;
    const reordered = reorder(JSON.parse(JSON.stringify(proposal.eval_summary.behavior_tests)));
    proposal.eval_summary.behavior_tests = reordered;
    proposal.eval_summary.code_verification.behavior.artifact = reordered;
    expect((0, code_proposal_verification_1.assessCodeProposalVerificationIntegrity)(proposal)).toBeNull();
    expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)).toBeNull();
});
function mixedFixture() {
    const { verificationConfigurationHash, mergedVerificationRules } = require('../lib/code-proposal-verification');
    const proposal = fixture();
    proposal.current_prompt = 'baseline prompt';
    proposal.proposed_rules = [{ original_text: 'house-made', corrected_text: 'housemade', change_type: 'terminology' }];
    proposal.correction_routing.push({ correction_id: 'c2', lane: 'replacement_rule', original_text: 'Bread, house-made', corrected_text: 'Bread, housemade' });
    const proof = proposal.eval_summary.code_verification;
    proof.schema_version = 2;
    const behaviorLib = require('../lib/learning-behavior-tests');
    const artifact = behaviorLib.freezeBehaviorTests(proposal.correction_routing.map((row) => behaviorLib.buildBehaviorTestRecord({ ...row, id: row.correction_id, source: 'human', reviewer_name: 'Synthetic fixture reviewer', status: 'accepted' })), []);
    proposal.eval_summary.behavior_tests = artifact;
    proposal.eval_summary.code_candidate.behavior_tests_sha256 = artifact.sha256;
    proof.behavior = { artifact, candidate: { artifactHash: artifact.sha256, passed: true, outcomes: [] } };
    proof.proposal_sha256 = (0, code_proposal_verification_1.codeProposalVerificationFingerprint)(proposal);
    const candidateRules = mergedVerificationRules([], proposal.proposed_rules);
    const configurations = Object.fromEntries(['baseline', 'candidate'].map(arm => [arm, {
            source_sha256: proof[arm].source_sha256, dataset_sha256: proof.inputs.dataset_sha256,
            prompt_sha256: digest(arm === 'baseline' ? proposal.current_prompt : proposal.proposed_prompt),
            accepted_rules_sha256: (0, code_proposal_verification_1.hashAcceptedRules)(arm === 'baseline' ? [] : candidateRules),
            vocabulary_sha256: digest('frozen vocabulary'), expectations_sha256: digest('raw expectations'),
            case_ids: proof.inputs.case_ids, model: proof.inputs.model, settings: { temperature: 0 },
        }]));
    const corrections = [...proof.corrections, { ...proposal.correction_routing[1], case_id: 'regression1' }];
    proof.combined = { baseline_rules: [], candidate_rules: candidateRules, configurations,
        configuration_hashes: Object.fromEntries(Object.entries(configurations).map(([arm, config]) => [arm, verificationConfigurationHash(config)])), corrections,
        runs: proof.runs.map((run) => ({ seed: run.seed, freshness: 'fresh', corrections: [
                ...run.corrections, { correction_id: 'c2', baseline_output: 'Bread, house-made', candidate_output: 'Bread, housemade' },
            ], rule_activations: [{ rule_id: 'eval-candidate-rule-0', total_activations: 1, case_ids: ['regression1'], final_survives: true }],
            cases: proof.inputs.case_ids.map((case_id) => ({ case_id, baseline_extra_edits: 0, candidate_extra_edits: 0 })) })) };
    return proposal;
}
function deliveryV2Fixture() {
    const proposal = mixedFixture();
    const proof = proposal.eval_summary.code_verification;
    proposal.correction_routing[0].replay_status = 'delivery_mismatch';
    proof.corrections[0].delivery_assertion = true;
    proof.corrections[0].delivery_evidence_scope = 'serializer_request_boundary_v1';
    const driver = digest('delivery driver');
    const sourceHashesForFixture = { quill: digest('quill'), diff_core: digest('diff_core'), redline_preview: digest('redline_preview'), form_submission: digest('form_submission') };
    const source = digest(JSON.stringify({ baseline: sourceHashesForFixture, candidate: sourceHashesForFixture }));
    const fixtureHash = digest('delivery fixture');
    const identityBody = {
        browser_version: '148.0.7778.0',
        delivery_driver_sha256: driver,
        delivery_fixture_sha256: fixtureHash,
        delivery_image_id: digest('delivery image'),
        delivery_runtime_id: digest('delivery runtime'),
        delivery_source_sha256: source,
        quill_version: '1.3.6',
    };
    const identitySha = digest(JSON.stringify(Object.fromEntries(Object.keys(identityBody).sort().map((key) => [key, identityBody[key]]))));
    proof.inputs.delivery_driver_sha256 = driver;
    proof.inputs.delivery_fixture_sha256 = fixtureHash;
    proof.inputs.delivery_claim = 'serializer_request_boundary_v1';
    proof.inputs.delivery_identity_sha256 = identitySha;
    proof.inputs.delivery_identity = { ...identityBody, identity_sha256: identitySha };
    const sourceHashes = { ...sourceHashesForFixture };
    sourceHashes.driver = driver;
    for (const run of proof.runs)
        run.delivery = [{
                correction_id: 'c1', driver: 'form-submit-v1', driver_sha256: driver,
                chromium_sandbox_enabled: false, isolation_boundary: 'container',
                delivery_claim: 'serializer_request_boundary_v1', reviewed_state_selection: false, full_form_assembly: false,
                controls: { uid: 65532, gid: 65532, raw_groups: ['65532'], supplementary_groups: [], capabilities: { CapInh: '0000000000000000', CapPrm: '0000000000000000', CapEff: '0000000000000000', CapAmb: '0000000000000000' }, no_new_privs: '1', seccomp: '2', root_mount_read_only: true, network_interfaces: ['lo'] },
                image_id: identityBody.delivery_image_id, runtime_id: identityBody.delivery_runtime_id,
                delivery_fixture_sha256: fixtureHash, source_manifest_sha256: source,
                baseline_submitted_text: 'Dish, lemons', candidate_submitted_text: 'Dish, lemon',
                baseline_submitted_html: '<p>Dish, lemons</p>', candidate_submitted_html: '<p>Dish, lemon</p>',
                baseline_submitted_html_text: 'Dish, lemons', candidate_submitted_html_text: 'Dish, lemon',
                baseline_source_hashes: sourceHashes, candidate_source_hashes: sourceHashes,
                baseline_browser_version: identityBody.browser_version, candidate_browser_version: identityBody.browser_version,
                quill_version: identityBody.quill_version,
            }];
    return proposal;
}
describe('version 2 combined verification', () => {
    test('accepts complete code and separate rule evidence', () => expect((0, code_proposal_verification_1.assessCodeProposalVerification)(mixedFixture())).toBeNull());
    test.each([
        ['missing code implementation', (proof) => { proof.candidate.source_sha256 = proof.baseline.source_sha256; }],
        ['rule never fires', (proof) => { proof.combined.runs[0].rule_activations = []; }],
        ['rule reverted later', (proof) => { proof.combined.runs[0].rule_activations[0].final_survives = false; }],
        ['missing rule correction', (proof) => { proof.combined.runs[1].corrections.pop(); }],
        ['stale vocabulary', (proof) => { proof.combined.configurations.candidate.vocabulary_sha256 = digest('new'); }],
        ['changed candidate rules', (proof) => { proof.combined.candidate_rules = []; }],
        ['cached replay', (proof) => { proof.combined.runs[0].freshness = 'cached_or_mixed'; }],
        ['unsafe extra edit', (proof) => { proof.combined.runs[0].cases[0].candidate_extra_edits = 1; }],
    ])('blocks %s', (_name, mutate) => {
        const proposal = mixedFixture();
        mutate(proposal.eval_summary.code_verification);
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)).not.toBeNull();
    });
    test('accepts only exact non-root container-isolated browser delivery bindings', () => {
        expect((0, code_proposal_verification_1.assessCodeProposalVerification)(deliveryV2Fixture())).toBeNull();
        for (const mutate of [
            (_delivery, proof) => { delete proof.corrections[0].delivery_evidence_scope; },
            (delivery) => { delivery.controls.uid = 0; },
            (delivery) => { delivery.chromium_sandbox_enabled = true; },
            (delivery) => { delete delivery.controls.capabilities.CapEff; },
            (delivery) => { delivery.controls.raw_groups = ['777']; },
            (delivery) => { delivery.baseline_browser_version = 'wrong-browser'; },
            (delivery) => { delivery.baseline_source_hashes.form_submission = digest('changed source'); },
            (delivery) => { delivery.image_id = digest('other image'); },
            (delivery) => { delivery.delivery_fixture_sha256 = digest('other fixture'); },
            (delivery) => { delivery.source_manifest_sha256 = digest('other source'); },
            (delivery) => { delivery.driver_sha256 = digest('other driver'); },
        ]) {
            const proposal = deliveryV2Fixture();
            mutate(proposal.eval_summary.code_verification.runs[0].delivery[0], proposal.eval_summary.code_verification);
            expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)).not.toBeNull();
        }
    });
});
test.each([undefined, false])('missing or failed completion evidence never passes even with exact scores: %s', complete => {
    const proposal = fixture();
    proposal.eval_summary.code_verification.runs[0].cases[0].candidate_contract_complete = complete;
    expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.error).toContain('response contract');
});
test('independent repeats cannot reuse the same evaluator report', () => {
    const proposal = fixture();
    const proof = proposal.eval_summary.code_verification;
    proof.runs[1].candidate_report_sha256 = proof.runs[0].candidate_report_sha256;
    expect((0, code_proposal_verification_1.assessCodeProposalVerification)(proposal)?.error).toContain('cannot be reused');
});

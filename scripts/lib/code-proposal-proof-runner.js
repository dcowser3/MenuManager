'use strict';

/**
 * B5-C2c1: credential-free, independent proof runner.
 *
 * This module deliberately has no provider, database, Docker, or shell
 * boundary.  Every executor is injected by the caller.  The candidate can
 * provide an implementation and tests, but it cannot provide the trusted
 * plan, reports, hashes, progress, proof, or owner identity.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { revalidateAttemptArtifacts, hashImplementation, readDataset } = require('./code-proposal-draft');
const { loadVerificationModule, recordCodeVerification } = require('./proposal-verification-store');

const DIGEST = /^[a-f0-9]{64}$/;
const TEST_PATH = /^services\/dashboard\/__tests__\/code-candidate-[a-z0-9-]+\.test\.(?:ts|js)$/;
const MAX_REPORT_BYTES = 12 * 1024 * 1024;
const PHASES = ['unit_tests', 'retrospective_replay', 'holdout', 'verification'];
const hashBytes = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashJson = (value) => hashBytes(Buffer.from(JSON.stringify(canonical(value))));
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const isDigest = (value) => typeof value === 'string' && DIGEST.test(value);
const safeId = (value, label) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(`${value || ''}`)) throw new Error(`Invalid ${label}.`);
    return `${value}`;
};

function ensureDirectory(directory, mode = 0o700, label = 'Artifact directory') {
    const resolved = path.resolve(directory);
    if (fs.existsSync(resolved)) {
        const stat = fs.lstatSync(resolved);
        if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== mode) throw new Error(`${label} must be a regular mode-${mode.toString(8)} directory.`);
        return resolved;
    }
    fs.mkdirSync(resolved, { recursive: true, mode });
    fs.chmodSync(resolved, mode);
    return resolved;
}

function assertInside(root, target, label = 'Artifact path') {
    const r = path.resolve(root), t = path.resolve(target);
    if (t === r || !t.startsWith(`${r}${path.sep}`)) throw new Error(`${label} escapes the trusted attempt root.`);
    let cursor = r;
    for (const part of path.relative(r, t).split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} traverses a symlink.`);
    }
    return t;
}

function atomicWrite(file, value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${value}`);
    const directory = path.dirname(file);
    const temporary = path.join(directory, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, file); fs.chmodSync(file, 0o600);
    const dirFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

function regularFile(file, root, label) {
    const target = assertInside(root, file, label);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error(`${label} must be a regular mode-0600 file.`);
    return fs.readFileSync(target);
}

function walkCandidateTests(root) {
    const found = [];
    const visit = (relative) => {
        const full = path.join(root, relative);
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) throw new Error('Candidate tree contains a symlink.');
        if (stat.isDirectory()) return fs.readdirSync(full).sort().forEach((name) => visit(path.join(relative, name)));
        const normalized = relative.split(path.sep).join('/');
        if (TEST_PATH.test(normalized)) found.push(normalized);
    };
    visit('');
    return found.sort();
}

function trustedCorrections(proposal, corrections) {
    const routes = (proposal.correction_routing || []).filter((row) => row?.lane === 'code_recommendation');
    if (!routes.length || !Array.isArray(corrections) || corrections.length !== routes.length) throw new Error('C2c1 requires one frozen correction mapping for every code recommendation.');
    const routeIds = new Set(routes.map((row) => row.correction_id));
    if (new Set(corrections.map((row) => row?.correction_id)).size !== corrections.length || corrections.some((row) => !routeIds.has(row.correction_id))) throw new Error('Correction mappings are not the frozen proposal routing.');
    return routes.map((route) => {
        const row = corrections.find((entry) => entry.correction_id === route.correction_id);
        if (!row || typeof row.case_id !== 'string' || typeof row.test_name !== 'string' || !Array.isArray(row.recommendation_indexes)
            || !row.recommendation_indexes.length || row.original_text !== route.original_text || row.corrected_text !== route.corrected_text
            || !row.recommendation_indexes.every((index) => Number.isInteger(index) && index >= 0 && index < (proposal.code_recommendations || []).length)) throw new Error(`Frozen correction mapping is invalid: ${route.correction_id}.`);
        return { correction_id: row.correction_id, case_id: row.case_id, test_name: row.test_name, original_text: row.original_text, corrected_text: row.corrected_text, recommendation_indexes: [...row.recommendation_indexes], delivery_assertion: row.delivery_assertion === true };
    });
}

function assertOwnerClaim(proposal, metadata) {
    const claim = proposal?.eval_summary?.code_candidate;
    if (!claim || claim.status !== 'running' || claim.attempt_id !== metadata.attempt_id) throw new Error('C2c1 requires the still-running owner claim for this attempt.');
}

function reportsFromExecutor(value, label, inventory) {
    if (!value || !Number.isInteger(value.exit_code) || !value.report || typeof value.report !== 'object' || Array.isArray(value.report)) throw new Error(`${label} executor must return a structured Jest report and exit code.`);
    const bytes = Buffer.from(JSON.stringify(value.report));
    if (bytes.length > MAX_REPORT_BYTES || !Array.isArray(value.report.testResults)) throw new Error(`${label} executor returned an invalid or oversized report.`);
    const names = value.report.testResults.map((result) => `${result?.name || ''}`.replace(/\\/g, '/'));
    const missing = inventory.filter((file) => !names.some((name) => name.endsWith(`/${file}`) || name === file));
    const unexpected = names.filter((name) => !inventory.some((file) => name.endsWith(`/${file}`) || name === file));
    if (missing.length || unexpected.length || names.length !== inventory.length) throw new Error(`${label} report test inventory differs from the trusted plan.`);
    const assertionResults = value.report.testResults.flatMap((result) => Array.isArray(result.assertionResults) ? result.assertionResults : []);
    if (!assertionResults.length || assertionResults.some((entry) => !['passed', 'failed', 'pending', 'skipped', 'todo'].includes(entry.status))) throw new Error(`${label} report has incomplete assertion records.`);
    return { exit_code: value.exit_code, report_sha256: hashBytes(bytes), report: value.report };
}

function assertPairedTestReports(tests, corrections, verification) {
    const block = verification.assessCodeVerificationTests(tests, corrections);
    if (block) throw new Error(block);
    return tests;
}

function progressRecord(metadata, phase, state, extra = {}) {
    return { schema_version: 1, attempt_id: metadata.attempt_id, phase, state, ...extra, updated_at: new Date().toISOString() };
}

function writeProgress(attemptRoot, metadata, phase, state, extra = {}, progressWriter) {
    const candidateRoot = assertInside(attemptRoot, path.join(attemptRoot, 'candidate'));
    ensureDirectory(candidateRoot, 0o700, 'Candidate artifact directory');
    const record = progressRecord(metadata, phase, state, extra);
    atomicWrite(path.join(candidateRoot, 'progress.json'), `${JSON.stringify(record, null, 2)}\n`);
    if (typeof progressWriter === 'function') progressWriter(record);
    return record;
}

function validateReplayResult(value, label) {
    if (!value || typeof value.output !== 'string' || value.contractComplete !== true || value.fenceMissing !== false
        || !Number.isFinite(value.composite) || value.composite < 0 || value.composite > 1
        || !Number.isInteger(value.extraEdits) || value.extraEdits < 0 || typeof (value.report_id || value.reportId) !== 'string' || !(value.report_id || value.reportId).trim()) throw new Error(`${label} replay result is incomplete or has an invalid response contract.`);
    return { output: value.output, report_id: value.report_id || value.reportId, contractComplete: true, fenceMissing: false, composite: value.composite, extraEdits: value.extraEdits };
}

function deliveryRequired(proposal, corrections) {
    return corrections.filter((correction) => {
        const route = (proposal.correction_routing || []).find((row) => row.correction_id === correction.correction_id);
        const evidence = (proposal.replay_evidence || []).find((row) => row.correction_id === correction.correction_id);
        return route?.replay_status === 'delivery_mismatch' || evidence?.status === 'delivery_mismatch';
    }).map((correction) => correction.correction_id);
}

function validateDelivery(value, correction, driverHash) {
    if (!value || value.driver !== 'form-submit-v1' || !isDigest(driverHash)
        || !isDigest(value.baseline_source_hashes?.driver) || !isDigest(value.candidate_source_hashes?.driver)
        || value.baseline_source_hashes.driver !== driverHash || value.candidate_source_hashes.driver !== driverHash
        || !['form', 'form_helpers', 'diff_core', 'redline_preview', 'form_stage', 'showStep2', 'submitMenu', 'quill'].every((key) => isDigest(value.baseline_source_hashes?.[key]) && isDigest(value.candidate_source_hashes?.[key]))
        || !value.baseline_browser_version || !value.candidate_browser_version || value.quill_version !== '1.3.6'
        || typeof value.baseline_submitted_text !== 'string' || typeof value.candidate_submitted_text !== 'string'
        || typeof value.baseline_submitted_html !== 'string' || typeof value.candidate_submitted_html !== 'string'
        || typeof value.baseline_submitted_html_text !== 'string' || typeof value.candidate_submitted_html_text !== 'string') throw new Error(`Delivery evidence is incomplete for ${correction.correction_id}.`);
    if (!value.candidate_submitted_text.split('\n').map((line) => line.trim()).includes(correction.corrected_text.trim())
        || !value.candidate_submitted_html_text.split('\n').map((line) => line.trim()).includes(correction.corrected_text.trim())) throw new Error(`Delivery evidence does not contain the corrected text for ${correction.correction_id}.`);
    return { ...value };
}

function makePlan({ attemptRoot, metadata, proposal, baselineHash, candidateHash, parentCampaignSha256, imageId, runtimeId, replayPolicyVersion, caseIds, seeds, inventory, corrections, paths }) {
    const planBody = {
        schema_version: 1, test_only: true, attempt_id: metadata.attempt_id,
        proposal_sha256: metadata.proposal_sha256, parent_campaign_sha256: parentCampaignSha256,
        baseline_source_sha256: baselineHash, candidate_source_sha256: candidateHash,
        image_id: imageId, runtime_id: runtimeId, replay_policy_version: replayPolicyVersion,
        case_ids: [...caseIds], seeds: [...seeds], test_inventory: [...inventory], corrections,
        paths,
    };
    return { ...planBody, plan_sha256: hashJson(planBody) };
}

async function runCodeProposalProof(options = {}) {
    const required = ['attemptRoot', 'trustedRoot', 'metadata', 'proposal', 'baselineRoot', 'candidateRoot', 'verification', 'executor', 'replayExecutor', 'corrections', 'imageId', 'runtimeId', 'replayPolicyVersion'];
    for (const key of required) if (options[key] === undefined || options[key] === null) throw new Error(`C2c1 requires ${key}.`);
    const attemptRoot = path.resolve(options.attemptRoot);
    const trustedRoot = path.resolve(options.trustedRoot);
    const metadata = options.metadata;
    safeId(metadata.attempt_id, 'attempt id');
    assertOwnerClaim(options.proposal, metadata);
    if (path.resolve(options.baselineRoot) === path.resolve(options.candidateRoot)) throw new Error('Baseline and candidate roots must be distinct.');
    ensureDirectory(attemptRoot, 0o700, 'Attempt artifact directory');
    const baselineRoot = assertInside(attemptRoot, options.baselineRoot, 'Baseline root');
    const candidateRoot = assertInside(attemptRoot, options.candidateRoot, 'Candidate root');
    ensureDirectory(baselineRoot, 0o700, 'Baseline root'); ensureDirectory(candidateRoot, 0o700, 'Candidate root');
    const checked = revalidateAttemptArtifacts({ attemptRoot, trustedRoot, metadata, proposal: options.proposal, verification: options.verification, behaviorModule: options.behaviorModule, baselineRoot });
    const baselineHash = options.verification.hashCodeImplementation(baselineRoot);
    const candidateHash = options.verification.hashCodeImplementation(candidateRoot);
    if (!isDigest(baselineHash) || baselineHash !== metadata.baseline_source_sha256) throw new Error('Baseline implementation hash is stale or differs from the frozen attempt.');
    if (!isDigest(candidateHash) || candidateHash === baselineHash || candidateHash !== (options.frozenPlan?.candidate_source_sha256 || metadata.candidate_source_sha256 || options.candidateSourceSha256)) throw new Error('Candidate implementation hash is missing, unchanged, or differs from the frozen plan.');
    const parentCampaignSha256 = options.proposal.parent_campaign_sha256 || options.proposal.eval_summary?.parent_campaign_sha256;
    if (!isDigest(parentCampaignSha256) || (metadata.parent_campaign_sha256 && parentCampaignSha256 !== metadata.parent_campaign_sha256) || parentCampaignSha256 !== (options.frozenPlan?.parent_campaign_sha256 || metadata.parent_campaign_sha256 || parentCampaignSha256)) throw new Error('Parent campaign lineage is missing or differs from the frozen plan.');
    if (!options.imageId || !options.runtimeId || !Number.isInteger(options.replayPolicyVersion)) throw new Error('C2c1 requires a frozen image, runtime, and replay policy identity.');
    if (Number.isInteger(options.verification.REPLAY_RETIREMENT_POLICY_VERSION) && options.verification.REPLAY_RETIREMENT_POLICY_VERSION !== options.replayPolicyVersion) throw new Error('Replay policy identity is stale.');
    const datasetBytes = regularFile(path.join(attemptRoot, 'dataset.jsonl'), attemptRoot, 'Frozen dataset');
    const cases = readDataset(datasetBytes);
    const caseIds = cases.map((row) => row.case_id);
    if (hashBytes(datasetBytes) !== metadata.expected_dataset_sha256 || JSON.stringify(caseIds) !== JSON.stringify(metadata.expected_case_ids)) throw new Error('Frozen dataset identity is stale.');
    const rulesBytes = regularFile(path.join(attemptRoot, 'rules.json'), attemptRoot, 'Accepted rules');
    if (metadata.rules_file_sha256 && hashBytes(rulesBytes) !== metadata.rules_file_sha256) throw new Error('Accepted-rule file identity is stale.');
    const corrections = trustedCorrections(options.proposal, options.corrections);
    if (corrections.some((row) => !caseIds.includes(row.case_id))) throw new Error('Correction mapping references a case outside the frozen dataset.');
    const trustedSuites = options.verification.CODE_PROPOSAL_REGRESSION_TESTS || [];
    const candidateTests = walkCandidateTests(candidateRoot);
    if (!candidateTests.length) throw new Error('Candidate must contain an explicit supplemental regression test.');
    const inventory = [...new Set([...trustedSuites, ...candidateTests])].sort();
    const seeds = options.seeds || [17, 7919];
    if (!Array.isArray(seeds) || seeds.length !== 2 || !seeds.every((seed) => Number.isInteger(seed)) || new Set(seeds).size !== 2) throw new Error('C2c1 requires two distinct replay seeds.');
    const verifierRoot = path.join(attemptRoot, 'verifier');
    if (fs.existsSync(verifierRoot)) throw new Error('Verifier output root already exists; proof runs cannot reuse prior artifacts.');
    ensureDirectory(verifierRoot, 0o700, 'Verifier output root');
    const paths = { plan: path.join(verifierRoot, 'plan.json'), baselineReport: path.join(verifierRoot, 'baseline-report.json'), candidateReport: path.join(verifierRoot, 'candidate-report.json'), proof: path.join(verifierRoot, 'proof.json') };
    const plan = makePlan({ attemptRoot, metadata, proposal: options.proposal, baselineHash, candidateHash, parentCampaignSha256, imageId: options.imageId, runtimeId: options.runtimeId, replayPolicyVersion: options.replayPolicyVersion, caseIds, seeds, inventory, corrections, paths });
    atomicWrite(paths.plan, `${JSON.stringify(plan, null, 2)}\n`);
    const progress = (phase, state, extra = {}) => writeProgress(attemptRoot, metadata, phase, state, { total: caseIds.length, ...extra }, options.progressWriter);
    try {
        progress('unit_tests', 'active', { completed: 0 });
        const baselineRaw = await options.executor({ arm: 'baseline', root: baselineRoot, inventory: [...inventory], plan: { ...plan }, attemptId: metadata.attempt_id });
        const candidateRaw = await options.executor({ arm: 'candidate', root: candidateRoot, inventory: [...inventory], plan: { ...plan }, attemptId: metadata.attempt_id });
        const tests = { baseline: reportsFromExecutor(baselineRaw, 'Baseline', inventory), candidate: reportsFromExecutor(candidateRaw, 'Candidate', inventory) };
        atomicWrite(paths.baselineReport, `${JSON.stringify(tests.baseline.report, null, 2)}\n`); atomicWrite(paths.candidateReport, `${JSON.stringify(tests.candidate.report, null, 2)}\n`);
        assertPairedTestReports(tests, corrections, options.verification);
        progress('retrospective_replay', 'active', { completed: 0, total: caseIds.length * seeds.length });
        const runs = [];
        const replayIdentities = new Set();
        const deliveryIds = deliveryRequired(options.proposal, corrections);
        for (const seed of seeds) {
            const run = { run_id: `${metadata.attempt_id}:replay:${seed}`, seed, baseline_errors: 0, candidate_errors: 0, cases: [], corrections: [] };
            const results = { baseline: new Map(), candidate: new Map() };
            for (const arm of ['baseline', 'candidate']) {
                for (const row of cases) {
                    const raw = await options.replayExecutor({ arm, root: arm === 'baseline' ? baselineRoot : candidateRoot, seed, runId: run.run_id, case: { ...row }, plan: { ...plan } });
                    const validated = validateReplayResult(raw, `${arm} ${row.case_id}`);
                    if (replayIdentities.has(validated.report_id)) throw new Error(`Replay report identity was reused: ${validated.report_id}.`);
                    replayIdentities.add(validated.report_id);
                    results[arm].set(row.case_id, validated);
                }
            }
            for (const row of cases) {
                const baseline = results.baseline.get(row.case_id), candidate = results.candidate.get(row.case_id);
                if (candidate.composite - baseline.composite < -0.02 || candidate.extraEdits > baseline.extraEdits) throw new Error(`Candidate replay regresses or widens edits for ${row.case_id}.`);
                run.cases.push({ case_id: row.case_id, baseline_composite: baseline.composite, candidate_composite: candidate.composite, baseline_fence_missing: false, candidate_fence_missing: false, baseline_contract_complete: true, candidate_contract_complete: true, baseline_extra_edits: baseline.extraEdits, candidate_extra_edits: candidate.extraEdits });
            }
            for (const correction of corrections) {
                const baseline = results.baseline.get(correction.case_id), candidate = results.candidate.get(correction.case_id);
                if (!baseline || !candidate || !options.verification.codeVerificationCorrectionPresent(candidate.output, correction)) throw new Error(`Candidate replay misses correction ${correction.correction_id}.`);
                run.corrections.push({ correction_id: correction.correction_id, baseline_output: baseline.output, candidate_output: candidate.output });
            }
            if (deliveryIds.length) {
                if (typeof options.deliveryExecutor !== 'function') throw new Error('Delivery evidence is required but no injected delivery executor was provided.');
                run.delivery = [];
                for (const correction of corrections.filter((entry) => deliveryIds.includes(entry.correction_id))) run.delivery.push(validateDelivery(await options.deliveryExecutor({ arm: 'paired', seed, runId: run.run_id, correction, plan: { ...plan } }), correction, options.deliveryDriverSha256));
            }
            run.baseline_report_sha256 = hashJson({ seed, arm: 'baseline', results: [...results.baseline.entries()] });
            run.candidate_report_sha256 = hashJson({ seed, arm: 'candidate', results: [...results.candidate.entries()] });
            runs.push(run);
        }
        progress('holdout', 'active', { completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length });
        const behaviorArtifact = checked.behavior;
        if (!behaviorArtifact || typeof options.behaviorEvaluator !== 'function' || !options.behaviorModule?.executeBehaviorTests) throw new Error('Independent B6-D1 behavior evaluation requires an injected evaluator.');
        const behaviorCandidate = await options.behaviorModule.executeBehaviorTests(behaviorArtifact, options.behaviorEvaluator);
        if (behaviorCandidate.artifactHash !== behaviorArtifact.sha256 || behaviorCandidate.passed !== true || behaviorCandidate.outcomes.some((outcome) => outcome.passed !== true || outcome.outputHash !== outcome.expectedHash)) throw new Error('Candidate behavior outcomes do not match frozen B6-D1 expectations.');
        const proof = { schema_version: 2, test_only: true, runner: 'verify-code-proposal', status: 'passed', generated_at: new Date().toISOString(), proposal_sha256: options.verification.codeProposalVerificationFingerprint(options.proposal), baseline: { source_sha256: baselineHash, root: baselineRoot }, candidate: { source_sha256: candidateHash, root: candidateRoot }, inputs: { dataset_sha256: metadata.expected_dataset_sha256, prompt_sha256: metadata.prompt_sha256, rules_sha256: metadata.rules_file_sha256 || metadata.accepted_rules_sha256, accepted_rules_sha256: metadata.accepted_rules_sha256, tests_sha256: hashJson(inventory), image_id: options.imageId, model: options.model || 'test-only', raw_ground_truth: true, case_ids: caseIds, ...(deliveryIds.length ? { delivery_driver_sha256: options.deliveryDriverSha256 } : {}) }, corrections, tests, runs, behavior: { artifact: behaviorArtifact, candidate: behaviorCandidate } };
        progress('verification', 'active', { completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length });
        const candidateProposal = { ...options.proposal, eval_summary: { ...(options.proposal.eval_summary || {}), replay_retirement_policy_version: options.replayPolicyVersion, code_candidate: { ...(options.proposal.eval_summary?.code_candidate || {}), expected_dataset_sha256: metadata.expected_dataset_sha256, expected_case_ids: caseIds, behavior_tests_sha256: behaviorArtifact.sha256 }, code_verification: proof } };
        const block = options.verification.assessCodeProposalVerificationIntegrity(candidateProposal);
        if (block) throw new Error(`Proof integrity rejected: ${block.error}`);
        if (options.client && options.originalProposal) {
            const store = options.store || { recordCodeVerification };
            await store.recordCodeVerification(options.client, options.originalProposal, { attempt_id: metadata.attempt_id, code_verification: proof, code_candidate: { ...metadata, status: 'verified', phase: 'verification', completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length } }, options.verification);
        }
        atomicWrite(paths.proof, `${JSON.stringify(proof, null, 2)}\n`);
        progress('verification', 'verified', { completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length, proof_path: paths.proof });
        return { status: 'verified', proof, plan, paths, baselineHash, candidateHash };
    } catch (error) {
        const message = `${error?.message || error}`.slice(0, 1000);
        try { if (fs.existsSync(paths.proof)) fs.unlinkSync(paths.proof); } catch { /* failed proof cleanup is best effort */ }
        progress('verification', 'failed', { completed: 0, total: caseIds.length, reason: message });
        if (options.client && options.originalProposal) {
            const store = options.store || { recordCodeVerification };
            await store.recordCodeVerification(options.client, options.originalProposal, { attempt_id: metadata.attempt_id, code_candidate: { ...metadata, status: 'failed', phase: 'verification', reason: message } }, options.verification);
        }
        throw error;
    }
}

module.exports = { runCodeProposalProof, runIndependentCodeProposalProof: runCodeProposalProof, validateReplayResult, reportsFromExecutor, walkCandidateTests, makePlan };

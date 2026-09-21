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
const { validateDeliveryIdentity } = require('./code-proposal-delivery-identity');
const fs = require('fs');
const path = require('path');
const { revalidateAttemptArtifacts, hashImplementation, readDataset } = require('./code-proposal-draft');
const { loadVerificationModule, recordCodeVerification } = require('./proposal-verification-store');
const { redact } = require('./model-budget-broker');
const { createDockerC2c2Executors } = require('./code-proposal-docker-launcher');

const DIGEST = /^[a-f0-9]{64}$/;
const TEST_PATH = /^services\/dashboard\/__tests__\/code-candidate-[a-z0-9-]+\.test\.(?:ts|js)$/;
const MAX_REPORT_BYTES = 12 * 1024 * 1024;
const PHASES = ['unit_tests', 'retrospective_replay', 'holdout', 'verification'];
const hashBytes = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashJson = (value) => hashBytes(Buffer.from(JSON.stringify(canonical(value))));
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const isDigest = (value) => typeof value === 'string' && DIGEST.test(value);
const isImmutableIdentity = (value) => typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/.test(value);
const DELIVERY_SOURCE_KEYS = ['quill', 'diff_core', 'redline_preview', 'form_submission'];
const deliverySourceManifestHash = (value) => hashBytes(Buffer.from(JSON.stringify({ baseline: Object.fromEntries(DELIVERY_SOURCE_KEYS.map((key) => [key, value.baseline_source_hashes?.[key]])), candidate: Object.fromEntries(DELIVERY_SOURCE_KEYS.map((key) => [key, value.candidate_source_hashes?.[key]])) })));
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

function regularFile(file, root, label, requiredMode = 0o600) {
    const target = assertInside(root, file, label);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || (requiredMode !== null && (stat.mode & 0o777) !== requiredMode)) throw new Error(`${label} must be a regular${requiredMode === null ? '' : ` mode-${requiredMode.toString(8)}`} file.`);
    return fs.readFileSync(target);
}

function loadBehaviorModule(repoRoot) {
    const source = path.join(repoRoot, 'services/dashboard/lib/learning-behavior-tests.ts');
    try {
        require(require.resolve('ts-node/register/transpile-only', { paths: [repoRoot] }));
        if (fs.existsSync(source)) return require(source);
    } catch { /* checked-in dist is the Docker fallback */ }
    return require(path.join(repoRoot, 'services/dashboard/dist/lib/learning-behavior-tests'));
}

function loadTrustedTsModule(repoRoot, relative) {
    try { require(require.resolve('ts-node/register/transpile-only', { paths: [repoRoot] })); } catch { /* dist fallback below */ }
    const source = path.join(repoRoot, `${relative}.ts`);
    return fs.existsSync(source) ? require(source) : require(path.join(repoRoot, `${relative}.js`));
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

function trustedCorrections(proposal, corrections, lanes = new Set(['code_recommendation'])) {
    const routes = (proposal.correction_routing || []).filter((row) => lanes.has(row?.lane));
    if (!routes.length || !Array.isArray(corrections) || corrections.length !== routes.length) throw new Error('C2c1 requires one frozen correction mapping for every code recommendation.');
    const routeIds = new Set(routes.map((row) => row.correction_id));
    if (new Set(corrections.map((row) => row?.correction_id)).size !== corrections.length || corrections.some((row) => !routeIds.has(row.correction_id))) throw new Error('Correction mappings are not the frozen proposal routing.');
    return routes.map((route) => {
        const row = corrections.find((entry) => entry.correction_id === route.correction_id);
        const isCode = route.lane === 'code_recommendation';
        if (!row || typeof row.case_id !== 'string' || (isCode && typeof row.test_name !== 'string') || (isCode && !Array.isArray(row.recommendation_indexes))
            || (isCode && !row.recommendation_indexes.length) || row.original_text !== route.original_text || row.corrected_text !== route.corrected_text
            || (isCode && !row.recommendation_indexes.every((index) => Number.isInteger(index) && index >= 0 && index < (proposal.code_recommendations || []).length))) throw new Error(`Frozen correction mapping is invalid: ${route.correction_id}.`);
        return { correction_id: row.correction_id, case_id: row.case_id, test_name: row.test_name || '', original_text: row.original_text, corrected_text: row.corrected_text, recommendation_indexes: [...(row.recommendation_indexes || [])], delivery_assertion: row.delivery_assertion === true };
    });
}

function readC2bHandoff(file, attemptRoot, metadata) {
    const bytes = regularFile(file, attemptRoot, 'C2b handoff');
    const handoffHash = hashBytes(bytes);
    if (!isDigest(metadata.c2b_handoff_sha256) || metadata.c2b_handoff_sha256 !== handoffHash) throw new Error('C2b handoff identity is stale or missing.');
    let handoff;
    try { handoff = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('C2b handoff is not valid JSON.'); }
    if (!handoff || handoff.schema_version !== 1 || handoff.attempt_id !== metadata.attempt_id
        || !isDigest(metadata.authorization_hash) || !isDigest(metadata.scope_hash) || !isDigest(metadata.c2b_handoff_sha256)
        || !isDigest(metadata.candidate_source_sha256) || !isDigest(metadata.draft_patch_sha256) || !isDigest(metadata.draft_content_sha256) || !isDigest(metadata.draft_response_sha256)
        || handoff.authorization_hash !== metadata.authorization_hash || handoff.scope_hash !== metadata.scope_hash
        || !isDigest(handoff.authorization_hash) || !isDigest(handoff.scope_hash)
        || !handoff.draft || !isDigest(handoff.draft.patch_sha256) || !isDigest(handoff.draft.content_sha256)
        || handoff.draft.patch_sha256 !== metadata.draft_patch_sha256 || handoff.draft.content_sha256 !== metadata.draft_content_sha256
        || !Array.isArray(handoff.draft.test_files) || !Array.isArray(handoff.draft.corrections)
        || !isDigest(handoff.draft.response_sha256 || handoff.response_sha256 || handoff.response?.body_sha256)
        || (handoff.draft.response_sha256 || handoff.response_sha256 || handoff.response?.body_sha256) !== metadata.draft_response_sha256
        || !isDigest(handoff.baseline_source_sha256) || !isDigest(handoff.candidate_source_sha256)
        || typeof handoff.draft.patch !== 'string') throw new Error('C2b handoff is incomplete or not bound to the validated draft.');
    if (handoff.candidate_source_sha256 !== metadata.candidate_source_sha256) throw new Error('Candidate implementation hash differs from the frozen plan.');
    const draftBody = { summary: handoff.draft.summary || '', patch: handoff.draft.patch, test_files: [...handoff.draft.test_files], corrections: [...handoff.draft.corrections] };
    if (hashBytes(Buffer.from(handoff.draft.patch)) !== handoff.draft.patch_sha256
        || hashBytes(Buffer.from(JSON.stringify(draftBody))) !== handoff.draft.content_sha256) throw new Error('C2b draft bytes do not match the bound identities.');
    return { handoff, handoffHash };
}

function freezeTestBundle({ verifierRoot, baselineRoot, candidateRoot, inventory, candidateTests, handoff }) {
    const bundleRoot = ensureDirectory(path.join(verifierRoot, 'test-bundle'), 0o700, 'Test bundle root');
    const manifest = [];
    for (const relative of inventory) {
        const sourceRoot = candidateTests.includes(relative) ? candidateRoot : baselineRoot;
        const baselineBytes = candidateTests.includes(relative) ? null : regularFile(path.join(baselineRoot, relative), baselineRoot, `Trusted test ${relative}`, null);
        const candidateBytes = regularFile(path.join(candidateRoot, relative), candidateRoot, `Trusted test ${relative}`, null);
        if (baselineBytes && !baselineBytes.equals(candidateBytes)) throw new Error(`Trusted test bytes differ between baseline and candidate: ${relative}.`);
        const bytes = sourceRoot === candidateRoot ? candidateBytes : baselineBytes;
        const target = assertInside(bundleRoot, path.join(bundleRoot, relative), 'Test bundle path');
        ensureDirectory(path.dirname(target), 0o700, 'Test bundle directory');
        atomicWrite(target, bytes);
        manifest.push({ path: relative, sha256: hashBytes(bytes), bytes: bytes.length });
    }
    const expectedCandidateTests = [...handoff.draft.test_files].sort();
    if (JSON.stringify(expectedCandidateTests) !== JSON.stringify(candidateTests.slice().sort())) throw new Error('Candidate test inventory differs from the validated C2b handoff.');
    const manifestBody = { schema_version: 1, files: manifest.sort((a, b) => a.path.localeCompare(b.path)), candidate_test_files: expectedCandidateTests };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifestBody, null, 2)}\n`);
    const manifestPath = path.join(bundleRoot, 'manifest.json');
    atomicWrite(manifestPath, manifestBytes);
    const content = Buffer.concat([manifestBytes, ...manifestBody.files.map((entry) => fs.readFileSync(path.join(bundleRoot, entry.path)))]);
    return { root: bundleRoot, manifestPath, manifestBody, sha256: hashBytes(manifestBytes), contentSha256: hashBytes(content) };
}

function assertOwnerClaim(proposal, metadata) {
    const claim = proposal?.eval_summary?.code_candidate;
    if (!claim || claim.status !== 'running' || claim.attempt_id !== metadata.attempt_id) throw new Error('C2c1 requires the still-running owner claim for this attempt.');
    for (const field of ['authorization_hash', 'scope_hash', 'c2b_handoff_sha256', 'candidate_source_sha256', 'draft_patch_sha256', 'draft_content_sha256', 'draft_response_sha256']) {
        if (!isDigest(metadata[field]) || claim[field] !== metadata[field]) throw new Error(`C2c1 requires the owner-bound progressive ${field} identity.`);
    }
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

function validateReplayResult(value, label, row = null, options = {}) {
    if (options.strict === true) {
        if (!row || typeof row.raw_input !== 'string' || typeof row.ground_truth !== 'string' || typeof value?.response !== 'string' || typeof value.output !== 'string') throw new Error(`${label} replay result is missing raw response evidence.`);
        const repoRoot = path.resolve(__dirname, '../..');
        const pipeline = loadTrustedTsModule(repoRoot, 'services/dashboard/lib/review-pipeline');
        const scoring = loadTrustedTsModule(repoRoot, 'services/differ/lib/eval-scoring');
        const similarity = loadTrustedTsModule(repoRoot, 'services/dashboard/lib/text-similarity');
        const parsed = pipeline.parseAIResponse(value.response, row.raw_input);
        if (parsed.fenceMissing === true || typeof parsed.correctedMenu !== 'string' || !Array.isArray(parsed.suggestions)) throw new Error(`${label} replay response contract is incomplete or missing required fences.`);
        if (parsed.correctedMenu !== value.output) throw new Error(`${label} replay output does not match the trusted parsed response.`);
        const truthStyle = similarity.normalizeComparable(row.ground_truth, { normalizeRawAsteriskStyle: true });
        const outputStyle = similarity.normalizeComparable(parsed.correctedMenu, { normalizeRawAsteriskStyle: true });
        const corrections = scoring.scoreCorrections(row.raw_input, parsed.correctedMenu, row.ground_truth);
        const composite = parsed.fenceMissing ? 0 : scoring.compositeCaseScore(similarity.boundedLevenshteinSimilarity(outputStyle, truthStyle), corrections);
        const identity = options.identity;
        if (!identity || typeof identity.run_id !== 'string' || !Number.isInteger(identity.seed) || typeof identity.arm !== 'string' || typeof identity.case_id !== 'string') throw new Error(`${label} replay identity is missing.`);
        const reportId = hashBytes(Buffer.from(JSON.stringify({ arm: identity.arm, seed: identity.seed, run_id: identity.run_id, case_id: identity.case_id, input_hash: hashJson(row.raw_input), output_hash: hashJson(parsed.correctedMenu), response_hash: hashJson(value.response) })));
        if (value.report_id !== reportId && value.reportId !== reportId) throw new Error(`${label} replay report identity does not match the frozen run.`);
        return { output: parsed.correctedMenu, report_id: reportId, contractComplete: !parsed.fenceMissing, fenceMissing: parsed.fenceMissing, composite, extraEdits: corrections.extra.length, rule_activations: [] };
    }
    if (!value || typeof value.output !== 'string' || value.contractComplete !== true || value.fenceMissing !== false
        || !Number.isFinite(value.composite) || value.composite < 0 || value.composite > 1
        || !Number.isInteger(value.extraEdits) || value.extraEdits < 0 || typeof (value.report_id || value.reportId) !== 'string' || !(value.report_id || value.reportId).trim()) throw new Error(`${label} replay result is incomplete or has an invalid response contract.`);
    const rule_activations = Array.isArray(value.rule_activations || value.ruleActivations) ? [...(value.rule_activations || value.ruleActivations)].map((row) => ({ ...row })) : [];
    return { output: value.output, report_id: value.report_id || value.reportId, contractComplete: true, fenceMissing: false, composite: value.composite, extraEdits: value.extraEdits, rule_activations };
}

function deliveryRequired(proposal, corrections) {
    return corrections.filter((correction) => {
        const route = (proposal.correction_routing || []).find((row) => row.correction_id === correction.correction_id);
        const evidence = (proposal.replay_evidence || []).find((row) => row.correction_id === correction.correction_id);
        return route?.replay_status === 'delivery_mismatch' || evidence?.status === 'delivery_mismatch';
    }).map((correction) => correction.correction_id);
}

function validateDelivery(value, correction, driverHash, deliveryIdentity, expectedImage, expectedRuntime, expectedFixtureHash) {
    if (!value || value.driver !== 'form-submit-v1' || !isDigest(driverHash)
        || value.chromium_sandbox_enabled !== false || value.isolation_boundary !== 'container'
        || value.controls?.uid !== 65532 || value.controls?.gid !== 65532 || !Array.isArray(value.controls?.raw_groups) || value.controls.raw_groups.some((group) => group !== '65532') || !Array.isArray(value.controls?.supplementary_groups) || value.controls.supplementary_groups.length
        || !value.controls?.capabilities || JSON.stringify(Object.keys(value.controls.capabilities).sort()) !== JSON.stringify(['CapAmb', 'CapEff', 'CapInh', 'CapPrm']) || Object.values(value.controls.capabilities).some((entry) => entry !== '0000000000000000')
        || value.delivery_claim !== 'serializer_request_boundary_v1' || value.reviewed_state_selection !== false || value.full_form_assembly !== false
        || value.controls.no_new_privs !== '1' || value.controls.seccomp !== '2' || value.controls.root_mount_read_only !== true
        || JSON.stringify(value.controls.network_interfaces) !== JSON.stringify(['lo'])
        || !deliveryIdentity || driverHash !== deliveryIdentity.delivery_driver_sha256
        || value.driver_sha256 !== driverHash
        || value.image_id !== expectedImage || value.runtime_id !== expectedRuntime
        || value.delivery_fixture_sha256 !== expectedFixtureHash
        || !isDigest(value.baseline_source_hashes?.driver) || !isDigest(value.candidate_source_hashes?.driver)
        || value.baseline_source_hashes.driver !== driverHash || value.candidate_source_hashes.driver !== driverHash
        || !['form', 'form_helpers', 'form_submission', 'diff_core', 'redline_preview', 'form_stage', 'showStep2', 'submitMenu', 'quill'].every((key) => isDigest(value.baseline_source_hashes?.[key]) && isDigest(value.candidate_source_hashes?.[key]))
        || !value.baseline_browser_version || !value.candidate_browser_version || value.quill_version !== '1.3.6'
        || typeof value.baseline_submitted_text !== 'string' || typeof value.candidate_submitted_text !== 'string'
        || typeof value.baseline_submitted_html !== 'string' || typeof value.candidate_submitted_html !== 'string'
        || typeof value.baseline_submitted_html_text !== 'string' || typeof value.candidate_submitted_html_text !== 'string'
        || JSON.stringify(Object.keys(value.baseline_source_hashes || {}).sort()) !== JSON.stringify([...DELIVERY_SOURCE_KEYS, 'driver'].sort())
        || JSON.stringify(Object.keys(value.candidate_source_hashes || {}).sort()) !== JSON.stringify([...DELIVERY_SOURCE_KEYS, 'driver'].sort())
        || value.source_manifest_sha256 !== deliverySourceManifestHash(value) || value.source_manifest_sha256 !== deliveryIdentity.delivery_source_sha256
        || value.baseline_browser_version !== deliveryIdentity.browser_version || value.candidate_browser_version !== deliveryIdentity.browser_version
        || value.quill_version !== deliveryIdentity.quill_version
        || (deliveryIdentity.delivery_fixture_sha256 && deliveryIdentity.delivery_fixture_sha256 !== expectedFixtureHash)) throw new Error(`Delivery evidence is incomplete for ${correction.correction_id}.`);
    if (!value.candidate_submitted_text.split('\n').map((line) => line.trim()).includes(correction.corrected_text.trim())
        || !value.candidate_submitted_html_text.split('\n').map((line) => line.trim()).includes(correction.corrected_text.trim())) throw new Error(`Delivery evidence does not contain the corrected text for ${correction.correction_id}.`);
    return { ...value };
}

async function invokeWithTimeout(fn, input, timeoutMs, label) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180000) throw new Error('C2c1 executor timeout is missing or unbounded.');
    const controller = new AbortController();
    let timer;
    try {
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(`${label} timed out.`)); }, timeoutMs); });
        return await Promise.race([Promise.resolve().then(() => fn({ ...input, signal: controller.signal })), timeout]);
    } finally { if (timer) clearTimeout(timer); }
}

function revalidatePlan(planPath, plan, metadata, attemptRoot, baselineRoot, candidateRoot, bundle, trustedSuites, historicalTests, candidateTests, runtimeVerification, liveProposal, trustedVerification) {
    const bytes = regularFile(planPath, path.dirname(planPath), 'Verifier plan');
    const stored = JSON.parse(bytes.toString('utf8'));
    const { plan_sha256: storedHash, ...body } = stored;
    if (storedHash !== hashJson(body) || storedHash !== plan.plan_sha256) throw new Error('Verifier plan changed after freezing.');
    if (plan.delivery_identity) validateDeliveryIdentity(plan.delivery_identity);
    if (hashBytes(fs.readFileSync(__filename)) !== plan.runner_sha256) throw new Error('Verifier runner identity changed after freezing.');
    if (!trustedVerification || trustedVerification.codeProposalVerificationFingerprint(liveProposal) !== plan.proposal_sha256 || plan.accepted_rules_sha256 !== metadata.accepted_rules_sha256) throw new Error('Live proposal or accepted-rule identity changed after plan creation.');
    const behavior = JSON.parse(regularFile(path.join(attemptRoot, 'behavior-tests.json'), attemptRoot, 'Behavior artifact').toString('utf8'));
    const { sha256: behaviorHash, ...behaviorBody } = behavior;
    if (hashBytes(regularFile(path.join(attemptRoot, 'dataset.jsonl'), attemptRoot, 'Frozen dataset')) !== plan.dataset_sha256
        || hashBytes(regularFile(path.join(attemptRoot, 'prompt.txt'), attemptRoot, 'Prompt artifact')) !== plan.prompt_sha256
        || hashBytes(regularFile(path.join(attemptRoot, 'rules.json'), attemptRoot, 'Accepted rules')) !== plan.rules_sha256
        || behaviorHash !== plan.behavior_sha256 || hashBytes(Buffer.from(JSON.stringify(behaviorBody))) !== behaviorHash
        || hashBytes(Buffer.from(plan.baseline_prompt || '')) !== plan.baseline_prompt_sha256
        || hashBytes(Buffer.from(plan.candidate_prompt || '')) !== plan.candidate_prompt_sha256
        || hashBytes(Buffer.from(JSON.stringify(plan.baseline_rules || []))) !== plan.baseline_rules_sha256
        || hashBytes(Buffer.from(JSON.stringify(plan.candidate_rules || []))) !== plan.candidate_rules_sha256) throw new Error('Frozen C1 input identity changed after plan creation.');
    const handoffBytes = regularFile(plan.handoff_path, attemptRoot, 'C2b handoff');
    if (hashBytes(handoffBytes) !== plan.c2b_handoff_sha256) throw new Error('C2b handoff changed after plan creation.');
    const handoffInfo = readC2bHandoff(plan.handoff_path, attemptRoot, { ...metadata, authorization_hash: plan.authorization_hash, scope_hash: plan.scope_hash, c2b_handoff_sha256: plan.c2b_handoff_sha256, candidate_source_sha256: plan.candidate_source_sha256, draft_patch_sha256: plan.draft_patch_sha256, draft_content_sha256: plan.draft_content_sha256, draft_response_sha256: plan.draft_response_sha256 });
    if (handoffInfo.handoff.baseline_source_sha256 !== plan.baseline_source_sha256 || handoffInfo.handoff.candidate_source_sha256 !== plan.candidate_source_sha256) throw new Error('C2b handoff source identity changed after plan creation.');
    if (runtimeVerification.hashCodeImplementation(baselineRoot) !== plan.baseline_source_sha256 || runtimeVerification.hashCodeImplementation(candidateRoot) !== plan.candidate_source_sha256) throw new Error('Baseline or candidate source changed after plan creation.');
    const currentBaselineTests = walkCandidateTests(baselineRoot);
    const currentCandidateInventory = walkCandidateTests(candidateRoot);
    const missingHistoricalTests = currentBaselineTests.filter((relative) => !currentCandidateInventory.includes(relative));
    if (missingHistoricalTests.length) throw new Error(`Historical candidate tests are missing from candidate: ${missingHistoricalTests.join(', ')}`);
    const currentHistoricalTests = currentBaselineTests.filter((relative) => currentCandidateInventory.includes(relative));
    const currentCandidateTests = currentCandidateInventory.filter((relative) => !currentHistoricalTests.includes(relative));
    if (JSON.stringify(currentHistoricalTests) !== JSON.stringify(historicalTests) || JSON.stringify(currentCandidateTests) !== JSON.stringify(candidateTests)) throw new Error('Candidate test inventory changed after plan creation.');
    for (const relative of [...trustedSuites, ...historicalTests, ...candidateTests]) {
        const candidate = regularFile(path.join(candidateRoot, relative), candidateRoot, `Trusted test ${relative}`, null);
        if (!candidateTests.includes(relative)) {
            const base = regularFile(path.join(baselineRoot, relative), baselineRoot, `Trusted test ${relative}`, null);
            if (!base.equals(candidate)) throw new Error(`Test bytes changed after plan creation: ${relative}.`);
        }
    }
    const manifestBytes = regularFile(bundle.manifestPath, bundle.root, 'Test bundle manifest');
    if (hashBytes(manifestBytes) !== plan.test_bundle_sha256) throw new Error('Test bundle changed after plan creation.');
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    for (const entry of manifest.files || []) if (hashBytes(regularFile(path.join(bundle.root, entry.path), bundle.root, `Test bundle ${entry.path}`)) !== entry.sha256) throw new Error(`Test bundle bytes changed after plan creation: ${entry.path}.`);
}

function makePlan({ attemptRoot, metadata, proposal, baselineHash, candidateHash, parentCampaignSha256, imageId, runtimeId, replayPolicyVersion, caseIds, seeds, inventory, corrections, paths, handoffPath, handoffHash, authorizationHash, scopeHash, draftPatchHash, draftContentHash, draftResponseHash, datasetHash, promptHash, rulesHash, behaviorHash, testBundleHash, runnerHash, testContentHash, model, vocabularyHash, expectationsHash, settings, baselineRules, candidateRules, baselinePrompt, candidatePrompt, deliveryDriverHash, deliveryIdentity, deliveryFixture }) {
    const planBody = {
        schema_version: 1, test_only: true, attempt_id: metadata.attempt_id,
        proposal_sha256: metadata.proposal_sha256, accepted_rules_sha256: metadata.accepted_rules_sha256, parent_campaign_sha256: parentCampaignSha256,
        baseline_source_sha256: baselineHash, candidate_source_sha256: candidateHash,
        image_id: imageId, runtime_id: runtimeId, replay_policy_version: replayPolicyVersion,
        dataset_sha256: datasetHash, prompt_sha256: promptHash, rules_sha256: rulesHash,
        behavior_sha256: behaviorHash, c2b_handoff_sha256: handoffHash, test_bundle_sha256: testBundleHash,
        runner_sha256: runnerHash, handoff_path: handoffPath, authorization_hash: authorizationHash,
        scope_hash: scopeHash, draft_patch_sha256: draftPatchHash, draft_content_sha256: draftContentHash, draft_response_sha256: draftResponseHash,
        tests_content_sha256: testContentHash, model, vocabulary_sha256: vocabularyHash, expectations_sha256: expectationsHash,
        settings: canonical(settings || {}), baseline_rules: baselineRules, candidate_rules: candidateRules,
        baseline_prompt: baselinePrompt, candidate_prompt: candidatePrompt,
        baseline_prompt_sha256: hashBytes(Buffer.from(baselinePrompt || '')), candidate_prompt_sha256: hashBytes(Buffer.from(candidatePrompt || '')),
        baseline_rules_sha256: hashBytes(Buffer.from(JSON.stringify(baselineRules || []))), candidate_rules_sha256: hashBytes(Buffer.from(JSON.stringify(candidateRules || []))),
        delivery_driver_sha256: deliveryDriverHash || null,
        delivery_identity: deliveryIdentity ? validateDeliveryIdentity(deliveryIdentity) : null,
        delivery_fixture_sha256: deliveryFixture ? hashJson(deliveryFixture) : null,
        delivery_claim: deliveryIdentity ? 'serializer_request_boundary_v1' : null,
        delivery_fixture: deliveryFixture ? canonical(deliveryFixture) : null,
        case_ids: [...caseIds], seeds: [...seeds], test_inventory: [...inventory], corrections,
        paths,
    };
    return { ...planBody, plan_sha256: hashJson(planBody) };
}

function buildCombinedVerification({ proposal, baselineHash, candidateHash, cases, seeds, runs, corrections, trustedVerification, imageId, runtimeId, datasetHash, acceptedRulesHash, model, baselineRules = [], candidateRules = baselineRules, vocabularyHash, expectationsHash, settings = {} }) {
    if (!isDigest(vocabularyHash) || !isDigest(expectationsHash)) throw new Error('Combined verification requires frozen vocabulary and expectation identities.');
    const hashPrompt = (value) => hashBytes(Buffer.from(value || ''));
    const configurations = {
        baseline: { source_sha256: baselineHash, dataset_sha256: datasetHash, prompt_sha256: hashPrompt(proposal.current_prompt || ''), accepted_rules_sha256: trustedVerification.hashAcceptedRules(baselineRules), vocabulary_sha256: vocabularyHash, expectations_sha256: expectationsHash, case_ids: [...cases], model, settings, evaluatedRuntime: { image_id: imageId, runtime_id: runtimeId } },
        candidate: { source_sha256: candidateHash, dataset_sha256: datasetHash, prompt_sha256: hashPrompt(proposal.proposed_prompt || proposal.current_prompt || ''), accepted_rules_sha256: trustedVerification.hashAcceptedRules(candidateRules), vocabulary_sha256: vocabularyHash, expectations_sha256: expectationsHash, case_ids: [...cases], model, settings, evaluatedRuntime: { image_id: imageId, runtime_id: runtimeId } },
    };
    const configurationHashes = Object.fromEntries(Object.entries(configurations).map(([arm, config]) => [arm, trustedVerification.verificationConfigurationHash(config)]));
    return { baseline_rules: baselineRules, candidate_rules: candidateRules, configurations, configuration_hashes: configurationHashes, corrections: corrections.map((correction) => ({ ...correction })), runs: runs.map((run) => ({ run_id: run.run_id, seed: run.seed, freshness: 'fresh', corrections: (run.combined_corrections || run.corrections).map((row) => ({ ...row })), rule_activations: (run.rule_activations || []).map((row) => ({ ...row })), cases: run.cases.map((row) => ({ case_id: row.case_id, baseline_extra_edits: row.baseline_extra_edits, candidate_extra_edits: row.candidate_extra_edits })) })) };
}

async function runCodeProposalProof(options = {}) {
    const required = ['attemptRoot', 'trustedRoot', 'metadata', 'proposal', 'baselineRoot', 'candidateRoot', 'executor', 'replayExecutor', 'c2bHandoffFile', 'imageId', 'runtimeId', 'replayPolicyVersion'];
    for (const key of required) if (options[key] === undefined || options[key] === null) throw new Error(`C2c1 requires ${key}.`);
    const trustedRepoRoot = path.resolve(__dirname, '../..');
    if (options.repoRoot && path.resolve(options.repoRoot) !== trustedRepoRoot) throw new Error('C2c1 repoRoot must be the current trusted repository root.');
    const repoRoot = trustedRepoRoot;
    const trustedVerification = loadVerificationModule(repoRoot);
    const overrides = options.verificationOverrides || {};
    if (Object.keys(overrides).length && !(process.env.NODE_ENV === 'test' && options.allowTestDouble === true)) throw new Error('C2c1 permits the implementationHasher seam only in an explicit test-only invocation.');
    if (Object.keys(overrides).some((key) => key !== 'hashCodeImplementation' || typeof overrides[key] !== 'function')) throw new Error('C2c1 permits only the test-only implementationHasher seam.');
    const runtimeVerification = { ...trustedVerification, ...(Object.keys(overrides).length ? { hashCodeImplementation: overrides.hashCodeImplementation } : {}) };
    const behaviorModule = loadBehaviorModule(repoRoot);
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
    const handoffInfo = readC2bHandoff(options.c2bHandoffFile, attemptRoot, metadata);
    const checked = revalidateAttemptArtifacts({ attemptRoot, trustedRoot, metadata, proposal: options.proposal, verification: runtimeVerification, behaviorModule, baselineRoot });
    const frozenProposal = JSON.parse(JSON.stringify(checked.proposal));
    const baselineHash = runtimeVerification.hashCodeImplementation(baselineRoot);
    const candidateHash = runtimeVerification.hashCodeImplementation(candidateRoot);
    if (!isDigest(baselineHash) || baselineHash !== metadata.baseline_source_sha256 || baselineHash !== handoffInfo.handoff.baseline_source_sha256) throw new Error('Baseline implementation hash is stale or differs from the frozen attempt.');
    if (!isDigest(candidateHash) || candidateHash === baselineHash || candidateHash !== metadata.candidate_source_sha256 || candidateHash !== handoffInfo.handoff.candidate_source_sha256) throw new Error('Candidate implementation hash is missing, unchanged, or differs from the frozen handoff.');
    const parentCampaignSha256 = frozenProposal.parent_campaign_sha256 || frozenProposal.eval_summary?.parent_campaign_sha256;
    if (!isDigest(parentCampaignSha256) || (metadata.parent_campaign_sha256 && parentCampaignSha256 !== metadata.parent_campaign_sha256) || parentCampaignSha256 !== (options.frozenPlan?.parent_campaign_sha256 || metadata.parent_campaign_sha256 || parentCampaignSha256)) throw new Error('Parent campaign lineage is missing or differs from the frozen plan.');
    if (!isImmutableIdentity(options.imageId) || !isImmutableIdentity(options.runtimeId) || !Number.isInteger(options.replayPolicyVersion)) throw new Error('C2c1 requires a frozen image, runtime, and replay policy identity.');
    if (Number.isInteger(trustedVerification.REPLAY_RETIREMENT_POLICY_VERSION) && trustedVerification.REPLAY_RETIREMENT_POLICY_VERSION !== options.replayPolicyVersion) throw new Error('Replay policy identity is stale.');
    const datasetBytes = regularFile(path.join(attemptRoot, 'dataset.jsonl'), attemptRoot, 'Frozen dataset');
    const cases = readDataset(datasetBytes);
    const caseIds = cases.map((row) => row.case_id);
    if (hashBytes(datasetBytes) !== metadata.expected_dataset_sha256 || JSON.stringify(caseIds) !== JSON.stringify(metadata.expected_case_ids)) throw new Error('Frozen dataset identity is stale.');
    const rulesBytes = regularFile(path.join(attemptRoot, 'rules.json'), attemptRoot, 'Accepted rules');
    if (metadata.rules_file_sha256 && hashBytes(rulesBytes) !== metadata.rules_file_sha256) throw new Error('Accepted-rule file identity is stale.');
    const codeCorrections = trustedCorrections(frozenProposal, handoffInfo.handoff.draft.corrections, new Set(['code_recommendation']));
    const nonCodeRoutes = (frozenProposal.correction_routing || []).filter((route) => ['replacement_rule', 'prompt'].includes(route?.lane));
    const nonCodeCorrections = nonCodeRoutes.map((route) => {
        const replay = (frozenProposal.replay_evidence || []).find((entry) => entry?.correction_id === route.correction_id);
        const caseId = route.case_id || replay?.case_id;
        if (!caseId || !caseIds.includes(caseId)) throw new Error(`Frozen ${route.lane} correction ${route.correction_id} lacks an exact dataset case.`);
        const originalText = route.original_text || replay?.original_text, correctedText = route.corrected_text || replay?.corrected_text;
        if (typeof originalText !== 'string' || typeof correctedText !== 'string' || !originalText.trim() || !correctedText.trim() || originalText === correctedText) throw new Error(`Frozen ${route.lane} correction ${route.correction_id} lacks exact source text.`);
        return { correction_id: route.correction_id, case_id: caseId, test_name: '', original_text: originalText, corrected_text: correctedText, recommendation_indexes: [], delivery_assertion: false };
    });
    const allCorrections = [...codeCorrections, ...nonCodeCorrections];
    const corrections = codeCorrections;
    if (allCorrections.some((row) => !caseIds.includes(row.case_id))) throw new Error('Correction mapping references a case outside the frozen dataset.');
    const trustedSuites = trustedVerification.CODE_PROPOSAL_REGRESSION_TESTS || [];
    const baselineCandidateTests = walkCandidateTests(baselineRoot);
    const actualCandidateInventory = walkCandidateTests(candidateRoot);
    const missingHistoricalTests = baselineCandidateTests.filter((file) => !actualCandidateInventory.includes(file));
    if (missingHistoricalTests.length) throw new Error(`Historical candidate tests are missing from candidate: ${missingHistoricalTests.join(', ')}`);
    const historicalTests = baselineCandidateTests.filter((file) => actualCandidateInventory.includes(file));
    const candidateTests = actualCandidateInventory.filter((file) => !historicalTests.includes(file));
    const expectedCandidateTests = [...new Set(handoffInfo.handoff.draft.test_files)].sort();
    if (!candidateTests.length || candidateTests.some((file) => !TEST_PATH.test(file))) throw new Error('Candidate must contain an explicit supplemental regression test.');
    if (JSON.stringify(expectedCandidateTests) !== JSON.stringify(candidateTests)) throw new Error('Candidate test inventory differs from the owner-bound C2b handoff.');
    for (const file of historicalTests) {
        const baselineBytes = regularFile(path.join(baselineRoot, file), baselineRoot, `Historical test ${file}`, null);
        const candidateBytes = regularFile(path.join(candidateRoot, file), candidateRoot, `Historical test ${file}`, null);
        if (!baselineBytes.equals(candidateBytes)) throw new Error(`Historical candidate test changed between baseline and candidate: ${file}`);
    }
    const inventory = [...new Set([...trustedSuites, ...historicalTests, ...candidateTests])].sort();
    const seeds = options.seeds || [17, 7919];
    if (!Array.isArray(seeds) || seeds.length !== 2 || !seeds.every((seed) => Number.isInteger(seed)) || new Set(seeds).size !== 2) throw new Error('C2c1 requires two distinct replay seeds.');
    const verifierRoot = path.join(attemptRoot, 'verifier');
    if (fs.existsSync(verifierRoot)) throw new Error('Verifier output root already exists; proof runs cannot reuse prior artifacts.');
    ensureDirectory(verifierRoot, 0o700, 'Verifier output root');
    const paths = { plan: path.join(verifierRoot, 'plan.json'), baselineReport: path.join(verifierRoot, 'baseline-report.json'), candidateReport: path.join(verifierRoot, 'candidate-report.json'), proof: path.join(verifierRoot, 'proof.json'), stagedProof: path.join(verifierRoot, 'staged-proof.json') };
    const bundle = freezeTestBundle({ verifierRoot, baselineRoot, candidateRoot, inventory, candidateTests, handoff: handoffInfo.handoff });
    const runnerHash = hashBytes(fs.readFileSync(__filename));
    const rulesPayload = JSON.parse(rulesBytes.toString('utf8'));
    const baselineRules = Array.isArray(rulesPayload) ? rulesPayload : rulesPayload.rules;
    if (!Array.isArray(baselineRules) || typeof trustedVerification.mergedVerificationRules !== 'function') throw new Error('Frozen accepted-rule artifact is incomplete.');
    const candidateRules = trustedVerification.mergedVerificationRules(baselineRules, frozenProposal.proposed_rules || []);
    const baselinePrompt = regularFile(path.join(attemptRoot, 'prompt.txt'), attemptRoot, 'Prompt artifact').toString('utf8');
    const candidatePrompt = typeof frozenProposal.proposed_prompt === 'string' && frozenProposal.proposed_prompt.trim() ? frozenProposal.proposed_prompt : baselinePrompt;
    const model = `${options.model || 'test-only'}`;
    const vocabularyHash = options.vocabularySha256 || metadata.vocabulary_sha256;
    const expectationsHash = options.expectationsSha256 || metadata.expectations_sha256;
    const settings = JSON.parse(JSON.stringify(options.settings || {}));
    if (!isDigest(vocabularyHash) || !isDigest(expectationsHash)) throw new Error('C2c1 requires frozen vocabulary and expectation identities.');
    const deliveryDriverHash = options.deliveryDriverSha256 || null;
    const deliveryIdentity = options.deliveryIdentity ? validateDeliveryIdentity(options.deliveryIdentity) : null;
    if (deliveryIdentity && deliveryDriverHash !== deliveryIdentity.delivery_driver_sha256) throw new Error('Delivery driver identity is stale or mismatched.');
    if (deliveryIdentity && deliveryIdentity.delivery_fixture_sha256 && (!options.deliveryFixture || deliveryIdentity.delivery_fixture_sha256 !== hashJson(options.deliveryFixture))) throw new Error('Delivery fixture identity is stale or mismatched.');
    const plan = makePlan({ attemptRoot, metadata, proposal: frozenProposal, baselineHash, candidateHash, parentCampaignSha256, imageId: options.imageId, runtimeId: options.runtimeId, replayPolicyVersion: options.replayPolicyVersion, caseIds, seeds, inventory, corrections: allCorrections, paths: { ...paths, testBundle: bundle.root, testBundleManifest: bundle.manifestPath }, handoffPath: path.resolve(options.c2bHandoffFile), handoffHash: handoffInfo.handoffHash, authorizationHash: handoffInfo.handoff.authorization_hash, scopeHash: handoffInfo.handoff.scope_hash, draftPatchHash: handoffInfo.handoff.draft.patch_sha256, draftContentHash: handoffInfo.handoff.draft.content_sha256, draftResponseHash: handoffInfo.handoff.draft.response_sha256 || handoffInfo.handoff.response_sha256 || handoffInfo.handoff.response.body_sha256, datasetHash: metadata.expected_dataset_sha256, promptHash: metadata.prompt_sha256, rulesHash: metadata.rules_file_sha256 || hashBytes(rulesBytes), behaviorHash: metadata.behavior_tests_sha256, testBundleHash: bundle.sha256, runnerHash, testContentHash: bundle.contentSha256, model, vocabularyHash, expectationsHash, settings, baselineRules, candidateRules, baselinePrompt, candidatePrompt, deliveryDriverHash, deliveryIdentity, deliveryFixture: options.deliveryFixture });
    atomicWrite(paths.plan, `${JSON.stringify(plan, null, 2)}\n`);
    const progress = (phase, state, extra = {}) => writeProgress(attemptRoot, metadata, phase, state, { total: caseIds.length, ...extra }, options.progressWriter);
    let attached = false;
    try {
        revalidatePlan(paths.plan, plan, metadata, attemptRoot, baselineRoot, candidateRoot, bundle, trustedSuites, historicalTests, candidateTests, runtimeVerification, options.proposal, trustedVerification);
        progress('unit_tests', 'active', { completed: 0 });
        const timeoutMs = options.executorTimeoutMs || 30000;
        const baselineRaw = await invokeWithTimeout(options.executor, { arm: 'baseline', root: baselineRoot, inventory: [...inventory], testBundleRoot: bundle.root, testBundleSha256: bundle.sha256, plan: { ...plan }, attemptId: metadata.attempt_id }, timeoutMs, 'Baseline executor');
        revalidatePlan(paths.plan, plan, metadata, attemptRoot, baselineRoot, candidateRoot, bundle, trustedSuites, historicalTests, candidateTests, runtimeVerification, options.proposal, trustedVerification);
        const candidateRaw = await invokeWithTimeout(options.executor, { arm: 'candidate', root: candidateRoot, inventory: [...inventory], testBundleRoot: bundle.root, testBundleSha256: bundle.sha256, plan: { ...plan }, attemptId: metadata.attempt_id }, timeoutMs, 'Candidate executor');
        const tests = { baseline: reportsFromExecutor(baselineRaw, 'Baseline', inventory), candidate: reportsFromExecutor(candidateRaw, 'Candidate', inventory) };
        atomicWrite(paths.baselineReport, `${JSON.stringify(tests.baseline.report, null, 2)}\n`); atomicWrite(paths.candidateReport, `${JSON.stringify(tests.candidate.report, null, 2)}\n`);
        assertPairedTestReports(tests, corrections, trustedVerification);
        revalidatePlan(paths.plan, plan, metadata, attemptRoot, baselineRoot, candidateRoot, bundle, trustedSuites, historicalTests, candidateTests, runtimeVerification, options.proposal, trustedVerification);
        progress('retrospective_replay', 'active', { completed: 0, total: caseIds.length * seeds.length });
        const runs = [];
        const replayIdentities = new Set();
        const deliveryIds = deliveryRequired(frozenProposal, allCorrections);
        if (deliveryIds.length && !plan.delivery_identity) throw new Error('Delivery evidence requires a separate frozen delivery identity.');
        for (const seed of seeds) {
            const run = { run_id: `${metadata.attempt_id}:replay:${seed}`, seed, baseline_errors: 0, candidate_errors: 0, cases: [], corrections: [] };
            const results = { baseline: new Map(), candidate: new Map() };
            for (const arm of ['baseline', 'candidate']) {
                for (const row of cases) {
                    const raw = await invokeWithTimeout(options.replayExecutor, { arm, root: arm === 'baseline' ? baselineRoot : candidateRoot, seed, runId: run.run_id, case: { ...row }, testBundleRoot: bundle.root, testBundleSha256: bundle.sha256, plan: { ...plan } }, timeoutMs, `${arm} replay executor`);
                    const validated = validateReplayResult(raw, `${arm} ${row.case_id}`, row, { strict: options.strictReplay === true, identity: { arm, seed, run_id: run.run_id, case_id: row.case_id } });
                    if (replayIdentities.has(validated.report_id)) throw new Error(`Replay report identity was reused: ${validated.report_id}.`);
                    replayIdentities.add(validated.report_id);
                    results[arm].set(row.case_id, validated);
                }
            }
            for (const row of cases) {
                const baseline = results.baseline.get(row.case_id), candidate = results.candidate.get(row.case_id);
                if (candidate.composite - baseline.composite < -0.02 || candidate.extraEdits > baseline.extraEdits) throw new Error(`Candidate replay regresses or widens edits for ${row.case_id}.`);
                run.cases.push({ case_id: row.case_id, baseline_composite: baseline.composite, candidate_composite: candidate.composite, baseline_fence_missing: baseline.fenceMissing, candidate_fence_missing: candidate.fenceMissing, baseline_contract_complete: baseline.contractComplete, candidate_contract_complete: candidate.contractComplete, baseline_extra_edits: baseline.extraEdits, candidate_extra_edits: candidate.extraEdits });
            }
            run.rule_activations = [...results.candidate.values()].flatMap((result) => result.rule_activations || []);
            if (options.strictReplay === true && nonCodeRoutes.length && run.rule_activations.length === 0) throw new Error('Mixed-rule replay lacks trustworthy rule activation evidence.');
            run.combined_corrections = [];
            for (const correction of allCorrections) {
                const baseline = results.baseline.get(correction.case_id), candidate = results.candidate.get(correction.case_id);
                if (!baseline || !candidate || !trustedVerification.codeVerificationCorrectionPresent(candidate.output, correction)) throw new Error(`Candidate replay misses correction ${correction.correction_id}.`);
                const evidence = { correction_id: correction.correction_id, baseline_output: baseline.output, candidate_output: candidate.output };
                run.combined_corrections.push(evidence);
                if (corrections.some((entry) => entry.correction_id === correction.correction_id)) run.corrections.push(evidence);
            }
            if (deliveryIds.length) {
                if (typeof options.deliveryExecutor !== 'function') throw new Error('Delivery evidence is required but no injected delivery executor was provided.');
                run.delivery = [];
                for (const correction of allCorrections.filter((entry) => deliveryIds.includes(entry.correction_id))) run.delivery.push(validateDelivery(await invokeWithTimeout(options.deliveryExecutor, { arm: 'paired', seed, runId: run.run_id, correction, delivery_fixture: plan.delivery_fixture, plan: { ...plan } }, timeoutMs, 'Delivery executor'), correction, plan.delivery_driver_sha256, plan.delivery_identity, plan.delivery_identity.delivery_image_id, plan.delivery_identity.delivery_runtime_id, plan.delivery_fixture_sha256));
            }
            run.baseline_report_sha256 = hashJson({ seed, arm: 'baseline', results: [...results.baseline.entries()] });
            run.candidate_report_sha256 = hashJson({ seed, arm: 'candidate', results: [...results.candidate.entries()] });
            runs.push(run);
        }
        revalidatePlan(paths.plan, plan, metadata, attemptRoot, baselineRoot, candidateRoot, bundle, trustedSuites, historicalTests, candidateTests, runtimeVerification, options.proposal, trustedVerification);
        progress('holdout', 'active', { completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length });
        const behaviorArtifact = checked.behavior;
        if (!behaviorArtifact || !behaviorModule) throw new Error('Independent B6-D1 behavior evaluation requires the frozen artifact.');
        let behaviorCandidate;
        if (typeof options.behaviorExecutor === 'function') {
            const rawBehavior = await invokeWithTimeout(options.behaviorExecutor, { arm: 'candidate', seed: 0, runId: `${metadata.attempt_id}:behavior`, behavior: behaviorArtifact, plan: { ...plan } }, timeoutMs, 'Behavior executor');
            behaviorModule.validateBehaviorArtifact(behaviorArtifact);
            if (!rawBehavior || !Array.isArray(rawBehavior.outcomes) || rawBehavior.outcomes.length !== behaviorArtifact.tests.length) throw new Error('Behavior executor returned an incomplete output set.');
            const byId = new Map(rawBehavior.outcomes.map((outcome) => [outcome.id, outcome]));
            const outcomes = behaviorArtifact.tests.map((test) => {
                const outcome = byId.get(test.id);
                if (!outcome || typeof outcome.output !== 'string') throw new Error(`Behavior output is missing for ${test.id}.`);
                return { id: test.id, correctionId: test.correctionId, kind: test.kind, passed: outcome.output === test.expected, inputHash: hashJson(test.input), expectedHash: hashJson(test.expected), outputHash: hashJson(outcome.output) };
            });
            behaviorCandidate = { artifactHash: behaviorArtifact.sha256, passed: outcomes.every((outcome) => outcome.passed), outcomes, explanations: [] };
        } else {
            if (typeof options.behaviorEvaluator !== 'function' || !behaviorModule.executeBehaviorTests) throw new Error('Independent B6-D1 behavior evaluation requires an injected evaluator.');
            behaviorCandidate = await invokeWithTimeout(() => behaviorModule.executeBehaviorTests(behaviorArtifact, options.behaviorEvaluator), {}, timeoutMs, 'Behavior executor');
        }
        if (behaviorCandidate.artifactHash !== behaviorArtifact.sha256 || behaviorCandidate.passed !== true || behaviorCandidate.outcomes.some((outcome) => outcome.passed !== true || outcome.outputHash !== outcome.expectedHash)) throw new Error('Candidate behavior outcomes do not match frozen B6-D1 expectations.');
        const proof = { schema_version: 2, test_only: true, runner: 'verify-code-proposal', status: 'passed', generated_at: new Date().toISOString(), proposal_sha256: plan.proposal_sha256, baseline: { source_sha256: plan.baseline_source_sha256, root: baselineRoot }, candidate: { source_sha256: plan.candidate_source_sha256, root: candidateRoot }, inputs: { dataset_sha256: plan.dataset_sha256, prompt_sha256: plan.prompt_sha256, rules_sha256: plan.rules_sha256, accepted_rules_sha256: plan.accepted_rules_sha256, tests_sha256: plan.tests_content_sha256, image_id: plan.image_id, model: plan.model, raw_ground_truth: true, case_ids: [...plan.case_ids], ...(deliveryIds.length ? { delivery_driver_sha256: plan.delivery_driver_sha256, delivery_identity_sha256: plan.delivery_identity?.identity_sha256, delivery_identity: plan.delivery_identity, delivery_fixture_sha256: plan.delivery_fixture_sha256, delivery_claim: plan.delivery_claim } : {}) }, corrections, tests, runs, behavior: { artifact: behaviorArtifact, candidate: behaviorCandidate }, combined: buildCombinedVerification({ proposal: frozenProposal, baselineHash: plan.baseline_source_sha256, candidateHash: plan.candidate_source_sha256, cases: plan.case_ids, seeds: plan.seeds, runs, corrections: plan.corrections, trustedVerification, imageId: plan.image_id, runtimeId: plan.runtime_id, datasetHash: plan.dataset_sha256, acceptedRulesHash: plan.accepted_rules_sha256, model: plan.model, baselineRules: plan.baseline_rules, candidateRules: plan.candidate_rules, vocabularyHash: plan.vocabulary_sha256, expectationsHash: plan.expectations_sha256, settings: plan.settings }) };
        revalidatePlan(paths.plan, plan, metadata, attemptRoot, baselineRoot, candidateRoot, bundle, trustedSuites, historicalTests, candidateTests, runtimeVerification, options.proposal, trustedVerification);
        progress('verification', 'active', { completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length });
        const candidateProposal = { ...frozenProposal, eval_summary: { ...(frozenProposal.eval_summary || {}), replay_retirement_policy_version: plan.replay_policy_version, code_candidate: { ...(frozenProposal.eval_summary?.code_candidate || {}), expected_dataset_sha256: plan.dataset_sha256, expected_case_ids: [...plan.case_ids], behavior_tests_sha256: plan.behavior_sha256 }, code_verification: proof } };
        const block = trustedVerification.assessCodeProposalVerificationIntegrity(candidateProposal);
        if (block) throw new Error(`Proof integrity rejected: ${block.error}`);
        revalidatePlan(paths.plan, plan, metadata, attemptRoot, baselineRoot, candidateRoot, bundle, trustedSuites, historicalTests, candidateTests, runtimeVerification, options.proposal, trustedVerification);
        const attachable = options.client && options.originalProposal && (typeof options.store?.recordCodeVerification === 'function' || typeof recordCodeVerification === 'function');
        if (!attachable) {
            atomicWrite(paths.stagedProof, `${JSON.stringify({ staged_status: 'pending_store', proof }, null, 2)}\n`);
            progress('verification', 'blocked', { completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length, reason: 'store_attachment_required', staged_proof_path: paths.stagedProof });
            return { status: 'pending_store', proof, plan, paths, baselineHash, candidateHash };
        }
        if (attachable) {
            const store = options.store || { recordCodeVerification };
            await store.recordCodeVerification(options.client, options.originalProposal, { attempt_id: metadata.attempt_id, code_verification: proof, code_candidate: { ...metadata, status: 'verified', phase: 'verification', completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length } }, trustedVerification);
            attached = true;
        }
        revalidatePlan(paths.plan, plan, metadata, attemptRoot, baselineRoot, candidateRoot, bundle, trustedSuites, historicalTests, candidateTests, runtimeVerification, options.proposal, trustedVerification);
        atomicWrite(paths.proof, `${JSON.stringify(proof, null, 2)}\n`);
        progress('verification', 'verified', { completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length, proof_path: paths.proof });
        return { status: 'verified', proof, plan, paths, baselineHash, candidateHash };
    } catch (error) {
        const message = redact(`${error?.message || error}`, options.secrets || []).slice(0, 1000);
        try { if (fs.existsSync(paths.proof)) fs.unlinkSync(paths.proof); } catch { /* failed proof cleanup is best effort */ }
        if (attached) {
            progress('verification', 'blocked', { completed: caseIds.length * seeds.length, total: caseIds.length * seeds.length, reason: 'attached_but_local_finalization_failed' });
            throw error;
        }
        progress('verification', 'failed', { completed: 0, total: caseIds.length, reason: message });
        if (options.client && options.originalProposal && (typeof options.store?.recordCodeVerification === 'function' || typeof recordCodeVerification === 'function')) {
            const store = options.store || { recordCodeVerification };
            await store.recordCodeVerification(options.client, options.originalProposal, { attempt_id: metadata.attempt_id, code_candidate: { ...metadata, status: 'failed', phase: 'verification', reason: message } }, trustedVerification);
        }
        throw error;
    }
}

/** Run the accepted C2c1 proof with the fixed C2c2 Docker process boundary. */
async function runCodeProposalProofWithDocker(options = {}) {
    if (options.executor || options.replayExecutor || options.deliveryExecutor || options.behaviorEvaluator) throw new Error('C2c2 does not accept caller-supplied host executors or behavior evaluators.');
    const outputRoot = path.join(path.resolve(options.attemptRoot), 'docker-output');
    ensureDirectory(outputRoot, 0o700, 'Docker output root');
    const executors = createDockerC2c2Executors({ ...options, attemptId: options.attemptId || options.metadata?.attempt_id, outputRoot });
    return runCodeProposalProof({ ...options, ...executors, strictReplay: true });
}

module.exports = { runCodeProposalProof, runCodeProposalProofWithDocker, runIndependentCodeProposalProof: runCodeProposalProof, validateReplayResult, reportsFromExecutor, walkCandidateTests, makePlan, readC2bHandoff };

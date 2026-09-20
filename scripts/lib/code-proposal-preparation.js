'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadVerificationModule, recordCodeVerification, shouldDraftCodeProposal } = require('./proposal-verification-store');

const PHASES = new Set(['analysis', 'draft', 'unit_tests', 'retrospective_replay', 'holdout', 'verification', 'awaiting_approval', 'awaiting_deployment_approval']);
const STATES = new Set(['active', 'waiting_on_model', 'blocked', 'failed', 'verified']);
const ROUTED_LANES = new Set(['code_recommendation', 'replacement_rule', 'prompt']);
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const hashBytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const hashJson = (value) => hashBytes(Buffer.from(JSON.stringify(value)));
const safeId = (value, label) => {
    const id = `${value || ''}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error(`Invalid ${label}.`);
    return id;
};

function ensureDirectory(directory, mode = 0o700) {
    if (fs.existsSync(directory)) {
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe artifact directory: ${directory}`);
        fs.chmodSync(directory, mode);
        return false;
    }
    fs.mkdirSync(directory, { recursive: true, mode });
    fs.chmodSync(directory, mode);
    return true;
}

function ensureUnder(root, candidate) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(candidate);
    if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Artifact path escapes the trusted output root.');
    return resolved;
}

function atomicWrite(file, bytes) {
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`Artifact exceeds the ${MAX_FILE_BYTES}-byte limit.`);
    const directory = path.dirname(file);
    const temporary = path.join(directory, `.${path.basename(file)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
}

function readFrozenDataset(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Historical evaluation dataset is not a bounded regular file.');
    const bytes = fs.readFileSync(file);
    const rows = bytes.toString('utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => {
        try { return JSON.parse(line); } catch { throw new Error('Historical evaluation dataset contains invalid JSON.'); }
    });
    if (!rows.length || rows.some((row) => !row || typeof row.case_id !== 'string' || !row.case_id.trim()
        || typeof row.raw_input !== 'string' || !row.raw_input.trim() || typeof row.ground_truth !== 'string' || !row.ground_truth.trim()
        || !row.context || typeof row.context !== 'object') || new Set(rows.map((row) => row.case_id)).size !== rows.length) {
        throw new Error('Historical evaluation dataset needs unique case ids, raw inputs, human finals and context.');
    }
    return { bytes, rows };
}

async function queryRows(client, table, builder) {
    const result = await builder(client.from(table));
    if (result?.error) throw new Error(result.error.message || `${table} query failed.`);
    return Array.isArray(result?.data) ? result.data : [];
}

async function bindHistoricalDataset(client, proposal, sourcePath, outputPath) {
    const frozen = readFrozenDataset(sourcePath);
    const rows = frozen.rows.map((row) => ({ ...row }));
    const routes = (proposal.correction_routing || []).filter((route) => ROUTED_LANES.has(route?.lane));
    if (!routes.length || routes.some((route) => !route.correction_id)
        || new Set(routes.map((route) => route.correction_id)).size !== routes.length) {
        throw new Error('Every code recommendation needs an explicitly identified motivating correction.');
    }
    const evidenceById = new Map();
    for (const route of routes) {
        const evidence = (proposal.replay_evidence || []).filter((entry) => entry?.correction_id === route.correction_id);
        if (evidence.length !== 1 || !evidence[0].submission_id) throw new Error(`Correction ${route.correction_id} has no unique replay submission mapping.`);
        evidenceById.set(route.correction_id, evidence[0]);
    }
    for (const route of routes) {
        const evidence = evidenceById.get(route.correction_id);
        const aliases = new Set([`${evidence.submission_id}`]);
        const submissions = await queryRows(client, 'submissions', (query) => query
            .select('id,legacy_id,project_name,property,template_type,menu_type,service_period,approved_menu_content,form_attempt_id,allergens:raw_payload->>allergens')
            .or(`id.eq.${evidence.submission_id},legacy_id.eq.${evidence.submission_id}`));
        if (submissions.length !== 1) throw new Error(`Submission mapping for ${route.correction_id} is missing or ambiguous.`);
        const submission = submissions[0];
        [submission.id, submission.legacy_id].filter(Boolean).forEach((id) => aliases.add(`${id}`));
        if (!submission.form_attempt_id || typeof submission.approved_menu_content !== 'string' || !submission.approved_menu_content.trim()) {
            throw new Error(`Human-approved ground truth is unavailable for ${route.correction_id}.`);
        }
        const audits = await queryRows(client, 'basic_ai_check_audits', (query) => query
            .select('id,menu_content_raw,created_at,review_mode,event_type,attempt_id')
            .eq('attempt_id', submission.form_attempt_id).eq('event_type', 'completed').eq('review_mode', 'full'));
        if (audits.length !== 1 || !audits[0].id || audits[0].attempt_id !== submission.form_attempt_id
            || audits[0].event_type !== 'completed' || audits[0].review_mode !== 'full'
            || typeof audits[0].menu_content_raw !== 'string' || !audits[0].menu_content_raw.trim()) {
            throw new Error(`Exactly one complete completed/full raw audit is required for ${route.correction_id}.`);
        }
        const caseId = `production:${submission.legacy_id || submission.id}`;
        const replacement = {
            case_id: caseId, source: 'production', submission_id: submission.legacy_id || submission.id,
            attempt_id: submission.form_attempt_id, audit_id: audits[0].id,
            label: submission.project_name || `${evidence.submission_id}`, raw_input: audits[0].menu_content_raw,
            ground_truth: submission.approved_menu_content, degraded: null,
            context: { property: submission.property || '', templateType: submission.template_type || 'food',
                menuType: submission.menu_type || 'standard', servicePeriod: submission.service_period || '', allergens: submission.allergens || '' },
        };
        const matches = rows.map((row, index) => ({ row, index })).filter(({ row }) => aliases.has(`${row.submission_id || ''}`)
            || aliases.has(`${row.case_id || ''}`.replace(/^production:/, '')) || row.case_id === caseId);
        if (matches.length > 1) throw new Error(`Historical dataset has ambiguous duplicate cases for ${route.correction_id}.`);
        if (matches.length === 1) {
            const existing = matches[0].row;
            if (existing.raw_input !== replacement.raw_input || existing.ground_truth !== replacement.ground_truth
                || existing.audit_id !== replacement.audit_id || existing.attempt_id !== replacement.attempt_id) {
                throw new Error(`Historical dataset evidence changed for ${route.correction_id}.`);
            }
            rows[matches[0].index] = { ...existing, ...replacement };
        } else rows.push(replacement);
    }
    if (new Set(rows.map((row) => row.case_id)).size !== rows.length) throw new Error('Prepared historical dataset has duplicate case ids.');
    atomicWrite(outputPath, Buffer.from(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`));
    const prepared = readFrozenDataset(outputPath);
    return { bytes: prepared.bytes, rows: prepared.rows, sha256: hashBytes(prepared.bytes) };
}

function loadBehaviorModule(repoRoot) {
    const source = path.join(repoRoot, 'services/dashboard/lib/learning-behavior-tests.ts');
    let register;
    try { register = require.resolve('ts-node/register/transpile-only', { paths: [repoRoot] }); } catch { /* lean image */ }
    if (register && fs.existsSync(source)) { require(register); return require(source); }
    return require(path.join(repoRoot, 'services/dashboard/dist/lib/learning-behavior-tests'));
}

async function prepareCodeProposalAttempt(options = {}) {
    const { client, proposal, repoRoot, datasetPath, verification = loadVerificationModule(repoRoot), store = { recordCodeVerification }, now = Date.now() } = options;
    if (!client || !proposal || !repoRoot || !datasetPath) throw new Error('Preparation requires proposal, read-only client, repo root and frozen dataset path.');
    const sourceHash = verification.hashCodeImplementation(repoRoot);
    if (!shouldDraftCodeProposal(proposal, sourceHash, verification, false)) throw new Error('Proposal is not eligible for a new code-proposal attempt.');
    const proposalId = safeId(proposal.id, 'proposal id');
    const root = path.resolve(options.outputRoot || path.join(repoRoot, 'tmp', 'code-proposals'));
    const expectedRoot = path.resolve(repoRoot, 'tmp', 'code-proposals');
    if (root !== expectedRoot) throw new Error('Output root must be the trusted repo/tmp/code-proposals root.');
    ensureDirectory(expectedRoot);
    const attemptId = safeId(options.attemptId || crypto.randomUUID(), 'attempt id');
    const proposalRoot = ensureUnder(expectedRoot, path.join(expectedRoot, proposalId));
    ensureDirectory(proposalRoot);
    const attemptRoot = ensureUnder(proposalRoot, path.join(proposalRoot, attemptId));
    if (fs.existsSync(attemptRoot)) throw new Error('Attempt artifact directory already exists.');
    ensureDirectory(attemptRoot);
    const candidateRoot = path.join(attemptRoot, 'candidate');
    ensureDirectory(candidateRoot);
    const deadlineAt = new Date(now + Math.min(Math.max(Number(options.deadlineMs) || 4 * 60 * 60 * 1000, 60 * 1000), 24 * 60 * 60 * 1000)).toISOString();
    const promptBytes = Buffer.from(proposal.proposed_prompt || proposal.current_prompt || '');
    const metadata = { status: 'running', proof_schema_version: 2, attempt_id: attemptId,
        proposal_sha256: verification.codeProposalVerificationFingerprint(proposal), baseline_source_sha256: sourceHash,
        prompt_sha256: hashBytes(promptBytes), started_at: new Date(now).toISOString(), deadline_at: deadlineAt, artifact_directory: attemptRoot };
    let claimStarted = false;
    try {
        const rules = await queryRows(client, 'correction_rules', (query) => query.select('*').eq('status', 'accepted').order('id'));
        atomicWrite(path.join(attemptRoot, 'proposal.json'), Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`));
        atomicWrite(path.join(attemptRoot, 'prompt.txt'), promptBytes);
        const rulesBytes = Buffer.from(`${JSON.stringify({ rules }, null, 2)}\n`);
        atomicWrite(path.join(attemptRoot, 'rules.json'), rulesBytes);
        if (typeof verification.hashAcceptedRules !== 'function') throw new Error('Canonical accepted-rule hashing is unavailable.');
        metadata.accepted_rules_sha256 = verification.hashAcceptedRules(rules);
        metadata.rules_file_sha256 = hashBytes(rulesBytes);
        const behavior = proposal.eval_summary?.behavior_tests;
        const behaviorModule = options.behaviorModule || loadBehaviorModule(repoRoot);
        behaviorModule.validateBehaviorArtifact(behavior);
        if (behavior.sha256 !== proposal.eval_summary?.behavior_tests?.sha256 || !DIGEST.test(behavior.sha256)) throw new Error('B6-D1 behavior artifact hash is missing or stale.');
        for (const route of (proposal.correction_routing || []).filter((entry) => ROUTED_LANES.has(entry?.lane))) {
            const record = (behavior.records || []).find((row) => row.correctionId === route.correction_id);
            if (!record) throw new Error(`B6-D1 behavior artifact does not cover ${route.correction_id}.`);
            if (record.disposition !== 'excluded_from_policy_learning' && record.expectationAuthority !== 'human_explanation') throw new Error(`B6-D1 behavior expectation for ${route.correction_id} is not human-bound.`);
        }
        atomicWrite(path.join(attemptRoot, 'behavior-tests.json'), Buffer.from(`${JSON.stringify(behavior, null, 2)}\n`));
        const prepared = await bindHistoricalDataset(client, proposal, datasetPath, path.join(attemptRoot, 'dataset.jsonl'));
        metadata.expected_dataset_sha256 = prepared.sha256;
        metadata.expected_case_ids = prepared.rows.map((row) => row.case_id);
        metadata.behavior_tests_sha256 = behavior.sha256;
        for (const field of ['proposal_sha256', 'baseline_source_sha256', 'expected_dataset_sha256', 'behavior_tests_sha256', 'prompt_sha256', 'accepted_rules_sha256']) {
            if (!DIGEST.test(metadata[field])) throw new Error(`Prepared claim hash ${field} is missing or malformed.`);
        }
        const progress = { schema_version: 1, attempt_id: attemptId, phase: 'analysis', state: 'active', completed: 0,
            total: prepared.rows.length, updated_at: new Date(now).toISOString(), deadline_at: deadlineAt,
            budget: { max_drafts: 2, model_calls: 0 } };
        atomicWrite(path.join(candidateRoot, 'progress.json'), Buffer.from(`${JSON.stringify(progress, null, 2)}\n`));
        claimStarted = true;
        await store.recordCodeVerification(client, proposal, { code_candidate: metadata }, verification);
        return { status: 'claimed', attemptId, artifactDirectory: attemptRoot, metadata, dataset: prepared };
    } catch (error) {
        if (claimStarted) {
            try {
                const progressPath = path.join(candidateRoot, 'progress.json');
                if (fs.existsSync(progressPath)) atomicWrite(progressPath, Buffer.from(`${JSON.stringify({ schema_version: 1, attempt_id: attemptId, phase: 'analysis', state: 'failed', completed: 0, total: 0, updated_at: new Date().toISOString(), deadline_at: deadlineAt, reason: 'claim_failed' }, null, 2)}\n`));
            } catch { /* local evidence is best effort after a claim conflict */ }
        } else {
            fs.rmSync(attemptRoot, { recursive: true, force: true });
        }
        throw error;
    }
}

module.exports = { prepareCodeProposalAttempt, readFrozenDataset, bindHistoricalDataset, safeId };

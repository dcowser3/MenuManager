'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const EXCLUDED = new Set(['node_modules', 'dist', 'tmp', 'venv', '__pycache__', 'coverage', 'logs', 'archive']);
const EXTENSIONS = new Set(['.ts', '.js', '.json', '.py', '.ejs', '.css', '.html', '.txt']);
const PROTECTED = /(?:^|\/)(?:code-proposal|proposal-approval|contextual-proof|deployment-compatibility|learning-behavior-tests|replay-retirement|improvement-cycle|prompt-proposal|review-eval|internal-auth|request-normalization|code-candidate-progress)/;
const TEST_PATH = /^services\/dashboard\/__tests__\/code-candidate-[a-z0-9-]+\.test\.ts$/;
const DELIVERY = new Set(['services/dashboard/views/form.ejs', 'services/dashboard/public/js/redline-preview.js', 'services/diff-core/src/index.js']);
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_PATCH = 180000;

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const nfc = (value) => String(value || '').replace(/\r/g, '').normalize('NFC');
const safePath = (value) => {
    if (typeof value !== 'string' || value.length > 220 || value.includes('\\') || value.includes('\0') || value.startsWith('/')
        || value.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error('Unsafe relative path.');
    return value;
};
const inside = (root, target) => {
    const r = path.resolve(root), t = path.resolve(target);
    if (t === r || !t.startsWith(`${r}${path.sep}`)) throw new Error('Path is outside the trusted attempt root.');
    return t;
};
const digest = (value, label) => { if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`Invalid ${label} hash.`); };

function safeSegment(value, label) {
    const segment = `${value || ''}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(segment)) throw new Error(`Invalid ${label}.`);
    return segment;
}

function assertRegularDirectory(directory, label, mode = null) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (mode !== null && (stat.mode & 0o777) !== mode)) {
        throw new Error(`${label} must be a regular directory${mode === null ? '' : ` with mode ${mode.toString(8)}`}.`);
    }
    return stat;
}

function assertNoSymlinkComponents(root, target) {
    const trusted = path.resolve(root);
    const resolved = path.resolve(target);
    if (resolved !== trusted && !resolved.startsWith(`${trusted}${path.sep}`)) throw new Error('Path is outside the trusted attempt root.');
    let cursor = trusted;
    assertRegularDirectory(cursor, 'Trusted artifact root');
    for (const part of path.relative(trusted, resolved).split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        const stat = fs.lstatSync(cursor);
        if (stat.isSymbolicLink()) throw new Error(`Artifact path traverses a symlink: ${cursor}`);
    }
}

function boundedRegular(file, root, mode = 0o600) {
    const target = inside(root, file);
    let cursor = path.resolve(root);
    for (const part of path.relative(cursor, target).split(path.sep)) {
        cursor = path.join(cursor, part);
        if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Artifact path traverses a symlink: ${target}`);
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FILE || (stat.mode & 0o777) !== mode) throw new Error(`Unsafe artifact file: ${target}`);
    return fs.readFileSync(target);
}

function credentialSecrets(env = process.env) {
    return Object.entries(env || {}).filter(([key, value]) =>
        /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|SERVICE[_-]?.*KEY)/i.test(key)
        && typeof value === 'string' && value.length >= 4).map(([, value]) => value);
}

function rejectSecret(content, file, secrets = []) {
    // The trusted source includes the documented, non-secret development
    // placeholders used by the provider-key guard.  Do not treat those
    // placeholders as credentials while continuing to reject real key-shaped
    // values and configured secret bytes.
    const withoutPlaceholders = content.replace(/(?:\b(?:your-openai-api-key-here|sk-your_openai_api_key_here)\b|sk-or-\.\.\.)/g, '');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/.test(withoutPlaceholders)
        || [...new Set(secrets)].some((secret) => secret && content.includes(secret))) throw new Error(`Credential-like content in ${file}.`);
}

function runtimePath(file, proposal) {
    safePath(file);
    if (/(?:^|\/)__tests__(?:\/|$)|(?:^|\/)fixtures(?:\/|$)|(?:\.test|\.spec)\.[^./]+$/.test(file)) return false;
    if (PROTECTED.test(file)) return false;
    if (DELIVERY.has(file)) {
        const allowed = (proposal.correction_routing || []).some((route) => route.lane === 'code_recommendation'
            && (route.replay_status === 'delivery_mismatch' || (proposal.replay_evidence || []).some((entry) => entry.correction_id === route.correction_id && entry.status === 'delivery_mismatch')));
        if (!allowed) throw new Error(`Delivery path requires an explicitly routed delivery_mismatch correction: ${file}`);
    }
    return /^services\/(?:dashboard|ai-review)\/lib\/[A-Za-z0-9_./-]+\.(?:ts|js)$/.test(file)
        || DELIVERY.has(file);
}

function collectSource(source, relative = '', files = [], secrets = []) {
    const current = path.join(source, relative);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Source snapshot rejects symlinks: ${relative || '.'}`);
    const name = path.basename(relative);
    if (name.startsWith('.') || EXCLUDED.has(name) || /(?:secret|credential|private[-_]?key)/i.test(name)) return files;
    if (stat.isDirectory()) {
        for (const child of fs.readdirSync(current).sort()) collectSource(source, path.join(relative, child), files, secrets);
    } else if (stat.isFile() && EXTENSIONS.has(path.extname(relative))) {
        if (stat.size > MAX_FILE) throw new Error(`Source file too large: ${relative}`);
        const bytes = fs.readFileSync(current);
        rejectSecret(bytes.toString('utf8'), relative, secrets);
        files.push({ relative: relative.split(path.sep).join('/'), bytes });
    }
    return files;
}

function snapshotBaseline(source, target, verification, options = {}) {
    if (fs.existsSync(target)) throw new Error('Baseline snapshot already exists.');
    const suppliedSecrets = options.secrets || verification?.secrets;
    const secrets = Array.isArray(suppliedSecrets) ? suppliedSecrets : credentialSecrets(options.env || process.env);
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    const files = [];
    for (const entry of ['services', 'config', 'sop-processor', 'package.json', 'package-lock.json', 'tsconfig.json', 'jest.config.js', 'jest.setup.js']) {
        const full = path.join(source, entry);
        if (!fs.existsSync(full)) continue;
        if (fs.lstatSync(full).isSymbolicLink()) throw new Error(`Source snapshot rejects symlinks: ${entry}`);
        if (fs.lstatSync(full).isDirectory()) collectSource(source, entry, files, secrets);
        else collectSource(source, entry, files, secrets);
    }
    for (const entry of files) {
        const destination = path.join(target, entry.relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
        fs.writeFileSync(destination, entry.bytes, { mode: 0o600 });
    }
    return { sha256: hashImplementation(target, verification), files: files.map((entry) => entry.relative) };
}

function hashImplementation(root, verification) {
    if (verification?.hashCodeImplementation) return verification.hashCodeImplementation(root);
    const files = [];
    for (const entry of ['services', 'config', 'sop-processor']) {
        if (fs.existsSync(path.join(root, entry))) collectSource(root, entry, files);
    }
    if (fs.existsSync(path.join(root, 'services/dashboard/index.ts'))) files.push({ relative: 'services/dashboard/index.ts', bytes: fs.readFileSync(path.join(root, 'services/dashboard/index.ts')) });
    files.sort((a, b) => a.relative.localeCompare(b.relative));
    const h = crypto.createHash('sha256');
    for (const entry of files) h.update(entry.relative).update('\0').update(entry.bytes).update('\0');
    return h.digest('hex');
}

function readDataset(bytes) {
    const rows = bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    if (!rows.length || rows.some((row) => !row.case_id || !row.raw_input || !row.ground_truth || !row.context)
        || new Set(rows.map((row) => row.case_id)).size !== rows.length) throw new Error('Frozen dataset is incomplete or has duplicate case ids.');
    return rows;
}

function validateDraftPatch(patch, baseline, proposal) {
    if (typeof patch !== 'string' || patch.length < 30 || patch.length > MAX_PATCH || !patch.startsWith('diff --git ')
        || patch.includes('\0') || /^(?:GIT binary patch|Binary files|deleted file mode|old mode|new mode|rename from|rename to|copy from|copy to|similarity index|dissimilarity index|run|command|shell|exec)\s*[:]/m.test(patch)) {
        throw new Error('Draft must be a bounded textual unified diff without deletes, renames, binary, copy, or mode changes.');
    }
    rejectSecret(patch, 'draft patch');
    const sections = patch.split(/(?=^diff --git )/m).filter(Boolean);
    const files = [];
    for (const section of sections) {
        const header = /^diff --git a\/([^\n ]+) b\/([^\n ]+)\n/.exec(section);
        if (!header || header[1] !== header[2]) throw new Error('Patch headers must name one unchanged relative path.');
        const file = safePath(header[1]);
        if (!runtimePath(file, proposal) && !TEST_PATH.test(file)) throw new Error(`Patch path is outside the code-candidate allowlist: ${file}`);
        if (files.includes(file)) throw new Error('Patch contains duplicate path sections.');
        const existing = fs.existsSync(path.join(baseline, file));
        if (TEST_PATH.test(file) && existing) throw new Error('Candidate regression tests must be new files.');
        const before = /^--- ([^\n]+)$/m.exec(section), after = /^\+\+\+ ([^\n]+)$/m.exec(section);
        if (!before || !after || before[1] !== (existing ? `a/${file}` : '/dev/null') || after[1] !== `b/${file}`) throw new Error('Patch file headers are invalid.');
        if ((!existing && !/^new file mode 100644$/m.test(section)) || (existing && /^new file mode/m.test(section))) throw new Error('Patch file mode is invalid.');
        if (/^index [^\n]+ [0-9]{6}$/m.test(section) && !/^index [^\n]+ 100644$/m.test(section)) throw new Error('Patch index mode is invalid.');
        if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(section)) throw new Error('Patch is missing a unified-diff hunk.');
        if (TEST_PATH.test(file) && /^\+.*\b(?:test|it|describe)\s*\.\s*(?:only|skip|todo)\b/m.test(section)) throw new Error('Candidate tests cannot be skipped, pending, or exclusive.');
        files.push(file);
    }
    if (!files.some((file) => runtimePath(file, proposal)) || !files.some((file) => TEST_PATH.test(file))) throw new Error('Draft needs runtime implementation and a new code-candidate test.');
    return files;
}

function validateCorrectionMappings(draft, proposal, cases, eligibleCorrectionIds = null) {
    const eligible = eligibleCorrectionIds ? new Set(eligibleCorrectionIds) : null;
    const routes = (proposal.correction_routing || []).filter((row) => row.lane === 'code_recommendation' && (!eligible || eligible.has(row.correction_id)));
    if (!Array.isArray(draft.corrections) || draft.corrections.length !== routes.length) throw new Error('Map every routed code recommendation exactly once.');
    const seen = new Set(), covered = new Set();
    for (const entry of draft.corrections) {
        if (!entry || seen.has(entry.correction_id)) throw new Error('Correction mappings must be unique.');
        seen.add(entry.correction_id);
        const route = routes.find((row) => row.correction_id === entry.correction_id);
        const replay = (proposal.replay_evidence || []).find((row) => row.correction_id === entry.correction_id);
        if (!route || !cases.some((row) => row.case_id === entry.case_id) || typeof entry.test_name !== 'string' || !entry.test_name.trim()
            || !Array.isArray(entry.recommendation_indexes) || !entry.recommendation_indexes.length
            || entry.recommendation_indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= proposal.code_recommendations.length)) throw new Error('Correction mapping has an unknown case, test, or recommendation index.');
        const original = route.original_text || replay?.original_text, corrected = route.corrected_text || replay?.corrected_text;
        if (!original || !corrected || nfc(entry.original_text) !== nfc(original) || nfc(entry.corrected_text) !== nfc(corrected)) throw new Error('Correction mapping text differs from frozen source evidence.');
        entry.recommendation_indexes.forEach((index) => covered.add(index));
    }
    if (seen.size !== routes.length || covered.size !== proposal.code_recommendations.length) throw new Error('Every code recommendation needs exactly one mapped correction.');
}

function validateDraft(draft, proposal, dataset, baseline, options = {}) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.keys(draft).some((key) => !['summary', 'patch', 'test_files', 'corrections'].includes(key))) throw new Error('Draft JSON may contain only summary, patch, test_files, and corrections.');
    const files = validateDraftPatch(draft.patch, baseline, proposal);
    const tests = files.filter((file) => TEST_PATH.test(file));
    if (!Array.isArray(draft.test_files) || draft.test_files.length !== tests.length || new Set(draft.test_files).size !== tests.length || draft.test_files.some((file) => !tests.includes(file))) throw new Error('test_files must exactly identify new regression tests.');
    validateCorrectionMappings(draft, proposal, dataset, options.eligibleCorrectionIds);
    return { summary: String(draft.summary || '').slice(0, 3000), patch: draft.patch, test_files: tests, corrections: draft.corrections };
}

function applyDraft(patch, baseline, candidate, proposal, command = spawnSync, expectedAttemptId = null) {
    validateDraftPatch(patch, baseline, proposal);
    if (fs.existsSync(candidate)) {
        if (!expectedAttemptId) throw new Error('Candidate directory already exists.');
        const candidateStat = fs.lstatSync(candidate);
        if (candidateStat.isSymbolicLink() || !candidateStat.isDirectory() || (candidateStat.mode & 0o777) !== 0o700) throw new Error('Candidate directory already exists and is unsafe.');
        const entries = fs.readdirSync(candidate);
        if (entries.length !== 1 || entries[0] !== 'progress.json') throw new Error('Existing candidate directory must contain only progress.json.');
        const progress = fs.lstatSync(path.join(candidate, 'progress.json'));
        if (progress.isSymbolicLink() || !progress.isFile() || progress.size > MAX_FILE || (progress.mode & 0o777) !== 0o600) throw new Error('Existing candidate progress artifact is unsafe.');
        const payload = JSON.parse(fs.readFileSync(path.join(candidate, 'progress.json'), 'utf8'));
        if (!payload || payload.attempt_id !== expectedAttemptId || path.basename(path.dirname(candidate)) !== expectedAttemptId) throw new Error('Existing candidate progress identity differs.');
        for (const entry of fs.readdirSync(baseline)) {
            if (entry === 'progress.json') continue;
            const source = path.join(baseline, entry), target = path.join(candidate, entry);
            if (fs.existsSync(target)) throw new Error('Existing candidate contains a conflicting source entry.');
            fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
        }
    } else fs.cpSync(baseline, candidate, { recursive: true, errorOnExist: true, force: false });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CEILING_DIRECTORIES: path.dirname(candidate) });
    const init = command('git', ['-C', candidate, 'init', '--quiet'], { encoding: 'utf8', timeout: 30000, env });
    if (init.error || init.status !== 0) throw new Error(`Candidate git initialization failed: ${init.stderr || init.error?.message || 'unknown error'}`);
    for (const check of [true, false]) {
        const result = command('git', ['-C', candidate, 'apply', '--recount', '--whitespace=nowarn', ...(check ? ['--check'] : []), '-'], { input: patch, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, env });
        if (result.error || result.status !== 0) throw new Error(`Candidate patch ${check ? 'check' : 'application'} failed.`);
    }
    const changedFiles = validateDraftPatch(patch, baseline, proposal);
    for (const file of changedFiles) {
        const target = inside(candidate, path.join(candidate, file));
        let stat;
        try { stat = fs.lstatSync(target); } catch { throw new Error(`Applied candidate path is not a regular file: ${file}`); }
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Applied candidate path is not a regular file: ${file}`);
    }
    return candidate;
}

function revalidateAttemptArtifacts(options = {}) {
    const { attemptRoot, metadata, verification, proposal } = options;
    if (!attemptRoot || !metadata || !verification || !proposal) throw new Error('Draft validation requires attempt metadata and proposal.');
    const root = path.resolve(attemptRoot);
    const trustedRoot = path.resolve(options.trustedRoot || (options.repoRoot ? path.join(options.repoRoot, 'tmp', 'code-proposals') : ''));
    if (!trustedRoot || trustedRoot === path.resolve('.')) throw new Error('Draft validation requires a trusted artifact root or repo root.');
    const proposalId = safeSegment(proposal.id, 'proposal id');
    const attemptId = safeSegment(metadata.attempt_id, 'attempt id');
    const expectedProposalRoot = path.join(trustedRoot, proposalId);
    const expectedRoot = path.join(expectedProposalRoot, attemptId);
    if (root !== expectedRoot || metadata.artifact_directory !== root) throw new Error('Attempt artifact identity does not match trusted topology.');
    if (!options.baselineRoot) throw new Error('Baseline source snapshot is required for revalidation.');
    assertNoSymlinkComponents(trustedRoot, expectedRoot);
    assertRegularDirectory(trustedRoot, 'Trusted artifact root');
    assertRegularDirectory(expectedProposalRoot, 'Proposal artifact root');
    assertRegularDirectory(expectedRoot, 'Attempt root', 0o700);
    const proposalBytes = boundedRegular(path.join(root, 'proposal.json'), root);
    const promptBytes = boundedRegular(path.join(root, 'prompt.txt'), root);
    const rulesBytes = boundedRegular(path.join(root, 'rules.json'), root);
    const behaviorBytes = boundedRegular(path.join(root, 'behavior-tests.json'), root);
    const inventoryPath = path.join(root, 'preparation-inventory.json');
    const datasetBytes = boundedRegular(path.join(root, 'dataset.jsonl'), root);
    const storedProposal = JSON.parse(proposalBytes.toString('utf8'));
    const rulesPayload = JSON.parse(rulesBytes.toString('utf8'));
    const behavior = JSON.parse(behaviorBytes.toString('utf8'));
    const inventory = fs.existsSync(inventoryPath) ? JSON.parse(boundedRegular(inventoryPath, root).toString('utf8')) : null;
    if (inventory) {
        const inventoryBytes = boundedRegular(inventoryPath, root);
        digest(metadata.preparation_inventory_sha256, 'preparation inventory');
        if (hash(inventoryBytes) !== metadata.preparation_inventory_sha256 || inventory.proposal_id !== proposal.id || inventory.proposal_fingerprint !== metadata.proposal_sha256 || !DIGEST.test(inventory.eligible_group_set_sha256 || '')) throw new Error('Preparation inventory identity or eligible scope is stale.');
        const eligibleHash = hash(JSON.stringify((inventory.groups || []).filter((group) => group.status !== 'excluded').map((group) => group.correction_id)));
        if (eligibleHash !== inventory.eligible_group_set_sha256) throw new Error('Preparation inventory eligible scope changed.');
    }
    const cases = readDataset(datasetBytes);
    digest(metadata.proposal_sha256, 'proposal'); digest(metadata.baseline_source_sha256, 'baseline'); digest(metadata.prompt_sha256, 'prompt'); digest(metadata.accepted_rules_sha256, 'accepted rules'); digest(metadata.expected_dataset_sha256, 'dataset'); digest(metadata.behavior_tests_sha256, 'behavior');
    if (verification.codeProposalVerificationFingerprint(storedProposal) !== metadata.proposal_sha256 || verification.codeProposalVerificationFingerprint(proposal) !== metadata.proposal_sha256) throw new Error('Proposal fingerprint does not match the claimed attempt.');
    if (hash(promptBytes) !== metadata.prompt_sha256 || promptBytes.toString('utf8') !== (storedProposal.proposed_prompt || storedProposal.current_prompt || '')) throw new Error('Prompt artifact does not match the claimed proposal.');
    const rules = Array.isArray(rulesPayload) ? rulesPayload : rulesPayload.rules;
    if (!Array.isArray(rules) || verification.hashAcceptedRules(rules) !== metadata.accepted_rules_sha256) throw new Error('Accepted-rule artifact hash is stale.');
    if (hash(datasetBytes) !== metadata.expected_dataset_sha256 || JSON.stringify(cases.map((row) => row.case_id)) !== JSON.stringify(metadata.expected_case_ids)) throw new Error('Dataset artifact identity is stale.');
    const behaviorModule = options.behaviorModule || (options.repoRoot && (() => {
        const source = path.join(options.repoRoot, 'services/dashboard/lib/learning-behavior-tests.ts');
        let hasTsRuntime = false;
        try { require(require.resolve('ts-node/register/transpile-only', { paths: [options.repoRoot] })); hasTsRuntime = true; } catch { /* use checked-in dist below */ }
        return hasTsRuntime && fs.existsSync(source) ? require(source) : require(path.join(options.repoRoot, 'services/dashboard/dist/lib/learning-behavior-tests'));
    })());
    if (!behaviorModule || typeof behaviorModule.validateBehaviorArtifact !== 'function') throw new Error('Trusted behavior artifact validator is unavailable.');
    behaviorModule.validateBehaviorArtifact(behavior);
    if (behavior.sha256 !== metadata.behavior_tests_sha256 || (!inventory && behavior.sha256 !== storedProposal.eval_summary?.behavior_tests?.sha256)) throw new Error('B6-D1 behavior artifact identity is stale.');
    const baselineRoot = inside(root, options.baselineRoot);
    if (verification.hashCodeImplementation(baselineRoot) !== metadata.baseline_source_sha256) throw new Error('Baseline source snapshot hash is stale.');
    return { proposal: storedProposal, prompt: promptBytes.toString('utf8'), rules, behavior, cases, inventory, eligibleCorrectionIds: inventory?.groups?.filter((group) => group.status !== 'excluded').map((group) => group.correction_id) || null };
}

module.exports = { snapshotBaseline, validateDraft, validateDraftPatch, validateCorrectionMappings, applyDraft, revalidateAttemptArtifacts, hashImplementation, readDataset, safePath };

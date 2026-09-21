'use strict';

/**
 * B5-C2c2 fixed worker boundary. This module deliberately contains no model,
 * database, or approval logic. It only launches the already-frozen synthetic
 * C2c1 workload in an isolated Docker process and returns bounded JSON.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { validateDeliveryIdentity } = require('./code-proposal-delivery-identity');

const DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_TIMEOUT_MS = 180000;
const WORKER_SCRIPT = '/runner/worker.js';
const FIXED_ENTRYPOINT = 'node';
const FIXED_COMMAND = Object.freeze([WORKER_SCRIPT]);
const FIXED_ENV_KEYS = Object.freeze(['NODE_ENV', 'NODE_PATH', 'C2C2_PROTOCOL_VERSION', 'C2C2_PHASE', 'C2C2_ARM', 'C2C2_SEED', 'C2C2_RUN_ID', 'C2C2_RUNTIME_ID', 'C2C2_IMAGE_ID', 'C2C2_REQUEST_PATH']);
const SUPPORT_FILES = Object.freeze(['jest.setup.js', 'tsconfig.json', 'services/dashboard/tsconfig.json']);

function supportIdentity(repoRoot) {
    const hash = crypto.createHash('sha256');
    for (const relative of SUPPORT_FILES) {
        const file = path.join(repoRoot, relative);
        if (!fs.existsSync(file)) continue;
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Trusted support file is not a regular file: ${relative}`);
        hash.update(relative).update('\0').update(fs.readFileSync(file)).update('\0');
    }
    return hash.digest('hex');
}

function deriveRuntimeId() {
    const launcherBytes = fs.readFileSync(__filename);
    const workerBytes = fs.readFileSync(path.resolve(__dirname, '../code-proposal-c2c2-worker.js'));
    const lockPath = path.resolve(__dirname, '../../package-lock.json');
    const lockBytes = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : Buffer.from('no-lockfile');
    const repoRoot = path.resolve(__dirname, '../..');
    return crypto.createHash('sha256').update(launcherBytes).update(workerBytes).update(lockBytes).update(supportIdentity(repoRoot)).update(JSON.stringify({ entrypoint: FIXED_ENTRYPOINT, command: FIXED_COMMAND, nodePath: '/app/node_modules', maxOutput: MAX_OUTPUT_BYTES, maxTimeout: MAX_TIMEOUT_MS, network: 'none', capDrop: 'ALL', capAdd: ['SETUID', 'SETGID'], noNewPrivileges: true, stagingUid: '0:0', candidateUid: '65532:65532', dependenciesMount: '/app/node_modules', workerHome: '/tmp', supportFiles: SUPPORT_FILES })).digest('hex');
}

const FIXED_RUNTIME_ID = deriveRuntimeId();

function digest(value, label) {
    if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`C2c2 requires an immutable ${label} digest.`);
    return value;
}

function safeId(value, label) {
    const id = `${value || ''}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) throw new Error(`Invalid ${label}.`);
    return id;
}

function canonicalDirectory(root, label, parent) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error(`${label} must be an absolute path.`);
    const resolved = path.resolve(root);
    const real = fs.realpathSync(resolved);
    if (real !== resolved) throw new Error(`${label} must not be a symlink or path alias.`);
    const stat = fs.lstatSync(real);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular directory.`);
    if (parent) {
        const parentReal = canonicalDirectory(parent, 'Parent root');
        if (real !== parentReal && !real.startsWith(`${parentReal}${path.sep}`)) throw new Error(`${label} escapes the frozen attempt topology.`);
    }
    return real;
}

function assertNoOverlap(entries) {
    const paths = entries.map((entry) => entry.path).sort();
    for (let index = 1; index < paths.length; index++) {
        if (paths[index] === paths[index - 1] || paths[index].startsWith(`${paths[index - 1]}${path.sep}`) || paths[index - 1].startsWith(`${paths[index]}${path.sep}`)) throw new Error('C2c2 mounts overlap.');
    }
}

function buildContainerName(attemptId, nonce = crypto.randomBytes(8).toString('hex')) {
    const attempt = safeId(attemptId, 'attempt id');
    const unique = safeId(nonce, 'container nonce');
    const room = 120 - unique.length - 9;
    if (room < 1) throw new Error('C2c2 container nonce is too long.');
    return `mm-c2c2-${attempt.slice(0, room)}-${unique}`;
}

function prepareSupportBundle(repoRoot, attemptRoot) {
    const root = path.join(attemptRoot, 'c2c2-support');
    if (fs.existsSync(root)) {
        const existing = fs.lstatSync(root);
        if (existing.isSymbolicLink() || !existing.isDirectory() || (existing.mode & 0o777) !== 0o700) throw new Error('C2c2 support bundle is not an owner-only directory.');
    } else fs.mkdirSync(root, { mode: 0o700 });
    const manifest = [];
    for (const relative of SUPPORT_FILES) {
        const source = path.join(repoRoot, relative);
        if (!fs.existsSync(source)) continue;
        const stat = fs.lstatSync(source);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Trusted support file is not a regular file: ${relative}`);
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const bytes = fs.readFileSync(source);
        if (fs.existsSync(target) && !fs.readFileSync(target).equals(bytes)) throw new Error(`C2c2 support bundle changed: ${relative}`);
        if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { mode: 0o444 });
        fs.chmodSync(target, 0o444);
        manifest.push({ path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
    const manifestBytes = Buffer.from(`${JSON.stringify({ schema_version: 1, files: manifest }, null, 2)}\n`);
    const manifestPath = path.join(root, 'manifest.json');
    if (fs.existsSync(manifestPath) && !fs.readFileSync(manifestPath).equals(manifestBytes)) throw new Error('C2c2 support manifest changed.');
    if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, manifestBytes, { mode: 0o444 });
    fs.chmodSync(manifestPath, 0o444);
    return { root, sha256: crypto.createHash('sha256').update(manifestBytes).digest('hex') };
}

function reviewDriver(plan, arm) {
    const prompt = arm === 'baseline' ? plan.baseline_prompt : plan.candidate_prompt;
    const rules = arm === 'baseline' ? plan.baseline_rules : plan.candidate_rules;
    const promptHash = arm === 'baseline' ? plan.baseline_prompt_sha256 : plan.candidate_prompt_sha256;
    const rulesHash = arm === 'baseline' ? plan.baseline_rules_sha256 : plan.candidate_rules_sha256;
    if (typeof prompt !== 'string' || typeof promptHash !== 'string' || !Array.isArray(rules) || typeof rulesHash !== 'string') throw new Error('C2c2 requires bound prompt/rule driver identities.');
    return { prompt, prompt_sha256: promptHash, rules, rules_sha256: rulesHash, settings: plan.settings || {}, vocabulary_texts: plan.vocabulary_texts || [], vocabulary_terms: plan.vocabulary_terms || [] };
}

function buildDockerInvocation(options = {}) {
    const attemptRoot = canonicalDirectory(options.attemptRoot, 'Attempt root');
    const baselineRoot = canonicalDirectory(options.baselineRoot, 'Baseline root', attemptRoot);
    const candidateRoot = canonicalDirectory(options.candidateRoot, 'Candidate root', attemptRoot);
    const testBundleRoot = canonicalDirectory(options.testBundleRoot, 'Test bundle root', attemptRoot);
    const outputRoot = canonicalDirectory(options.outputRoot || path.join(attemptRoot, 'docker-output'), 'Output root', attemptRoot);
    if ((fs.lstatSync(outputRoot).mode & 0o777) !== 0o700) throw new Error('Output root must be owner-only mode 0700.');
    const trustedRepoRoot = canonicalDirectory(options.repoRoot || path.resolve(__dirname, '../..'), 'Trusted repository root');
    if (supportIdentity(trustedRepoRoot) !== supportIdentity(path.resolve(__dirname, '../..'))) throw new Error('C2c2 trusted support identity drifted from the fixed runtime.');
    const workerSource = path.resolve(__dirname, '../code-proposal-c2c2-worker.js');
    const workerStat = fs.lstatSync(workerSource);
    if (workerStat.isSymbolicLink() || !workerStat.isFile()) throw new Error('C2c2 worker source must be a regular file.');
    const support = prepareSupportBundle(trustedRepoRoot, attemptRoot);
    const image = digest(options.imageId, 'image');
    const runtime = digest(options.runtimeId, 'runtime');
    // Re-derive on every invocation so a long-lived host process cannot keep
    // using a stale worker/support runtime after the checked-in boundary moves.
    const currentRuntimeId = deriveRuntimeId();
    if (runtime !== currentRuntimeId || FIXED_RUNTIME_ID !== currentRuntimeId) throw new Error('C2c2 runtime identity is not derived from the fixed launcher and worker.');
    if (options.plan && (options.plan.image_id !== image || options.plan.runtime_id !== runtime)) throw new Error('C2c2 image/runtime identity drifted from the frozen plan.');
    const attemptId = safeId(options.attemptId, 'attempt id');
    const phase = safeId(options.phase, 'phase');
    const arm = safeId(options.arm, 'arm');
    if (!['unit', 'replay', 'behavior', 'delivery'].includes(phase) || !['baseline', 'candidate', 'paired'].includes(arm)) throw new Error('C2c2 phase/arm is not allowlisted.');
    if (phase === 'delivery' && arm !== 'paired') throw new Error('Delivery workers must use the paired arm.');
    let effectiveImage = image;
    let effectiveRuntime = runtime;
    let deliveryIdentity = null;
    if (phase === 'delivery') {
        deliveryIdentity = validateDeliveryIdentity(options.plan?.delivery_identity);
        effectiveImage = digest(deliveryIdentity.delivery_image_id, 'delivery image');
        effectiveRuntime = digest(deliveryIdentity.delivery_runtime_id, 'delivery runtime');
    }
    if (phase === 'behavior' && arm !== 'candidate') throw new Error('Behavior workers must use the candidate arm.');
    if (!Number.isInteger(options.seed) || options.seed < 0) throw new Error('C2c2 seed is invalid.');
    const name = buildContainerName(attemptId, options.containerNonce);
    const requestPath = path.join(outputRoot, `request-${name}.json`);
    const request = options.request ? { ...options.request, plan: options.request.plan ? { ...options.request.plan, support_bundle_sha256: support.sha256 } : options.request.plan } : null;
    const requestBytes = request ? Buffer.from(`${JSON.stringify(request)}\n`) : null;
    if (requestBytes && requestBytes.length > MAX_OUTPUT_BYTES) throw new Error('C2c2 worker request exceeded the bounded limit.');
    if (requestBytes) {
        fs.writeFileSync(requestPath, requestBytes, { mode: 0o444 });
        fs.chmodSync(requestPath, 0o444);
    }
    const mounts = [
        { source: baselineRoot, destination: '/runner/baseline', mode: 'ro' },
        { source: candidateRoot, destination: '/runner/candidate', mode: 'ro' },
        { source: testBundleRoot, destination: '/runner/test-bundle', mode: 'ro' },
        { source: support.root, destination: '/runner/support', mode: 'ro' },
        { source: workerSource, destination: WORKER_SCRIPT, mode: 'ro' },
    ];
    assertNoOverlap(mounts.map((mount) => ({ path: mount.source })));
    assertNoOverlap([...mounts.map((mount) => ({ path: mount.source })), { path: outputRoot }]);
    const runId = safeId(options.runId || `${attemptId}:${phase}:${arm}:${options.seed}`, 'run id');
    const env = {
        NODE_ENV: 'test', NODE_PATH: '/app/node_modules', C2C2_PROTOCOL_VERSION: '1', C2C2_PHASE: phase,
        C2C2_ARM: arm, C2C2_SEED: `${options.seed}`, C2C2_RUN_ID: runId, C2C2_RUNTIME_ID: effectiveRuntime, C2C2_IMAGE_ID: effectiveImage, C2C2_REQUEST_PATH: '/runner/request.json',
    };
    const args = ['run', '--rm', '--name', name, '--entrypoint', FIXED_ENTRYPOINT, '--label', `com.menumanager.c2c2.owner=${attemptId}`, '--label', `com.menumanager.c2c2.name=${name}`, '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--security-opt', 'no-new-privileges:true', '--read-only', '--pids-limit', '128', '--memory', '1g', '--cpus', '1', '--user', '0:0', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--tmpfs', '/runner/output:rw,noexec,nosuid,size=64m,mode=1777'];
    for (const mount of mounts) args.push('--mount', `type=bind,src=${mount.source},dst=${mount.destination}${mount.mode === 'ro' ? ',readonly' : ''}`);
    args.push('--mount', `type=bind,src=${requestPath},dst=/runner/request.json,readonly`, '--env', 'NODE_ENV=test', '--env', 'NODE_PATH', '--env', 'C2C2_PROTOCOL_VERSION=1', '--env', 'C2C2_PHASE', '--env', 'C2C2_ARM', '--env', 'C2C2_SEED', '--env', 'C2C2_RUN_ID', '--env', 'C2C2_RUNTIME_ID', '--env', 'C2C2_IMAGE_ID', '--env', 'C2C2_REQUEST_PATH', effectiveImage, ...FIXED_COMMAND);
    return Object.freeze({ command: 'docker', args, name, ownerLabel: `com.menumanager.c2c2.owner=${attemptId}`, image: effectiveImage, runtime: effectiveRuntime, deliveryIdentity, attemptRoot, outputRoot, requestPath, requestSha256: requestBytes ? crypto.createHash('sha256').update(requestBytes).digest('hex') : null, mounts, env, phase, arm, seed: options.seed, runId: env.C2C2_RUN_ID, request, supportBundleSha256: support.sha256 });
}

function parseWorkerOutput(stdout, stderr, spec = null) {
    if (Buffer.byteLength(stdout || '', 'utf8') > MAX_OUTPUT_BYTES || Buffer.byteLength(stderr || '', 'utf8') > MAX_OUTPUT_BYTES) throw new Error('C2c2 worker output exceeded the bounded limit.');
    let value;
    try { value = JSON.parse(stdout); } catch { throw new Error('C2c2 worker output is not valid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.protocol_version !== 1 || typeof value.status !== 'string') throw new Error('C2c2 worker report schema is invalid.');
    if (value.status !== 'ok' && value.status !== 'failed') throw new Error('C2c2 worker status is invalid.');
    if (spec) {
        if (typeof value.phase !== 'string' || typeof value.arm !== 'string' || !Number.isInteger(value.seed) || typeof value.run_id !== 'string' || typeof value.runtime_id !== 'string' || typeof value.image_id !== 'string') throw new Error('C2c2 worker protocol identity types are invalid.');
        if (value.phase !== spec.phase || value.arm !== spec.arm || value.seed !== spec.seed || value.run_id !== spec.runId || value.runtime_id !== spec.runtime || value.image_id !== spec.image) throw new Error('C2c2 worker identity does not match its immutable invocation.');
        const allowed = new Set(['protocol_version', 'status', 'phase', 'arm', 'seed', 'run_id', 'runtime_id', 'image_id', 'error', 'blocked', 'exit_code', 'report', 'report_id', 'output', 'response', 'diagnostics', 'outcomes', 'driver', 'driver_sha256', 'source_manifest_sha256', 'delivery_fixture_sha256', 'baseline_submitted_text', 'candidate_submitted_text', 'baseline_submitted_html', 'candidate_submitted_html', 'baseline_submitted_html_text', 'candidate_submitted_html_text', 'baseline_source_hashes', 'candidate_source_hashes', 'baseline_browser_version', 'candidate_browser_version', 'quill_version']);
        if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('C2c2 worker report contains an unallowlisted field.');
        if (value.status === 'failed' && (typeof value.error !== 'string' || (value.blocked !== undefined && typeof value.blocked !== 'boolean'))) throw new Error('C2c2 worker failure protocol is invalid.');
        if (value.status === 'ok' && value.phase === 'unit' && (!Number.isInteger(value.exit_code) || !value.report || typeof value.report !== 'object' || Array.isArray(value.report))) throw new Error('C2c2 unit report protocol is invalid.');
    }
    if (value.status === 'ok' && !('exit_code' in value || 'report_id' in value || ['form-submit-v1', 'review-pipeline-v1', 'review-pipeline-behavior-v1'].includes(value.driver))) throw new Error('C2c2 worker success report is incomplete.');
    return value;
}

function cleanupOwnedContainer(spec, options = {}) {
    const inspect = options.inspect || (() => new Promise((resolve, reject) => execFile('docker', ['inspect', '--format', '{{.Name}}|{{index .Config.Labels "com.menumanager.c2c2.name"}}|{{index .Config.Labels "com.menumanager.c2c2.owner"}}', spec.name], { timeout: 10000 }, (error, stdout) => {
        if (error) return reject(error);
        const [name, ownedName, owner] = `${stdout}`.trim().replace(/^\//, '').split('|');
        resolve({ name, labels: { 'com.menumanager.c2c2.name': ownedName, 'com.menumanager.c2c2.owner': owner } });
    })));
    const remove = options.remove || (() => new Promise((resolve, reject) => execFile('docker', ['rm', '--force', '--volumes', spec.name], { timeout: 10000 }, (error, _stdout, stderr) => error ? reject(new Error(`C2c2 cleanup failed: ${stderr || error.message}`)) : resolve(true))));
    return Promise.resolve(inspect(spec.name)).then((info) => {
        if (!info || info.name !== spec.name || info.labels?.['com.menumanager.c2c2.name'] !== spec.name || info.labels?.['com.menumanager.c2c2.owner'] !== spec.ownerLabel.split('=').slice(1).join('=')) throw new Error('C2c2 cleanup ownership could not be proven.');
        return Promise.resolve(remove(spec.name)).then((removed) => { if (removed !== true) throw new Error('C2c2 owned container cleanup was uncertain.'); return true; });
    });
}

function runDockerInvocation(spec, options = {}) {
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 30000, 1), MAX_TIMEOUT_MS);
    const spawnImpl = options.spawn || spawn;
    if (!spec.request || !spec.requestSha256 || !fs.existsSync(spec.requestPath)) return Promise.reject(new Error('C2c2 requires an immutable per-run request file.'));
    const requestStat = fs.statSync(spec.requestPath);
    if (!requestStat.isFile() || (requestStat.mode & 0o777) !== 0o444 || crypto.createHash('sha256').update(fs.readFileSync(spec.requestPath)).digest('hex') !== spec.requestSha256) return Promise.reject(new Error('C2c2 request file changed before launch.'));
    const inspectImage = options.inspectImage || (() => new Promise((resolve, reject) => execFile('docker', ['image', 'inspect', '--format', '{{.Id}}', spec.image], { timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(`${stdout}`.trim()))));
    return Promise.resolve(inspectImage(spec.image)).then((actualImage) => {
        if (actualImage !== spec.image) throw new Error('C2c2 Docker image identity drifted before launch.');
        return new Promise((resolve, reject) => {
        let child;
        try { child = spawnImpl(spec.command, spec.args, { env: { ...Object.fromEntries(FIXED_ENV_KEYS.map((key) => [key, spec.env[key]])), PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { reject(error); return; }
        let stdout = '', stderr = '', settled = false, timedOut = false, timer;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
        const append = (target, chunk) => {
            const next = target + chunk;
            return Buffer.byteLength(next, 'utf8') <= MAX_OUTPUT_BYTES + 1 ? next : next.slice(0, MAX_OUTPUT_BYTES + 1);
        };
        child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk.toString()); });
        child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk.toString()); });
        child.on('error', (error) => finish(error));
        child.on('close', (code, signal) => {
            if (timedOut) return;
            if (signal) return finish(new Error(`C2c2 worker terminated by signal ${signal}.`));
            if (code !== 0) return finish(new Error(`C2c2 worker exited with status ${code}: ${(stderr || stdout).slice(0, 500)}`));
            try { finish(null, parseWorkerOutput(stdout, stderr, spec)); } catch (error) { finish(error); }
        });
        timer = setTimeout(() => {
            timedOut = true;
            try { child.kill('SIGKILL'); } catch { /* cleanup is verified below */ }
            cleanupOwnedContainer(spec, options).then(() => finish(new Error('C2c2 worker timed out.'))).catch((error) => finish(error));
        }, timeoutMs);
        });
    });
}

function createDockerC2c2Executors(options = {}) {
    const frozen = { ...options };
    return Object.freeze({
        executor: (input) => runDockerInvocation(buildDockerInvocation({ ...frozen, phase: 'unit', arm: input.arm, seed: 0, attemptRoot: frozen.attemptRoot, baselineRoot: frozen.baselineRoot, candidateRoot: frozen.candidateRoot, testBundleRoot: input.testBundleRoot, outputRoot: frozen.outputRoot, plan: input.plan, request: { phase: 'unit', arm: input.arm, inventory: input.inventory, plan: input.plan } }), { timeoutMs: frozen.timeoutMs, spawn: frozen.spawn, inspectImage: frozen.inspectImage }),
        replayExecutor: (input) => { const { ground_truth, ...safeCase } = input.case || {}; return runDockerInvocation(buildDockerInvocation({ ...frozen, phase: 'replay', arm: input.arm, seed: input.seed, runId: input.runId, baselineRoot: frozen.baselineRoot, candidateRoot: frozen.candidateRoot, testBundleRoot: input.testBundleRoot, outputRoot: frozen.outputRoot, request: { phase: 'replay', arm: input.arm, seed: input.seed, run_id: input.runId, case: safeCase, driver: reviewDriver(input.plan, input.arm), inventory: input.plan.test_inventory, plan: input.plan } }), { timeoutMs: frozen.timeoutMs, spawn: frozen.spawn, inspectImage: frozen.inspectImage }); },
        behaviorExecutor: (input) => runDockerInvocation(buildDockerInvocation({ ...frozen, phase: 'behavior', arm: 'candidate', seed: input.seed || 0, runId: input.runId || `${frozen.attemptId}:behavior`, baselineRoot: frozen.baselineRoot, candidateRoot: frozen.candidateRoot, testBundleRoot: input.plan.paths.testBundle, outputRoot: frozen.outputRoot, request: { phase: 'behavior', arm: 'candidate', seed: input.seed || 0, run_id: input.runId || `${frozen.attemptId}:behavior`, behavior: input.behavior, inventory: input.plan.test_inventory, driver: reviewDriver(input.plan, 'candidate'), plan: input.plan } }), { timeoutMs: frozen.timeoutMs, spawn: frozen.spawn, inspectImage: frozen.inspectImage }),
        deliveryExecutor: (input) => runDockerInvocation(buildDockerInvocation({ ...frozen, phase: 'delivery', arm: 'paired', seed: input.seed, runId: input.runId, plan: input.plan, baselineRoot: frozen.baselineRoot, candidateRoot: frozen.candidateRoot, testBundleRoot: input.plan.paths.testBundle, outputRoot: frozen.outputRoot, request: { phase: 'delivery', arm: 'paired', seed: input.seed, run_id: input.runId, delivery_fixture: input.delivery_fixture, plan: input.plan } }), { timeoutMs: frozen.timeoutMs, spawn: frozen.spawn, inspectImage: frozen.inspectImage }),
    });
}

module.exports = { buildDockerInvocation, buildContainerName, parseWorkerOutput, runDockerInvocation, cleanupOwnedContainer, createDockerC2c2Executors, FIXED_COMMAND, FIXED_ENTRYPOINT, FIXED_RUNTIME_ID, MAX_OUTPUT_BYTES };

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

const DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_TIMEOUT_MS = 180000;
const WORKER_SCRIPT = '/runner/scripts/code-proposal-c2c2-worker.js';
const FIXED_COMMAND = Object.freeze(['node', WORKER_SCRIPT]);
const FIXED_ENV_KEYS = Object.freeze(['NODE_ENV', 'C2C2_PROTOCOL_VERSION', 'C2C2_PHASE', 'C2C2_ARM', 'C2C2_SEED', 'C2C2_RUN_ID', 'C2C2_RUNTIME_ID']);

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

function buildDockerInvocation(options = {}) {
    const attemptRoot = canonicalDirectory(options.attemptRoot, 'Attempt root');
    const baselineRoot = canonicalDirectory(options.baselineRoot, 'Baseline root', attemptRoot);
    const candidateRoot = canonicalDirectory(options.candidateRoot, 'Candidate root', attemptRoot);
    const testBundleRoot = canonicalDirectory(options.testBundleRoot, 'Test bundle root', attemptRoot);
    const outputRoot = canonicalDirectory(options.outputRoot || path.join(attemptRoot, 'docker-output'), 'Output root', attemptRoot);
    if ((fs.lstatSync(outputRoot).mode & 0o777) !== 0o700) throw new Error('Output root must be owner-only mode 0700.');
    const trustedRepoRoot = canonicalDirectory(options.repoRoot || path.resolve(__dirname, '../..'), 'Trusted repository root');
    const scriptsRoot = canonicalDirectory(path.join(trustedRepoRoot, 'scripts'), 'Trusted worker scripts', trustedRepoRoot);
    const image = digest(options.imageId, 'image');
    const runtime = digest(options.runtimeId, 'runtime');
    if (options.plan && (options.plan.image_id !== image || options.plan.runtime_id !== runtime)) throw new Error('C2c2 image/runtime identity drifted from the frozen plan.');
    const attemptId = safeId(options.attemptId, 'attempt id');
    const phase = safeId(options.phase, 'phase');
    const arm = safeId(options.arm, 'arm');
    if (!['unit', 'replay', 'delivery'].includes(phase) || !['baseline', 'candidate', 'paired'].includes(arm)) throw new Error('C2c2 phase/arm is not allowlisted.');
    if (phase === 'delivery' && arm !== 'paired') throw new Error('Delivery workers must use the paired arm.');
    if (!Number.isInteger(options.seed) || options.seed < 0) throw new Error('C2c2 seed is invalid.');
    const name = buildContainerName(attemptId, options.containerNonce);
    const mounts = [
        { source: baselineRoot, destination: '/runner/baseline', mode: 'ro' },
        { source: candidateRoot, destination: '/runner/candidate', mode: 'ro' },
        { source: testBundleRoot, destination: '/runner/test-bundle', mode: 'ro' },
        { source: outputRoot, destination: '/runner/output', mode: 'rw' },
        { source: scriptsRoot, destination: '/runner/scripts', mode: 'ro' },
    ];
    assertNoOverlap(mounts.map((mount) => ({ path: mount.source })));
    const runId = safeId(options.runId || `${attemptId}:${phase}:${arm}:${options.seed}`, 'run id');
    const env = {
        NODE_ENV: 'test', C2C2_PROTOCOL_VERSION: '1', C2C2_PHASE: phase, C2C2_RUNTIME_ID: runtime,
        C2C2_ARM: arm, C2C2_SEED: `${options.seed}`, C2C2_RUN_ID: runId,
    };
    const args = ['run', '--rm', '--name', name, '--label', `com.menumanager.c2c2.owner=${attemptId}`, '--label', `com.menumanager.c2c2.name=${name}`, '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--read-only', '--pids-limit', '128', '--memory', '1g', '--cpus', '1', '--user', '65532:65532', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m'];
    for (const mount of mounts) args.push('--mount', `type=bind,src=${mount.source},dst=${mount.destination}${mount.mode === 'ro' ? ',readonly' : ''}`);
    args.push('--env', 'NODE_ENV=test', '--env', 'C2C2_PROTOCOL_VERSION=1', '--env', 'C2C2_PHASE', '--env', 'C2C2_ARM', '--env', 'C2C2_SEED', '--env', 'C2C2_RUN_ID', '--env', 'C2C2_RUNTIME_ID', image, ...FIXED_COMMAND);
    return Object.freeze({ command: 'docker', args, name, ownerLabel: `com.menumanager.c2c2.owner=${attemptId}`, image, runtime, attemptRoot, outputRoot, mounts, env, phase, arm, seed: options.seed, runId: env.C2C2_RUN_ID, request: options.request || null });
}

function parseWorkerOutput(stdout, stderr) {
    if (Buffer.byteLength(stdout || '', 'utf8') > MAX_OUTPUT_BYTES || Buffer.byteLength(stderr || '', 'utf8') > MAX_OUTPUT_BYTES) throw new Error('C2c2 worker output exceeded the bounded limit.');
    let value;
    try { value = JSON.parse(stdout); } catch { throw new Error('C2c2 worker output is not valid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.protocol_version !== 1 || typeof value.status !== 'string') throw new Error('C2c2 worker report schema is invalid.');
    if (value.status !== 'ok' && value.status !== 'failed') throw new Error('C2c2 worker status is invalid.');
    if (value.status === 'ok' && !('exit_code' in value || 'report_id' in value || value.driver === 'form-submit-v1')) throw new Error('C2c2 worker success report is incomplete.');
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
    if (spec.request) {
        const requestPath = path.join(spec.outputRoot, 'request.json');
        const bytes = Buffer.from(`${JSON.stringify(spec.request)}\n`);
        if (bytes.length > MAX_OUTPUT_BYTES) return Promise.reject(new Error('C2c2 worker request exceeded the bounded limit.'));
        fs.writeFileSync(requestPath, bytes, { mode: 0o600 });
        fs.chmodSync(requestPath, 0o600);
    }
    return new Promise((resolve, reject) => {
        let child;
        try { child = spawnImpl(spec.command, spec.args, { env: { ...Object.fromEntries(FIXED_ENV_KEYS.map((key) => [key, spec.env[key]])), PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { reject(error); return; }
        let stdout = '', stderr = '', settled = false, timer;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
        const append = (target, chunk) => {
            const next = target + chunk;
            return Buffer.byteLength(next, 'utf8') <= MAX_OUTPUT_BYTES + 1 ? next : next.slice(0, MAX_OUTPUT_BYTES + 1);
        };
        child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk.toString()); });
        child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk.toString()); });
        child.on('error', (error) => finish(error));
        child.on('close', (code, signal) => {
            if (signal) return finish(new Error(`C2c2 worker terminated by signal ${signal}.`));
            if (code !== 0) return finish(new Error(`C2c2 worker exited with status ${code}.`));
            try { finish(null, parseWorkerOutput(stdout, stderr)); } catch (error) { finish(error); }
        });
        timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* cleanup is verified below */ }
            cleanupOwnedContainer(spec, options).then(() => finish(new Error('C2c2 worker timed out.'))).catch((error) => finish(error));
        }, timeoutMs);
    });
}

function createDockerC2c2Executors(options = {}) {
    const frozen = { ...options };
    return Object.freeze({
        executor: (input) => runDockerInvocation(buildDockerInvocation({ ...frozen, phase: 'unit', arm: input.arm, seed: 0, attemptRoot: frozen.attemptRoot, baselineRoot: frozen.baselineRoot, candidateRoot: frozen.candidateRoot, testBundleRoot: input.testBundleRoot, outputRoot: frozen.outputRoot, plan: input.plan, request: { phase: 'unit', arm: input.arm, inventory: input.inventory, plan: input.plan } }), { timeoutMs: frozen.timeoutMs, spawn: frozen.spawn }),
        replayExecutor: (input) => runDockerInvocation(buildDockerInvocation({ ...frozen, phase: 'replay', arm: input.arm, seed: input.seed, runId: input.runId, baselineRoot: frozen.baselineRoot, candidateRoot: frozen.candidateRoot, testBundleRoot: input.testBundleRoot, outputRoot: frozen.outputRoot, request: { phase: 'replay', arm: input.arm, seed: input.seed, run_id: input.runId, case: input.case, plan: input.plan } }), { timeoutMs: frozen.timeoutMs, spawn: frozen.spawn }),
        deliveryExecutor: (input) => runDockerInvocation(buildDockerInvocation({ ...frozen, phase: 'delivery', arm: 'paired', seed: input.seed, runId: input.runId, baselineRoot: frozen.baselineRoot, candidateRoot: frozen.candidateRoot, testBundleRoot: input.plan.paths.testBundle, outputRoot: frozen.outputRoot, request: { phase: 'delivery', arm: 'paired', seed: input.seed, run_id: input.runId, correction: input.correction, plan: input.plan } }), { timeoutMs: frozen.timeoutMs, spawn: frozen.spawn }),
    });
}

module.exports = { buildDockerInvocation, buildContainerName, parseWorkerOutput, runDockerInvocation, cleanupOwnedContainer, createDockerC2c2Executors, FIXED_COMMAND, MAX_OUTPUT_BYTES };

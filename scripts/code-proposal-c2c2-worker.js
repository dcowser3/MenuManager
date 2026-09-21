'use strict';

// Fixed, credential-free worker protocol. The host launcher chooses the image,
// mounts, command, and environment; this file accepts no command or path input.
const phase = process.env.C2C2_PHASE;
const arm = process.env.C2C2_ARM;
const seed = Number(process.env.C2C2_SEED);
const runId = process.env.C2C2_RUN_ID;
const runtimeId = process.env.C2C2_RUNTIME_ID;
const imageId = process.env.C2C2_IMAGE_ID;
const requestPath = process.env.C2C2_REQUEST_PATH;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const TEST_PATH = /^services\/dashboard\/__tests__\/code-candidate-[a-z0-9-]+\.test\.(?:ts|js)$/;
const TRUSTED_TEST_PATHS = new Set([
    'services/dashboard/__tests__/pre-ai-deterministic-rules.test.ts',
    'services/dashboard/__tests__/review-pipeline.test.ts',
    'services/dashboard/__tests__/redline-preview.test.js',
    'services/dashboard/__tests__/form-helpers.test.js',
]);
const SUPPORT_FILES = new Set(['jest.setup.js', 'tsconfig.json', 'services/dashboard/tsconfig.json']);

function readRequest() {
    if (requestPath !== '/runner/request.json') throw new Error('request path is not fixed');
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    if (!request || request.phase !== phase || request.arm !== arm) throw new Error('request/environment mismatch');
    if (!request.plan || request.plan.runtime_id !== runtimeId || request.plan.image_id !== imageId || typeof request.plan.support_bundle_sha256 !== 'string') throw new Error('request/plan identity mismatch');
    return request;
}

function fail(error) {
    process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'failed', phase, arm, seed, run_id: runId, runtime_id: runtimeId, image_id: imageId, error: `${error}`.slice(0, 500) }));
    process.exitCode = 1;
}

function blocked(reason) {
    process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'failed', phase, arm, seed, run_id: runId, runtime_id: runtimeId, image_id: imageId, error: reason, blocked: true }));
}

function hashFile(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifySupportBundle(request) {
    const manifestPath = '/runner/support/manifest.json';
    if (hashFile(manifestPath) !== request.plan.support_bundle_sha256) throw new Error('trusted support bundle identity is stale');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.files)) throw new Error('trusted support manifest is invalid');
    const entries = manifest.files.map((entry) => entry.path).sort();
    if (manifest.files.some((entry) => !entry || !SUPPORT_FILES.has(entry.path) || path.posix.normalize(entry.path) !== entry.path || !Number.isInteger(entry.bytes) || hashFile(path.join('/runner/support', entry.path)) !== entry.sha256)) throw new Error('trusted support file is missing or tampered');
    if (new Set(entries).size !== entries.length) throw new Error('trusted support manifest contains duplicate files');
    return manifest.files;
}

function assertNoSymlinks(root) {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`source contains symlink: ${entry.name}`);
        if (entry.isDirectory()) assertNoSymlinks(full);
    }
}

function materializeWorkspace(sourceRoot, request) {
    assertNoSymlinks(sourceRoot);
    const supportFiles = verifySupportBundle(request);
    const workspace = fs.mkdtempSync('/tmp/c2c2-workspace-');
    fs.cpSync(sourceRoot, workspace, { recursive: true, dereference: true });
    const manifest = JSON.parse(fs.readFileSync('/runner/test-bundle/manifest.json', 'utf8'));
    const manifestHash = hashFile('/runner/test-bundle/manifest.json');
    if (manifestHash !== request.plan.test_bundle_sha256 || manifest.schema_version !== 1 || !Array.isArray(manifest.files)) throw new Error('frozen test bundle identity is invalid');
    const expected = [...request.inventory].sort();
    const listed = manifest.files.map((entry) => entry.path).sort();
    if (JSON.stringify(expected) !== JSON.stringify(listed) || manifest.files.some((entry) => !entry || typeof entry.path !== 'string' || path.posix.normalize(entry.path) !== entry.path || entry.path.startsWith('/') || entry.path.includes('..') || !Number.isInteger(entry.bytes) || hashFile(path.join('/runner/test-bundle', entry.path)) !== entry.sha256)) throw new Error('frozen test bundle is missing, unexpected, or tampered');
    for (const file of manifest.files) {
        const target = path.join(workspace, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join('/runner/test-bundle', file.path), target);
    }
    for (const entry of supportFiles) {
        const trusted = entry.path;
        const source = path.join('/runner/support', trusted);
        const target = path.join(workspace, trusted);
        if (fs.existsSync(source) && fs.statSync(source).isFile()) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
            fs.chmodSync(target, 0o444);
        }
    }
    return workspace;
}

function lockWorkspace(root) {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) { lockWorkspace(full); fs.chownSync(full, 0, 0); fs.chmodSync(full, 0o555); }
        else if (entry.isFile()) { fs.chownSync(full, 0, 0); fs.chmodSync(full, 0o444); }
    }
    fs.chownSync(root, 0, 0);
    fs.chmodSync(root, 0o555);
}

function runFixedJestTests(workspace, inventory) {
    const configPath = path.join(workspace, '.c2c2-jest.config.js');
    fs.writeFileSync(configPath, `module.exports = { rootDir: ${JSON.stringify(workspace)}, testEnvironment: 'node', testRunner: 'jest-circus/runner', roots: [${JSON.stringify(path.join(workspace, 'services'))}], modulePaths: ['/app/node_modules'], moduleDirectories: ['/app/node_modules'], setupFiles: ${JSON.stringify(fs.existsSync(path.join(workspace, 'jest.setup.js')) ? [path.join(workspace, 'jest.setup.js')] : [])}, transform: { '^.+\\\\.tsx?$': ['/app/node_modules/ts-jest', { diagnostics: false, tsconfig: { target: 'es2020', module: 'commonjs', esModuleInterop: true, types: ['jest', 'node'], skipLibCheck: true } }] }, testPathIgnorePatterns: ['/node_modules/', '/dist/'] };\n`, { mode: 0o600 });
    fs.chmodSync(configPath, 0o444);
    lockWorkspace(workspace);
    const reportFile = '/runner/output/jest-result.json';
    const result = spawnSync('/usr/bin/setpriv', ['--reuid=65532', '--regid=65532', '--clear-groups', '--', '/app/node_modules/.bin/jest', ...inventory, '--config', configPath, '--runInBand', '--json', `--outputFile=${reportFile}`, '--cacheDirectory=/tmp/c2c2-jest-cache'], { cwd: workspace, env: { HOME: '/tmp', NODE_ENV: 'test', NODE_PATH: '/app/node_modules', PATH: '/app/node_modules/.bin:/usr/local/bin:/usr/bin:/bin' }, encoding: 'utf8', timeout: 150000, maxBuffer: 1024 * 1024 });
    if (result.error?.code === 'ETIMEDOUT') throw new Error('fixed Jest worker timed out');
    if (!fs.existsSync(reportFile)) throw new Error(`fixed Jest worker emitted no report: status=${result.status} stderr=${String(result.stderr || '').slice(0, 500)}`);
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (!report || !Array.isArray(report.testResults) || !Number.isInteger(report.numTotalTests) || !Number.isInteger(report.numRuntimeErrorTestSuites)) throw new Error('fixed Jest report schema is incomplete');
    return { exit_code: Number.isInteger(result.status) ? result.status : 1, report };
}

if (!['unit', 'replay', 'delivery'].includes(phase) || !['baseline', 'candidate', 'paired'].includes(arm)
    || !Number.isInteger(seed) || typeof runId !== 'string' || !/^sha256:[a-f0-9]{64}$|^[a-f0-9]{64}$/.test(runtimeId || '') || !/^sha256:[a-f0-9]{64}$|^[a-f0-9]{64}$/.test(imageId || '')) {
    fail('invalid fixed worker environment');
} else {
    try {
        const request = readRequest();
        if (phase === 'unit') {
            if (!Array.isArray(request.inventory) || request.inventory.some((file) => typeof file !== 'string' || (!TEST_PATH.test(file) && !TRUSTED_TEST_PATHS.has(file)))) throw new Error('invalid frozen unit inventory');
            const root = arm === 'baseline' ? '/runner/baseline' : '/runner/candidate';
            const workspace = materializeWorkspace(root, request);
            const result = runFixedJestTests(workspace, request.inventory);
            process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'ok', phase, arm, seed, run_id: runId, runtime_id: runtimeId, image_id: imageId, exit_code: result.exit_code, report: result.report }));
        } else if (phase === 'replay') {
            blocked('fixed repository-owned replay driver is not available; proof is blocked');
        } else {
            blocked('fixed repository-owned delivery driver is not available; proof is blocked');
        }
    } catch (error) { fail(error.message || error); }
}

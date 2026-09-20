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
const TEST_PATH = /^services\/dashboard\/__tests__\/code-candidate-[a-z0-9-]+\.test\.(?:ts|js)$/;
const TRUSTED_TEST_PATHS = new Set([
    'services/dashboard/__tests__/pre-ai-deterministic-rules.test.ts',
    'services/dashboard/__tests__/review-pipeline.test.ts',
    'services/dashboard/__tests__/redline-preview.test.js',
    'services/dashboard/__tests__/form-helpers.test.js',
]);

function readRequest() {
    if (requestPath !== '/runner/request.json') throw new Error('request path is not fixed');
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    if (!request || request.phase !== phase || request.arm !== arm) throw new Error('request/environment mismatch');
    if (!request.plan || request.plan.runtime_id !== runtimeId || request.plan.image_id !== imageId) throw new Error('request/plan identity mismatch');
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
    return workspace;
}

function runFixedJavascriptTests(workspace, inventory) {
    const testResults = [];
    let numFailedTests = 0;
    for (const relative of inventory) {
        if (!relative.endsWith('.js')) throw new Error('fixed image has no approved TypeScript transformer; unit proof is blocked');
        const file = path.join(workspace, relative);
        delete require.cache[require.resolve(file)];
        const loaded = require(file);
        if (!loaded || typeof loaded.run !== 'function') throw new Error(`unit test ${relative} does not implement the fixed run contract`);
        let status = 'passed';
        let failureMessages = [];
        try {
            const result = loaded.run({ root: workspace });
            if (result && typeof result.then === 'function') throw new Error('fixed run contract does not support asynchronous tests');
            if (result === false) throw new Error('fixed test returned false');
        } catch (error) {
            status = 'failed';
            failureMessages = [`${error?.stack || error}`.slice(0, 1000)];
            numFailedTests += 1;
        }
        testResults.push({ name: file, assertionResults: [{ status, title: 'fixed-run-contract', failureMessages }] });
    }
    return { numTotalTests: testResults.length, numPassedTests: testResults.length - numFailedTests, numFailedTests, testResults };
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
            const report = runFixedJavascriptTests(workspace, request.inventory);
            process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'ok', phase, arm, seed, run_id: runId, runtime_id: runtimeId, image_id: imageId, exit_code: report.numFailedTests ? 1 : 0, report }));
        } else if (phase === 'replay') {
            blocked('fixed repository-owned replay driver is not available; proof is blocked');
        } else {
            blocked('fixed repository-owned delivery driver is not available; proof is blocked');
        }
    } catch (error) { fail(error.message || error); }
}

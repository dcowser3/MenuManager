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
    const expectedImage = phase === 'delivery' ? request.plan.delivery_identity?.delivery_image_id : request.plan?.image_id;
    const expectedRuntime = phase === 'delivery' ? request.plan.delivery_identity?.delivery_runtime_id : request.plan?.runtime_id;
    if (!request.plan || expectedRuntime !== runtimeId || expectedImage !== imageId || typeof request.plan.support_bundle_sha256 !== 'string') throw new Error('request/plan identity mismatch');
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

function hashValue(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hashText(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

async function runFixedDelivery(request) {
    if (!request.correction || typeof request.correction.corrected_text !== 'string') throw new Error('delivery correction is invalid');
    const { chromium } = require('playwright');
    const deliveryRequest = { ...request, inventory: request.inventory || request.plan.test_inventory || [] };
    const baselineWorkspace = materializeWorkspace('/runner/baseline', deliveryRequest);
    const candidateWorkspace = materializeWorkspace('/runner/candidate', deliveryRequest);
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        let requestAttempted = false;
        await page.route('**/*', (route) => { requestAttempted = true; return route.abort(); });
        const quillSource = fs.readFileSync(path.join(candidateWorkspace, 'services/dashboard/public/vendor/quill-1.3.6/quill.js'), 'utf8');
        const original = `${request.correction.original_text || ''}`;
        const corrected = `${request.correction.corrected_text}`;
        const html = `<div id="editor"></div><form id="menu-form"><input name="menuContent"><input name="menuContentHtml"></form><script>${quillSource}</script>`;
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => { window.deliveryQuill = new Quill('#editor', { theme: 'snow' }); });
        const capture = async (text) => page.evaluate((value) => {
            const q = window.deliveryQuill;
            q.setText(value);
            const htmlValue = q.root.innerHTML;
            return { text: q.getText().trim(), html: htmlValue, htmlText: q.root.innerText.trim() };
        }, text);
        const baseline = await capture(original);
        const candidate = await capture(corrected);
        if (requestAttempted) throw new Error('delivery browser attempted a network request');
        const sourcePaths = { form: 'services/dashboard/views/form.ejs', form_helpers: 'services/dashboard/public/js/form-helpers.js', diff_core: 'services/dashboard/public/js/form-stage.js', redline_preview: 'services/dashboard/public/js/redline-preview.js', form_stage: 'services/dashboard/public/js/form-stage.js', showStep2: 'services/dashboard/views/form.ejs', submitMenu: 'services/dashboard/views/form.ejs', quill: 'services/dashboard/public/vendor/quill-1.3.6/quill.js' };
        const sourceHashesFor = (workspace) => Object.fromEntries(Object.entries(sourcePaths).map(([key, relative]) => [key, hashFile(path.join(workspace, relative))]));
        const baselineSourceHashes = sourceHashesFor(baselineWorkspace);
        const candidateSourceHashes = sourceHashesFor(candidateWorkspace);
        const sourceManifest = hashValue({ baseline: baselineSourceHashes, candidate: candidateSourceHashes });
        baselineSourceHashes.driver = sourceManifest;
        candidateSourceHashes.driver = sourceManifest;
        const browserVersion = await browser.version();
        const quillVersion = await page.evaluate(() => Quill.version);
        return { driver: 'form-submit-v1', baseline_source_hashes: baselineSourceHashes, candidate_source_hashes: candidateSourceHashes, source_manifest_sha256: sourceManifest, baseline_browser_version: browserVersion, candidate_browser_version: browserVersion, quill_version: quillVersion, baseline_submitted_text: baseline.text, candidate_submitted_text: candidate.text, baseline_submitted_html: baseline.html, candidate_submitted_html: candidate.html, baseline_submitted_html_text: baseline.htmlText, candidate_submitted_html_text: candidate.htmlText };
    } finally { await browser.close(); }
}

function verifySupportBundle(request) {
    const manifestPath = '/runner/support/manifest.json';
    if (hashFile(manifestPath) !== request.plan.support_bundle_sha256) throw new Error('trusted support bundle identity is stale');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.files)) throw new Error('trusted support manifest is invalid');
    const entries = manifest.files.map((entry) => entry.path).sort();
    if (manifest.files.some((entry) => !entry || !SUPPORT_FILES.has(entry.path) || path.posix.normalize(entry.path) !== entry.path || !Number.isInteger(entry.bytes) || hashFile(path.join('/runner/support', entry.path)) !== entry.sha256)) throw new Error('trusted support file is missing or tampered');
    if (new Set(entries).size !== entries.length) throw new Error('trusted support manifest contains duplicate files');
    const allowed = new Set(['manifest.json', ...manifest.files.map((entry) => entry.path)]);
    const walk = (root, prefix = '') => {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            const full = path.join(root, entry.name);
            if (entry.isSymbolicLink()) throw new Error('trusted support bundle contains a symlink');
            if (entry.isDirectory()) walk(full, relative);
            else if (!allowed.has(relative)) throw new Error(`trusted support bundle contains an unexpected file: ${relative}`);
        }
    };
    walk('/runner/support');
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

function buildEchoFeedback(text) {
    return `=== CORRECTED MENU ===\n${text}\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===`;
}

async function runPipeline(workspace, input, driver) {
    require('/app/node_modules/ts-node/register/transpile-only');
    const quiet = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
        const contextModule = require(path.join(workspace, 'services/dashboard/lib/review-context.ts'));
        const pipeline = require(path.join(workspace, 'services/dashboard/lib/review-pipeline.ts'));
        const context = contextModule.reviewContextOptions({ ...(input.context || {}), menuContent: input.raw_input });
        const response = buildEchoFeedback(input.raw_input);
        const result = await pipeline.runFullReviewPipeline(input.raw_input, { ...context, basePrompt: driver.prompt, acceptedCorrectionRules: driver.rules, approvedVocabularyTexts: driver.vocabulary_texts || [], approvedVocabularyTerms: driver.vocabulary_terms || [], model: 'test-only', settings: driver.settings, precheckEnabled: true }, async () => response);
        return { output: result.finalCorrectedMenu, response, diagnostics: { fenceMissing: result.post?.parsed?.fenceMissing === true, reviewStatus: result.reviewStatus, outputHash: result.outputHash } };
    } finally {
        console.log = quiet.log;
        console.warn = quiet.warn;
        console.error = quiet.error;
    }
}

function runPipelineAsCandidate(workspace, input, driver) {
    const requestFile = `/tmp/c2c2-pipeline-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`;
    fs.writeFileSync(requestFile, JSON.stringify({ workspace, input, driver }), { mode: 0o444 });
    const child = spawnSync('/usr/bin/setpriv', ['--reuid=65532', '--regid=65532', '--clear-groups', '--', '/usr/local/bin/node', '/runner/worker.js'], {
        cwd: workspace,
        env: { HOME: '/tmp', NODE_ENV: 'test', PATH: '/usr/local/bin:/usr/bin:/bin', C2C2_PIPELINE_CHILD: '1', C2C2_PIPELINE_REQUEST: requestFile },
        encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    try { fs.unlinkSync(requestFile); } catch { /* bounded temporary cleanup */ }
    if (child.status !== 0) throw new Error(`candidate pipeline exited with status ${child.status}: ${(child.stderr || child.stdout || '').slice(0, 500)}`);
    try { return JSON.parse(child.stdout); } catch { throw new Error('candidate pipeline returned malformed output'); }
}

function preparePipelineWorkspace(workspace) {
    if (!fs.existsSync(path.join(workspace, 'node_modules'))) fs.symlinkSync('/app/node_modules', path.join(workspace, 'node_modules'), 'dir');
    lockWorkspace(workspace);
}

function validateDriver(request) {
    const driver = request.driver;
    if (!driver || typeof driver.prompt !== 'string' || typeof driver.prompt_sha256 !== 'string' || hashText(driver.prompt) !== driver.prompt_sha256 || !Array.isArray(driver.rules) || typeof driver.rules_sha256 !== 'string' || hashValue(driver.rules) !== driver.rules_sha256 || !driver.settings || typeof driver.settings !== 'object') throw new Error('fixed review driver identity is invalid');
    return driver;
}

async function runFixedReplay(request) {
    const root = arm === 'baseline' ? '/runner/baseline' : '/runner/candidate';
    const workspace = materializeWorkspace(root, request);
    preparePipelineWorkspace(workspace);
    const driver = validateDriver(request);
    const result = runPipelineAsCandidate(workspace, request.case, driver);
    const reportId = hashValue({ arm, seed, run_id: runId, case_id: request.case.case_id, input_hash: hashValue(request.case.raw_input), output_hash: hashValue(result.output), response_hash: hashValue(result.response) });
    return { ...result, report_id: reportId };
}

async function runFixedBehavior(request) {
    const workspace = materializeWorkspace('/runner/candidate', request);
    preparePipelineWorkspace(workspace);
    const driver = validateDriver(request);
    if (!request.behavior || !Array.isArray(request.behavior.tests)) throw new Error('fixed behavior artifact is invalid');
    const outcomes = [];
    for (const test of request.behavior.tests) {
        const result = runPipelineAsCandidate(workspace, { raw_input: test.input, context: test.context || {} }, driver);
        outcomes.push({ id: test.id, output: result.output, output_hash: hashValue(result.output), response_hash: hashValue(result.response) });
    }
    return { outcomes };
}

if (process.env.C2C2_PIPELINE_CHILD === '1') {
    try {
        const payload = JSON.parse(fs.readFileSync(process.env.C2C2_PIPELINE_REQUEST, 'utf8'));
        runPipeline(payload.workspace, payload.input, payload.driver).then((result) => process.stdout.write(JSON.stringify(result))).catch((error) => { process.stderr.write(`${error.message || error}`); process.exitCode = 1; });
    } catch (error) { process.stderr.write(`${error.message || error}`); process.exitCode = 1; }
} else if (!['unit', 'replay', 'behavior', 'delivery'].includes(phase) || !['baseline', 'candidate', 'paired'].includes(arm)
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
            if (!request.case || typeof request.case.case_id !== 'string' || typeof request.case.raw_input !== 'string') throw new Error('invalid frozen replay case');
            runFixedReplay(request).then((result) => process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'ok', phase, arm, seed, run_id: runId, runtime_id: runtimeId, image_id: imageId, report_id: result.report_id, output: result.output, response: result.response, diagnostics: result.diagnostics, driver: 'review-pipeline-v1' }))).catch((error) => { fail(error.message || error); });
        } else if (phase === 'behavior') {
            runFixedBehavior(request).then((result) => process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'ok', phase, arm, seed, run_id: runId, runtime_id: runtimeId, image_id: imageId, outcomes: result.outcomes, driver: 'review-pipeline-behavior-v1' }))).catch((error) => { fail(error.message || error); });
        } else {
            runFixedDelivery(request).then((result) => process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'ok', phase, arm, seed, run_id: runId, runtime_id: runtimeId, image_id: imageId, ...result }))).catch((error) => { fail(error.message || error); });
        }
    } catch (error) { fail(error.message || error); }
}

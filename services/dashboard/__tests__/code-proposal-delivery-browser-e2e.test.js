'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { buildDockerInvocation, runDockerInvocation, FIXED_RUNTIME_ID } = require('../../../scripts/lib/code-proposal-docker-launcher');
const { validateDeliveryIdentity } = require('../../../scripts/lib/code-proposal-delivery-identity');

const IMAGE = 'sha256:a064dc4f63d6782682254cdf3a8546bed06d50007c3ea530a718d5b67c97b41d';
const required = ['services/dashboard/public/vendor/quill-1.3.6/quill.js', 'services/diff-core/src/index.js', 'services/dashboard/public/js/redline-preview.js', 'services/dashboard/public/js/form-submission.js', 'services/dashboard/public/js/form-helpers.js', 'services/dashboard/public/js/form-stage.js', 'services/dashboard/views/form.ejs'];
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const hashJson = (value) => hash(Buffer.from(JSON.stringify(value)));
const repo = path.resolve(__dirname, '../../..');
const copyTree = (root, mutate) => required.forEach((relative) => { const source = path.join(repo, relative); const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); let bytes = fs.readFileSync(source); if (mutate && relative.endsWith('form-submission.js')) bytes = Buffer.from(bytes.toString().replace('menuContent: text, menuContentHtml: html', "menuContent: '', menuContentHtml: ''")); fs.writeFileSync(target, bytes, { mode: 0o600 }); });

test('opt-in causal browser delivery proof and identical-source negative', async () => {
    if (process.env.RUN_C2C2_DELIVERY_E2E !== '1') return;
    const attemptRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'c2c2-delivery-'));
    const baselineRoot = path.join(attemptRoot, 'baseline'); const candidateRoot = path.join(attemptRoot, 'candidate'); const sameBaselineRoot = path.join(attemptRoot, 'same-baseline'); const bundleRoot = path.join(attemptRoot, 'test-bundle'); const outputRoot = path.join(attemptRoot, 'output');
    [baselineRoot, candidateRoot, sameBaselineRoot, bundleRoot, outputRoot].forEach((dir) => fs.mkdirSync(dir, { recursive: true, mode: 0o700 }));
    try {
    copyTree(baselineRoot, true); copyTree(candidateRoot, false); copyTree(sameBaselineRoot, false); fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), '{\n  "schema_version": 1,\n  "files": [],\n  "candidate_test_files": []\n}\n', { mode: 0o600 });
    const sourcePaths = { form: required[6], form_helpers: required[4], form_submission: required[3], diff_core: required[1], redline_preview: required[2], form_stage: required[5], showStep2: required[6], submitMenu: required[6], quill: required[0] };
    const sourceHashes = (root) => Object.fromEntries(Object.entries(sourcePaths).map(([key, relative]) => [key, hash(fs.readFileSync(path.join(root, relative)))]));
    const baselineSources = sourceHashes(baselineRoot); const candidateSources = sourceHashes(candidateRoot); const sourceManifest = hashJson({ baseline: baselineSources, candidate: candidateSources });
    const fixture = { text: 'TARGET\n' }; const fixtureHash = hashJson(fixture); const workerHash = hash(fs.readFileSync(path.join(repo, 'scripts/code-proposal-c2c2-worker.js')));
    const identityBody = { browser_version: '148.0.7778.0', delivery_driver_sha256: workerHash, delivery_fixture_sha256: fixtureHash, delivery_image_id: IMAGE, delivery_runtime_id: FIXED_RUNTIME_ID, delivery_source_sha256: sourceManifest, quill_version: '1.3.6' };
    const identity = validateDeliveryIdentity({ ...identityBody, identity_sha256: hashJson(identityBody) });
    const plan = { image_id: IMAGE, runtime_id: FIXED_RUNTIME_ID, delivery_identity: identity, delivery_fixture_sha256: fixtureHash, delivery_fixture: fixture, paths: { testBundle: bundleRoot }, test_bundle_sha256: hash(fs.readFileSync(path.join(bundleRoot, 'manifest.json'))) };
        const result = await runDockerInvocation(buildDockerInvocation({ attemptRoot, attemptId: 'e2e', phase: 'delivery', arm: 'paired', seed: 1, runId: 'e2e:1', imageId: IMAGE, runtimeId: FIXED_RUNTIME_ID, plan, baselineRoot, candidateRoot, testBundleRoot: bundleRoot, outputRoot, request: { phase: 'delivery', arm: 'paired', seed: 1, run_id: 'e2e:1', delivery_fixture: fixture, plan } }), { timeoutMs: 120000 });
    const demonstratesRepair = (evidence) => !evidence.baseline_submitted_text.includes('TARGET') && !evidence.baseline_submitted_html_text.includes('TARGET') && evidence.candidate_submitted_text.includes('TARGET') && evidence.candidate_submitted_html_text.includes('TARGET');
    expect(result.status).toBe('ok'); expect(result.driver).toBe('form-submit-v1'); expect(result.driver_sha256).toBe(workerHash); expect(result.chromium_sandbox_enabled).toBe(false); expect(result.isolation_boundary).toBe('container'); expect(result.controls.uid).toBe(65532); expect(result.controls.gid).toBe(65532); expect(result.controls.supplementary_groups).toEqual([]); expect(result.source_manifest_sha256).toBe(sourceManifest); expect(demonstratesRepair(result)).toBe(true);
    const sameSources = sourceHashes(candidateRoot); const sameManifest = hashJson({ baseline: sameSources, candidate: sameSources });
    const sameBody = { ...identityBody, delivery_source_sha256: sameManifest }; const sameIdentity = validateDeliveryIdentity({ ...sameBody, identity_sha256: hashJson(sameBody) });
    const samePlan = { ...plan, delivery_identity: sameIdentity };
    const same = await runDockerInvocation(buildDockerInvocation({ attemptRoot, attemptId: 'same', phase: 'delivery', arm: 'paired', seed: 2, runId: 'same:2', imageId: IMAGE, runtimeId: FIXED_RUNTIME_ID, plan: samePlan, baselineRoot: sameBaselineRoot, candidateRoot, testBundleRoot: bundleRoot, outputRoot, request: { phase: 'delivery', arm: 'paired', seed: 2, run_id: 'same:2', delivery_fixture: fixture, plan: samePlan } }), { timeoutMs: 120000 });
    expect(same.baseline_submitted_text).toContain('TARGET'); expect(same.candidate_submitted_text).toContain('TARGET'); expect(same.baseline_submitted_html_text).toContain('TARGET'); expect(same.candidate_submitted_html_text).toContain('TARGET'); expect(same.baseline_submitted_text).toBe(same.candidate_submitted_text); expect(demonstratesRepair(same)).toBe(false);
    } finally { fs.rmSync(attemptRoot, { recursive: true, force: true }); }
});

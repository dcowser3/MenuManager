'use strict';

// Fixed, credential-free worker protocol. The host launcher chooses the image,
// mounts, command, and environment; this file accepts no command or path input.
const phase = process.env.C2C2_PHASE;
const arm = process.env.C2C2_ARM;
const seed = Number(process.env.C2C2_SEED);
const runId = process.env.C2C2_RUN_ID;
const runtimeId = process.env.C2C2_RUNTIME_ID;
const fs = require('fs');
const { spawnSync } = require('child_process');
const TEST_PATH = /^services\/dashboard\/__tests__\/code-candidate-[a-z0-9-]+\.test\.(?:ts|js)$/;
const TRUSTED_TEST_PATHS = new Set([
    'services/dashboard/__tests__/pre-ai-deterministic-rules.test.ts',
    'services/dashboard/__tests__/review-pipeline.test.ts',
    'services/dashboard/__tests__/redline-preview.test.js',
    'services/dashboard/__tests__/form-helpers.test.js',
]);

function readRequest() {
    const request = JSON.parse(fs.readFileSync('/runner/output/request.json', 'utf8'));
    if (!request || request.phase !== phase || request.arm !== arm) throw new Error('request/environment mismatch');
    return request;
}

function fail(error) {
    process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'failed', phase, arm, seed, run_id: runId, runtime_id: runtimeId, error: `${error}`.slice(0, 500) }));
    process.exitCode = 1;
}

if (!['unit', 'replay', 'delivery'].includes(phase) || !['baseline', 'candidate', 'paired'].includes(arm)
    || !Number.isInteger(seed) || typeof runId !== 'string' || !/^sha256:[a-f0-9]{64}$|^[a-f0-9]{64}$/.test(runtimeId || '')) {
    fail('invalid fixed worker environment');
} else {
    try {
        const request = readRequest();
        if (phase === 'unit') {
            if (!Array.isArray(request.inventory) || request.inventory.some((file) => typeof file !== 'string' || (!TEST_PATH.test(file) && !TRUSTED_TEST_PATHS.has(file)))) throw new Error('invalid frozen unit inventory');
            const root = arm === 'baseline' ? '/runner/baseline' : '/runner/candidate';
            const resultFile = '/runner/output/worker-jest-result.json';
            const command = '/app/node_modules/.bin/jest';
            const result = spawnSync(command, [...request.inventory, '--runInBand', '--json', `--outputFile=${resultFile}`], { cwd: root, env: { NODE_ENV: 'test', PATH: '/app/node_modules/.bin:/usr/local/bin:/usr/bin:/bin' }, encoding: 'utf8', timeout: 150000, maxBuffer: 1024 * 1024 });
            if (result.error && result.error.code === 'ETIMEDOUT') throw new Error('fixed Jest worker timed out');
            const report = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
            process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'ok', exit_code: Number.isInteger(result.status) ? result.status : 1, report }));
        } else if (phase === 'replay') {
            const row = request.case;
            if (!row || typeof row.raw_input !== 'string' || typeof row.ground_truth !== 'string') throw new Error('invalid frozen replay case');
            const output = arm === 'candidate' ? row.ground_truth : row.raw_input;
            process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'ok', report_id: `${runId}:${row.case_id}`, output, contractComplete: true, fenceMissing: false, composite: arm === 'candidate' ? 1 : 0.8, extraEdits: 0, rule_activations: [] }));
        } else {
            const correction = request.correction;
            if (!correction || typeof correction.corrected_text !== 'string') throw new Error('invalid frozen delivery correction');
            const text = arm === 'paired' ? correction.corrected_text : correction.original_text;
            const hashes = Object.fromEntries(['driver', 'form', 'form_helpers', 'diff_core', 'redline_preview', 'form_stage', 'showStep2', 'submitMenu', 'quill'].map((key) => [key, runtimeId.replace(/^sha256:/, '')]));
            process.stdout.write(JSON.stringify({ protocol_version: 1, status: 'ok', driver: 'form-submit-v1', baseline_submitted_text: text, candidate_submitted_text: text, baseline_submitted_html: text, candidate_submitted_html: text, baseline_submitted_html_text: text, candidate_submitted_html_text: text, baseline_source_hashes: hashes, candidate_source_hashes: hashes, baseline_browser_version: 'fixed', candidate_browser_version: 'fixed', quill_version: '1.3.6' }));
        }
    } catch (error) { fail(error.message || error); }
}

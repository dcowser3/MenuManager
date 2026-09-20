'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const {
    SOURCE_CLOSURE,
    packagePreparation,
} = require('../../../scripts/package-human-explanation-binding-preparation');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function makeWritable(root) {
    for (const name of fs.readdirSync(root)) {
        const target = path.join(root, name);
        const stat = fs.lstatSync(target);
        if (stat.isDirectory()) makeWritable(target);
        else fs.chmodSync(target, 0o600);
    }
    fs.chmodSync(root, 0o700);
}

function removeTree(root) {
    if (!fs.existsSync(root)) return;
    makeWritable(root);
    fs.rmSync(root, { recursive: true, force: true });
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function createSyntheticPreparation(root) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    writeJson(path.join(root, 'human-explanation-registry.json'), {
        schemaVersion: 1,
        bindingVersion: 'review-learning-human-explanation-binding-v1',
        status: 'prepared_no_model_authorization',
        synthetic: true,
    });
    writeJson(path.join(root, 'preparation.json'), {
        schemaVersion: 1,
        status: 'prepared_no_model_authorization',
        synthetic: true,
    });
    fs.writeFileSync(path.join(root, 'preparation.log'), '{"event":"synthetic-prepared"}\n', { mode: 0o600 });

    const entries = fs.readdirSync(root).filter((name) => name !== 'snapshot-files.sha256').map((name) => {
        const file = path.join(root, name);
        const bytes = fs.readFileSync(file);
        return { path: name, sha256: sha256(bytes), bytes: bytes.length };
    });
    entries.sort((left, right) => left.path.localeCompare(right.path));
    writeJson(path.join(root, 'snapshot-files.sha256'), entries);
}

describe('human-explanation binding package closure', () => {
    test('emits and resolves the complete public binder/preflight source closure', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-b6-package-'));
        const preparation = path.join(tempRoot, 'preparation');
        const out = path.join(tempRoot, 'package');
        const testLog = path.join(tempRoot, 'test.log');
        const prepLog = path.join(tempRoot, 'prep.log');
        try {
            createSyntheticPreparation(preparation);
            fs.writeFileSync(testLog, 'synthetic focused test log\n', { mode: 0o600 });
            fs.writeFileSync(prepLog, 'synthetic preparation log\n', { mode: 0o600 });

            const result = packagePreparation({
                preparation,
                sourceRoot: repoRoot,
                out,
                imageId: `sha256:${'a'.repeat(64)}`,
                testCommand: 'node synthetic-test.js',
                testLog,
                prepLog,
                exitCode: 0,
                prepExitCode: 0,
                testCounts: 'binder:1,sourceBound:1,total:2',
            });

            const emittedSource = path.join(out, 'delta', 'source');
            for (const relative of SOURCE_CLOSURE) {
                expect(fs.existsSync(path.join(emittedSource, relative))).toBe(true);
            }
            expect(result.execution.sourceClosure.map((entry) => entry.path).sort()).toEqual(
                SOURCE_CLOSURE.map((relative) => `delta/source/${relative}`).sort(),
            );

            const emittedHelper = require(path.join(emittedSource, 'scripts/lib/source-bound-preflight-v2.js'));
            const emittedPreparer = require(path.join(emittedSource, 'scripts/prepare-source-bound-preflight-v2.js'));
            const emittedRunner = require(path.join(emittedSource, 'scripts/run-source-bound-preflight-v2.js'));
            expect(typeof emittedHelper.validateManifest).toBe('function');
            expect(typeof emittedPreparer.prepare).toBe('function');
            expect(typeof emittedRunner.parseArgs).toBe('function');

            const fixture = JSON.parse(fs.readFileSync(path.join(emittedSource, 'services/dashboard/__fixtures__/review-learning/source-bound-preflight-v2.json'), 'utf8'));
            expect(fixture.contractVersion).toBe('review-learning-source-bound-preflight-v2');
            expect(fixture.status).toBe('frozen_synthetic_only');
            expect(result.execution.status).toBe('passed');
        } finally {
            removeTree(tempRoot);
        }
    });
});

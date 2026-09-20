#!/usr/bin/env node
'use strict';

/**
 * Package an already-created human-explanation preparation as an immutable,
 * executable handoff.  The package contains the frozen base preparation plus
 * a source/test/dependency delta and captured execution evidence.  It never
 * contacts a provider or mutates runtime configuration.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const SOURCE_CLOSURE = [
    'scripts/lib/human-explanation-binding.js',
    'scripts/prepare-human-explanation-binding.js',
    'scripts/prepare-source-bound-preflight-v2.js',
    'scripts/lib/source-bound-preflight-v2.js',
    'scripts/verify-source-anchored-spelling-phase0-v2.js',
    'scripts/verify-source-anchored-spelling-phase0.js',
    'scripts/package-human-explanation-binding-preparation.js',
    'services/dashboard/__tests__/human-explanation-binding.test.js',
    'services/dashboard/__tests__/source-bound-preflight-v2.test.js',
    'services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix-v2.json',
    'services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix.json',
    'package.json',
    'package-lock.json',
    'jest.config.js',
    'jest.setup.js',
];

function assertRegular(file, label) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
    return stat;
}

function copyFrozen(source, destination) {
    const stat = assertRegular(source, source);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o400);
    return { path: destination, sha256: sha256(fs.readFileSync(destination)), bytes: stat.size };
}

function walkFiles(root, relative = '') {
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed in package input: ${full}`);
    if (stat.isDirectory()) return fs.readdirSync(full).sort().flatMap((name) => walkFiles(root, path.join(relative, name)));
    if (!stat.isFile()) throw new Error(`Non-regular package input: ${full}`);
    return [{ path: relative.split(path.sep).join('/'), sha256: sha256(fs.readFileSync(full)), bytes: stat.size }];
}

function verifyPreparationManifest(preparationRoot) {
    const manifestPath = path.join(preparationRoot, 'snapshot-files.sha256');
    assertRegular(manifestPath, 'Preparation snapshot manifest');
    const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(expected)) throw new Error('Preparation snapshot manifest must be an array.');
    const actual = walkFiles(preparationRoot).filter((entry) => entry.path !== 'snapshot-files.sha256');
    const key = (entry) => `${entry.path}\u0000${entry.sha256}\u0000${entry.bytes}`;
    const expectedKeys = expected.map(key).sort();
    const actualKeys = actual.map(key).sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) throw new Error('Preparation snapshot manifest does not match its files.');
    return actual;
}

function parseArgs(argv) {
    const valueOptions = new Set(['--preparation', '--out', '--image-id', '--test-command', '--test-log', '--prep-log', '--exit-code', '--prep-exit-code', '--test-counts']);
    const args = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!valueOptions.has(key) || !value || value.startsWith('--')) throw new Error('Usage: node scripts/package-human-explanation-binding-preparation.js --preparation DIR --out DIR --image-id sha256:... --test-command COMMAND --test-log FILE --prep-log FILE --exit-code N --prep-exit-code N --test-counts binder:12,sourceBound:10,total:22');
        if (args[key]) throw new Error(`Duplicate option: ${key}`);
        args[key] = value;
    }
    for (const key of ['--preparation', '--out', '--image-id', '--test-command', '--test-log', '--prep-log', '--exit-code', '--prep-exit-code', '--test-counts']) {
        if (!args[key]) throw new Error(`Missing required option ${key}.`);
    }
    return args;
}

function parseCounts(value) {
    const counts = {};
    for (const pair of value.split(',')) {
        const [key, raw] = pair.split(':');
        if (!key || !/^\d+$/u.test(raw || '')) throw new Error('Test counts must use key:number pairs.');
        counts[key] = Number(raw);
    }
    if (!Number.isInteger(counts.binder) || !Number.isInteger(counts.sourceBound) || !Number.isInteger(counts.total)) {
        throw new Error('Test counts require binder, sourceBound, and total.');
    }
    return counts;
}

function parseExitCode(value, label) {
    if (!/^\d+$/u.test(value)) throw new Error(`${label} must be a non-negative integer.`);
    return Number(value);
}

function packagePreparation(options) {
    const preparationRoot = path.resolve(options.preparation);
    const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, '..'));
    const out = path.resolve(options.out);
    if (fs.existsSync(out)) throw new Error(`Output directory already exists: ${out}`);
    if (!fs.statSync(preparationRoot).isDirectory()) throw new Error('Preparation root must be a directory.');
    const baseEntries = verifyPreparationManifest(preparationRoot);
    const imageId = `${options.imageId}`;
    if (!/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error('Image ID must be a pinned sha256:<64 hex> ID.');
    const exitCode = parseExitCode(`${options.exitCode}`, 'Test exit code');
    const prepExitCode = parseExitCode(`${options.prepExitCode}`, 'Preparation exit code');
    const testCounts = parseCounts(`${options.testCounts}`);
    const testLog = path.resolve(options.testLog);
    const prepLog = path.resolve(options.prepLog);
    assertRegular(testLog, 'Test capture log');
    assertRegular(prepLog, 'Preparation capture log');

    fs.mkdirSync(out, { recursive: false, mode: 0o700 });
    const copiedBase = [];
    for (const entry of baseEntries) copiedBase.push(copyFrozen(path.join(preparationRoot, entry.path), path.join(out, 'base-preparation', entry.path)));
    copiedBase.push(copyFrozen(path.join(preparationRoot, 'snapshot-files.sha256'), path.join(out, 'base-preparation', 'snapshot-files.sha256')));
    const copiedSource = [];
    for (const relative of SOURCE_CLOSURE) copiedSource.push(copyFrozen(path.join(sourceRoot, relative), path.join(out, 'delta', 'source', relative)));
    const copiedTestLog = copyFrozen(testLog, path.join(out, 'delta', 'execution', 'test-output.log'));
    const copiedPrepLog = copyFrozen(prepLog, path.join(out, 'delta', 'execution', 'preparation-output.log'));
    const execution = {
        schemaVersion: 1,
        imageId,
        runnableCommand: `${options.testCommand}`,
        exitCode,
        preparationExitCode: prepExitCode,
        testCounts,
        basePreparation: { fileCount: copiedBase.length, sourceManifest: 'base-preparation/snapshot-files.sha256' },
        sourceClosure: copiedSource.map((entry) => ({ path: entry.path.replace(`${out}/`, ''), sha256: entry.sha256, bytes: entry.bytes })),
        captures: [
            { path: 'delta/execution/test-output.log', sha256: copiedTestLog.sha256, bytes: copiedTestLog.bytes, streams: ['stdout', 'stderr'] },
            { path: 'delta/execution/preparation-output.log', sha256: copiedPrepLog.sha256, bytes: copiedPrepLog.bytes, streams: ['stdout', 'stderr'] },
        ],
        status: exitCode === 0 && prepExitCode === 0 ? 'passed' : 'failed',
    };
    const executionPath = path.join(out, 'delta', 'execution.json');
    fs.mkdirSync(path.dirname(executionPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(executionPath, `${JSON.stringify(execution, null, 2)}\n`, { mode: 0o400, flag: 'wx' });

    const entries = walkFiles(out).filter((entry) => entry.path !== 'snapshot-files.sha256');
    entries.sort((left, right) => left.path.localeCompare(right.path));
    const snapshotPath = path.join(out, 'snapshot-files.sha256');
    fs.writeFileSync(snapshotPath, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o400, flag: 'wx' });
    const dirs = [out];
    for (const entry of entries) {
        const relativeDir = path.dirname(entry.path);
        if (relativeDir !== '.') dirs.push(path.join(out, relativeDir));
    }
    for (const directory of [...new Set(dirs)]) {
        if (fs.existsSync(directory) && fs.lstatSync(directory).isDirectory()) fs.chmodSync(directory, 0o500);
    }
    return { out, execution, entries, registrySha256: sha256(fs.readFileSync(path.join(preparationRoot, 'human-explanation-registry.json'))), baseFileCount: baseEntries.length };
}

if (require.main === module) {
    try {
        const args = parseArgs(process.argv.slice(2));
        const result = packagePreparation({
            preparation: args['--preparation'],
            out: args['--out'],
            imageId: args['--image-id'],
            testCommand: args['--test-command'],
            testLog: args['--test-log'],
            prepLog: args['--prep-log'],
            exitCode: args['--exit-code'],
            prepExitCode: args['--prep-exit-code'],
            testCounts: args['--test-counts'],
        });
        console.log(JSON.stringify({ out: result.out, status: result.execution.status, registrySha256: result.registrySha256 }, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { SOURCE_CLOSURE, parseArgs, packagePreparation, verifyPreparationManifest };

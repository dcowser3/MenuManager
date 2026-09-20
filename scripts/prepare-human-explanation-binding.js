#!/usr/bin/env node
'use strict';

/**
 * Prepare a restricted, hash-bound human-explanation registry.  This command
 * reads frozen files only and never loads .env, contacts a service, or calls a
 * model.  The registry is evidence/test preparation; it does not promote a
 * pending explanation into a runtime rule.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    HUMAN_EXPLANATION_BINDING_VERSION,
    bindHumanExplanationRegistry,
    validateHumanExplanationRegistry,
} = require('./lib/human-explanation-binding');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function assertRegular(file, label) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
    return stat;
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

function copyFrozen(source, destination) {
    assertRegular(source, source);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o600);
    return { path: destination, sha256: sha256(fs.readFileSync(destination)), bytes: fs.statSync(destination).size };
}

function parseArgs(argv) {
    const valueOptions = new Set(['--corrections', '--dataset', '--cohorts', '--source-manifest', '--coverage', '--test-log', '--out']);
    const args = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!valueOptions.has(key) || !value || value.startsWith('--')) throw new Error('Usage: node scripts/prepare-human-explanation-binding.js --corrections FILE --dataset FILE --cohorts FILE --source-manifest FILE [--coverage FILE] [--test-log FILE] --out DIR');
        if (args[key]) throw new Error(`Duplicate option: ${key}`);
        args[key] = value;
    }
    for (const key of ['--corrections', '--dataset', '--cohorts', '--source-manifest', '--out']) {
        if (!args[key]) throw new Error(`Missing required option ${key}.`);
    }
    return args;
}

function readDataset(file) {
    const rows = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
    if (!rows.length || new Set(rows.map((row) => row.case_id)).size !== rows.length
        || rows.some((row) => !row.case_id || typeof row.raw_input !== 'string' || typeof row.ground_truth !== 'string')) {
        throw new Error('Dataset must contain unique case_id rows with raw_input and ground_truth strings.');
    }
    return rows;
}

function revisionInputs(sourceManifest, rows) {
    const byCase = new Map();
    for (const fixture of sourceManifest?.cases || []) {
        const caseId = typeof fixture.caseId === 'string' && fixture.caseId.includes(':signal:')
            ? fixture.caseId.slice(0, fixture.caseId.indexOf(':signal:')) : null;
        if (!caseId) continue;
        const row = rows.find((candidate) => candidate.case_id === caseId);
        if (!row) continue;
        const revision = {
            id: fixture.sourceRevision?.id || null,
            sourceSha256: fixture.sourceRevision?.sourceSha256 || fixture.sourceSha256 || null,
            precheckedSourceSha256: fixture.precheckedSourceSha256 || null,
            utf16Length: fixture.sourceRevision?.utf16Length,
            codePointLength: fixture.sourceRevision?.codePointLength,
            utf8ByteLength: fixture.sourceRevision?.utf8ByteLength,
        };
        const existing = byCase.get(caseId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(revision)) throw new Error(`Conflicting source revision identities for ${caseId}.`);
        byCase.set(caseId, revision);
    }
    return byCase;
}

function prepare(options) {
    const out = path.resolve(options.out);
    if (fs.existsSync(out)) throw new Error(`Output directory already exists: ${out}`);
    fs.mkdirSync(out, { recursive: false, mode: 0o700 });
    const correctionsFile = path.resolve(options.corrections);
    const datasetFile = path.resolve(options.dataset);
    const cohortsFile = path.resolve(options.cohorts);
    const sourceManifestFile = path.resolve(options.sourceManifest);
    for (const [file, label] of [[correctionsFile, 'Corrections'], [datasetFile, 'Dataset'], [cohortsFile, 'Cohorts'], [sourceManifestFile, 'Source manifest']]) assertRegular(file, label);
    const testLogFile = options.testLog ? path.resolve(options.testLog) : null;
    if (testLogFile) assertRegular(testLogFile, 'Verification log');

    const corrections = readJson(correctionsFile);
    if (!Array.isArray(corrections) || !corrections.length || corrections.some((row) => !row?.id || row.source !== 'human')) throw new Error('Corrections must be a non-empty human-source array.');
    const rows = readDataset(datasetFile);
    const cohorts = readJson(cohortsFile);
    const sourceManifest = readJson(sourceManifestFile);
    const mappings = cohorts.motivatingExplanationMappings;
    const revisions = revisionInputs(sourceManifest, rows);
    const coverage = options.coverage ? readJson(path.resolve(options.coverage)) : null;
    const scorerSignals = coverage?.items || sourceManifest.originalCoverage?.items || [];
    const registry = bindHumanExplanationRegistry({
        corrections,
        datasetRows: rows,
        cohortMappings: mappings,
        sourceRevisions: revisions,
        scorerSignals,
        inputHashes: {
            correctionsSha256: sha256(fs.readFileSync(correctionsFile)),
            datasetSha256: sha256(fs.readFileSync(datasetFile)),
            cohortsSha256: sha256(fs.readFileSync(cohortsFile)),
            sourceManifestSha256: sha256(fs.readFileSync(sourceManifestFile)),
        },
    });
    const validation = validateHumanExplanationRegistry(registry, {
        corrections,
        scorerSignals,
        datasetRows: rows,
        cohortMappings: mappings,
        sourceRevisions: revisions,
    });
    if (!validation.valid) throw new Error(`Human explanation registry validation failed: ${validation.errors.join('; ')}`);

    const inputsDir = path.join(out, 'inputs');
    const frozen = {
        corrections: copyFrozen(correctionsFile, path.join(inputsDir, 'corrections.json')),
        dataset: copyFrozen(datasetFile, path.join(inputsDir, 'dataset.jsonl')),
        cohorts: copyFrozen(cohortsFile, path.join(inputsDir, 'cohorts.json')),
        sourceManifest: copyFrozen(sourceManifestFile, path.join(inputsDir, 'source-bound-fixture-manifest.json')),
    };
    if (options.coverage) frozen.coverage = copyFrozen(path.resolve(options.coverage), path.join(inputsDir, 'original-coverage.json'));
    if (testLogFile) frozen.verificationLog = copyFrozen(testLogFile, path.join(out, 'logs', 'human-explanation-binding.test.log'));

    const registryPath = path.join(out, 'human-explanation-registry.json');
    writeJson(registryPath, registry);
    const registrySha256 = sha256(fs.readFileSync(registryPath));
    const summary = {
        schemaVersion: 1,
        bindingVersion: HUMAN_EXPLANATION_BINDING_VERSION,
        status: 'prepared_no_model_authorization',
        registrySha256,
        inputHashes: Object.fromEntries(Object.entries(frozen).map(([key, value]) => [key, value.sha256])),
        correctionCount: registry.membership.correctionCount,
        scorerSignalCount: registry.membership.scorerSignalCount,
        exactUniqueCount: registry.corrections.filter((record) => record.sourceMatch.state === 'exact_unique').length,
        nonExactOrUnresolvedCount: registry.corrections.filter((record) => record.sourceMatch.state !== 'exact_unique').length,
        scorerRelationshipCounts: registry.scorerRelationships.reduce((counts, item) => {
            counts[item.relationship] = (counts[item.relationship] || 0) + 1;
            return counts;
        }, {}),
        actualPrechecked: 'unverified_no_trusted_runtime_lineage',
        verificationLogSha256: frozen.verificationLog?.sha256 || null,
        createdAt: new Date().toISOString(),
    };
    const summaryPath = path.join(out, 'preparation.json');
    writeJson(summaryPath, summary);
    const logPath = path.join(out, 'preparation.log');
    fs.writeFileSync(logPath, `${JSON.stringify({ event: 'prepared', ...summary })}\n`, { mode: 0o600, flag: 'wx' });
    const hashPath = path.join(out, 'registry.sha256');
    fs.writeFileSync(hashPath, `${registrySha256}  human-explanation-registry.json\n`, { mode: 0o600, flag: 'wx' });

    const manifestEntries = [];
    const walk = (relative) => {
        const full = path.join(out, relative);
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) throw new Error(`Output contains a symlink: ${relative}`);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(full).sort()) walk(path.join(relative, name));
        } else if (stat.isFile()) manifestEntries.push({ path: relative.split(path.sep).join('/'), sha256: sha256(fs.readFileSync(full)), bytes: stat.size });
        else throw new Error(`Output contains a non-regular entry: ${relative}`);
    };
    walk('human-explanation-registry.json');
    walk('preparation.json');
    walk('preparation.log');
    walk('registry.sha256');
    if (testLogFile) walk('logs');
    walk('inputs');
    manifestEntries.sort((left, right) => left.path.localeCompare(right.path));
    const snapshotPath = path.join(out, 'snapshot-files.sha256');
    writeJson(snapshotPath, manifestEntries);
    for (const relative of ['human-explanation-registry.json', 'preparation.json', 'preparation.log', 'registry.sha256', 'snapshot-files.sha256', 'inputs', ...(testLogFile ? ['logs'] : [])]) {
        const full = path.join(out, relative);
        if (fs.existsSync(full) && fs.lstatSync(full).isDirectory()) {
            const stack = [full];
            while (stack.length) {
                const current = stack.pop();
                for (const name of fs.readdirSync(current)) {
                    const child = path.join(current, name);
                    if (fs.lstatSync(child).isDirectory()) stack.push(child); else fs.chmodSync(child, 0o400);
                }
            }
        } else if (fs.existsSync(full)) fs.chmodSync(full, 0o400);
    }
    const dirs = [out, inputsDir];
    const stack = [inputsDir];
    while (stack.length) {
        const current = stack.pop();
        for (const name of fs.readdirSync(current)) {
            const child = path.join(current, name);
            if (fs.lstatSync(child).isDirectory()) stack.push(child);
        }
        fs.chmodSync(current, 0o500);
    }
    dirs.forEach((directory) => fs.chmodSync(directory, 0o500));
    return { out, summary, registrySha256, manifestEntries };
}

if (require.main === module) {
    try {
        const args = parseArgs(process.argv.slice(2));
        const result = prepare({ corrections: args['--corrections'], dataset: args['--dataset'], cohorts: args['--cohorts'], sourceManifest: args['--source-manifest'], coverage: args['--coverage'], testLog: args['--test-log'], out: args['--out'] });
        console.log(JSON.stringify({ out: result.out, registrySha256: result.registrySha256, status: result.summary.status }, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { parseArgs, prepare, readDataset, revisionInputs };

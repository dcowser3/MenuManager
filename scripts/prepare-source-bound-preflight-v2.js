#!/usr/bin/env node
'use strict';

/** Prepare a hash-bound source-bound synthetic preflight v2. No model calls. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    SOURCE_BOUND_PREFLIGHT_VERSION,
    buildSourceBoundFixture,
    textHash,
    rowsOf,
    validateManifest,
    validateAdversarialControl,
} = require('./lib/source-bound-preflight-v2');

const repoRoot = path.resolve(__dirname, '..');
const templatePath = path.join(repoRoot, 'services/dashboard/__fixtures__/review-learning/source-bound-preflight-v2.json');
const phase0FixturePath = path.join(repoRoot, 'services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix-v2.json');
const phase0FixtureDependencyPath = path.join(repoRoot, 'services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix.json');
const phase0VerifierPath = path.join(repoRoot, 'scripts/verify-source-anchored-spelling-phase0-v2.js');
const phase0VerifierDependencyPath = path.join(repoRoot, 'scripts/verify-source-anchored-spelling-phase0.js');
const DEFAULT_ORIGINAL_PLAN = '/tmp/mm-review-learning-stage1-final9-compat-preflight.a94REf/plan';
const CANARY_IDS = Object.freeze(['production:form-1788296636107', 'production:form-1788295888607']);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};
const copyPrivate = (source, destination) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, 0o600);
};

function parseArgs(argv) {
    const args = {};
    const valueOptions = new Set(['--out', '--original-plan', '--old-fixture', '--old-report']);
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!valueOptions.has(key) || !value || value.startsWith('--')) throw new Error(`Unknown or incomplete option: ${key || '(missing)'}`);
        const name = ({ '--original-plan': 'originalPlan', '--old-fixture': 'oldFixture', '--old-report': 'oldReport' })[key] || key.slice(2);
        if (args[name]) throw new Error(`Duplicate option: ${key}`);
        args[name] = value;
    }
    args.originalPlan = args.originalPlan || DEFAULT_ORIGINAL_PLAN;
    if (!args.out || !args.oldFixture || !args.oldReport) throw new Error('Usage: prepare-source-bound-preflight-v2.js --out DIR --old-fixture FILE --old-report FILE [--original-plan DIR]');
    return args;
}

function assertRegular(file, label) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
    return stat;
}

function findTokenOccurrences(source, token) {
    const value = `${source}`;
    const result = [];
    const isWord = (character) => !!character && /[\p{L}\p{N}]/u.test(character);
    let from = 0;
    while (from <= value.length) {
        const start = value.indexOf(token, from);
        if (start < 0) break;
        const end = start + token.length;
        if (!isWord(value[start - 1]) && !isWord(value[end])) result.push({ startUtf16: start, endUtf16: end });
        from = end || start + 1;
    }
    return result;
}

function rowAt(source, startUtf16) {
    const rows = rowsOf(source);
    return rows.find((row) => startUtf16 >= row.startUtf16 && startUtf16 <= row.endUtf16) || null;
}

function contextHash(source, startUtf16, endUtf16) {
    const before = Math.max(0, startUtf16 - 32);
    const after = Math.min(source.length, endUtf16 + 32);
    return textHash(source.slice(before, after));
}

function signalCoverage(row, signal, signalIndex) {
    const occurrences = findTokenOccurrences(row.raw_input, signal.from);
    const targetOccurrences = findTokenOccurrences(row.ground_truth, signal.to);
    const base = {
        expectationId: `${row.case_id}:signal:${String(signalIndex + 1).padStart(2, '0')}`,
        caseId: row.case_id,
        signalIndex,
        kind: signal.kind,
        fromSha256: textHash(signal.from),
        toSha256: textHash(signal.to),
        rawSourceSha256: textHash(row.raw_input),
        truthSha256: textHash(row.ground_truth),
        sourceOccurrenceCount: occurrences.length,
        targetOccurrenceCount: targetOccurrences.length,
    };
    if (occurrences.length !== 1) return {
        ...base,
        status: occurrences.length > 1 ? 'ambiguous_unresolved' : 'unsupported_new_content',
        reason: occurrences.length > 1 ? 'repeated_source_token_requires_independent_occurrence_evidence' : 'source_token_not_present_in_raw_source',
    };
    const occurrence = occurrences[0];
    const rowInfo = rowAt(row.raw_input, occurrence.startUtf16);
    return {
        ...base,
        status: 'source_bound_included',
        sourceOccurrence: {
            rowIndex: rowInfo?.rowIndex ?? null,
            startUtf16: occurrence.startUtf16,
            endUtf16: occurrence.endUtf16,
            sourceTokenSha256: textHash(signal.from),
            rowSha256: rowInfo ? textHash(rowInfo.text) : null,
            contextSha256: contextHash(row.raw_input, occurrence.startUtf16, occurrence.endUtf16),
            occurrenceOrdinal: 0,
        },
        targetEvidence: targetOccurrences.length ? 'present_in_human_final_expectation' : 'target_not_present_in_human_final_expectation',
    };
}

function signalDigest(signals) {
    return sha256(Buffer.from(JSON.stringify(signals.map(signal => ({ caseId: signal.caseId, from: signal.from, to: signal.to, kind: signal.kind }))), 'utf8'));
}

function historicalSignals(oldReport, rowsById) {
    const signals = [];
    const cases = Array.isArray(oldReport.cases) ? oldReport.cases : Object.values(oldReport.cases || {});
    for (const caseReport of cases) {
        if (!CANARY_IDS.includes(caseReport.case_id)) continue;
        const row = rowsById.get(caseReport.case_id);
        if (!row) throw new Error(`Old report case ${caseReport.case_id} is absent from frozen dataset.`);
        for (const signal of caseReport.corrections?.matched || []) signals.push({ ...signal, caseId: caseReport.case_id });
    }
    const keys = new Set();
    const unique = signals.filter((signal) => {
        const key = `${signal.caseId}\0${signal.from}\0${signal.to}\0${signal.kind}`;
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
    });
    // The preserved baseline report's `matched` list predates the current
    // telemetry shape and can omit a diacritic from the list while counting it
    // in byKind. Recover only a mechanically provable raw→truth diacritic pair;
    // no candidate output or nearest-target heuristic is consulted.
    for (const row of rowsById.values()) {
        if (!CANARY_IDS.includes(row.case_id)) continue;
        const rawTokens = [...row.raw_input.matchAll(/[\p{L}\p{M}]+/gu)].map((match) => match[0]);
        const truthTokens = [...row.ground_truth.matchAll(/[\p{L}\p{M}]+/gu)].map((match) => match[0]);
        for (const from of rawTokens) {
            const base = from.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
            const target = truthTokens.find((to) => to !== from
                && /\p{M}/u.test(to.normalize('NFD'))
                && to.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() === base);
            if (!target) continue;
            const key = `${row.case_id}\0${from}\0${target}\0diacritic`;
            if (keys.has(key)) continue;
            keys.add(key);
            unique.push({ caseId: row.case_id, from, to: target, kind: 'diacritic' });
        }
    }
    return unique;
}

function buildManifest({ originalPlan, oldFixture, oldReport }) {
    const template = readJson(templatePath);
    const sourceFixtureHash = sha256(fs.readFileSync(phase0FixturePath));
    const expectedReferenceHash = template.registeredReferences?.[0]?.fixtureSha256;
    if (sourceFixtureHash !== expectedReferenceHash) throw new Error('Registered phase0 fixture hash drifted from the template.');
    const originalInputs = originalPlan.inputs || {};
    const datasetPath = originalInputs.dataset?.path;
    const cohortsPath = originalInputs.cohorts?.path;
    if (!datasetPath || !cohortsPath) throw new Error('Original plan does not bind dataset/cohorts.');
    const dataset = fs.readFileSync(datasetPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const cohorts = readJson(cohortsPath);
    if (JSON.stringify(cohorts.canaryCaseIds) !== JSON.stringify(CANARY_IDS)) throw new Error('Frozen canary membership drifted.');
    const rowsById = new Map(dataset.map((row) => [row.case_id, row]));
    const oldReportValue = readJson(oldReport);
    const signals = historicalSignals(oldReportValue, rowsById);
    if (signals.length !== 16) throw new Error(`Frozen original canary signal count is ${signals.length}, expected 16.`);
    const coverageItems = signals.map((signal, index) => signalCoverage(rowsById.get(signal.caseId), signal, index));
    const sourceBoundCases = coverageItems.filter((item) => item.status === 'source_bound_included').map((item) => {
        const row = rowsById.get(item.caseId);
        const signal = signals[item.signalIndex];
        return buildSourceBoundFixture({
            caseId: item.expectationId,
            lane: 'general_ai_equal_row',
            source: row.raw_input,
            context: row.context || {},
            mutations: [{
                startUtf16: item.sourceOccurrence.startUtf16,
                endUtf16: item.sourceOccurrence.endUtf16,
                before: signal.from,
                after: signal.to,
                kind: signal.kind,
                occurrenceOrdinal: item.sourceOccurrence.occurrenceOrdinal,
                provenance: { source: 'historical-signal-development-expectation', expectationId: item.expectationId },
            }],
            provenance: { source: 'historical-signal-development-expectation', expectationId: item.expectationId },
        });
    });
    const registeredReferences = template.registeredReferences.map((reference) => ({ ...reference, fixtureSha256: sourceFixtureHash }));
    const oldResponses = readJson(oldFixture);
    if (!Array.isArray(oldResponses) || oldResponses.length !== 8) throw new Error('Original contaminated fixture must contain exactly 8 responses.');
    const adversarialControls = CANARY_IDS.map((caseId, caseIndex) => {
        const row = rowsById.get(caseId);
        const responseIndexes = [caseIndex, caseIndex + 2, caseIndex + 4, caseIndex + 6];
        const controls = responseIndexes.map((responseIndex) => {
            const response = oldResponses[responseIndex];
            const content = response?.body?.choices?.[0]?.message?.content;
            const corrected = typeof content === 'string' ? content.match(/=== CORRECTED MENU ===\n([\s\S]*?)\n=== END CORRECTED MENU ===/)?.[1] : null;
            if (typeof corrected !== 'string') throw new Error(`Old response ${responseIndex} has no corrected block.`);
            const result = validateAdversarialControl({ source: row.raw_input, humanFinal: corrected });
            return { responseIndex, status: response.status, responseBodySha256: textHash(JSON.stringify(response.body)), correctedBlockSha256: textHash(corrected), ...result };
        });
        return { caseId, rawSourceSha256: textHash(row.raw_input), truthSha256: textHash(row.ground_truth), controls };
    });
    const coverage = {
        schemaVersion: 1,
        source: 'historical baseline report matched signals against frozen raw/truth rows',
        oldReportSha256: sha256(fs.readFileSync(oldReport)),
        items: coverageItems,
        requiredCount: 16,
        signalDigest: signalDigest(signals),
        complete: coverageItems.length === 16 && coverageItems.every((item) => item.status === 'source_bound_included'),
        statusCounts: coverageItems.reduce((out, item) => { out[item.status] = (out[item.status] || 0) + 1; return out; }, {}),
    };
    const manifest = {
        schemaVersion: 2,
        contractVersion: SOURCE_BOUND_PREFLIGHT_VERSION,
        status: 'prepared_synthetic_only',
        source: 'immutable source-bound mutations; no human-final block copied into positive cases',
        cases: [...template.cases, ...sourceBoundCases],
        registeredReferences,
        originalCoverage: coverage,
        adversarialControls,
    };
    const checked = validateManifest(manifest, { requiredCoverageCount: 16 });
    if (!checked.valid) throw new Error(`Source-bound fixture manifest validation failed: ${checked.errors.join(', ')}`);
    return { manifest, checked, originalPlan, datasetPath, cohortsPath, oldFixture, oldReport };
}

function prepare(args) {
    const out = path.resolve(args.out);
    if (fs.existsSync(out)) throw new Error(`Output directory already exists: ${out}`);
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    const originalPlanPath = path.resolve(args.originalPlan);
    const originalPlan = readJson(path.join(originalPlanPath, 'plan.json'));
    assertRegular(args.oldFixture, 'Old response fixture');
    assertRegular(args.oldReport, 'Old report');
    const built = buildManifest({ originalPlan, oldFixture: path.resolve(args.oldFixture), oldReport: path.resolve(args.oldReport) });
    const preparationStatus = built.checked.positiveGate ? 'prepared_no_model_authorization' : 'prepared_blocked_incomplete_coverage';
    const inputsDir = path.join(out, 'inputs');
    const toolingDir = path.join(out, 'tooling');
    const toolingScriptsDir = path.join(toolingDir, 'scripts');
    const toolingLibDir = path.join(toolingScriptsDir, 'lib');
    fs.mkdirSync(inputsDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(toolingLibDir, { recursive: true, mode: 0o700 });
    const manifestPath = path.join(inputsDir, 'source-bound-fixture-manifest.json');
    const coveragePath = path.join(inputsDir, 'original-coverage.json');
    const oldFixturePath = path.join(inputsDir, 'adversarial-human-final-responses.json');
    const oldReportPath = path.join(inputsDir, 'adversarial-human-final-report.json');
    writeJson(manifestPath, built.manifest);
    writeJson(coveragePath, built.manifest.originalCoverage);
    copyPrivate(built.oldFixture, oldFixturePath);
    copyPrivate(built.oldReport, oldReportPath);
    const copiedInputs = {};
    const originalInputSources = Object.entries(originalPlan.inputs || {})
        .filter(([, binding]) => binding?.path)
        .map(([name, binding]) => [name, binding.path]);
    for (const [name, source] of originalInputSources) {
        const target = path.join(inputsDir, path.basename(source));
        copyPrivate(source, target);
        copiedInputs[name] = { path: target, sha256: sha256(fs.readFileSync(target)), bytes: fs.statSync(target).size };
    }
    const toolingSource = path.join(repoRoot, 'scripts/lib/source-bound-preflight-v2.js');
    const toolingTarget = path.join(toolingLibDir, 'source-bound-preflight-v2.js');
    copyPrivate(toolingSource, toolingTarget);
    const runnerSource = path.join(repoRoot, 'scripts/run-source-bound-preflight-v2.js');
    const runnerTarget = path.join(toolingScriptsDir, 'run-source-bound-preflight-v2.js');
    const preparerSource = path.join(repoRoot, 'scripts/prepare-source-bound-preflight-v2.js');
    const preparerTarget = path.join(toolingScriptsDir, 'prepare-source-bound-preflight-v2.js');
    copyPrivate(runnerSource, runnerTarget);
    copyPrivate(preparerSource, preparerTarget);
    const phase0VerifierTarget = path.join(toolingScriptsDir, 'verify-source-anchored-spelling-phase0-v2.js');
    const phase0VerifierDependencyTarget = path.join(toolingScriptsDir, 'verify-source-anchored-spelling-phase0.js');
    const templateTarget = path.join(toolingDir, 'services/dashboard/__fixtures__/review-learning/source-bound-preflight-v2.json');
    const phase0FixtureTarget = path.join(toolingDir, 'services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix-v2.json');
    const phase0FixtureDependencyTarget = path.join(toolingDir, 'services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix.json');
    copyPrivate(phase0VerifierPath, phase0VerifierTarget);
    copyPrivate(phase0VerifierDependencyPath, phase0VerifierDependencyTarget);
    copyPrivate(templatePath, templateTarget);
    copyPrivate(phase0FixturePath, phase0FixtureTarget);
    // The v2 verifier intentionally imports the v1 occurrence matrix as a
    // frozen compatibility dependency. Keep that dependency inside the
    // copied topology so a Docker run cannot resolve it from the host tree.
    copyPrivate(phase0FixtureDependencyPath, phase0FixtureDependencyTarget);
    const copiedExecutionManifests = {};
    for (const [arm, binding] of Object.entries(originalPlan.executionManifests || {})) {
        if (!binding?.path) continue;
        const target = path.join(inputsDir, `${arm}-execution-manifest.json`);
        copyPrivate(binding.path, target);
        copiedExecutionManifests[arm] = { path: target, sha256: sha256(fs.readFileSync(target)), bytes: fs.statSync(target).size, entries: binding.entries };
    }
    const plan = {
        schemaVersion: 2,
        contractVersion: SOURCE_BOUND_PREFLIGHT_VERSION,
        state: preparationStatus,
        createdAt: new Date().toISOString(),
        outputRoot: out,
        supersedes: { type: 'blank-line-repair-and-contaminated-positive-gate', preserved: true },
        originalPlan: { path: path.join(originalPlanPath, 'plan.json'), sha256: sha256(fs.readFileSync(path.join(originalPlanPath, 'plan.json'))), runId: originalPlan.runId },
        snapshots: {
            baseline: originalPlan.snapshots?.baseline || null,
            candidate: originalPlan.snapshots?.candidate || null,
        },
        inputs: {
            ...copiedInputs,
            manifest: { path: manifestPath, sha256: sha256(fs.readFileSync(manifestPath)), bytes: fs.statSync(manifestPath).size },
            coverage: { path: coveragePath, sha256: sha256(fs.readFileSync(coveragePath)), bytes: fs.statSync(coveragePath).size },
            adversarialFixture: { path: oldFixturePath, sha256: sha256(fs.readFileSync(oldFixturePath)), bytes: fs.statSync(oldFixturePath).size },
            adversarialReport: { path: oldReportPath, sha256: sha256(fs.readFileSync(oldReportPath)), bytes: fs.statSync(oldReportPath).size },
        },
        registeredReferenceFixture: { path: phase0FixtureTarget, sha256: sha256(fs.readFileSync(phase0FixtureTarget)) },
        registeredReferenceFixtureDependency: { path: phase0FixtureDependencyTarget, sha256: sha256(fs.readFileSync(phase0FixtureDependencyTarget)) },
        registeredReferenceTool: { path: phase0VerifierTarget, sha256: sha256(fs.readFileSync(phase0VerifierTarget)) },
        registeredReferenceDependency: { path: phase0VerifierDependencyTarget, sha256: sha256(fs.readFileSync(phase0VerifierDependencyTarget)) },
        executionManifests: copiedExecutionManifests,
        trustedTools: [...(originalPlan.trustedTools || []),
            { path: toolingTarget, relative: 'tooling/scripts/lib/source-bound-preflight-v2.js', sha256: sha256(fs.readFileSync(toolingTarget)) },
            { path: runnerTarget, relative: 'tooling/scripts/run-source-bound-preflight-v2.js', sha256: sha256(fs.readFileSync(runnerTarget)) },
            { path: preparerTarget, relative: 'tooling/scripts/prepare-source-bound-preflight-v2.js', sha256: sha256(fs.readFileSync(preparerTarget)) },
            { path: phase0VerifierTarget, relative: 'tooling/scripts/verify-source-anchored-spelling-phase0-v2.js', sha256: sha256(fs.readFileSync(phase0VerifierTarget)) },
            { path: phase0VerifierDependencyTarget, relative: 'tooling/scripts/verify-source-anchored-spelling-phase0.js', sha256: sha256(fs.readFileSync(phase0VerifierDependencyTarget)) },
            { path: phase0FixtureTarget, relative: 'tooling/services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix-v2.json', sha256: sha256(fs.readFileSync(phase0FixtureTarget)) },
            { path: phase0FixtureDependencyTarget, relative: 'tooling/services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix.json', sha256: sha256(fs.readFileSync(phase0FixtureDependencyTarget)) }],
        sourceBoundTools: {
            helper: { path: toolingTarget, sha256: sha256(fs.readFileSync(toolingTarget)) },
            runner: { path: runnerTarget, sha256: sha256(fs.readFileSync(runnerTarget)) },
            preparer: { path: preparerTarget, sha256: sha256(fs.readFileSync(preparerTarget)) },
        },
        tooling: { path: toolingTarget, sha256: sha256(fs.readFileSync(toolingTarget)), version: SOURCE_BOUND_PREFLIGHT_VERSION },
        positiveGate: built.checked.positiveGate,
        coverage: built.checked.coverage,
        originalHistoricalSignals: { count: built.manifest.originalCoverage.items.length, oldReportSha256: built.manifest.originalCoverage.oldReportSha256 },
        oldHistoricalComparator: {
            fixtureSha256: sha256(fs.readFileSync(oldFixturePath)),
            preserved: true,
            positiveReadinessGate: false,
            controlPurpose: 'adversarial source-preservation only',
        },
        runtime: originalPlan.runtime || null,
        authorization: null,
    };
    const planPath = path.join(out, 'plan.json');
    writeJson(planPath, plan);
    const planSha256 = sha256(fs.readFileSync(planPath));
    fs.writeFileSync(path.join(out, 'plan.sha256'), `${planSha256}\n`, { mode: 0o600 });
    const evidence = {
        schemaVersion: 1,
        contractVersion: SOURCE_BOUND_PREFLIGHT_VERSION,
        status: preparationStatus,
        planPath,
        planSha256,
        fixtureManifestPath: manifestPath,
        fixtureManifestSha256: plan.inputs.manifest.sha256,
        coveragePath,
        coverageSha256: plan.inputs.coverage.sha256,
        positiveGate: plan.positiveGate,
        coverage: plan.coverage,
        adversarialControls: built.manifest.adversarialControls.map((control) => ({ caseId: control.caseId, rawSourceSha256: control.rawSourceSha256, truthSha256: control.truthSha256, responseCount: control.controls.length, allUnauthorized: control.controls.every((item) => item.authorized === false), allSubstantive: control.controls.every((item) => item.substantiveDifference === true) })),
        paidProviderCalls: 0,
        paidSpendUsd: 0,
        modelCalls: 0,
        externalNetworkCalls: 0,
        limitations: [`${plan.coverage.statusCounts.ambiguous_unresolved || 0} repeated-token historical signals remain explicitly ambiguous; positive coverage is incomplete`, 'original human-final responses are negative controls only', 'synthetic readiness does not establish model quality or authorize paid execution'],
    };
    writeJson(path.join(out, 'preflight-preparation-evidence.json'), evidence);
    return { plan, planSha256, evidence, checked: built.checked };
}

function main() {
    const result = prepare(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ status: result.evidence.status, planSha256: result.planSha256, fixtureManifestSha256: result.evidence.fixtureManifestSha256, positiveGate: result.evidence.positiveGate, coverage: result.evidence.coverage, modelCalls: 0, paidProviderCalls: 0 }, null, 2)}\n`);
}

if (require.main === module) {
    try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { CANARY_IDS, buildManifest, findTokenOccurrences, historicalSignals, parseArgs, prepare, signalCoverage, signalDigest };

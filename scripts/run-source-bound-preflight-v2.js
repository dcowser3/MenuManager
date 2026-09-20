#!/usr/bin/env node
'use strict';

/** Execute the source-bound synthetic preflight v2 in four no-provider arms. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let {
    MARKERS,
    SOURCE_BOUND_PREFLIGHT_VERSION,
    applySourceMutations,
    parseCorrectedBlock,
    responseForFixture,
    textHash,
    validateAdversarialControl,
    validateManifest,
    validateResponseForFixture,
} = require('./lib/source-bound-preflight-v2');
let { historicalSignals, signalDigest } = require('./prepare-source-bound-preflight-v2');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};

function verifyBoundFile(binding, label) {
    if (!binding?.path || !fs.existsSync(binding.path)) throw new Error(`${label} is missing.`);
    const bytes = fs.readFileSync(binding.path);
    const actual = sha256(bytes);
    if (binding.sha256 && actual !== binding.sha256) throw new Error(`${label} hash mismatch.`);
    return { sha256: actual, bytes: bytes.length };
}

function verifyTrustedToolSet(plan) {
    const failures = [];
    for (const tool of plan.trustedTools || []) {
        try { verifyBoundFile({ path: tool.path, sha256: tool.sha256 }, `Trusted tool ${tool.relative || tool.path}`); }
        catch (error) { failures.push(error.message); }
    }
    if (failures.length) throw new Error(`Trusted tooling closure mismatch: ${failures.join('; ')}`);
}

function verifyExecutionManifest(snapshot, binding, arm) {
    if (!binding?.path) throw new Error(`${arm} execution manifest is missing.`);
    const entries = readJson(binding.path);
    if (!Array.isArray(entries)) throw new Error(`${arm} execution manifest is not an array.`);
    if (Number.isInteger(binding.entries) && entries.length !== binding.entries) throw new Error(`${arm} execution manifest entry count mismatch.`);
    for (const entry of entries) {
        if (!entry?.path || path.isAbsolute(entry.path) || entry.path.split('/').includes('..')) throw new Error(`${arm} execution manifest has an unsafe path.`);
        const file = path.join(snapshot.root, entry.path);
        if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== entry.sha256) throw new Error(`${arm} snapshot closure mismatch at ${entry.path}.`);
    }
    const pipelineFile = path.join(snapshot.root, 'services/dashboard/lib/review-pipeline.ts');
    if (snapshot.resultCapability?.pipelineSourceSha256 && sha256(fs.readFileSync(pipelineFile)) !== snapshot.resultCapability.pipelineSourceSha256) throw new Error(`${arm} pipeline source capability mismatch.`);
    return { entries: entries.length, manifestSha256: sha256(fs.readFileSync(binding.path)) };
}

function parseArgs(argv) {
    const args = {};
    const valueOptions = new Set(['--plan', '--out']);
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!valueOptions.has(key) || !value || value.startsWith('--')) throw new Error('Usage: run-source-bound-preflight-v2.js --plan DIR --out DIR');
        const name = key.slice(2);
        if (args[name]) throw new Error(`Duplicate option: ${key}`);
        args[name] = value;
    }
    if (!args.plan || !args.out) throw new Error('Usage: run-source-bound-preflight-v2.js --plan DIR --out DIR');
    return args;
}

function loadTsNode() {
    try { require('ts-node/register/transpile-only'); return true; } catch { return false; }
}

function loadPipeline(snapshotRoot, capability = null) {
    const file = path.join(snapshotRoot, 'services/dashboard/lib/review-pipeline.ts');
    if (!fs.existsSync(file) || !loadTsNode()) return { pipeline: null, source: file };
    try {
        delete require.cache[require.resolve(file)];
        const envelopeFile = path.join(snapshotRoot, 'services/dashboard/lib/review-envelope.ts');
        const envelope = fs.existsSync(envelopeFile) ? (() => { delete require.cache[require.resolve(envelopeFile)]; return require(envelopeFile); })() : null;
        return { pipeline: require(file), envelope, capability, source: file };
    } catch (error) {
        return { pipeline: null, capability, source: file, error: error.message };
    }
}

function pipelineOptions(fixture, runtimeInputs) {
    const context = fixture.context || {};
    return {
        ...context,
        basePrompt: runtimeInputs.prompt,
        acceptedCorrectionRules: runtimeInputs.rules,
        approvedVocabularyTexts: runtimeInputs.vocabulary.texts || [],
        approvedVocabularyTerms: runtimeInputs.vocabulary.terms || [],
        model: runtimeInputs.runtime.model,
        settings: { temperature: runtimeInputs.runtime.temperature, seed: runtimeInputs.runtime.seed },
        precheckEnabled: runtimeInputs.runtime.precheckEnabled !== false,
        omitSections: [],
    };
}

function feedbackFor(correctedBlock, records = []) {
    return [MARKERS.correctedStart, correctedBlock, MARKERS.correctedEnd, MARKERS.suggestionsStart, JSON.stringify(records), MARKERS.suggestionsEnd].join('\n');
}

async function runOneFixture(loaded, fixture, runtimeInputs) {
    const pipeline = loaded && loaded.pipeline ? loaded.pipeline : null;
    const binding = applySourceMutations(fixture);
    const response = fixture.response || responseForFixture(fixture);
    const responseCheck = validateResponseForFixture(fixture, response, { requireNoInternalRecords: true });
    const result = {
        caseId: fixture.caseId,
        lane: fixture.lane,
        sourceSha256: sha256(Buffer.from(fixture.source, 'utf8')),
        expectedSha256: sha256(Buffer.from(fixture.correctedBlock, 'utf8')),
        sourceRows: fixture.source.split('\n').length,
        expectedRows: fixture.correctedBlock.split('\n').length,
        mutationCount: fixture.mutations.length,
        fixtureValid: binding.valid,
        responseContractValid: responseCheck.valid,
        protocolDelivered: binding.valid && responseCheck.valid && responseCheck.corrected === fixture.correctedBlock,
        responseCorrectedSha256: responseCheck.corrected === null ? null : sha256(Buffer.from(responseCheck.corrected, 'utf8')),
        pipelineAvailable: !!pipeline,
        errors: [...binding.errors, ...responseCheck.errors],
    };
    if (!pipeline) return result;
    try {
        const attributeCorrectedBlock = pipeline.attributeCorrectedBlock || loaded?.envelope?.attributeCorrectedBlock;
        const envelope = attributeCorrectedBlock
            ? attributeCorrectedBlock(fixture.source, fixture.correctedBlock, runtimeInputs.rules, {
                templateType: fixture.context?.templateType,
                property: fixture.context?.property,
                menuType: fixture.context?.menuType,
            })
            : null;
        result.directAttribution = envelope ? {
            text: envelope.text,
            textSha256: sha256(Buffer.from(envelope.text, 'utf8')),
            delivered: envelope.text === fixture.correctedBlock,
            diagnostics: envelope.diagnostics || [],
            mutationCount: envelope.mutations?.length || 0,
        } : { delivered: false, diagnostics: ['attributeCorrectedBlock_unavailable'] };
        if (typeof pipeline.runFullReviewPipeline === 'function') {
            const reviewed = await pipeline.runFullReviewPipeline(fixture.source, pipelineOptions(fixture, runtimeInputs), async () => (
                loaded.capability?.version === 'modern-full-review-v2'
                    ? { feedback: response, finishReason: fixture.simulatedResponse?.finishReason || 'stop' }
                    : response
            ));
            const delivered = reviewed.finalCorrectedMenu || reviewed.post?.correctedMenuSanitized || '';
            result.pipeline = {
                deliveredText: delivered,
                deliveredSha256: sha256(Buffer.from(delivered, 'utf8')),
                delivered: delivered === fixture.correctedBlock,
                contractComplete: !reviewed.post?.contractErrors?.length,
                safetyDiagnostics: reviewed.post?.safetyDiagnostics || [],
                criticalSuggestionCount: reviewed.post?.criticalSuggestions?.length || 0,
                precheckedSourceSha256: reviewed.preCheckedReviewBody ? sha256(Buffer.from(reviewed.preCheckedReviewBody, 'utf8')) : null,
                precheckedSourceMatches: reviewed.preCheckedReviewBody === fixture.source,
            };
        } else result.pipeline = { delivered: false, reason: 'runFullReviewPipeline_unavailable' };
    } catch (error) {
        result.errors.push(`pipeline:${error.message}`);
    }
    return result;
}

async function runAdversarialControls(loaded, manifest, oldFixturePath, sourceByCase, sourceContexts, runtimeInputs) {
    const pipeline = loaded && loaded.pipeline ? loaded.pipeline : null;
    const oldResponses = readJson(oldFixturePath);
    const controls = [];
    for (const control of manifest.adversarialControls || []) {
        const caseRows = [];
        for (const item of control.controls || []) {
            const content = oldResponses[item.responseIndex]?.body?.choices?.[0]?.message?.content;
            const corrected = typeof content === 'string' ? parseCorrectedBlock(content) : null;
            const source = sourceByCase.get(control.caseId);
            const result = corrected === null
                ? { valid: false, authorized: false, reason: 'missing_corrected_block' }
                : typeof source !== 'string'
                    ? { valid: false, authorized: false, reason: 'missing_source_binding' }
                    : validateAdversarialControl({ source, humanFinal: corrected });
            let pipelineResult = { available: false, safe: false, reason: 'pipeline_unavailable' };
            if (pipeline && typeof pipeline.runFullReviewPipeline === 'function' && typeof source === 'string' && corrected !== null) {
                try {
                    const fixture = { context: sourceContexts.get(control.caseId) || {}, simulatedResponse: { finishReason: 'stop' } };
                    const options = pipelineOptions(fixture, runtimeInputs);
                    const safeResponse = loaded.capability?.version === 'modern-full-review-v2'
                        ? (feedback) => ({ feedback, finishReason: 'stop' }) : (feedback) => feedback;
                    const safeBaseline = await pipeline.runFullReviewPipeline(source, options, async () => safeResponse(feedbackFor(source)));
                    const reviewed = await pipeline.runFullReviewPipeline(source, options, async () => safeResponse(feedbackFor(corrected)));
                    const safeText = safeBaseline.finalCorrectedMenu || '';
                    const finalText = reviewed.finalCorrectedMenu || '';
                    const safePrecheckedText = safeBaseline.preCheckedReviewBody || source;
                    const finalPrecheckedText = reviewed.preCheckedReviewBody || source;
                    pipelineResult = {
                        available: true,
                        // Deterministic precheck corrections are permitted; the
                        // pipeline must preserve its own immutable prechecked
                        // body and reject the contaminated human-final bytes.
                        safeBaselinePreserved: safeText === safePrecheckedText,
                        humanFinalPreserved: finalText === finalPrecheckedText,
                        // The safe-source callback can take a different
                        // deterministic path than a malformed/adversarial
                        // callback. The security assertion is therefore that
                        // the human-final arm delivers only its immutable
                        // prechecked source, never the supplied human-final
                        // bytes or a cross-row transfer.
                        safe: finalText === finalPrecheckedText,
                        humanFinalAdopted: finalText !== safeText,
                        safeBaselinePrecheckedText: safePrecheckedText,
                        finalPrecheckedText,
                        safeBaselineText: safeText,
                        deliveredText: finalText,
                        safeBaselineSha256: sha256(Buffer.from(safeText, 'utf8')),
                        deliveredSha256: sha256(Buffer.from(finalText, 'utf8')),
                        precheckedSourceMatches: safeBaseline.preCheckedReviewBody === source && reviewed.preCheckedReviewBody === source,
                        diagnostics: reviewed.post?.safetyDiagnostics || [],
                    };
                } catch (error) {
                    pipelineResult = { available: true, safe: false, reason: `pipeline:${error.message}` };
                }
            }
            const oldResponse = oldResponses[item.responseIndex];
            caseRows.push({ responseIndex: item.responseIndex, responseStatus: oldResponse?.status ?? null, finishReason: oldResponse?.body?.choices?.[0]?.finish_reason ?? null, responseBodySha256: sha256(Buffer.from(JSON.stringify(oldResponse?.body || {}), 'utf8')), correctedBlockSha256: corrected === null ? null : sha256(Buffer.from(corrected, 'utf8')), valid: result.valid, authorized: result.authorized, substantiveDifference: result.substantiveDifference, contentChanged: result.contentChanged, layoutChanged: result.layoutChanged, lexicalSkeletonChanged: result.lexicalSkeletonChanged, sourceRows: result.sourceRows, humanFinalRows: result.humanFinalRows, reason: result.reason, pipeline: pipelineResult });
        }
        controls.push({ caseId: control.caseId, count: caseRows.length, allValid: caseRows.length > 0 && caseRows.every((item) => item.valid), allUnauthorized: caseRows.length > 0 && caseRows.every((item) => item.authorized === false), pipelineAvailable: caseRows.length > 0 && caseRows.every((item) => item.pipeline.available), pipelineSafe: caseRows.length > 0 && caseRows.every((item) => item.pipeline.safe), rows: caseRows });
    }
    return controls;
}

function validateRegisteredReference(reference, phase0ToolPath = null) {
    const file = path.isAbsolute(reference.fixturePath) ? reference.fixturePath : path.resolve(repoRoot, reference.fixturePath);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== reference.fixtureSha256) return { caseId: reference.caseId, valid: false, reason: 'registered_fixture_hash_mismatch' };
    // The phase0 verifier is the source of actual server-issued IDs and
    // dispositions. This check imports its deterministic frozen manifest and
    // never turns its expected values into production policy.
    try {
        const phase0 = require(phase0ToolPath || path.resolve(repoRoot, 'scripts/verify-source-anchored-spelling-phase0-v2'));
        const item = phase0.buildManifest().cases.find((entry) => entry.caseId === reference.caseId);
        const record = item?.runtimeInput?.response?.records?.[0];
        const occurrence = item?.runtimeInput?.occurrenceRegistry?.find((entry) => entry.sourceOccurrenceId === record?.sourceOccurrenceId);
        return { caseId: reference.caseId, valid: !!item && reference.disposition === record?.spellingDisposition && !!occurrence, disposition: record?.spellingDisposition || null, sourceOccurrenceIdSha256: occurrence ? sha256(Buffer.from(occurrence.sourceOccurrenceId, 'utf8')) : null };
    } catch (error) { return { caseId: reference.caseId, valid: false, reason: `registered_reference_error:${error.message}` }; }
}

async function runRegisteredProtocol(loaded, reference, runtimeInputs, phase0ToolPath = null) {
    const pipeline = loaded && loaded.pipeline ? loaded.pipeline : null;
    if (loaded?.capability?.sourceAnchoringTelemetry !== 'available') return { available: false, supported: false, safe: false, reason: 'legacy_capability_unavailable' };
    if (!pipeline || typeof pipeline.runPostAiPipeline !== 'function') return { available: false, safe: false, reason: 'pipeline_unavailable' };
    try {
        const phase0 = require(phase0ToolPath || path.resolve(repoRoot, 'scripts/verify-source-anchored-spelling-phase0-v2'));
        const item = phase0.buildManifest().cases.find((entry) => entry.caseId === reference.caseId);
        const input = item?.runtimeInput;
        const record = input?.response?.records?.[0];
        const occurrence = input?.occurrenceRegistry?.find((entry) => entry.sourceOccurrenceId === record?.sourceOccurrenceId);
        if (!input || !record || !occurrence) return { available: true, safe: false, reason: 'registered_runtime_binding_missing' };
        const finding = input.findingRegistry?.find((entry) => entry.spellingFindingId === occurrence.spellingFindingId);
        // The frozen phase-0 matrix predates the runtime's normalized
        // `sourceRevisionId` field; its selected revision is the exact
        // prechecked source identity used by the live occurrence contract.
        const spellingOccurrences = [{
            ...occurrence,
            sourceRevisionId: occurrence.sourceRevisionId || input.revisions.selectedRevisionId,
            sourceRowIndex: occurrence.sourceRowIndex ?? occurrence.rawRowIndex,
            sourceStartUtf16: occurrence.sourceStartUtf16 ?? occurrence.rawStartUtf16,
            sourceEndUtf16: occurrence.sourceEndUtf16 ?? occurrence.rawEndUtf16,
            finding,
        }];
        const base = {
            acceptedCorrectionRules: input.canonicalEvidence.acceptedRules,
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            preCheckedReviewBody: input.rawSource,
            templateType: input.context.templateType,
            property: input.context.property,
            menuType: input.context.menuType,
            effectiveReviewAllergens: '',
            precheckEnabled: runtimeInputs.runtime.precheckEnabled !== false,
            spellingOccurrences,
            // The registered occurrence is anchored to the selected/prechecked
            // review revision (rawRevisionId is the upstream artifact identity).
            // Binding the wrong revision would make the hold arm look unsafe
            // even though the occurrence itself is valid.
            spellingSourceRevisionId: input.revisions.selectedRevisionId,
            spellingSourceTextSha256: input.revisions.rawSourceSha256,
            legitimateSpellingTerms: new Set(),
        };
        const apply = pipeline.runPostAiPipeline({ ...base, feedback: feedbackFor(input.response.correctedMenu, [record]) });
        const heldRecord = { ...record, spellingDisposition: 'uncertain_candidate' };
        // The phase-0 case is an exact accepted alias, so its normal rule
        // would deterministically rewrite the token before a disposition hold
        // could be observed. Remove only that accepted rule in the cloned hold
        // arm; context, occurrence IDs, source revision and response bytes stay
        // identical, isolating the registered hold behavior without changing
        // production policy.
        const hold = pipeline.runPostAiPipeline({ ...base, acceptedCorrectionRules: [], feedback: feedbackFor(input.response.correctedMenu, [heldRecord]) });
        return {
            available: true,
            safe: apply.correctedMenuSanitized === input.response.correctedMenu && hold.correctedMenuSanitized === input.rawSource,
            applyDelivered: apply.correctedMenuSanitized === input.response.correctedMenu,
            holdPreserved: hold.correctedMenuSanitized === input.rawSource,
            holdSafetyDiagnostics: hold.safetyDiagnostics || [],
            appliedSha256: sha256(Buffer.from(apply.correctedMenuSanitized, 'utf8')),
            heldSha256: sha256(Buffer.from(hold.correctedMenuSanitized, 'utf8')),
            sourceSha256: sha256(Buffer.from(input.rawSource, 'utf8')),
            sourceOccurrenceIdSha256: sha256(Buffer.from(occurrence.sourceOccurrenceId, 'utf8')),
        };
    } catch (error) {
        return { available: true, safe: false, reason: `registered_runtime:${error.message}` };
    }
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const planRoot = path.resolve(args.plan);
    const planPath = path.join(planRoot, 'plan.json');
    const plan = readJson(planPath);
    const planSha256 = sha256(fs.readFileSync(planPath));
    if (plan.contractVersion !== SOURCE_BOUND_PREFLIGHT_VERSION) throw new Error('Plan contract version mismatch.');
    for (const [name, binding] of Object.entries(plan.inputs || {})) verifyBoundFile(binding, `Bound input ${name}`);
    if (plan.tooling) verifyBoundFile(plan.tooling, 'Bound tooling');
    if (!plan.sourceBoundTools?.runner) throw new Error('Bound source-preflight runner is missing.');
    verifyBoundFile(plan.sourceBoundTools.runner, 'Bound source-preflight runner');
    if (sha256(fs.readFileSync(__filename)) !== plan.sourceBoundTools.runner.sha256) throw new Error('Executing runner is not the bound runner.');
    verifyTrustedToolSet(plan);
    const phase0ToolPath = plan.registeredReferenceTool?.path;
    if (plan.registeredReferenceTool) verifyBoundFile(plan.registeredReferenceTool, 'Registered-reference tooling');
    if (plan.registeredReferenceDependency) verifyBoundFile(plan.registeredReferenceDependency, 'Registered-reference dependency');
    if (plan.registeredReferenceFixture) verifyBoundFile(plan.registeredReferenceFixture, 'Registered-reference fixture');
    if (plan.registeredReferenceFixtureDependency) verifyBoundFile(plan.registeredReferenceFixtureDependency, 'Registered-reference fixture dependency');
    const snapshotClosure = {};
    for (const [arm, snapshot] of Object.entries(plan.snapshots || {})) snapshotClosure[arm] = verifyExecutionManifest(snapshot, plan.executionManifests?.[arm], arm);
    if (!plan.tooling?.path) throw new Error('Bound tooling is missing from the plan.');
    const boundTool = require(plan.tooling.path);
    if (boundTool.SOURCE_BOUND_PREFLIGHT_VERSION !== SOURCE_BOUND_PREFLIGHT_VERSION) throw new Error('Bound tooling contract version mismatch.');
    ({ applySourceMutations, parseCorrectedBlock, responseForFixture, textHash, validateAdversarialControl, validateManifest, validateResponseForFixture } = boundTool);
    if (!plan.sourceBoundTools?.preparer?.path) throw new Error('Bound source-preflight preparer is missing.');
    verifyBoundFile(plan.sourceBoundTools.preparer, 'Bound source-preflight preparer');
    ({ historicalSignals, signalDigest } = require(plan.sourceBoundTools.preparer.path));
    const manifestPath = plan.inputs.manifest.path;
    const manifest = readJson(manifestPath);
    const validation = validateManifest(manifest, { requiredCoverageCount: 16 });
    if (!validation.valid) throw new Error(`Fixture validation failed: ${validation.errors.join(', ')}`);
    const toolingSha256 = plan.tooling ? sha256(fs.readFileSync(plan.tooling.path)) : null;
    const dataset = fs.readFileSync(plan.inputs.dataset.path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const sourceByCase = new Map(dataset.map((row) => [row.case_id, row.raw_input]));
    const sourceContexts = new Map(dataset.map((row) => [row.case_id, row.context || {}]));
    const rulesValue = readJson(plan.inputs.rules.path);
    const runtimeInputs = {
        prompt: fs.readFileSync(plan.inputs.prompt.path, 'utf8'),
        rules: Array.isArray(rulesValue) ? rulesValue : rulesValue.rules,
        vocabulary: readJson(plan.inputs.vocabulary.path),
        runtime: readJson(plan.inputs.runtime.path),
    };
    const rowsById = new Map(dataset.map(row => [row.case_id, row]));
    const expectedSignals = historicalSignals(readJson(plan.inputs.adversarialReport.path), rowsById);
    const coverageItems = manifest.originalCoverage.items || [];
    if (manifest.originalCoverage.signalDigest !== signalDigest(expectedSignals)) throw new Error('Original coverage signal digest mismatch.');
    for (let index = 0; index < expectedSignals.length; index += 1) {
        const item = coverageItems[index];
        const expected = expectedSignals[index];
        const row = rowsById.get(expected.caseId);
        if (!item || !row || item.caseId !== expected.caseId || item.signalIndex !== index || item.kind !== expected.kind
            || item.fromSha256 !== textHash(expected.from) || item.toSha256 !== textHash(expected.to)
            || item.rawSourceSha256 !== textHash(row.raw_input)) throw new Error(`Original coverage membership mismatch at ${index}.`);
    }
    const registered = (manifest.registeredReferences || []).map(reference => validateRegisteredReference(reference, phase0ToolPath));
    const positiveFixtures = manifest.cases;
    const arms = {};
    for (const [arm, snapshot] of [['baseline', plan.snapshots.baseline], ['candidate', plan.snapshots.candidate]]) {
        if (!snapshot?.root) throw new Error(`${arm} snapshot root is missing.`);
        const loaded = loadPipeline(snapshot.root, snapshot.resultCapability || null);
        for (const repeat of [1, 2]) {
            const key = `repeat-${repeat}-${arm}`;
            const positives = [];
            for (const fixture of positiveFixtures) positives.push(await runOneFixture(loaded, fixture, runtimeInputs));
            const adversarial = await runAdversarialControls(loaded, manifest, plan.inputs.adversarialFixture.path, sourceByCase, sourceContexts, runtimeInputs);
            const registeredRuntime = [];
            for (const reference of manifest.registeredReferences || []) registeredRuntime.push(await runRegisteredProtocol(loaded, reference, runtimeInputs, phase0ToolPath));
            arms[key] = {
                arm,
                repeat,
                snapshotRoot: snapshot.root,
                resultCapability: snapshot.resultCapability || null,
                pipelineSourceSha256: fs.existsSync(loaded.source) ? sha256(fs.readFileSync(loaded.source)) : null,
                snapshotClosure: snapshotClosure[arm],
                pipelineAvailable: !!loaded.pipeline,
                positives: {
                    count: positives.length,
                    fixtureValidCount: positives.filter((item) => item.fixtureValid).length,
                    responseContractValidCount: positives.filter((item) => item.responseContractValid).length,
                    protocolDeliveredCount: positives.filter((item) => item.protocolDelivered).length,
                    directDeliveredCount: positives.filter((item) => item.directAttribution?.delivered).length,
                    pipelineDeliveredCount: positives.filter((item) => item.pipeline?.delivered).length,
                    errors: positives.flatMap((item) => item.errors),
                    cases: positives.map((item) => ({ caseId: item.caseId, lane: item.lane, sourceSha256: item.sourceSha256, expectedSha256: item.expectedSha256, directDelivered: item.directAttribution?.delivered ?? null, directText: item.directAttribution?.text ?? null, pipelineDelivered: item.pipeline?.delivered ?? null, pipelineDeliveredText: item.pipeline?.deliveredText ?? null, diagnostics: [...(item.directAttribution?.diagnostics || []), ...(item.pipeline?.safetyDiagnostics || [])] })),
                },
                adversarial: {
                    controlCount: adversarial.reduce((sum, item) => sum + item.count, 0),
                    allValid: adversarial.every((item) => item.allValid),
                    allUnauthorized: adversarial.every((item) => item.allUnauthorized),
                    pipelineAvailable: adversarial.length > 0 && adversarial.every((item) => item.pipelineAvailable),
                    pipelineSafe: adversarial.length > 0 && adversarial.every((item) => item.pipelineSafe),
                    controls: adversarial,
                },
                registeredRuntime,
            };
        }
    }
    const allPositiveFixtureValid = Object.values(arms).every((arm) => arm.positives.fixtureValidCount === arm.positives.count);
    const allProtocolDelivered = Object.values(arms).every((arm) => arm.positives.protocolDeliveredCount === arm.positives.count);
    const modernArms = Object.values(arms).filter((arm) => arm.resultCapability?.sourceAnchoringTelemetry === 'available');
    const allDirectDelivered = modernArms.length > 0 && modernArms.every((arm) => arm.positives.directDeliveredCount === arm.positives.count);
    const pipelineAvailableAllArms = Object.values(arms).every((arm) => arm.pipelineAvailable);
    const allPipelineDelivered = pipelineAvailableAllArms && Object.values(arms).every((arm) => arm.positives.pipelineDeliveredCount === arm.positives.count);
    const allAdversarialControlsValid = Object.values(arms).every((arm) => arm.adversarial.allValid && arm.adversarial.allUnauthorized);
    const allAdversarialPipelineSafe = modernArms.length > 0 && modernArms.every((arm) => arm.adversarial.pipelineAvailable && arm.adversarial.pipelineSafe);
    const allRegisteredRuntimeSafe = modernArms.length > 0 && modernArms.every((arm) => arm.registeredRuntime.length > 0 && arm.registeredRuntime.every((item) => item.available && item.safe));
    const evidence = {
        schemaVersion: 1,
        contractVersion: SOURCE_BOUND_PREFLIGHT_VERSION,
        status: validation.positiveGate ? 'completed_unapproved' : 'completed_blocked_incomplete_coverage',
        planSha256,
        fixtureManifestSha256: sha256(fs.readFileSync(plan.inputs.manifest.path)),
        toolingSha256,
        runtimeInputHashes: Object.fromEntries(['prompt', 'rules', 'vocabulary', 'runtime', 'dataset', 'cohorts', 'corrections'].map(name => [name, plan.inputs[name]?.sha256 || null])),
        coverage: validation.coverage,
        registeredReferences: registered,
        arms,
        gates: {
            positiveFixtureValidation: allPositiveFixtureValid,
            sourceBoundProtocolDelivery: allProtocolDelivered,
            sourceBoundDirectDelivery: allDirectDelivered,
            sourceBoundPipelineDelivery: allPipelineDelivered,
            adversarialControlValidation: allAdversarialControlsValid,
            adversarialPipelineSafety: allAdversarialPipelineSafe,
            adversarialSourcePreservation: allAdversarialControlsValid && allAdversarialPipelineSafe,
            registeredRuntimeProtocol: allRegisteredRuntimeSafe,
            positiveCoverageComplete: validation.positiveGate,
            positiveReadinessGate: allPositiveFixtureValid && allProtocolDelivered && allDirectDelivered && allPipelineDelivered && allAdversarialControlsValid && allAdversarialPipelineSafe && allRegisteredRuntimeSafe && validation.positiveGate && registered.every((item) => item.valid),
        },
        preservedHistoricalComparator: { status: 'failed_safety_preserved', positiveReadinessGate: false, fixtureNotUsedAsPositive: true },
        modelCalls: 0,
        providerCalls: 0,
        paidProviderCalls: 0,
        paidSpendUsd: 0,
        externalNetworkCalls: 0,
        limitations: [`${validation.coverage.statusCounts.ambiguous_unresolved || 0} repeated-token historical signals remain ambiguous and block complete original coverage`, 'human-final response fixture is retained only as adversarial control', 'passing synthetic gates would establish engineering readiness only, not historical/model quality'],
    };
    const out = path.resolve(args.out);
    if (fs.existsSync(out)) throw new Error(`Output already exists: ${out}`);
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    writeJson(path.join(out, 'preflight-evidence.json'), evidence);
    fs.writeFileSync(path.join(out, 'preflight-evidence.sha256'), `${sha256(fs.readFileSync(path.join(out, 'preflight-evidence.json')))}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ status: evidence.status, planSha256, fixtureManifestSha256: evidence.fixtureManifestSha256, gates: evidence.gates, modelCalls: 0, paidProviderCalls: 0 }, null, 2)}\n`);
}

const repoRoot = path.resolve(__dirname, '..');
if (require.main === module) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { loadPipeline, main, parseArgs, runAdversarialControls, runOneFixture, runRegisteredProtocol, validateRegisteredReference };

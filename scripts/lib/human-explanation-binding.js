'use strict';

/**
 * Bind immutable human review explanations to their complete source spans.
 *
 * This module is preparation/evidence only.  A bound record is a test
 * expectation; it is never an accepted runtime rule and never authorizes a
 * production mutation.  In particular, scorer word-pair telemetry is kept in
 * a separate relationship table so an aggregate/repeated token cannot mint a
 * patch on its own.
 */

const crypto = require('crypto');
const { rowsOf, textHash } = require('./source-bound-preflight-v2');

const HUMAN_EXPLANATION_BINDING_VERSION = 'review-learning-human-explanation-binding-v1';
const REGISTRY_SCHEMA_VERSION = 1;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const jsonHash = (value) => sha256(Buffer.from(JSON.stringify(value), 'utf8'));
const utf8Length = (value) => Buffer.byteLength(`${value}`, 'utf8');
const codePointLength = (value) => [...`${value}`].length;

// The complete explanation is matched literally.  Tokenization is used only
// to relate an already-existing scorer signal; it never chooses a source span.
const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:[-'’][\p{L}\p{M}\p{N}]+)*/gu;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

function assertSha(value, label) {
    if (value === null || value === undefined) return null;
    if (!/^[a-f0-9]{64}$/u.test(`${value}`)) throw new Error(`${label} must be an exact SHA-256.`);
    return `${value}`;
}

function normalizeRows(datasetRows) {
    if (datasetRows instanceof Map) return new Map(datasetRows);
    if (!Array.isArray(datasetRows)) throw new Error('Dataset rows must be an array or Map.');
    const result = new Map();
    for (const row of datasetRows) {
        if (!row || typeof row.case_id !== 'string' || !row.case_id) throw new Error('Dataset rows require case_id.');
        if (result.has(row.case_id)) throw new Error(`Duplicate dataset case_id: ${row.case_id}.`);
        result.set(row.case_id, row);
    }
    return result;
}

function normalizeRevisions(sourceRevisions = {}) {
    if (sourceRevisions instanceof Map) return new Map(sourceRevisions);
    if (!sourceRevisions || typeof sourceRevisions !== 'object' || Array.isArray(sourceRevisions)) {
        throw new Error('Source revisions must be an object or Map.');
    }
    return new Map(Object.entries(sourceRevisions));
}

function normalizeMappings(cohortMappings) {
    const mappings = Array.isArray(cohortMappings)
        ? cohortMappings
        : cohortMappings?.motivatingExplanationMappings;
    if (!Array.isArray(mappings)) throw new Error('Trusted cohort mappings are required.');
    return mappings;
}

function findCompleteOccurrences(source, before) {
    const value = `${source}`;
    const target = `${before}`;
    if (!target) return [];
    const result = [];
    let from = 0;
    while (from <= value.length) {
        const start = value.indexOf(target, from);
        if (start < 0) break;
        const end = start + target.length;
        const previous = value[start - 1];
        const next = value[end];
        if ((!previous || !WORD_CHARACTER.test(previous)) && (!next || !WORD_CHARACTER.test(next))) {
            result.push({ startUtf16: start, endUtf16: end });
        }
        from = end || start + 1;
    }
    return result;
}

function rowForOffset(source, startUtf16) {
    return rowsOf(source).find((row) => startUtf16 >= row.startUtf16 && startUtf16 <= row.endUtf16) || null;
}

function spanRecord(source, before, after, occurrence, ordinal) {
    const row = rowForOffset(source, occurrence.startUtf16);
    return {
        rowIndex: row?.rowIndex ?? null,
        startUtf16: occurrence.startUtf16,
        endUtf16: occurrence.endUtf16,
        occurrenceOrdinal: ordinal,
        beforeText: before,
        beforeTextSha256: textHash(before),
        afterText: after,
        afterTextSha256: textHash(after),
    };
}

function tokenize(value) {
    return [...`${value}`.matchAll(TOKEN_PATTERN)].map((match) => ({
        token: match[0],
        tokenSha256: textHash(match[0]),
        startUtf16: match.index || 0,
        endUtf16: (match.index || 0) + match[0].length,
    }));
}

// Deterministic LCS diff.  Non-equal steps are coalesced so a phrase/space
// change remains one complete test expectation.  This is relationship data,
// not a source locator.
function tokenEditSegments(before, after) {
    const left = tokenize(before);
    const right = tokenize(after);
    const lcs = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = left.length - 1; i >= 0; i -= 1) {
        for (let j = right.length - 1; j >= 0; j -= 1) {
            lcs[i][j] = left[i].token === right[j].token ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const steps = [];
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
        if (i < left.length && j < right.length && left[i].token === right[j].token) {
            steps.push({ tag: 'equal', before: [left[i]], after: [right[j]] });
            i += 1;
            j += 1;
        } else if (i < left.length && (j >= right.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
            steps.push({ tag: 'delete', before: [left[i]], after: [] });
            i += 1;
        } else {
            steps.push({ tag: 'insert', before: [], after: [right[j]] });
            j += 1;
        }
    }
    const result = [];
    for (const step of steps) {
        if (step.tag === 'equal') {
            result.push(step);
            continue;
        }
        const previous = result[result.length - 1];
        if (previous && previous.tag !== 'equal') {
            previous.before.push(...step.before);
            previous.after.push(...step.after);
        } else result.push({ tag: 'change', before: [...step.before], after: [...step.after] });
    }
    return result.filter((step) => step.tag !== 'equal').map((step) => ({
        tag: step.before.length && step.after.length ? 'replace' : step.before.length ? 'delete' : 'insert',
        beforeTokenCount: step.before.length,
        afterTokenCount: step.after.length,
        beforeTokenSha256: step.before.map((token) => token.tokenSha256),
        afterTokenSha256: step.after.map((token) => token.tokenSha256),
    }));
}

function canonicalCorrectionHash(correction) {
    return jsonHash(correction);
}

function mappingIndex(mappings) {
    const byCorrectionId = new Map();
    const bySubmissionId = new Map();
    for (const mapping of mappings) {
        if (!mapping || typeof mapping.correctionId !== 'string' || !mapping.correctionId
            || typeof mapping.submissionId !== 'string' || !mapping.submissionId
            || typeof mapping.caseId !== 'string' || !mapping.caseId) continue;
        if (!byCorrectionId.has(mapping.correctionId)) byCorrectionId.set(mapping.correctionId, []);
        byCorrectionId.get(mapping.correctionId).push(mapping);
        if (!bySubmissionId.has(mapping.submissionId)) bySubmissionId.set(mapping.submissionId, []);
        bySubmissionId.get(mapping.submissionId).push(mapping);
    }
    return { byCorrectionId, bySubmissionId };
}

function sourceRevisionFor(revisions, caseId) {
    const value = revisions.get(caseId);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value;
}

function modelInputBinding(sourceRecord, revision, rawSourceSha256) {
    const declared = sourceRecord?.declaredPrecheckedSourceSha256 || sourceRecord?.precheckedSourceSha256 || null;
    const actual = sourceRecord?.actualPrechecked;
    const base = {
        status: 'unverified',
        reason: 'actual_prechecked_unavailable',
        declaredPrecheckedSourceSha256: declared,
        textSha256: null,
        rawSourceSha256: null,
        sourceRevisionId: null,
    };
    if (!actual || typeof actual !== 'object' || typeof actual.text !== 'string') return base;
    const actualSha = textHash(actual.text);
    if (actual.sha256 && actual.sha256 !== actualSha) return { ...base, status: 'invalid', reason: 'actual_prechecked_hash_mismatch', textSha256: actualSha };
    // A caller-provided `verified` boolean is not lineage evidence.  This
    // raw-binding batch has no trusted runtime-stage attestation, so even a
    // matching raw hash/revision remains explicitly unverified.
    return { ...base, reason: 'actual_prechecked_lineage_unverified', textSha256: actualSha,
        rawSourceSha256: actual.rawSourceSha256 || null, sourceRevisionId: actual.sourceRevisionId || null };
}

function correctionRecord(correction, mapping, rows, revisions, mappingState) {
    const correctionId = correction?.id;
    const record = {
        correctionId: correctionId || null,
        correctionRowId: correction?.correction_id || null,
        originalRecordSha256: canonicalCorrectionHash(correction || {}),
        // The registry is written into a restricted, read-only snapshot. Keep
        // the complete original row there so later reviewers can prove that no
        // explanation fields were dropped while ordinary logs remain hashed.
        originalRecord: correction ? { ...correction } : null,
        submissionId: correction?.submission_id || null,
        authority: { kind: 'human_explanation', source: correction?.source || null, status: correction?.status || null, acceptedRule: false },
        scope: {
            isLocationSpecific: correction?.is_location_specific === true,
            location: correction?.location || null,
            projectName: correction?.project_name || null,
            restaurantName: correction?.restaurant_name || null,
            appliesToMenuType: correction?.applies_to_menu_type || 'all',
            otherApplicableLocations: Array.isArray(correction?.other_applicable_locations) ? [...correction.other_applicable_locations] : [],
        },
        explanation: {
            rule: correction?.rule || null,
            changeType: correction?.change_type || null,
            originalText: typeof correction?.original_text === 'string' ? correction.original_text : null,
            correctedText: typeof correction?.corrected_text === 'string' ? correction.corrected_text : null,
        },
        mapping: mapping ? {
            correctionId: mapping.correctionId,
            submissionId: mapping.submissionId,
            caseId: mapping.caseId,
            correctionRowSha256: mapping.correctionRowSha256 || null,
            authority: mapping.authority || null,
        } : null,
        classification: { value: correction?.change_type || null, status: correction?.change_type ? 'provided' : 'pending' },
        verification: { status: 'unverified', reason: 'binding_only_preparation' },
        mutationAuthority: 'none',
        sourceMatch: { state: 'unresolved', occurrenceCount: 0, candidateSpans: [], reason: null },
        source: null,
        tokenEdits: [],
        expectedAfterSpanSha256: typeof correction?.corrected_text === 'string' ? textHash(correction.corrected_text) : null,
        eligibility: 'needs_source_history',
    };
    if (!correctionId || typeof correction?.submission_id !== 'string' || correction.source !== 'human'
        || typeof correction.original_text !== 'string' || typeof correction.corrected_text !== 'string') {
        record.sourceMatch = { state: 'invalid_correction', occurrenceCount: 0, candidateSpans: [], reason: 'missing_human_explanation_fields' };
        return record;
    }
    if (mappingState?.reason) {
        record.sourceMatch = { state: 'unresolved', occurrenceCount: 0, candidateSpans: [], reason: mappingState.reason };
        return record;
    }
    const row = rows.get(mapping.caseId);
    if (!row || typeof row.raw_input !== 'string') {
        record.sourceMatch = { state: 'unresolved', occurrenceCount: 0, candidateSpans: [], reason: 'mapped_case_missing' };
        return record;
    }
    const rawSource = row.raw_input;
    const rawSha = textHash(rawSource);
    const revision = sourceRevisionFor(revisions, mapping.caseId);
    if (!revision || typeof revision.id !== 'string' || !revision.id) {
        record.sourceMatch = { state: 'unresolved', occurrenceCount: 0, candidateSpans: [], reason: 'unknown_source_revision' };
    } else if (revision.sourceSha256 !== rawSha) {
        record.sourceMatch = { state: 'unresolved', occurrenceCount: 0, candidateSpans: [], reason: 'source_identity_mismatch' };
    } else {
        const occurrences = findCompleteOccurrences(rawSource, correction.original_text);
        const candidates = occurrences.map((occurrence, index) => spanRecord(rawSource, correction.original_text, correction.corrected_text, occurrence, index));
        record.sourceMatch = {
            state: occurrences.length === 1 ? 'exact_unique' : occurrences.length > 1 ? 'duplicate_exact' : 'not_found',
            occurrenceCount: occurrences.length,
            candidateSpans: candidates,
            reason: occurrences.length === 1 ? null : occurrences.length > 1 ? 'duplicate_complete_source_span' : 'human_original_text_not_found_in_raw_source',
        };
        if (occurrences.length === 1) {
            record.source = {
                rawSourceSha256: rawSha,
                rawUtf16Length: rawSource.length,
                rawCodePointLength: codePointLength(rawSource),
                rawUtf8ByteLength: utf8Length(rawSource),
                sourceRevision: {
                    id: revision.id,
                    sourceSha256: revision.sourceSha256,
                    utf16Length: revision.utf16Length ?? rawSource.length,
                    codePointLength: revision.codePointLength ?? codePointLength(rawSource),
                    utf8ByteLength: revision.utf8ByteLength ?? utf8Length(rawSource),
                },
                span: candidates[0],
            };
            record.eligibility = 'test_expectation_eligible';
        }
    }
    record.tokenEdits = tokenEditSegments(correction.original_text, correction.corrected_text);
    record.modelInput = modelInputBinding({
        declaredPrecheckedSourceSha256: revision?.precheckedSourceSha256 || row.precheckedSourceSha256 || null,
        actualPrechecked: row.actualPrechecked || null,
    }, revision, rawSha);
    return record;
}

function hasSplitMergeEvidence(signal, rows) {
    const row = rows.get(signal.caseId);
    if (!row || typeof row.raw_input !== 'string' || typeof row.ground_truth !== 'string') return false;
    const sourceTokens = tokenize(row.raw_input);
    const targetTokens = tokenize(row.ground_truth);
    const targetWords = targetTokens.filter((token) => token.tokenSha256 === signal.toSha256);
    if (!targetWords.length) return false;
    for (const token of sourceTokens.filter((item) => item.tokenSha256 === signal.fromSha256)) {
        const index = sourceTokens.indexOf(token);
        for (const neighbour of [sourceTokens[index - 1], sourceTokens[index + 1]]) {
            if (!neighbour) continue;
            const start = Math.min(token.endUtf16, neighbour.endUtf16);
            const end = Math.max(token.startUtf16, neighbour.startUtf16);
            if (end < start) continue;
            const between = row.raw_input.slice(start, end);
            if (!/^\s+$/u.test(between)) continue;
            const left = token.startUtf16 < neighbour.startUtf16 ? token : neighbour;
            const right = token.startUtf16 < neighbour.startUtf16 ? neighbour : token;
            const combined = `${left.token}${right.token}`;
            if (targetWords.some((target) => target.token === combined)) return true;
        }
    }
    return false;
}

function relationForSignal(signal, records, rows) {
    const fromSha = signal.fromSha256 || (signal.from ? textHash(signal.from) : null);
    const toSha = signal.toSha256 || (signal.to ? textHash(signal.to) : null);
    const links = [];
    const malformed = [];
    for (const record of records.filter((item) => item.mapping?.caseId === signal.caseId)) {
        const matching = [];
        for (const segment of record.tokenEdits) {
            const pair = segment.beforeTokenCount === 1 && segment.afterTokenCount === 1
                && segment.beforeTokenSha256[0] === fromSha && segment.afterTokenSha256[0] === toSha;
            const alignedPair = segment.beforeTokenCount === segment.afterTokenCount
                && segment.beforeTokenSha256.some((hash, index) => hash === fromSha && segment.afterTokenSha256[index] === toSha);
            if (pair || alignedPair) matching.push(segment);
            const sourceInside = segment.beforeTokenSha256.includes(fromSha);
            const targetInside = segment.afterTokenSha256.includes(toSha);
            if (!pair && sourceInside && targetInside) malformed.push(record);
        }
        if (matching.length) links.push(record);
    }
    const uniqueLinks = [...new Map(links.map((record) => [record.correctionId, record])).values()];
    const uniqueMalformed = [...new Map(malformed.map((record) => [record.correctionId, record])).values()]
        .filter((record) => !uniqueLinks.includes(record));
    let relationship = 'observed_only';
    let unsupportedReason = 'no_human_explanation_token_pair';
    if (uniqueLinks.length) {
        const exact = uniqueLinks.filter((record) => record.sourceMatch.state === 'exact_unique');
        const nonExact = uniqueLinks.filter((record) => record.sourceMatch.state !== 'exact_unique');
        if (signal.status === 'ambiguous_unresolved') {
            relationship = 'supported_human_subset_repeated_aggregate';
            unsupportedReason = 'aggregate_signal_has_repeated_source_occurrences_without_explicit_ordinal_for_each_occurrence';
        } else if (exact.length) {
            relationship = 'supported_human_occurrence';
            unsupportedReason = null;
        } else if (nonExact.length) {
            relationship = 'context_near_lead_only';
            unsupportedReason = 'human_original_text_not_exactly_bound_to_raw_source';
        }
    } else if (uniqueMalformed.length) {
        relationship = 'malformed_fragment';
        unsupportedReason = 'scorer_fragment_does_not_cover_complete_human_phrase';
    } else if (hasSplitMergeEvidence(signal, rows)) {
        relationship = 'malformed_fragment';
        unsupportedReason = 'scorer_fragment_tracks_one_side_of_a_split_merge_boundary';
    }
    return {
        expectationId: signal.expectationId || null,
        caseId: signal.caseId || null,
        signalIndex: signal.signalIndex ?? null,
        legacySignal: { ...signal },
        fromSha256: fromSha,
        toSha256: toSha,
        relationship,
        correctionIds: uniqueLinks.map((record) => record.correctionId),
        malformedCorrectionIds: uniqueMalformed.map((record) => record.correctionId),
        supportedExactSpanCount: uniqueLinks.filter((record) => record.sourceMatch.state === 'exact_unique').length,
        unsupportedReason,
    };
}

function registryInputBindings(options, corrections, datasetRows, mappings) {
    const inputHashes = options.inputHashes || {};
    return {
        correctionsSha256: assertSha(inputHashes.correctionsSha256 || jsonHash(corrections), 'Corrections input hash'),
        datasetSha256: assertSha(inputHashes.datasetSha256 || jsonHash([...datasetRows.values()]), 'Dataset input hash'),
        cohortsSha256: assertSha(inputHashes.cohortsSha256 || jsonHash(mappings), 'Cohorts input hash'),
        sourceManifestSha256: assertSha(inputHashes.sourceManifestSha256 || null, 'Source manifest input hash'),
    };
}

function bindHumanExplanationRegistry(options = {}) {
    const corrections = options.corrections;
    if (!Array.isArray(corrections)) throw new Error('Corrections must be an array.');
    const rows = normalizeRows(options.datasetRows);
    const mappings = normalizeMappings(options.cohortMappings);
    const revisions = normalizeRevisions(options.sourceRevisions || {});
    const { byCorrectionId, bySubmissionId } = mappingIndex(mappings);
    const correctionIds = new Set();
    const records = corrections.map((correction) => {
        if (correctionIds.has(correction?.id)) {
            return correctionRecord(correction, null, rows, revisions, { reason: 'duplicate_correction_id' });
        }
        correctionIds.add(correction?.id);
        const matches = byCorrectionId.get(correction?.id) || [];
        const submissionMatches = bySubmissionId.get(correction?.submission_id) || [];
        const cases = new Set(matches.map((item) => item.caseId));
        const submissionCases = new Set(submissionMatches.map((item) => item.caseId));
        let mappingState = null;
        if (matches.length !== 1) mappingState = { reason: matches.length ? 'ambiguous_correction_mapping' : 'missing_correction_mapping' };
        else if (matches[0].submissionId !== correction?.submission_id) mappingState = { reason: 'correction_submission_mapping_conflict' };
        else if (cases.size !== 1 || submissionCases.size > 1) mappingState = { reason: 'ambiguous_submission_case_mapping' };
        const mapping = matches.length === 1 ? matches[0] : null;
        return correctionRecord(correction, mapping, rows, revisions, mappingState);
    });
    const scorerSignals = Array.isArray(options.scorerSignals) ? options.scorerSignals : [];
    const relationships = scorerSignals.map((signal) => relationForSignal(signal, records, rows));
    const membership = {
        correctionCount: records.length,
        correctionIds: records.map((record) => record.correctionId),
        uniqueCorrectionIds: new Set(records.map((record) => record.correctionId)).size,
        scorerSignalCount: relationships.length,
        scorerExpectationIds: relationships.map((relationship) => relationship.expectationId),
    };
    return {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        bindingVersion: HUMAN_EXPLANATION_BINDING_VERSION,
        inputBindings: registryInputBindings(options, corrections, rows, mappings),
        membership,
        corrections: records,
        scorerRelationships: relationships,
        provenance: {
            source: 'trusted-frozen-human-explanations',
            authority: 'human_explanation',
            preparationOnly: true,
            mutationAuthority: 'none',
            actualPrecheckedStage: 'unverified_no_trusted_runtime_lineage',
        },
    };
}

function validateHumanExplanationRegistry(registry, expected = {}) {
    const errors = [];
    if (!registry || registry.schemaVersion !== REGISTRY_SCHEMA_VERSION) errors.push('registry:schema_version');
    if (registry?.bindingVersion !== HUMAN_EXPLANATION_BINDING_VERSION) errors.push('registry:binding_version');
    if (!Array.isArray(registry?.corrections)) errors.push('registry:corrections_missing');
    if (!Array.isArray(registry?.scorerRelationships)) errors.push('registry:scorer_relationships_missing');
    const records = registry?.corrections || [];
    const ids = records.map((record) => record.correctionId);
    if (new Set(ids).size !== ids.length) errors.push('registry:duplicate_correction_id');
    if (registry?.membership?.correctionCount !== records.length) errors.push('registry:membership_correction_count');
    if (registry?.membership?.uniqueCorrectionIds !== new Set(ids).size) errors.push('registry:membership_unique_correction_count');
    if (expected.inputHashes) {
        for (const key of ['correctionsSha256', 'datasetSha256', 'cohortsSha256', 'sourceManifestSha256']) {
            if (expected.inputHashes[key] && registry.inputBindings?.[key] !== expected.inputHashes[key]) errors.push(`registry:input_hash:${key}`);
        }
    }
    const expectedCorrections = Array.isArray(expected.corrections) ? expected.corrections : null;
    const expectedById = new Map((expectedCorrections || []).map((row) => [row.id, row]));
    const expectedRows = expected.datasetRows ? normalizeRows(expected.datasetRows) : null;
    const expectedRevisions = expected.sourceRevisions ? normalizeRevisions(expected.sourceRevisions) : null;
    const expectedMappings = expected.cohortMappings ? normalizeMappings(expected.cohortMappings) : null;
    const expectedMappingIndex = expectedMappings ? mappingIndex(expectedMappings).byCorrectionId : null;

    // When all trusted inputs are available, rebuild the complete registry and
    // compare every derived field.  Checking only hashes, IDs, or legacy
    // signals is insufficient: a forged rule/scope/model-input or scorer
    // relationship can otherwise survive validation.
    const hasCanonicalInputs = Boolean(expectedCorrections && expectedRows && expectedMappings && expectedRevisions);
    if (hasCanonicalInputs) {
        const canonicalSignals = Array.isArray(expected.scorerSignals) ? expected.scorerSignals : [];
        const rebuilt = bindHumanExplanationRegistry({
            corrections: expectedCorrections,
            datasetRows: expected.datasetRows,
            cohortMappings: expectedMappings,
            sourceRevisions: expected.sourceRevisions,
            scorerSignals: canonicalSignals,
            inputHashes: registry.inputBindings,
        });
        const derivedKeys = [
            'correctionId', 'correctionRowId', 'originalRecordSha256', 'originalRecord',
            'submissionId', 'authority', 'scope', 'explanation', 'mapping',
            'classification', 'verification', 'mutationAuthority', 'sourceMatch',
            'source', 'tokenEdits', 'expectedAfterSpanSha256', 'eligibility', 'modelInput',
        ];
        const rebuiltById = new Map(rebuilt.corrections.map((record) => [record.correctionId, record]));
        for (const record of records) {
            const canonical = rebuiltById.get(record.correctionId);
            if (!canonical) {
                errors.push(`correction:${record.correctionId}:derived_drift`);
                continue;
            }
            for (const key of derivedKeys) {
                if (JSON.stringify(record[key]) !== JSON.stringify(canonical[key])) {
                    errors.push(`correction:${record.correctionId}:derived_drift:${key}`);
                    if (key === 'source') errors.push(`correction:${record.correctionId}:source_span_binding`);
                }
            }
        }
        for (const key of ['membership', 'inputBindings', 'provenance']) {
            if (JSON.stringify(registry[key]) !== JSON.stringify(rebuilt[key])) errors.push(`registry:${key}_drift`);
        }
        if (JSON.stringify(registry.scorerRelationships) !== JSON.stringify(rebuilt.scorerRelationships)) {
            errors.push('registry:scorer_relationships_drift');
        }
    }
    if (expectedCorrections && (records.length !== expectedCorrections.length || ids.some((id) => !expectedById.has(id)))) errors.push('registry:correction_membership');
    for (const record of records) {
        const original = expectedById.get(record.correctionId);
        if (original && record.originalRecordSha256 !== canonicalCorrectionHash(original)) errors.push(`correction:${record.correctionId}:original_hash`);
        if (original && JSON.stringify(record.originalRecord) !== JSON.stringify(original)) errors.push(`correction:${record.correctionId}:original_record`);
        if (record.authority?.kind !== 'human_explanation' || record.authority?.acceptedRule !== false) errors.push(`correction:${record.correctionId}:authority`);
        if (record.mutationAuthority !== 'none') errors.push(`correction:${record.correctionId}:mutation_authority`);
        if (original && (record.explanation?.originalText !== original.original_text || record.explanation?.correctedText !== original.corrected_text)) {
            errors.push(`correction:${record.correctionId}:explanation_text`);
        }
        if (expectedMappingIndex) {
            const mappingMatches = expectedMappingIndex.get(record.correctionId) || [];
            if (mappingMatches.length === 1 && (!record.mapping || JSON.stringify(record.mapping) !== JSON.stringify(mappingMatches[0]))) {
                errors.push(`correction:${record.correctionId}:mapping_membership`);
            } else if (mappingMatches.length !== 1 && record.mapping !== null) {
                errors.push(`correction:${record.correctionId}:mapping_membership`);
            }
        }
        // Source state, exact spans, and revision identity are covered by the
        // canonical rebuild above when trusted inputs are supplied.  Retain
        // only structural span checks below for partial-validation callers;
        // do not infer an exact state from raw text when a mapping/revision is
        // missing or conflicting.
        if (record.sourceMatch?.state === 'exact_unique') {
            const span = record.source?.span;
            if (!span || !Number.isInteger(span.startUtf16) || !Number.isInteger(span.endUtf16)
                || span.endUtf16 <= span.startUtf16 || span.occurrenceOrdinal !== 0
                || span.beforeTextSha256 !== textHash(span.beforeText || '') || span.afterTextSha256 !== textHash(span.afterText || '')) {
                errors.push(`correction:${record.correctionId}:span_integrity`);
            }
            if (record.eligibility !== 'test_expectation_eligible') errors.push(`correction:${record.correctionId}:eligibility`);
        }
        if (record.modelInput?.status === 'verified' && (!record.modelInput.rawSourceSha256 || !record.modelInput.sourceRevisionId)) errors.push(`correction:${record.correctionId}:model_input_lineage`);
    }
    const expectedSignals = Array.isArray(expected.scorerSignals) ? expected.scorerSignals : null;
    if (expectedSignals && registry.scorerRelationships.length !== expectedSignals.length) errors.push('registry:scorer_membership');
    if (expectedSignals) {
        const expectedIds = expectedSignals.map((signal) => signal.expectationId);
        const actualIds = registry.scorerRelationships.map((signal) => signal.expectationId);
        if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) errors.push('registry:scorer_ids');
        for (let index = 0; index < Math.min(expectedSignals.length, registry.scorerRelationships.length); index += 1) {
            const actual = registry.scorerRelationships[index];
            const expectedSignal = expectedSignals[index];
            if (JSON.stringify(actual.legacySignal) !== JSON.stringify(expectedSignal)) errors.push(`signal:${actual.expectationId}:legacy_drift`);
        }
    }
    return { valid: errors.length === 0, errors: [...new Set(errors)], membership: registry?.membership || null };
}

module.exports = {
    HUMAN_EXPLANATION_BINDING_VERSION,
    REGISTRY_SCHEMA_VERSION,
    canonicalCorrectionHash,
    findCompleteOccurrences,
    jsonHash,
    textHash,
    tokenize,
    tokenEditSegments,
    bindHumanExplanationRegistry,
    validateHumanExplanationRegistry,
};

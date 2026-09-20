'use strict';

/**
 * Source-bound synthetic preflight v2.
 *
 * This module is deliberately independent of the review pipeline. It validates
 * immutable, source-coordinate fixtures before a synthetic response can be
 * handed to a worker. A fixture may carry an explicitly registered occurrence,
 * but fixture metadata never grants production authority.
 */

const crypto = require('crypto');

const SOURCE_BOUND_PREFLIGHT_VERSION = 'review-learning-source-bound-preflight-v2';
const FIXTURE_SCHEMA_VERSION = 2;
const MARKERS = Object.freeze({
    correctedStart: '=== CORRECTED MENU ===',
    correctedEnd: '=== END CORRECTED MENU ===',
    suggestionsStart: '=== SUGGESTIONS ===',
    suggestionsEnd: '=== END SUGGESTIONS ===',
});

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const textHash = (value) => sha256(Buffer.from(`${value}`, 'utf8'));
const jsonHash = (value) => textHash(JSON.stringify(value));
const codePointLength = (value) => [...`${value}`].length;
const utf8Length = (value) => Buffer.byteLength(`${value}`, 'utf8');

function rowsOf(text) {
    let startUtf16 = 0;
    return `${text}`.split('\n').map((row, rowIndex) => {
        const value = { rowIndex, text: row, startUtf16, endUtf16: startUtf16 + row.length };
        startUtf16 = value.endUtf16 + 1;
        return value;
    });
}

function revisionFor(source, revisionId = null) {
    const value = `${source}`;
    const sourceSha256 = textHash(value);
    return {
        id: revisionId || `SB-RR-${textHash(JSON.stringify([SOURCE_BOUND_PREFLIGHT_VERSION, sourceSha256])).slice(0, 32)}`,
        sourceSha256,
        utf16Length: value.length,
        codePointLength: codePointLength(value),
        utf8ByteLength: utf8Length(value),
    };
}

function lexicalToken(value) {
    return /^[-'’\p{L}\p{M}]+$/u.test(`${value}`) && /\p{L}/u.test(`${value}`);
}

function tokenSpans(value) {
    const source = `${value}`;
    const pattern = /[\p{L}\p{M}][-'’\p{L}\p{M}]*/gu;
    return [...source.matchAll(pattern)].map((match, index) => ({
        tokenIndex: index,
        token: match[0],
        startUtf16: match.index || 0,
        endUtf16: (match.index || 0) + match[0].length,
    }));
}

/** Replace lexical runs with a sentinel while preserving all layout/syntax. */
function structuralSkeleton(value) {
    return `${value}`.replace(/[\p{L}\p{M}][-'’\p{L}\p{M}]*/gu, '\u0000');
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
    return leftStart < rightEnd && rightStart < leftEnd;
}

// Derive immutable numeric/price/allergen/unit spans from the source itself.
// Caller-supplied protectedSpans may add restrictions, but cannot remove these.
function derivedProtectedSpans(source) {
    const value = `${source}`;
    const spans = [...value.matchAll(/(?:[$€£¥₹]|\b(?:USD|EUR|GBP)[ \t]*)?\d[\d,./:+\-–—]*(?:[ \t]*[A-Za-z]{1,8})?/gu)]
        .map(match => ({ startUtf16: match.index || 0, endUtf16: (match.index || 0) + match[0].length, classification: 'source-derived-numeric-price-unit' }));
    for (const token of tokenSpans(value)) {
        if (spans.some(span => token.startUtf16 >= span.startUtf16 - 1 && token.endUtf16 <= span.endUtf16 + 1)) {
            spans.push({ startUtf16: token.startUtf16, endUtf16: token.endUtf16, classification: 'source-derived-numeric-price-unit' });
        }
    }
    const unique = new Map(spans.map(span => [`${span.startUtf16}:${span.endUtf16}`, span]));
    return [...unique.values()].sort((a, b) => a.startUtf16 - b.startUtf16 || a.endUtf16 - b.endUtf16);
}

function occurrenceOrdinal(source, before, startUtf16) {
    const spans = tokenSpans(source).filter((span) => span.token === before);
    const index = spans.findIndex((span) => span.startUtf16 === startUtf16);
    return { count: spans.length, ordinal: index < 0 ? null : index };
}

function normalizeSpan(span, label) {
    if (!span || !Number.isInteger(span.startUtf16) || !Number.isInteger(span.endUtf16)
        || span.startUtf16 < 0 || span.endUtf16 <= span.startUtf16) {
        throw new Error(`${label} must be a non-empty UTF-16 half-open span.`);
    }
    return { startUtf16: span.startUtf16, endUtf16: span.endUtf16,
        classification: span.classification || null, sourceText: span.sourceText || null };
}

function applySourceMutations(fixture) {
    const source = `${fixture.source || ''}`;
    const revision = fixture.sourceRevision || revisionFor(source);
    const errors = [];
    const mutations = Array.isArray(fixture.mutations) ? fixture.mutations : [];
    const protectedSpans = (fixture.protectedSpans || []).map((span, index) => normalizeSpan(span, `protectedSpans[${index}]`));
    const readOnlySpans = (fixture.readOnlySpans || []).map((span, index) => normalizeSpan(span, `readOnlySpans[${index}]`));
    const sourceDerivedProtectedSpans = derivedProtectedSpans(source);
    const ordered = [...mutations].sort((a, b) => (a.startUtf16 || 0) - (b.startUtf16 || 0));
    let previousEnd = -1;
    const seenSpans = new Set();
    for (let index = 0; index < ordered.length; index += 1) {
        const mutation = ordered[index];
        const label = `mutations[${index}]`;
        if (!Number.isInteger(mutation.startUtf16) || !Number.isInteger(mutation.endUtf16)
            || mutation.startUtf16 < 0 || mutation.endUtf16 <= mutation.startUtf16
            || mutation.endUtf16 > source.length) {
            errors.push(`${label}:invalid_utf16_span`);
            continue;
        }
        if (mutation.startUtf16 < previousEnd) errors.push(`${label}:overlapping_span`);
        previousEnd = Math.max(previousEnd, mutation.endUtf16);
        const spanKey = `${mutation.startUtf16}:${mutation.endUtf16}`;
        if (seenSpans.has(spanKey)) errors.push(`${label}:duplicate_span`);
        seenSpans.add(spanKey);
        if (mutation.sourceRevisionId !== revision.id) errors.push(`${label}:stale_source_revision`);
        if (typeof mutation.before !== 'string' || typeof mutation.after !== 'string') errors.push(`${label}:missing_before_after`);
        if (typeof mutation.before === 'string' && source.slice(mutation.startUtf16, mutation.endUtf16) !== mutation.before) errors.push(`${label}:source_anchor_mismatch`);
        if (typeof mutation.before === 'string' && !lexicalToken(mutation.before)) errors.push(`${label}:nonlexical_before`);
        if (typeof mutation.after === 'string' && !lexicalToken(mutation.after)) errors.push(`${label}:nonlexical_after`);
        if (typeof mutation.after === 'string' && /\r|\n/u.test(mutation.after)) errors.push(`${label}:layout_insertion`);
        if (!mutation.provenance || typeof mutation.provenance !== 'object'
            || typeof mutation.provenance.source !== 'string' || !mutation.provenance.source.trim()
            || typeof mutation.provenance.expectationId !== 'string' || !mutation.provenance.expectationId.trim()) {
            errors.push(`${label}:missing_provenance`);
        }
        for (const span of protectedSpans) if (rangesOverlap(mutation.startUtf16, mutation.endUtf16, span.startUtf16, span.endUtf16)) errors.push(`${label}:protected_span`);
        for (const span of readOnlySpans) if (rangesOverlap(mutation.startUtf16, mutation.endUtf16, span.startUtf16, span.endUtf16)) errors.push(`${label}:read_only_span`);
        for (const span of sourceDerivedProtectedSpans) if (rangesOverlap(mutation.startUtf16, mutation.endUtf16, span.startUtf16, span.endUtf16)) errors.push(`${label}:derived_protected_span`);
        const ordinal = typeof mutation.before === 'string' ? occurrenceOrdinal(source, mutation.before, mutation.startUtf16) : { count: 0, ordinal: null };
        if (ordinal.ordinal === null) errors.push(`${label}:occurrence_not_identified`);
        if (ordinal.count > 1 && !Number.isInteger(mutation.occurrenceOrdinal)) errors.push(`${label}:ambiguous_occurrence`);
        if (ordinal.ordinal !== null && Number.isInteger(mutation.occurrenceOrdinal) && ordinal.ordinal !== mutation.occurrenceOrdinal) errors.push(`${label}:occurrence_ordinal_mismatch`);
        if (typeof mutation.sourceTokenSha256 === 'string' && typeof mutation.before === 'string' && textHash(mutation.before) !== mutation.sourceTokenSha256) errors.push(`${label}:source_token_hash`);
    }
    if (structuralSkeleton(source) !== structuralSkeleton(fixture.correctedBlock || '')) errors.push('corrected_block:structural_skeleton_changed');
    if (fixture.correctedBlock === source && mutations.length) errors.push('corrected_block:mutations_not_applied');
    let corrected = source;
    if (!errors.length) for (const mutation of [...ordered].reverse()) corrected = corrected.slice(0, mutation.startUtf16) + mutation.after + corrected.slice(mutation.endUtf16);
    if (!errors.length && corrected !== fixture.correctedBlock) errors.push('corrected_block:mutation_result_mismatch');
    if (fixture.correctedBlockSha256 && textHash(fixture.correctedBlock) !== fixture.correctedBlockSha256) errors.push('corrected_block:hash_mismatch');
    if (fixture.sourceSha256 && textHash(source) !== fixture.sourceSha256) errors.push('source:hash_mismatch');
    if (fixture.rawSourceSha256 && textHash(source) !== fixture.rawSourceSha256) errors.push('raw_source:hash_mismatch');
    if (fixture.precheckedSourceSha256 && textHash(source) !== fixture.precheckedSourceSha256) errors.push('prechecked_source:hash_mismatch');
    if (revision.sourceSha256 !== textHash(source) || revision.utf16Length !== source.length
        || revision.codePointLength !== codePointLength(source) || revision.utf8ByteLength !== utf8Length(source)) errors.push('source_revision:coordinate_mismatch');
    return { valid: errors.length === 0, errors: [...new Set(errors)], corrected, revision, protectedSpans, readOnlySpans, sourceDerivedProtectedSpans };
}

function buildSourceBoundFixture({ caseId, lane, source, mutations, expectedOutcome = 'apply', provenance = {}, protectedSpans = [], readOnlySpans = [], registeredOccurrence = null, context = { property: 'synthetic-source-bound', templateType: 'food', menuType: 'standard', allergens: '' } }) {
    const revision = revisionFor(source);
    const preparedMutations = (mutations || []).map((mutation) => ({
        ...mutation,
        sourceRevisionId: mutation.sourceRevisionId || revision.id,
        sourceTokenSha256: mutation.sourceTokenSha256 || textHash(mutation.before),
        provenance: mutation.provenance || { source: provenance.source || 'synthetic-explicit-mutation', expectationId: provenance.expectationId || caseId },
    }));
    let correctedBlock = `${source}`;
    for (const mutation of [...preparedMutations].sort((a, b) => b.startUtf16 - a.startUtf16)) correctedBlock = correctedBlock.slice(0, mutation.startUtf16) + mutation.after + correctedBlock.slice(mutation.endUtf16);
    const fixture = {
        schemaVersion: FIXTURE_SCHEMA_VERSION,
        contractVersion: SOURCE_BOUND_PREFLIGHT_VERSION,
        caseId,
        lane,
        source,
        sourceSha256: textHash(source),
        rawSourceSha256: textHash(source),
        precheckedSourceSha256: textHash(source),
        context,
        sourceRevision: revision,
        mutations: preparedMutations,
        protectedSpans,
        readOnlySpans,
        correctedBlock,
        correctedBlockSha256: textHash(correctedBlock),
        expectedOutcome,
        simulatedResponse: { status: 200, finishReason: 'stop' },
        registeredOccurrence,
        provenance: { source: provenance.source || 'synthetic-fixture', expectationId: provenance.expectationId || caseId },
    };
    const response = responseForFixture(fixture);
    return { ...fixture, response, responseSha256: textHash(response) };
}

function responseForFixture(fixture) {
    return [MARKERS.correctedStart, fixture.correctedBlock, MARKERS.correctedEnd, '', MARKERS.suggestionsStart, '[]', MARKERS.suggestionsEnd].join('\n');
}

function parseCorrectedBlock(feedback) {
    const value = `${feedback || ''}`;
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = value.match(new RegExp(`${escape(MARKERS.correctedStart)}\\n([\\s\\S]*?)\\n${escape(MARKERS.correctedEnd)}`));
    return match ? match[1] : null;
}

function validateResponseForFixture(fixture, feedback, options = {}) {
    const corrected = parseCorrectedBlock(feedback);
    const errors = [];
    if (corrected === null) errors.push('missing_corrected_block');
    if (corrected !== null && corrected !== fixture.correctedBlock) errors.push('response_corrected_block_mismatch');
    if (fixture.expectedOutcome === 'apply') {
        if (corrected !== fixture.correctedBlock) errors.push('positive_expected_block_not_delivered');
    } else if (corrected !== fixture.source) {
        errors.push('held_expected_source_not_preserved');
    }
    if (options.requireNoInternalRecords && /sourceOccurrenceId|recordSchemaVersion|"internal"\s*:\s*true/u.test(`${feedback || ''}`)) errors.push('internal_record_visible');
    if (fixture.response && feedback !== fixture.response) errors.push('response_bytes_mismatch');
    if (fixture.responseSha256 && textHash(feedback) !== fixture.responseSha256) errors.push('response_hash_mismatch');
    return { valid: errors.length === 0, errors: [...new Set(errors)], corrected };
}

function validateAdversarialControl({ source, humanFinal, expectedReason = 'human_final_not_source_bound' }) {
    const corrected = `${humanFinal || ''}`;
    // Any byte difference is intentionally unauthorized here, including a
    // same-row content edit whose lexical skeleton happens to match.
    const substantive = `${source}` !== corrected;
    return {
        valid: substantive && corrected !== source,
        authorized: false,
        reason: expectedReason,
        sourceSha256: textHash(source),
        humanFinalSha256: textHash(corrected),
        sourceRows: source.split('\n').length,
        humanFinalRows: corrected.split('\n').length,
        contentChanged: `${source}` !== corrected,
        layoutChanged: source.split('\n').length !== corrected.split('\n').length,
        lexicalSkeletonChanged: structuralSkeleton(source) !== structuralSkeleton(corrected),
        substantiveDifference: substantive,
    };
}

function validateManifest(manifest, options = {}) {
    const errors = [];
    if (!manifest || manifest.schemaVersion !== FIXTURE_SCHEMA_VERSION) errors.push('manifest:schema_version');
    if (manifest?.contractVersion !== SOURCE_BOUND_PREFLIGHT_VERSION) errors.push('manifest:contract_version');
    if (!Array.isArray(manifest?.cases) || !manifest.cases.length) errors.push('manifest:cases_missing');
    const seen = new Set();
    const caseResults = [];
    for (const fixture of manifest?.cases || []) {
        if (!fixture.caseId || seen.has(fixture.caseId)) errors.push(`manifest:duplicate_case:${fixture.caseId || '(missing)'}`);
        seen.add(fixture.caseId);
        const result = applySourceMutations(fixture);
        caseResults.push({ caseId: fixture.caseId, lane: fixture.lane, expectedOutcome: fixture.expectedOutcome, ...result, sourceSha256: textHash(fixture.source), correctedBlockSha256: textHash(fixture.correctedBlock) });
        errors.push(...result.errors.map((error) => `${fixture.caseId}:${error}`));
        if (fixture.response) {
            const responseResult = validateResponseForFixture(fixture, fixture.response, { requireNoInternalRecords: true });
            errors.push(...responseResult.errors.map((error) => `${fixture.caseId}:${error}`));
        }
        if (!['general_ai_equal_row', 'scoped_deterministic_rule', 'registered_contextual_near_miss'].includes(fixture.lane)) errors.push(`${fixture.caseId}:unknown_lane`);
        if (!fixture.context || typeof fixture.context.property !== 'string' || typeof fixture.context.templateType !== 'string' || typeof fixture.context.menuType !== 'string') errors.push(`${fixture.caseId}:missing_runtime_context`);
        if (fixture.expectedOutcome === 'apply' && !fixture.mutations?.length) errors.push(`${fixture.caseId}:apply_without_mutation`);
        if (!fixture.simulatedResponse || fixture.simulatedResponse.status !== 200 || fixture.simulatedResponse.finishReason !== 'stop') errors.push(`${fixture.caseId}:simulated_response_identity`);
        if (fixture.lane === 'registered_contextual_near_miss') {
            if (!fixture.registeredOccurrence || typeof fixture.registeredOccurrence.sourceOccurrenceId !== 'string' || !fixture.registeredOccurrence.sourceOccurrenceId.trim()) errors.push(`${fixture.caseId}:missing_registered_occurrence`);
            if (!['corrected', 'valid_as_written', 'uncertain_candidate', 'unresolved_nonword'].includes(fixture.registeredOccurrence?.disposition)) errors.push(`${fixture.caseId}:invalid_registered_disposition`);
        }
    }
    const coverage = manifest?.originalCoverage;
    if (!coverage || !Array.isArray(coverage.items) || !coverage.items.length) errors.push('manifest:original_coverage_missing');
    const coverageIds = new Set();
    const casesById = new Map((manifest?.cases || []).map(fixture => [fixture.caseId, fixture]));
    for (const item of coverage?.items || []) {
        if (!item.expectationId || coverageIds.has(item.expectationId)) errors.push(`coverage:duplicate_or_missing:${item.expectationId || '(missing)'}`);
        coverageIds.add(item.expectationId);
        if (!['source_bound_included', 'partial_source_bound', 'unsupported_new_content', 'unsupported_protected_or_numeric', 'ambiguous_unresolved'].includes(item.status)) errors.push(`coverage:${item.expectationId}:invalid_status`);
        if (item.status !== 'source_bound_included' && item.status !== 'partial_source_bound' && !item.reason) errors.push(`coverage:${item.expectationId}:missing_reason`);
        if (item.status === 'source_bound_included') {
            const fixture = casesById.get(item.expectationId);
            if (!fixture) errors.push(`coverage:${item.expectationId}:missing_source_bound_fixture`);
            else {
                if (fixture.rawSourceSha256 && fixture.rawSourceSha256 !== item.rawSourceSha256) errors.push(`coverage:${item.expectationId}:raw_source_identity_mismatch`);
                const matching = (fixture.mutations || []).filter(mutation => mutation.sourceTokenSha256 === item.fromSha256
                    && textHash(mutation.after) === item.toSha256
                    && mutation.provenance?.expectationId === item.expectationId
                    && mutation.startUtf16 === item.sourceOccurrence?.startUtf16
                    && mutation.endUtf16 === item.sourceOccurrence?.endUtf16);
                if (matching.length !== 1) errors.push(`coverage:${item.expectationId}:mutation_linkage_mismatch`);
            }
        }
    }
    for (const fixture of manifest?.cases || []) {
        if (fixture.caseId && fixture.caseId.includes(':signal:') && !coverageIds.has(fixture.caseId)) errors.push(`coverage:unlisted_fixture:${fixture.caseId}`);
    }
    const requiredCoverage = Number.isInteger(options.requiredCoverageCount) ? options.requiredCoverageCount : coverage?.items?.length || 0;
    const completeCoverage = !!coverage && coverage.items.length === requiredCoverage && coverage.items.every((item) => item.status === 'source_bound_included');
    if (options.requireCompleteCoverage && !completeCoverage) errors.push('coverage:incomplete_required_membership');
    return {
        valid: errors.length === 0,
        positiveGate: errors.length === 0 && completeCoverage,
        errors: [...new Set(errors)],
        caseResults,
        coverage: {
            count: coverage?.items?.length || 0,
            complete: completeCoverage,
            statusCounts: (coverage?.items || []).reduce((out, item) => { out[item.status] = (out[item.status] || 0) + 1; return out; }, {}),
        },
    };
}

module.exports = {
    FIXTURE_SCHEMA_VERSION,
    MARKERS,
    SOURCE_BOUND_PREFLIGHT_VERSION,
    applySourceMutations,
    buildSourceBoundFixture,
    codePointLength,
    jsonHash,
    parseCorrectedBlock,
    responseForFixture,
    revisionFor,
    structuralSkeleton,
    textHash,
    utf8Length,
    validateAdversarialControl,
    validateManifest,
    validateResponseForFixture,
    rowsOf,
};

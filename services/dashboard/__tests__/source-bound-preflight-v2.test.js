'use strict';

const {
    applySourceMutations,
    buildSourceBoundFixture,
    responseForFixture,
    textHash,
    validateAdversarialControl,
    validateManifest,
    validateResponseForFixture,
} = require('../../../scripts/lib/source-bound-preflight-v2');
const { parseArgs, signalCoverage } = require('../../../scripts/prepare-source-bound-preflight-v2');

const coverageItems = (statuses, fixture) => statuses.map((status, index) => ({
    expectationId: index === 0 ? fixture.caseId : `case-${index + 1}:signal:01`,
    status,
    ...(index === 0 ? {
        rawSourceSha256: fixture.rawSourceSha256,
        fromSha256: fixture.mutations[0] && textHash(fixture.mutations[0].before),
        toSha256: fixture.mutations[0] && textHash(fixture.mutations[0].after),
        sourceOccurrence: fixture.mutations[0] && { startUtf16: fixture.mutations[0].startUtf16, endUtf16: fixture.mutations[0].endUtf16 },
    } : {}),
    ...(status === 'ambiguous_unresolved' ? { reason: 'repeated_source_token_requires_independent_occurrence_evidence' } : {}),
}));

function manifestFor(fixture, statuses = Array(16).fill('source_bound_included')) {
    return {
        schemaVersion: 2,
        contractVersion: 'review-learning-source-bound-preflight-v2',
        cases: [fixture],
        originalCoverage: { items: coverageItems(statuses, fixture) },
    };
}

test('binds ordinary spelling and scoped mutations to exact source UTF-16 spans', () => {
    const fixture = buildSourceBoundFixture({
        caseId: 'test-general', lane: 'general_ai_equal_row', source: 'Dinner\nAheletic G 8',
        mutations: [{ startUtf16: 7, endUtf16: 15, before: 'Aheletic', after: 'Athletic' }],
    });
    expect(applySourceMutations(fixture).valid).toBe(true);
    expect(fixture.correctedBlock).toBe('Dinner\nAthletic G 8');

    const scoped = buildSourceBoundFixture({
        caseId: 'test-scoped', lane: 'scoped_deterministic_rule', source: 'House-mad rolls G 12',
        mutations: [{ startUtf16: 0, endUtf16: 9, before: 'House-mad', after: 'House-made' }],
    });
    expect(applySourceMutations(scoped).valid).toBe(true);
});

test('uses UTF-16 coordinates while retaining code-point and UTF-8 revision identity', () => {
    const fixture = buildSourceBoundFixture({
        caseId: 'test-unicode', lane: 'general_ai_equal_row', source: '🍽️ Café\nSoupp D 8',
        mutations: [{ startUtf16: 10, endUtf16: 15, before: 'Soupp', after: 'Soup' }],
    });
    expect(fixture.sourceRevision.utf16Length).toBe(19);
    expect(fixture.sourceRevision.codePointLength).toBe(18);
    expect(fixture.sourceRevision.utf8ByteLength).toBe(24);
    expect(applySourceMutations(fixture).valid).toBe(true);
});

test('derives numeric and unit protected spans even when callers provide none', () => {
    const fixture = buildSourceBoundFixture({
        caseId: 'test-unit', lane: 'general_ai_equal_row', source: 'Soup 6 tsp',
        mutations: [{ startUtf16: 7, endUtf16: 10, before: 'tsp', after: 'tbsp' }],
    });
    expect(fixture.protectedSpans).toEqual([]);
    expect(applySourceMutations(fixture).errors).toContain('mutations[0]:derived_protected_span');
});

test('rejects repeated-token ambiguity, stale anchors, overlap, protected spans, and missing provenance', () => {
    const repeated = buildSourceBoundFixture({
        caseId: 'test-repeat', lane: 'general_ai_equal_row', source: 'Beets G 8\nBeets D 9',
        mutations: [{ startUtf16: 0, endUtf16: 5, before: 'Beets', after: 'Beet' }],
    });
    delete repeated.mutations[0].occurrenceOrdinal;
    expect(applySourceMutations(repeated).errors).toContain('mutations[0]:ambiguous_occurrence');

    const invalid = buildSourceBoundFixture({
        caseId: 'test-invalid', lane: 'general_ai_equal_row', source: 'Soupp D 8\nCake G 9',
        mutations: [{ startUtf16: 0, endUtf16: 5, before: 'Soupp', after: 'Soup' }],
        protectedSpans: [{ startUtf16: 0, endUtf16: 5, classification: 'read-only' }],
        readOnlySpans: [{ startUtf16: 0, endUtf16: 5, classification: 'selected-read-only' }],
    });
    invalid.mutations[0].sourceRevisionId = 'stale';
    delete invalid.mutations[0].provenance;
    expect(applySourceMutations(invalid).valid).toBe(false);
    expect(applySourceMutations(invalid).errors).toEqual(expect.arrayContaining([
        'mutations[0]:stale_source_revision', 'mutations[0]:missing_provenance',
        'mutations[0]:protected_span', 'mutations[0]:read_only_span',
    ]));

    const overlap = buildSourceBoundFixture({
        caseId: 'test-overlap', lane: 'general_ai_equal_row', source: 'Soupp D 8',
        mutations: [{ startUtf16: 0, endUtf16: 5, before: 'Soupp', after: 'Soup' }, { startUtf16: 4, endUtf16: 6, before: 'p ', after: 'x' }],
    });
    expect(applySourceMutations(overlap).errors).toContain('mutations[1]:overlapping_span');
});

test('rejects positive fixtures that copy truth-only content or add layout/lexical content', () => {
    const fixture = buildSourceBoundFixture({
        caseId: 'test-copy', lane: 'general_ai_equal_row', source: 'Soup D 8\nCake G 9',
        mutations: [{ startUtf16: 0, endUtf16: 4, before: 'Soup', after: 'Stew' }],
    });
    fixture.correctedBlock = 'Stew D 8\nInserted Dish D 99\nCake G 9';
    expect(applySourceMutations(fixture).errors).toEqual(expect.arrayContaining(['corrected_block:structural_skeleton_changed']));
    expect(validateAdversarialControl({ source: 'Soup D 8\nCake G 9', humanFinal: fixture.correctedBlock }).authorized).toBe(false);
});

test('binds exact response bytes and rejects altered or internally-authorized responses', () => {
    const fixture = buildSourceBoundFixture({
        caseId: 'test-response', lane: 'general_ai_equal_row', source: 'Soupp D 8',
        mutations: [{ startUtf16: 0, endUtf16: 5, before: 'Soupp', after: 'Soup' }],
    });
    const response = responseForFixture(fixture);
    expect(fixture.responseSha256).toBe(textHash(response));
    expect(validateResponseForFixture(fixture, response, { requireNoInternalRecords: true }).valid).toBe(true);
    expect(validateResponseForFixture(fixture, `${response} `).errors).toEqual(expect.arrayContaining(['response_bytes_mismatch', 'response_hash_mismatch']));
    expect(validateResponseForFixture(fixture, response.replace('[]', '[{"sourceOccurrenceId":"private"}]'), { requireNoInternalRecords: true }).errors).toContain('internal_record_visible');
});

test('keeps incomplete original membership explicit and blocks the positive gate', () => {
    const fixture = buildSourceBoundFixture({
        caseId: 'test-coverage', lane: 'general_ai_equal_row', source: 'Soupp D 8',
        mutations: [{ startUtf16: 0, endUtf16: 5, before: 'Soupp', after: 'Soup' }],
    });
    const result = validateManifest(manifestFor(fixture, ['source_bound_included', ...Array(15).fill('ambiguous_unresolved')]), { requiredCoverageCount: 16 });
    expect(result.valid).toBe(true);
    expect(result.positiveGate).toBe(false);
    expect(result.coverage.statusCounts.ambiguous_unresolved).toBe(15);
    expect(validateManifest(manifestFor(fixture, ['ambiguous_unresolved']), { requiredCoverageCount: 16, requireCompleteCoverage: true }).errors).toContain('coverage:incomplete_required_membership');
});

test('does not guess repeated historical occurrences during preparation', () => {
    const result = signalCoverage(
        { case_id: 'historical-case', raw_input: 'beets G 8\nbeets D 9', ground_truth: 'beet G 8\nbeet D 9' },
        { from: 'beets', to: 'beet', kind: 'spelling' }, 0
    );
    expect(result.status).toBe('ambiguous_unresolved');
    expect(result.reason).toContain('repeated_source_token');
});

test('honors an explicitly supplied original-plan path', () => {
    expect(parseArgs(['--out', '/tmp/out', '--old-fixture', '/tmp/old.json', '--old-report', '/tmp/report.json', '--original-plan', '/tmp/custom-plan']).originalPlan).toBe('/tmp/custom-plan');
});

test('registered contextual lane retains actual phase-0 server-issued identity', () => {
    const phase0 = require('../../../scripts/verify-source-anchored-spelling-phase0-v2').buildManifest();
    const item = phase0.cases.find((entry) => entry.caseId === 'SAE-001');
    const record = item.runtimeInput.response.records[0];
    const occurrence = item.runtimeInput.occurrenceRegistry.find((entry) => entry.sourceOccurrenceId === record.sourceOccurrenceId);
    expect(item.expected.outcome).toBe('apply');
    expect(record.spellingDisposition).toBe('corrected');
    expect(occurrence.sourceOccurrenceId).toBe('SO-a382d6b4cd12b495bd7bd3ff9f7ad62a1e8a897311dd27f7ff9fc3c068530503');
});

'use strict';

const crypto = require('crypto');
const {
    HUMAN_EXPLANATION_BINDING_VERSION,
    bindHumanExplanationRegistry,
    findCompleteOccurrences,
    textHash,
    tokenEditSegments,
    validateHumanExplanationRegistry,
} = (() => {
    const binding = require('../../../scripts/lib/human-explanation-binding');
    return { ...binding, textHash: (value) => crypto.createHash('sha256').update(Buffer.from(`${value}`, 'utf8')).digest('hex') };
})();
const { revisionInputs } = require('../../../scripts/prepare-human-explanation-binding');

function revision(caseId, raw) {
    return {
        [caseId]: {
            id: `rev-${caseId}`,
            sourceSha256: textHash(raw),
            utf16Length: raw.length,
            codePointLength: [...raw].length,
            utf8ByteLength: Buffer.byteLength(raw, 'utf8'),
        },
    };
}

function mapping(id, submissionId, caseId, correction) {
    return {
        correctionId: id,
        submissionId,
        caseId,
        correctionRowSha256: crypto.createHash('sha256').update(JSON.stringify(correction)).digest('hex'),
        authority: 'human_explanation',
    };
}

function correction(id, submissionId, original, corrected, overrides = {}) {
    return {
        id,
        submission_id: submissionId,
        correction_id: `${id}-row`,
        original_text: original,
        corrected_text: corrected,
        rule: 'reviewed wording',
        change_type: 'terminology',
        source: 'human',
        status: 'pending',
        is_location_specific: false,
        ...overrides,
    };
}

function inputs(corrections, rows, caseId, raw, scorerSignals = []) {
    return {
        corrections,
        datasetRows: rows,
        cohortMappings: corrections.map((item) => mapping(item.id, item.submission_id, caseId, item)),
        sourceRevisions: revision(caseId, raw),
        scorerSignals,
    };
}

describe('human explanation expectation binding', () => {
    test('binds one complete unique span and leaves another repeated word unsupported', () => {
        const caseId = 'generic-case-a';
        const raw = 'Dish A, beets G 8\nDish B, beets G 9';
        const item = correction('explanation-a', 'submission-a', 'Dish A, beets G 8', 'Dish A, beet G 8');
        const registry = bindHumanExplanationRegistry(inputs([item], [{ case_id: caseId, raw_input: raw, ground_truth: raw }], caseId, raw));

        expect(registry.bindingVersion).toBe(HUMAN_EXPLANATION_BINDING_VERSION);
        expect(registry.corrections).toHaveLength(1);
        expect(registry.corrections[0]).toMatchObject({
            correctionId: 'explanation-a',
            eligibility: 'test_expectation_eligible',
            sourceMatch: { state: 'exact_unique', occurrenceCount: 1 },
            mutationAuthority: 'none',
            authority: { kind: 'human_explanation', acceptedRule: false },
        });
        expect(registry.corrections[0].source.span).toMatchObject({ rowIndex: 0, startUtf16: 0, endUtf16: 17, occurrenceOrdinal: 0 });
        expect(registry.corrections[0].source.span.beforeText).toBe('Dish A, beets G 8');
        expect(registry.corrections[0].source.span.afterTextSha256).toBe(textHash('Dish A, beet G 8'));
    });

    test('derives measured ordinals independently for two exact human spans', () => {
        const caseId = 'generic-case-b';
        const raw = 'Dish A, beets G 8\nDish B, beets G 9';
        const first = correction('explanation-b1', 'submission-b', 'Dish A, beets G 8', 'Dish A, beet G 8');
        const second = correction('explanation-b2', 'submission-b', 'Dish B, beets G 9', 'Dish B, beet G 9');
        const registry = bindHumanExplanationRegistry({
            ...inputs([first, second], [{ case_id: caseId, raw_input: raw, ground_truth: raw }], caseId, raw),
            cohortMappings: [mapping(first.id, first.submission_id, caseId, first), mapping(second.id, second.submission_id, caseId, second)],
        });
        expect(registry.corrections.map((item) => item.source.span.rowIndex)).toEqual([0, 1]);
        expect(registry.corrections.map((item) => item.source.span.occurrenceOrdinal)).toEqual([0, 0]);
    });

    test.each([
        ['duplicate complete spans', (base) => ({ ...base, raw_input: `${base.raw_input}\n${base.raw_input}` }), 'duplicate_exact'],
        ['absent mapped source', (base) => ({ ...base, raw_input: 'Other dish G 8' }), 'not_found'],
    ])('records %s without guessing', (_label, mutate, expectedState) => {
        const caseId = 'generic-case-negative';
        const original = 'Dish A, beets G 8';
        const item = correction('negative-explanation', 'submission-negative', original, 'Dish A, beet G 8');
        const row = { case_id: caseId, raw_input: 'Dish A, beets G 8', ground_truth: 'Dish A, beet G 8' };
        const changed = mutate(row);
        const registry = bindHumanExplanationRegistry(inputs([item], [changed], caseId, changed.raw_input));
        expect(registry.corrections[0].sourceMatch.state).toBe(expectedState);
        expect(registry.corrections[0].eligibility).toBe('needs_source_history');
        expect(registry.corrections[0].mutationAuthority).toBe('none');
    });

    test('holds mapping conflicts, revision drift, and forged registry ordinals', () => {
        const caseId = 'generic-case-integrity';
        const raw = 'Soup, beets G 8';
        const item = correction('integrity-explanation', 'submission-integrity', 'Soup, beets G 8', 'Soup, beet G 8');
        const registry = bindHumanExplanationRegistry({
            ...inputs([item], [{ case_id: caseId, raw_input: raw, ground_truth: raw }], caseId, raw),
            cohortMappings: [
                mapping(item.id, item.submission_id, caseId, item),
                { ...mapping(item.id, item.submission_id, 'other-case', item) },
            ],
            sourceRevisions: { [caseId]: { id: 'rev-integrity', sourceSha256: textHash('different source') } },
        });
        expect(registry.corrections[0].sourceMatch.reason).toBe('ambiguous_correction_mapping');

        const valid = bindHumanExplanationRegistry(inputs([item], [{ case_id: caseId, raw_input: raw, ground_truth: raw }], caseId, raw));
        valid.corrections[0].source.span.occurrenceOrdinal = 4;
        expect(validateHumanExplanationRegistry(valid, { corrections: [item] }).errors).toContain(`correction:${item.id}:span_integrity`);
        const validWithSource = bindHumanExplanationRegistry(inputs([item], [{ case_id: caseId, raw_input: raw, ground_truth: raw }], caseId, raw));
        validWithSource.corrections[0].source.span.startUtf16 = 1;
        expect(validateHumanExplanationRegistry(validWithSource, {
            corrections: [item],
            datasetRows: [{ case_id: caseId, raw_input: raw, ground_truth: raw }],
            sourceRevisions: revision(caseId, raw),
            cohortMappings: [mapping(item.id, item.submission_id, caseId, item)],
        }).errors).toContain(`correction:${item.id}:source_span_binding`);
        expect(findCompleteOccurrences(raw, 'beets')).toEqual([{ startUtf16: 6, endUtf16: 11 }]);
    });

    test('keeps phrase edits together and classifies a scorer fragment as malformed', () => {
        const caseId = 'generic-phrase-case';
        const raw = 'Tomahawk, black pepper corn sauce G 8';
        const item = correction('phrase-explanation', 'submission-phrase', 'Tomahawk, black pepper corn sauce G 8', 'Tomahawk, black peppercorn sauce G 8');
        const signal = {
            expectationId: 'generic-phrase-signal',
            caseId,
            signalIndex: 0,
            fromSha256: textHash('pepper'),
            toSha256: textHash('peppercorn'),
            status: 'source_bound_included',
        };
        const registry = bindHumanExplanationRegistry({
            ...inputs([item], [{ case_id: caseId, raw_input: raw, ground_truth: 'Tomahawk, black peppercorn sauce G 8' }], caseId, raw, [signal]),
            cohortMappings: [mapping(item.id, item.submission_id, caseId, item)],
        });
        expect(tokenEditSegments(item.original_text, item.corrected_text)).toEqual(expect.arrayContaining([
            expect.objectContaining({ beforeTokenCount: 2, afterTokenCount: 1 }),
        ]));
        expect(registry.scorerRelationships[0]).toMatchObject({ relationship: 'malformed_fragment', correctionIds: [], malformedCorrectionIds: [item.id] });
    });

    test('classifies a raw/truth split-merge signal as malformed even without human authority', () => {
        const caseId = 'generic-fragment-case';
        const raw = 'Tomahawk, black pepper corn sauce G 8';
        const truth = 'Tomahawk, black peppercorn sauce G 8';
        const signal = { expectationId: 'fragment-signal', caseId, signalIndex: 0, fromSha256: textHash('pepper'), toSha256: textHash('peppercorn'), status: 'source_bound_included' };
        const registry = bindHumanExplanationRegistry({
            corrections: [],
            datasetRows: [{ case_id: caseId, raw_input: raw, ground_truth: truth }],
            cohortMappings: [],
            sourceRevisions: revision(caseId, raw),
            scorerSignals: [signal],
        });
        expect(registry.scorerRelationships[0]).toMatchObject({ relationship: 'malformed_fragment', unsupportedReason: 'scorer_fragment_tracks_one_side_of_a_split_merge_boundary' });
    });

    test('uses UTF-16 coordinates for emoji and combining marks and keeps precheck lineage unverified', () => {
        const caseId = 'generic-unicode-case';
        const raw = '🍽️ Cafe\u0301, beets G 8';
        const original = '🍽️ Cafe\u0301, beets G 8';
        const corrected = '🍽️ Cafe\u0301, beet G 8';
        const item = correction('unicode-explanation', 'submission-unicode', original, corrected);
        const registry = bindHumanExplanationRegistry(inputs([item], [{ case_id: caseId, raw_input: raw, ground_truth: corrected }], caseId, raw));
        expect(registry.corrections[0].source.span.startUtf16).toBe(0);
        expect(registry.corrections[0].source.span.endUtf16).toBe(raw.length);
        expect(registry.corrections[0].source.rawUtf8ByteLength).toBe(Buffer.byteLength(raw, 'utf8'));
        expect(registry.corrections[0].modelInput).toMatchObject({ status: 'unverified', reason: 'actual_prechecked_unavailable' });
    });

    test('keeps caller-provided verified boolean untrusted for model-input lineage', () => {
        const caseId = 'generic-precheck-case';
        const raw = 'Soup, beets G 8';
        const item = correction('precheck-explanation', 'submission-precheck', 'Soup, beets G 8', 'Soup, beet G 8');
        const row = { case_id: caseId, raw_input: raw, ground_truth: raw };
        const revisions = revision(caseId, raw);
        row.actualPrechecked = {
            text: 'Soup, beet G 8',
            sha256: textHash('Soup, beet G 8'),
            rawSourceSha256: textHash(raw),
            sourceRevisionId: revisions[caseId].id,
            verified: true,
        };
        const registry = bindHumanExplanationRegistry({
            ...inputs([item], [row], caseId, raw),
            sourceRevisions: revisions,
            cohortMappings: [mapping(item.id, item.submission_id, caseId, item)],
        });
        expect(registry.corrections[0].modelInput).toMatchObject({ status: 'unverified', reason: 'actual_prechecked_lineage_unverified', textSha256: textHash('Soup, beet G 8'), rawSourceSha256: textHash(raw), sourceRevisionId: revisions[caseId].id });
    });

    test('recomputes every provenance-critical derived field before accepting a registry', () => {
        const caseId = 'generic-tamper-case';
        const raw = 'Soup, beets G 8';
        const item = correction('tamper-explanation', 'submission-tamper', 'Soup, beets G 8', 'Soup, beet G 8', {
            location: 'Paris',
            is_location_specific: true,
        });
        const signal = { expectationId: 'tamper-signal', caseId, signalIndex: 0, fromSha256: textHash('beets'), toSha256: textHash('beet'), status: 'source_bound_included' };
        const trusted = inputs([item], [{ case_id: caseId, raw_input: raw, ground_truth: 'Soup, beet G 8' }], caseId, raw, [signal]);
        const valid = bindHumanExplanationRegistry({ ...trusted, cohortMappings: [mapping(item.id, item.submission_id, caseId, item)] });
        const expected = { ...trusted, cohortMappings: [mapping(item.id, item.submission_id, caseId, item)] };
        expect(validateHumanExplanationRegistry(valid, expected)).toMatchObject({ valid: true });

        const tamperCases = [
            ['explanation.rule', (copy) => { copy.corrections[0].explanation.rule = 'forged rule'; }],
            ['scope.location', (copy) => { copy.corrections[0].scope.location = 'Forged location'; }],
            ['modelInput', (copy) => { copy.corrections[0].modelInput = { status: 'verified', textSha256: 'a'.repeat(64), rawSourceSha256: textHash(raw), sourceRevisionId: 'rev-generic-tamper-case' }; }],
            ['scorer relationship', (copy) => { copy.scorerRelationships[0].relationship = 'observed_only'; }],
            ['scorer correction IDs', (copy) => { copy.scorerRelationships[0].correctionIds = []; }],
        ];
        for (const [label, mutate] of tamperCases) {
            const copy = JSON.parse(JSON.stringify(valid));
            mutate(copy);
            const result = validateHumanExplanationRegistry(copy, expected);
            expect(result.valid).toBe(false);
            expect(result.errors.some((error) => error.includes('derived_drift') || error.includes('scorer_relationships_drift'))).toBe(true);
            expect(label).toBeTruthy();
        }
    });

    test('accepts canonical unresolved states for missing mappings, conflicts, and unknown revisions', () => {
        const caseId = 'generic-unresolved-case';
        const raw = 'Soup, beets G 8';
        const item = correction('unresolved-explanation', 'submission-unresolved', 'Soup, beets G 8', 'Soup, beet G 8');
        const row = { case_id: caseId, raw_input: raw, ground_truth: 'Soup, beet G 8' };
        const goodMapping = mapping(item.id, item.submission_id, caseId, item);
        const cases = [
            { label: 'missing', cohortMappings: [], sourceRevisions: revision(caseId, raw), state: 'unresolved' },
            { label: 'conflicting', cohortMappings: [goodMapping, { ...goodMapping, caseId: 'other-case' }], sourceRevisions: revision(caseId, raw), state: 'unresolved' },
            { label: 'unknown revision', cohortMappings: [goodMapping], sourceRevisions: {}, state: 'unresolved' },
        ];
        for (const scenario of cases) {
            const registry = bindHumanExplanationRegistry({ corrections: [item], datasetRows: [row], cohortMappings: scenario.cohortMappings, sourceRevisions: scenario.sourceRevisions, scorerSignals: [] });
            expect(registry.corrections[0].sourceMatch.state).toBe(scenario.state);
            expect(validateHumanExplanationRegistry(registry, { corrections: [item], datasetRows: [row], cohortMappings: scenario.cohortMappings, sourceRevisions: scenario.sourceRevisions, scorerSignals: [] })).toMatchObject({ valid: true });
        }
    });

    test('reuses a generic second explanation set with different ids and preserves signal membership', () => {
        const caseId = 'second-set-case';
        const raw = 'Menu, chef-made G 8';
        const item = correction('second-set-explanation', 'second-set-submission', 'Menu, chef-made G 8', 'Menu, chefmade G 8');
        const signal = { expectationId: 'second-set-signal', caseId, signalIndex: 2, fromSha256: textHash('chef-made'), toSha256: textHash('chefmade'), status: 'source_bound_included' };
        const registry = bindHumanExplanationRegistry({
            ...inputs([item], [{ case_id: caseId, raw_input: raw, ground_truth: 'Menu, chefmade G 8' }], caseId, raw, [signal]),
            cohortMappings: [mapping(item.id, item.submission_id, caseId, item)],
        });
        expect(validateHumanExplanationRegistry(registry, { corrections: [item], scorerSignals: [signal] })).toMatchObject({ valid: true });
        expect(registry.scorerRelationships[0].legacySignal).toEqual(signal);
    });

    test('rejects conflicting source identities while deriving revision inputs', () => {
        const rows = [{ case_id: 'case-conflict', raw_input: 'Soup G 8', ground_truth: 'Soup G 8' }];
        const manifest = {
            cases: [
                { caseId: 'case-conflict:signal:01', sourceRevision: { id: 'rev-a', sourceSha256: textHash('Soup G 8') }, sourceSha256: textHash('Soup G 8') },
                { caseId: 'case-conflict:signal:02', sourceRevision: { id: 'rev-b', sourceSha256: textHash('Soup G 8') }, sourceSha256: textHash('Soup G 8') },
            ],
        };
        expect(() => revisionInputs(manifest, rows)).toThrow('Conflicting source revision identities');
    });
});

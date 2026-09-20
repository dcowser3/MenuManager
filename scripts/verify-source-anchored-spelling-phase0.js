#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(
    repoRoot,
    'services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix.json'
);

const canonicalJson = value => JSON.stringify(value);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hashFields = fields => sha256(Buffer.from(canonicalJson(fields), 'utf8'));
const utf8Length = value => Buffer.byteLength(value, 'utf8');
const codePointLength = value => [...value].length;

const exactAliases = [
    ['soupp', 'soup'], ['tomatoe', 'tomato'], ['steww', 'stew'], ['sallad', 'salad'],
    ['bannana', 'banana'], ['brocolli', 'broccoli'], ['avacado', 'avocado'], ['capuccino', 'cappuccino'],
    ['expresso', 'espresso'], ['mozarella', 'mozzarella'], ['parmesian', 'parmesan'], ['shitake', 'shiitake'],
    ['chipothle', 'chipotle'], ['tamrind', 'tamarind'], ['fugeo', 'fuego'], ['jasmin', 'jasmine'],
    ['cashu', 'cashew'], ['tequeno', 'tequeño'], ['jalapeno', 'jalapeño'], ['brulee', 'brûlée'],
];

const knownCanonicalAliases = [
    ['suop', 'soup'], ['sooup', 'soup'], ['souup', 'soup'], ['tomaato', 'tomato'],
    ['tomto', 'tomato'], ['toamto', 'tomato'], ['sald', 'salad'], ['saald', 'salad'],
    ['salda', 'salad'], ['banan', 'banana'], ['bannaa', 'banana'], ['banaana', 'banana'],
    ['brocoli', 'broccoli'], ['broccolli', 'broccoli'], ['brocooli', 'broccoli'], ['avocdo', 'avocado'],
    ['avocdao', 'avocado'], ['avocadoo', 'avocado'], ['cappucino', 'cappuccino'], ['capppuccino', 'cappuccino'],
    ['cappuccno', 'cappuccino'], ['espressso', 'espresso'], ['espreso', 'espresso'], ['esrpesso', 'espresso'],
    ['mozzarela', 'mozzarella'], ['mozzarelal', 'mozzarella'], ['parmeasn', 'parmesan'], ['parmesn', 'parmesan'],
    ['shiitak', 'shiitake'], ['shiiatke', 'shiitake'], ['chipolte', 'chipotle'], ['chiptle', 'chipotle'],
    ['tamarnd', 'tamarind'], ['tamairnd', 'tamarind'], ['fueog', 'fuego'], ['fueg', 'fuego'],
    ['jasmien', 'jasmine'], ['jasine', 'jasmine'], ['casheww', 'cashew'], ['casehw', 'cashew'],
];

const semanticNeighbors = [
    ['pea', 'pear'], ['pear', 'pea'], ['ham', 'hams'], ['hams', 'ham'], ['cream', 'creamer'],
    ['creamer', 'cream'], ['bean', 'beef'], ['beef', 'beer'], ['beer', 'beef'], ['rice', 'ribs'],
    ['sole', 'soul'], ['sage', 'sauce'], ['clam', 'clams'], ['lime', 'line'], ['leek', 'leeks'],
    ['date', 'dates'], ['fig', 'figs'], ['nut', 'nuts'], ['crab', 'crabs'], ['taco', 'tacos'],
    ['roll', 'rolls'], ['chile', 'chili'], ['cacao', 'cocoa'], ['mousse', 'mouse'], ['pane', 'pâté'],
    ['caper', 'capers'], ['onion', 'onions'], ['toast', 'roast'], ['duck', 'dusk'], ['veal', 'meal'],
];

const contentSubstitutions = [
    ['chicken', 'turkey'], ['beef', 'pork'], ['salmon', 'tuna'], ['cream', 'milk'], ['butter', 'oil'],
    ['peanut', 'cashew'], ['almond', 'hazelnut'], ['rice', 'quinoa'], ['potato', 'yam'], ['tomato', 'pepper'],
    ['basil', 'mint'], ['cilantro', 'parsley'], ['lime', 'lemon'], ['honey', 'sugar'], ['garlic', 'shallot'],
    ['cheddar', 'gouda'], ['mozzarella', 'burrata'], ['shrimp', 'lobster'], ['crab', 'prawn'], ['ham', 'bacon'],
    ['apple', 'pear'], ['peach', 'plum'], ['vanilla', 'chocolate'], ['coffee', 'tea'], ['rum', 'gin'],
    ['roasted', 'fried'], ['grilled', 'poached'], ['smoked', 'steamed'], ['spicy', 'sweet'], ['warm', 'chilled'],
];

const protectedSyntax = [
    ['$8', '€8'], ['€9', '£9'], ['₹10', '₽10'], ['₩11', '₺11'], ['₫12', '₴12'],
    ['₦13', '₱13'], ['₪14', '₡14'], ['₲15', '₵15'], ['₸16', '₭16'], ['₮17', '฿17'],
    ['6 tsp', '6 tbsp'], ['tsp 6', 'tbsp 6'], ['٦ tsp', '٦ tbsp'], ['tsp ٦', 'tbsp ٦'],
    ['1/2 chicken', '1-2 chicken'], ['1–2 tacos', '1—2 tacos'], ['-8', '+8'], ['1.25', '12.5'],
    ['$1,200.50', '$1200.50'], ['Steak*', 'Steak'], ['D,G', 'D/G'], ['G D', 'D G'],
    ['12 oz', '12 g'], ['kg 2', 'g 2'], ['2-person', '3-person'], ['250ml', '250l'],
    ['MP', '18'], ['MKT', '20'], ['market price', '$20'], ['++8', '+8'],
    ['¼ chicken', '½ chicken'], ['⅓ cup', '⅔ cup'], ['2× tacos', '3× tacos'], ['No. 2', 'No. 3'],
    ['D|G', 'D,G'], ['(N)', '(D)'], ['GF', 'G'], ['VG', 'V'], ['100%', '10%'], ['12:30', '13:30'],
];

const identityFailures = [
    'duplicate_source_row', 'reordered_rows', 'near_duplicate_rows', 'missing_occurrence_id', 'duplicate_occurrence_id',
    'stale_occurrence_id', 'wrong_source_revision', 'wrong_selected_revision', 'wrong_raw_row', 'wrong_start',
    'wrong_end', 'wrong_source_token', 'wrong_target', 'wrong_finding_id', 'wrong_policy_revision',
    'conflicting_duplicate_record', 'overlapping_mutation', 'discontinuous_projection', 'footer_only_span', 'read_only_row',
    'unchanged_baseline_row', 'inserted_precheck_bytes', 'deleted_precheck_span', 'stale_precheck_revision', 'ambiguous_selected_row',
    'wrong_property_context', 'wrong_template_context', 'wrong_menu_context', 'wrong_vocabulary_fingerprint', 'missing_finding_record',
];

const corpusUnknown = [
    ['zaatar', 'za’atar'], ['mole', 'molé'], ['piri', 'peri'], ['sambal', 'samba'], ['nduja', 'ndujaa'],
    ['labneh', 'labne'], ['shiso', 'shisō'], ['yuzu', 'yuzuuk'], ['aji', 'ají'], ['katsu', 'katzu'],
    ['furikake', 'furikaké'], ['sofrito', 'sofritto'], ['harissa', 'harisa'], ['dukkah', 'duka'], ['chermoula', 'chermula'],
    ['gremolata', 'gremolatta'], ['giardiniera', 'giardineira'], ['huacatay', 'wacatay'], ['pupusa', 'papusa'], ['arepa', 'arrepa'],
];

function revisionContext(index) {
    return {
        property: `phase0-property-${(index % 3) + 1}`,
        templateType: index % 2 ? 'food' : 'beverage',
        menuType: index % 4 ? 'a-la-carte' : 'set-menu',
        extractorVersion: 'phase0-extractor-v1',
    };
}

function buildCase({ caseId, cohort, sourceToken, targetToken, outcome, authority, index, prefix = '', suffix = ' sauce D 8',
    correctedExtra = '', failureMode = null, visibleOnHold = true }) {
    const context = revisionContext(index);
    const rawSource = `${prefix}${sourceToken}${suffix}`;
    const rawSourceSha256 = sha256(Buffer.from(rawSource, 'utf8'));
    const artifactRevisionId = `AR-${hashFields(['synthetic-artifact-v1', rawSourceSha256, context])}`;
    const rawRevisionId = `RR-${hashFields([artifactRevisionId, rawSourceSha256, context.extractorVersion])}`;
    const selectedRows = [{ rawRowIndex: 0, rawStartUtf16: 0, rawEndUtf16: rawSource.length }];
    const selectedRevisionId = `SR-${hashFields([rawRevisionId, selectedRows])}`;
    const rawStartUtf16 = prefix.length;
    const rawEndUtf16 = rawStartUtf16 + sourceToken.length;
    const beforePrefix = rawSource.slice(0, rawStartUtf16);
    const findingOrPolicyRevision = `${authority === 'accepted_exact_rule' ? 'PR' : 'FR'}-${hashFields([
        authority, targetToken.normalize('NFC'), context.property, context.templateType, context.menuType, 'phase0-vocabulary-v1',
    ])}`;
    const spellingFindingId = `SF-${hashFields([rawRevisionId, 0, rawStartUtf16, rawEndUtf16, sourceToken.normalize('NFC'), findingOrPolicyRevision])}`;
    const sourceOccurrenceId = `SO-${hashFields([
        rawSourceSha256, rawRevisionId, selectedRevisionId, 0, rawStartUtf16, rawEndUtf16,
        sourceToken.normalize('NFC'), findingOrPolicyRevision,
    ])}`;
    const proposedText = `${prefix}${targetToken}${suffix}${correctedExtra}`;
    const expectedText = outcome === 'apply' ? `${prefix}${targetToken}${suffix}` : rawSource;
    const record = {
        recordSchemaVersion: 1,
        internal: outcome === 'apply',
        type: outcome === 'apply' ? 'Spelling Disposition' : 'Spelling',
        description: outcome === 'apply'
            ? `Internal adjudication for ${sourceOccurrenceId}.`
            : `The proposed lexical change at ${sourceOccurrenceId} is held.`,
        recommendation: outcome === 'apply'
            ? `Apply ${sourceToken} to ${targetToken} only at the frozen occurrence if every deterministic gate passes.`
            : `Preserve ${sourceToken}; request human review if the proposal is relevant.`,
        spellingFindingId,
        sourceOccurrenceId,
        spellingDisposition: outcome === 'apply' ? 'corrected' : 'uncertain_candidate',
        sourceToken,
        suggestedReplacement: targetToken,
    };
    return {
        caseId,
        cohort,
        context,
        rawSource,
        proposedCorrectedMenu: proposedText,
        rawSourceSha256,
        artifactRevisionId,
        rawRevisionId,
        selectedRevisionId,
        sourceCoordinate: {
            rawRowIndex: 0,
            rawStartUtf16,
            rawEndUtf16,
            rawStartCodePoint: codePointLength(beforePrefix),
            rawEndCodePoint: codePointLength(beforePrefix + sourceToken),
            rawStartUtf8Byte: utf8Length(beforePrefix),
            rawEndUtf8Byte: utf8Length(beforePrefix + sourceToken),
        },
        sourceToken,
        targetToken,
        findingOrPolicyRevision,
        spellingFindingId,
        sourceOccurrenceId,
        evidence: {
            authority,
            vocabularyFingerprint: 'phase0-vocabulary-v1',
            uniqueFinding: authority === 'contextual_spelling_evidence',
            reviewerKnownCanonical: ['accepted_exact_rule', 'contextual_spelling_evidence'].includes(authority),
            legitimateOrAmbiguous: cohort === 'legitimate_semantic_neighbors',
            protectedOrReadOnly: cohort === 'quantity_price_syntax' || cohort === 'identity_provenance_failures',
            failureMode,
        },
        modelRecord: record,
        expected: {
            outcome,
            finalText: expectedText,
            appliedOccurrenceIds: outcome === 'apply' ? [sourceOccurrenceId] : [],
            heldOccurrenceIds: outcome === 'hold' ? [sourceOccurrenceId] : [],
            visibleSuggestionCount: outcome === 'hold' && visibleOnHold ? 1 : 0,
            internalRecordVisible: false,
            preserveAllBytesOutsideSpan: true,
        },
    };
}

function buildCases() {
    const cases = [];
    exactAliases.forEach(([sourceToken, targetToken], index) => cases.push(buildCase({
        caseId: `SAE-${String(index + 1).padStart(3, '0')}`, cohort: 'exact_accepted_aliases', sourceToken, targetToken,
        outcome: 'apply', authority: 'accepted_exact_rule', index,
        prefix: index === 18 ? '🍽️ ' : index === 19 ? 'Cafe\u0301 · ' : '',
    })));
    knownCanonicalAliases.forEach(([sourceToken, targetToken], index) => cases.push(buildCase({
        caseId: `SAN-${String(index + 1).padStart(3, '0')}`, cohort: 'new_aliases_known_canonicals', sourceToken, targetToken,
        outcome: 'apply', authority: 'contextual_spelling_evidence', index: index + 20,
        prefix: index === 0 ? '🍲 ' : index === 1 ? 'e\u0301lan · ' : '',
    })));
    Array.from({ length: 20 }, (_, index) => {
        const [sourceToken, targetToken] = knownCanonicalAliases[index];
        cases.push(buildCase({
            caseId: `SAM-${String(index + 1).padStart(3, '0')}`, cohort: 'mixed_rows', sourceToken, targetToken,
            outcome: 'apply', authority: 'contextual_spelling_evidence', index: index + 60,
            prefix: index % 5 === 0 ? '👩🏽‍🍳 ' : '', suffix: ` sauce D ${8 + (index % 4)}`,
            correctedExtra: index % 2 ? ', added garnish' : '\nInserted dish G 99',
        }));
    });
    semanticNeighbors.forEach(([sourceToken, targetToken], index) => cases.push(buildCase({
        caseId: `SAS-${String(index + 1).padStart(3, '0')}`, cohort: 'legitimate_semantic_neighbors', sourceToken, targetToken,
        outcome: 'hold', authority: 'none', index: index + 80,
    })));
    contentSubstitutions.forEach(([sourceToken, targetToken], index) => cases.push(buildCase({
        caseId: `SAC-${String(index + 1).padStart(3, '0')}`, cohort: 'ingredient_content_substitutions', sourceToken, targetToken,
        outcome: 'hold', authority: 'none', index: index + 110,
    })));
    protectedSyntax.forEach(([sourceToken, targetToken], index) => cases.push(buildCase({
        caseId: `SAP-${String(index + 1).padStart(3, '0')}`, cohort: 'quantity_price_syntax', sourceToken, targetToken,
        outcome: 'hold', authority: index % 2 ? 'accepted_exact_rule' : 'contextual_spelling_evidence', index: index + 140,
        prefix: 'Soupp dish, ', suffix: '', failureMode: 'protected_numeric_or_syntax_span',
    })));
    identityFailures.forEach((failureMode, index) => cases.push(buildCase({
        caseId: `SAI-${String(index + 1).padStart(3, '0')}`, cohort: 'identity_provenance_failures', sourceToken: 'soupp', targetToken: 'soup',
        outcome: 'hold', authority: 'contextual_spelling_evidence', index: index + 180,
        prefix: `${index % 3 === 0 ? '🍽️ ' : ''}Identity ${index + 1} · `, failureMode, visibleOnHold: false,
    })));
    corpusUnknown.forEach(([sourceToken, targetToken], index) => cases.push(buildCase({
        caseId: `SAU-${String(index + 1).padStart(3, '0')}`, cohort: 'corpus_unknown_canonicals', sourceToken, targetToken,
        outcome: 'hold', authority: 'none', index: index + 210,
    })));
    return cases;
}

function coordinateScenario(id, rawSource, mutations, expectedOutcome, expectedText, expectedReason) {
    const rawSourceSha256 = sha256(Buffer.from(rawSource, 'utf8'));
    const rawRevisionId = `RR-${hashFields(['coordinate-scenario-v1', rawSourceSha256])}`;
    let currentText = rawSource;
    let sourceRevisionId = rawRevisionId;
    const steps = mutations.map((mutation, index) => {
        const { sourceRevisionIdOverride, ...fields } = mutation;
        const targetText = currentText.slice(0, mutation.startUtf16) + mutation.after + currentText.slice(mutation.endUtf16);
        const declaredSourceRevisionId = sourceRevisionIdOverride === '$RAW'
            ? rawRevisionId : sourceRevisionIdOverride || sourceRevisionId;
        const targetRevisionId = `MR-${hashFields([declaredSourceRevisionId, index, fields, sha256(Buffer.from(targetText, 'utf8'))])}`;
        const result = { ...fields, sourceRevisionId: declaredSourceRevisionId, targetRevisionId };
        currentText = targetText;
        sourceRevisionId = targetRevisionId;
        return result;
    });
    return { id, coordinateUnit: 'javascript_utf16_code_units', rawSource, rawSourceSha256, rawRevisionId, steps,
        terminalRevisionId: sourceRevisionId, expectedOutcome, expectedReason, expectedText };
}

function buildCoordinateScenarios() {
    return [
        coordinateScenario('COORD-001-two-length-changing-prechecks', 'Tomatoe soupp D 8', [
            { owner: 'precheck:spelling', startUtf16: 0, endUtf16: 7, before: 'Tomatoe', after: 'Tomato' },
            { owner: 'precheck:style', startUtf16: 7, endUtf16: 12, before: 'soupp', after: 'house soupp' },
            { owner: 'model:known-canonical-alias', startUtf16: 13, endUtf16: 18, before: 'soupp', after: 'soup' },
        ], 'apply', 'Tomato house soup D 8', 'applied'),
        coordinateScenario('COORD-002-chain-within-token', 'brulee D 8', [
            { owner: 'precheck:diacritic', startUtf16: 0, endUtf16: 6, before: 'brulee', after: 'brûlée' },
            { owner: 'model:known-canonical-alias', startUtf16: 0, endUtf16: 6, before: 'brûlée', after: 'Brûlée' },
        ], 'apply', 'Brûlée D 8', 'applied'),
        coordinateScenario('COORD-003-surrogate-prefix', '🍽️ Soupp D 8', [
            { owner: 'model:known-canonical-alias', startUtf16: 4, endUtf16: 9, before: 'Soupp', after: 'Soup' },
        ], 'apply', '🍽️ Soup D 8', 'applied'),
        coordinateScenario('COORD-004-decomposed-combining-prefix', 'Cafe\u0301 Soupp D 8', [
            { owner: 'model:known-canonical-alias', startUtf16: 6, endUtf16: 11, before: 'Soupp', after: 'Soup' },
        ], 'apply', 'Cafe\u0301 Soup D 8', 'applied'),
        coordinateScenario('COORD-005-stale-revision', 'Soupp D 8', [
            { owner: 'model:known-canonical-alias', startUtf16: 0, endUtf16: 5, before: 'Soupp', after: 'Soup', sourceRevisionIdOverride: 'RR-stale' },
        ], 'hold', 'Soupp D 8', 'stale_revision'),
        coordinateScenario('COORD-006-overlap', 'Soupp D 8', [
            { owner: 'model:known-canonical-alias', batchId: 'overlap-1', startUtf16: 0, endUtf16: 5, before: 'Soupp', after: 'Soup' },
            { owner: 'model:other', batchId: 'overlap-1', startUtf16: 2, endUtf16: 4, before: 'up', after: 'oo', sourceRevisionIdOverride: '$RAW' },
        ], 'hold', 'Soupp D 8', 'overlapping_mutations'),
        coordinateScenario('COORD-007-discontinuous', 'Sou pp D 8', [
            { owner: 'model:known-canonical-alias', startUtf16: 0, endUtf16: 6, before: 'Sou pp', after: 'Soup', discontinuousRawSpans: [[0, 3], [4, 6]] },
        ], 'hold', 'Sou pp D 8', 'discontinuous_projection'),
        coordinateScenario('COORD-008-footer-removed', 'Soupp D 8\nManaged footer', [
            { owner: 'sanitizer:footer', startUtf16: 10, endUtf16: 24, before: 'Managed footer', after: '' },
            { owner: 'model:footer-edit', startUtf16: 10, endUtf16: 10, before: '', after: 'Changed footer', noRawProjection: true },
        ], 'hold', 'Soupp D 8\nManaged footer', 'no_raw_projection'),
        coordinateScenario('COORD-009-changed-only-readonly', 'Soup D 8\nSoupp G 9', [
            { owner: 'model:read-only-row', startUtf16: 0, endUtf16: 4, before: 'Soup', after: 'Stew', selectedRawRows: [1] },
        ], 'hold', 'Soup D 8\nSoupp G 9', 'read_only_row'),
        coordinateScenario('COORD-010-duplicate-row', 'Soupp D 8\nSoupp D 8', [
            { owner: 'model:ambiguous-row', startUtf16: 0, endUtf16: 5, before: 'Soupp', after: 'Soup', rowIdentity: 'ambiguous' },
        ], 'hold', 'Soupp D 8\nSoupp D 8', 'ambiguous_row_identity'),
    ];
}

function buildManifest() {
    const cases = buildCases();
    const coordinateScenarios = buildCoordinateScenarios();
    return {
        schemaVersion: 1,
        status: 'phase0_frozen_no_runtime_authorization',
        frozenAt: '2026-09-07T00:00:00.000Z',
        scope: 'new aliases of reviewer-known canonical terms only',
        coordinateContract: {
            mutationUnit: 'javascript_utf16_code_units',
            hashingEncoding: 'utf8',
            tokenIdentityNormalization: 'NFC',
            occurrenceIdFields: ['rawSourceSha256', 'rawRevisionId', 'selectedRevisionId', 'rawRowIndex',
                'rawStartUtf16', 'rawEndUtf16', 'NFC(sourceToken)', 'findingOrPolicyRevision'],
            occurrenceIdSerialization: 'UTF-8 bytes of JSON.stringify(array-of-fields)',
            auditCoordinates: ['utf16', 'unicode_code_point', 'utf8_byte'],
        },
        thresholds: {
            developmentExpectedOutcomeMatchRate: 1,
            developmentEligibleAliasApplyRate: 1,
            retrospectiveEligibleAliasRecoveryRateEachRepeat: 0.8,
            retrospectiveEligibleAliasAbsoluteUpliftVsCandidate5EachRepeat: 0.2,
            safetyFalsePositivesAllowed: 0,
            deliveryMismatchesAllowed: 0,
        },
        preservedHistoricalGates: {
            comparatorRuntimeSha256: 'd89d23cc7a335849c8bb0353e818690c15381f71b6bbedf9e96dccecc05adc92',
            datasetSha256: 'a6efb8c7f9807c09843f941a691e32c67ffa3cc5437be460c2d843ea7d4fcd87',
            promptSha256: '882f06f2c8705a7c60b2c76e62763217d669ddf0aec7ddc6eb80cc20cb4671dd',
            rulesSha256: '2e2982df92cddbd01dcceee0856a70c298321c24fe1b09bb2862723b5b71d259',
            membership: 209,
            repeats: 2,
            rawExpectationRevision: 'raw-human',
            required: ['all_original_hard_gates', 'complete_membership', 'no_confirmed_regression',
                'nondecreasing_raw_exact', 'nondecreasing_composite', 'nondecreasing_correction_precision',
                'nondecreasing_correction_recall', 'nondecreasing_correction_f1', 'raw_global_metrics_reported'],
            authorization: 'not_authorized_by_phase0',
        },
        cohortMinimums: {
            exact_accepted_aliases: 20,
            new_aliases_known_canonicals: 40,
            mixed_rows: 20,
            legitimate_semantic_neighbors: 30,
            ingredient_content_substitutions: 30,
            quantity_price_syntax: 40,
            identity_provenance_failures: 30,
            corpus_unknown_canonicals: 20,
        },
        cases,
        coordinateScenarios,
    };
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function validateManifest(manifest) {
    const expected = buildManifest();
    assert(canonicalJson(manifest) === canonicalJson(expected), 'Frozen Phase 0 manifest differs from its reviewed deterministic generator.');
    const ids = new Set();
    const occurrenceIds = new Set();
    const counts = {};
    for (const item of manifest.cases) {
        assert(!ids.has(item.caseId), `Duplicate case ID: ${item.caseId}`);
        ids.add(item.caseId);
        occurrenceIds.add(item.sourceOccurrenceId);
        counts[item.cohort] = (counts[item.cohort] || 0) + 1;
        const span = item.sourceCoordinate;
        assert(item.rawSource.slice(span.rawStartUtf16, span.rawEndUtf16) === item.sourceToken, `UTF-16 anchor mismatch: ${item.caseId}`);
        assert(utf8Length(item.rawSource.slice(0, span.rawStartUtf16)) === span.rawStartUtf8Byte, `UTF-8 start mismatch: ${item.caseId}`);
        assert(codePointLength(item.rawSource.slice(0, span.rawStartUtf16)) === span.rawStartCodePoint, `code-point start mismatch: ${item.caseId}`);
        const expectedOccurrenceId = `SO-${hashFields([
            item.rawSourceSha256, item.rawRevisionId, item.selectedRevisionId, span.rawRowIndex,
            span.rawStartUtf16, span.rawEndUtf16, item.sourceToken.normalize('NFC'), item.findingOrPolicyRevision,
        ])}`;
        assert(item.sourceOccurrenceId === expectedOccurrenceId, `Occurrence ID mismatch: ${item.caseId}`);
        assert(['apply', 'hold'].includes(item.expected.outcome), `Missing outcome: ${item.caseId}`);
        assert(item.expected.internalRecordVisible === false, `Internal record visibility is not fail-closed: ${item.caseId}`);
    }
    assert(occurrenceIds.size === manifest.cases.length, 'Occurrence IDs must be globally unique in the Phase 0 matrix.');
    for (const [cohort, minimum] of Object.entries(manifest.cohortMinimums)) {
        assert(counts[cohort] === minimum, `Cohort ${cohort} has ${counts[cohort] || 0}; expected exactly ${minimum}.`);
    }
    assert(manifest.thresholds.developmentExpectedOutcomeMatchRate === 1, 'Development outcomes must match 100%.');
    assert(manifest.thresholds.retrospectiveEligibleAliasRecoveryRateEachRepeat === 0.8, 'Retrospective eligible-alias threshold drifted.');
    assert(manifest.thresholds.retrospectiveEligibleAliasAbsoluteUpliftVsCandidate5EachRepeat === 0.2, 'Candidate 5 uplift threshold drifted.');
    assert(manifest.coordinateScenarios.length === 10, 'Coordinate scenario count drifted.');
    for (const scenario of manifest.coordinateScenarios) {
        assert(['apply', 'hold'].includes(scenario.expectedOutcome), `Invalid coordinate outcome: ${scenario.id}`);
        assert(typeof scenario.expectedReason === 'string' && scenario.expectedReason, `Missing coordinate reason: ${scenario.id}`);
        if (scenario.expectedOutcome === 'apply') {
            let text = scenario.rawSource;
            let revisionId = scenario.rawRevisionId;
            for (const step of scenario.steps) {
                assert(step.sourceRevisionId === revisionId, `Broken apply revision chain: ${scenario.id}`);
                assert(text.slice(step.startUtf16, step.endUtf16) === step.before, `Broken apply UTF-16 anchor: ${scenario.id}`);
                text = text.slice(0, step.startUtf16) + step.after + text.slice(step.endUtf16);
                revisionId = step.targetRevisionId;
            }
            assert(text === scenario.expectedText, `Coordinate expected text mismatch: ${scenario.id}`);
        } else {
            assert(scenario.expectedText === scenario.rawSource, `Held coordinate case must preserve raw bytes: ${scenario.id}`);
        }
    }
    return {
        manifestSha256: sha256(fs.readFileSync(manifestPath)),
        caseCount: manifest.cases.length,
        counts,
        coordinateScenarioCount: manifest.coordinateScenarios.length,
        thresholds: manifest.thresholds,
    };
}

function main() {
    if (process.argv.includes('--write')) {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(manifestPath, `${JSON.stringify(buildManifest(), null, 2)}\n`);
    }
    assert(fs.existsSync(manifestPath), `Missing frozen manifest: ${manifestPath}`);
    const result = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
    try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { buildManifest, validateManifest };

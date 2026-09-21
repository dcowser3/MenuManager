#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const phase0v1 = require('./verify-source-anchored-spelling-phase0');

const repoRoot = path.resolve(__dirname, '..');
const v1Path = path.join(repoRoot, 'services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix.json');
const manifestPath = path.join(repoRoot, 'services/dashboard/__fixtures__/source-anchored-spelling/phase0-occurrence-matrix-v2.json');
const V1_SHA256 = '11344d4da3763c8afbf68004a8c94b65ca5df0e86228a2ab05330615cfac53c6';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hashFields = fields => sha256(Buffer.from(JSON.stringify(fields), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const cpLength = value => [...value].length;
const byteLength = value => Buffer.byteLength(value, 'utf8');
const semanticNearNeighbors = [
    ['peas', 'pear'], ['pear', 'pears'], ['meat', 'mead'], ['sole', 'sale'], ['lime', 'line'],
    ['leek', 'leeks'], ['date', 'dates'], ['clam', 'clams'], ['crab', 'crabs'], ['taco', 'tacos'],
    ['roll', 'rolls'], ['caper', 'capers'], ['onion', 'onions'], ['toast', 'roast'], ['duck', 'dusk'],
    ['veal', 'meal'], ['rice', 'rise'], ['bean', 'beans'], ['beef', 'beer'], ['beer', 'beef'],
    ['cream', 'creams'], ['chile', 'chili'], ['mousse', 'mouse'], ['pane', 'cane'], ['mint', 'mind'],
    ['thyme', 'theme'], ['port', 'pork'], ['pork', 'fork'], ['corn', 'horn'], ['wine', 'vine'],
];

function damerauDistance(left, right) {
    const a = [...left.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()];
    const b = [...right.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()];
    const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
            matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
        }
    }
    return matrix[a.length][b.length];
}

function rowsOf(text) {
    let startUtf16 = 0;
    return text.split('\n').map((textValue, rawRowIndex) => {
        const row = { rawRowIndex, text: textValue, startUtf16, endUtf16: startUtf16 + textValue.length };
        startUtf16 = row.endUtf16 + 1;
        return row;
    });
}

function sourceCoordinate(rawSource, rawRowIndex, sourceToken, occurrence = 0) {
    const rows = rowsOf(rawSource);
    const row = rows[rawRowIndex];
    if (!row) throw new Error(`Missing row ${rawRowIndex}.`);
    let local = -1;
    let from = 0;
    for (let index = 0; index <= occurrence; index++) {
        local = row.text.indexOf(sourceToken, from);
        if (local < 0) throw new Error(`Missing token ${sourceToken} occurrence ${occurrence}.`);
        from = local + sourceToken.length;
    }
    const rawStartUtf16 = row.startUtf16 + local;
    const rawEndUtf16 = rawStartUtf16 + sourceToken.length;
    const before = rawSource.slice(0, rawStartUtf16);
    return {
        rawRowIndex,
        rawStartUtf16,
        rawEndUtf16,
        rawStartCodePoint: cpLength(before),
        rawEndCodePoint: cpLength(before + sourceToken),
        rawStartUtf8Byte: byteLength(before),
        rawEndUtf8Byte: byteLength(before + sourceToken),
    };
}

function acceptedRule(id, source, target, context, overrides = {}) {
    return {
        id,
        status: 'accepted',
        change_type: 'spelling',
        original_text: source,
        corrected_text: target,
        applies_to_menu_type: context.templateType,
        is_location_specific: true,
        location: context.property,
        other_applicable_locations: [],
        force_target_case: false,
        ...overrides,
    };
}

function vocabularyRevision(evidence, context) {
    return `VR-${hashFields([
        evidence.acceptedRules,
        evidence.approvedTexts,
        evidence.approvedTerms,
        evidence.ambiguousPairs,
        evidence.seedAmbiguousTerms,
        context,
    ])}`;
}

function revisionBundle(rawSource, selectedRawRows, context) {
    const rawSourceSha256 = sha256(Buffer.from(rawSource, 'utf8'));
    const artifactRevisionId = `AR-${hashFields(['phase0-v2-synthetic-artifact', rawSourceSha256, context])}`;
    const rawRevisionId = `RR-${hashFields([artifactRevisionId, rawSourceSha256, 'phase0-v2-extractor'])}`;
    const selectedRows = rowsOf(rawSource).filter(row => selectedRawRows.includes(row.rawRowIndex)).map(row => ({
        rawRowIndex: row.rawRowIndex,
        rawStartUtf16: row.startUtf16,
        rawEndUtf16: row.endUtf16,
        textSha256: sha256(Buffer.from(row.text, 'utf8')),
    }));
    const selectedRevisionId = `SR-${hashFields([rawRevisionId, selectedRows])}`;
    return { rawSourceSha256, artifactRevisionId, rawRevisionId, selectedRevisionId, selectedRows };
}

function makeRuntimeInput({ rawSource, sourceToken, targetToken, context, rawRowIndex = 0, occurrence = 0,
    evidenceKind = 'reviewer_known', legitimateTerms = [], correctedMenu, selectedRawRows, acceptedRules, modelRecords,
    findingRegistry, occurrenceRegistry }) {
    const coordinate = sourceCoordinate(rawSource, rawRowIndex, sourceToken, occurrence);
    const selected = selectedRawRows || rowsOf(rawSource).map(row => row.rawRowIndex);
    const revisions = revisionBundle(rawSource, selected, context);
    const rules = acceptedRules || (evidenceKind === 'exact_rule'
        ? [acceptedRule(`rule:${sourceToken}:${targetToken}`, sourceToken, targetToken, context)]
        : evidenceKind === 'reviewer_known'
            ? [acceptedRule(`seed:${targetToken}`, `legacy ${targetToken}`, targetToken, context)]
            : []);
    const canonicalEvidence = {
        acceptedRules: rules,
        approvedTexts: legitimateTerms.length ? [legitimateTerms.join(' ')] : [],
        approvedTerms: legitimateTerms.map(term => ({ term, count: 3 })),
        ambiguousPairs: [],
        seedAmbiguousTerms: [],
        vocabularyRevision: '',
    };
    if (evidenceKind === 'approved_corpus') canonicalEvidence.approvedTerms.push({ term: targetToken, count: 7 });
    canonicalEvidence.vocabularyRevision = vocabularyRevision(canonicalEvidence, context);
    const findingOrPolicyRevision = `EV-${hashFields([canonicalEvidence, sourceToken.normalize('NFC'), targetToken.normalize('NFC')])}`;
    const spellingFindingId = `SF-${hashFields([
        revisions.rawRevisionId, coordinate.rawRowIndex, coordinate.rawStartUtf16, coordinate.rawEndUtf16,
        sourceToken.normalize('NFC'), targetToken.normalize('NFC'), findingOrPolicyRevision,
    ])}`;
    const sourceOccurrenceId = `SO-${hashFields([
        revisions.rawSourceSha256, revisions.rawRevisionId, revisions.selectedRevisionId, coordinate.rawRowIndex,
        coordinate.rawStartUtf16, coordinate.rawEndUtf16, sourceToken.normalize('NFC'), findingOrPolicyRevision,
    ])}`;
    const findings = findingRegistry || (evidenceKind === 'none' ? [] : [{
        spellingFindingId,
        found: sourceToken,
        canonical: targetToken,
        kind: sourceToken.normalize('NFD').replace(/\p{M}/gu, '') === targetToken.normalize('NFD').replace(/\p{M}/gu, '')
            ? 'diacritic' : 'typo',
        source: evidenceKind === 'approved_corpus' ? 'approved_corpus' : 'reviewer_rule',
        evidenceRevision: findingOrPolicyRevision,
    }]);
    const occurrences = occurrenceRegistry || [{
        sourceOccurrenceId,
        spellingFindingId,
        rawSourceSha256: revisions.rawSourceSha256,
        rawRevisionId: revisions.rawRevisionId,
        selectedRevisionId: revisions.selectedRevisionId,
        ...coordinate,
        sourceToken,
        suggestedReplacement: targetToken,
        findingOrPolicyRevision,
    }];
    const record = {
        recordSchemaVersion: 1,
        internal: true,
        type: 'Spelling Disposition',
        confidence: 'high',
        severity: 'normal',
        description: `Contextual correction for ${sourceOccurrenceId}.`,
        recommendation: `Apply ${sourceToken} to ${targetToken} only at ${sourceOccurrenceId}.`,
        spellingFindingId,
        sourceOccurrenceId,
        spellingDisposition: 'corrected',
        sourceToken,
        suggestedReplacement: targetToken,
    };
    return {
        rawSource,
        context,
        revisions,
        reviewProjection: {
            selectedRows: revisions.selectedRows,
            readOnlyRows: rowsOf(rawSource).filter(row => !selected.includes(row.rawRowIndex)).map(row => row.rawRowIndex),
        },
        canonicalEvidence,
        findingRegistry: findings,
        occurrenceRegistry: occurrences,
        response: {
            correctedMenu: correctedMenu || rawSource.slice(0, coordinate.rawStartUtf16) + targetToken + rawSource.slice(coordinate.rawEndUtf16),
            records: modelRecords || [record],
        },
    };
}

function validControlFor(input) {
    return clone(input);
}

function rebindEvidence(input, findingSource = 'reviewer_rule') {
    const occurrence = input.occurrenceRegistry[0];
    const sourceToken = occurrence?.sourceToken || input.response.records[0].sourceToken;
    const targetToken = occurrence?.suggestedReplacement || input.response.records[0].suggestedReplacement;
    input.canonicalEvidence.vocabularyRevision = vocabularyRevision(input.canonicalEvidence, input.context);
    const evidenceRevision = `EV-${hashFields([
        input.canonicalEvidence, sourceToken.normalize('NFC'), targetToken.normalize('NFC'),
    ])}`;
    const coordinate = sourceCoordinate(input.rawSource, occurrence?.rawRowIndex || 0, sourceToken, 0);
    const spellingFindingId = `SF-${hashFields([
        input.revisions.rawRevisionId, coordinate.rawRowIndex, coordinate.rawStartUtf16, coordinate.rawEndUtf16,
        sourceToken.normalize('NFC'), targetToken.normalize('NFC'), evidenceRevision,
    ])}`;
    const sourceOccurrenceId = `SO-${hashFields([
        input.revisions.rawSourceSha256, input.revisions.rawRevisionId, input.revisions.selectedRevisionId,
        coordinate.rawRowIndex, coordinate.rawStartUtf16, coordinate.rawEndUtf16,
        sourceToken.normalize('NFC'), evidenceRevision,
    ])}`;
    input.findingRegistry = [{ spellingFindingId, found: sourceToken, canonical: targetToken, kind: 'typo',
        source: findingSource, evidenceRevision }];
    input.occurrenceRegistry = [{ sourceOccurrenceId, spellingFindingId, rawSourceSha256: input.revisions.rawSourceSha256,
        rawRevisionId: input.revisions.rawRevisionId, selectedRevisionId: input.revisions.selectedRevisionId,
        ...coordinate, sourceToken, suggestedReplacement: targetToken, findingOrPolicyRevision: evidenceRevision }];
    replaceRecordIds(input.response.records[0], input.occurrenceRegistry[0]);
    return input;
}

function replaceRecordIds(record, occurrence) {
    record.sourceOccurrenceId = occurrence.sourceOccurrenceId;
    record.spellingFindingId = occurrence.spellingFindingId;
    record.sourceToken = occurrence.sourceToken;
    record.suggestedReplacement = occurrence.suggestedReplacement;
}

function expectedFor(input, outcome, visibleSuggestionCount = outcome === 'hold' ? 1 : 0) {
    const occurrence = input.occurrenceRegistry[0];
    const finalText = outcome === 'apply' && occurrence && Number.isInteger(occurrence.rawStartUtf16)
        ? input.rawSource.slice(0, occurrence.rawStartUtf16) + occurrence.suggestedReplacement
            + input.rawSource.slice(occurrence.rawEndUtf16)
        : input.rawSource;
    return {
        outcome,
        finalText,
        appliedOccurrenceIds: outcome === 'apply' && occurrence ? [occurrence.sourceOccurrenceId] : [],
        heldOccurrenceIds: outcome === 'hold' && occurrence ? [occurrence.sourceOccurrenceId] : [],
        visibleSuggestionCount,
        internalRecordVisible: false,
        preserveAllBytesOutsideSpan: true,
    };
}

function buildStandardCase(item, index) {
    const cohort = item.cohort;
    const actualItem = clone(item);
    if (cohort === 'legitimate_semantic_neighbors') {
        const [sourceToken, targetToken] = semanticNearNeighbors[index];
        actualItem.sourceToken = sourceToken;
        actualItem.targetToken = targetToken;
        actualItem.rawSource = `${index % 5 === 0 ? '🍴 ' : ''}${sourceToken} sauce D ${8 + (index % 4)}`;
        actualItem.proposedCorrectedMenu = actualItem.rawSource.replace(sourceToken, targetToken);
    }
    if (cohort === 'mixed_rows' && index % 3 === 1) {
        actualItem.rawSource = actualItem.rawSource.replace(' sauce', ' sauce with parsley');
        actualItem.proposedCorrectedMenu = actualItem.rawSource
            .replace(actualItem.sourceToken, actualItem.targetToken)
            .replace(' with parsley', '');
    }
    let evidenceKind = 'reviewer_known';
    if (cohort === 'exact_accepted_aliases') evidenceKind = 'exact_rule';
    if (cohort === 'corpus_unknown_canonicals') evidenceKind = index % 2 === 0 ? 'approved_corpus' : 'none';
    if (['ingredient_content_substitutions'].includes(cohort)) evidenceKind = 'none';
    const legitimateTerms = cohort === 'legitimate_semantic_neighbors' ? [actualItem.sourceToken] : [];
    const runtimeInput = makeRuntimeInput({
        rawSource: actualItem.rawSource,
        sourceToken: actualItem.sourceToken,
        targetToken: actualItem.targetToken,
        context: actualItem.context,
        evidenceKind,
        legitimateTerms,
        correctedMenu: actualItem.proposedCorrectedMenu,
    });
    if (cohort === 'quantity_price_syntax') {
        const occurrence = runtimeInput.occurrenceRegistry[0];
        runtimeInput.reviewProjection.protectedSpans = [{
            startUtf16: occurrence.rawStartUtf16,
            endUtf16: occurrence.rawEndUtf16,
            sourceText: runtimeInput.rawSource.slice(occurrence.rawStartUtf16, occurrence.rawEndUtf16),
            classification: 'deterministically_extracted_quantity_price_or_syntax',
        }];
    }
    const outer = {
        caseId: item.caseId,
        cohort,
        runtimeInput,
        expected: expectedFor(runtimeInput, item.expected.outcome, item.expected.visibleSuggestionCount),
        constructionAudit: {
            primaryBlockingInput: null,
            requiredConstructedErrors: [],
            recordDisposition: runtimeInput.response.records[0].spellingDisposition,
            recordConfidence: runtimeInput.response.records[0].confidence,
            inputKeysAllowedForAdapter: ['rawSource', 'context', 'revisions', 'reviewProjection', 'canonicalEvidence',
                'findingRegistry', 'occurrenceRegistry', 'response'],
        },
    };
    if (item.expected.outcome === 'hold') {
        const control = validControlFor(runtimeInput);
        if (cohort === 'legitimate_semantic_neighbors') {
            control.canonicalEvidence.approvedTexts = [];
            control.canonicalEvidence.approvedTerms = [];
            rebindEvidence(control);
            outer.constructionAudit.primaryBlockingInput = 'canonicalEvidence.approvedTerms';
            outer.constructionAudit.requiredConstructedErrors = ['legitimate_source'];
        } else if (cohort === 'ingredient_content_substitutions') {
            control.canonicalEvidence.acceptedRules = [acceptedRule(
                `control:${actualItem.sourceToken}:${actualItem.targetToken}`, actualItem.sourceToken, actualItem.targetToken, actualItem.context
            )];
            rebindEvidence(control);
            outer.constructionAudit.primaryBlockingInput = 'canonicalEvidence.acceptedRules is empty';
            outer.constructionAudit.requiredConstructedErrors = ['missing_finding', 'no_reviewer_authority'];
        } else if (cohort === 'quantity_price_syntax') {
            outer.constructionAudit.primaryBlockingInput = 'occurrenceRegistry span is numeric, amount-adjacent, or protected syntax';
            outer.constructionAudit.requiredConstructedErrors = ['protected_span'];
            delete outer.positiveControl;
        } else if (cohort === 'corpus_unknown_canonicals') {
            control.canonicalEvidence.acceptedRules = [acceptedRule(
                `control-seed:${actualItem.targetToken}`, `legacy ${actualItem.targetToken}`, actualItem.targetToken, actualItem.context
            )];
            rebindEvidence(control);
            outer.constructionAudit.primaryBlockingInput = evidenceKind === 'approved_corpus'
                ? 'findingRegistry source is approved_corpus' : 'findingRegistry is empty';
            outer.constructionAudit.requiredConstructedErrors = evidenceKind === 'approved_corpus'
                ? ['corpus_only', 'no_reviewer_authority'] : ['missing_finding', 'no_reviewer_authority'];
        }
        if (cohort !== 'quantity_price_syntax') outer.positiveControl = {
            runtimeInput: control,
            expected: expectedFor(control, 'apply', 0),
        };
    }
    return outer;
}

function rebuildOccurrenceForRaw(input, sourceToken, targetToken, rawRowIndex = 0, occurrence = 0) {
    const coordinate = sourceCoordinate(input.rawSource, rawRowIndex, sourceToken, occurrence);
    input.revisions = revisionBundle(input.rawSource, input.reviewProjection.selectedRows.map(row => row.rawRowIndex), input.context);
    input.reviewProjection.selectedRows = input.revisions.selectedRows;
    const finding = input.findingRegistry[0];
    const evidenceRevision = finding?.evidenceRevision || `EV-${hashFields([input.canonicalEvidence, sourceToken, targetToken])}`;
    const spellingFindingId = `SF-${hashFields([
        input.revisions.rawRevisionId, coordinate.rawRowIndex, coordinate.rawStartUtf16, coordinate.rawEndUtf16,
        sourceToken.normalize('NFC'), targetToken.normalize('NFC'), evidenceRevision,
    ])}`;
    const sourceOccurrenceId = `SO-${hashFields([
        input.revisions.rawSourceSha256, input.revisions.rawRevisionId, input.revisions.selectedRevisionId,
        coordinate.rawRowIndex, coordinate.rawStartUtf16, coordinate.rawEndUtf16,
        sourceToken.normalize('NFC'), evidenceRevision,
    ])}`;
    const occurrenceRecord = { sourceOccurrenceId, spellingFindingId, rawSourceSha256: input.revisions.rawSourceSha256,
        rawRevisionId: input.revisions.rawRevisionId, selectedRevisionId: input.revisions.selectedRevisionId,
        ...coordinate, sourceToken, suggestedReplacement: targetToken, findingOrPolicyRevision: evidenceRevision };
    input.occurrenceRegistry = [occurrenceRecord];
    if (finding) { finding.spellingFindingId = spellingFindingId; finding.found = sourceToken; finding.canonical = targetToken; }
    replaceRecordIds(input.response.records[0], occurrenceRecord);
    return occurrenceRecord;
}

function buildIdentityCase(item, index) {
    const sourceToken = 'soupp';
    const targetToken = 'soup';
    const mode = [
        'duplicate_source_row', 'reordered_rows', 'near_duplicate_rows', 'missing_occurrence_id', 'duplicate_occurrence_id',
        'stale_occurrence_id', 'wrong_source_revision', 'wrong_selected_revision', 'wrong_raw_row', 'wrong_start',
        'wrong_end', 'wrong_source_token', 'wrong_target', 'wrong_finding_id', 'wrong_policy_revision',
        'conflicting_duplicate_record', 'overlapping_mutation', 'discontinuous_projection', 'footer_only_span', 'read_only_row',
        'unchanged_baseline_row', 'inserted_precheck_bytes', 'deleted_precheck_span', 'stale_precheck_revision', 'ambiguous_selected_row',
        'wrong_property_context', 'wrong_template_context', 'wrong_menu_context', 'wrong_vocabulary_fingerprint', 'missing_finding_record',
    ][index];
    let rawSource = `Identity ${index + 1} · ${sourceToken} sauce D 8`;
    if (mode === 'duplicate_source_row') rawSource = `${sourceToken} sauce D 8\n${sourceToken} sauce D 8`;
    if (mode === 'reordered_rows') rawSource = `${sourceToken} sauce D 8\nCake G 9`;
    if (mode === 'near_duplicate_rows') rawSource = `${sourceToken} sauce D 8\n${sourceToken} sauces D 8`;
    const selectedRawRows = rowsOf(rawSource).map(row => row.rawRowIndex);
    const base = makeRuntimeInput({ rawSource, sourceToken, targetToken, context: item.context,
        evidenceKind: 'reviewer_known', selectedRawRows, rawRowIndex: 0 });
    if (mode === 'reordered_rows') base.response.correctedMenu = `Cake G 9\n${targetToken} sauce D 8`;
    if (mode === 'near_duplicate_rows') base.response.correctedMenu = `${targetToken} sauces D 8`;
    const control = clone(base);
    const input = clone(base);
    const record = input.response.records[0];
    const occurrence = input.occurrenceRegistry[0];
    switch (mode) {
        case 'duplicate_source_row': record.sourceOccurrenceId = ''; break;
        case 'reordered_rows': record.sourceOccurrenceId = ''; break;
        case 'near_duplicate_rows': record.sourceOccurrenceId = ''; break;
        case 'missing_occurrence_id': delete record.sourceOccurrenceId; break;
        case 'duplicate_occurrence_id': input.response.records.push(clone(record)); break;
        case 'stale_occurrence_id': record.sourceOccurrenceId = `SO-${'0'.repeat(64)}`; break;
        case 'wrong_source_revision': occurrence.rawRevisionId = `RR-${'1'.repeat(64)}`; break;
        case 'wrong_selected_revision': occurrence.selectedRevisionId = `SR-${'2'.repeat(64)}`; break;
        case 'wrong_raw_row': occurrence.rawRowIndex = 9; break;
        case 'wrong_start': occurrence.rawStartUtf16 += 1; break;
        case 'wrong_end': occurrence.rawEndUtf16 -= 1; break;
        case 'wrong_source_token': record.sourceToken = 'steww'; break;
        case 'wrong_target': record.suggestedReplacement = 'stew'; break;
        case 'wrong_finding_id': record.spellingFindingId = `SF-${'3'.repeat(64)}`; break;
        case 'wrong_policy_revision': occurrence.findingOrPolicyRevision = `EV-${'4'.repeat(64)}`; break;
        case 'conflicting_duplicate_record': input.response.records.push({ ...clone(record), suggestedReplacement: 'stew' }); break;
        case 'overlapping_mutation': input.occurrenceRegistry.push({ ...clone(occurrence), sourceOccurrenceId: `SO-${'5'.repeat(64)}`,
            rawStartUtf16: occurrence.rawStartUtf16 + 1, rawEndUtf16: occurrence.rawEndUtf16 }); break;
        case 'discontinuous_projection': input.reviewProjection.selectedRows = [
            { rawRowIndex: 0, rawStartUtf16: 0, rawEndUtf16: occurrence.rawStartUtf16 + 2, textSha256: 'left' },
            { rawRowIndex: 0, rawStartUtf16: occurrence.rawStartUtf16 + 3, rawEndUtf16: input.rawSource.length, textSha256: 'right' },
        ]; break;
        case 'footer_only_span': input.reviewProjection.selectedRows = []; input.reviewProjection.removedRows = [0]; break;
        case 'read_only_row': input.reviewProjection.readOnlyRows = [0]; break;
        case 'unchanged_baseline_row': input.reviewProjection.baselineUnchangedRows = [0]; break;
        case 'inserted_precheck_bytes': input.precheckLedger = [{ sourceRevisionId: input.revisions.rawRevisionId,
            targetRevisionId: `MR-${'6'.repeat(64)}`, sourceStartUtf16: occurrence.rawStartUtf16,
            sourceEndUtf16: occurrence.rawStartUtf16, before: '', after: sourceToken }]; occurrence.rawStartUtf16 = null; occurrence.rawEndUtf16 = null; break;
        case 'deleted_precheck_span': input.precheckLedger = [{ sourceRevisionId: input.revisions.rawRevisionId,
            targetRevisionId: `MR-${'7'.repeat(64)}`, sourceStartUtf16: occurrence.rawStartUtf16,
            sourceEndUtf16: occurrence.rawEndUtf16, before: sourceToken, after: '' }]; break;
        case 'stale_precheck_revision': input.precheckLedger = [{ sourceRevisionId: `RR-${'8'.repeat(64)}`,
            targetRevisionId: `MR-${'9'.repeat(64)}`, sourceStartUtf16: occurrence.rawStartUtf16,
            sourceEndUtf16: occurrence.rawEndUtf16, before: sourceToken, after: targetToken }]; break;
        case 'ambiguous_selected_row': input.reviewProjection.selectedRows = [clone(input.revisions.selectedRows[0]), clone(input.revisions.selectedRows[0])]; break;
        case 'wrong_property_context': input.context.property = 'different-property'; break;
        case 'wrong_template_context': input.context.templateType = input.context.templateType === 'food' ? 'beverage' : 'food'; break;
        case 'wrong_menu_context': input.context.menuType = 'different-menu-type'; break;
        case 'wrong_vocabulary_fingerprint': input.canonicalEvidence.vocabularyRevision = `VR-${'a'.repeat(64)}`; break;
        case 'missing_finding_record': input.findingRegistry = []; break;
        default: throw new Error(`Unhandled identity mode ${mode}.`);
    }
    const requiredErrors = {
        duplicate_source_row: ['missing_occurrence_id'], reordered_rows: ['missing_occurrence_id'],
        near_duplicate_rows: ['missing_occurrence_id'], missing_occurrence_id: ['missing_occurrence_id'],
        duplicate_occurrence_id: ['duplicate_occurrence_record'], stale_occurrence_id: ['unknown_occurrence_id'],
        wrong_source_revision: ['occurrence_raw_revision'], wrong_selected_revision: ['occurrence_selected_revision'],
        wrong_raw_row: ['occurrence_id_digest'], wrong_start: ['occurrence_anchor', 'occurrence_id_digest'],
        wrong_end: ['occurrence_anchor', 'occurrence_id_digest'], wrong_source_token: ['source_token'],
        wrong_target: ['target_token'], wrong_finding_id: ['missing_finding'], wrong_policy_revision: ['evidence_revision'],
        conflicting_duplicate_record: ['conflicting_occurrence_record'], overlapping_mutation: ['overlapping_occurrences'],
        discontinuous_projection: ['ambiguous_selected_row'], footer_only_span: ['outside_selected_projection'],
        read_only_row: ['read_only_row'], unchanged_baseline_row: ['unchanged_baseline_row'],
        inserted_precheck_bytes: ['inserted_precheck_without_raw_origin'], deleted_precheck_span: ['deleted_precheck_origin'],
        stale_precheck_revision: ['stale_precheck_revision'], ambiguous_selected_row: ['ambiguous_selected_row'],
        wrong_property_context: ['raw_revision'], wrong_template_context: ['raw_revision'], wrong_menu_context: ['raw_revision'],
        wrong_vocabulary_fingerprint: ['vocabulary_revision'], missing_finding_record: ['missing_finding'],
    }[mode];
    return {
        caseId: item.caseId,
        cohort: item.cohort,
        runtimeInput: input,
        positiveControl: { runtimeInput: control, expected: expectedFor(control, 'apply', 0) },
        expected: expectedFor(control, 'hold', 0),
        constructionAudit: { primaryBlockingInput: mode, requiredConstructedErrors: requiredErrors,
            recordDisposition: 'corrected', recordConfidence: 'high' },
    };
}

function secondOccurrenceCases() {
    const cases = [];
    for (let index = 0; index < 4; index++) {
        const context = { property: `phase0-property-${index + 1}`, templateType: 'food', menuType: 'a-la-carte' };
        const rawSource = index % 2
            ? '🍽️ soupp D 8\nsoupp G 9'
            : 'soupp D 8\nsoupp G 9';
        const input = makeRuntimeInput({ rawSource, sourceToken: 'soupp', targetToken: 'soup', context,
            evidenceKind: 'reviewer_known', rawRowIndex: 1, occurrence: 0 });
        input.response.correctedMenu = `${rawSource.split('\n')[0]}\nsoup G 9`;
        cases.push({
            caseId: `SAO-${String(index + 1).padStart(3, '0')}`,
            cohort: 'second_occurrence_positive_controls',
            runtimeInput: input,
            expected: { outcome: 'apply', finalText: input.response.correctedMenu,
                appliedOccurrenceIds: [input.occurrenceRegistry[0].sourceOccurrenceId], heldOccurrenceIds: [],
                visibleSuggestionCount: 0, internalRecordVisible: false, preserveAllBytesOutsideSpan: true },
            constructionAudit: { primaryBlockingInput: null, targetedRawRowIndex: 1, firstOccurrenceMustRemainExact: true },
        });
    }
    return cases;
}

function makeRevision(text, kind) {
    return { id: `${kind}-${hashFields([kind, sha256(Buffer.from(text, 'utf8'))])}`, text, textSha256: sha256(Buffer.from(text, 'utf8')),
        utf16Length: text.length, codePointLength: cpLength(text), utf8ByteLength: byteLength(text) };
}

function mutationStep(source, targetText, startUtf16, endUtf16, owner, extra = {}) {
    const before = source.text.slice(startUtf16, endUtf16);
    const after = targetText.slice(startUtf16, targetText.length - (source.text.length - endUtf16));
    const target = makeRevision(targetText, 'MR');
    return { source, target, mutation: { sourceRevisionId: source.id, targetRevisionId: target.id, startUtf16, endUtf16,
        before, after, owner, ...extra } };
}

function coordinateFixtures() {
    const scenarios = [];
    const raw1 = makeRevision('Tomatoe soupp D 8', 'RR');
    const s11 = mutationStep(raw1, 'Tomato soupp D 8', 0, 7, 'precheck:spelling');
    const s12 = mutationStep(s11.target, 'Tomato house soupp D 8', 7, 12, 'precheck:style');
    const s13 = mutationStep(s12.target, 'Tomato house soup D 8', 13, 18, 'model:known-canonical');
    scenarios.push({ id: 'COORD2-001', raw: raw1, selectedRawRanges: [[0, raw1.utf16Length]],
        steps: [s11.mutation, s12.mutation, s13.mutation], revisions: [raw1, s11.target, s12.target, s13.target],
        expected: { outcome: 'apply', reason: 'applied', finalText: s13.target.text } });

    const raw2 = makeRevision('brulee D 8', 'RR');
    const s21 = mutationStep(raw2, 'brûlée D 8', 0, 6, 'precheck:diacritic');
    const s22 = mutationStep(s21.target, 'Brûlée D 8', 0, 6, 'model:known-canonical');
    scenarios.push({ id: 'COORD2-002', raw: raw2, selectedRawRanges: [[0, raw2.utf16Length]],
        steps: [s21.mutation, s22.mutation], revisions: [raw2, s21.target, s22.target],
        expected: { outcome: 'apply', reason: 'applied', finalText: s22.target.text } });

    for (const [id, source, start, expected] of [
        ['COORD2-003', '🍽️ Soupp D 8', 4, '🍽️ Soup D 8'],
        ['COORD2-004', 'Cafe\u0301 Soupp D 8', 6, 'Cafe\u0301 Soup D 8'],
        ['COORD2-005', '👩🏽‍🍳 Soupp D 8', 8, '👩🏽‍🍳 Soup D 8'],
    ]) {
        const raw = makeRevision(source, 'RR');
        const step = mutationStep(raw, expected, start, start + 5, 'model:known-canonical');
        scenarios.push({ id, raw, selectedRawRanges: [[0, raw.utf16Length]], steps: [step.mutation], revisions: [raw, step.target],
            expected: { outcome: 'apply', reason: 'applied', finalText: expected } });
    }

    const negative = (id, source, configure, reason) => {
        const raw = makeRevision(source, 'RR');
        const targetText = source.replace('Soupp', 'Soup');
        const start = source.indexOf('Soupp');
        const step = mutationStep(raw, targetText, start, start + 5, 'model:known-canonical');
        const scenario = { id, raw, selectedRawRanges: [[0, raw.utf16Length]], steps: [step.mutation], revisions: [raw, step.target],
            expected: { outcome: 'hold', reason, finalText: source } };
        configure(scenario);
        scenarios.push(scenario);
    };
    negative('COORD2-006', 'Soupp D 8', scenario => { scenario.steps[0].sourceRevisionId = `RR-${'0'.repeat(64)}`; }, 'stale_revision');
    negative('COORD2-007', 'Soupp D 8', scenario => {
        scenario.steps.push({ ...scenario.steps[0], targetRevisionId: `MR-${'1'.repeat(64)}`, startUtf16: 2, endUtf16: 4,
            before: 'up', after: 'oo' });
    }, 'overlapping_batch');
    negative('COORD2-008', 'Soupp D 8', scenario => {
        scenario.projection = { targetRevisionId: scenario.steps[0].targetRevisionId, rawSegments: [[0, 2], [3, 5]] };
    }, 'discontinuous_projection');
    negative('COORD2-009', 'Soupp D 8\nManaged footer', scenario => {
        scenario.selectedRawRanges = [[0, 9]];
        scenario.steps[0].startUtf16 = 10; scenario.steps[0].endUtf16 = 24;
        scenario.steps[0].before = 'Managed footer'; scenario.steps[0].after = 'Changed footer';
    }, 'outside_selected_projection');
    negative('COORD2-010', 'Soup D 8\nSoupp G 9', scenario => {
        scenario.selectedRawRanges = [[9, scenario.raw.utf16Length]];
        scenario.steps[0].startUtf16 = 0; scenario.steps[0].endUtf16 = 4;
        scenario.steps[0].before = 'Soup'; scenario.steps[0].after = 'Stew';
    }, 'read_only_span');
    negative('COORD2-011', 'Soupp D 8\nSoupp D 8', scenario => {
        scenario.rowCandidates = [0, 1]; scenario.steps[0].rowIdentity = null;
    }, 'ambiguous_row_identity');
    return scenarios;
}

function classifyCoordinateScenario(scenario) {
    const revisionMap = new Map(scenario.revisions.map(revision => [revision.id, revision]));
    const originsByRevision = new Map([[scenario.raw.id,
        Array.from({ length: scenario.raw.text.length }, (_unused, index) => [index, index + 1])]]);
    for (const revision of scenario.revisions) {
        if (revision.textSha256 !== sha256(Buffer.from(revision.text, 'utf8'))
            || revision.utf16Length !== revision.text.length
            || revision.codePointLength !== cpLength(revision.text)
            || revision.utf8ByteLength !== byteLength(revision.text)) return 'revision_coordinate_mismatch';
    }
    if (scenario.rowCandidates?.length > 1 && scenario.steps.some(step => step.rowIdentity == null)) return 'ambiguous_row_identity';
    const ordered = [...scenario.steps].sort((a, b) => a.startUtf16 - b.startUtf16);
    for (let index = 1; index < ordered.length; index++) {
        if (ordered[index].sourceRevisionId === ordered[index - 1].sourceRevisionId
            && ordered[index].startUtf16 < ordered[index - 1].endUtf16) return 'overlapping_batch';
    }
    let current = scenario.raw;
    for (const step of scenario.steps) {
        if (step.sourceRevisionId !== current.id) return 'stale_revision';
        const source = revisionMap.get(step.sourceRevisionId);
        const target = revisionMap.get(step.targetRevisionId);
        if (!source || !target || source.text.slice(step.startUtf16, step.endUtf16) !== step.before) return 'source_anchor_mismatch';
        const sourceOrigins = originsByRevision.get(source.id);
        const touchedOrigins = sourceOrigins?.slice(step.startUtf16, step.endUtf16).filter(Boolean) || [];
        const rawStart = touchedOrigins.length ? Math.min(...touchedOrigins.map(span => span[0])) : null;
        const rawEnd = touchedOrigins.length ? Math.max(...touchedOrigins.map(span => span[1])) : null;
        if (rawStart == null || rawEnd == null || !scenario.selectedRawRanges.some(([start, end]) => rawStart >= start && rawEnd <= end)) {
            return scenario.id === 'COORD2-009' ? 'outside_selected_projection' : 'read_only_span';
        }
        const applied = source.text.slice(0, step.startUtf16) + step.after + source.text.slice(step.endUtf16);
        if (applied !== target.text) return 'target_revision_mismatch';
        const replacementOrigins = Array.from({ length: step.after.length }, () => [rawStart, rawEnd]);
        originsByRevision.set(target.id, [
            ...sourceOrigins.slice(0, step.startUtf16),
            ...replacementOrigins,
            ...sourceOrigins.slice(step.endUtf16),
        ]);
        current = target;
    }
    if (scenario.projection) {
        const segments = scenario.projection.rawSegments;
        if (segments.length !== 1 || segments[0][1] - segments[0][0] !== scenario.steps.at(-1).after.length) return 'discontinuous_projection';
    }
    return 'applied';
}

function buildManifest() {
    if (sha256(fs.readFileSync(v1Path)) !== V1_SHA256) throw new Error('Phase 0 v1 matrix was not preserved.');
    const v1 = phase0v1.buildManifest();
    const cases = v1.cases.map((item) => item.cohort === 'identity_provenance_failures'
        ? buildIdentityCase(item, Number(item.caseId.slice(-3)) - 1)
        : buildStandardCase(item, Number(item.caseId.slice(-3)) - 1));
    cases.push(...secondOccurrenceCases());
    return {
        schemaVersion: 2,
        status: 'phase0_v2_frozen_no_runtime_authorization',
        supersedesForImplementation: { schemaVersion: 1, sha256: V1_SHA256, preserved: true },
        frozenAt: '2026-09-07T00:00:00.000Z',
        scope: 'new aliases of reviewer-known canonical terms only',
        adapterContract: {
            runtimeInputPath: 'cases[].runtimeInput and cases[].positiveControl.runtimeInput only',
            forbiddenRuntimeKeys: ['expected', 'cohort', 'constructionAudit', 'primaryBlockingInput', 'failureMode', 'authority',
                'uniqueFinding', 'reviewerKnownCanonical', 'protectedOrReadOnly'],
            rule: 'derive eligibility from raw rules, vocabulary evidence, registries, revisions, projections, and response records',
        },
        coordinateContract: v1.coordinateContract,
        thresholds: v1.thresholds,
        preservedHistoricalGates: v1.preservedHistoricalGates,
        cohortMinimums: { ...v1.cohortMinimums, second_occurrence_positive_controls: 4 },
        cases,
        coordinateScenarios: coordinateFixtures(),
    };
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function containsForbiddenKey(value, forbidden) {
    if (!value || typeof value !== 'object') return null;
    for (const [key, nested] of Object.entries(value)) {
        if (forbidden.includes(key)) return key;
        const found = containsForbiddenKey(nested, forbidden);
        if (found) return found;
    }
    return null;
}

function runtimeBindingErrors(input) {
    const errors = [];
    const selectedRowIndices = input.reviewProjection.selectedRows.map(row => row.rawRowIndex);
    const recomputedRevisions = revisionBundle(input.rawSource, selectedRowIndices, input.context);
    if (input.revisions.rawSourceSha256 !== recomputedRevisions.rawSourceSha256) errors.push('raw_source_hash');
    if (input.revisions.rawRevisionId !== recomputedRevisions.rawRevisionId) errors.push('raw_revision');
    if (input.revisions.selectedRevisionId !== recomputedRevisions.selectedRevisionId) errors.push('selected_revision');
    if (input.canonicalEvidence.vocabularyRevision !== vocabularyRevision(input.canonicalEvidence, input.context)) errors.push('vocabulary_revision');
    if (new Set(selectedRowIndices).size !== selectedRowIndices.length) errors.push('ambiguous_selected_row');
    const recordsById = new Map();
    for (const record of input.response.records) {
        if (!record.sourceOccurrenceId) errors.push('missing_occurrence_id');
        const key = `${record.sourceOccurrenceId || ''}`;
        const prior = recordsById.get(key);
        if (prior) errors.push(prior.suggestedReplacement === record.suggestedReplacement
            ? 'duplicate_occurrence_record' : 'conflicting_occurrence_record');
        recordsById.set(key, record);
        const occurrence = input.occurrenceRegistry.find(candidate => candidate.sourceOccurrenceId === record.sourceOccurrenceId);
        if (!occurrence) { errors.push('unknown_occurrence_id'); continue; }
        if (occurrence.rawSourceSha256 !== input.revisions.rawSourceSha256) errors.push('occurrence_source_hash');
        if (occurrence.rawRevisionId !== input.revisions.rawRevisionId) errors.push('occurrence_raw_revision');
        if (occurrence.selectedRevisionId !== input.revisions.selectedRevisionId) errors.push('occurrence_selected_revision');
        if (!Number.isInteger(occurrence.rawStartUtf16) || !Number.isInteger(occurrence.rawEndUtf16)
            || occurrence.rawStartUtf16 < 0 || occurrence.rawEndUtf16 > input.rawSource.length
            || occurrence.rawStartUtf16 >= occurrence.rawEndUtf16) { errors.push('occurrence_coordinates'); continue; }
        const exactSourceToken = input.rawSource.slice(occurrence.rawStartUtf16, occurrence.rawEndUtf16);
        if (exactSourceToken !== occurrence.sourceToken) errors.push('occurrence_anchor');
        const before = input.rawSource.slice(0, occurrence.rawStartUtf16);
        if (occurrence.rawStartCodePoint !== cpLength(before) || occurrence.rawEndCodePoint !== cpLength(before + exactSourceToken)) errors.push('code_point_audit');
        if (occurrence.rawStartUtf8Byte !== byteLength(before) || occurrence.rawEndUtf8Byte !== byteLength(before + exactSourceToken)) errors.push('utf8_audit');
        if (!input.reviewProjection.selectedRows.some(row => occurrence.rawRowIndex === row.rawRowIndex
            && occurrence.rawStartUtf16 >= row.rawStartUtf16 && occurrence.rawEndUtf16 <= row.rawEndUtf16)) errors.push('outside_selected_projection');
        if (input.reviewProjection.readOnlyRows?.includes(occurrence.rawRowIndex)) errors.push('read_only_row');
        if (input.reviewProjection.baselineUnchangedRows?.includes(occurrence.rawRowIndex)) errors.push('unchanged_baseline_row');
        if (input.reviewProjection.protectedSpans?.some(span => occurrence.rawStartUtf16 < span.endUtf16
            && occurrence.rawEndUtf16 > span.startUtf16
            && input.rawSource.slice(span.startUtf16, span.endUtf16) === span.sourceText)) errors.push('protected_span');
        const finding = input.findingRegistry.find(candidate => candidate.spellingFindingId === record.spellingFindingId);
        if (!finding) errors.push('missing_finding');
        else {
            if (finding.spellingFindingId !== occurrence.spellingFindingId) errors.push('occurrence_finding');
            if (finding.found !== occurrence.sourceToken || record.sourceToken !== occurrence.sourceToken) errors.push('source_token');
            if (finding.canonical !== occurrence.suggestedReplacement
                || record.suggestedReplacement !== occurrence.suggestedReplacement) errors.push('target_token');
            if (finding.evidenceRevision !== occurrence.findingOrPolicyRevision) errors.push('evidence_revision');
            if (finding.source === 'approved_corpus') errors.push('corpus_only');
        }
        const expectedId = `SO-${hashFields([
            occurrence.rawSourceSha256, occurrence.rawRevisionId, occurrence.selectedRevisionId, occurrence.rawRowIndex,
            occurrence.rawStartUtf16, occurrence.rawEndUtf16, occurrence.sourceToken.normalize('NFC'),
            occurrence.findingOrPolicyRevision,
        ])}`;
        if (expectedId !== occurrence.sourceOccurrenceId) errors.push('occurrence_id_digest');
        const directRule = input.canonicalEvidence.acceptedRules.some(rule => rule.status === 'accepted'
            && rule.original_text === occurrence.sourceToken && rule.corrected_text === occurrence.suggestedReplacement
            && rule.location === input.context.property && rule.applies_to_menu_type === input.context.templateType);
        const reviewerCanonical = input.canonicalEvidence.acceptedRules.some(rule => rule.status === 'accepted'
            && rule.corrected_text === occurrence.suggestedReplacement && rule.location === input.context.property
            && rule.applies_to_menu_type === input.context.templateType);
        if (!directRule && (!reviewerCanonical || finding?.source !== 'reviewer_rule')) errors.push('no_reviewer_authority');
        if (input.canonicalEvidence.approvedTerms.some(term => term.term.normalize('NFC').toLowerCase()
            === occurrence.sourceToken.normalize('NFC').toLowerCase() && term.count > 0)) errors.push('legitimate_source');
        if (/\p{N}|\p{Sc}|[*%¼½¾⅓⅔]|(?:^|[^\p{L}])(MP|MKT|GF|VG)(?:$|[^\p{L}])/u.test(occurrence.sourceToken)) errors.push('protected_syntax');
    }
    const orderedOccurrences = [...input.occurrenceRegistry].filter(item => Number.isInteger(item.rawStartUtf16))
        .sort((a, b) => a.rawStartUtf16 - b.rawStartUtf16);
    for (let index = 1; index < orderedOccurrences.length; index++) {
        if (orderedOccurrences[index].rawStartUtf16 < orderedOccurrences[index - 1].rawEndUtf16) errors.push('overlapping_occurrences');
    }
    for (const mutation of input.precheckLedger || []) {
        if (mutation.sourceRevisionId !== input.revisions.rawRevisionId) errors.push('stale_precheck_revision');
        if (mutation.sourceStartUtf16 === mutation.sourceEndUtf16 && mutation.after) errors.push('inserted_precheck_without_raw_origin');
        if (mutation.before && !mutation.after) errors.push('deleted_precheck_origin');
    }
    return [...new Set(errors)];
}

function validateRuntimeInput(item, manifest) {
    const input = item.runtimeInput;
    const forbidden = containsForbiddenKey(input, manifest.adapterContract.forbiddenRuntimeKeys);
    assert(!forbidden, `${item.caseId} leaks expected/label key into runtime input: ${forbidden}`);
    assert(input.response.records.every(record => record.spellingDisposition === 'corrected' && record.confidence === 'high'),
        `${item.caseId} is not an adversarial corrected/high-confidence response.`);
    assert(input.response.records.every(record => typeof record.type === 'string'
        && typeof record.description === 'string' && typeof record.recommendation === 'string'),
    `${item.caseId} has a syntactically invalid response record.`);
    return runtimeBindingErrors(input);
}

function validateManifest(manifest) {
    const expected = buildManifest();
    assert(JSON.stringify(manifest) === JSON.stringify(expected), 'Phase 0 v2 manifest differs from deterministic construction.');
    const counts = {};
    const ids = new Set();
    for (const item of manifest.cases) {
        assert(!ids.has(item.caseId), `Duplicate case ID ${item.caseId}.`);
        ids.add(item.caseId);
        counts[item.cohort] = (counts[item.cohort] || 0) + 1;
        const errors = validateRuntimeInput(item, manifest);
        if (['new_aliases_known_canonicals', 'mixed_rows', 'legitimate_semantic_neighbors'].includes(item.cohort)) {
            const occurrence = item.runtimeInput.occurrenceRegistry[0];
            const budget = occurrence.sourceToken.length >= 8 ? 2 : 1;
            assert(occurrence.sourceToken.length >= 4
                && damerauDistance(occurrence.sourceToken, occurrence.suggestedReplacement) <= budget,
            `${item.caseId} cannot be produced by the bounded reviewer-canonical near-miss resolver.`);
        }
        if (item.expected.outcome === 'apply') assert(errors.length === 0, `${item.caseId} apply input is invalid: ${errors.join(',')}`);
        else {
            assert(errors.length > 0, `${item.caseId} hold input lacks a constructed blocking condition.`);
            for (const required of item.constructionAudit.requiredConstructedErrors || []) {
                assert(errors.includes(required), `${item.caseId} does not structurally construct ${required}; got ${errors.join(',')}.`);
            }
        }
        if (item.positiveControl) {
            const controlErrors = validateRuntimeInput({ ...item, caseId: `${item.caseId}:control`, runtimeInput: item.positiveControl.runtimeInput,
                constructionAudit: { primaryBlockingInput: null } }, manifest);
            assert(controlErrors.length === 0, `${item.caseId} positive control is invalid: ${controlErrors.join(',')}`);
        }
    }
    for (const [cohort, minimum] of Object.entries(manifest.cohortMinimums)) {
        assert(counts[cohort] === minimum, `${cohort} count ${counts[cohort] || 0} does not equal ${minimum}.`);
    }
    const coordinateAudit = manifest.coordinateScenarios.map(scenario => ({
        id: scenario.id,
        constructedReason: classifyCoordinateScenario(scenario),
        expectedReason: scenario.expected.reason,
    }));
    for (const result of coordinateAudit) assert(result.constructedReason === result.expectedReason,
        `${result.id} constructs ${result.constructedReason}, expected ${result.expectedReason}.`);
    assert(manifest.thresholds.developmentExpectedOutcomeMatchRate === 1, 'Outcome threshold changed.');
    assert(manifest.thresholds.retrospectiveEligibleAliasRecoveryRateEachRepeat === 0.8, 'Recovery threshold changed.');
    assert(manifest.thresholds.retrospectiveEligibleAliasAbsoluteUpliftVsCandidate5EachRepeat === 0.2, 'Uplift threshold changed.');
    return { manifestSha256: sha256(fs.readFileSync(manifestPath)), caseCount: manifest.cases.length,
        controlCount: manifest.cases.filter(item => item.positiveControl).length,
        counts, coordinateAudit, thresholds: manifest.thresholds };
}

function main() {
    if (process.argv.includes('--write')) {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(manifestPath, `${JSON.stringify(buildManifest(), null, 2)}\n`);
    }
    assert(fs.existsSync(manifestPath), `Missing ${manifestPath}.`);
    process.stdout.write(`${JSON.stringify(validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))), null, 2)}\n`);
}

if (require.main === module) {
    try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { buildManifest, validateManifest, classifyCoordinateScenario, runtimeBindingErrors };

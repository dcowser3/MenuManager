'use strict';
const { createHash } = require('crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalizedInput = text => `${text || ''}`.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function inputSignature(row) {
    const text = normalizedInput(row.raw_input);
    const shingles = [...new Set(Array.from({ length: Math.max(0, text.length - 4) }, (_, i) => hash(text.slice(i, i + 5))))].sort();
    return { digest: hash(text), shingles, lineage: row.lineage_id || null, baseline: row.baseline_id || null,
        templateVariant: row.template_variant_group || null, property: row.context?.property || null, reviewedAt: row.reviewed_at || null };
}
function signaturesRelated(a, b) {
    if (a.digest === b.digest || ['lineage', 'baseline', 'templateVariant'].some(key => a[key] && a[key] === b[key])) return true;
    if (a.shingles.length < 16 || b.shingles.length < 16) return false;
    const other = new Set(b.shingles), common = a.shingles.filter(value => other.has(value)).length;
    return common / (a.shingles.length + b.shingles.length - common) >= 0.8;
}
function validateSplit(dataset, split) {
    if (split?.schemaVersion !== 1 || !Number.isFinite(Date.parse(split.frozenAt)) || !split.membership || !split.groups) throw new Error('Holdout requires a frozen, versioned split with group membership.');
    const sides = new Map();
    const ids = new Set();
    for (const [side, members] of Object.entries(split.membership)) {
        if (!['training', 'validation', 'holdout', 'lockbox', 'retired'].includes(side) || !Array.isArray(members)) throw new Error('Invalid split membership.');
        for (const id of members) {
            if (ids.has(id) || !split.groups[id]) throw new Error('Split has duplicate membership or unknown lineage group.');
            ids.add(id);
            const group = split.groups[id];
            if (sides.has(group) && sides.get(group) !== side) throw new Error('Related cases cross evaluation split boundaries.');
            sides.set(group, side);
        }
    }
    if (!split.inputSignatures || split.separationMethod !== 'lineage-and-near-duplicate-v1') throw new Error('Holdout requires frozen lineage and near-duplicate signatures for the full split.');
    const allIds = [...ids];
    if (split.cutoff !== undefined && !Number.isFinite(Date.parse(split.cutoff))) throw new Error('Invalid chronological cutoff.');
    if (split.cutoff !== undefined && Date.parse(split.cutoff) > Date.parse(split.frozenAt)) throw new Error('Cutoff follows split freeze time.');
    for (const id of allIds) if (!split.inputSignatures[id]?.digest || !Array.isArray(split.inputSignatures[id]?.shingles)) throw new Error('Missing frozen split input signature.');
    if (split.cutoff !== undefined) for (const id of allIds) {
        const side = sides.get(split.groups[id]), reviewedAt = split.inputSignatures[id].reviewedAt;
        if (side === 'retired') continue;
        if (!reviewedAt || !Number.isFinite(Date.parse(reviewedAt))) throw new Error('Chronological holdout needs review-date provenance for every split member.');
        if (['holdout', 'lockbox'].includes(side) && Date.parse(reviewedAt) <= Date.parse(split.cutoff)) throw new Error('Holdout precedes the frozen time cutoff.');
        if (['training', 'validation'].includes(side) && Date.parse(reviewedAt) > Date.parse(split.cutoff)) throw new Error('Training or validation data follows the frozen time cutoff.');
    }
    for (let i = 0; i < allIds.length; i++) for (let j = i + 1; j < allIds.length; j++) {
        if (sides.get(split.groups[allIds[i]]) !== sides.get(split.groups[allIds[j]])
            && signaturesRelated(split.inputSignatures[allIds[i]], split.inputSignatures[allIds[j]]))
            throw new Error('Related or near-duplicate menu inputs cross split boundaries.');
    }
    const seenInputs = new Map();
    for (const row of dataset) {
        const id = row.case_id;
        if (!ids.has(id)) throw new Error(`Case not in frozen split: ${id}`);
        if (hash(inputSignature(row)) !== hash(split.inputSignatures[id])) throw new Error('Case differs from frozen split input signature.');
        const side = sides.get(split.groups[id]);
        const key = normalizedInput(row.raw_input);
        if (seenInputs.has(key) && seenInputs.get(key) !== side) throw new Error('Duplicate menu inputs cross split boundaries.');
        seenInputs.set(key, side);
        if (split.cutoff) {
            if (!row.reviewed_at || !Number.isFinite(Date.parse(row.reviewed_at))) throw new Error('Chronological holdout needs review-date provenance for every case.');
            if (['holdout', 'lockbox'].includes(side) && Date.parse(row.reviewed_at) <= Date.parse(split.cutoff)) throw new Error('Holdout precedes the frozen time cutoff.');
            if (side === 'training' && Date.parse(row.reviewed_at) > Date.parse(split.cutoff)) throw new Error('Training data follows the frozen time cutoff.');
        }
    }
    return hash(split);
}
function createEvaluationContract({ mode = 'retrospective', dataset, vocabularySnapshot, split, expectationArtifact }) {
    if (!['retrospective', 'holdout'].includes(mode)) throw new Error('Evaluation mode must be retrospective or holdout.');
    let vocabulary = vocabularySnapshot;
    if (mode === 'holdout') {
        if (vocabulary?.schemaVersion !== 1 || !vocabulary.provenance?.source || !Number.isFinite(Date.parse(vocabulary.provenance?.frozenAt))
            || !Array.isArray(vocabulary.provenance?.caseIds) || (!Array.isArray(vocabulary.texts) && !Array.isArray(vocabulary.terms))) {
            throw new Error('Holdout requires a separate frozen vocabulary snapshot and provenance.');
        }
        validateSplit(dataset, split);
        const protectedIds = [...(split.membership.holdout || []), ...(split.membership.lockbox || [])];
        if (vocabulary.provenance.caseIds.some(id => protectedIds.includes(id))) throw new Error('Holdout answers are present in vocabulary provenance.');
        if (vocabulary.provenance.caseIds.some(id => !(split.membership.training || []).includes(id))) throw new Error('Vocabulary provenance must reference frozen training members only.');
        if (dataset.some(row => !protectedIds.includes(row.case_id))) throw new Error('Holdout evaluation may contain only frozen holdout/lockbox members.');
    }
    // Even retrospective runs use raw inputs, never their own approved answers, for fallback vocabulary.
    vocabulary ||= { schemaVersion: 1, texts: dataset.map(row => row.raw_input), terms: [], provenance: { source: 'retrospective_inputs', caseIds: dataset.map(row => row.case_id) } };
    if (expectationArtifact && (expectationArtifact.schemaVersion !== 1 || !expectationArtifact.approvedBy || !expectationArtifact.revision || !expectationArtifact.expectations)) {
        throw new Error('Changed expectations require a separately versioned reviewer-approved artifact.');
    }
    const expectations = Object.fromEntries(dataset.map(row => [row.case_id,
        expectationArtifact?.expectations[row.case_id] ?? row.ground_truth]));
    return Object.freeze({ schemaVersion: 1, mode, datasetMembership: dataset.map(row => row.case_id),
        inputHashes: Object.fromEntries(dataset.map(row => [row.case_id, hash({ input: row.raw_input, context: row.context })])),
        expectations: Object.freeze(expectations), expectationHash: hash(expectations), expectationRevision: expectationArtifact?.revision || 'raw-human',
        vocabulary: JSON.parse(JSON.stringify(vocabulary)), vocabularyHash: hash(vocabulary), splitHash: split ? hash(split) : null,
        provenance: vocabulary.provenance });
}
function reportFreshness(usage, ai = true) {
    return !ai ? 'deterministic' : usage.cacheHits > 0 ? 'cached_or_mixed' : usage.apiCalls > 0 ? 'fresh' : 'unknown';
}
function retireExposedCases(split, caseIds, reason) {
    const copy = JSON.parse(JSON.stringify(split));
    const groups = new Set(caseIds.map(id => copy.groups[id]));
    const retiring = ['holdout', 'lockbox'].flatMap(side => copy.membership[side] || []).filter(id => groups.has(copy.groups[id]));
    for (const side of ['holdout', 'lockbox']) copy.membership[side] = (copy.membership[side] || []).filter(id => !retiring.includes(id));
    copy.membership.retired = [...new Set([...(copy.membership.retired || []), ...retiring])];
    copy.transitions = [...(copy.transitions || []), { caseIds: retiring, reason, at: new Date().toISOString() }];
    return copy;
}
module.exports = { hash, inputSignature, signaturesRelated, validateSplit, createEvaluationContract, reportFreshness, retireExposedCases };

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REVIEW_ENGINE_VERSION = void 0;
exports.freezeReviewEnvelope = freezeReviewEnvelope;
exports.applyAnchoredMutations = applyAnchoredMutations;
exports.attributeCorrectedBlock = attributeCorrectedBlock;
exports.boundedMutationDiagnostics = boundedMutationDiagnostics;
const canonical_policy_1 = require("./canonical-policy");
exports.REVIEW_ENGINE_VERSION = 'review-coordinator-v1';
function freezeReviewEnvelope(value) {
    const copy = JSON.parse(JSON.stringify(value));
    const freeze = (item) => {
        if (item && typeof item === 'object') {
            Object.values(item).forEach(freeze);
            Object.freeze(item);
        }
        return item;
    };
    return freeze(copy);
}
function validateEditableSpans(source, editable) {
    if (!Array.isArray(editable))
        return 'malformed_editable_spans';
    const ids = new Set();
    const coordinates = new Set();
    const spans = editable.map(span => {
        if (!span || typeof span.id !== 'string' || !span.id.trim()
            || !Number.isInteger(span.start) || !Number.isInteger(span.end)
            || span.start < 0 || span.end < span.start || span.end > source.length) {
            return null;
        }
        const coordinateKey = `${span.start}:${span.end}`;
        if (ids.has(span.id) || coordinates.has(coordinateKey))
            return null;
        ids.add(span.id);
        coordinates.add(coordinateKey);
        return span;
    });
    if (spans.some(span => span === null)) {
        const duplicateOrAmbiguous = editable.some((span, index) => spans[index] === null
            && editable.slice(0, index).some(previous => previous.id === span?.id
                || (previous.start === span?.start && previous.end === span?.end)));
        return duplicateOrAmbiguous ? 'ambiguous_editable_spans' : 'malformed_editable_spans';
    }
    const valid = spans;
    for (let index = 0; index < valid.length; index++) {
        for (let other = index + 1; other < valid.length; other++) {
            if (valid[index].start < valid[other].end && valid[other].start < valid[index].end) {
                return 'ambiguous_editable_spans';
            }
        }
    }
    return null;
}
/** Validate every edit against the same original snapshot before applying any edit. */
function applyAnchoredMutations(source, mutations, editable) {
    const spanFailure = validateEditableSpans(source, editable);
    if (spanFailure)
        return { text: source, reason: spanFailure };
    const ordered = [...mutations].sort((a, b) => a.start - b.start || a.end - b.end);
    let previousEnd = -1;
    let previousPatch;
    for (const patch of ordered) {
        if (!Number.isInteger(patch.start) || !Number.isInteger(patch.end)
            || patch.start < 0 || patch.end < patch.start || patch.end > source.length
            || source.slice(patch.start, patch.end) !== patch.before) {
            return { text: source, reason: 'source_anchor_mismatch' };
        }
        if (patch.start < previousEnd)
            return { text: source, reason: 'overlapping_edits' };
        if (previousPatch && patch.start === patch.end && previousPatch.start === previousPatch.end
            && patch.start === previousPatch.start) {
            return { text: source, reason: 'overlapping_edits' };
        }
        const containing = editable.filter(span => patch.start >= span.start && patch.end <= span.end);
        if (containing.length !== 1)
            return { text: source, reason: 'read_only_or_ambiguous_anchor' };
        previousEnd = patch.end;
        previousPatch = patch;
    }
    let text = source;
    for (const patch of ordered.reverse())
        text = text.slice(0, patch.start) + patch.after + text.slice(patch.end);
    return { text, reason: 'applied' };
}
function rowSpans(source) {
    const spans = [];
    let start = 0;
    source.split('\n').forEach((row, index) => {
        spans.push({ id: `row:${index}`, start, end: start + row.length });
        start += row.length + 1;
    });
    return spans;
}
function singleRowMutation(source, corrected, start, end) {
    let prefix = 0;
    while (prefix < source.length && prefix < corrected.length && source[prefix] === corrected[prefix])
        prefix++;
    let sourceEnd = source.length;
    let correctedEnd = corrected.length;
    while (sourceEnd > prefix && correctedEnd > prefix && source[sourceEnd - 1] === corrected[correctedEnd - 1]) {
        sourceEnd--;
        correctedEnd--;
    }
    const before = source.slice(prefix, sourceEnd);
    const after = corrected.slice(prefix, correctedEnd);
    if (!before && !after)
        return null;
    return { start: start + prefix, end: start + sourceEnd, before, after, confidence: 'unknown' };
}
/** Attribute only exact positional row edits; ambiguous whole-block changes fail closed. */
function attributeCorrectedBlock(source, corrected, _acceptedRules = [], context = {}) {
    if (source === corrected)
        return { text: source, diagnostics: [], mutations: [] };
    const sourceRows = source.split('\n');
    const correctedRows = corrected.split('\n');
    if (sourceRows.length !== correctedRows.length) {
        return { text: source, diagnostics: ['ambiguous_whole_block'], mutations: [] };
    }
    const counts = new Map();
    sourceRows.forEach(row => counts.set(row, (counts.get(row) || 0) + 1));
    const editable = context.editableSpans || rowSpans(source);
    const mutations = [];
    let offset = 0;
    for (let index = 0; index < sourceRows.length; index++) {
        const sourceRow = sourceRows[index];
        const correctedRow = correctedRows[index];
        if (sourceRow !== correctedRow) {
            if ((counts.get(sourceRow) || 0) > 1) {
                return { text: source, diagnostics: [`duplicate_row_fallback:${index}`], mutations: [] };
            }
            const rowSpan = editable.find(span => span.start <= offset && span.end >= offset + sourceRow.length);
            if (!rowSpan)
                return { text: source, diagnostics: [`read_only_row:${index}`], mutations: [] };
            const mutation = singleRowMutation(sourceRow, correctedRow, offset, offset + sourceRow.length);
            if (mutation)
                mutations.push(mutation);
        }
        offset += sourceRow.length + 1;
    }
    const applied = applyAnchoredMutations(source, mutations, editable);
    return applied.reason === 'applied'
        ? { text: applied.text, diagnostics: [], mutations }
        : { text: source, diagnostics: [applied.reason], mutations: [] };
}
function boundedMutationDiagnostics(source, finalText) {
    return attributeCorrectedBlock(source, finalText).mutations.slice(0, 200).map((mutation, occurrence) => ({
        stage: 'final', occurrence, start: mutation.start, end: mutation.end,
        beforeHash: (0, canonical_policy_1.policyHash)(mutation.before), afterHash: (0, canonical_policy_1.policyHash)(mutation.after),
        confidence: mutation.confidence || 'unknown', reason: 'anchored_edit',
    }));
}

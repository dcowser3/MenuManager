"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HUMAN_EXPLANATION_AUDIT_STAGES = exports.HUMAN_EXPLANATION_SUBMITTED_DRAFT_METHOD = exports.HUMAN_EXPLANATION_BINDING_METHOD = exports.HUMAN_EXPLANATION_COORDINATE_BASIS = exports.HUMAN_EXPLANATION_SOURCE_STAGE = exports.HUMAN_EXPLANATION_SOURCE_BINDING_VERSION = void 0;
exports.matchesSubmittedDraftToLearningComparison = matchesSubmittedDraftToLearningComparison;
exports.buildHumanExplanationSourceBinding = buildHumanExplanationSourceBinding;
exports.isHumanExplanationSourceBinding = isHumanExplanationSourceBinding;
exports.sha256Text = sha256Text;
const crypto_1 = require("crypto");
/**
 * Versioned, immutable provenance for a human explanation.  This envelope is
 * assembled by the dashboard from the trusted differ/audit responses; it is
 * never accepted from the browser or from model output.
 */
exports.HUMAN_EXPLANATION_SOURCE_BINDING_VERSION = 'human-explanation-source-binding-v1';
exports.HUMAN_EXPLANATION_SOURCE_STAGE = 'differ_ai_draft_v1';
exports.HUMAN_EXPLANATION_COORDINATE_BASIS = 'utf16_line_span_v1';
exports.HUMAN_EXPLANATION_BINDING_METHOD = 'exact_content_hash_v1';
exports.HUMAN_EXPLANATION_SUBMITTED_DRAFT_METHOD = 'submitted_draft_comparison_hash_v1';
exports.HUMAN_EXPLANATION_AUDIT_STAGES = new Set([
    'audit_final_result_corrected_menu_v1',
    'audit_parsed_response_corrected_menu_v1',
]);
/** Only the durable draft for this exact submission and attempt can replace an audit text match. */
function matchesSubmittedDraftToLearningComparison(submission, learning, submissionId) {
    return submission?.id === submissionId
        && typeof submission?.form_attempt_id === 'string'
        && submission.form_attempt_id.length > 0
        && submission.form_attempt_id === learning?.source_attempt_id
        && typeof submission?.ai_draft_path === 'string'
        && submission.ai_draft_path.length > 0
        && submission.ai_draft_path === learning?.ai_draft_path;
}
function text(value, label) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${label} is required.`);
    return value;
}
function sha256Text(value) {
    return (0, crypto_1.createHash)('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}
function sha256Json(value) {
    return sha256Text(JSON.stringify(value));
}
function digest(value, label) {
    const normalized = text(value, label);
    if (!/^[a-f0-9]{64}$/u.test(normalized))
        throw new Error(`${label} must be an exact SHA-256.`);
    return normalized;
}
/** Build a binding from trusted server-side source records only. */
function buildHumanExplanationSourceBinding(input) {
    const submissionId = text(input.submissionId, 'submission_id').trim();
    const attemptId = text(input.attemptId, 'attempt_id').trim();
    const sourceDocumentPath = input.sourceDocumentPath == null ? undefined : text(input.sourceDocumentPath, 'source_document_path').trim();
    const auditId = sourceDocumentPath ? null : text(input.auditId, 'audit_id').trim();
    const sourceSnapshotSha256 = digest(input.sourceSnapshotSha256, 'source_snapshot_sha256');
    const matchedAuditStage = sourceDocumentPath ? null : text(input.matchedAuditStage, 'matched_audit_stage').trim();
    if (!sourceDocumentPath && !exports.HUMAN_EXPLANATION_AUDIT_STAGES.has(matchedAuditStage)) {
        throw new Error('matched_audit_stage is not an approved audited source stage.');
    }
    const matchedAuditSnapshotSha256 = sourceDocumentPath ? null : digest(input.matchedAuditSnapshotSha256, 'matched_audit_snapshot_sha256');
    if (!sourceDocumentPath && matchedAuditSnapshotSha256 !== sourceSnapshotSha256) {
        throw new Error('The matched audit source hash must equal the trusted differ source hash.');
    }
    const comparisonRevision = text(input.comparisonRevision, 'comparison_revision').trim();
    const sourceExtractionVersion = text(input.sourceExtractionVersion, 'source_extraction_version').trim();
    const correction = input.correction;
    if (!correction || typeof correction.correction_id !== 'string' || !correction.correction_id.trim()) {
        throw new Error('correction_id is required for source binding.');
    }
    if (!Number.isInteger(correction.line_index) || correction.line_index < 0) {
        throw new Error('source line_index must be a non-negative integer.');
    }
    if (typeof correction.before_line !== 'string' || typeof correction.after_line !== 'string') {
        throw new Error('source before/after spans must be strings.');
    }
    const startUtf16 = correction.source_span?.start_utf16;
    const endUtf16 = correction.source_span?.end_utf16;
    if (!Number.isInteger(startUtf16) || !Number.isInteger(endUtf16)
        || startUtf16 < 0 || endUtf16 < startUtf16) {
        throw new Error('source span coordinates are invalid.');
    }
    const start = startUtf16;
    const end = endUtf16;
    if (end - start !== correction.before_line.length) {
        throw new Error('source span does not cover the trusted before text.');
    }
    const span = {
        line_index: correction.line_index,
        row_index: Number.isInteger(correction.source_span?.row_index) ? correction.source_span.row_index : null,
        start_utf16: start,
        end_utf16: end,
        before_text: correction.before_line,
        before_text_sha256: sha256Text(correction.before_line),
        after_text: correction.after_line,
        after_text_sha256: sha256Text(correction.after_line),
    };
    const correctionId = correction.correction_id.trim();
    const caseId = `learning:${submissionId}:${correctionId}`;
    const revisionInput = {
        version: exports.HUMAN_EXPLANATION_SOURCE_BINDING_VERSION,
        submission_id: submissionId,
        case_id: caseId,
        correction_id: correctionId,
        attempt_id: attemptId,
        audit_id: auditId,
        comparison_revision: comparisonRevision,
        source_extraction_version: sourceExtractionVersion,
        binding_method: sourceDocumentPath ? exports.HUMAN_EXPLANATION_SUBMITTED_DRAFT_METHOD : exports.HUMAN_EXPLANATION_BINDING_METHOD,
        source_stage: exports.HUMAN_EXPLANATION_SOURCE_STAGE,
        coordinate_basis: exports.HUMAN_EXPLANATION_COORDINATE_BASIS,
        source_snapshot_sha256: sourceSnapshotSha256,
        matched_audit_stage: matchedAuditStage,
        matched_audit_snapshot_sha256: matchedAuditSnapshotSha256,
        ...(sourceDocumentPath ? { source_document_path: sourceDocumentPath } : {}),
        span,
    };
    return Object.freeze({
        ...revisionInput,
        source_revision_id: `SER-${sha256Json(revisionInput)}`,
        span: Object.freeze(span),
    });
}
function isHumanExplanationSourceBinding(value) {
    const binding = value;
    if (!binding || typeof binding !== 'object')
        return false;
    try {
        const rebuilt = buildHumanExplanationSourceBinding({
            submissionId: binding.submission_id,
            attemptId: binding.attempt_id,
            auditId: binding.audit_id,
            sourceDocumentPath: binding.source_document_path,
            sourceSnapshotSha256: binding.source_snapshot_sha256,
            matchedAuditStage: binding.matched_audit_stage,
            matchedAuditSnapshotSha256: binding.matched_audit_snapshot_sha256,
            comparisonRevision: binding.comparison_revision,
            sourceExtractionVersion: binding.source_extraction_version,
            correction: {
                correction_id: binding.correction_id,
                line_index: binding.span?.line_index,
                before_line: binding.span?.before_text,
                after_line: binding.span?.after_text,
                source_span: {
                    start_utf16: binding.span?.start_utf16,
                    end_utf16: binding.span?.end_utf16,
                    row_index: binding.span?.row_index ?? undefined,
                },
            },
        });
        return binding.version === exports.HUMAN_EXPLANATION_SOURCE_BINDING_VERSION
            && binding.case_id === `learning:${binding.submission_id}:${binding.correction_id}`
            && binding.source_stage === exports.HUMAN_EXPLANATION_SOURCE_STAGE
            && binding.coordinate_basis === exports.HUMAN_EXPLANATION_COORDINATE_BASIS
            && binding.binding_method === rebuilt.binding_method
            && binding.source_revision_id === rebuilt.source_revision_id
            && binding.span.line_index === rebuilt.span.line_index
            && binding.span.row_index === rebuilt.span.row_index
            && binding.span.start_utf16 === rebuilt.span.start_utf16
            && binding.span.end_utf16 === rebuilt.span.end_utf16
            && binding.span.before_text === rebuilt.span.before_text
            && binding.span.before_text_sha256 === rebuilt.span.before_text_sha256
            && binding.span.after_text === rebuilt.span.after_text
            && binding.span.after_text_sha256 === rebuilt.span.after_text_sha256;
    }
    catch {
        return false;
    }
}

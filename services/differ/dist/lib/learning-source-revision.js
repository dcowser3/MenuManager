"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEARNING_COORDINATE_BASIS = exports.LEARNING_SOURCE_STAGE = exports.LEARNING_SOURCE_EXTRACTION_VERSION = void 0;
exports.sha256Text = sha256Text;
exports.comparisonRevision = comparisonRevision;
const crypto_1 = __importDefault(require("crypto"));
exports.LEARNING_SOURCE_EXTRACTION_VERSION = 'differ-source-extraction-v1';
exports.LEARNING_SOURCE_STAGE = 'differ_ai_draft_v1';
exports.LEARNING_COORDINATE_BASIS = 'utf16_line_span_v1';
function sha256Text(value) {
    return crypto_1.default.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}
function comparisonRevision(submissionId, sourceAttemptId, sourceSnapshotSha256, finalText) {
    return `comparison-${sha256Text(JSON.stringify({
        submission_id: submissionId,
        source_attempt_id: sourceAttemptId,
        source_stage: exports.LEARNING_SOURCE_STAGE,
        source_snapshot_sha256: sourceSnapshotSha256,
        final_snapshot_sha256: sha256Text(finalText),
        extraction_version: exports.LEARNING_SOURCE_EXTRACTION_VERSION,
    }))}`;
}

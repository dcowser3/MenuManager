import crypto from 'crypto';

export const LEARNING_SOURCE_EXTRACTION_VERSION = 'differ-source-extraction-v1';
export const LEARNING_SOURCE_STAGE = 'differ_ai_draft_v1';
export const LEARNING_COORDINATE_BASIS = 'utf16_line_span_v1';

export function sha256Text(value: string): string {
    return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

export function comparisonRevision(submissionId: string, sourceAttemptId: string, sourceSnapshotSha256: string, finalText: string): string {
    return `comparison-${sha256Text(JSON.stringify({
        submission_id: submissionId,
        source_attempt_id: sourceAttemptId,
        source_stage: LEARNING_SOURCE_STAGE,
        source_snapshot_sha256: sourceSnapshotSha256,
        final_snapshot_sha256: sha256Text(finalText),
        extraction_version: LEARNING_SOURCE_EXTRACTION_VERSION,
    }))}`;
}

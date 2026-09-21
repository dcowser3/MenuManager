import {
    buildHumanExplanationSourceBinding,
    HUMAN_EXPLANATION_COORDINATE_BASIS,
    HUMAN_EXPLANATION_SOURCE_STAGE,
    isHumanExplanationSourceBinding,
} from '../lib/human-explanation-source-binding';

const digest = (value: string) => require('crypto').createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');

function correction() {
    return {
        correction_id: 'dish-0',
        line_index: 1,
        before_line: 'Dish, lemons G 8',
        after_line: 'Dish, lemon G 8',
        source_span: { row_index: 1, start_utf16: 6, end_utf16: 22 },
    };
}

describe('human explanation source binding', () => {
    test('binds exact differ span to the matched audit stage/hash and derives a stable revision', () => {
        const sourceHash = digest('title\nDish, lemons G 8');
        const binding = buildHumanExplanationSourceBinding({
            submissionId: 'submission-1',
            attemptId: 'attempt-1',
            auditId: 'audit-1',
            sourceSnapshotSha256: sourceHash,
            matchedAuditStage: 'audit_final_result_corrected_menu_v1',
            matchedAuditSnapshotSha256: sourceHash,
            comparisonRevision: 'comparison-a1',
            sourceExtractionVersion: 'differ-source-extraction-v1',
            correction: correction(),
        });

        expect(binding).toMatchObject({
            version: 'human-explanation-source-binding-v1',
            submission_id: 'submission-1',
            case_id: 'learning:submission-1:dish-0',
            correction_id: 'dish-0',
            attempt_id: 'attempt-1',
            audit_id: 'audit-1',
            source_stage: HUMAN_EXPLANATION_SOURCE_STAGE,
            coordinate_basis: HUMAN_EXPLANATION_COORDINATE_BASIS,
            matched_audit_stage: 'audit_final_result_corrected_menu_v1',
            source_snapshot_sha256: sourceHash,
            matched_audit_snapshot_sha256: sourceHash,
            span: expect.objectContaining({ before_text: 'Dish, lemons G 8', after_text: 'Dish, lemon G 8' }),
        });
        expect(binding.source_revision_id).toMatch(/^SER-[a-f0-9]{64}$/u);
        expect(isHumanExplanationSourceBinding(binding)).toBe(true);
        expect(isHumanExplanationSourceBinding({
            ...binding,
            span: {
                after_text_sha256: binding.span.after_text_sha256,
                after_text: binding.span.after_text,
                before_text_sha256: binding.span.before_text_sha256,
                before_text: binding.span.before_text,
                end_utf16: binding.span.end_utf16,
                start_utf16: binding.span.start_utf16,
                row_index: binding.span.row_index,
                line_index: binding.span.line_index,
            },
        })).toBe(true);
    });

    test('fails closed when the matched audit stage does not hash to the differ source', () => {
        expect(() => buildHumanExplanationSourceBinding({
            submissionId: 'submission-1',
            attemptId: 'attempt-1',
            auditId: 'audit-1',
            sourceSnapshotSha256: digest('differ source'),
            matchedAuditStage: 'audit_final_result_corrected_menu_v1',
            matchedAuditSnapshotSha256: digest('different audit source'),
            comparisonRevision: 'comparison-a1',
            sourceExtractionVersion: 'differ-source-extraction-v1',
            correction: correction(),
        })).toThrow('matched audit source hash');
    });

    test('rejects tampered coordinates or revision identity after persistence', () => {
        const hash = digest('title\nDish, lemons G 8');
        const binding = buildHumanExplanationSourceBinding({
            submissionId: 'submission-1',
            attemptId: 'attempt-1',
            auditId: 'audit-1',
            sourceSnapshotSha256: hash,
            matchedAuditStage: 'audit_final_result_corrected_menu_v1',
            matchedAuditSnapshotSha256: hash,
            comparisonRevision: 'comparison-a1',
            sourceExtractionVersion: 'differ-source-extraction-v1',
            correction: correction(),
        });
        expect(isHumanExplanationSourceBinding({ ...binding, source_revision_id: 'SER-forged' })).toBe(false);
        expect(isHumanExplanationSourceBinding({
            ...binding,
            span: { ...binding.span, start_utf16: binding.span.start_utf16 + 1 },
        })).toBe(false);

        const reorderedSpan = Object.fromEntries(Object.entries(binding.span).reverse());
        expect(isHumanExplanationSourceBinding({ ...binding, span: reorderedSpan })).toBe(true);
    });
});

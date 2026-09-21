import {
    comparisonRevision,
    LEARNING_COORDINATE_BASIS,
    LEARNING_SOURCE_EXTRACTION_VERSION,
    LEARNING_SOURCE_STAGE,
    sha256Text,
} from '../lib/learning-source-revision';

describe('learning source comparison revisions', () => {
    test('freezes extraction metadata without retaining a duplicate private snapshot', () => {
        const source = 'Dish, lemons G 8';
        const finalText = 'Dish, lemon G 8';
        const sourceHash = sha256Text(source);
        const revision = comparisonRevision('submission-1', sourceHash, finalText);

        expect(sourceHash).toMatch(/^[a-f0-9]{64}$/u);
        expect(revision).toMatch(/^comparison-[a-f0-9]{64}$/u);
        expect({
            source_extraction_version: LEARNING_SOURCE_EXTRACTION_VERSION,
            source_stage: LEARNING_SOURCE_STAGE,
            coordinate_basis: LEARNING_COORDINATE_BASIS,
            source_snapshot_sha256: sourceHash,
        }).toEqual(expect.objectContaining({
            source_extraction_version: 'differ-source-extraction-v1',
            source_stage: 'differ_ai_draft_v1',
            coordinate_basis: 'utf16_line_span_v1',
        }));
        expect(comparisonRevision('submission-1', sourceHash, finalText)).toBe(revision);
        expect(comparisonRevision('submission-1', sha256Text('changed source'), finalText)).not.toBe(revision);
    });
});

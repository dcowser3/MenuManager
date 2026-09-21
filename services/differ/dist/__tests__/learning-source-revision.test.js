"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const learning_source_revision_1 = require("../lib/learning-source-revision");
describe('learning source comparison revisions', () => {
    test('freezes extraction metadata without retaining a duplicate private snapshot', () => {
        const source = 'Dish, lemons G 8';
        const finalText = 'Dish, lemon G 8';
        const sourceHash = (0, learning_source_revision_1.sha256Text)(source);
        const revision = (0, learning_source_revision_1.comparisonRevision)('submission-1', sourceHash, finalText);
        expect(sourceHash).toMatch(/^[a-f0-9]{64}$/u);
        expect(revision).toMatch(/^comparison-[a-f0-9]{64}$/u);
        expect({
            source_extraction_version: learning_source_revision_1.LEARNING_SOURCE_EXTRACTION_VERSION,
            source_stage: learning_source_revision_1.LEARNING_SOURCE_STAGE,
            coordinate_basis: learning_source_revision_1.LEARNING_COORDINATE_BASIS,
            source_snapshot_sha256: sourceHash,
        }).toEqual(expect.objectContaining({
            source_extraction_version: 'differ-source-extraction-v1',
            source_stage: 'differ_ai_draft_v1',
            coordinate_basis: 'utf16_line_span_v1',
        }));
        expect((0, learning_source_revision_1.comparisonRevision)('submission-1', sourceHash, finalText)).toBe(revision);
        expect((0, learning_source_revision_1.comparisonRevision)('submission-1', (0, learning_source_revision_1.sha256Text)('changed source'), finalText)).not.toBe(revision);
    });
});

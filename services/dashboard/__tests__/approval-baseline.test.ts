jest.mock('fs', () => ({
    promises: {
        access: jest.fn(),
    },
}));

import { promises as fs } from 'fs';
import {
    getApprovalSourceDocCandidates,
    loadApprovalBaselineFromSubmission,
    normalizeApprovalEditorText,
    resolveApprovalSourceDocument,
} from '../lib/approval-baseline';

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('approval baseline helpers', () => {
    beforeEach(() => {
        mockedFs.access.mockReset();
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('preserves leading indentation while collapsing extra blank lines', () => {
        expect(normalizeApprovalEditorText('\n  ALLERGEN KEY\n\n    C crustaceans   \n\n')).toBe(
            '  ALLERGEN KEY\n\n    C crustaceans'
        );
    });

    test('prioritizes uploaded revision baseline candidates ahead of generated submission docs', () => {
        const candidates = getApprovalSourceDocCandidates({
            id: 'form-123',
            filename: 'Spring Menu.docx',
            revision_source: 'uploaded_baseline',
            revision_baseline_doc_path: '/tmp/baseline.docx',
            revision_baseline_file_name: 'Legacy Baseline.docx',
            original_path: '/tmp/original.docx',
            final_path: '/tmp/final.docx',
        });

        expect(candidates.map((candidate) => candidate.sourceMode)).toEqual([
            'revision_baseline_docx',
            'original_docx',
            'approved_docx',
        ]);
        expect(candidates[0]).toMatchObject({
            fileName: 'Legacy Baseline.docx',
            extractionMode: 'approved',
        });
    });

    test('uses the approved baseline extractor for uploaded baseline submissions', async () => {
        mockedFs.access.mockResolvedValue(undefined);
        const extractApprovedFromDocx = jest.fn().mockResolvedValue({
            approvedMenuContent: '  ALLERGEN KEY\n    C crustaceans',
            approvedMenuContentHtml: '<p>  ALLERGEN KEY</p><p>    C crustaceans</p>',
        });
        const extractUnapprovedFromDocx = jest.fn();

        const baseline = await loadApprovalBaselineFromSubmission(
            {
                revision_source: 'uploaded_baseline',
                revision_baseline_doc_path: '/tmp/baseline.docx',
                revision_baseline_file_name: 'Legacy Baseline.docx',
                original_path: '/tmp/original.docx',
            },
            {
                extractApprovedFromDocx,
                extractUnapprovedFromDocx,
                resolveStoredPath: (storedPath) => storedPath,
            }
        );

        expect(extractApprovedFromDocx).toHaveBeenCalledWith('/tmp/baseline.docx');
        expect(extractUnapprovedFromDocx).not.toHaveBeenCalled();
        expect(baseline.sourceMode).toBe('revision_baseline_docx');
        expect(baseline.visibleText).toBe('  ALLERGEN KEY\n    C crustaceans');
    });

    test('falls back to the submitted docx when the uploaded revision baseline is missing', async () => {
        mockedFs.access.mockImplementation(async (filePath: any) => {
            if (filePath === '/tmp/baseline.docx') {
                throw new Error('ENOENT');
            }
        });
        const extractApprovedFromDocx = jest.fn();
        const extractUnapprovedFromDocx = jest.fn().mockResolvedValue({
            visibleText: 'Chef text',
            unapprovedHtml: '<p>Chef text</p>',
        });

        const baseline = await loadApprovalBaselineFromSubmission(
            {
                revision_source: 'uploaded_unapproved',
                revision_baseline_doc_path: '/tmp/baseline.docx',
                original_path: '/tmp/original.docx',
            },
            {
                extractApprovedFromDocx,
                extractUnapprovedFromDocx,
                resolveStoredPath: (storedPath) => storedPath,
            }
        );

        expect(extractUnapprovedFromDocx).toHaveBeenCalledWith('/tmp/original.docx');
        expect(baseline.sourceMode).toBe('original_docx');
    });

    test('resolves the same best available source doc for downloads', async () => {
        mockedFs.access.mockImplementation(async (filePath: any) => {
            if (filePath === '/tmp/baseline.docx') return;
            throw new Error('ENOENT');
        });

        const resolved = await resolveApprovalSourceDocument(
            {
                id: 'form-123',
                filename: 'Spring Menu.docx',
                revision_source: 'uploaded_baseline',
                revision_baseline_doc_path: '/tmp/baseline.docx',
                revision_baseline_file_name: 'Legacy Baseline.docx',
                original_path: '/tmp/original.docx',
            },
            {
                resolveStoredPath: (storedPath) => storedPath,
            }
        );

        expect(resolved).toMatchObject({
            absolutePath: '/tmp/baseline.docx',
            fileName: 'Legacy Baseline.docx',
            sourceMode: 'revision_baseline_docx',
        });
    });
});

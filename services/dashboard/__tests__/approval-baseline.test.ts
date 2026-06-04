jest.mock('fs', () => ({
    promises: {
        access: jest.fn(),
    },
}));

import { promises as fs } from 'fs';
import {
    getApprovalSourceDocCandidates,
    loadApprovalBaselineFromSubmission,
    normalizeApprovalEditorHtml,
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

    test('prioritizes submitted original docx ahead of revision baseline and final path', () => {
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
            'original_docx',
            'approved_docx',
            'revision_baseline_docx',
        ]);
        expect(candidates[0]).toMatchObject({
            fileName: 'Spring Menu.docx',
            extractionMode: 'unapproved',
        });
        expect(candidates[2]).toMatchObject({
            fileName: 'Legacy Baseline.docx',
            extractionMode: 'approved',
        });
    });

    test('loads approval baseline from submitted original docx when baseline also exists', async () => {
        mockedFs.access.mockResolvedValue(undefined);
        const extractApprovedFromDocx = jest.fn();
        const extractUnapprovedFromDocx = jest.fn().mockResolvedValue({
            visibleText: 'Chef latest from generated docx',
            cleanVisibleText: 'Chef latest from generated docx',
            unapprovedHtml: '<p>Chef latest from generated docx</p>',
        });

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

        expect(extractUnapprovedFromDocx).toHaveBeenCalledWith('/tmp/original.docx');
        expect(extractApprovedFromDocx).not.toHaveBeenCalled();
        expect(baseline.sourceMode).toBe('original_docx');
        expect(baseline.visibleText).toBe('Chef latest from generated docx');
        expect(baseline.previewText).toBe('Chef latest from generated docx');
    });

    test('uses clean unapproved text for editing while preserving full preview text', async () => {
        mockedFs.access.mockResolvedValue(undefined);
        const extractApprovedFromDocx = jest.fn();
        const extractUnapprovedFromDocx = jest.fn().mockResolvedValue({
            visibleText: 'green aguachile, avocadoavocad, wakame',
            cleanVisibleText: 'green aguachile, avocad, wakame',
            unapprovedHtml: '<p>green aguachile, <span class="existing-del">avocado</span>avocad, wakame</p>',
            annotations: [[{ start: 18, end: 25, type: 'del' }]],
        });

        const baseline = await loadApprovalBaselineFromSubmission(
            {
                original_path: '/tmp/original.docx',
            },
            {
                extractApprovedFromDocx,
                extractUnapprovedFromDocx,
                resolveStoredPath: (storedPath) => storedPath,
            }
        );

        expect(baseline.visibleText).toBe('green aguachile, avocad, wakame');
        expect(baseline.previewText).toBe('green aguachile, avocadoavocad, wakame');
        expect(baseline.previewAnnotations).toEqual([[{ start: 18, end: 25, type: 'del' }]]);
        expect(baseline.editorHtml).toContain('existing-del');
    });

    test('keeps unapproved preview annotations aligned when normalizing blank lines', async () => {
        mockedFs.access.mockResolvedValue(undefined);
        const extractApprovedFromDocx = jest.fn();
        const extractUnapprovedFromDocx = jest.fn().mockResolvedValue({
            visibleText: '\nAlpha oldnew\n\n\nBeta 1214\n',
            cleanVisibleText: '\nAlpha new\n\nBeta 14\n',
            unapprovedHtml: '<p><br></p><p>Alpha <span class="existing-del">old</span><span class="existing-ins">new</span></p><p><br></p><p><br></p><p>Beta <span class="existing-del">12</span><span class="existing-ins">14</span></p>',
            annotations: [
                [],
                [
                    { start: 6, end: 9, type: 'del' },
                    { start: 9, end: 12, type: 'ins' },
                ],
                [],
                [],
                [
                    { start: 5, end: 7, type: 'del' },
                    { start: 7, end: 9, type: 'ins' },
                    { start: 0, end: 1, type: 'comment' },
                ],
            ],
        });

        const baseline = await loadApprovalBaselineFromSubmission(
            {
                original_path: '/tmp/original.docx',
            },
            {
                extractApprovedFromDocx,
                extractUnapprovedFromDocx,
                resolveStoredPath: (storedPath) => storedPath,
            }
        );

        expect(baseline.previewText).toBe('Alpha oldnew\n\nBeta 1214');
        expect(baseline.previewAnnotations).toEqual([
            [
                { start: 6, end: 9, type: 'del' },
                { start: 9, end: 12, type: 'ins' },
            ],
            [],
            [
                { start: 5, end: 7, type: 'del' },
                { start: 7, end: 9, type: 'ins' },
            ],
        ]);
    });

    test('uses the approved baseline extractor when only the revision baseline path exists', async () => {
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
            cleanVisibleText: 'Chef text',
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
            if (filePath === '/tmp/original.docx') return;
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
            absolutePath: '/tmp/original.docx',
            fileName: 'Spring Menu.docx',
            sourceMode: 'original_docx',
        });
    });

    test('normalizeApprovalEditorHtml strips leading empty paragraphs', () => {
        const html =
            '<p><br></p><p><br></p><p>Guacamole <strong>Traditional</strong></p>';
        expect(normalizeApprovalEditorHtml(html)).toBe('<p>Guacamole <strong>Traditional</strong></p>');
    });
});

import {
    decorateLearningSubmissionsWithMenuNames,
    formatLearningSubmissionDisplay,
    shortSubmissionId,
} from '../lib/learning-submissions';

describe('learning submission display helpers', () => {
    test('prefers stored project name as the menu display label', () => {
        const decorated = formatLearningSubmissionDisplay(
            {
                submission_id: '83b0220a-ccf6-460c-be69-fa3d0a37bc22',
                final_path: '/tmp/documents/83b0220a-ccf6-460c-be69-fa3d0a37bc22-approved.docx',
            },
            {
                project_name: 'Aqimero Brunch Menu',
                property: 'Aqimero',
                service_period: 'brunch',
                filename: 'Aqimero_Brunch_5.22.26.docx',
            }
        );

        expect(decorated.submission_display_name).toBe('Aqimero Brunch Menu');
        expect(decorated.submission_display_detail).toBe('Aqimero | brunch | Aqimero Brunch 5.22.26 | 83b0220a');
    });

    test('falls back to useful filenames but ignores internal artifact names', () => {
        const internalOnly = formatLearningSubmissionDisplay({
            submission_id: '5f5c96e4-55fe-459b-a035-4fc0b398310b',
            ai_draft_path: '/tmp/form-1779386945063-draft.docx',
            final_path: '/tmp/5f5c96e4-55fe-459b-a035-4fc0b398310b-approved.docx',
        });
        const namedFile = formatLearningSubmissionDisplay({
            submission_id: 'submission-1',
            final_path: '/tmp/Tamayo_Dinner_5.22.26.docx',
        });

        expect(internalOnly.submission_display_name).toBe('5f5c96e4-55fe-459b-a035-4fc0b398310b');
        expect(namedFile.submission_display_name).toBe('Tamayo Dinner 5.22.26');
    });

    test('decorates rows without failing when metadata lookup misses', async () => {
        const rows = await decorateLearningSubmissionsWithMenuNames([
            { submission_id: 'sub-1' },
            { submission_id: 'sub-2' },
        ], async (submissionId) => {
            if (submissionId === 'sub-1') {
                return { raw_payload: { projectName: 'Raw Payload Menu' } };
            }
            throw new Error('not found');
        });

        expect(rows[0].submission_display_name).toBe('Raw Payload Menu');
        expect(rows[1].submission_display_name).toBe('sub-2');
    });

    test('shortens UUID-style submission ids for table detail text', () => {
        expect(shortSubmissionId('83b0220a-ccf6-460c-be69-fa3d0a37bc22')).toBe('83b0220a');
        expect(shortSubmissionId('legacy-submission-id')).toBe('legacy-submi');
    });
});

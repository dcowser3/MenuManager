import * as path from 'path';
import { createApprovalWorkflowHandlers } from '../lib/approval-workflow';

function createJsonResponse() {
    const res: any = {
        statusCode: 200,
        body: undefined,
        status: jest.fn((code: number) => {
            res.statusCode = code;
            return res;
        }),
        json: jest.fn((body: any) => {
            res.body = body;
            return res;
        }),
    };
    return res;
}

function createDeps() {
    return {
        axios: {
            get: jest.fn(),
            put: jest.fn(async () => ({ data: {} })),
            post: jest.fn(async () => ({ data: {} })),
        },
        fs: {
            copyFile: jest.fn(async () => undefined),
            mkdir: jest.fn(async () => undefined),
            rename: jest.fn(async () => undefined),
        } as any,
        pathModule: path,
        DB_SERVICE_URL: 'http://localhost:3004',
        DIFFER_SERVICE_URL: 'http://localhost:3006',
        CLICKUP_SERVICE_URL: 'http://localhost:3007',
        DEFAULT_ALLERGEN_KEY: 'G GF VG V',
        getSubmissionDocumentDir: jest.fn(() => '/tmp/documents/sub-1'),
        extractDishesAfterApproval: jest.fn(async () => undefined),
        coalesceString: (...values: any[]) => values.find((value) => `${value || ''}`.trim()) || '',
        normalizeMenuFooter: jest.fn((text: string) => ({
            body: text,
            normalizedAllergenLine: '',
            hadRawNotice: false,
            preservedFooterText: '',
        })),
        stripManagedFooterText: jest.fn((text: string) => text),
        stripManagedFooterFromHtml: jest.fn((html: string) => html),
        normalizeAllergenLegend: jest.fn((text: string) => text),
        detectRawUndercookedContent: jest.fn(() => false),
        textToParagraphHtml: jest.fn((text: string) => `<p>${text}</p>`),
        generateDocxFromForm: jest.fn(async () => '/tmp/documents/sub-1/approved/sub-1-approved.docx'),
    };
}

describe('approval workflow learning provenance', () => {
    test('quick approval updates the submission without sending a learning comparison', async () => {
        const deps = createDeps();
        deps.axios.get.mockResolvedValue({
            data: {
                id: 'sub-1',
                ai_draft_path: '/tmp/documents/sub-1/sub-1-draft.docx',
                menu_content: 'Draft menu',
                property: 'Tamayo - Denver',
            },
        });
        const handlers = createApprovalWorkflowHandlers(deps as any);
        const res = createJsonResponse();

        await handlers.quickApprove({ params: { submissionId: 'sub-1' } }, res);

        expect(res.statusCode).toBe(200);
        expect(deps.axios.put).toHaveBeenCalledWith(
            'http://localhost:3004/submissions/sub-1',
            expect.objectContaining({ changes_made: false })
        );
        expect(deps.axios.post).not.toHaveBeenCalledWith(
            'http://localhost:3006/compare',
            expect.anything()
        );
    });

    test('corrected upload sends human-review provenance to the differ', async () => {
        const deps = createDeps();
        deps.axios.get.mockResolvedValue({
            data: {
                id: 'sub-1',
                ai_draft_path: '/tmp/documents/sub-1/sub-1-draft.docx',
                menu_content: 'Draft menu',
                property: 'Tamayo - Denver',
            },
        });
        const handlers = createApprovalWorkflowHandlers(deps as any);
        const res = createJsonResponse();

        await handlers.uploadCorrectedVersion({
            params: { submissionId: 'sub-1' },
            file: { path: '/tmp/uploaded-correction.docx' },
        }, res);

        expect(res.statusCode).toBe(200);
        expect(deps.axios.post).toHaveBeenCalledWith(
            'http://localhost:3006/compare',
            expect.objectContaining({
                submission_id: 'sub-1',
                ai_draft_path: '/tmp/documents/sub-1/sub-1-draft.docx',
                comparison_source: 'human_review_final_approval',
                review_source: 'dashboard_corrected_upload',
                changed_by_human: true,
            })
        );
        const comparePayload = (deps.axios.post as jest.Mock).mock.calls[0]?.[1];
        expect(comparePayload.final_path).toContain('/tmp/finals/sub-1-final.docx');
    });
});

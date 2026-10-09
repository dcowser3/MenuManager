import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDesignApprovalWorkflowHandlers } from '../lib/design-approval-workflow';

function invoke(handler: any, req: any): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const res: any = {
            statusCode: 200,
            status(code: number) { this.statusCode = code; return this; },
            json(payload: any) { resolve({ status: this.statusCode, body: payload }); return this; },
        };
        Promise.resolve(handler(req, res)).catch(reject);
    });
}

describe('design approval production workflow', () => {
    let tempRoot: string;
    let approvedDocxPath: string;
    let uploadedPdfPath: string;
    let api: any;
    let postedSubmissions: any[];
    let postedAssets: any[];

    beforeEach(async () => {
        tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'design-workflow-'));
        approvedDocxPath = path.join(tempRoot, 'approved.docx');
        uploadedPdfPath = path.join(tempRoot, 'upload.pdf');
        await fs.promises.writeFile(approvedDocxPath, Buffer.from('PK\x03\x04approved'));
        await fs.promises.writeFile(uploadedPdfPath, Buffer.from('%PDF-1.4\nproof'));
        postedSubmissions = [];
        postedAssets = [];

        api = {
            get: jest.fn(async (url: string) => {
                if (url.endsWith('/menus/menu-1')) {
                    return { data: { menu: { id: 'menu-1', name: 'Brunch', property: 'Tán', service_period: 'Brunch', status: 'active', current_submission_id: 'source-1' } } };
                }
                if (url.endsWith('/submissions/source-1')) {
                    return { data: {
                        id: 'source-1', status: 'approved', source: 'form', final_path: approvedDocxPath,
                        filename: 'Tan Brunch.docx', project_name: 'Tán Brunch', property: 'Tán',
                        service_period: 'Brunch', clickup_task_id: 'cu-1', approvals: '[{"approved":true}]',
                    } };
                }
                throw new Error(`Unexpected GET ${url}`);
            }),
            post: jest.fn(async (url: string, body: any) => {
                if (url.endsWith('/submissions')) {
                    postedSubmissions.push(body);
                    return { data: body };
                }
                if (url.endsWith('/assets')) {
                    postedAssets.push(body);
                    return { data: body };
                }
                if (url.includes('/submitter-profiles')) return { data: {} };
                if (url.endsWith('/design-approval/finalize')) {
                    return { data: { success: true, status: 'complete', handoffComplete: true, attachmentUploaded: true, clickupStatusUpdated: true, targetStatus: 'approved' } };
                }
                throw new Error(`Unexpected POST ${url}`);
            }),
            put: jest.fn(async () => ({ data: {} })),
        };
    });

    afterEach(async () => {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

    function handlers(differences: any[] = []) {
        return createDesignApprovalWorkflowHandlers({
            axios: api,
            fs: fs.promises,
            pathModule: path,
            execAsync: jest.fn(async (command: string) => {
                if (command.includes('extract_project_details.py')) {
                    return { stdout: JSON.stringify({ project_details: { project_name: 'Tán Brunch', property: 'Tán' }, comparison_menu_content: 'TACO 18' }), stderr: '' };
                }
                return { stdout: JSON.stringify({ full_text: 'TACO 18', has_text_layer: true }), stderr: '' };
            }),
            DB_SERVICE_URL: 'http://db',
            CLICKUP_SERVICE_URL: 'http://clickup',
            clickupFinalizeTimeoutMs: 60000,
            getDocxRedlinerDir: () => tempRoot,
            getDocumentStorageRoot: () => path.join(tempRoot, 'documents'),
            resolveApprovedSourceDocx: jest.fn(async (_submissionId: string, candidate: string) => candidate),
            compareMenuTexts: () => ({ differences, alignments: [] }),
            reviewPdfVisuals: async () => ({ status: 'completed', pagesReviewed: 1, totalPages: 1, findings: [] }),
            visualReviewDifferences: () => [],
            isClientInputError: () => true,
        });
    }

    test('accepts only a menu selection and PDF, persists the proof, and hands off the passing design', async () => {
        const result = await invoke(handlers().compare, {
            body: { menuId: 'menu-1', submitterName: 'Designer', submitterEmail: 'designer@example.com', submitterJobTitle: 'Designer' },
            files: { pdfFile: [{ path: uploadedPdfPath, originalname: 'tan-design.pdf' }] },
        });

        expect(result.status).toBe(200);
        expect(result.body.isMatch).toBe(true);
        expect(result.body.sourceMenu).toMatchObject({ menuId: 'menu-1', submissionId: 'source-1' });
        expect(result.body.handoff.handoffComplete).toBe(true);
        expect(postedSubmissions).toHaveLength(1);
        expect(postedSubmissions[0]).toMatchObject({
            source: 'design_approval',
            revision_base_submission_id: 'source-1',
            clickup_task_id: 'cu-1',
            filename: 'tan-design.pdf',
            asset_type: 'design_pdf',
            status: 'approved',
        });
        expect(postedAssets[0]).toMatchObject({
            asset_type: 'designed_pdf',
            revision_submission_id: 'source-1',
            file_name: 'tan-design.pdf',
        });
        await expect(fs.promises.access(postedAssets[0].storage_path)).resolves.toBeUndefined();
        expect(api.post).toHaveBeenCalledWith(
            'http://clickup/design-approval/finalize',
            { designApprovalSubmissionId: result.body.submissionId },
            { timeout: 60000 },
        );
    });

    test('saves a failing proof but does not send it to ClickUp', async () => {
        const result = await invoke(handlers([{ type: 'missing', severity: 'critical' }]).compare, {
            body: { menuId: 'menu-1', submitterName: 'Designer', submitterEmail: 'designer@example.com', submitterJobTitle: 'Designer' },
            files: { pdfFile: [{ path: uploadedPdfPath, originalname: 'tan-design.pdf' }] },
        });

        expect(result.status).toBe(200);
        expect(result.body.isMatch).toBe(false);
        expect(postedSubmissions[0].status).toBe('needs_correction');
        expect(api.post.mock.calls.some((call: any[]) => String(call[0]).endsWith('/design-approval/finalize'))).toBe(false);
    });
});

jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    getSupabaseClient: jest.fn(),
    isSupabaseConfigured: jest.fn(() => false),
    logAlert: jest.fn(),
    extractAndStoreDishes: jest.fn(),
}));

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    const repoRoot = '/Users/deriancowser/Documents/MenuManager';
    return {
        ...actual,
        existsSync: jest.fn((target: string) => {
            const normalized = String(target);
            return normalized === `${repoRoot}/services` || normalized === `${repoRoot}/samples`;
        }),
        promises: {
            ...actual.promises,
            readFile: jest.fn(),
            writeFile: jest.fn().mockResolvedValue(undefined),
            mkdir: jest.fn().mockResolvedValue(undefined),
            access: jest.fn().mockResolvedValue(undefined),
        },
    };
});

import fs from 'fs';
import app from '../index';
import { sanitizeSubmissionUpdates } from '../lib/submission-updates';
import { getSupabaseClient, isSupabaseConfigured } from '@menumanager/supabase-client';

function getRouteHandler(method: string, routePath: string) {
    const layer = (app as any)._router.stack.find(
        (entry: any) =>
            entry.route &&
            entry.route.path === routePath &&
            entry.route.methods &&
            entry.route.methods[method.toLowerCase()]
    );
    if (!layer) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
    }
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function invokeJsonHandler(handler: any, { body = {}, params = {}, query = {} } = {}) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req: any = { body, params, query };
        const res: any = {
            statusCode: 200,
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json(payload: any) {
                resolve({ status: this.statusCode || 200, body: payload });
                return this;
            },
            send(payload: any) {
                resolve({ status: this.statusCode || 200, body: payload });
                return this;
            },
        };

        Promise.resolve(handler(req, res)).catch(reject);
    });
}

function postJsonOverHttp(routePath: string, body: any, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
        const server = (app as any).listen(0, async () => {
            try {
                const address = server.address();
                const port = typeof address === 'object' && address ? address.port : 0;
                const response = await fetch(`http://127.0.0.1:${port}${routePath}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...headers },
                    body: JSON.stringify(body),
                });
                const responseText = await response.text();
                resolve({
                    status: response.status,
                    body: responseText ? JSON.parse(responseText) : null,
                });
            } catch (error) {
                reject(error);
            } finally {
                server.close();
            }
        });
    });
}

describe('submission update hardening', () => {
    const updateHandler = getRouteHandler('put', '/submissions/:id');
    const pendingHandler = getRouteHandler('get', '/submissions/pending');
    const approvedListHandler = getRouteHandler('get', '/submissions/approved-list');
    const submissionSearchHandler = getRouteHandler('get', '/submissions/search');
    const submitterProfileSearchHandler = getRouteHandler('get', '/submitter-profiles/search');
    const createCorrectionRuleHandler = getRouteHandler('post', '/correction-rules');
    const originalInternalApiToken = process.env.INTERNAL_API_TOKEN;

    beforeEach(() => {
        process.env.INTERNAL_API_TOKEN = 'test-token';
        (isSupabaseConfigured as jest.Mock).mockReturnValue(false);
        (getSupabaseClient as jest.Mock).mockReset();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        (fs.promises.readFile as jest.Mock).mockImplementation(async (target: string) => {
            const normalized = String(target);
            if (normalized.endsWith('submissions.json')) {
                return JSON.stringify({
                    'form-123': {
                        id: 'form-123',
                        source: 'form',
                        status: 'pending_human_review',
                        created_at: '2026-05-08T09:00:00.000Z',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/original.docx',
                        submitter_email: 'chef@example.com',
                    },
                    'form-no-ai': {
                        id: 'form-no-ai',
                        source: 'form',
                        status: 'submitted_no_ai_review',
                        created_at: '2026-05-08T11:00:00.000Z',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/no-ai.docx',
                        submitter_email: 'manual@example.com',
                    },
                    'form-isabella-direct': {
                        id: 'form-isabella-direct',
                        source: 'form',
                        status: 'pending_human_review',
                        created_at: '2026-05-08T12:00:00.000Z',
                        clickup_task_id: 'cu_isabella',
                        submitter_email: 'isabella@richardsandoval.com',
                    },
                    'form-marketing': {
                        id: 'form-marketing',
                        source: 'form',
                        status: 'sent_to_marketing',
                        created_at: '2026-05-08T13:00:00.000Z',
                        clickup_task_id: 'cu_marketing',
                        submitter_email: 'isabella@richardsandoval.com',
                    },
                    'form-deleted-clickup': {
                        id: 'form-deleted-clickup',
                        source: 'form',
                        status: 'deleted',
                        created_at: '2026-05-08T14:00:00.000Z',
                        clickup_task_id: 'cu_deleted',
                        submitter_email: 'chef@example.com',
                    },
                    'form-200': {
                        id: 'form-200',
                        source: 'form',
                        status: 'approved',
                        project_name: 'Spring Dinner',
                        property: 'Test Property',
                        filename: 'Spring Dinner_Menu.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
                        service_period: 'dinner',
                        reviewed_at: '2026-05-08T10:00:00.000Z',
                        submitter_name: 'Carlos',
                        submitter_email: 'carlos@example.com',
                    },
                    'form-201': {
                        id: 'form-201',
                        source: 'form',
                        status: 'approved',
                        project_name: 'Summer Menu',
                        property: 'tán - New York',
                        filename: 'tan-summer.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/tan/Summer Menu/form-201/approved/form-201-approved.docx',
                        service_period: 'dinner',
                        reviewed_at: '2026-05-10T10:00:00.000Z',
                        submitter_name: 'Chef Tàn',
                        submitter_email: 'tan@example.com',
                    },
                    'design-1': {
                        id: 'design-1',
                        source: 'design_approval',
                        status: 'approved',
                        project_name: 'Ignore Me',
                        property: 'Test Property',
                        filename: 'Ignore.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/ignore.docx',
                        reviewed_at: '2026-05-09T10:00:00.000Z',
                    },
                });
            }
            if (normalized.endsWith('assets.json')) {
                return JSON.stringify([
                    {
                        id: 'asset_1',
                        submission_id: 'form-200',
                        asset_type: 'approved_docx',
                        storage_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
                        file_name: 'Spring Dinner Approved.docx',
                        created_at: '2026-05-08T10:05:00.000Z',
                    },
                ]);
            }
            if (normalized.endsWith('submitter_profiles.json')) {
                return JSON.stringify({
                    'chef-tan': {
                        name: 'Chef Tàn',
                        email: 'tan@example.com',
                        jobTitle: 'Executive Chef',
                        lastUsed: '2026-05-10T10:00:00.000Z',
                    },
                    carlos: {
                        name: 'Carlos',
                        email: 'carlos@example.com',
                        jobTitle: 'Chef',
                        lastUsed: '2026-05-08T10:00:00.000Z',
                    },
                });
            }
            return JSON.stringify({});
        });
        (fs.promises.writeFile as jest.Mock).mockClear();
    });

    afterEach(() => {
        process.env.INTERNAL_API_TOKEN = originalInternalApiToken;
        jest.restoreAllMocks();
    });

    test('sanitizes allowed approval update fields', async () => {
        const response = await invokeJsonHandler(updateHandler, {
            params: { id: 'form-123' },
            body: {
                status: 'approved',
                final_path: '/Users/deriancowser/Documents/MenuManager/tmp/finals/form-123-final.docx',
                changes_made: true,
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('approved');
        expect(response.body.final_path).toBe('/Users/deriancowser/Documents/MenuManager/tmp/finals/form-123-final.docx');
        expect(response.body.changes_made).toBe(true);
        expect(response.body.submitter_email).toBe('chef@example.com');
        expect(response.body.updated_at).toBeTruthy();
        expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    });

    test('rejects non-allowlisted submission fields', async () => {
        const response = await invokeJsonHandler(updateHandler, {
            params: { id: 'form-123' },
            body: {
                submitter_email: 'attacker@example.com',
                status: 'approved',
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid submission update payload');
        expect(response.body.rejectedFields).toContain('submitter_email');
        expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    test('rejects path updates outside repository tmp', async () => {
        const response = await invokeJsonHandler(updateHandler, {
            params: { id: 'form-123' },
            body: {
                final_path: '/etc/passwd',
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.details).toContain('final_path must stay inside the repository tmp/ directory');
        expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    test('rejects invalid status transitions', async () => {
        const response = await invokeJsonHandler(updateHandler, {
            params: { id: 'form-123' },
            body: {
                status: 'closed',
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.details[0]).toContain('status must be one of:');
        expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    test('allows operationally deleted submissions to leave the review queue', () => {
        const result = sanitizeSubmissionUpdates(
            {
                status: 'deleted',
                raw_payload: {
                    review_queue_cleanup: {
                        reason: 'Linked ClickUp task was deleted',
                    },
                },
            },
            { repoRoot: '/Users/deriancowser/Documents/MenuManager' }
        );

        expect(result.rejectedFields).toEqual([]);
        expect(result.allowedFields.status).toBe('deleted');
        expect(result.allowedFields.raw_payload.review_queue_cleanup.reason).toBe('Linked ClickUp task was deleted');
    });

    test('sanitizeSubmissionUpdates allows object raw_payload updates for operational metadata', () => {
        const result = sanitizeSubmissionUpdates(
            {
                raw_payload: { clickup_handoff: { status: 'failed' } },
                clickup_task_id: 'cu_123',
            },
            { repoRoot: '/Users/deriancowser/Documents/MenuManager' }
        );

        expect(result.rejectedFields).not.toContain('raw_payload');
        expect(result.allowedFields.raw_payload).toEqual({ clickup_handoff: { status: 'failed' } });
        expect(result.allowedFields.clickup_task_id).toBe('cu_123');
    });

    test('allows direct Isabella handoffs to leave the review queue', () => {
        const result = sanitizeSubmissionUpdates(
            {
                clickup_task_id: 'cu_isa',
                status: 'sent_to_marketing',
            },
            { repoRoot: '/Users/deriancowser/Documents/MenuManager' }
        );

        expect(result.rejectedFields).toEqual([]);
        expect(result.allowedFields.status).toBe('sent_to_marketing');
        expect(result.allowedFields.clickup_task_id).toBe('cu_isa');
    });

    test('accepts submission create bodies larger than the Express default JSON limit', async () => {
        const largeHtml = `<p>${'Guacamole with roasted poblano salsa. '.repeat(4500)}</p>`;

        const response = await postJsonOverHttp('/submissions', {
            id: 'form-large',
            source: 'form',
            status: 'pending_human_review',
            submitter_email: 'chef@example.com',
            menu_content_html: largeHtml,
            raw_payload: {
                form_payload: {
                    menuContentHtml: largeHtml,
                },
            },
        }, {
            'x-menumanager-internal-token': 'test-token',
        });

        expect(response.status).toBe(201);
        expect(response.body.id).toBe('form-large');
        expect(response.body.menu_content_html).toContain('Guacamole with roasted poblano salsa');
        expect(fs.promises.writeFile).toHaveBeenCalledWith(
            expect.stringContaining('submissions.json'),
            expect.stringContaining('form-large')
        );
    });

    test('lists all submissions that still need human review', async () => {
        const response = await invokeJsonHandler(pendingHandler);

        expect(response.status).toBe(200);
        expect(response.body.map((submission: any) => submission.id)).toEqual(['form-no-ai', 'form-123']);
    });

    test('lists approved form submissions with approved doc filenames for download dashboard', async () => {
        const response = await invokeJsonHandler(approvedListHandler, {
            query: { q: 'spring' },
        });

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toMatchObject({
            id: 'form-200',
            projectName: 'Spring Dinner',
            property: 'Test Property',
            approvedFileName: 'Spring Dinner Approved.docx',
            status: 'approved',
            servicePeriod: 'dinner',
        });
    });

    test('searches approved submissions without requiring tone marks', async () => {
        const response = await invokeJsonHandler(submissionSearchHandler, {
            query: { q: 'tan', limit: '20' },
        });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'form-201',
                projectName: 'Summer Menu',
                property: 'tán - New York',
                submitterName: 'Chef Tàn',
            }),
        ]));
    });

    test('searches submitter profiles without requiring tone marks', async () => {
        const response = await invokeJsonHandler(submitterProfileSearchHandler, {
            query: { q: 'tan' },
        });

        expect(response.status).toBe(200);
        expect(response.body).toEqual([
            expect.objectContaining({
                name: 'Chef Tàn',
                email: 'tan@example.com',
            }),
        ]);
    });

    test('creates freeform correction rules with menu scope and nullable exact text', async () => {
        const insert = jest.fn((record) => ({
            select: jest.fn(() => ({
                single: jest.fn(async () => ({
                    data: { id: 'rule-1', ...record },
                    error: null,
                })),
            })),
        }));
        const from = jest.fn(() => ({ insert }));
        (isSupabaseConfigured as jest.Mock).mockReturnValue(true);
        (getSupabaseClient as jest.Mock).mockReturnValue({ from });

        const response = await invokeJsonHandler(createCorrectionRuleHandler, {
            body: {
                submission_id: 'manual-submission-1',
                correction_id: 'manual-rule-1',
                original_text: null,
                corrected_text: null,
                rule: 'Beverage menus should keep zero-proof section names.',
                applies_to_menu_type: 'beverage',
                is_location_specific: false,
                restaurant_name: '',
                location: 'All properties (global rule)',
            },
        });

        expect(response.status).toBe(201);
        expect(from).toHaveBeenCalledWith('correction_rules');
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({
            original_text: null,
            corrected_text: null,
            applies_to_menu_type: 'beverage',
            rule: 'Beverage menus should keep zero-proof section names.',
        }));
    });
});

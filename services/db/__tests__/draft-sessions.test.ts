jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    getSupabaseClient: jest.fn(),
    isSupabaseConfigured: jest.fn(() => false),
    logAlert: jest.fn(),
    extractAndStoreDishes: jest.fn(),
}));

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
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
import { isSupabaseConfigured } from '@menumanager/supabase-client';

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

function invokeJsonHandler(handler: any, { body = {}, params = {} } = {}) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req: any = { body, params };
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
        };

        Promise.resolve(handler(req, res)).catch(reject);
    });
}

describe('draft sessions', () => {
    const createHandler = getRouteHandler('post', '/draft-sessions');
    const getHandler = getRouteHandler('get', '/draft-sessions/:token');
    const saveHandler = getRouteHandler('put', '/draft-sessions/:token');
    const submitHandler = getRouteHandler('post', '/draft-sessions/:token/submit');
    let drafts: Record<string, any>;

    const submissions = {
        'form-approved': {
            id: 'form-approved',
            status: 'approved',
            source: 'form',
            project_name: 'Spring Dinner',
            property: 'Test Property',
            service_period: 'Dinner',
            menu_type: 'standard',
            template_type: 'food',
            asset_type: 'PRINT',
            orientation: 'Portrait',
            final_path: '/tmp/approved.docx',
            approved_menu_content: 'TACOS\nGuacamole - $12',
            menu_content_html: '<p><strong>TACOS</strong></p><p><strong>Guacamole</strong> - $12</p>',
            reviewed_at: '2026-06-01T12:00:00.000Z',
        },
    };

    beforeEach(() => {
        drafts = {};
        (isSupabaseConfigured as jest.Mock).mockReturnValue(false);
        (fs.promises.writeFile as jest.Mock).mockClear();
        (fs.promises.readFile as jest.Mock).mockImplementation(async (target: string) => {
            const normalized = String(target);
            if (normalized.endsWith('submissions.json')) return JSON.stringify(submissions);
            if (normalized.endsWith('draft_sessions.json')) return JSON.stringify(drafts);
            if (normalized.endsWith('assets.json')) return '[]';
            if (normalized.endsWith('properties.json')) return '[]';
            return '{}';
        });
        (fs.promises.writeFile as jest.Mock).mockImplementation(async (target: string, payload: string) => {
            if (String(target).endsWith('draft_sessions.json')) {
                drafts = JSON.parse(payload);
            }
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('creates a draft from an approved submission with baseline prefill data', async () => {
        const response = await invokeJsonHandler(createHandler, {
            body: { baseSubmissionId: 'form-approved' },
        });

        expect(response.status).toBe(201);
        expect(response.body.token).toBeTruthy();
        expect(response.body.status).toBe('active');
        expect(response.body.baseline.projectName).toBe('Spring Dinner');
        expect(response.body.baseline.approvedMenuContent).toContain('Guacamole');
        expect(response.body.baseline.approvedMenuContentHtml).toBe(
            '<p><strong>TACOS</strong></p><p><strong>Guacamole</strong> - $12</p>'
        );
        expect(response.body.form_state.previewCollapsed).toBe(true);
    });

    test('rejects stale autosave when the server has a newer updated_at', async () => {
        drafts['draft-1'] = {
            id: 'draft-1',
            token: 'share-token',
            base_submission_id: 'form-approved',
            menu_content_html: '<p>Old</p>',
            form_state: {},
            status: 'active',
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-02T00:00:00.000Z',
        };

        const response = await invokeJsonHandler(saveHandler, {
            params: { token: 'share-token' },
            body: {
                updatedAt: '2026-07-01T23:59:00.000Z',
                menuContentHtml: '<p>Overwrite</p>',
                formState: {},
            },
        });

        expect(response.status).toBe(409);
        expect(response.body.error).toContain('updated by someone else');
        expect(drafts['draft-1'].menu_content_html).toBe('<p>Old</p>');
    });

    test('locks a draft after submit and rejects later autosave', async () => {
        drafts['draft-1'] = {
            id: 'draft-1',
            token: 'share-token',
            base_submission_id: 'form-approved',
            menu_content_html: '<p>Current</p>',
            form_state: {},
            status: 'active',
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-02T00:00:00.000Z',
        };

        const locked = await invokeJsonHandler(submitHandler, {
            params: { token: 'share-token' },
            body: { submittedSubmissionId: 'form-new' },
        });
        expect(locked.status).toBe(200);
        expect(locked.body.status).toBe('submitted');
        expect(locked.body.submitted_submission_id).toBe('form-new');

        const save = await invokeJsonHandler(saveHandler, {
            params: { token: 'share-token' },
            body: { updatedAt: locked.body.updated_at, menuContentHtml: '<p>Late</p>', formState: {} },
        });
        expect(save.status).toBe(409);
    });

    test('marks idle drafts expired on load', async () => {
        drafts['draft-old'] = {
            id: 'draft-old',
            token: 'old-token',
            base_submission_id: 'form-approved',
            menu_content_html: '<p>Old</p>',
            form_state: {},
            status: 'active',
            created_at: '2020-01-01T00:00:00.000Z',
            updated_at: '2020-01-01T00:00:00.000Z',
        };

        const response = await invokeJsonHandler(getHandler, {
            params: { token: 'old-token' },
        });

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('expired');
        expect(drafts['draft-old'].status).toBe('expired');
    });
});

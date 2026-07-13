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
import app, { mapApprovedSubmissionForClient } from '../index';
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
        };

        Promise.resolve(handler(req, res)).catch(reject);
    });
}

describe('draft sessions', () => {
    const createHandler = getRouteHandler('post', '/draft-sessions');
    const getHandler = getRouteHandler('get', '/draft-sessions/:token');
    const saveHandler = getRouteHandler('put', '/draft-sessions/:token');
    const submitHandler = getRouteHandler('post', '/draft-sessions/:token/submit');
    const discardHandler = getRouteHandler('post', '/draft-sessions/:token/discard');
    const listHandler = getRouteHandler('get', '/draft-sessions');
    const childrenHandler = getRouteHandler('get', '/submissions/lineage-children');
    const baselineMatchHandler = getRouteHandler('post', '/submissions/baseline-match');
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
        delete (submissions as any)['form-approved-child'];
        delete (submissions as any)['form-approved-child-newer'];
        delete (submissions as any)['unrelated-approved'];
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

    test('returns the existing active draft instead of creating a second one', async () => {
        const first = await invokeJsonHandler(createHandler, { body: { baseSubmissionId: 'form-approved' } });
        const second = await invokeJsonHandler(createHandler, { body: { baseSubmissionId: 'form-approved' } });
        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(second.body.resumed).toBe(true);
        expect(second.body.token).toBe(first.body.token);
        expect(Object.values(drafts).filter((draft: any) => draft.status === 'active')).toHaveLength(1);
    });

    test('expires an idle active draft and creates a new one', async () => {
        drafts['old-draft'] = {
            id: 'old-draft', token: 'old-token', base_submission_id: 'form-approved', menu_content_html: '', form_state: {},
            status: 'active', created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z',
        };
        const response = await invokeJsonHandler(createHandler, { body: { baseSubmissionId: 'form-approved' } });
        expect(response.status).toBe(201);
        expect(response.body.token).not.toBe('old-token');
        expect(drafts['old-draft'].status).toBe('expired');
    });

    test('discard is idempotent and replace discards before creating a fresh active draft', async () => {
        const first = await invokeJsonHandler(createHandler, { body: { baseSubmissionId: 'form-approved' } });
        const replacement = await invokeJsonHandler(createHandler, {
            body: { baseSubmissionId: 'form-approved', replaceToken: first.body.token },
        });
        expect(replacement.status).toBe(201);
        expect(replacement.body.token).not.toBe(first.body.token);
        expect(Object.values(drafts).filter((draft: any) => draft.status === 'active')).toHaveLength(1);
        expect(Object.values(drafts).find((draft: any) => draft.token === first.body.token)).toEqual(expect.objectContaining({ status: 'discarded' }));

        const discarded = await invokeJsonHandler(discardHandler, { params: { token: first.body.token } });
        expect(discarded.status).toBe(200);
        expect(discarded.body.status).toBe('discarded');
    });

    test('rejects an invalid replacement token and applies discard rules', async () => {
        await invokeJsonHandler(createHandler, { body: { baseSubmissionId: 'form-approved' } });
        const mismatch = await invokeJsonHandler(createHandler, { body: { baseSubmissionId: 'form-approved', replaceToken: 'wrong' } });
        expect(mismatch.status).toBe(400);
        const unknown = await invokeJsonHandler(discardHandler, { params: { token: 'none' } });
        expect(unknown.status).toBe(404);

        drafts['submitted-draft'] = { id: 'submitted-draft', token: 'submitted-token', base_submission_id: 'form-approved', form_state: {}, status: 'submitted', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' };
        const submitted = await invokeJsonHandler(discardHandler, { params: { token: 'submitted-token' } });
        expect(submitted.status).toBe(409);
    });

    test('lists active drafts by baseline batch and retains last editor', async () => {
        const created = await invokeJsonHandler(createHandler, { body: { baseSubmissionId: 'form-approved' } });
        await invokeJsonHandler(saveHandler, { params: { token: created.body.token }, body: {
            updatedAt: created.body.updated_at, menuContentHtml: '<p>Edited</p>', formState: {}, lastEditedBy: 'Chef Mina',
        } });
        const listed = await invokeJsonHandler(listHandler, { query: { status: 'active', baseSubmissionIds: 'form-approved' } });
        expect(listed.status).toBe(200);
        expect(listed.body).toHaveLength(1);
        expect(listed.body[0]).toEqual(expect.objectContaining({ last_edited_by: 'Chef Mina', token: created.body.token }));
        expect(listed.body[0].baseline).toEqual(expect.objectContaining({ property: 'Test Property', projectName: 'Spring Dinner' }));
    });

    test('gates only an approved lineage child and reports the latest child as the tip', async () => {
        (submissions as any)['form-approved-child'] = {
            ...submissions['form-approved'], id: 'form-approved-child', status: 'approved',
            revision_base_submission_id: 'form-approved', reviewed_at: '2026-07-10T00:00:00.000Z', project_name: 'Spring Dinner v2',
        };
        const children = await invokeJsonHandler(childrenHandler, { query: { ids: 'form-approved' } });
        expect(children.body['form-approved'].supersededBy).toEqual(expect.objectContaining({ id: 'form-approved-child' }));
        const blocked = await invokeJsonHandler(createHandler, { body: { baseSubmissionId: 'form-approved' } });
        expect(blocked.status).toBe(409);
        expect(blocked.body.supersededBy.id).toBe('form-approved-child');
    });

    test('does not gate an unrelated same-service menu with unknown lineage', async () => {
        (submissions as any)['unrelated-approved'] = {
            ...submissions['form-approved'], id: 'unrelated-approved', project_name: 'Holidays & Events',
            reviewed_at: '2026-07-12T00:00:00.000Z', revision_base_submission_id: null,
        };
        const response = await invokeJsonHandler(createHandler, { body: { baseSubmissionId: 'form-approved' } });
        expect(response.status).toBe(201);
    });

    test('matches only an approved baseline from the same property', async () => {
        const match = await invokeJsonHandler(baselineMatchHandler, { body: {
            extractedText: 'TACOS\nGuacamole - $12', property: 'Test Property', servicePeriod: 'Dinner',
        } });
        expect(match.body.match).toEqual(expect.objectContaining({ id: 'form-approved' }));
        const none = await invokeJsonHandler(baselineMatchHandler, { body: {
            extractedText: 'Entirely different menu', property: 'Test Property', servicePeriod: 'Dinner',
        } });
        expect(none.body.match).toBeNull();
    });

    test('uses post-approval HTML and never returns stale submitted HTML', () => {
        const base = submissions['form-approved'];
        expect(mapApprovedSubmissionForClient({
            ...base,
            approved_menu_content_html: '<p><strong>Corrected</strong> Menu</p>',
            approved_menu_content: 'Corrected Menu',
            menu_content_html: '<p>Pre-review Menu</p>',
        }).approvedMenuContentHtml).toBe('<p><strong>Corrected</strong> Menu</p>');

        expect(mapApprovedSubmissionForClient({
            ...base,
            approved_menu_content: "tito's\nrosé",
            menu_content_html: '<p>titos</p><p>rose</p>',
        }).approvedMenuContentHtml).toBe('');

        expect(mapApprovedSubmissionForClient({
            ...base,
            approved_menu_content: 'Matching Menu',
            menu_content_html: '<p><strong>Matching</strong> Menu</p>',
        }).approvedMenuContentHtml).toBe('<p><strong>Matching</strong> Menu</p>');
    });
});

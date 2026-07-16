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
import { planMenuBackfill, BackfillSubmission } from '../lib/menu-backfill';

function getRouteHandler(method: string, routePath: string) {
    const layer = (app as any)._router.stack.find(
        (entry: any) =>
            entry.route &&
            entry.route.path === routePath &&
            entry.route.methods &&
            entry.route.methods[method.toLowerCase()]
    );
    if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function invokeJsonHandler(handler: any, { body = {}, params = {}, query = {} } = {}) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req: any = { body, params, query };
        const res: any = {
            statusCode: 200,
            status(code: number) { this.statusCode = code; return this; },
            json(payload: any) { resolve({ status: this.statusCode || 200, body: payload }); return this; },
        };
        Promise.resolve(handler(req, res)).catch(reject);
    });
}

// --------------------------------------------------------------------------
// Backfill grouping (pure algorithm on fixture data)
// --------------------------------------------------------------------------
describe('planMenuBackfill grouping', () => {
    const base = (over: Partial<BackfillSubmission>): BackfillSubmission => ({
        status: 'approved',
        source: 'form',
        property: 'Tán - Test Hotel',
        service_period: 'Lunch',
        project_name: 'Lunch',
        ...over,
    });

    test('clean lineage chain collapses to one menu, pointer = latest reviewed_at', () => {
        const rows = [
            base({ id: 'v1', reviewed_at: '2026-01-01T00:00:00Z', approved_menu_content: 'A\nB' }),
            base({ id: 'v2', revision_base_submission_id: 'v1', reviewed_at: '2026-03-01T00:00:00Z', approved_menu_content: 'A\nB\nC' }),
            base({ id: 'v3', revision_base_submission_id: 'v2', reviewed_at: '2026-02-01T00:00:00Z', approved_menu_content: 'A\nB\nD' }),
        ];
        const plan = planMenuBackfill(rows);
        expect(plan.menus).toHaveLength(1);
        expect(plan.menus[0].memberIds.sort()).toEqual(['v1', 'v2', 'v3']);
        // v2 has the newest reviewed_at even though v3 is later in the chain.
        expect(plan.menus[0].currentSubmissionId).toBe('v2');
        expect(plan.ambiguous).toHaveLength(0);
    });

    test('doc-upload text match joins a lineage-unknown submission to an existing menu', () => {
        const content = ['STARTERS', 'Soup - $8', 'Salad - $9', 'MAINS', 'Steak - $30'].join('\n');
        const rows = [
            base({ id: 'anchor', reviewed_at: '2026-01-01T00:00:00Z', approved_menu_content: content }),
            // No lineage link, but near-identical text → should join "anchor".
            base({ id: 'upload', reviewed_at: '2026-02-01T00:00:00Z', approved_menu_content: `${content}\nDessert - $7` }),
        ];
        const plan = planMenuBackfill(rows);
        expect(plan.menus).toHaveLength(1);
        expect(plan.menus[0].memberIds.sort()).toEqual(['anchor', 'upload']);
        expect(plan.ambiguous).toHaveLength(0);
    });

    test('name equality joins when text differs but property/service/name match', () => {
        const rows = [
            base({ id: 'a', reviewed_at: '2026-01-01T00:00:00Z', approved_menu_content: 'totally different one' }),
            base({ id: 'b', reviewed_at: '2026-02-01T00:00:00Z', approved_menu_content: 'nothing alike here' }),
        ];
        const plan = planMenuBackfill(rows);
        expect(plan.menus).toHaveLength(1);
        expect(plan.menus[0].memberIds.sort()).toEqual(['a', 'b']);
        expect(plan.menus[0].currentSubmissionId).toBe('b');
    });

    test('different service periods stay separate menus (multi-menu property)', () => {
        const rows = [
            base({ id: 'lunch', service_period: 'Lunch', project_name: 'Lunch', approved_menu_content: 'x' }),
            base({ id: 'dinner', service_period: 'Dinner', project_name: 'Dinner', approved_menu_content: 'y' }),
        ];
        const plan = planMenuBackfill(rows);
        expect(plan.menus).toHaveLength(2);
    });

    test('ambiguous submission (name matches >1 existing menu) goes to review, not linked', () => {
        // Two distinct lineage groups share the same property/service/name; a third
        // unlinked submission with that same name can't be auto-assigned.
        const rows = [
            base({ id: 'g1a', reviewed_at: '2026-01-01T00:00:00Z', project_name: 'Holidays & Events', service_period: 'Holidays & Events', approved_menu_content: 'group one\nunique' }),
            base({ id: 'g1b', revision_base_submission_id: 'g1a', reviewed_at: '2026-01-05T00:00:00Z', project_name: 'Holidays & Events', service_period: 'Holidays & Events', approved_menu_content: 'group one\nunique' }),
            base({ id: 'g2a', reviewed_at: '2026-01-02T00:00:00Z', project_name: 'Holidays & Events', service_period: 'Holidays & Events', approved_menu_content: 'group two\ndistinct' }),
            base({ id: 'g2b', revision_base_submission_id: 'g2a', reviewed_at: '2026-01-06T00:00:00Z', project_name: 'Holidays & Events', service_period: 'Holidays & Events', approved_menu_content: 'group two\ndistinct' }),
            base({ id: 'orphan', reviewed_at: '2026-03-01T00:00:00Z', project_name: 'Holidays & Events', service_period: 'Holidays & Events', approved_menu_content: 'orphan text nobody else has' }),
        ];
        const plan = planMenuBackfill(rows);
        // orphan is NOT a member of any menu.
        const allMembers = plan.menus.flatMap((m) => m.memberIds);
        expect(allMembers).not.toContain('orphan');
        expect(plan.ambiguous.map((a) => a.submissionId)).toContain('orphan');
        expect(plan.ambiguous[0].reason).toBe('name-match-multiple');
        expect(plan.ambiguous[0].candidateCurrentIds.length).toBeGreaterThan(1);
    });

    test('unmatched submission becomes a single-version menu', () => {
        const rows = [
            base({ id: 'solo', property: 'Lonely Property', service_period: 'Brunch', project_name: 'Brunch', approved_menu_content: 'solo content' }),
        ];
        const plan = planMenuBackfill(rows);
        expect(plan.menus).toHaveLength(1);
        expect(plan.menus[0].memberIds).toEqual(['solo']);
        expect(plan.menus[0].currentSubmissionId).toBe('solo');
        expect(plan.ambiguous).toHaveLength(0);
    });
});

// --------------------------------------------------------------------------
// CRUD + batch routes (JSON fallback)
// --------------------------------------------------------------------------
describe('menu CRUD routes (JSON fallback)', () => {
    const listHandler = getRouteHandler('get', '/menus');
    const createHandler = getRouteHandler('post', '/menus');
    const getHandler = getRouteHandler('get', '/menus/:id');
    let menus: Record<string, any>;

    beforeEach(() => {
        menus = {};
        (isSupabaseConfigured as jest.Mock).mockReturnValue(false);
        (fs.promises.readFile as jest.Mock).mockImplementation(async (target: string) => {
            if (String(target).endsWith('menus.json')) return JSON.stringify(menus);
            return '{}';
        });
        (fs.promises.writeFile as jest.Mock).mockImplementation(async (target: string, payload: string) => {
            if (String(target).endsWith('menus.json')) menus = JSON.parse(payload);
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => jest.restoreAllMocks());

    test('POST creates a menu and GET/:id returns it', async () => {
        const created = await invokeJsonHandler(createHandler, {
            body: { property: 'Tán', servicePeriod: 'Lunch', name: 'Lunch', currentSubmissionId: 'sub-1' },
        });
        expect(created.status).toBe(201);
        expect(created.body.menu.id).toBeTruthy();
        expect(created.body.menu.status).toBe('active');

        const fetched = await invokeJsonHandler(getHandler, { params: { id: created.body.menu.id } });
        expect(fetched.status).toBe(200);
        expect(fetched.body.menu.name).toBe('Lunch');
        expect(fetched.body.menu.current_submission_id).toBe('sub-1');
    });

    test('POST rejects a menu missing required fields', async () => {
        const res = await invokeJsonHandler(createHandler, { body: { property: 'Tán' } });
        expect(res.status).toBe(400);
    });

    test('GET /menus filters by property and service period', async () => {
        await invokeJsonHandler(createHandler, { body: { property: 'Tán', servicePeriod: 'Lunch', name: 'Lunch' } });
        await invokeJsonHandler(createHandler, { body: { property: 'Tán', servicePeriod: 'Dinner', name: 'Dinner' } });
        await invokeJsonHandler(createHandler, { body: { property: 'Aqimero', servicePeriod: 'Lunch', name: 'Lunch' } });

        const all = await invokeJsonHandler(listHandler, { query: {} });
        expect(all.body.menus).toHaveLength(3);

        const tanLunch = await invokeJsonHandler(listHandler, { query: { property: 'Tán', servicePeriod: 'Lunch' } });
        expect(tanLunch.body.menus).toHaveLength(1);
        expect(tanLunch.body.menus[0].service_period).toBe('Lunch');
    });

    test('GET /menus/:id returns 404 for unknown id', async () => {
        const res = await invokeJsonHandler(getHandler, { params: { id: 'nope' } });
        expect(res.status).toBe(404);
    });
});

// --------------------------------------------------------------------------
// Write path: pointer moves + brand-new resolution + inheritance (JSON fallback)
// --------------------------------------------------------------------------
describe('menu write path (JSON fallback)', () => {
    const putHandler = getRouteHandler('put', '/submissions/:id');
    const postHandler = getRouteHandler('post', '/submissions');
    let submissions: Record<string, any>;
    let menus: Record<string, any>;

    beforeEach(() => {
        submissions = {};
        menus = {};
        (isSupabaseConfigured as jest.Mock).mockReturnValue(false);
        (fs.promises.readFile as jest.Mock).mockImplementation(async (target: string) => {
            const t = String(target);
            if (t.endsWith('submissions.json')) return JSON.stringify(submissions);
            if (t.endsWith('menus.json')) return JSON.stringify(menus);
            return '{}';
        });
        (fs.promises.writeFile as jest.Mock).mockImplementation(async (target: string, payload: string) => {
            const t = String(target);
            if (t.endsWith('submissions.json')) submissions = JSON.parse(payload);
            if (t.endsWith('menus.json')) menus = JSON.parse(payload);
        });
        (fs.promises.copyFile as jest.Mock) = jest.fn().mockResolvedValue(undefined);
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => jest.restoreAllMocks());

    const seedMenu = (over: Partial<any> = {}) => {
        const id = over.id || 'menu-1';
        menus[id] = {
            id, property: 'Tán', service_period: 'Lunch', name: 'Lunch',
            current_submission_id: over.current_submission_id ?? 'old-sub',
            status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
        };
        return id;
    };

    test('approving a linked submission moves the menu pointer', async () => {
        const menuId = seedMenu({ current_submission_id: 'old-sub' });
        submissions['old-sub'] = { id: 'old-sub', status: 'approved', menu_id: menuId, reviewed_at: '2026-01-01T00:00:00Z' };
        submissions['new-sub'] = { id: 'new-sub', status: 'pending_human_review', menu_id: menuId, ai_draft_path: '/x' };

        const res = await invokeJsonHandler(putHandler, {
            params: { id: 'new-sub' },
            body: { status: 'approved', reviewed_at: '2026-03-01T00:00:00Z' },
        });
        expect(res.status).toBe(200);
        expect(menus[menuId].current_submission_id).toBe('new-sub');
    });

    test('late approval of an older version does not move the pointer backward', async () => {
        const menuId = seedMenu({ current_submission_id: 'newer-sub' });
        submissions['newer-sub'] = { id: 'newer-sub', status: 'approved', menu_id: menuId, reviewed_at: '2026-05-01T00:00:00Z' };
        submissions['older-sub'] = { id: 'older-sub', status: 'pending_human_review', menu_id: menuId };

        await invokeJsonHandler(putHandler, {
            params: { id: 'older-sub' },
            body: { status: 'approved', reviewed_at: '2026-02-01T00:00:00Z' },
        });
        expect(menus[menuId].current_submission_id).toBe('newer-sub'); // unchanged
    });

    test('a non-approved status update never touches the pointer', async () => {
        const menuId = seedMenu({ current_submission_id: 'old-sub' });
        submissions['s'] = { id: 's', status: 'pending_human_review', menu_id: menuId };
        await invokeJsonHandler(putHandler, {
            params: { id: 's' },
            body: { status: 'needs_correction' },
        });
        expect(menus[menuId].current_submission_id).toBe('old-sub');
    });

    test('brand-new approval with no collision creates a menu silently and points at it', async () => {
        submissions['bn'] = { id: 'bn', status: 'pending_human_review', property: 'Fresh Place', service_period: 'Dinner', project_name: 'Dinner' };
        const res = await invokeJsonHandler(putHandler, {
            params: { id: 'bn' },
            body: { status: 'approved', reviewed_at: '2026-03-01T00:00:00Z' },
        });
        expect(res.status).toBe(200);
        const created = Object.values(menus).find((m) => m.name === 'Dinner');
        expect(created).toBeTruthy();
        expect(created.current_submission_id).toBe('bn');
        expect(submissions['bn'].menu_id).toBe(created.id);
    });

    test('brand-new collision with no reviewer decision defaults to a separate menu', async () => {
        const existingId = seedMenu({ id: 'existing', current_submission_id: 'old-sub', property: 'Tán', service_period: 'Lunch', name: 'Lunch' });
        submissions['bn'] = { id: 'bn', status: 'pending_human_review', property: 'Tán', service_period: 'Lunch', project_name: 'Lunch' };
        await invokeJsonHandler(putHandler, {
            params: { id: 'bn' },
            body: { status: 'approved', reviewed_at: '2026-03-01T00:00:00Z' },
        });
        const menuIds = Object.keys(menus);
        expect(menuIds.length).toBe(2); // a separate menu was created, not merged
        expect(submissions['bn'].menu_id).not.toBe(existingId);
    });

    test('brand-new collision with menuDecision links to the chosen existing menu', async () => {
        const existingId = seedMenu({ id: 'existing', current_submission_id: 'old-sub', property: 'Tán', service_period: 'Lunch', name: 'Lunch' });
        submissions['old-sub'] = { id: 'old-sub', status: 'approved', menu_id: existingId, reviewed_at: '2026-01-01T00:00:00Z' };
        submissions['bn'] = { id: 'bn', status: 'pending_human_review', property: 'Tán', service_period: 'Lunch', project_name: 'Lunch' };
        await invokeJsonHandler(putHandler, {
            params: { id: 'bn' },
            body: { status: 'approved', reviewed_at: '2026-03-01T00:00:00Z', menu_decision: existingId },
        });
        expect(Object.keys(menus).length).toBe(1); // linked, no new menu
        expect(submissions['bn'].menu_id).toBe(existingId);
        expect(menus[existingId].current_submission_id).toBe('bn'); // pointer moved
    });

    test('draft from an outdated version is rejected 409 with the current version', async () => {
        const menuId = seedMenu({ id: 'menu-1', current_submission_id: 'current-sub' });
        submissions['current-sub'] = { id: 'current-sub', status: 'approved', source: 'form', property: 'Tán', service_period: 'Lunch', project_name: 'Lunch', menu_id: menuId, final_path: '/f', reviewed_at: '2026-03-01T00:00:00Z' };
        submissions['old-sub'] = { id: 'old-sub', status: 'approved', source: 'form', property: 'Tán', service_period: 'Lunch', project_name: 'Lunch', menu_id: menuId, final_path: '/f', reviewed_at: '2026-01-01T00:00:00Z' };
        const createDraft = getRouteHandler('post', '/draft-sessions');
        const res = await invokeJsonHandler(createDraft, { body: { baseSubmissionId: 'old-sub' } });
        expect(res.status).toBe(409);
        expect(res.body.currentVersion?.id).toBe('current-sub');
    });

    test('draft from the current version succeeds and carries menu_id; second call resumes (one active per menu)', async () => {
        const menuId = seedMenu({ id: 'menu-1', current_submission_id: 'current-sub' });
        submissions['current-sub'] = { id: 'current-sub', status: 'approved', source: 'form', property: 'Tán', service_period: 'Lunch', project_name: 'Lunch', menu_id: menuId, final_path: '/f', reviewed_at: '2026-03-01T00:00:00Z' };
        let drafts: Record<string, any> = {};
        (fs.promises.readFile as jest.Mock).mockImplementation(async (target: string) => {
            const t = String(target);
            if (t.endsWith('submissions.json')) return JSON.stringify(submissions);
            if (t.endsWith('menus.json')) return JSON.stringify(menus);
            if (t.endsWith('draft_sessions.json')) return JSON.stringify(drafts);
            if (t.endsWith('assets.json')) return '[]';
            return '{}';
        });
        (fs.promises.writeFile as jest.Mock).mockImplementation(async (target: string, payload: string) => {
            const t = String(target);
            if (t.endsWith('submissions.json')) submissions = JSON.parse(payload);
            if (t.endsWith('menus.json')) menus = JSON.parse(payload);
            if (t.endsWith('draft_sessions.json')) drafts = JSON.parse(payload);
        });
        const createDraft = getRouteHandler('post', '/draft-sessions');
        const first = await invokeJsonHandler(createDraft, { body: { baseSubmissionId: 'current-sub' } });
        expect(first.status).toBe(201);
        expect(first.body.menu_id).toBe(menuId);
        const second = await invokeJsonHandler(createDraft, { body: { baseSubmissionId: 'current-sub' } });
        expect(second.status).toBe(200); // resumed the same active draft, not a new one
        expect(second.body.resumed).toBe(true);
        expect(Object.keys(drafts)).toHaveLength(1);
    });

    test('POST /submissions inherits menu_id from the revised baseline', async () => {
        const menuId = seedMenu({ current_submission_id: 'base' });
        submissions['base'] = { id: 'base', status: 'approved', menu_id: menuId };
        const res = await invokeJsonHandler(postHandler, {
            body: { id: 'child', status: 'processing', revision_base_submission_id: 'base', property: 'Tán', project_name: 'Lunch' },
        });
        expect(res.status).toBe(201);
        expect(submissions['child'].menu_id).toBe(menuId);
    });
});

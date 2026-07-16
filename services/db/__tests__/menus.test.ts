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

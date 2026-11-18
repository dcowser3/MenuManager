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
import path from 'path';
import app, { resolveBaselineFreshness, submissionIdForms } from '../index';
import { isSupabaseConfigured } from '@menumanager/supabase-client';

// Strand-shaped fixture from the 2026-11-16 incident: several distinct menus
// share each property + service period, approved in one batch.
const strand = JSON.parse(jest.requireActual('fs').readFileSync(
    path.join(__dirname, '..', '__fixtures__', 'strand-incident.json'), 'utf8'
));
const K = strand.keys as Record<string, string>;

function getRouteHandler(method: string, routePath: string) {
    const layer = (app as any)._router.stack.find(
        (entry: any) => entry.route && entry.route.path === routePath && entry.route.methods?.[method.toLowerCase()]
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

describe('baseline freshness by menu identity (JSON fallback, Strand fixture)', () => {
    let submissions: Record<string, any>;
    let menus: Record<string, any>;
    let drafts: Record<string, any>;
    const freshnessRoute = getRouteHandler('get', '/submissions/baseline-freshness');
    const createDraft = getRouteHandler('post', '/draft-sessions');
    const getDraft = getRouteHandler('get', '/draft-sessions/:token');
    const designEligible = getRouteHandler('get', '/menus/design-eligible');
    const approvedForService = getRouteHandler('get', '/submissions/approved-for-service');
    const search = getRouteHandler('get', '/submissions/search');
    const putSubmission = getRouteHandler('put', '/submissions/:id');

    const menuIdOf = (key: string) => submissions[K[key]].menu_id;

    beforeEach(() => {
        submissions = JSON.parse(JSON.stringify(strand.submissions));
        menus = JSON.parse(JSON.stringify(strand.menus));
        drafts = {};
        (isSupabaseConfigured as jest.Mock).mockReturnValue(false);
        (fs.promises.readFile as jest.Mock).mockImplementation(async (target: string) => {
            const name = String(target);
            if (name.endsWith('submissions.json')) return JSON.stringify(submissions);
            if (name.endsWith('menus.json')) return JSON.stringify(menus);
            if (name.endsWith('draft_sessions.json')) return JSON.stringify(drafts);
            if (name.endsWith('assets.json')) return '[]';
            if (name.endsWith('properties.json')) return '[]';
            return '{}';
        });
        (fs.promises.writeFile as jest.Mock).mockImplementation(async (target: string, payload: string) => {
            const name = String(target);
            if (name.endsWith('submissions.json')) submissions = JSON.parse(payload);
            if (name.endsWith('menus.json')) menus = JSON.parse(payload);
            if (name.endsWith('draft_sessions.json')) drafts = JSON.parse(payload);
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => jest.restoreAllMocks());

    test('same property + service with a different menu_id is never "newer" (incident regression)', async () => {
        // In Room Dining shares property + service period ("other") with the
        // Sunset Lounge Cocktail Menu and was approved LATER. It is a different menu.
        expect(Date.parse(submissions[K.ird].reviewed_at)).toBeGreaterThan(Date.parse(submissions[K.slc].reviewed_at));
        const slc = await resolveBaselineFreshness(K.slc);
        expect(slc).toEqual(expect.objectContaining({ stale: false, basis: 'menu_pointer', newerVersion: null }));

        // Dinner: four menus share the service period with identical timestamps.
        for (const key of ['dinner', 'sunset', 'cocktail', 'wine']) {
            const result = await resolveBaselineFreshness(K[key]);
            expect(result.stale).toBe(false);
        }
    });

    test('stale only when the same menu pointer names a different approved version', async () => {
        const v2Legacy = 'form-1794900000001';
        submissions[v2Legacy] = {
            ...submissions[K.cocktail], id: '00000000-0000-0000-0000-00000000c0c2', legacy_id: v2Legacy,
            revision_base_submission_id: K.cocktail, reviewed_at: '2026-11-01T00:00:00.000Z',
        };
        menus[menuIdOf('cocktail')].current_submission_id = v2Legacy;

        const result = await resolveBaselineFreshness(K.cocktail);
        expect(result.stale).toBe(true);
        expect(result.basis).toBe('menu_pointer');
        expect(result.newerVersion.legacy_id).toBe(v2Legacy);

        const route = await invokeJsonHandler(freshnessRoute, { query: { id: K.cocktail } });
        expect(route.status).toBe(200);
        expect(route.body.stale).toBe(true);
        expect(route.body.newerVersion).toEqual(expect.objectContaining({ id: v2Legacy, projectName: 'The Del Mar Cocktail Menu' }));
        // The unrelated menus in the same service period stay fresh.
        expect((await resolveBaselineFreshness(K.sunset)).stale).toBe(false);
    });

    test('compares both public id forms (pointer stored as uuid, baseline addressed by legacy id and vice versa)', async () => {
        const uuid = submissions[K.slc].id;
        menus[menuIdOf('slc')].current_submission_id = uuid;
        expect(submissionIdForms(submissions[K.slc])).toEqual([K.slc, uuid]);
        expect((await resolveBaselineFreshness(K.slc)).stale).toBe(false);
        expect((await resolveBaselineFreshness(uuid)).stale).toBe(false);

        // And the draft gate agrees: no 409 for the current version.
        const created = await invokeJsonHandler(createDraft, { body: { baseSubmissionId: K.slc } });
        expect(created.status).toBe(201);
        const opened = await invokeJsonHandler(getDraft, { params: { token: created.body.token } });
        expect(opened.body.baselineFreshness).toEqual(expect.objectContaining({ stale: false, basis: 'menu_pointer' }));
        expect(opened.body.baseline.idAliases).toEqual([K.slc, uuid]);
        expect(opened.body.baseline).not.toHaveProperty('isLatestForPropertyService');
        expect(opened.body.baseline).not.toHaveProperty('latestForPropertyService');
    });

    test('pointer at a non-approved (deleted) row falls back to the newest approved version and is repaired', async () => {
        const deletedLegacy = 'form-1794852058559';
        submissions[deletedLegacy] = {
            ...submissions[K.sunset], id: '00000000-0000-0000-0000-0000000de1e7', legacy_id: deletedLegacy,
            status: 'deleted', reviewed_at: '2026-11-16T18:30:00.000Z',
        };
        const cocktailMenuId = menuIdOf('cocktail');
        menus[cocktailMenuId].current_submission_id = deletedLegacy;

        const result = await resolveBaselineFreshness(K.cocktail);
        expect(result.stale).toBe(false);
        expect(menus[cocktailMenuId].current_submission_id).toBe(K.cocktail);

        // A draft for the real current version is allowed (was a 409 before).
        menus[cocktailMenuId].current_submission_id = deletedLegacy;
        const created = await invokeJsonHandler(createDraft, { body: { baseSubmissionId: K.cocktail } });
        expect(created.status).toBe(201);

        // The menu stays visible to the design workflow.
        menus[cocktailMenuId].current_submission_id = deletedLegacy;
        const eligible = await invokeJsonHandler(designEligible, { query: { q: 'cocktail menu', limit: '50' } });
        expect(eligible.body.menus).toEqual(expect.arrayContaining([
            expect.objectContaining({ menuId: cocktailMenuId, submissionId: K.cocktail }),
        ]));
        expect(menus[cocktailMenuId].current_submission_id).toBe(K.cocktail);
    });

    test('a later approval moves a pointer that was left on a deleted row', async () => {
        const deletedLegacy = 'form-1794852058365';
        const wineMenuId = menuIdOf('wine');
        submissions[deletedLegacy] = {
            ...submissions[K.wine], id: '00000000-0000-0000-0000-0000000de1e8', legacy_id: deletedLegacy,
            status: 'deleted', reviewed_at: '2026-12-01T00:00:00.000Z',
        };
        menus[wineMenuId].current_submission_id = deletedLegacy;
        const pendingLegacy = 'form-1794999999999';
        submissions[pendingLegacy] = {
            ...submissions[K.wine], id: '00000000-0000-0000-0000-0000000de1e9', legacy_id: pendingLegacy,
            status: 'pending_human_review', reviewed_at: '2026-11-20T00:00:00.000Z',
        };
        const result = await invokeJsonHandler(putSubmission, { params: { id: pendingLegacy }, body: { status: 'approved' } });
        expect(result.status).toBe(200);
        expect(menus[wineMenuId].current_submission_id).toBe(pendingLegacy);
    });

    test('missing menu_id: lineage children decide (either id form); none means not stale', async () => {
        for (const key of Object.keys(submissions)) delete submissions[key].menu_id;
        const noChild = await resolveBaselineFreshness(K.pool);
        expect(noChild).toEqual(expect.objectContaining({ stale: false, basis: 'unknown', newerVersion: null }));

        const childLegacy = 'form-1794950000000';
        submissions[childLegacy] = {
            ...submissions[K.pool], id: '00000000-0000-0000-0000-0000000c41d0', legacy_id: childLegacy,
            revision_base_submission_id: submissions[K.pool].id, // uuid form
            reviewed_at: '2026-11-02T00:00:00.000Z',
        };
        const withChild = await resolveBaselineFreshness(K.pool);
        expect(withChild).toEqual(expect.objectContaining({ stale: true, basis: 'lineage' }));
        expect(withChild.newerVersion.legacy_id).toBe(childLegacy);

        // A non-approved lineage child never gates.
        submissions[childLegacy].status = 'pending_human_review';
        expect((await resolveBaselineFreshness(K.pool)).stale).toBe(false);
    });

    test('unknown baseline is a 404, missing id is a 400, and unknown never gates', async () => {
        expect((await invokeJsonHandler(freshnessRoute, { query: {} })).status).toBe(400);
        const missing = await invokeJsonHandler(freshnessRoute, { query: { id: 'form-does-not-exist' } });
        expect(missing.status).toBe(404);
        expect(missing.body.stale).toBe(false);
    });

    test('approved-for-service lists every distinct menu in the service period by name', async () => {
        const result = await invokeJsonHandler(approvedForService, { query: { property: strand.property, servicePeriod: 'dinner' } });
        expect(result.status).toBe(200);
        expect(result.body.menus.map((m: any) => m.projectName)).toEqual([
            'The Del Mar Cocktail Menu',
            'The Del Mar Dinner Menu',
            'The Del Mar Sunset Lounge',
            'The Del Mar Wine Bottle List',
        ]);
    });

    test('search badges "current version" by menu pointer, never by property + service', async () => {
        const result = await invokeJsonHandler(search, { query: { q: 'Del Mar', property: strand.property, servicePeriod: 'other', limit: '20' } });
        const rows = result.body as any[];
        const slc = rows.find((row) => row.id === K.slc);
        const ird = rows.find((row) => row.id === K.ird);
        expect(slc.isCurrentMenuVersion).toBe(true);
        expect(ird.isCurrentMenuVersion).toBe(true);
        expect(rows.every((row) => !('isLatestForPropertyService' in row))).toBe(true);
    });
});

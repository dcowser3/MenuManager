jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    getSupabaseClient: jest.fn(),
    isSupabaseConfigured: jest.fn(() => false),
}));

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readFile: jest.fn(),
        },
    };
});

import { promises as fs } from 'fs';
import {
    getApprovedMenuDownload,
    enrichApprovedMenuList,
    groupApprovedIntoMenuCards,
    listApprovedMenus,
} from '../lib/approved-menus';

const repoRoot = '/Users/deriancowser/Documents/MenuManager';
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('approved menu helpers', () => {
    beforeEach(() => {
        mockedFs.readFile.mockImplementation(async (target: any) => {
            const normalized = String(target);

            if (normalized.endsWith('/tmp/db/submissions.json')) {
                return JSON.stringify({
                    'form-200': {
                        id: 'form-200',
                        source: 'form',
                        status: 'approved',
                        project_name: 'Spring Dinner',
                        property: 'Test Property',
                        filename: 'Aqimero_Dinner_5.8.26.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
                        service_period: 'dinner',
                        reviewed_at: '2026-05-08T10:00:00.000Z',
                        submitter_name: 'Carlos',
                    },
                    'form-201': {
                        id: 'form-201',
                        source: 'form',
                        status: 'pending_human_review',
                        project_name: 'Pending Menu',
                        property: 'Test Property',
                        filename: 'Pending Menu.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/pending.docx',
                    },
                    'form-202': {
                        id: 'form-202',
                        source: 'form',
                        status: 'approved',
                        project_name: 'Summer Lunch',
                        property: 'Other Property',
                        filename: 'Other_Lunch_6.1.26.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Other Property/Summer Lunch/form-202/approved/form-202-approved.docx',
                        service_period: 'lunch',
                        reviewed_at: '2026-06-01T10:00:00.000Z',
                        submitter_name: 'Mina',
                    },
                    'design-1': {
                        id: 'design-1',
                        source: 'design_approval',
                        status: 'approved',
                        project_name: 'Design Only',
                        property: 'Test Property',
                        filename: 'Design Menu.docx',
                        final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/design.docx',
                        reviewed_at: '2026-05-09T10:00:00.000Z',
                    },
                });
            }

            if (normalized.endsWith('/tmp/db/assets.json')) {
                return JSON.stringify([
                    {
                        id: 'asset_1',
                        submission_id: 'form-200',
                        asset_type: 'approved_docx',
                        storage_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
                        file_name: 'form-200-approved.docx',
                        created_at: '2026-05-08T10:05:00.000Z',
                    },
                ]);
            }

            throw new Error(`Unexpected read: ${normalized}`);
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('lists approved form submissions without relying on the DB service route', async () => {
        const approvedMenus = await listApprovedMenus(repoRoot, 'spring', 150);

        expect(approvedMenus).toEqual([
            expect.objectContaining({
                id: 'form-200',
                projectName: 'Spring Dinner',
                property: 'Test Property',
                approvedFileName: 'Aqimero_Dinner_5.8.26.docx',
                status: 'approved',
                servicePeriod: 'dinner',
                submitterName: 'Carlos',
            }),
        ]);
    });

    test('filters approved submissions by restaurant and optional service period', async () => {
        const approvedMenus = await listApprovedMenus(repoRoot, {
            restaurant: 'other property',
            servicePeriod: 'lunch',
        }, 150);

        expect(approvedMenus).toEqual([
            expect.objectContaining({
                id: 'form-202',
                projectName: 'Summer Lunch',
                property: 'Other Property',
                servicePeriod: 'lunch',
            }),
        ]);
    });

    test('does not return another restaurant when service period matches', async () => {
        const approvedMenus = await listApprovedMenus(repoRoot, {
            restaurant: 'test property',
            servicePeriod: 'lunch',
        }, 150);

        expect(approvedMenus).toEqual([]);
    });

    test('returns approved download metadata for a form submission', async () => {
        const approvedMenu = await getApprovedMenuDownload(repoRoot, 'form-200');

        expect(approvedMenu).toEqual({
            id: 'form-200',
            filename: 'Aqimero_Dinner_5.8.26.docx',
            finalPath: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
            storagePath: '/Users/deriancowser/Documents/MenuManager/tmp/documents/Test Property/Spring Dinner/form-200/approved/form-200-approved.docx',
            sharePointStoragePath: '',
            sharePointDriveId: '',
            status: 'approved',
            approvedFileName: 'Aqimero_Dinner_5.8.26.docx',
            projectName: 'Spring Dinner',
            property: 'Test Property',
            servicePeriod: 'dinner',
            templateType: 'food',
            dateNeeded: '',
            menuType: 'standard',
            orientation: '',
            size: '',
            allergens: '',
            approvedMenuContent: '',
            approvedMenuContentHtml: '',
            rawPayload: {},
        });
    });

    test('ignores non-form or non-approved submissions for download', async () => {
        await expect(getApprovedMenuDownload(repoRoot, 'form-201')).resolves.toBeNull();
        await expect(getApprovedMenuDownload(repoRoot, 'design-1')).resolves.toBeNull();
    });

    test('matches drafts and lineage keyed by legacy_id when the card id is the uuid', () => {
        // Drafts store base_submission_id via getPublicSubmissionId (legacy_id
        // preferred); the card list keys rows uuid-first. Both must join.
        const menus: any[] = [{ id: 'uuid-300', legacyId: 'form-300', projectName: 'Tán Lunch' }];
        const enriched = enrichApprovedMenuList(menus as any, [{
            base_submission_id: 'form-300', token: 'draft-token-2', updated_at: '2026-07-15T12:00:00Z', last_edited_by: 'Derian Cowser',
        }], {
            'form-300': { supersededBy: { id: 'form-301', projectName: 'Tán Lunch v2', approvedAt: '2026-07-14T00:00:00Z' } },
        });
        expect(enriched[0].activeDraft).toEqual({ token: 'draft-token-2', lastSavedAt: '2026-07-15T12:00:00Z', lastEditedBy: 'Derian Cowser' });
        expect(enriched[0].supersededBy).toEqual(expect.objectContaining({ id: 'form-301' }));
    });

    test('exposes legacyId on list items so the route can batch-look-up both ids', async () => {
        const approvedMenus = await listApprovedMenus(repoRoot, 'spring', 150);
        expect(approvedMenus[0]).toEqual(expect.objectContaining({ id: 'form-200', legacyId: '' }));
    });

    test('enriches cards from batch draft and lineage responses', () => {
        const menus: any[] = [{ id: 'form-200', projectName: 'Spring Dinner' }];
        const enriched = enrichApprovedMenuList(menus as any, [{
            base_submission_id: 'form-200', token: 'draft-token', updated_at: '2026-07-13T12:00:00Z', last_edited_by: 'Chef Mina',
        }], {
            'form-200': { supersededBy: { id: 'form-201', projectName: 'Spring Dinner v2', approvedAt: '2026-07-12T00:00:00Z' } },
        });
        expect(enriched[0].activeDraft).toEqual({ token: 'draft-token', lastSavedAt: '2026-07-13T12:00:00Z', lastEditedBy: 'Chef Mina' });
        expect(enriched[0].supersededBy).toEqual(expect.objectContaining({ id: 'form-201' }));
    });
});

describe('groupApprovedIntoMenuCards (menu-centric)', () => {
    const item = (over: any = {}) => ({
        id: over.id || 'x', legacyId: over.legacyId || '', menuId: over.menuId || '',
        projectName: over.projectName || 'Dinner', property: over.property || 'Tán',
        filename: '', approvedFileName: over.approvedFileName || 'f.docx',
        reviewedAt: over.reviewedAt || '2026-01-01T00:00:00Z', servicePeriod: over.servicePeriod || 'Dinner',
        submitterName: over.submitterName || 'Chef', status: over.status || 'approved',
        activeDraft: null, supersededBy: null,
    });

    test('groups versions of one menu into a single card; current = menu pointer', () => {
        const items = [
            item({ id: 'v1', menuId: 'm1', reviewedAt: '2026-01-01T00:00:00Z' }),
            item({ id: 'v2', menuId: 'm1', reviewedAt: '2026-03-01T00:00:00Z' }),
        ];
        const menus = new Map([['m1', { id: 'm1', name: 'Lunch', property: 'Tán', service_period: 'Lunch', current_submission_id: 'v1' }]]);
        const cards = groupApprovedIntoMenuCards(items as any, menus as any, []);
        expect(cards).toHaveLength(1);
        expect(cards[0].name).toBe('Lunch');
        expect(cards[0].versionCount).toBe(2);
        expect(cards[0].current.submissionId).toBe('v1'); // pointer, not newest
        expect(cards[0].versions.find((v) => v.submissionId === 'v1')!.isCurrent).toBe(true);
    });

    test('un-backfilled submissions each become their own single-version card', () => {
        const items = [item({ id: 'a', menuId: '' }), item({ id: 'b', menuId: '' })];
        const cards = groupApprovedIntoMenuCards(items as any, new Map(), []);
        expect(cards).toHaveLength(2);
        expect(cards.every((c) => !c.hasMenuEntity && c.versionCount === 1)).toBe(true);
    });

    test('active draft attaches to its menu card by menu_id', () => {
        const items = [item({ id: 'v1', menuId: 'm1' })];
        const menus = new Map([['m1', { id: 'm1', name: 'Lunch', current_submission_id: 'v1' }]]);
        const cards = groupApprovedIntoMenuCards(items as any, menus as any, [
            { menu_id: 'm1', token: 'tok', updated_at: '2026-07-01T00:00:00Z', last_edited_by: 'Mina' },
        ]);
        expect(cards[0].activeDraft).toEqual({ token: 'tok', lastSavedAt: '2026-07-01T00:00:00Z', lastEditedBy: 'Mina' });
    });
});

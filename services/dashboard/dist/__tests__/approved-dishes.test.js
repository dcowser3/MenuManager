"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('@menumanager/supabase-client', () => {
    const quality = jest.requireActual('../../supabase-client/src/dish-quality');
    return {
        __esModule: true,
        ...quality,
        getSupabaseClient: jest.fn(),
        isSupabaseConfigured: jest.fn(() => false),
    };
});
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
const fs_1 = require("fs");
const approved_dishes_1 = require("../lib/approved-dishes");
const repoRoot = '/Users/deriancowser/Documents/MenuManager';
const mockedFs = fs_1.promises;
describe('approved dish browse helpers', () => {
    beforeEach(() => {
        mockedFs.readFile.mockImplementation(async (target) => {
            const normalized = String(target);
            if (normalized.endsWith('/tmp/db/approved_dishes.json')) {
                return JSON.stringify([
                    {
                        id: 'dish-1',
                        dish_name: 'Lomo Saltado',
                        property: 'Toro Toro - InterContinental - Miami',
                        service_period: 'Dinner',
                        menu_category: 'Mains',
                        description: 'beef tenderloin, potato, tomato',
                        price: '42',
                        allergens: ['G'],
                        source_submission_id: 'sub-1',
                        is_active: true,
                        created_at: '2026-05-01T10:00:00.000Z',
                    },
                    {
                        id: 'dish-2',
                        dish_name: 'Churros',
                        property: 'Toro Toro - Four Seasons - Houston',
                        service_period: 'Dessert',
                        menu_category: 'Desserts',
                        description: 'dulce de leche',
                        price: '14',
                        allergens: ['D', 'G'],
                        source_submission_id: 'sub-2',
                        is_active: true,
                    },
                    {
                        id: 'dish-3',
                        dish_name: 'Guacamole',
                        property: 'Tamayo - Denver',
                        service_period: 'Lunch',
                        menu_category: 'Starters',
                        price: '16',
                        source_submission_id: 'sub-3',
                        is_active: true,
                    },
                    {
                        id: 'dish-4',
                        dish_name: 'Inactive Taco',
                        property: 'Toro Toro - Malta',
                        is_active: false,
                    },
                ]);
            }
            if (normalized.endsWith('/tmp/db/submissions.json')) {
                return JSON.stringify([
                    {
                        id: 'sub-1',
                        legacy_id: 'form-1',
                        project_name: 'Toro Dinner 2026',
                        filename: 'Toro_Dinner_2026.docx',
                        source: 'form',
                        clickup_task_id: 'task-1',
                        reviewed_at: '2026-05-01T12:00:00.000Z',
                        approved_menu_content: 'Lomo Saltado, beef tenderloin, potato, tomato G 42',
                    },
                    {
                        id: 'sub-2',
                        legacy_id: 'clickup-task-2',
                        project_name: 'Toro Dessert Update',
                        filename: 'Toro_Dessert_Update.docx',
                        source: 'clickup_history_import',
                        clickup_task_id: 'task-2',
                        updated_at: '2026-05-02T12:00:00.000Z',
                        approved_menu_content: 'Churros, dulce de leche D,G 14',
                        raw_payload: {
                            clickupHistoryImport: {
                                taskUrl: 'https://app.clickup.com/t/task-2',
                            },
                        },
                    },
                    {
                        id: 'sub-3',
                        legacy_id: 'form-3',
                        project_name: 'Tamayo Lunch 2026',
                        filename: 'Tamayo_Lunch_2026.docx',
                        source: 'form',
                    },
                ]);
            }
            throw new Error(`Unexpected read: ${normalized}`);
        });
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });
    test('derives stable brand names and slugs from canonical properties', () => {
        expect((0, approved_dishes_1.deriveBrandFromProperty)('Toro Toro - InterContinental - Miami')).toBe('Toro Toro');
        expect((0, approved_dishes_1.deriveBrandFromProperty)('Toro Del Mar - Athens')).toBe('Toro Del Mar');
        expect((0, approved_dishes_1.slugifyApprovedDishBrand)('tán')).toBe('tan');
    });
    test('aggregates frequent approved culinary words without losing accents', () => {
        const terms = (0, approved_dishes_1.buildApprovedDishVocabularyTerms)([
            { dish_name: 'Fuego Chicken', description: 'tamarind glaze, brûlée onion' },
            { dish_name: 'Fuego Steak', description: 'tamarind jus, brûlée leek' },
            { dish_name: 'Fuego Fish', description: 'tamarind sauce, brûlée lime' },
            { dish_name: 'Rare Dish', description: 'oneoff ingredient' },
        ]);
        expect(terms).toEqual(expect.arrayContaining([
            { term: 'fuego', count: 3 },
            { term: 'tamarind', count: 3 },
            { term: 'brûlée', count: 3 },
        ]));
        expect(terms.some((term) => term.term === 'oneoff')).toBe(false);
    });
    test('merges approved dish and full-menu vocabulary counts', () => {
        expect((0, approved_dishes_1.mergeApprovedVocabularyTerms)([{ term: 'Tamarind', count: 2 }, { term: 'fuego', count: 1 }], [{ term: 'tamarind', count: 3 }, { term: 'brûlée', count: 4 }])).toEqual([
            { term: 'tamarind', count: 5 },
            { term: 'brûlée', count: 4 },
            { term: 'fuego', count: 1 },
        ]);
    });
    test('combines active dish rows with full approved menu text', async () => {
        const terms = await (0, approved_dishes_1.loadApprovedReviewVocabularyTerms)(repoRoot);
        expect(terms).toEqual(expect.arrayContaining([
            { term: 'lomo', count: 2 },
            { term: 'churros', count: 2 },
            { term: 'tenderloin', count: 2 },
        ]));
        expect(terms.some((term) => term.term === 'inactive')).toBe(false);
    });
    test('lists brand summaries with location counts from approved dishes', async () => {
        const summaries = await (0, approved_dishes_1.listApprovedDishBrands)(repoRoot);
        expect(summaries).toEqual([
            {
                brand: 'Tamayo',
                slug: 'tamayo',
                dishCount: 1,
                locationCount: 1,
                locations: ['Tamayo - Denver'],
            },
            {
                brand: 'Toro Toro',
                slug: 'toro-toro',
                dishCount: 2,
                locationCount: 2,
                locations: [
                    'Toro Toro - Four Seasons - Houston',
                    'Toro Toro - InterContinental - Miami',
                ],
            },
        ]);
    });
    test('returns a brand detail grouped by location with search and location filters', async () => {
        const detail = await (0, approved_dishes_1.getApprovedDishBrandDetail)(repoRoot, 'toro-toro', {
            query: 'dulce',
            location: 'Toro Toro - Four Seasons - Houston',
        });
        expect(detail?.summary).toMatchObject({
            brand: 'Toro Toro',
            dishCount: 2,
            locationCount: 2,
        });
        expect(detail?.dishes).toHaveLength(1);
        expect(detail?.locationGroups).toEqual([
            {
                location: 'Toro Toro - Four Seasons - Houston',
                dishes: [
                    expect.objectContaining({
                        dishName: 'Churros',
                        description: 'dulce de leche',
                        brand: 'Toro Toro',
                        source: expect.objectContaining({
                            label: 'Toro_Dessert_Update.docx',
                            projectName: 'Toro Dessert Update',
                            clickupTaskUrl: 'https://app.clickup.com/t/task-2',
                        }),
                        quality: expect.objectContaining({
                            disposition: 'keep',
                        }),
                    }),
                ],
            },
        ]);
    });
    test('matches search terms against source metadata and exposes quality flags', async () => {
        const detail = await (0, approved_dishes_1.getApprovedDishBrandDetail)(repoRoot, 'tamayo', {
            query: 'tamayo lunch',
        });
        expect(detail?.dishes).toHaveLength(1);
        expect(detail?.dishes[0]).toMatchObject({
            dishName: 'Guacamole',
            source: expect.objectContaining({
                label: 'Tamayo_Lunch_2026.docx',
                projectName: 'Tamayo Lunch 2026',
            }),
            quality: expect.objectContaining({
                disposition: 'review',
            }),
        });
        expect(detail?.dishes[0].quality.issues.map((issue) => issue.code)).toContain('bare_low_info_dish');
    });
});

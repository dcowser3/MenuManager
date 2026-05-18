"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
                    }),
                ],
            },
        ]);
    });
});

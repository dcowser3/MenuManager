import {
    analyzeApprovedDishQuality,
    buildDishQualityContext,
    findDishSourceContext,
} from '../src/dish-quality';

describe('approved dish quality analyzer', () => {
    test('flags pricing grids and category contamination', () => {
        const rows = [
            {
                dish_name: 'À La Carte PricingAntojitos',
                description: '$12Tacos - $14Especialidades - $16Mas - $8Postres -',
                menu_category: 'Postres',
                price: '8',
                source_submission_id: 'sub-1',
            },
            {
                dish_name: 'Mole Enchilada',
                description: 'scrambled eggs, mole, crema, queso fresco',
                menu_category: 'Chicken Tinga Enchiladas, tomatillo-tomato salsa, chihuahua cheese, black bean purée, crema fresca D',
                price: 'prix fixe',
                source_submission_id: 'sub-1',
            },
        ];
        const context = buildDishQualityContext(rows);

        expect(analyzeApprovedDishQuality(rows[0], context)).toMatchObject({
            disposition: 'exclude',
            highestSeverity: 'high',
        });
        expect(analyzeApprovedDishQuality(rows[0], context).issues.map((issue) => issue.code)).toContain('pricing_grid_as_dish');
        expect(analyzeApprovedDishQuality(rows[1], context).issues.map((issue) => issue.code)).toContain('category_description_contamination');
    });

    test('keeps exact duplicates visible as informational quality flags', () => {
        const rows = [
            {
                dish_name: 'Adobo Chicken',
                menu_category: 'Tacos',
                description: 'radish, red onion, cilantro, tomatillo salsa verde',
                price: '17',
                source_submission_id: 'sub-1',
            },
            {
                dish_name: 'Adobo Chicken',
                menu_category: 'Tacos',
                description: 'radish, red onion, cilantro, tomatillo salsa verde',
                price: '17',
                source_submission_id: 'sub-1',
            },
        ];

        const result = analyzeApprovedDishQuality(rows[0], buildDishQualityContext(rows));

        expect(result.disposition).toBe('review');
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'exact_duplicate_within_submission',
                severity: 'info',
            }),
        ]));
    });

    test('does not flag legitimate same-name dishes across different categories', () => {
        const rows = [
            {
                dish_name: 'Adobo Chicken',
                menu_category: 'Tacos',
                description: 'radish, red onion, cilantro, tomatillo salsa verde',
                price: '17',
                source_submission_id: 'sub-1',
            },
            {
                dish_name: 'Adobo Chicken',
                menu_category: 'Fajitas',
                description: 'flour tortillas, guacamole, crema fresca, pico de gallo',
                price: '27',
                source_submission_id: 'sub-1',
            },
        ];

        const result = analyzeApprovedDishQuality(rows[1], buildDishQualityContext(rows));

        expect(result.issues.map((issue) => issue.code)).not.toContain('same_name_across_categories');
        expect(result.disposition).toBe('keep');
    });

    test('flags beverage headings and layout leaders before storage', () => {
        const rows = [
            {
                dish_name: 'Pick Me Up',
                menu_category: 'Mineral Water',
                description: 'Carajillo – cinnamon-infused Licor 43 – reposado – espresso',
                price: '14',
                source_submission_id: 'sub-1',
            },
            {
                dish_name: 'Acqua Panna 1 liter........',
                menu_category: 'Mineral Water',
                price: '8',
                source_submission_id: 'sub-1',
            },
        ];
        const context = buildDishQualityContext(rows);

        const headingResult = analyzeApprovedDishQuality(rows[0], context);
        const leaderResult = analyzeApprovedDishQuality(rows[1], context);

        expect(headingResult).toMatchObject({
            disposition: 'exclude',
            highestSeverity: 'high',
        });
        expect(headingResult.issues.map((issue) => issue.code)).toContain('beverage_heading_as_name');
        expect(leaderResult).toMatchObject({
            disposition: 'exclude',
            highestSeverity: 'high',
        });
        expect(leaderResult.issues.map((issue) => issue.code)).toContain('layout_leader_in_name');
    });

    test('flags beverage rows where ingredients were stored as the name', () => {
        const row = {
            dish_name: 'Blanco Tequila – citrus – frozen or rocks',
            menu_category: 'Margaritas',
            description: 'Fresh Fruit',
            price: '15',
            source_submission_id: 'sub-1',
        };

        const result = analyzeApprovedDishQuality(row, buildDishQualityContext([row]));

        expect(result.disposition).toBe('review');
        expect(result.issues.map((issue) => issue.code)).toContain('beverage_name_description_swap');
    });

    test('prefers source lines near the matching category for repeated dish names', () => {
        const menuText = [
            'Tacos',
            'Adobo Chicken, radish, red onion, cilantro, tomatillo salsa verde G 17',
            'Fajitas',
            'served with flour tortillas G, guacamole V, crema fresca D, pico de gallo',
            'Adobo Chicken G 27',
        ].join('\n');

        const context = findDishSourceContext(menuText, {
            dish_name: 'Adobo Chicken',
            menu_category: 'Fajitas',
            description: 'flour tortillas, guacamole, crema fresca, pico de gallo',
            price: '27',
            source_submission_id: 'sub-1',
        });

        expect(context).toMatchObject({
            sourceLine: 'Adobo Chicken G 27',
            previousLine: 'served with flour tortillas G, guacamole V, crema fresca D, pico de gallo',
            lineNumber: 5,
        });
    });
});

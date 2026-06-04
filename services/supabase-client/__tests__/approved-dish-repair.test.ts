import {
    buildApprovedDishRepairCandidate,
    resolveApprovedDishRepairMenuText,
    summarizeApprovedDishRows,
} from '../src/approved-dish-repair';

describe('approved dish repair planning', () => {
    test('summarizes high-risk quality rows and blank descriptions', () => {
        const summary = summarizeApprovedDishRows([
            {
                dish_name: 'À La Carte PricingAntojitos',
                description: '$12Tacos - $14Especialidades - $16Mas - $8Postres -',
                menu_category: 'Postres',
                price: '8',
                source_submission_id: 'sub-1',
            },
            {
                dish_name: 'Adobo Chicken',
                menu_category: 'Fajitas',
                price: '27',
                source_submission_id: 'sub-1',
            },
        ]);

        expect(summary.totalRows).toBe(2);
        expect(summary.highOrExcludeRows).toBe(1);
        expect(summary.blankDescriptionRows).toBe(1);
        expect(summary.pricingRows).toBe(1);
    });

    test('preserves source menu line breaks for re-extraction', () => {
        const menuText = resolveApprovedDishRepairMenuText({
            approved_menu_content: 'Lunch Menu\r\nTacos\r\nAdobo Chicken, salsa G 17',
            menu_content: 'fallback',
        });

        expect(menuText).toBe('Lunch Menu\nTacos\nAdobo Chicken, salsa G 17');
    });

    test('marks a changed extraction eligible when it removes quality problems', () => {
        const candidate = buildApprovedDishRepairCandidate({
            submission: {
                id: 'sub-1',
                legacy_id: 'legacy-1',
                property: 'Tamayo - Denver',
                service_period: 'Brunch',
                filename: 'tamayo.docx',
            },
            beforeRows: [
                {
                    dish_name: 'À La Carte PricingAntojitos',
                    description: '$12Tacos - $14Especialidades - $16Mas - $8Postres -',
                    menu_category: 'Postres',
                    price: '8',
                    property: 'Tamayo - Denver',
                    service_period: 'Brunch',
                    source_submission_id: 'sub-1',
                },
            ],
            prepared: [
                {
                    index: 0,
                    extracted: {
                        name: 'Guacamole',
                        category: 'Antojitos',
                        price: '12',
                        allergens: [],
                    },
                    input: {
                        dish_name: 'Guacamole',
                        menu_category: 'Antojitos',
                        price: '12',
                        property: 'Tamayo - Denver',
                        service_period: 'Brunch',
                        source_submission_id: 'sub-1',
                    },
                    quality: {
                        disposition: 'keep',
                        issues: [],
                    },
                    sourceContext: {
                        sourceLine: 'Guacamole 12',
                        previousLine: 'Antojitos',
                        nextLine: '',
                        context: 'Antojitos\nGuacamole 12',
                        lineNumber: 2,
                    },
                    excludedByRule: false,
                },
            ],
        });

        expect(candidate.status).toBe('eligible');
        expect(candidate.changed).toBe(true);
        expect(candidate.improved).toBe(true);
        expect(candidate.before.highOrExcludeRows).toBe(1);
        expect(candidate.after.highOrExcludeRows).toBe(0);
    });

    test('skips repairs when the new extraction still has high-risk rows', () => {
        const candidate = buildApprovedDishRepairCandidate({
            submission: {
                id: 'sub-1',
                property: 'Tamayo - Denver',
            },
            beforeRows: [
                {
                    dish_name: 'Bad Row',
                    menu_category: 'Dinner',
                    price: '1',
                    property: 'Tamayo - Denver',
                    source_submission_id: 'sub-1',
                },
            ],
            prepared: [
                {
                    index: 0,
                    extracted: {
                        name: 'À La Carte PricingAntojitos',
                        category: 'Postres',
                        description: '$12Tacos - $14Especialidades -',
                        price: '8',
                        allergens: [],
                    },
                    input: {
                        dish_name: 'À La Carte PricingAntojitos',
                        description: '$12Tacos - $14Especialidades -',
                        menu_category: 'Postres',
                        price: '8',
                        property: 'Tamayo - Denver',
                        source_submission_id: 'sub-1',
                    },
                    quality: {
                        disposition: 'exclude',
                        highestSeverity: 'high',
                        issues: [],
                    },
                    sourceContext: {
                        sourceLine: 'À La Carte PricingAntojitos $12Tacos - $14Especialidades - 8',
                        previousLine: '',
                        nextLine: '',
                        context: 'À La Carte PricingAntojitos $12Tacos - $14Especialidades - 8',
                        lineNumber: 1,
                    },
                    excludedByRule: false,
                },
            ],
        });

        expect(candidate.status).toBe('skipped');
        expect(candidate.reason).toContain('still has high/exclude');
    });

    test('skips repairs when row count drops beyond the safety cap', () => {
        const beforeRows = Array.from({ length: 10 }, (_, index) => ({
            dish_name: `Dish ${index}`,
            menu_category: 'Dinner',
            description: 'valid description',
            price: `${index + 1}`,
            property: 'Tamayo - Denver',
            source_submission_id: 'sub-1',
        }));

        const candidate = buildApprovedDishRepairCandidate({
            submission: {
                id: 'sub-1',
                property: 'Tamayo - Denver',
            },
            beforeRows,
            prepared: [
                {
                    index: 0,
                    extracted: {
                        name: 'Dish 1',
                        category: 'Dinner',
                        description: 'valid description',
                        price: '1',
                        allergens: [],
                    },
                    input: beforeRows[0],
                    quality: {
                        disposition: 'keep',
                        issues: [],
                    },
                    sourceContext: {
                        sourceLine: 'Dish 1, valid description 1',
                        previousLine: 'Dinner',
                        nextLine: '',
                        context: 'Dinner\nDish 1, valid description 1',
                        lineNumber: 2,
                    },
                    excludedByRule: false,
                },
            ],
            includeClean: true,
            maxCountDropRatio: 0.5,
        });

        expect(candidate.status).toBe('skipped');
        expect(candidate.countDropRatio).toBeCloseTo(0.9);
        expect(candidate.reason).toContain('row count would drop');
    });
});

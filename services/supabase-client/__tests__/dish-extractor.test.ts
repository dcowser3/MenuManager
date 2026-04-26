import { previewDishExtraction } from '../src/dish-extractor';

describe('approved dish extraction', () => {
    test('splits inline dish names from descriptions and ignores managed footer lines', () => {
        const menuText = [
            'STARTERS',
            'Guacamole - fresh avocado / lime / cilantro D,G 12',
            'Queso Fundido - melted cheese / chorizo / jalapeño D,G 14',
            'Tacos al Pastor - pork / pineapple / onion / cilantroD,G 16',
            'ENTRÉES',
            'Enchiladas Verdes - chicken / green salsa / crema D,G 22',
            'Carne Asada - grilled steak / rice / beans / tortillas G 28',
            'Chile Relleno - poblano pepper / queso cheese/ rice / beans D,G 24',
            'Mole Poblano - chicken / traditional mole sauce / sesame seeds D,G 26',
            'DESSERTS',
            'Flan - traditional custard D 8',
            'Tres Leches Cake - vanilla cake / three milk mixture / whipped crème D 9',
            'C crustaceans | D dairy | E egg | F fish | G gluten | N nuts | V vegetarian | VG vegan',
            '*consuming raw or undercooked meats, poultry, seafood, shellfish, or eggs may increase your risk of foodborne illness.',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toHaveLength(9);
        expect(extracted.map((dish) => dish.name)).toEqual([
            'Guacamole',
            'Queso Fundido',
            'Tacos al Pastor',
            'Enchiladas Verdes',
            'Carne Asada',
            'Chile Relleno',
            'Mole Poblano',
            'Flan',
            'Tres Leches Cake',
        ]);
        expect(extracted[0]).toMatchObject({
            name: 'Guacamole',
            description: 'fresh avocado / lime / cilantro',
            allergens: ['D', 'G'],
            price: '12',
            category: 'STARTERS',
        });
        expect(extracted[2]).toMatchObject({
            name: 'Tacos al Pastor',
            description: 'pork / pineapple / onion / cilantro',
            allergens: ['D', 'G'],
            price: '16',
            category: 'STARTERS',
        });
        expect(extracted[8]).toMatchObject({
            name: 'Tres Leches Cake',
            description: 'vanilla cake / three milk mixture / whipped crème',
            allergens: ['D'],
            price: '9',
            category: 'DESSERTS',
        });
    });

    test('stops before multiline allergen key blocks', () => {
        const menuText = [
            'DINNER MENU',
            '',
            'STARTERS',
            '',
            'Guacamole - fresh avocado-lime-cilantro 12',
            '',
            'Queso Fundido - melted cheese-chorizo-jalapeño 14',
            '',
            'Tacos al Pastor - pork-pineapple-onion-cilantro 16',
            '',
            'ENTREES',
            '',
            'Enchiladas Verdes - chicken enchiladas-green salsa-crema 22',
            '',
            'Carne Asada - grilled steak / rice-beans-tortillas 28',
            '',
            'Chile Relleno - poblano pepper, queso , rice, beans 24',
            '',
            'Mole Poblano - chicken-traditional mole sauce-sesame 26',
            '',
            'DESSERTS',
            '',
            'Flan - traditional crème brûlée style 8',
            '',
            'Churros - cinnamon sugar, chocolate 7',
            '',
            'ALLERGEN KEY',
            'C crustaceans',
            'D dairy',
            'E egg',
            'F fish',
            'G gluten',
            'N nuts',
            'V vegetarian',
            'VG vegan',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toHaveLength(9);
        expect(extracted[0]).toMatchObject({
            name: 'Guacamole',
            description: 'fresh avocado-lime-cilantro',
            price: '12',
            category: 'STARTERS',
        });
        expect(extracted[8]).toMatchObject({
            name: 'Churros',
            description: 'cinnamon sugar, chocolate',
            price: '7',
            category: 'DESSERTS',
        });
        expect(extracted.find((dish) => /crustaceans/i.test(dish.name))).toBeUndefined();
    });
});

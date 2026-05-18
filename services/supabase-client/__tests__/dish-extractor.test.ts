import { normalizeDishPriceForProperty, normalizeDishPriceForStorage, previewDishExtraction } from '../src/dish-extractor';

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

    test('splits comma-delimited dish names from ingredient descriptions', () => {
        const menuText = [
            'APPETIZERS',
            'Punta Mita, prawns, tomato, onion, cilantro C,F,S 95',
            'Market Salad, avocado, heirloom tomato D,V 70',
            'Watermelon,Jocoque,pinenut,habanerosa N,V 70',
            'Ceviche de pescado, catch of the day, green chile F 105',
            'Venue, Room',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toHaveLength(5);
        expect(extracted[0]).toMatchObject({
            name: 'Punta Mita',
            description: 'prawns, tomato, onion, cilantro',
            allergens: ['C', 'F', 'S'],
            price: '95',
            category: 'APPETIZERS',
        });
        expect(extracted[1]).toMatchObject({
            name: 'Market Salad',
            description: 'avocado, heirloom tomato',
            allergens: ['D', 'V'],
            price: '70',
        });
        expect(extracted[2]).toMatchObject({
            name: 'Watermelon',
            description: 'Jocoque, pinenut, habanerosa',
            allergens: ['N', 'V'],
            price: '70',
        });
        expect(extracted[3]).toMatchObject({
            name: 'Ceviche de pescado',
            description: 'catch of the day, green chile',
            allergens: ['F'],
            price: '105',
        });
        expect(extracted[4]).toMatchObject({
            name: 'Venue, Room',
            description: undefined,
        });
    });

    test('does not treat price-bearing chicken dishes as category headers', () => {
        const menuText = [
            'Ladies Night Menu',
            'Smoked Guacamole, jalapeño, avocado, coriander, lime, corn tortilla chips V 90',
            'Chicken Tacos, chipotle marination, pickles, pineapple C,E,G,S,SS,SL 85',
            'Lomo Saltado Empanada, housemade turnover, sautéed beef tenderloin, mozzarella cheese D, E,G,S,SL,SY 80',
            'Crispy Prawns, panko-breaded prawns, melcocha sauce, arugula, mango, red chili D,E,G,S,SL, SY 95',
            'Soft Shell Crab, smoked paprika aioli, avocado, roasted capsicum, lemon D,E,G,M,S,SL 85',
            'Chicken yakitori, togarashi huancaína, chimichurri, yuzu furikake D,G,SY,SS 75',
            'Truffle Fries, poblano tartar sauce, parmesan cheese, chives D,E,V 75',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toHaveLength(7);
        expect(extracted.map((dish) => dish.name)).toEqual([
            'Smoked Guacamole',
            'Chicken Tacos',
            'Lomo Saltado Empanada',
            'Crispy Prawns',
            'Soft Shell Crab',
            'Chicken yakitori',
            'Truffle Fries',
        ]);
        expect(extracted[1]).toMatchObject({
            name: 'Chicken Tacos',
            description: 'chipotle marination, pickles, pineapple',
            allergens: ['C', 'E', 'G', 'S', 'SS', 'SL'],
            price: '85',
            category: 'Ladies Night Menu',
        });
        expect(extracted[5]).toMatchObject({
            name: 'Chicken yakitori',
            description: 'togarashi huancaína, chimichurri, yuzu furikake',
            allergens: ['D', 'G', 'SY', 'SS'],
            price: '75',
            category: 'Ladies Night Menu',
        });
        expect(extracted.some((dish) => dish.category?.startsWith('Chicken'))).toBe(false);
        expect(extracted.every((dish) => dish.category === 'Ladies Night Menu')).toBe(true);
    });

    test('does not stop at menu titles that resemble allergen legend lines', () => {
        const menuText = [
            'Dinner Menu',
            'For The Table',
            'Smoked Guacamole, jalapeño, avocado, tomato, onion, coriander, lime, corn tortilla chips V €14.00',
            'Starters',
            'Prime US Beef Fillet “Anticucho” Skewer, mirasol chili, potato salad, heart of palm, ají amarillo* €30.00 G',
            'Chicken Yakitori, togarashi huancaína, chimichurri, yuzu furikake G,D €14.00',
            'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toHaveLength(3);
        expect(extracted[0]).toMatchObject({
            name: 'Smoked Guacamole',
            description: 'jalapeño, avocado, tomato, onion, coriander, lime, corn tortilla chips',
            allergens: ['V'],
            price: '€14.00',
            category: 'For The Table',
        });
        expect(extracted[1]).toMatchObject({
            name: 'Prime US Beef Fillet “Anticucho” Skewer',
            allergens: ['G'],
            price: '€30.00',
            category: 'Starters',
        });
        expect(extracted[2]).toMatchObject({
            name: 'Chicken Yakitori',
            allergens: ['G', 'D'],
            price: '€14.00',
            category: 'Starters',
        });
    });

    test('does not treat A la Carte headings as allergen legends', () => {
        const menuText = [
            'Menu',
            'A la Carte',
            'Guacamole, onion, tomato, cilantro, lime, charred corn tlayudas VG 20',
            'Ceviche Amarillo, tuna, ají amarillo, leche de tigre, red onion, mango* 22',
            'G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contains nuts | VG vegan',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toHaveLength(2);
        expect(extracted[0]).toMatchObject({
            name: 'Guacamole',
            allergens: ['VG'],
            price: '20',
            category: 'A la Carte',
        });
        expect(extracted[1]).toMatchObject({
            name: 'Ceviche Amarillo',
            price: '22',
            category: 'A la Carte',
        });
    });

    test('skips service times and per-guest pricing metadata', () => {
        const menuText = [
            'Bloom To Table',
            '$145 per guest (max 45 guests)',
            'Smoked Guacamole, jalapeño, avocado, coriander, lime V 14',
            'MONDAY – FRIDAY',
            '3 - 5 pm',
            '3:00 pm to 6:00 pm',
            '4 Courses 295.00',
            '1st course Roasted Heirloom Beet Salad, green apple, goat cheese D,N',
            '3 tacos per order',
            '28oz with 2 sides 275',
            'add chicken 15 | beef 25',
            'Chicken Tacos, chipotle marination, pickles G 12',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted.map((dish) => dish.name)).toEqual([
            'Smoked Guacamole',
            'Chicken Tacos',
        ]);
        expect(extracted.some((dish) => /\$145|3\s*-\s*5\s*pm|courses?|course|tacos per order|with 2 sides|^add\b/i.test(dish.name))).toBe(false);
    });

    test('joins wrapped dish lines before parsing trailing price and allergens', () => {
        const menuText = [
            'Appetizers',
            'Fried Chicken Bites, karaage-style chicken, truffle, crème fraîche,',
            'gochujang, crispy potato, G,D 18',
            'Truffle Mushroom Flatbread, goat cheese, caramelized onions, sautéed mushrooms',
            'truffle oil, arugula, D,G,V 18',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted.map((dish) => dish.name)).toEqual([
            'Fried Chicken Bites',
            'Truffle Mushroom Flatbread',
        ]);
        expect(extracted[0]).toMatchObject({
            description: 'karaage-style chicken, truffle, crème fraîche, gochujang, crispy potato',
            allergens: ['G', 'D'],
            price: '18',
            category: 'Appetizers',
        });
        expect(extracted[1]).toMatchObject({
            description: 'goat cheese, caramelized onions, sautéed mushrooms truffle oil, arugula',
            allergens: ['D', 'G', 'V'],
            price: '18',
            category: 'Appetizers',
        });
        expect(extracted.some((dish) => dish.name === 'gochujang' || dish.name === 'truffle oil')).toBe(false);
    });

    test('handles event instructions, attributions, parenthesized prices, and salad shorthand', () => {
        const menuText = [
            'APPETIZER',
            'Served for the Table',
            'Host chooses 2 from the selections below:',
            'Guacamole',
            'onion, tomato, cilantro, lime, corn tlayuda VG',
            'Specialty Drinks:',
            'Honeybee Fizz (NA) ($16)',
            'Ginger Ale, Butterscotch Honey Foam',
            'Crafted by Food & Beverage Manager Billy Lee',
            'Salads & Bowls',
            'Kale, heirloom cherry tomato, grapes, candied cancha corn, orange-white balsamic vinaigrette D,V 16',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted.map((dish) => dish.name)).toEqual([
            'Guacamole',
            'Honeybee Fizz (NA)',
            'Kale (Salad)',
        ]);
        expect(extracted[0]).toMatchObject({
            description: 'onion, tomato, cilantro, lime, corn tlayuda',
            allergens: ['VG'],
            category: 'APPETIZER',
        });
        expect(extracted[1]).toMatchObject({
            description: 'Ginger Ale, Butterscotch Honey Foam',
            price: '$16',
        });
        expect(extracted[2]).toMatchObject({
            description: 'heirloom cherry tomato, grapes, candied cancha corn, orange-white balsamic vinaigrette',
            price: '16',
            category: 'Salads & Bowls',
        });
        expect(extracted.some((dish) => /served for the table|crafted by|host chooses/i.test(dish.name))).toBe(false);
    });

    test('skips parsed package instructions and strips leftover allergen clusters from descriptions', () => {
        const menuText = [
            'Food Offerings',
            'Served from 8:00pm to 10:00pm',
            'Available weekends from 2 – 4pm. Not included in bottomless brunch, Traditional Guacamole, tomato, onion V 16',
            'An extra charge of $3 will be added for orders Up, Neat or On the Rocks.',
            'Please add to ALL menus, 20% service fee for parties of six or more',
            'EXISTING MENU EDITS, 1-2 business days',
            'NEW MENU DEVELOPMENT, 5 business days',
            'Choice of White, Cakebread Cellars Chardonnay, Napa Valley, California or',
            'Three Course Prix Fixe, choice of one entrada, one plato fuerte and postre 39',
            'Enhancements +180.00PP',
            'Chimichanga, adobo-marinated chicken, black beans, sour cream D, G, M 160',
            'Prawns, grilled prawns, salsa macha C, D, E, G, M, PN 210',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted.map((dish) => dish.name)).toEqual([
            'Chimichanga',
            'Prawns',
        ]);
        expect(extracted[0]).toMatchObject({
            description: 'adobo-marinated chicken, black beans, sour cream',
            allergens: ['D', 'G', 'M'],
            price: '160',
            category: 'Enhancements',
        });
        expect(extracted[1]).toMatchObject({
            description: 'grilled prawns, salsa macha',
            allergens: ['C', 'D', 'E', 'G', 'M', 'PN'],
            price: '210',
        });
    });

    test('captures prices from wrapped price lines and high bottle prices', () => {
        const menuText = [
            'Signature Cocktails',
            'Skinny Cucumber, mezcal or blanco tequila, lime, cucumber, mint, agave, soda water',
            '(115 calories) 17',
            'La Chata Paloma, agavales silver tequila, ancho reyes liqueur, lime, agave, rosemary syrup',
            'Fever-tree grapefruit soda 19',
            'Bubbles',
            'Louis Roederer “Cristal”, Brut reims, france 1200',
            'Wine By The Glass',
            'Lyra Grand Reserva, Pinot Noir, chile GL 16/BTL 72',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'Skinny Cucumber',
                price: '17',
            }),
            expect.objectContaining({
                name: 'La Chata Paloma',
                description: 'agavales silver tequila, ancho reyes liqueur, lime, agave, rosemary syrup Fever-tree grapefruit soda',
                price: '19',
            }),
            expect.objectContaining({
                name: 'Louis Roederer “Cristal”',
                price: '1200',
            }),
            expect.objectContaining({
                name: 'Lyra Grand Reserva',
                price: 'GL 16/BTL 72',
            }),
        ]));
    });

    test('normalizes database prices without currency symbols', () => {
        expect(normalizeDishPriceForProperty('17', 'Aqimero - Ritz-Carlton - Philadelphia')).toBe('17');
        expect(normalizeDishPriceForProperty('GL 16/BTL 72', 'Aqimero - Ritz-Carlton - Philadelphia')).toBe('16/72');
        expect(normalizeDishPriceForProperty('17', 'Zengo - Le Royal Meridien - Dubai')).toBe('17');
        expect(normalizeDishPriceForProperty('$17', 'Aqimero - Ritz-Carlton - Philadelphia')).toBe('17');
        expect(normalizeDishPriceForStorage(undefined, 'Aqimero - Ritz-Carlton - Philadelphia', 'NYE Restaurant')).toBe('prix fixe');
        expect(normalizeDishPriceForStorage(undefined, 'Aqimero - Ritz-Carlton - Philadelphia', 'Dinner')).toBeUndefined();
    });

    test('uses section prices for unpriced enhancement and pairing items', () => {
        const menuText = [
            'Entrées',
            'Rack of Lamb, mint pea purée, red wine sauce',
            'Enhancement (+140.00 per table)',
            'Tableside Tomahawk Flambé, 32oz tomahawk steak, agave herb butter',
            'Wine Pairing 85.00PP',
            'Chandon Brut, sparkling wine, California',
            'Desserts',
            'Churros, chocolate sauce 12',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'Tableside Tomahawk Flambé',
                category: 'Enhancement',
                price: '140.00',
            }),
            expect.objectContaining({
                name: 'Chandon Brut',
                category: 'Wine Pairing',
                price: '85.00',
            }),
            expect.objectContaining({
                name: 'Churros',
                category: 'Desserts',
                price: '12',
            }),
        ]));
        expect(extracted.find((dish) => dish.name === 'Rack of Lamb')?.price).toBeUndefined();
    });

    test('marks prix fixe menu dishes while keeping enhancement prices numeric', () => {
        const menuText = [
            'AED 245 PER PERSON / 3-COURSE MENU',
            'APPETIZERS',
            'Guacamole Tradicional',
            'avocado, tomato, onion, coriander, lime V',
            'ENTRÉES',
            'Sea Bass Aguachile, cucumber, chile, lime F',
            'Enhancement (+45.00 per table)',
            'Tableside Salsa, roasted tomato, habanero',
            'DESSERT',
            'Churros, chocolate sauce',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'Guacamole Tradicional',
                category: 'APPETIZERS',
                price: 'prix fixe',
            }),
            expect.objectContaining({
                name: 'Sea Bass Aguachile',
                category: 'ENTRÉES',
                price: 'prix fixe',
            }),
            expect.objectContaining({
                name: 'Tableside Salsa',
                category: 'Enhancement',
                price: '45.00',
            }),
            expect.objectContaining({
                name: 'Churros',
                category: 'DESSERT',
                price: 'prix fixe',
            }),
        ]));
    });

    test('recognizes compact PP menu prices as prix fixe markers', () => {
        const menuText = [
            'Easter Brunch Menu',
            '125.00PP Adults | Children under 12 60.00PP',
            'Raw Bar',
            '(Served for the table)',
            'Coconut Ceviche, ahi tuna, lychee leche de tigre, toasted coconut*',
            'Shared',
            'Kale Salad, grilled fig, goat cheese, toasted walnut D,N',
            'Enhancement (+140.00 per table)',
            'Tableside Tomahawk Flambé, 32oz tomahawk steak',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'Coconut Ceviche',
                category: 'Raw Bar',
                price: 'prix fixe',
            }),
            expect.objectContaining({
                name: 'Kale Salad',
                category: 'Shared',
                price: 'prix fixe',
            }),
            expect.objectContaining({
                name: 'Tableside Tomahawk Flambé',
                category: 'Enhancement',
                price: '140.00',
            }),
        ]));
    });

    test('handles wine prices, single allergen tails, and cup bowl prices', () => {
        const menuText = [
            'Starters',
            'Prime US Beef Fillet “Anticucho” Skewer, mirasol chili, potato salad €30.00 G',
            'Tortilla Soup, panela cheese, chicken, crema fresca D,G 12cup / 16bowl',
            'PAUILLAC',
            'CHÂTEAU LATOUR 1er grand cru classé 2004 22,300',
            'Beverages',
            'Venga Chopped Salad, romaine, bacon, panela cheese D 18 add mahi-mahi* 12 | shrimp S 10',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'Prime US Beef Fillet “Anticucho” Skewer',
                price: '€30.00',
                allergens: ['G'],
            }),
            expect.objectContaining({
                name: 'Tortilla Soup',
                price: '12/16',
            }),
            expect.objectContaining({
                name: 'CHÂTEAU LATOUR 1er grand cru classé 2004',
                price: '22,300',
                category: 'PAUILLAC',
            }),
            expect.objectContaining({
                name: 'Venga Chopped Salad',
                price: '18',
            }),
        ]));
    });

    test('skips metadata rows and marks prix fixe rows from common package labels', () => {
        const menuText = [
            'Viva Abejas Menu (Prix-Fix Price $95)',
            'February 16th, 2026',
            'Top of Form',
            'Please incorporate choose Chicago logo attached.',
            'Entradas',
            'Shrimp Ceviche, guajillo aguachile, serrano, avocado S',
            'Three Course Prix Fixe 39',
            'Smoked Salmon Dip, pickled chilies, cherry tomato',
            'D= Dairy E=Egg S=Soy SF= Shellfish M=Mustard',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'Shrimp Ceviche',
                price: 'prix fixe',
            }),
            expect.objectContaining({
                name: 'Smoked Salmon Dip',
                price: 'prix fixe',
            }),
        ]));
        expect(extracted.some((dish) => /february|top of form|d=|please incorporate|prix-fix price/i.test(dish.name))).toBe(false);
    });

    test('extracts two-line all-caps dishes and premium surcharges in set menus', () => {
        const menuText = [
            'Half Board Menu',
            'STARTERS',
            'CHOOSE ANY 1',
            'SMOKED GUACAMOLE V',
            'jalapeño / avocado / coriander / lime / corn tortilla chips',
            'HUACHINANGO CEVICHE C, F + AED 50',
            'sea bass / leche de tigre / cancha / red onion / sweet potato',
            'MAIN COURSE',
            'GRILLED AUSTRALIAN LAMB CHOPS C, G, M, SS, S, SY',
            'mustard seed / orange / chimichurri / achiote / ají panca',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'SMOKED GUACAMOLE',
                description: 'jalapeño / avocado / coriander / lime / corn tortilla chips',
                allergens: ['V'],
                price: 'prix fixe',
            }),
            expect.objectContaining({
                name: 'HUACHINANGO CEVICHE',
                description: 'sea bass / leche de tigre / cancha / red onion / sweet potato',
                allergens: ['C', 'F'],
                price: '50',
            }),
            expect.objectContaining({
                name: 'GRILLED AUSTRALIAN LAMB CHOPS',
                allergens: ['C', 'G', 'M', 'SS', 'S', 'SY'],
                price: 'prix fixe',
            }),
        ]));
    });

    test('uses section price-only rows for beverage groups', () => {
        const menuText = [
            'TT Signatures Cocktails',
            '$20',
            'Mercado Margarita, tequila, passion fruit, lime',
            'Timeless Legends',
            '$19',
            'Hibiscus Mule, vodka, lime, ginger beer',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'Mercado Margarita',
                price: '$20',
                category: 'TT Signatures Cocktails',
            }),
            expect.objectContaining({
                name: 'Hibiscus Mule',
                price: '$19',
                category: 'Timeless Legends',
            }),
        ]));
    });

    test('skips unpriced section headings and option continuations from audit findings', () => {
        const menuText = [
            'WHITE',
            'RED',
            'GIN',
            'RUM',
            'TEA',
            'Wood Fire Grill',
            'all steaks are served with chimichurri, roasted garlic, & herb butter D',
            'STEEL CUT ORGANIC OATMEAL G 15',
            'Brown Sugar Or Agave Syrup, Golden Raisins, Mint, Mixed Berries',
            'Specialty Cocktails',
            'Indulgente Afrodisiaco 75',
            'Martini & Bump of Osetra Caviar',
            'Martini, Drumshanbo Gunpowder Gin, Tito’s Vodka, Lillet Rose, Damiana, olive juice, caviar-stuffed olives',
            'Wednesday',
            'SPECIALES',
            '18',
            'Chicago Old Fashioned',
            'Bourbon, Mezcal, agave, orange & cacao bitters',
            'Classics with a Twist',
            'Baja Coast Cosmo, ketel one peach & orange blossom vodka, white cranberry, fresh lime',
            'Tacos',
            'Fajitas',
            'served with flour tortillas G, guacamole V, crema fresca D, pico de gallo',
            'vegan option available upon request',
            'choice of two sides: truffle fries D V, broccolini V,D, brussels sprouts G,V, cilantro rice,',
            'mashed potatoes D,V',
            'Chopped Salad, romaine, bacon, panela cheese, chickpea, tomato, roasted corn, avocado vinaigrette, crispy tortilla D 18 add mahi-mahi* 12 | shrimp S 10 | grilled chicken 10',
        ].join('\n');

        const extracted = previewDishExtraction(menuText);

        expect(extracted.map((dish) => dish.name)).toEqual([
            'STEEL CUT ORGANIC OATMEAL',
            'Indulgente Afrodisiaco',
            'Martini & Bump of Osetra Caviar',
            'Chicago Old Fashioned',
            'Baja Coast Cosmo',
            'Chopped Salad',
        ]);
        expect(extracted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'STEEL CUT ORGANIC OATMEAL',
                price: '15',
                category: 'Wood Fire Grill',
            }),
            expect.objectContaining({
                name: 'Indulgente Afrodisiaco',
                price: '75',
                category: 'Specialty Cocktails',
            }),
            expect.objectContaining({
                name: 'Martini & Bump of Osetra Caviar',
                description: 'Martini, Drumshanbo Gunpowder Gin, Tito’s Vodka, Lillet Rose, Damiana, olive juice, caviar-stuffed olives',
                category: 'Specialty Cocktails',
            }),
            expect.objectContaining({
                name: 'Chopped Salad',
                price: '18',
            }),
            expect.objectContaining({
                name: 'Chicago Old Fashioned',
                price: '18',
                category: 'SPECIALES',
            }),
        ]));
        expect(extracted.some((dish) => /^(RED|GIN|RUM|TEA|Wood Fire Grill|Wednesday|Brown Sugar|Classics with a Twist|Fajitas|vegan option|mashed potatoes)/i.test(dish.name))).toBe(false);
    });
});

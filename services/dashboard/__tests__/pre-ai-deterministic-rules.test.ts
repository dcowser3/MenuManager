import {
    runPreAiDeterministicChecks,
    AcceptedCorrectionRule,
    getAcceptedCorrectionRulePreAiEligibility,
} from '../lib/pre-ai-deterministic-rules';

describe('runPreAiDeterministicChecks', () => {
    it('does not add a raw-animal marker to the explicitly vegan Toro tiradito', () => {
        const vegan = 'Vegan Tiradito, cucumber, avocado, serrano, aguachile VG';
        expect(runPreAiDeterministicChecks(vegan).menuText).toBe(vegan);
        expect(runPreAiDeterministicChecks('Tuna Tiradito, cucumber, avocado, serrano G').menuText).toContain('*');
    });

    it('applies safe built-in spelling and diacritic replacements before AI review', () => {
        const result = runPreAiDeterministicChecks(
            'Jalapeno Salad, passionfruit, mozarella D, G 18',
            { allergenLegend: 'D dairy | G gluten | V vegetarian' }
        );

        expect(result.menuText).toBe('Jalapeño Salad, passion fruit, mozzarella D,G 18');
        expect(result.appliedCorrections.map((c) => c.type)).toEqual([
            'Diacritics',
            'Spelling',
            'Spelling',
            'Allergen Code',
        ]);
    });

    it('adds the ají tone mark generally while protecting Hawaiian ahi tuna phrases', () => {
        const result = runPreAiDeterministicChecks([
            'Aji Amarillo Rice 18',
            'Aji Panca Chicken D 24',
            'aji tuna tostada 18',
            'ají tuna tostada 18',
            'ahí tuna tostada 18',
            'Aji Lime Sauce 4',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Ají Amarillo Rice 18',
            'Ají Panca Chicken D 24',
            'ahi tuna tostada 18',
            'ahi tuna tostada 18',
            'ahi tuna tostada 18',
            'Ají Lime Sauce 4',
        ].join('\n'));
    });

    it('pins brand orthography in both directions and treats ALL CAPS as no exemption', () => {
        const result = runPreAiDeterministicChecks([
            'PATRON EL ALTO 91',
            'PATRÓN Extra Añejo, Añejo and Reposado',
            'Patron Silver 15',
            'JOSE CUERVO RESERVA DE LA FAMILIA 38',
            'JOSÉ CUERVO ESPECIAL SILVER 55',
            'José Cuervo Tradicional Plata 16',
            'Familia Zuccardi Jose, Mendoza, Argentina 175',
        ].join('\n'));

        expect(result.menuText).toBe([
            'PATRÓN EL ALTO 91',
            'PATRÓN Extra Añejo, Añejo and Reposado',
            'Patrón Silver 15',
            'JOSE CUERVO RESERVA DE LA FAMILIA 38',
            'JOSE CUERVO ESPECIAL SILVER 55',
            'Jose Cuervo Tradicional Plata 16',
            'Familia Zuccardi Jose, Mendoza, Argentina 175',
        ].join('\n'));
    });

    it('leaves the English word "patrons" alone when pinning the Patrón brand', () => {
        const result = runPreAiDeterministicChecks('Our patrons must be 21 years or older');

        expect(result.menuText).toBe('Our patrons must be 21 years or older');
        expect(result.appliedCorrections).toEqual([]);
    });

    it('adds the cheese modifier to Cotija without duplicating or changing hyphenated forms', () => {
        const result = runPreAiDeterministicChecks([
            'Esquites, sweet yellow corn, spicy aioli, cotija, bacon* D 17',
            'Pork Belly, COTIJA CHEESE, pickled chili D,G 18',
            'Taco, Cotija Cheese, salsa verde D 15',
            'Corn, cotija-style crema D 12',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Esquites, sweet yellow corn, spicy aioli, cotija cheese, bacon* D 17',
            'Pork Belly, COTIJA CHEESE, pickled chili D,G 18',
            'Taco, Cotija Cheese, salsa verde D 15',
            'Corn, cotija-style crema D 12',
        ].join('\n'));
        expect(result.appliedCorrections).toContainEqual(expect.objectContaining({
            type: 'Terminology',
            original: 'cotija',
            corrected: 'cotija cheese',
            rule: 'Cotija must include the cheese modifier.',
        }));
        expect(result.appliedCorrections).toHaveLength(1);
    });

    it('enforces the canonical mayo-to-aioli SOP rule before and after model review', () => {
        const result = runPreAiDeterministicChecks([
            'Avocado Salad, yellow chili mayo, yuzu kosho 75',
            'Tuna Roll, spicy mayonnaise-style sauce 22',
            'Aioli Trio, garlic aioli 18',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Avocado Salad, yellow chili aioli, yuzu kosho 75',
            'Tuna Roll, spicy aioli-style sauce 22',
            'Aioli Trio, garlic aioli 18',
        ].join('\n'));
        expect(result.appliedCorrections.filter((correction) => correction.type === 'Terminology')).toEqual([
            expect.objectContaining({ original: 'mayo', corrected: 'aioli' }),
            expect.objectContaining({ original: 'mayonnaise', corrected: 'aioli' }),
        ]);
    });

    it('catches conservative singular-ingredient misses while preserving counted or prepared plurals', () => {
        const result = runPreAiDeterministicChecks([
            'Smoked Guacamole, jalapeños, avocado, coriander, lime 90',
            'Tuna Ceviche*, almond sauce, cucumber pickles, praline 105',
            'Prawns Tequeños, sautéed prawns, filo dough 80',
            'Encocado, black cod, prawns, squid, coconut 190',
            'pickles C,D,G,SY 200',
            'Burger, three pickles on the side 24',
            'Taco, sautéed prawns, avocado 18',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Smoked Guacamole, jalapeño, avocado, coriander, lime 90',
            'Tuna Ceviche*, almond sauce, pickle, praline 105',
            'Prawn Tequeños, sautéed prawns, filo dough 80',
            'Encocado, black cod, prawn, squid, coconut 190',
            'pickle C,D,G,SY 200',
            'Burger, three pickles on the side 24',
            'Taco, sautéed prawns, avocado 18',
        ].join('\n'));
        expect(result.appliedCorrections.filter((correction) => correction.type === 'Singular/Plural')).toHaveLength(5);
    });

    it('normalizes singular Prawn across Tequeño spelling and number variants', () => {
        const result = runPreAiDeterministicChecks([
            'Prawns Tequeño, ají amarillo 18',
            'Prawns Tequeños, salsa 18',
            'Prawns Tequeno, avocado 18',
            'Prawns Tequenos, lime 18',
            'Taco, sautéed prawns, avocado 18',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Prawn Tequeño, ají amarillo 18',
            'Prawn Tequeños, salsa 18',
            'Prawn Tequeño, avocado 18',
            'Prawn Tequeños, lime 18',
            'Taco, sautéed prawns, avocado 18',
        ].join('\n'));
    });

    it('applies the frozen contextual singularization corrections without flattening exceptions', () => {
        const result = runPreAiDeterministicChecks([
            'Kale Salad, grilled cinnamon apples, heirloom cherry tomato, roasted beet root, golden raisins, candied sesame seeds, orange balsamic vinaigrette VG',
            'Pepper Plate, baby bell peppers, Brussels Sprouts, whipped potatoes 18',
            'Harvest, pickled red onions, candied pecans, pickled raisins, beets, candied walnuts, mandarins, lemons 20',
            'Salad, cornbread croutons, spiced pepitas, Colorado apples, candied pepitas 16',
            'Salad, spiced pepitas D,G 16',
            'Beet Salad, caramelized walnuts, pistou herbs D,G 18',
            'Garden Salad, mixed herbs, sesame seeds V 16',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Kale Salad, grilled cinnamon apple, heirloom cherry tomato, roasted beet root, golden raisin, candied sesame seed, orange balsamic vinaigrette VG',
            'Pepper Plate, baby bell pepper, Brussels Sprouts, whipped potato 18',
            'Harvest, pickled red onion, candied pecan, pickled raisin, beet, candied walnut, mandarin, lemon 20',
            'Salad, cornbread crouton, spiced pepita, Colorado apple, candied pepita 16',
            'Salad, spiced pepita D,G 16',
            'Beet Salad, caramelized walnut, pistou herb D,G 18',
            'Garden Salad, mixed herbs, sesame seeds V 16',
        ].join('\n'));
    });

    it('adds named cheese modifiers only in ingredient descriptions', () => {
        const result = runPreAiDeterministicChecks([
            'Salad, cucumbers, carrots, beets, mozzarella, feta, parmesan 18',
            'Mozzarella Special, feta cheese, parmesan-style crisp 20',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Salad, cucumber, carrot, beet, mozzarella cheese, feta cheese, parmesan cheese 18',
            'Mozzarella Special, feta cheese, parmesan-style crisp 20',
        ].join('\n'));
    });

    it('marks a bare salmon option inside a multi-option line without broad salmon matching', () => {
        const result = runPreAiDeterministicChecks([
            'grilled chicken, salmon, pasta Bolognese D G, seasonal vegetables, pepperoni & cheese pizza D G',
            'Salmon Sauce, lemon, dill D 12',
            'Fish Soup, salmon, dill D 12',
            'fish soup, salmon, dill, lemon, bread D 12',
            'Salmon Benedict, poached eggs, hollandaise D 18',
            'Salmon Ceviche, lime, onion F 18',
            'Surf and Turf, salmon, ribeye F 48',
        ].join('\n'));

        expect(result.menuText).toBe([
            'grilled chicken, salmon*, pasta Bolognese D G, seasonal vegetables, pepperoni & cheese pizza D G',
            'Salmon Sauce, lemon, dill D 12',
            'Fish Soup, salmon, dill D 12',
            'fish soup, salmon, dill, lemon, bread D 12',
            'Salmon Benedict, poached eggs, hollandaise* D 18',
            'Salmon Ceviche*, lime, onion F 18',
            'Surf and Turf, salmon, ribeye* F 48',
        ].join('\n'));
        expect(runPreAiDeterministicChecks(result.menuText).menuText).toBe(result.menuText);
    });

    it('uses bounded canonical food words to catch unseen typos without changing valid neighbors', () => {
        const result = runPreAiDeterministicChecks([
            'Feugo Aioli, tamarnd glaze 18',
            'Crème Brûlee, berries 14',
            'Juego Pequeño, tamarindo 12',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Fuego Aioli, tamarind glaze 18',
            'Crème Brûlée, berries 14',
            'Juego Pequeño, tamarindo 12',
        ].join('\n'));
        expect(result.appliedCorrections).toEqual(expect.arrayContaining([
            expect.objectContaining({ original: 'Feugo', corrected: 'Fuego' }),
            expect.objectContaining({ original: 'tamarnd', corrected: 'tamarind' }),
            expect.objectContaining({ original: 'Brûlee', corrected: 'Brûlée' }),
        ]));
    });

    it('implements confirmed reviewer preparation and terminology explanations', () => {
        const result = runPreAiDeterministicChecks([
            'Watermelon Tiradito*, cashew nuts sauce, chipotle ponzu, jicama, shimeji pickles G,SL,SY,TN 95',
            'Maduros, macha sauce, crema D 12',
            'Taco, macha salsa, avocado 18',
            'Dessert, FUGEO, tamrind, brulee D 14',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Watermelon Tiradito*, cashew sauce, chipotle ponzu, jicama, pickled shimeji mushroom G,SL,SY,TN 95',
            'Maduros, salsa macha, crema D 12',
            'Taco, salsa macha, avocado 18',
            'Dessert, FUEGO, tamarind, brûlée D 14',
        ].join('\n'));
    });

    it('normalizes existing raw marker placement and adds markers for strong raw terms', () => {
        const result = runPreAiDeterministicChecks([
            'Tuna Tartare F 24',
            'Sashimi F * 18',
            'Angry Zengo*, spicy tuna, avocado, lemon, yuzu kosho mayo E,F,SE',
            'Sushi & Sashimi Selection',
            '14oz Striploin *D 75',
            'Guacamole V 12',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Tuna Tartare* F 24',
            'Sashimi* F 18',
            'Angry Zengo*, spicy tuna, avocado, lemon, yuzu kosho aioli E,F,SE',
            'Sushi & Sashimi Selection',
            '14oz Striploin* D 75',
            'Guacamole V 12',
        ].join('\n'));
        expect(result.appliedCorrections.filter((c) => c.type === 'Raw Item')).toHaveLength(3);
    });

    it('adds a marker for ribeye and does not double-mark an existing ribeye marker', () => {
        const result = runPreAiDeterministicChecks([
            '14 oz Wagyu Ribeye, red chile truffle butter, crispy potatoes 68',
            'Longbone Pork Ribeye*, tomatillo, hominy, spiced agave, grilled corn 40',
        ].join('\n'));

        expect(result.menuText).toBe([
            '14 oz Wagyu Ribeye*, red chile truffle butter, crispy potatoes 68',
            'Longbone Pork Ribeye*, tomatillo, hominy, spiced agave, grilled corn 40',
        ].join('\n'));
    });

    it('adds markers for SOP-listed raw egg preparations', () => {
        const result = runPreAiDeterministicChecks([
            'Hollandaise Sauce, egg yolk, butter 15',
            'Béarnaise Sauce, egg yolk, tarragon 16',
            'Steak Frites, fries, traditional Caesar dressing 24',
            'Tiramisu, mascarpone, espresso 12',
            'Tostada, cured egg yolk, avocado 15',
            'Meringue, berries, cream 10',
            'Whiskey Sour, lemon, egg white 14',
            'add to any entrée: oscar topping - jumbo lump crab meat, hollandaise 12',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Hollandaise Sauce*, egg yolk, butter 15',
            'Béarnaise Sauce*, egg yolk, tarragon 16',
            'Steak Frites, fries, traditional Caesar dressing* 24',
            'Tiramisu*, mascarpone, espresso 12',
            'Tostada, cured egg yolk, avocado* 15',
            'Meringue*, berries, cream 10',
            'Whiskey Sour, lemon, egg white* 14',
            'add to any entrée: oscar topping - jumbo lump crab meat, hollandaise* 12',
        ].join('\n'));
    });

    it('excludes newly added raw egg terms when the line states a cooking method', () => {
        const result = runPreAiDeterministicChecks([
            'Braised Beef, hollandaise, potatoes 24',
            'Slow-Roasted Chicken, Caesar dressing, herbs 22',
            'Confit Duck, meringue, fruit 26',
            'Well-Done Steak, bearnaise, fries 30',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Braised Beef, hollandaise, potatoes 24',
            'Slow-Roasted Chicken, Caesar dressing, herbs 22',
            'Confit Duck, meringue, fruit 26',
            'Well-Done Steak, bearnaise, fries 30',
        ].join('\n'));
        expect(result.appliedCorrections.filter((c) => c.type === 'Raw Item')).toHaveLength(0);
    });

    it('keeps raw asterisks attached to the last dish-name word', () => {
        const result = runPreAiDeterministicChecks([
            'Hamachi New Style Sashimi * CE,F,G,MU 98',
            'Tuna Ceviche CE,D,F 78',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Hamachi New Style Sashimi* CE,F,G,MU 98',
            'Tuna Ceviche* CE,D,F 78',
        ].join('\n'));
    });

    it('normalizes allergen spacing and case while alphabetizing code order', () => {
        const result = runPreAiDeterministicChecks(
            'Salad, tomato, herbs g, d 18',
            { allergenLegend: 'D dairy | G gluten | V vegetarian' }
        );

        expect(result.menuText).toBe('Salad, tomato, herbs D,G 18');
        expect(result.appliedCorrections).toContainEqual(expect.objectContaining({
            type: 'Allergen Code',
            original: 'g, d',
            corrected: 'D,G',
        }));
    });

    it('applies curated human-review explanation rules before AI review', () => {
        const result = runPreAiDeterministicChecks([
            'Grilled Tlayuda, pickled veggies D,V 25',
            'Veggie Burger, lettuce V 18',
            'TORO TORO TRES LECHES D,E,G,TN',
            'Tres Leches Cake D,G 12',
            'Avocado Toast, poached egg, sourdough G 19',
            'Huevos Rancheros, sunny side up egg D 22',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Grilled Tlayuda, pickled vegetables D,V 25',
            'Veggie Burger, lettuce V 18',
            'TORO TORO TRES LECHES D,E,G,TN,V',
            'Tres Leches Cake D,G,V 12',
            'Avocado Toast, poached egg, sourdough* G 19',
            'Huevos Rancheros, sunny side up egg* D 22',
        ].join('\n'));
        expect(result.appliedCorrections).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'Spelling',
                original: 'veggies',
                corrected: 'vegetables',
            }),
            expect.objectContaining({
                type: 'Allergen Code',
                original: 'D,E,G,TN',
                corrected: 'D,E,G,TN,V',
                rule: 'Tres Leches always needs a vegetarian symbol V.',
            }),
            expect.objectContaining({
                type: 'Raw Item',
                original: 'Avocado Toast, poached egg, sourdough G 19',
                corrected: 'Avocado Toast, poached egg, sourdough* G 19',
            }),
            expect.objectContaining({
                type: 'Raw Item',
                original: 'Huevos Rancheros, sunny side up egg D 22',
                corrected: 'Huevos Rancheros, sunny side up egg* D 22',
            }),
        ]));
    });

    it('keeps intentional spelling preferences for brussels sprouts and dried chili', () => {
        const result = runPreAiDeterministicChecks([
            'Brussels Sprout, dry chili vinaigrette V 16',
            'Brussels Sprouts, dried chili vinaigrette V 16',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Brussels Sprouts, dried chili vinaigrette V 16',
            'Brussels Sprouts, dried chili vinaigrette V 16',
        ].join('\n'));
    });

    it('does not treat emphasis or multi-item separators as raw asterisk markers', () => {
        const result = runPreAiDeterministicChecks([
            'Submit *fully* approved menus to design@example.com.',
            'add spicy tuna* 8 | crispy pork belly 8',
            'Sashimi : sake F, suzuki F',
            '8oz Wagyu Filet* D MKT',
            'Wagyu Australian Tomahawk, served with bone marrow butter, chimichurri, choice of 2 sides* D MKT',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Submit *fully* approved menus to design@example.com.',
            'add spicy tuna* 8 | crispy pork belly 8',
            'Sashimi : sake F, suzuki F',
            '8oz Wagyu Filet* D MKT',
            'Wagyu Australian Tomahawk, served with bone marrow butter, chimichurri, choice of 2 sides* D MKT',
        ].join('\n'));
        expect(result.appliedCorrections.filter((c) => c.type === 'Raw Item')).toHaveLength(0);
    });

    it('does not add raw markers to cooked ceviche or cooked oyster preparations', () => {
        const result = runPreAiDeterministicChecks([
            'Shrimp Cocktail Ceviche, poached marinated shrimp, aguachile rojo, avocado S 26',
            'Temptation Oysters, spinach butter, jalapeño, parmesan, panko D,G,S 28',
            'Oysters on the Half Shell, mignonette S 24',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Shrimp Cocktail Ceviche, poached marinated shrimp, aguachile rojo, avocado S 26',
            'Temptation Oysters, spinach butter, jalapeño, parmesan, panko D,G,S 28',
            'Oysters on the Half Shell*, mignonette S 24',
        ].join('\n'));
        expect(result.appliedCorrections.filter((c) => c.type === 'Raw Item')).toHaveLength(1);
    });

    it('removes the raw marker from cooked shrimp ceviche but preserves explicit raw content', () => {
        const result = runPreAiDeterministicChecks([
            'Shrimp Ceviche*, lime, avocado C 24',
            'Prawn Ceviche, citrus, onion C 25',
            'Raw Shrimp Ceviche*, lime, avocado C 24',
            'Shrimp Ceviche with Tuna Tartare*, lime C,F 28',
        ].join('\n'));

        expect(result.menuText).toBe([
            'Shrimp Ceviche, lime, avocado C 24',
            'Prawn Ceviche, citrus, onion C 25',
            'Raw Shrimp Ceviche*, lime, avocado C 24',
            'Shrimp Ceviche with Tuna Tartare*, lime C,F 28',
        ].join('\n'));
    });

    it('applies accepted global learned replacement rules exactly', () => {
        const rules: AcceptedCorrectionRule[] = [{
            id: 'rule-1',
            status: 'accepted',
            source: 'human',
            original_text: 'habanero salsa',
            corrected_text: 'habanero relish',
            change_type: 'terminology',
            rule: 'Use relish for this approved preparation.',
            is_location_specific: false,
            location: 'All properties (global rule)',
        }];

        const result = runPreAiDeterministicChecks(
            'Taco, habanero salsa, cilantro 15',
            { acceptedCorrectionRules: rules }
        );

        expect(result.menuText).toBe('Taco, habanero relish, cilantro 15');
        expect(result.learnedRulesConsidered).toBe(1);
        expect(result.learnedRulesApplied).toBe(1);
        expect(result.appliedCorrections).toContainEqual(expect.objectContaining({
            type: 'Learned Rule',
            source: 'accepted_correction_rule',
            ruleId: 'rule-1',
        }));
    });

    it('applies the accepted thick-cut hyphenation rule once', () => {
        const result = runPreAiDeterministicChecks(
            'Corinne Wedge, gorgonzola, thick cut bacon, pickled onion, cucumber, buttermilk dressing 17',
            {
                acceptedCorrectionRules: [{
                    id: 'canonical-hyphenation-thick-cut-20260731',
                    status: 'accepted',
                    source: 'system',
                    original_text: 'thick cut',
                    corrected_text: 'thick-cut',
                    force_target_case: false,
                    change_type: 'spelling',
                    rule: 'Use the standard compound modifier spelling: thick-cut.',
                    is_location_specific: false,
                    location: 'All properties (global rule)',
                }],
            }
        );

        expect(result.menuText).toBe(
            'Corinne Wedge, gorgonzola, thick-cut bacon, pickled onion, cucumber, buttermilk dressing 17'
        );
        expect(result.appliedCorrections).toContainEqual(expect.objectContaining({
            source: 'accepted_correction_rule',
            original: 'thick cut',
            corrected: 'thick-cut',
        }));
    });

    it('applies learned spelling and diacritic rules without requiring the same accent marks', () => {
        const rules: AcceptedCorrectionRule[] = [
            {
                id: 'rule-creme-anglaise',
                status: 'accepted',
                source: 'system',
                original_text: 'creme anglaise',
                corrected_text: 'crème anglaise',
                change_type: 'diacritic',
                rule: 'crème anglaise is proper spelling',
                is_location_specific: false,
                location: 'All properties (global rule)',
            },
        ];

        const result = runPreAiDeterministicChecks([
            'creme anglaise 8',
            'crême anglaise 8',
            'crème anglaise 8',
        ].join('\n'), { acceptedCorrectionRules: rules });

        expect(result.menuText).toBe([
            'crème anglaise 8',
            'crème anglaise 8',
            'crème anglaise 8',
        ].join('\n'));
        expect(result.learnedRulesConsidered).toBe(1);
        expect(result.learnedRulesApplied).toBe(1);
        expect(result.appliedCorrections).toEqual(expect.arrayContaining([
            expect.objectContaining({ ruleId: 'rule-creme-anglaise', original: 'creme anglaise', corrected: 'crème anglaise' }),
            expect.objectContaining({ ruleId: 'rule-creme-anglaise', original: 'crême anglaise', corrected: 'crème anglaise' }),
        ]));
        expect(result.appliedCorrections).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ original: 'crème anglaise' }),
        ]));
    });

    it('applies the accepted canonical culinary diacritic rules once and records them as learned corrections', () => {
        const rules: AcceptedCorrectionRule[] = [
            ['gruyere', 'gruyère'],
            ['puree', 'purée'],
            ['entree', 'entrée'],
            ['crudite', 'crudité'],
        ].map(([original_text, corrected_text]) => ({
            id: `canonical-${original_text}`,
            status: 'accepted',
            source: 'system',
            original_text,
            corrected_text,
            change_type: 'diacritic',
            rule: `Use ${corrected_text}.`,
            is_location_specific: false,
            location: 'All properties (global rule)',
        }));

        const result = runPreAiDeterministicChecks([
            'cheese, gruyere, herbs 12',
            'mango puree, lime 10',
            'choose entree, house salad 18',
            'crudite, ranch 14',
        ].join('\n'), { acceptedCorrectionRules: rules });

        expect(result.menuText).toBe([
            'cheese, gruyère, herbs 12',
            'mango purée, lime 10',
            'choose entrée, house salad 18',
            'crudité, ranch 14',
        ].join('\n'));
        // puree and entree are already covered by built-in replacements; the
        // accepted rules remain considered but do not duplicate those edits.
        expect(result.appliedCorrections.filter((correction) => correction.source === 'accepted_correction_rule'))
            .toHaveLength(2);
        expect(result.learnedRulesConsidered).toBe(4);
        expect(result.learnedRulesApplied).toBe(2);
    });

    it('forces canonical target casing only when an accepted rule opts in', () => {
        const rules: AcceptedCorrectionRule[] = [
            ['maldon', 'Maldon'],
            ['marcona', 'Marcona'],
            ['reggiano', 'Reggiano'],
        ].map(([original_text, corrected_text]) => ({
            id: `canonical-case-${original_text}`,
            status: 'accepted',
            source: 'system',
            original_text,
            corrected_text,
            force_target_case: true,
            change_type: 'capitalization',
            rule: `Use ${corrected_text}.`,
            is_location_specific: false,
            location: 'All properties (global rule)',
        }));

        const result = runPreAiDeterministicChecks([
            'maldon salt 8',
            'Maldon salt 9',
            'marcona almonds 10',
            'reggiano cheese 11',
            'REGGIANO cheese 12',
        ].join('\n'), { acceptedCorrectionRules: rules });

        expect(result.menuText).toBe([
            'Maldon salt 8',
            'Maldon salt 9',
            'Marcona almonds 10',
            'Reggiano cheese 11',
            'Reggiano cheese 12',
        ].join('\n'));
    });

    it('keeps source-casing preservation when accepted diacritic rules opt out', () => {
        const rules: AcceptedCorrectionRule[] = [
            ['gruyere', 'gruyère'],
            ['puree', 'purée'],
            ['entree', 'entrée'],
            ['crudite', 'crudité'],
        ].map(([original_text, corrected_text]) => ({
            id: `canonical-diacritic-case-${original_text}`,
            status: 'accepted',
            source: 'system',
            original_text,
            corrected_text,
            force_target_case: false,
            change_type: 'diacritic',
            rule: `Use ${corrected_text}.`,
            is_location_specific: false,
            location: 'All properties (global rule)',
        }));

        const result = runPreAiDeterministicChecks([
            'GRUYERE 8',
            'PUREE 9',
            'ENTREE 10',
            'CRUDITE 11',
        ].join('\n'), { acceptedCorrectionRules: rules });

        expect(result.menuText).toBe([
            'GRUYÈRE 8',
            'PURÉE 9',
            'ENTRÉE 10',
            'CRUDITÉ 11',
        ].join('\n'));
    });

    it('never applies context-dependent learned rules as blind replacements', () => {
        const rules: AcceptedCorrectionRule[] = [
            {
                id: 'rule-berry',
                status: 'accepted',
                source: 'human',
                original_text: 'berry',
                corrected_text: 'berries',
                change_type: 'spelling',
                rule: "Just 'berry' implies mixed berries and should be plural.",
                is_location_specific: false,
                location: 'All properties (global rule)',
            },
            {
                id: 'rule-tartare',
                status: 'accepted',
                source: 'human',
                original_text: 'poblano tartare',
                corrected_text: 'poblano tartar',
                change_type: 'terminology',
                rule: 'This is the sauce, not the raw preparation.',
                is_location_specific: false,
                location: 'All properties (global rule)',
            },
        ];

        // "berry compote" must stay singular; "tartare" must stay raw — a global
        // find/replace would corrupt both, so neither rule is even considered.
        const result = runPreAiDeterministicChecks(
            'Berry compote 8\nBeef tartare crostini 18',
            { acceptedCorrectionRules: rules }
        );

        expect(result.learnedRulesConsidered).toBe(0);
        expect(result.learnedRulesApplied).toBe(0);
        // The context-dependent terms are left exactly as submitted.
        expect(result.menuText).toContain('Berry compote');
        expect(result.menuText).not.toMatch(/berries/i);
        expect(result.menuText).toContain('tartare');
        expect(result.menuText).not.toMatch(/\btartar\b/i);
    });

    it('classifies tartare to tartar accepted rules as context guidance only', () => {
        const rule: AcceptedCorrectionRule = {
            id: 'rule-tartare',
            status: 'accepted',
            source: 'human',
            original_text: 'poblano tartare',
            corrected_text: 'poblano tartar',
            change_type: 'terminology',
            rule: 'tartar sauce',
            is_location_specific: false,
            location: 'All properties (global rule)',
        };

        expect(getAcceptedCorrectionRulePreAiEligibility(rule)).toEqual({
            eligible: false,
            reason: 'context_dependent',
            contextTerm: 'tartare',
        });
    });

    it('does not duplicate append-style learned rules already satisfied by curated guards', () => {
        const rules: AcceptedCorrectionRule[] = [{
            id: 'rule-tres-leches',
            status: 'accepted',
            source: 'human',
            original_text: 'TORO TORO TRES LECHES D,E,G,TN',
            corrected_text: 'TORO TORO TRES LECHES D,E,G,TN,V',
            change_type: null,
            rule: 'Tres Leches always needs a vegetarian symbol "V".',
            is_location_specific: false,
            location: 'All properties (global rule)',
        }];

        const result = runPreAiDeterministicChecks(
            'TORO TORO TRES LECHES D,E,G,TN',
            { acceptedCorrectionRules: rules }
        );

        expect(result.menuText).toBe('TORO TORO TRES LECHES D,E,G,TN,V');
        expect(result.appliedCorrections.filter((correction) =>
            correction.ruleId === 'rule-tres-leches'
        )).toHaveLength(0);
        expect(result.learnedRulesConsidered).toBe(1);
        expect(result.learnedRulesApplied).toBe(0);
    });

    it('only applies location-specific learned rules to matching properties', () => {
        const rules: AcceptedCorrectionRule[] = [{
            id: 'rule-location',
            status: 'accepted',
            source: 'human',
            original_text: 'tomatillo salsa',
            corrected_text: 'tomatillo sauce',
            change_type: 'terminology',
            rule: 'Denver uses sauce naming for this item.',
            is_location_specific: true,
            location: 'Toro Denver',
            other_applicable_locations: ['Toro Chicago'],
        }];

        expect(runPreAiDeterministicChecks(
            'Fish, tomatillo salsa 22',
            { property: 'Toro Denver', acceptedCorrectionRules: rules }
        ).menuText).toBe('Fish, tomatillo sauce 22');

        expect(runPreAiDeterministicChecks(
            'Fish, tomatillo salsa 22',
            { property: 'Toro Miami', acceptedCorrectionRules: rules }
        ).menuText).toBe('Fish, tomatillo salsa 22');
    });

    it('only applies menu-scoped learned rules to matching template types', () => {
        const rules: AcceptedCorrectionRule[] = [{
            id: 'rule-beverage',
            status: 'accepted',
            source: 'human',
            original_text: 'zero proof',
            corrected_text: 'zero-proof',
            change_type: 'punctuation',
            rule: 'Beverage menus hyphenate zero-proof.',
            applies_to_menu_type: 'beverage',
            is_location_specific: false,
            location: 'All properties (global rule)',
        }];

        expect(runPreAiDeterministicChecks(
            'zero proof margarita 13',
            { templateType: 'food', acceptedCorrectionRules: rules }
        ).menuText).toBe('zero proof margarita 13');

        expect(runPreAiDeterministicChecks(
            'zero proof margarita 13',
            { templateType: 'beverage', acceptedCorrectionRules: rules }
        ).menuText).toBe('zero-proof margarita 13');

        expect(runPreAiDeterministicChecks(
            'zero proof margarita 13',
            { templateType: 'food_beverage', acceptedCorrectionRules: rules }
        ).menuText).toBe('zero-proof margarita 13');
    });

    it('generalizes the three descriptor corrections only in confident contextual constructions', () => {
        const input = [
            'Achiote Grilled Chicken D,G,S 29',
            'Mesquite Grilled Shrimp 24',
            'Cast Iron Pancakes D,G 18',
            'Cast Iron Chicken D 22',
            'Holiday Ham, brûlée pineapple D 20',
            'Roasted Carrots, brûlée banana V 12',
            'Freshly Grilled Chicken 18',
            'Chicken, Achiote Grilled, sauce 20',
            'Cast Iron, salt 4',
            'Cast Iron Skillet 8',
            'Crème brûlée 14',
            'Brûlée Cheesecake 16',
            'Pineapple brûlée 12',
        ].join('\n');
        const result = runPreAiDeterministicChecks(input);
        expect(result.menuText).toBe([
            'Achiote-Grilled Chicken D,G,S 29',
            'Mesquite-Grilled Shrimp 24',
            'Cast-Iron Pancakes D,G 18',
            'Cast-Iron Chicken D 22',
            'Holiday Ham, brûléed pineapple D 20',
            'Roasted Carrots, brûléed banana V 12',
            'Freshly Grilled Chicken 18',
            'Chicken, Achiote Grilled, sauce 20',
            'Cast Iron, salt 4',
            'Cast Iron Skillet 8',
            'Crème brûlée 14',
            'Brûlée Cheesecake 16',
            'Pineapple brûlée 12',
        ].join('\n'));
        expect(runPreAiDeterministicChecks(result.menuText).menuText).toBe(result.menuText);
        expect(result.appliedCorrections).toEqual(expect.arrayContaining([
            expect.objectContaining({ original: 'Achiote Grilled Chicken', corrected: 'Achiote-Grilled Chicken' }),
            expect.objectContaining({ original: 'Cast Iron Pancakes', corrected: 'Cast-Iron Pancakes' }),
            expect.objectContaining({ original: 'brûlée pineapple', corrected: 'brûléed pineapple' }),
        ]));
    });

    it('ignores pending or broad content learned rules', () => {
        const rules: AcceptedCorrectionRule[] = [
            {
                id: 'pending',
                status: 'pending',
                original_text: 'jalapeno',
                corrected_text: 'jalapeño',
                change_type: 'diacritic',
                rule: 'Pending rule.',
            },
            {
                id: 'content',
                status: 'accepted',
                original_text: 'taco',
                corrected_text: 'taco with added chef note',
                change_type: 'content',
                rule: 'Too broad for deterministic precheck.',
            },
        ];

        const result = runPreAiDeterministicChecks('taco, jalapeno 12', {
            acceptedCorrectionRules: rules,
        });

        expect(result.menuText).toBe('taco, jalapeño 12');
        expect(result.learnedRulesConsidered).toBe(0);
        expect(result.appliedCorrections).toHaveLength(1);
    });
});

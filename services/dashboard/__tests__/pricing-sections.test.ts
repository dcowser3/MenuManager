import { analyzePricingLayout, renderPricingLayoutForPrompt } from '../lib/pricing-sections';
import { dropPrixFixeDishPriceFlags, enforcePrixFixeRegionChecks } from '../lib/review-pipeline';
import { buildFinalPrompt } from '../lib/qa-prompt-builder';
import { tanBottomlessBrunch, aqimeroBrunchDdlm, tanLunchCombined } from '../test-fixtures/pricing-menus';

const missingPrice = (menuItem: string) => ({ type: 'Missing Price', severity: 'critical', confidence: 'high', menuItem, description: 'The dish line does not include an individual price.' });

describe('analyzePricingLayout', () => {
    it('treats a bottomless "68 pp" header as a prix fixe region even when the dropdown says standard', () => {
        const layout = analyzePricingLayout(tanBottomlessBrunch, 'standard');
        expect(layout.hasPrixFixe).toBe(true);
        expect(layout.prixFixeRegions[0].headerLine).toContain('68 pp');
        expect(layout.mismatch).toBe('standard_has_prix_fixe');
    });

    it('finds the prix fixe section after an a la carte section (tán lunch)', () => {
        const layout = analyzePricingLayout(tanLunchCombined, 'combined');
        expect(layout.hasALaCarte).toBe(true);
        expect(layout.prixFixeRegions).toHaveLength(1);
        expect(layout.prixFixeRegions[0].headerLine).toMatch(/Three Course Prix Fixe/i);
        expect(layout.prixFixeRegions[0].startLine).toBeGreaterThan(5);
    });

    it('ends the prix fixe region at Enhancements/Beverages (Aqimero)', () => {
        const lines = aqimeroBrunchDdlm.split('\n');
        const layout = analyzePricingLayout(aqimeroBrunchDdlm, 'prix_fixe');
        const region = layout.prixFixeRegions[0];
        expect(region.headerLine).toMatch(/Includes 4 courses/);
        expect(lines[region.endLine + 1].trim()).toMatch(/^Enhancements$/);
        expect(layout.mismatch).toBe('prix_fixe_has_a_la_carte');
    });

    it('trusts the dropdown when prix fixe is chosen but no header is present', () => {
        const layout = analyzePricingLayout('Starters\nSoup, croutons\nEntrees\nSteak, fries', 'prix_fixe');
        expect(layout.prixFixeRegions).toHaveLength(1);
        expect(layout.prixFixeRegions[0].detected).toBe(false);
    });

    it('does not let a lone "pp" line in a standard menu swallow the dishes', () => {
        const layout = analyzePricingLayout('Tasting add-on 95 pp\nSteak, fries 40\nSalad, greens 12', 'standard');
        expect(layout.hasPrixFixe).toBe(false);
    });
});

describe('prix fixe dish price flags', () => {
    it('drops per-dish Missing Price on a prix fixe menu (tán bottomless brunch regression)', () => {
        const layout = analyzePricingLayout(tanBottomlessBrunch, 'prix_fixe');
        const flags = [missingPrice('Caesar Salad'), missingPrice('Chilaquiles'), missingPrice('Steak & Eggs Rancheros')];
        expect(dropPrixFixeDishPriceFlags(tanBottomlessBrunch, flags, layout)).toEqual([]);
    });

    it('drops the flag even if the menu item is not locatable on a whole-menu prix fixe', () => {
        const text = 'Starters\nSoup, croutons\nEntrees\nSteak, fries';
        const layout = analyzePricingLayout(text, 'prix_fixe');
        expect(dropPrixFixeDishPriceFlags(text, [missingPrice('Entire menu')], layout)).toEqual([]);
    });

    it('keeps Missing Price for a la carte dishes on a combined menu', () => {
        const menu = `${tanLunchCombined}`;
        const layout = analyzePricingLayout(menu, 'combined');
        const kept = dropPrixFixeDishPriceFlags(menu, [missingPrice('Guacamole'), missingPrice('Shrimp Ceviche')], layout);
        expect(kept.map((s) => s.menuItem)).toEqual(['Guacamole']);
    });

    it('keeps Missing Price on Aqimero enhancements/beverages but drops it on prix fixe courses', () => {
        const layout = analyzePricingLayout(aqimeroBrunchDdlm, 'combined');
        const kept = dropPrixFixeDishPriceFlags(aqimeroBrunchDdlm, [
            missingPrice('Parfait'), missingPrice('add spicy crab'),
        ], layout);
        expect(kept.map((s) => s.menuItem)).toEqual(['add spicy crab']);
    });
});

describe('prix fixe region checks', () => {
    it('does not raise "no package price" for tán lunch, where the price is below the a la carte section', () => {
        const layout = analyzePricingLayout(tanLunchCombined, 'combined');
        const stale = [{ type: 'PRICING STRUCTURE', severity: 'critical', menuItem: 'Prix Fixe Menu', description: 'No overall prix-fixe or package price was detected near the top of the menu.' }];
        const out = enforcePrixFixeRegionChecks(tanLunchCombined, stale, layout);
        expect(out.filter((s) => s.type === 'PRICING STRUCTURE')).toEqual([]);
    });

    it('flags a prix fixe section that has a header but no price', () => {
        const menu = 'Guac, lime 12\n----------\nThree Course Prix Fixe\nchoice of one entrada, one plato fuerte and postre\nEntradas\nSoup, croutons';
        const layout = analyzePricingLayout(menu, 'combined');
        const out = enforcePrixFixeRegionChecks(menu, [], layout);
        expect(out.some((s) => s.type === 'PRICING STRUCTURE' && s.severity === 'critical')).toBe(true);
    });
});

describe('prompt', () => {
    it('describes each pricing section to the AI for a combined menu', () => {
        const briefing = renderPricingLayoutForPrompt(tanLunchCombined, analyzePricingLayout(tanLunchCombined, 'combined'), 'combined');
        expect(briefing).toMatch(/PRIX FIXE \/ PACKAGE section/);
        expect(briefing).toMatch(/A LA CARTE section/);
        const { sections } = buildFinalPrompt('base prompt', {
            menuType: 'combined', precheckEnabled: false, embeddedSetMenuAnalysis: { sections: [], issues: [] }, pricingLayoutBriefing: briefing,
        } as any);
        expect(sections).toContain('pricing_sections');
        expect(sections).not.toContain('prix_fixe');
    });
});

describe('real tán bottomless brunch', () => {
    it('yields no pricing-structure or missing-price criticals under any menu type', () => {
        const ai = [missingPrice('Caesar Salad'), missingPrice('Chilaquiles'),
            { type: 'PRICING STRUCTURE', severity: 'critical', menuItem: 'Prix Fixe Menu', description: 'No overall prix-fixe or package price was detected near the top of the menu.' }];
        for (const menuType of ['prix_fixe', 'standard', 'combined']) {
            const layout = analyzePricingLayout(tanBottomlessBrunch, menuType);
            const out = enforcePrixFixeRegionChecks(tanBottomlessBrunch, dropPrixFixeDishPriceFlags(tanBottomlessBrunch, ai, layout), layout);
            expect(out.filter((s) => /price/i.test(s.type || ''))).toEqual([]);
        }
    });
});

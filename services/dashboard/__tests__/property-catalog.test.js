const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadPropertyCatalogModule() {
    const sourcePath = path.join(__dirname, '../lib/property-catalog.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', output)(require, module, module.exports);
    return module.exports;
}

const {
    buildFallbackPropertyCatalog,
    deriveCityCountryFromProperty,
    deriveHotelFromProperty,
    normalizePropertyCatalogRecord,
} = loadPropertyCatalogModule();

describe('dashboard property catalog fallback', () => {
    test('derives city and hotel from canonical property names', () => {
        expect(deriveCityCountryFromProperty('Maya - Le Royal Meridien - Dubai')).toBe('Dubai');
        expect(deriveHotelFromProperty('Maya - Le Royal Meridien - Dubai')).toBe('Le Royal Meridien');
        expect(deriveHotelFromProperty('Maya - New York')).toBe('');
    });

    test('builds a fallback catalog with Maya metadata for deployed form search and matching', () => {
        const catalog = buildFallbackPropertyCatalog();
        const maya = catalog.find((item) => item.name === 'Maya - Le Royal Meridien - Dubai');

        expect(maya).toEqual(expect.objectContaining({
            name: 'Maya - Le Royal Meridien - Dubai',
            city_country: 'Dubai',
            hotel: 'Le Royal Meridien',
            is_active: true,
        }));
    });

    test('keeps dLena Washington DC enabled in the fallback catalog', () => {
        const catalog = buildFallbackPropertyCatalog();

        expect(catalog).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'dLeña - Washington, D.C.',
                city_country: 'Washington, D.C.',
                is_active: true,
            }),
        ]));
    });

    test('normalizes sparse DB records with derived metadata', () => {
        expect(normalizePropertyCatalogRecord({ name: 'Zengo - Le Royal Meridien - Dubai' })).toEqual(expect.objectContaining({
            city_country: 'Dubai',
            hotel: 'Le Royal Meridien',
            sharepoint_service_folders: [],
        }));
    });

    test('preserves normalized menu size defaults from the property seed', () => {
        expect(normalizePropertyCatalogRecord({
            name: 'Test - City',
            menu_size_defaults: [
                { menu_type: 'Beverage', width: 11, height: 8.5, folded: 'Y', crop_marks: 'N', bleed_marks: 'N' },
                { menu_type: '', width: '8.5', height: '11', folded: 'N', crop_marks: 'N', bleed_marks: 'N' },
            ],
        })).toEqual(expect.objectContaining({
            menu_size_defaults: [
                {
                    menu_type: 'Beverage',
                    width: '11',
                    height: '8.5',
                    folded: 'yes',
                    crop_marks: 'no',
                    bleed_marks: 'no',
                },
            ],
        }));
    });
});

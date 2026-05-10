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

    test('normalizes sparse DB records with derived metadata', () => {
        expect(normalizePropertyCatalogRecord({ name: 'Zengo - Le Royal Meridien - Dubai' })).toEqual(expect.objectContaining({
            city_country: 'Dubai',
            hotel: 'Le Royal Meridien',
            sharepoint_service_folders: [],
        }));
    });
});

// Restaurant autocomplete on /approved-menus and /design-approval must offer the
// same DB-backed property list as /form. Regression: both pages read only the
// static config/properties.json, so DB-only properties (e.g. "The Del Mar - The
// Strand - Turks and Caicos") never appeared in the dropdown.
jest.mock('axios', () => ({
    __esModule: true,
    default: {
        post: jest.fn(),
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
    },
}));

jest.mock('child_process', () => ({
    exec: jest.fn((cmd, opts, cb) => {
        if (typeof opts === 'function') {
            cb = opts;
        }
        cb(null, '', '');
    }),
}));

jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    isSupabaseConfigured: jest.fn(() => false),
    extractAndStoreDishes: jest.fn().mockResolvedValue({ added: 0 }),
    logAlert: jest.fn().mockResolvedValue(undefined),
    buildAlertEmailHtml: jest.fn(() => ''),
}));

const axios = require('axios').default;
const { default: app } = require('../index');

// Fictional name so the fallback assertion can never collide with a real
// property that has since been added to config/properties.json.
const DB_ONLY_PROPERTY = 'Test DB-Only Outlet - Test Hotel - Nowhere';
const INACTIVE_PROPERTY = 'Closed Outlet - Nowhere';

function getRouteHandler(method, routePath) {
    const layer = app._router.stack.find(
        (candidate) =>
            candidate.route &&
            candidate.route.path === routePath &&
            candidate.route.methods &&
            candidate.route.methods[method.toLowerCase()]
    );
    if (!layer) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
    }
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function renderedCatalog(routePath) {
    const handler = getRouteHandler('get', routePath);
    const res = { render: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler({ query: {} }, res);
    expect(res.render).toHaveBeenCalled();
    return res.render.mock.calls[0][1].propertyCatalog;
}

describe('restaurant autocomplete catalog', () => {
    beforeEach(() => {
        axios.get.mockReset();
        axios.get.mockImplementation(async (url) => {
            if (`${url}`.endsWith('/properties')) {
                return {
                    data: {
                        catalog: [
                            { name: DB_ONLY_PROPERTY },
                            { name: INACTIVE_PROPERTY, is_active: false },
                        ],
                    },
                };
            }
            return { data: {} };
        });
    });

    test.each(['/approved-menus', '/design-approval'])('%s offers DB-only properties and hides inactive ones', async (routePath) => {
        const catalog = await renderedCatalog(routePath);
        expect(catalog).toContain(DB_ONLY_PROPERTY);
        expect(catalog).not.toContain(INACTIVE_PROPERTY);
    });

    test('/approved-menus falls back to the config catalog when the DB is unreachable', async () => {
        axios.get.mockRejectedValue(new Error('db down'));
        const catalog = await renderedCatalog('/approved-menus');
        expect(Array.isArray(catalog)).toBe(true);
        expect(catalog.length).toBeGreaterThan(0);
        expect(catalog).not.toContain(DB_ONLY_PROPERTY);
    });
});

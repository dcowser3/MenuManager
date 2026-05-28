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

const { default: app } = require('../index');

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

describe('dashboard route aliases', () => {
    test('/dashboard returns visitors to the public welcome dashboard', () => {
        const handler = getRouteHandler('get', '/dashboard');
        const res = { redirect: jest.fn() };

        handler({}, res);

        expect(res.redirect).toHaveBeenCalledWith('/');
    });

    test('/review-queue remains a direct Isabella review queue alias', () => {
        const handler = getRouteHandler('get', '/review-queue');
        const res = { redirect: jest.fn() };

        handler({}, res);

        expect(res.redirect).toHaveBeenCalledWith('/reviews');
    });
});

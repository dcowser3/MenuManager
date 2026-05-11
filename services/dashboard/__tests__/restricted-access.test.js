jest.mock('axios', () => ({
    __esModule: true,
    default: {
        post: jest.fn(),
        get: jest.fn(),
        put: jest.fn(),
    },
}));
jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            mkdir: jest.fn().mockResolvedValue(undefined),
            writeFile: jest.fn().mockResolvedValue(undefined),
            unlink: jest.fn().mockResolvedValue(undefined),
            access: jest.fn().mockRejectedValue(new Error('not found')),
            copyFile: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
            readFile: jest.fn().mockResolvedValue(''),
            readdir: jest.fn().mockResolvedValue([]),
            open: actual.promises.open.bind(actual.promises),
        },
    };
});
jest.mock('child_process', () => ({
    exec: jest.fn((cmd, opts, cb) => {
        if (typeof opts === 'function') {
            cb = opts;
        }
        cb(null, '', '');
    }),
}));
jest.mock('mammoth', () => ({
    extractRawText: jest.fn().mockResolvedValue({ value: 'Guacamole - $12' }),
}));
jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    isSupabaseConfigured: jest.fn(() => false),
    extractAndStoreDishes: jest.fn().mockResolvedValue({ added: 0 }),
    logAlert: jest.fn().mockResolvedValue(undefined),
    buildAlertEmailHtml: jest.fn(() => ''),
}));

const {
    default: app,
    buildRestrictedDashboardCookieValue,
    parseCookieHeader,
    sanitizeRestrictedDashboardNext,
    requireRestrictedDashboardAccess,
    sanitizeStoredFileName,
    sanitizeRichTextHtml,
    sanitizePlainTextInput,
} = require('../index');

function getRouteHandler(method, routePath) {
    const layer = app._router.stack.find(
        (l) =>
            l.route &&
            l.route.path === routePath &&
            l.route.methods &&
            l.route.methods[method.toLowerCase()]
    );
    if (!layer) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
    }
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Restricted dashboard access helpers', () => {
    test('parses cookie header values', () => {
        expect(parseCookieHeader('a=1; mm_restricted_dashboard_access=abc%20123')).toEqual({
            a: '1',
            mm_restricted_dashboard_access: 'abc 123',
        });
    });

    test('sanitizes redirect targets', () => {
        expect(sanitizeRestrictedDashboardNext('/training?tab=recent')).toBe('/training?tab=recent');
        expect(sanitizeRestrictedDashboardNext('https://evil.example')).toBe('/learning');
        expect(sanitizeRestrictedDashboardNext('//evil.example')).toBe('/learning');
        expect(sanitizeRestrictedDashboardNext('/restricted-access')).toBe('/learning');
    });

    test('redirects page requests without access cookie', () => {
        const req = { headers: {}, originalUrl: '/learning/submission/abc', url: '/learning/submission/abc' };
        const res = {
            redirect: jest.fn(),
            status: jest.fn(() => res),
            json: jest.fn(),
        };
        const next = jest.fn();

        requireRestrictedDashboardAccess(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/restricted-access?next=%2Flearning%2Fsubmission%2Fabc');
    });

    test('rejects API requests without access cookie', () => {
        const req = { headers: {}, originalUrl: '/api/learning/correction-rules', url: '/api/learning/correction-rules' };
        const res = {
            redirect: jest.fn(),
            status: jest.fn(function status() { return this; }),
            json: jest.fn(),
        };
        const next = jest.fn();

        requireRestrictedDashboardAccess(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'A valid 4-digit PIN is required to access learning and training tools.',
        });
    });

    test('allows requests with a valid access cookie', () => {
        const req = {
            headers: {
                cookie: `mm_restricted_dashboard_access=${buildRestrictedDashboardCookieValue()}`,
            },
            originalUrl: '/learning',
            url: '/learning',
        };
        const res = {
            redirect: jest.fn(),
            status: jest.fn(() => res),
            json: jest.fn(),
        };
        const next = jest.fn();

        requireRestrictedDashboardAccess(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
    });
});

describe('Restricted access route', () => {
    const postHandler = getRouteHandler('post', '/restricted-access');

    test('accepts the configured PIN and sets an httpOnly cookie', () => {
        const req = {
            body: { pin: '4826', next: '/training' },
            query: {},
        };
        const res = {
            statusCode: 200,
            cookie: jest.fn(function cookie() { return this; }),
            redirect: jest.fn(),
            status(code) {
                this.statusCode = code;
                return this;
            },
            render: jest.fn(),
        };

        postHandler(req, res);

        expect(res.cookie).toHaveBeenCalledWith(
            'mm_restricted_dashboard_access',
            buildRestrictedDashboardCookieValue(),
            expect.objectContaining({
                httpOnly: true,
                sameSite: 'strict',
                path: '/',
            })
        );
        expect(res.redirect).toHaveBeenCalledWith('/training');
    });

    test('rejects an invalid PIN', () => {
        const req = {
            body: { pin: '1111', next: '/training' },
            query: {},
        };
        const res = {
            statusCode: 200,
            cookie: jest.fn(),
            redirect: jest.fn(),
            status(code) {
                this.statusCode = code;
                return this;
            },
            render: jest.fn(),
        };

        postHandler(req, res);

        expect(res.statusCode).toBe(401);
        expect(res.render).toHaveBeenCalledWith(
            'restricted-access',
            expect.objectContaining({
                errorMessage: 'A valid 4-digit PIN is required to access learning and training tools.',
                nextPath: '/training',
            })
        );
    });
});

describe('Public input sanitizers', () => {
    test('sanitizes stored file names', () => {
        expect(sanitizeStoredFileName('../../etc/passwd', 'upload.bin')).toBe('passwd');
        expect(sanitizeStoredFileName('menu?.docx', 'upload.bin')).toBe('menu_.docx');
    });

    test('removes active content from rich HTML', () => {
        const html = '<p onclick="alert(1)">Safe</p><script>alert(2)</script><a href="javascript:alert(3)">Link</a>';
        expect(sanitizeRichTextHtml(html)).toBe('<p>Safe</p><a href="alert(3)">Link</a>');
    });

    test('strips control characters from plain text inputs', () => {
        expect(sanitizePlainTextInput(' Chef\u0000 Name \n', { multiline: true })).toBe('Chef Name');
    });
});

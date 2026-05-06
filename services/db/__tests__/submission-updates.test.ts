jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    getSupabaseClient: jest.fn(),
    isSupabaseConfigured: jest.fn(() => false),
    logAlert: jest.fn(),
    extractAndStoreDishes: jest.fn(),
}));

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    const repoRoot = '/Users/deriancowser/Documents/MenuManager';
    return {
        ...actual,
        existsSync: jest.fn((target: string) => {
            const normalized = String(target);
            return normalized === `${repoRoot}/services` || normalized === `${repoRoot}/samples`;
        }),
        promises: {
            ...actual.promises,
            readFile: jest.fn(),
            writeFile: jest.fn().mockResolvedValue(undefined),
            mkdir: jest.fn().mockResolvedValue(undefined),
            access: jest.fn().mockResolvedValue(undefined),
        },
    };
});

import fs from 'fs';
import app from '../index';
import { sanitizeSubmissionUpdates } from '../lib/submission-updates';

function getRouteHandler(method: string, routePath: string) {
    const layer = (app as any)._router.stack.find(
        (entry: any) =>
            entry.route &&
            entry.route.path === routePath &&
            entry.route.methods &&
            entry.route.methods[method.toLowerCase()]
    );
    if (!layer) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
    }
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function invokeJsonHandler(handler: any, { body = {}, params = {} } = {}) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req: any = { body, params };
        const res: any = {
            statusCode: 200,
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json(payload: any) {
                resolve({ status: this.statusCode || 200, body: payload });
                return this;
            },
            send(payload: any) {
                resolve({ status: this.statusCode || 200, body: payload });
                return this;
            },
        };

        Promise.resolve(handler(req, res)).catch(reject);
    });
}

describe('submission update hardening', () => {
    const updateHandler = getRouteHandler('put', '/submissions/:id');

    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify({
            'form-123': {
                id: 'form-123',
                status: 'pending_human_review',
                final_path: '/Users/deriancowser/Documents/MenuManager/tmp/documents/original.docx',
                submitter_email: 'chef@example.com',
            },
        }));
        (fs.promises.writeFile as jest.Mock).mockClear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('sanitizes allowed approval update fields', async () => {
        const response = await invokeJsonHandler(updateHandler, {
            params: { id: 'form-123' },
            body: {
                status: 'approved',
                final_path: '/Users/deriancowser/Documents/MenuManager/tmp/finals/form-123-final.docx',
                changes_made: true,
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('approved');
        expect(response.body.final_path).toBe('/Users/deriancowser/Documents/MenuManager/tmp/finals/form-123-final.docx');
        expect(response.body.changes_made).toBe(true);
        expect(response.body.submitter_email).toBe('chef@example.com');
        expect(response.body.updated_at).toBeTruthy();
        expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    });

    test('rejects non-allowlisted submission fields', async () => {
        const response = await invokeJsonHandler(updateHandler, {
            params: { id: 'form-123' },
            body: {
                submitter_email: 'attacker@example.com',
                status: 'approved',
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid submission update payload');
        expect(response.body.rejectedFields).toContain('submitter_email');
        expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    test('rejects path updates outside repository tmp', async () => {
        const response = await invokeJsonHandler(updateHandler, {
            params: { id: 'form-123' },
            body: {
                final_path: '/etc/passwd',
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.details).toContain('final_path must stay inside the repository tmp/ directory');
        expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    test('rejects invalid status transitions', async () => {
        const response = await invokeJsonHandler(updateHandler, {
            params: { id: 'form-123' },
            body: {
                status: 'deleted',
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.details[0]).toContain('status must be one of:');
        expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    test('sanitizeSubmissionUpdates does not allow raw_payload updates', () => {
        const result = sanitizeSubmissionUpdates(
            {
                raw_payload: { unsafe: true },
                clickup_task_id: 'cu_123',
            },
            { repoRoot: '/Users/deriancowser/Documents/MenuManager' }
        );

        expect(result.rejectedFields).toContain('raw_payload');
        expect(result.allowedFields.clickup_task_id).toBe('cu_123');
    });
});

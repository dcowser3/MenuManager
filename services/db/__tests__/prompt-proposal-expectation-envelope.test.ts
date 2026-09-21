jest.mock('@menumanager/supabase-client', () => ({
    __esModule: true,
    getSupabaseClient: jest.fn(),
    isSupabaseConfigured: jest.fn(() => true),
    logAlert: jest.fn(),
    extractAndStoreDishes: jest.fn(),
}));

import app from '../index';
import { getSupabaseClient } from '@menumanager/supabase-client';

function handler() {
    const layer = (app as any)._router.stack.find((entry: any) => entry.route?.path === '/prompt-proposals/:id/expectation-envelope' && entry.route.methods?.put);
    if (!layer) throw new Error('expectation envelope route missing');
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
function invoke(body: any) {
    return new Promise<any>((resolve, reject) => Promise.resolve(handler()({ body, params: { id: 'p1' } }, { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(value: any) { resolve({ status: this.statusCode, body: value }); } })).catch(reject));
}
const summary = { code_candidate: { status: 'verified' }, code_verification: { status: 'passed' }, expectation_envelope: { sha256: 'old' } };
const hash = require('crypto').createHash('sha256').update(JSON.stringify(summary)).digest('hex');

test('optimistic envelope merge preserves unrelated eval_summary fields', async () => {
    const update = jest.fn().mockReturnValue({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ok: true }, error: null }) }) }) }) });
    (getSupabaseClient as jest.Mock).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', status: 'approved', eval_summary: summary }, error: null }) }) }), update }) });
    const result = await invoke({ expected_eval_summary_hash: hash, expectation_envelope: { sha256: 'new' } });
    expect(result.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ eval_summary: { ...summary, expectation_envelope: { sha256: 'new' } } });
});

test('stale summary fails before update', async () => {
    const update = jest.fn();
    (getSupabaseClient as jest.Mock).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', status: 'approved', eval_summary: summary }, error: null }) }) }), update }) });
    const result = await invoke({ expected_eval_summary_hash: 'stale', expectation_envelope: { sha256: 'new' } });
    expect(result.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
});

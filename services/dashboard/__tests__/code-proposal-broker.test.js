const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ModelBudgetBroker, canonicalHash, redact, validateAuthorization } = require('../../../scripts/lib/code-proposal-broker');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const HASH = 'a'.repeat(64);
function fixture(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-c2b-broker-'));
    const scope = { attemptId: 'attempt-one', runId: 'attempt-one', parentCampaignSha256: HASH, proposalSha256: 'b'.repeat(64), promptSha256: 'c'.repeat(64), rulesSha256: 'd'.repeat(64), datasetSha256: 'e'.repeat(64), sourceSha256: 'f'.repeat(64), behaviorSha256: '1'.repeat(64), outputRoot: root };
    const authorization = { schemaVersion: 1, authorizationId: 'code-auth', ledgerId: 'code-ledger', stage: 'code-candidate', status: 'active', provider: 'openai', mode: 'synthetic', model: 'gpt-5.6-sol', issuedAt: new Date(Date.now() - 1000).toISOString(), runDeadline: new Date(Date.now() + 3600000).toISOString(), expiresAt: new Date(Date.now() + 7200000).toISOString(), runRoot: root, ledgerRelativePath: 'budget-state.json', scope, stageLimits: { usd: 1, requests: 1, inputTokens: 1000, completionTokens: 100 }, cumulativeLimits: { usd: 1, requests: 1, inputTokens: 1000, completionTokens: 100 }, requestLimits: { inputTokens: 1000, completionTokens: 100, timeoutMs: 1000 }, pricing: { inputUsdPerMillion: 4, outputUsdPerMillion: 20 }, requestSchedule: [{ requestId: 'attempt-one:draft:1:transport:1', bodySha256: digest(JSON.stringify(body())), inputTokens: 10, completionTokens: 100 }], ...overrides };
    const authFile = path.join(root, 'authorization.json'); const stateFile = path.join(root, 'budget-state.json');
    fs.writeFileSync(authFile, `${JSON.stringify(authorization)}\n`, { mode: 0o600 });
    const authorizationHash = digest(fs.readFileSync(authFile));
    fs.writeFileSync(stateFile, `${JSON.stringify({ schemaVersion: 1, authorizationId: authorization.authorizationId, authorizationHash, scopeHash: canonicalHash(scope), requests: {}, totals: { usd: 0, requests: 0, inputTokens: 0, completionTokens: 0 } })}\n`, { mode: 0o600 });
    return { root, authorization, authFile, stateFile, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function body(model = 'gpt-5.6-sol') { return { model, messages: [{ role: 'user', content: 'draft this bounded patch' }], response_format: { type: 'json_object' }, max_completion_tokens: 100 }; }

test.each([
    ['missing authorization', { authorizationFile: null }, /Explicit code-candidate authorization/],
    ['terminal authorization', { terminal: true }, /terminal/],
    ['wrong stage', { stage: 'fixed-candidate' }, /wrong-stage/],
    ['expired authorization', { expiresAt: new Date(Date.now() - 1).toISOString() }, /expired/],
    ['missing status', { status: undefined }, /terminal/],
    ['revoked status', { status: 'revoked' }, /terminal/],
    ['completed status', { status: 'completed' }, /terminal/],
])('rejects %s before any transport', (_label, override, error) => {
    const state = fixture(override);
    try {
        let calls = 0;
        if (override.authorizationFile === null) expect(() => new ModelBudgetBroker({ authorizationFile: null, stateFile: state.stateFile, outputRoot: state.root, transport: () => { calls += 1; } })).toThrow(error);
        else expect(() => new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, transport: () => { calls += 1; } })).toThrow(error);
        expect(calls).toBe(0);
    } finally { state.cleanup(); }
});

test('constructor validates canonical scope and does not call the provider', () => {
    const state = fixture();
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, transport: () => { throw new Error('must not call'); } });
        expect(broker.summary().stage.requests).toBe(0);
    } finally { state.cleanup(); }
});

test('rejects a noncanonical ledger location and authorization mutation before reservation', async () => {
    const state = fixture();
    try {
        const alternate = path.join(state.root, 'alternate-state.json'); fs.copyFileSync(state.stateFile, alternate);
        expect(() => new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: alternate, outputRoot: state.root })).toThrow(/ledger path/);
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10 });
        const altered = { ...state.authorization, model: 'gpt-5.6-luna' }; fs.writeFileSync(state.authFile, `${JSON.stringify(altered)}\n`, { mode: 0o600 });
        await expect(broker.reserve('attempt-one:draft:1:transport:1', broker.authorization.endpoint, body())).rejects.toThrow(/authorization changed/);
    } finally { state.cleanup(); }
});

test.each([
    ['wrong endpoint', 'https://example.test', body(), /differs/],
    ['wrong model', 'https://api.openai.com/v1/chat/completions', body('gpt-5.6-luna'), /differs/],
    ['extra setting', 'https://api.openai.com/v1/chat/completions', { ...body(), temperature: 0 }, /bounded/],
    ['wrong completion cap', 'https://api.openai.com/v1/chat/completions', { ...body(), max_completion_tokens: 99 }, /bounded/],
])('rejects %s before reservation', async (_label, endpoint, request, error) => {
    const state = fixture();
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10, transport: () => { throw new Error('must not call'); } });
        await expect(broker.reserve('attempt-one:draft:1:transport:1', endpoint, request)).rejects.toThrow(error);
        expect(JSON.parse(fs.readFileSync(state.stateFile)).requests).toEqual({});
    } finally { state.cleanup(); }
});

test('successful injected dispatch settles once and binds exact request identity', async () => {
    const state = fixture(); let calls = 0;
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10, transport: async (request) => { calls += 1; expect(request.requestId).toBe('attempt-one:draft:1:transport:1'); return { status: 200, body: JSON.stringify({ model: state.authorization.model, choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }) }; } });
        const result = await broker.dispatch({ requestId: 'attempt-one:draft:1:transport:1', endpoint: broker.authorization.endpoint, body: body() });
        expect(result.accountingStatus).toBe('completed'); expect(calls).toBe(1); expect(broker.requestStatus(result.requestId)).toBe('completed');
        await expect(broker.dispatch({ requestId: result.requestId, endpoint: broker.authorization.endpoint, body: body() })).rejects.toThrow(/redispatch/);
    } finally { state.cleanup(); }
});

test('rechecks authorization deadline after broker construction', async () => {
    const state = fixture(); let now = Date.now();
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, now: () => now, countInputTokens: () => 10 });
        now = Date.parse(state.authorization.runDeadline) + 1;
        await expect(broker.reserve('attempt-one:draft:1:transport:1', broker.authorization.endpoint, body())).rejects.toThrow(/expired/);
    } finally { state.cleanup(); }
});

test.each([
    ['transport failure', async () => { throw new Error('secret transport detail'); }, /secret transport detail/],
    ['incomplete usage', async () => ({ status: 200, body: JSON.stringify({ model: 'gpt-5.6-sol', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }) }), /incomplete/],
])('retains a conservative ambiguous reservation on %s', async (_label, transport, error) => {
    const state = fixture();
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10 });
        if (_label === 'incomplete usage') {
            const result = await broker.dispatch({ requestId: 'attempt-one:draft:1:transport:1', endpoint: broker.authorization.endpoint, body: body(), transport });
            expect(result.accountingStatus).toBe('ambiguous');
        } else await expect(broker.dispatch({ requestId: 'attempt-one:draft:1:transport:1', endpoint: broker.authorization.endpoint, body: body(), transport })).rejects.toThrow(error);
        expect(broker.requestStatus('attempt-one:draft:1:transport:1')).toBe('ambiguous');
        expect(broker.summary().stage.requests).toBe(1);
    } finally { state.cleanup(); }
});

test.each([
    ['negative reasoning', { completion_tokens_details: { reasoning_tokens: -1 } }],
    ['non-integer reasoning', { completion_tokens_details: { reasoning_tokens: 'not-a-number' } }],
])('retains an ambiguous reservation for invalid %s usage', async (_label, usage) => {
    const state = fixture();
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10 });
        const result = await broker.dispatch({ requestId: 'attempt-one:draft:1:transport:1', endpoint: broker.authorization.endpoint, body: body(), transport: async () => ({ status: 200, body: JSON.stringify({ model: state.authorization.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, ...usage } }) }) });
        expect(result.accountingStatus).toBe('ambiguous');
    } finally { state.cleanup(); }
});

test.each([
    ['discounted reservation', (request) => { request.reservedUsd = 0; }],
    ['negative completed usage', (request) => { request.status = 'completed'; request.actualInputTokens = -1; request.actualCompletionTokens = 1; request.reasoningTokens = 0; request.actualUsd = 0; }],
    ['unscheduled request', (request, state) => { request.requestId = 'not-scheduled'; state.requests['not-scheduled'] = request; delete state.requests['attempt-one:draft:1:transport:1']; }],
])('rejects tampered ledger %s', async (_label, mutate) => {
    const state = fixture();
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10 });
        await broker.reserve('attempt-one:draft:1:transport:1', broker.authorization.endpoint, body());
        const ledger = JSON.parse(fs.readFileSync(state.stateFile, 'utf8'));
        const request = ledger.requests['attempt-one:draft:1:transport:1']; mutate(request, ledger); fs.writeFileSync(state.stateFile, `${JSON.stringify(ledger)}\n`, { mode: 0o600 });
        expect(() => new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10 })).toThrow(/ledger/);
    } finally { state.cleanup(); }
});

test('broker timeout marks an injected hung transport ambiguous', async () => {
    const state = fixture({ requestLimits: { inputTokens: 1000, completionTokens: 100, timeoutMs: 10 } });
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10 });
        await expect(broker.dispatch({ requestId: 'attempt-one:draft:1:transport:1', endpoint: broker.authorization.endpoint, body: body(), transport: () => new Promise(() => {}) })).rejects.toThrow(/timed out/);
        expect(broker.requestStatus('attempt-one:draft:1:transport:1')).toBe('ambiguous');
    } finally { state.cleanup(); }
});

test('rejects a response whose UTF-8 byte bound exceeds the cap', async () => {
    const state = fixture();
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10 });
        const oversized = JSON.stringify({ content: 'é'.repeat(110001) });
        await expect(broker.dispatch({ requestId: 'attempt-one:draft:1:transport:1', endpoint: broker.authorization.endpoint, body: body(), transport: async () => ({ status: 200, body: oversized }) })).rejects.toThrow(/oversized/);
        expect(broker.requestStatus('attempt-one:draft:1:transport:1')).toBe('ambiguous');
    } finally { state.cleanup(); }
});

test('scheduled authorization permits a finite second identity and rejects unscheduled retries', async () => {
    const first = body(); const second = { ...first, messages: [{ role: 'user', content: 'second bounded draft' }] };
    const schedule = [first, second].map((request, index) => ({ requestId: `attempt-one:draft:${index + 1}:transport:1`, bodySha256: digest(JSON.stringify(request)), inputTokens: 10, completionTokens: 100 }));
    const state = fixture({ stageLimits: { usd: 1, requests: 2, inputTokens: 1000, completionTokens: 200 }, cumulativeLimits: { usd: 1, requests: 2, inputTokens: 1000, completionTokens: 200 }, requestSchedule: schedule });
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10 });
        const transport = async () => ({ status: 200, body: JSON.stringify({ model: state.authorization.model, choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1 } }) });
        await broker.dispatch({ requestId: schedule[0].requestId, endpoint: broker.authorization.endpoint, body: first, transport });
        await broker.dispatch({ requestId: schedule[1].requestId, endpoint: broker.authorization.endpoint, body: second, transport });
        await expect(broker.dispatch({ requestId: 'attempt-one:draft:3:transport:1', endpoint: broker.authorization.endpoint, body: first, transport })).rejects.toThrow(/not explicitly authorized/);
    } finally { state.cleanup(); }
});

test('redacts credential-like values without exposing them', () => {
    expect(redact('failure custom-service-secret-value', ['custom-service-secret-value'])).toBe('failure [REDACTED]');
});

test('real authorization has an isolated selector and pinned pricing floor', () => {
    const state = fixture();
    try {
        const real = { ...state.authorization, mode: 'real', pricing: { inputUsdPerMillion: 0.001, cacheWriteInputUsdPerMillion: 0.001, inputReservationUsdPerMillion: 0.001, outputUsdPerMillion: 0.001 } };
        expect(() => validateAuthorization(real, { env: { CODE_CANDIDATE_AUTHORIZATION_ID: real.authorizationId } })).toThrow(/pricing/);
        const valid = { ...real, pricing: { inputUsdPerMillion: 4, cacheWriteInputUsdPerMillion: 5, inputReservationUsdPerMillion: 5, outputUsdPerMillion: 20 } };
        expect(() => validateAuthorization(valid, { env: { REVIEW_EVAL_AUTHORIZATION_ID: valid.authorizationId } })).toThrow(/selected/);
    } finally { state.cleanup(); }
});

test('synthetic authorization rejects provider credentials before reservation', async () => {
    const state = fixture();
    try {
        const broker = new ModelBudgetBroker({ authorizationFile: state.authFile, stateFile: state.stateFile, outputRoot: state.root, countInputTokens: () => 10, transport: async () => ({ status: 200 }) });
        await expect(broker.dispatch({ requestId: 'attempt-one:draft:1:transport:1', endpoint: broker.authorization.endpoint, body: body(), apiKey: 'must-not-be-used' })).rejects.toThrow(/cannot receive provider credentials/);
        expect(broker.summary().stage.requests).toBe(0);
    } finally { state.cleanup(); }
});

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DIGEST = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const MAX_BODY = 220000;
const MAX_RESPONSE = 220000;
const LOCK_WAIT_MS = 10;
const LOCK_ATTEMPTS = 50;
const CODE_AUTH_ENV = 'CODE_CANDIDATE_AUTHORIZATION_ID';
const MODEL_PRICING_FLOORS = Object.freeze({
    'gpt-5.6-luna': { inputUsdPerMillion: 0.20, cacheWriteInputUsdPerMillion: 0.25, inputReservationUsdPerMillion: 0.25, outputUsdPerMillion: 1.20 },
    'gpt-5.6-sol': { inputUsdPerMillion: 4.00, cacheWriteInputUsdPerMillion: 5.00, inputReservationUsdPerMillion: 5.00, outputUsdPerMillion: 20.00 },
});

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const canonicalHash = (value) => sha256(Buffer.from(JSON.stringify(canonical(value))));
const safeName = (value) => typeof value === 'string' && NAME.test(value);
const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const inside = (root, target) => {
    const r = path.resolve(root), t = path.resolve(target);
    if (t !== r && !t.startsWith(`${r}${path.sep}`)) throw new Error('Path is outside the authorized broker root.');
    const stat = fs.lstatSync(r);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Authorized broker root must be a real directory.');
    let cursor = r;
    for (const part of path.relative(r, t).split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Broker path cannot traverse a symlink.');
    }
    return t;
};

function redact(value, secrets = []) {
    let clean = String(value || '');
    for (const secret of secrets.filter((entry) => typeof entry === 'string' && entry.length >= 4)) clean = clean.split(secret).join('[REDACTED]');
    return clean.replace(/\b(?:sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTED]');
}

function limits(value, label) {
    if (!value || !finitePositive(value.usd) || !Number.isInteger(value.requests) || value.requests <= 0
        || !Number.isInteger(value.inputTokens) || value.inputTokens <= 0
        || !Number.isInteger(value.completionTokens) || value.completionTokens <= 0) throw new Error(`${label} limits are incomplete.`);
    return { usd: Number(value.usd), requests: value.requests, inputTokens: value.inputTokens, completionTokens: value.completionTokens };
}

function validatePricing(raw, model, mode) {
    const pricing = raw?.pricing;
    if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) throw new Error('Code-candidate authorization pricing is missing.');
    const allowed = mode === 'real' ? ['cacheWriteInputUsdPerMillion', 'inputReservationUsdPerMillion', 'inputUsdPerMillion', 'outputUsdPerMillion'] : ['inputUsdPerMillion', 'outputUsdPerMillion'];
    if (Object.keys(pricing).some((key) => !allowed.includes(key)) || allowed.some((key) => !finitePositive(pricing[key]))) throw new Error('Code-candidate authorization pricing is incomplete or has unknown fields.');
    const floors = MODEL_PRICING_FLOORS[model];
    if (mode === 'real' && (!floors || allowed.some((key) => pricing[key] < floors[key]))) throw new Error('Code-candidate authorization pricing is below the pinned model floor.');
    return Object.freeze(Object.fromEntries(allowed.map((key) => [key, Number(pricing[key])] )));
}

function validateAuthorization(raw, options = {}) {
    const now = options.now || Date.now();
    if (!raw || raw.schemaVersion !== 1 || raw.stage !== 'code-candidate' || raw.provider !== 'openai'
        || !safeName(raw.authorizationId) || !safeName(raw.ledgerId) || !safeName(raw.model)
        || raw.terminal === true || !['active', 'authorized'].includes(raw.status)) {
        throw new Error('Code-candidate authorization is missing, terminal, or wrong-stage.');
    }
    if (!['synthetic', 'real'].includes(raw.mode)) throw new Error('Code-candidate authorization mode is invalid.');
    const issued = Date.parse(raw.issuedAt || ''), deadline = Date.parse(raw.runDeadline || ''), expires = Date.parse(raw.expiresAt || '');
    if (![issued, deadline, expires].every(Number.isFinite) || issued > now + 300000 || deadline <= now || expires <= now || deadline > expires) throw new Error('Code-candidate authorization is expired or has an invalid deadline.');
    if (!path.isAbsolute(raw.runRoot || '') || typeof raw.ledgerRelativePath !== 'string' || path.isAbsolute(raw.ledgerRelativePath) || raw.ledgerRelativePath.split(/[\\/]/).includes('..')) throw new Error('Code-candidate authorization has an unsafe ledger root.');
    const scope = raw.scope;
    const digestFields = ['parentCampaignSha256', 'proposalSha256', 'promptSha256', 'rulesSha256', 'datasetSha256', 'sourceSha256', 'behaviorSha256'];
    if (!scope || digestFields.some((field) => !DIGEST.test(scope[field] || '')) || !path.isAbsolute(scope.outputRoot || '')
        || !safeName(scope.attemptId) || !safeName(scope.runId || scope.attemptId)) throw new Error('Code-candidate authorization scope is incomplete.');
    const stageLimits = limits(raw.stageLimits, 'Stage');
    const cumulativeLimits = limits(raw.cumulativeLimits, 'Cumulative');
    if (stageLimits.usd > cumulativeLimits.usd || stageLimits.requests > cumulativeLimits.requests || stageLimits.inputTokens > cumulativeLimits.inputTokens || stageLimits.completionTokens > cumulativeLimits.completionTokens) throw new Error('Stage limits exceed cumulative limits.');
    const requestLimits = raw.requestLimits;
    if (!requestLimits || !Number.isInteger(requestLimits.inputTokens) || requestLimits.inputTokens <= 0 || requestLimits.inputTokens > 272000
        || !Number.isInteger(requestLimits.completionTokens) || requestLimits.completionTokens <= 0 || !Number.isInteger(requestLimits.timeoutMs) || requestLimits.timeoutMs <= 0 || requestLimits.timeoutMs > 180000) throw new Error('Request limits are incomplete or unbounded.');
    if (!Array.isArray(raw.requestSchedule) || raw.requestSchedule.length !== stageLimits.requests) throw new Error('Every finite code-candidate request must be explicitly scheduled.');
    const schedule = raw.requestSchedule;
    const seen = new Set();
    schedule.forEach((entry) => {
        if (!entry || !safeName(entry.requestId) || seen.has(entry.requestId) || !DIGEST.test(entry.bodySha256 || '') || !Number.isInteger(entry.inputTokens) || entry.inputTokens <= 0 || !Number.isInteger(entry.completionTokens) || entry.completionTokens <= 0) throw new Error('Code-candidate request schedule is incomplete or duplicated.');
        seen.add(entry.requestId);
    });
    if (schedule.length > cumulativeLimits.requests) throw new Error('Request schedule exceeds the cumulative request cap.');
    const pricing = validatePricing(raw, raw.model, raw.mode);
    if (raw.mode === 'real' && raw.model === 'gpt-5.6-sol' && raw.reasoningEffort !== 'medium') throw new Error('Real gpt-5.6-sol authorization must pin reasoning effort medium.');
    if (raw.mode === 'real' && options.env?.[CODE_AUTH_ENV] !== raw.authorizationId) throw new Error('Real code-candidate authorization is not selected by the code-candidate environment.');
    return Object.freeze({ ...raw, scope: Object.freeze({ ...scope }), stageLimits, cumulativeLimits,
        requestLimits: { inputTokens: requestLimits.inputTokens, completionTokens: requestLimits.completionTokens, timeoutMs: requestLimits.timeoutMs }, pricing,
        endpoint: ENDPOINT, requestSchedule: Object.freeze(schedule.map((entry) => Object.freeze({ ...entry }))) });
}

function usageFrom(response) {
    const usage = response?.usage;
    const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
    const completionTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
    const rawReasoning = usage?.completion_tokens_details?.reasoning_tokens;
    const reasoningTokens = rawReasoning === undefined ? 0 : Number(rawReasoning);
    return Number.isInteger(inputTokens) && inputTokens >= 0 && Number.isInteger(completionTokens) && completionTokens >= 0
        && Number.isInteger(reasoningTokens) && reasoningTokens >= 0 && reasoningTokens <= completionTokens
        ? { inputTokens, completionTokens, reasoningTokens } : null;
}

function charge(inputTokens, completionTokens, pricing = {}) {
    const input = Number(pricing.inputReservationUsdPerMillion || pricing.inputUsdPerMillion || 0.25), output = Number(pricing.outputUsdPerMillion || 1.2);
    return (inputTokens * input + completionTokens * output) / 1e6;
}

function summarize(state) {
    return Object.values(state.requests || {}).reduce((total, request) => {
        const usd = request.status === 'completed' && Number.isFinite(request.actualUsd) ? request.actualUsd : request.reservedUsd;
        total.usd += usd; total.requests += 1; total.inputTokens += request.status === 'completed' ? request.actualInputTokens : request.reservedInputTokens;
        total.completionTokens += request.status === 'completed' ? request.actualCompletionTokens : request.reservedCompletionTokens;
        return total;
    }, { usd: 0, requests: 0, inputTokens: 0, completionTokens: 0 });
}

function atomicWrite(file, value) {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const descriptor = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temp, file); fs.chmodSync(file, 0o600);
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function atomicWriteBytes(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(file), 0o700);
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const descriptor = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.chmodSync(temp, 0o600); fs.renameSync(temp, file); fs.chmodSync(file, 0o600);
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

class ModelBudgetBroker {
    constructor(options = {}) {
        if (!options.authorizationFile || !options.stateFile || !options.outputRoot) throw new Error('Explicit code-candidate authorization, ledger, and output root are required.');
        this.outputRoot = path.resolve(options.outputRoot);
        this.authorizationFile = inside(this.outputRoot, options.authorizationFile);
        this.stateFile = inside(this.outputRoot, options.stateFile);
        for (const [file, label] of [[this.authorizationFile, 'Authorization'], [this.stateFile, 'Budget state']]) {
            const stat = fs.lstatSync(file);
            if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error(`${label} must be a regular mode-0600 file.`);
        }
        this.env = options.env || process.env; this.now = options.now || (() => Date.now());
        const bytes = fs.readFileSync(this.authorizationFile); this.authorizationHash = sha256(bytes);
        this.authorization = validateAuthorization(JSON.parse(bytes), { env: this.env, now: this.now() });
        if (path.resolve(this.authorization.runRoot) !== this.outputRoot || path.resolve(this.authorization.scope.outputRoot) !== this.outputRoot) throw new Error('Authorization output root is not canonical.');
        if (path.resolve(path.join(this.outputRoot, this.authorization.ledgerRelativePath)) !== this.stateFile) throw new Error('Budget state path is not the authorization ledger path.');
        if (this.authorization.scope.attemptId !== this.authorization.scope.runId && this.authorization.scope.runId !== undefined) throw new Error('Authorization run and attempt identities differ.');
        this.scopeHash = canonicalHash(this.authorization.scope);
        this.transport = options.transport;
        this.afterResponseArtifact = options.afterResponseArtifact;
        this.afterSettlement = options.afterSettlement;
        this.countInputTokens = options.countInputTokens || ((body) => Buffer.byteLength(JSON.stringify(body), 'utf8') + 64);
        this.lockFile = `${this.stateFile}.lock`;
        this.loadState();
    }

    withLock(operation) {
        let descriptor;
        for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
            try { descriptor = fs.openSync(this.lockFile, 'wx', 0o600); break; }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                try { if (this.now() - fs.statSync(this.lockFile).mtimeMs > 30000) fs.unlinkSync(this.lockFile); }
                catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
                const until = Date.now() + LOCK_WAIT_MS;
                while (Date.now() < until) { /* bounded lock backoff */ }
            }
        }
        if (descriptor === undefined) throw new Error('Code-candidate ledger lock timeout.');
        try { return operation(); }
        finally { try { fs.closeSync(descriptor); } finally { try { fs.unlinkSync(this.lockFile); } catch { /* owned lock cleanup */ } } }
    }

    loadState() {
        if (!fs.existsSync(this.stateFile)) throw new Error('Canonical code-candidate ledger is missing; allowance cannot be recreated.');
        const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        if (state.schemaVersion !== 1 || state.authorizationId !== this.authorization.authorizationId || state.authorizationHash !== this.authorizationHash
            || state.scopeHash !== this.scopeHash || !state.requests || !state.totals) throw new Error('Code-candidate ledger identity is invalid.');
        for (const [requestId, request] of Object.entries(state.requests)) {
            const scheduled = this.authorization.requestSchedule.find((entry) => entry.requestId === requestId);
            if (!request || request.requestId !== requestId || request.authorizationId !== this.authorization.authorizationId || request.authorizationHash !== this.authorizationHash
                || request.scopeHash !== this.scopeHash || request.stage !== this.authorization.stage || request.provider !== this.authorization.provider || request.model !== this.authorization.model
                || !['reserved', 'completed', 'ambiguous'].includes(request.status) || !Number.isFinite(request.reservedUsd)
                || !Number.isInteger(request.reservedInputTokens) || request.reservedInputTokens <= 0 || !Number.isInteger(request.reservedCompletionTokens) || request.reservedCompletionTokens <= 0
                || !DIGEST.test(request.requestHash || '') || !DIGEST.test(request.bodySha256 || '') || !scheduled
                || request.bodySha256 !== scheduled.bodySha256 || request.reservedInputTokens !== scheduled.inputTokens
                || request.reservedCompletionTokens !== scheduled.completionTokens
                || Math.abs(request.reservedUsd - charge(request.reservedInputTokens, request.reservedCompletionTokens, this.authorization.pricing)) > 1e-12) throw new Error(`Code-candidate ledger request identity is invalid: ${requestId}.`);
            if (request.status === 'completed' && (!Number.isInteger(request.actualInputTokens) || request.actualInputTokens < 0 || request.actualInputTokens > request.reservedInputTokens
                || !Number.isInteger(request.actualCompletionTokens) || request.actualCompletionTokens < 0 || request.actualCompletionTokens > request.reservedCompletionTokens
                || !Number.isInteger(request.reasoningTokens) || request.reasoningTokens < 0 || request.reasoningTokens > request.actualCompletionTokens
                || !Number.isFinite(request.actualUsd) || request.actualUsd < 0
                || Math.abs(request.actualUsd - charge(request.actualInputTokens, request.actualCompletionTokens, this.authorization.pricing)) > 1e-12)) throw new Error(`Code-candidate ledger completed accounting is invalid: ${requestId}.`);
            if (request.status === 'completed') this.readResponseArtifact(request);
        }
        const totals = summarize(state);
        if (Math.abs(totals.usd - Number(state.totals.usd)) > 1e-12 || totals.requests !== state.totals.requests || totals.inputTokens !== state.totals.inputTokens || totals.completionTokens !== state.totals.completionTokens
            || totals.usd < 0 || totals.requests > this.authorization.stageLimits.requests || totals.requests > this.authorization.cumulativeLimits.requests
            || totals.inputTokens > this.authorization.stageLimits.inputTokens || totals.inputTokens > this.authorization.cumulativeLimits.inputTokens
            || totals.completionTokens > this.authorization.stageLimits.completionTokens || totals.completionTokens > this.authorization.cumulativeLimits.completionTokens
            || totals.usd > this.authorization.stageLimits.usd + Number.EPSILON || totals.usd > this.authorization.cumulativeLimits.usd + Number.EPSILON) throw new Error('Code-candidate ledger totals are inconsistent.');
        return state;
    }

    responsePath(requestId) { return inside(this.outputRoot, path.join(this.outputRoot, 'responses', `${requestId}.json`)); }

    readResponseArtifact(request) {
        if (!request.responseArtifactRelativePath || !DIGEST.test(request.responseArtifactSha256 || '') || !DIGEST.test(request.responseBodySha256 || '')) throw new Error(`Completed code-candidate response artifact identity is missing: ${request.requestId}.`);
        const file = inside(this.outputRoot, path.join(this.outputRoot, request.responseArtifactRelativePath));
        let stat; try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') throw new Error(`Completed code-candidate response artifact is missing: ${request.requestId}.`); throw error; }
        if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_RESPONSE + 4096) throw new Error(`Completed code-candidate response artifact is unsafe: ${request.requestId}.`);
        const bytes = fs.readFileSync(file);
        if (sha256(bytes) !== request.responseArtifactSha256) throw new Error(`Completed code-candidate response artifact changed: ${request.requestId}.`);
        let artifact; try { artifact = JSON.parse(bytes); } catch { throw new Error(`Completed code-candidate response artifact is invalid: ${request.requestId}.`); }
        if (!artifact || artifact.requestId !== request.requestId || artifact.requestHash !== request.requestHash || artifact.bodySha256 !== request.responseBodySha256 || typeof artifact.body !== 'string' || sha256(Buffer.from(artifact.body)) !== artifact.bodySha256 || Number(artifact.status) < 100) throw new Error(`Completed code-candidate response artifact identity is invalid: ${request.requestId}.`);
        return artifact;
    }

    persistResponseArtifact(requestId, status, raw, requestHash) {
        const bodySha256 = sha256(Buffer.from(raw));
        const relative = path.join('responses', `${requestId}.json`);
        const file = inside(this.outputRoot, path.join(this.outputRoot, relative));
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, requestId, requestHash, status, bodySha256, body: raw }));
        if (bytes.length > MAX_RESPONSE + 4096) throw new Error('Draft response artifact exceeds the bounded limit.');
        atomicWriteBytes(file, bytes);
        return { relative, sha256: sha256(bytes), bodySha256 };
    }

    assertLiveAuthorization() {
        const now = this.now();
        if (Date.parse(this.authorization.runDeadline) <= now || Date.parse(this.authorization.expiresAt) <= now) throw new Error('Code-candidate authorization is expired or past its run deadline.');
    }

    validateRequest(endpoint, body) {
        if (endpoint !== this.authorization.endpoint || !body || body.model !== this.authorization.model || body.stream === true) throw new Error('Model request differs from the reviewed code-candidate authorization.');
        const allowed = new Set(['model', 'messages', 'response_format', 'max_completion_tokens', 'reasoning_effort']);
        if (Object.keys(body).some((key) => !allowed.has(key)) || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 8 || !body.response_format || body.response_format.type !== 'json_object' || body.max_completion_tokens !== this.authorization.requestLimits.completionTokens || (this.authorization.reasoningEffort && body.reasoning_effort !== this.authorization.reasoningEffort)) throw new Error('Draft request body is outside the bounded contract.');
        const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
        const inputTokens = Math.ceil(Number(this.countInputTokens(body)));
        if (bytes > MAX_BODY || !Number.isInteger(inputTokens) || inputTokens <= 0 || inputTokens > this.authorization.requestLimits.inputTokens) throw new Error('Draft request exceeds its authorized input bound.');
        return { body, inputTokens, bodySha256: sha256(Buffer.from(JSON.stringify(body))) };
    }

    async reserve(requestId, endpoint, body) {
        if (!safeName(requestId)) throw new Error('Draft request identity is invalid.');
        const validated = this.validateRequest(endpoint, body);
        const schedule = this.authorization.requestSchedule;
        return this.withLock(() => {
            this.assertLiveAuthorization();
            if (sha256(fs.readFileSync(this.authorizationFile)) !== this.authorizationHash) throw new Error('Reviewed code-candidate authorization changed after broker initialization.');
            const state = this.loadState();
            if (state.requests[requestId]) throw new Error('Draft request identity was already reserved; redispatch is forbidden.');
            const scheduled = schedule.find((entry) => entry.requestId === requestId);
            if (!scheduled) throw new Error('Draft request identity is not explicitly authorized.');
            if (scheduled.bodySha256 !== validated.bodySha256 || scheduled.inputTokens !== validated.inputTokens || scheduled.completionTokens !== this.authorization.requestLimits.completionTokens) throw new Error('Draft request body or sizing differs from its scheduled identity.');
            const addition = { usd: charge(validated.inputTokens, this.authorization.requestLimits.completionTokens, this.authorization.pricing), inputTokens: validated.inputTokens, completionTokens: this.authorization.requestLimits.completionTokens };
            const current = summarize(state);
            if (current.requests + 1 > this.authorization.stageLimits.requests || current.usd + addition.usd > this.authorization.stageLimits.usd + Number.EPSILON || current.inputTokens + addition.inputTokens > this.authorization.stageLimits.inputTokens || current.completionTokens + addition.completionTokens > this.authorization.stageLimits.completionTokens) throw new Error('Code-candidate stage budget exhausted before dispatch.');
            if (current.requests + 1 > this.authorization.cumulativeLimits.requests || current.usd + addition.usd > this.authorization.cumulativeLimits.usd + Number.EPSILON || current.inputTokens + addition.inputTokens > this.authorization.cumulativeLimits.inputTokens || current.completionTokens + addition.completionTokens > this.authorization.cumulativeLimits.completionTokens) throw new Error('Code-candidate cumulative budget exhausted before dispatch.');
            state.requests[requestId] = { requestId, authorizationId: this.authorization.authorizationId, authorizationHash: this.authorizationHash, scopeHash: this.scopeHash, stage: this.authorization.stage, provider: this.authorization.provider, model: this.authorization.model, status: 'reserved', reservedAt: new Date(this.now()).toISOString(), reservedUsd: addition.usd, reservedInputTokens: addition.inputTokens, reservedCompletionTokens: addition.completionTokens, requestHash: canonicalHash({ endpoint, body }), bodySha256: validated.bodySha256 };
            state.totals = summarize(state); atomicWrite(this.stateFile, state);
            return { ...validated, ...addition };
        });
    }

    settle(requestId, responseBody, responseArtifact = null) {
        return this.withLock(() => {
            const state = this.loadState(); const request = state.requests[requestId];
            if (!request || request.status !== 'reserved') throw new Error('Only a reserved draft request can settle.');
            const usage = usageFrom(responseBody);
            if (!usage || usage.reasoningTokens > usage.completionTokens || usage.inputTokens > request.reservedInputTokens || usage.completionTokens > request.reservedCompletionTokens) {
                request.status = 'ambiguous'; request.error = 'Provider usage was incomplete, inconsistent, or exceeded its reservation; full reservation retained.';
            } else {
                if (!responseArtifact?.relative || !DIGEST.test(responseArtifact.sha256 || '') || !DIGEST.test(responseArtifact.bodySha256 || '')) throw new Error('Completed draft response requires a persisted response artifact.');
                request.status = 'completed'; request.actualInputTokens = usage.inputTokens; request.actualCompletionTokens = usage.completionTokens; request.reasoningTokens = usage.reasoningTokens; request.actualUsd = charge(usage.inputTokens, usage.completionTokens, this.authorization.pricing);
                request.responseArtifactRelativePath = responseArtifact.relative; request.responseArtifactSha256 = responseArtifact.sha256; request.responseBodySha256 = responseArtifact.bodySha256;
            }
            request.settledAt = new Date(this.now()).toISOString(); state.totals = summarize(state); atomicWrite(this.stateFile, state); return request;
        });
    }

    markAmbiguous(requestId, error) {
        return this.withLock(() => {
            const state = this.loadState(); const request = state.requests[requestId]; if (!request) throw new Error('Cannot mark an unreserved draft request ambiguous.');
            if (request.status !== 'completed') { request.status = 'ambiguous'; request.error = redact(error?.message || error || 'transport failure').slice(0, 1000); request.settledAt = new Date(this.now()).toISOString(); state.totals = summarize(state); atomicWrite(this.stateFile, state); } return request;
        });
    }

    async dispatch({ requestId, endpoint, body, apiKey, transport } = {}) {
        this.assertLiveAuthorization();
        if (this.authorization.mode === 'real' && !apiKey) throw new Error('Code-candidate model credentials are not configured.');
        if (this.authorization.mode === 'synthetic' && apiKey) throw new Error('Synthetic code-candidate authorization cannot receive provider credentials.');
        const existing = this.loadState().requests[requestId];
        if (existing?.status === 'completed') { const artifact = this.readResponseArtifact(existing); return { status: artifact.status, body: artifact.body, parsed: (() => { try { return JSON.parse(artifact.body); } catch { return null; } })(), accountingStatus: 'completed', requestId }; }
        if (existing?.status === 'reserved') {
            const file = this.responsePath(requestId);
            if (fs.existsSync(file)) {
                const bytes = fs.readFileSync(file); let artifact;
                try { artifact = JSON.parse(bytes); } catch { throw new Error(`Reserved response artifact is invalid: ${requestId}.`); }
                const bound = { ...existing, responseArtifactRelativePath: path.relative(this.outputRoot, file), responseArtifactSha256: sha256(bytes), responseBodySha256: artifact.bodySha256 };
                const checked = this.readResponseArtifact(bound);
                const parsed = (() => { try { return JSON.parse(checked.body); } catch { return null; } })();
                const accounting = this.settle(requestId, checked.status >= 200 && checked.status < 300 ? parsed : null, { relative: bound.responseArtifactRelativePath, sha256: bound.responseArtifactSha256, bodySha256: bound.responseBodySha256 });
                return { status: checked.status, body: checked.body, parsed, accountingStatus: accounting.status, requestId };
            }
        }
        const reservation = await this.reserve(requestId, endpoint, body);
        const send = transport || this.transport;
        if (typeof send !== 'function') { this.markAmbiguous(requestId, 'No injectable draft transport was provided.'); throw new Error('No injectable draft transport was provided.'); }
        const controller = new AbortController();
        let timer;
        try {
            this.assertLiveAuthorization();
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error('Draft transport timed out.')); }, this.authorization.requestLimits.timeoutMs);
            });
            const response = await Promise.race([send({ endpoint, body: reservation.body, apiKey, requestId, timeoutMs: this.authorization.requestLimits.timeoutMs, signal: controller.signal }), timeout]);
            const status = Number(response?.status || 0); const raw = typeof response?.body === 'string' ? response.body : JSON.stringify(response?.body);
            if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE) { this.markAmbiguous(requestId, 'Draft response is missing or oversized.'); throw new Error('Draft response is missing or oversized.'); }
            let parsed; try { parsed = JSON.parse(raw); } catch { parsed = null; }
            const artifact = this.persistResponseArtifact(requestId, status, raw, canonicalHash({ endpoint, body }));
            if (typeof this.afterResponseArtifact === 'function') this.afterResponseArtifact({ requestId, artifact });
            const accounting = this.settle(requestId, status >= 200 && status < 300 ? parsed : null, artifact);
            if (typeof this.afterSettlement === 'function') this.afterSettlement({ requestId, accounting });
            return { status, body: raw, parsed, accountingStatus: accounting.status, requestId };
        } catch (error) { if (this.requestStatus(requestId) === 'reserved' && !fs.existsSync(this.responsePath(requestId))) this.markAmbiguous(requestId, error); throw error; }
        finally { if (timer) clearTimeout(timer); }
    }

    requestStatus(requestId) { const request = this.loadState().requests[requestId]; return request?.status || null; }
    summary() { const state = this.loadState(); return { stage: summarize(state), authorizationHash: this.authorizationHash, scopeHash: this.scopeHash }; }
}

module.exports = { ENDPOINT, ModelBudgetBroker, canonicalHash, redact, validateAuthorization, summarize, sha256 };

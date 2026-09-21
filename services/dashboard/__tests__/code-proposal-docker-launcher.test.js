const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
    buildDockerInvocation, buildContainerName, parseWorkerOutput, runDockerInvocation, cleanupOwnedContainer,
    FIXED_COMMAND, MAX_OUTPUT_BYTES, FIXED_RUNTIME_ID,
} = require('../../../scripts/lib/code-proposal-docker-launcher');
const { runCodeProposalProofWithDocker } = require('../../../scripts/lib/code-proposal-proof-runner');

const HASH = 'a'.repeat(64);
function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-c2c2-launcher-'));
    const attemptPath = path.join(root, 'attempt');
    fs.mkdirSync(attemptPath);
    const attempt = fs.realpathSync(attemptPath);
    for (const name of ['baseline', 'candidate', 'test-bundle', 'docker-output']) fs.mkdirSync(path.join(attempt, name), { recursive: true, mode: 0o700 });
    return { root, attempt, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function spec(state, overrides = {}) {
    return buildDockerInvocation({ attemptRoot: state.attempt, baselineRoot: path.join(state.attempt, 'baseline'), candidateRoot: path.join(state.attempt, 'candidate'), testBundleRoot: path.join(state.attempt, 'test-bundle'), outputRoot: path.join(state.attempt, 'docker-output'), imageId: HASH, runtimeId: FIXED_RUNTIME_ID, attemptId: 'attempt-one', phase: 'unit', arm: 'baseline', seed: 17, repoRoot: path.resolve(__dirname, '../../..'), request: { phase: 'unit', arm: 'baseline', inventory: [], plan: { image_id: HASH, runtime_id: FIXED_RUNTIME_ID } }, ...overrides });
}

test('builds an immutable, isolated, fixed worker invocation', () => {
    const state = setup();
    try {
        const value = spec(state);
        expect(value.args).toEqual(expect.arrayContaining(['--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--read-only', '--user', '0:0']));
        expect(value.args).toEqual(expect.arrayContaining(FIXED_COMMAND));
        expect(value.args).not.toContain('--privileged');
        expect(value.args).not.toContain('--pid=host');
        expect(value.args).not.toContain('--ipc=host');
        expect(value.mounts.filter((mount) => mount.mode === 'ro')).toHaveLength(5);
        expect(value.mounts.find((mount) => mount.destination === '/runner/support').source).toContain('c2c2-support');
        expect(value.mounts.find((mount) => mount.destination === '/runner/worker.js').source).toMatch(/code-proposal-c2c2-worker\.js$/);
        expect(value.mounts.find((mount) => mount.destination === '/runner/trusted')).toBeUndefined();
        expect(value.mounts.some((mount) => /\.env|\.git|config/.test(mount.source))).toBe(false);
        expect(value.request.plan.support_bundle_sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(value.args).toContain('--user');
        expect(value.args).toContain('0:0');
        expect(value.mounts.find((mount) => mount.destination === '/runner/output')).toBeUndefined();
        expect(value.env).toEqual(expect.objectContaining({ NODE_ENV: 'test', C2C2_PROTOCOL_VERSION: '1', C2C2_RUNTIME_ID: FIXED_RUNTIME_ID, C2C2_IMAGE_ID: HASH }));
        expect(value.args).toEqual(expect.arrayContaining(['--tmpfs', '/runner/output:rw,noexec,nosuid,size=64m,mode=1777']));
        expect(value.args.some((arg) => arg.includes('dst=/runner/request.json'))).toBe(true);
    } finally { state.cleanup(); }
});

test('delivery runs directly as non-root without setuid capabilities', () => {
    const state = setup();
    try {
        const identity = { delivery_image_id: HASH, delivery_runtime_id: FIXED_RUNTIME_ID, delivery_driver_sha256: HASH, delivery_source_sha256: HASH, delivery_fixture_sha256: HASH, browser_version: '148.0.7778.0', quill_version: '1.3.6' };
        const value = spec(state, { phase: 'delivery', arm: 'paired', plan: { image_id: HASH, runtime_id: FIXED_RUNTIME_ID, delivery_identity: identity }, request: { phase: 'delivery', arm: 'paired', inventory: [], plan: { image_id: HASH, runtime_id: FIXED_RUNTIME_ID, delivery_identity: identity } } });
        expect(value.args).toEqual(expect.arrayContaining(['--user', '65532:65532', '--cap-drop', 'ALL']));
        expect(value.args).not.toEqual(expect.arrayContaining(['--cap-add', 'SETUID', '--cap-add', 'SETGID']));
    } finally { state.cleanup(); }
});

test('keeps container names unique and rejects environment injection', () => {
    const first = buildContainerName('a'.repeat(128), 'nonce-one');
    const second = buildContainerName('a'.repeat(128), 'nonce-two');
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(120);
    const state = setup();
    try { expect(() => spec(state, { runId: 'safe\n--env=LEAK=1' })).toThrow(/run id/); } finally { state.cleanup(); }
});

test('the Docker entry point refuses caller-supplied host executors', async () => {
    await expect(runCodeProposalProofWithDocker({ attemptRoot: '/tmp/c2c2-test-only', executor: () => ({}) })).rejects.toThrow(/caller-supplied host executors/);
    await expect(runCodeProposalProofWithDocker({ attemptRoot: '/tmp/c2c2-test-only', behaviorEvaluator: () => ({ passed: true }) })).rejects.toThrow(/behavior evaluators/);
});

test.each([
    ['phase injection', { phase: '--privileged' }, /Invalid phase/],
    ['image drift', { imageId: 'not-a-digest' }, /immutable image/],
    ['runtime drift', { runtimeId: 'not-a-digest' }, /immutable runtime/],
    ['plan image drift', { plan: { image_id: 'c'.repeat(64), runtime_id: 'b'.repeat(64) } }, /image\/runtime identity drift/],
])('rejects %s', (_label, overrides, error) => {
    const state = setup();
    try { expect(() => spec(state, overrides)).toThrow(error); } finally { state.cleanup(); }
});

test('rejects symlink aliases, mount overlap, and unsafe historical roots', () => {
    const state = setup();
    try {
        const alias = path.join(state.root, 'alias'); fs.symlinkSync(path.join(state.attempt, 'baseline'), alias);
        expect(() => spec(state, { baselineRoot: alias })).toThrow(/symlink|alias/);
        fs.mkdirSync(path.join(state.attempt, 'baseline', 'nested'), { recursive: true, mode: 0o700 });
        expect(() => spec(state, { outputRoot: path.join(state.attempt, 'baseline', 'nested') })).toThrow(/overlap/);
        expect(() => spec(state, { attemptRoot: path.join(state.attempt, 'missing') })).toThrow(/ENOENT|regular directory/);
    } finally { state.cleanup(); }
});

test('bounds and validates worker JSON output', () => {
    expect(parseWorkerOutput(JSON.stringify({ protocol_version: 1, status: 'ok', exit_code: 0, report: {} }), '')).toMatchObject({ status: 'ok' });
    expect(() => parseWorkerOutput('not-json', '')).toThrow(/valid JSON/);
    expect(() => parseWorkerOutput('x'.repeat(MAX_OUTPUT_BYTES + 1), '')).toThrow(/bounded/);
    expect(() => parseWorkerOutput(JSON.stringify({ protocol_version: 2, status: 'ok' }), '')).toThrow(/schema/);
});

test('blocked replay output cannot masquerade as expectation-derived evidence', () => {
    const state = setup();
    try {
        const value = spec(state, { phase: 'replay', arm: 'candidate', runId: 'attempt-one:replay:17:case-1', request: { phase: 'replay', arm: 'candidate', seed: 17, plan: { image_id: HASH, runtime_id: FIXED_RUNTIME_ID } } });
        const blocked = parseWorkerOutput(JSON.stringify({ protocol_version: 1, status: 'failed', phase: 'replay', arm: 'candidate', seed: 17, run_id: value.runId, runtime_id: value.runtime, image_id: value.image, error: 'fixed repository-owned replay driver unavailable', blocked: true }), '', value);
        expect(blocked.status).toBe('failed');
        expect(blocked).not.toHaveProperty('output');
        expect(blocked).not.toHaveProperty('composite');
    } finally { state.cleanup(); }
});

test('per-run request tampering is rejected before Docker launch', async () => {
    const state = setup();
    try {
        const value = spec(state);
        fs.chmodSync(value.requestPath, 0o644);
        fs.appendFileSync(value.requestPath, 'tamper');
        await expect(runDockerInvocation(value, { inspectImage: async () => value.image, spawn: () => { throw new Error('must not launch'); } })).rejects.toThrow(/request file changed/);
    } finally { state.cleanup(); }
});

test('actual inspected image drift is rejected before Docker launch', async () => {
    const state = setup();
    try {
        const value = spec(state);
        await expect(runDockerInvocation(value, { inspectImage: async () => 'sha256:' + 'c'.repeat(64), spawn: () => { throw new Error('must not launch'); } })).rejects.toThrow(/image identity drifted/);
    } finally { state.cleanup(); }
});

test('timeout/signal and uncertain cleanup fail closed', async () => {
    const state = setup();
    try {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = jest.fn();
        const value = spec(state);
        await expect(runDockerInvocation(value, { timeoutMs: 5, spawn: () => child, inspectImage: async () => value.image, inspect: async () => ({ name: value.name, labels: { 'com.menumanager.c2c2.name': value.name, 'com.menumanager.c2c2.owner': 'attempt-one' } }), remove: async () => true })).rejects.toThrow(/timed out/);
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        await expect(cleanupOwnedContainer(value, { inspect: async () => ({ name: 'other', labels: {} }), remove: async () => true })).rejects.toThrow(/ownership/);
    } finally { state.cleanup(); }
});

test('timeout cleanup result wins a close-before-cleanup race', async () => {
    const state = setup();
    try {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = jest.fn(() => child.emit('close', null, 'SIGKILL'));
        const value = spec(state);
        const pendingCleanup = new Promise((_, reject) => setTimeout(() => reject(new Error('cleanup ownership uncertain')), 10));
        await expect(runDockerInvocation(value, { timeoutMs: 1, spawn: () => child, inspectImage: async () => value.image, inspect: async () => ({ name: value.name, labels: { 'com.menumanager.c2c2.name': value.name, 'com.menumanager.c2c2.owner': 'attempt-one' } }), remove: async () => pendingCleanup })).rejects.toThrow(/cleanup ownership uncertain/);
    } finally { state.cleanup(); }
});

test('nonzero, signal, and malformed worker exits fail closed', async () => {
    const state = setup();
    try {
        for (const event of ['nonzero', 'signal', 'malformed']) {
            const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = jest.fn();
            const value = spec(state);
            const promise = runDockerInvocation(value, { timeoutMs: 100, spawn: () => child, inspectImage: async () => value.image });
            if (event === 'malformed') { child.stdout.emit('data', 'bad'); child.emit('close', 0, null); }
            else if (event === 'signal') child.emit('close', null, 'SIGKILL');
            else child.emit('close', 1, null);
            await expect(promise).rejects.toThrow();
        }
    } finally { state.cleanup(); }
});

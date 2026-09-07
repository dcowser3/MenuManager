const http = require('node:http');
const { main, inspectDocker, probeHealth } = require('../../scripts/dev-doctor');

const checkout = '/work/current';
const ports = { parser: 3001, 'ai-review': 3002, notifier: 3003, db: 3004, dashboard: 3005, differ: 3006, 'clickup-integration': 3007 };
const containers = () => Object.entries(ports).map(([service, port]) => ({
    name: `/mm-${service}`, state: 'running', image: 'sha256:dev', project: 'menumanager', service,
    mounts: [{ Type: 'bind', Source: `${checkout}/services/${service}`, Destination: `/app/services/${service}` }],
    ports: { [`${port}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: `${port}` }] },
}));
function dockerFixture(rows = containers(), options = {}) {
    return jest.fn(async (command, args) => {
        if (command !== 'docker') throw new Error('Unexpected command');
        if (args[0] === 'version') {
            if (options.offline) throw Object.assign(new Error('SECRET daemon error'), { code: options.offline });
            return { stdout: '27.0\n' };
        }
        if (args[0] === 'image' && args[1] === 'inspect') {
            if (options.missingImage) throw new Error('missing');
            return { stdout: 'sha256:dev\n' };
        }
        if (args[0] === 'ps') return { stdout: rows.map((_, index) => `id${index}`).join('\n') };
        if (args[0] === 'inspect') return { stdout: rows.map(row => JSON.stringify(row)).join('\n') };
        throw new Error(`Mutation or unexpected Docker command: ${args[0]}`);
    });
}
async function cli(run, overrides = {}) {
    const output = [];
    const code = await main(['--json'], { checkout, run, tcp: async () => true, health: async () => 'ok', write: line => output.push(line), ...overrides });
    return { code, report: JSON.parse(output.join('\n')) };
}

test('reports a matching running checkout and uses only bounded Docker reads', async () => {
    const run = dockerFixture();
    const { code, report } = await cli(run);
    expect(code).toBe(0);
    expect(report.services).toHaveLength(7);
    expect(report.services.every(service => service.owned && service.reachable)).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(run.mock.calls.every(([, , options]) => options.timeout === 5000)).toBe(true);
});

test('a healthy shared stack cannot verify another worktree', async () => {
    const health = jest.fn(async () => 'ok');
    const { code, report } = await cli(dockerFixture(), { checkout: '/work/another', health });
    expect(code).toBe(1);
    expect(report.services.every(service => !service.owned)).toBe(true);
    expect(report.services.find(service => service.service === 'dashboard').containers[0]).toMatchObject({ source: '/work/current/services/dashboard', matchesCheckout: false });
    expect(health).not.toHaveBeenCalled();
    expect(report.services.find(service => service.service === 'clickup-integration').health).toBe('skipped-unverified-owner');
});

test('stopped containers and unrelated open listeners do not pass ownership checks', async () => {
    const rows = containers();
    rows.find(row => row.service === 'dashboard').state = 'exited';
    const { code, report } = await cli(dockerFixture(rows));
    expect(code).toBe(1);
    expect(report.services.find(service => service.service === 'dashboard')).toMatchObject({ reachable: true, owned: false });
});

test('an alternate-port stack cannot claim the expected localhost port', async () => {
    const rows = containers();
    rows.find(row => row.service === 'dashboard').ports['3005/tcp'][0].HostPort = '43005';
    const { code, report } = await cli(dockerFixture(rows));
    expect(code).toBe(1);
    expect(report.services.find(service => service.service === 'dashboard')).toMatchObject({ reachable: true, owned: false });
});

test('missing images and stale running images are actionable even when ports answer', async () => {
    const missing = await cli(dockerFixture(containers(), { missingImage: true }));
    expect(missing.code).toBe(1);
    expect(missing.report.docker.image).toBeNull();
    const rows = containers();
    rows[0].image = 'sha256:old';
    const stale = await cli(dockerFixture(rows));
    expect(stale.code).toBe(1);
    expect(stale.report.services[0].containers[0].image).toBe('sha256:old');
});

test.each(['ENOENT', 'ETIMEDOUT'])('reports unavailable Docker without disclosing raw error output (%s)', async offline => {
    const run = dockerFixture([], { offline });
    const { code, report } = await cli(run);
    expect(code).toBe(1);
    expect(report.docker.status).toBe(offline === 'ENOENT' ? 'not-installed' : 'unavailable');
    expect(JSON.stringify(report)).not.toContain('SECRET');
    expect(run).toHaveBeenCalledTimes(1);
});

test('malformed Docker inspection fails closed', async () => {
    const run = dockerFixture();
    const ordinary = run.getMockImplementation();
    run.mockImplementation((command, args, options) => args[0] === 'inspect' ? Promise.resolve({ stdout: 'not json' }) : ordinary(command, args, options));
    expect((await inspectDocker(run)).status).toBe('inspection-failed');
});

test('unreachable ports and failed dedicated health checks fail diagnostics', async () => {
    const { code, report } = await cli(dockerFixture(), { tcp: async port => port !== 3004, health: async () => 'timeout' });
    expect(code).toBe(1);
    expect(report.services.find(service => service.service === 'db').reachable).toBe(false);
    expect(report.services.find(service => service.service === 'clickup-integration').health).toBe('timeout');
});

test('unsupported arguments never inspect or mutate the environment', async () => {
    const run = dockerFixture();
    expect(await main(['--restart'], { run, write: () => {} })).toBe(2);
    expect(run).not.toHaveBeenCalled();
});

test('health probe checks the real contract, rejects redirects, and bounds stalled responses', async () => {
    const requests = [];
    let mode = 'healthy';
    const server = http.createServer((request, response) => {
        requests.push(request.url);
        if (mode === 'stall') { response.writeHead(200); response.write('{'); return; }
        if (mode === 'redirect') { response.writeHead(302, { Location: 'https://example.com' }); response.end(); return; }
        response.end(JSON.stringify({ status: 'ok', service: mode === 'wrong' ? 'other-service' : 'clickup-integration' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        expect(await probeHealth(port)).toBe('ok');
        mode = 'wrong';
        expect(await probeHealth(port)).toBe('invalid-response');
        mode = 'redirect';
        expect(await probeHealth(port)).toBe('invalid-response');
        mode = 'stall';
        expect(await probeHealth(port, 30)).toBe('timeout');
        expect(requests).toEqual(['/health', '/health', '/health', '/health']);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

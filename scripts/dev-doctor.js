#!/usr/bin/env node
'use strict';

// Read-only diagnostics: never loads .env, starts services, or changes containers.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const SERVICES = { parser: 3001, 'ai-review': 3002, notifier: 3003, db: 3004, dashboard: 3005, differ: 3006, 'clickup-integration': 3007 };
const IMAGE = 'menumanager/dev:latest';
const INSPECT_FORMAT = '{"name":{{json .Name}},"state":{{json .State.Status}},"image":{{json .Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}}}';

async function inspectDocker(run = promisify(execFile)) {
    const docker = async (...args) => (await run('docker', args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
    let version;
    try {
        version = await docker('version', '--format', '{{.Server.Version}}');
        if (!version) return { status: 'unavailable', image: null, containers: [] };
    } catch (error) {
        return { status: error.code === 'ENOENT' ? 'not-installed' : 'unavailable', image: null, containers: [] };
    }
    let image = null;
    try { image = await docker('image', 'inspect', IMAGE, '--format', '{{.Id}}'); } catch (_) { /* Missing image is reported separately. */ }
    try {
        const ids = (await docker('ps', '-a', '--filter', 'label=com.docker.compose.service', '--format', '{{.ID}}')).split(/\s+/).filter(Boolean);
        const rows = ids.length ? await docker('inspect', '--format', INSPECT_FORMAT, ...ids) : '';
        return { status: 'ready', version, image, containers: rows ? rows.split('\n').map(row => JSON.parse(row)) : [] };
    } catch (_) {
        return { status: 'inspection-failed', version, image, containers: [] };
    }
}

function probePort(port, timeout = 1500) {
    return new Promise(resolve => {
        const socket = net.connect({ host: '127.0.0.1', port });
        const finish = reachable => { socket.destroy(); resolve(reachable); };
        socket.setTimeout(timeout);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
    });
}

function probeHealth(port = 3007, timeout = 1500) {
    return new Promise(resolve => {
        let finished = false;
        let request;
        const finish = status => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            request.destroy();
            resolve(status);
        };
        // An absolute deadline also bounds servers that keep streaming bytes.
        const timer = setTimeout(() => finish('timeout'), timeout);
        request = http.get({ host: '127.0.0.1', port, path: '/health' }, response => {
            let body = '';
            response.on('data', chunk => {
                body += chunk;
                if (body.length > 8192) finish('invalid-response');
            });
            response.on('error', () => finish('unavailable'));
            response.on('end', () => {
                try {
                    const value = JSON.parse(body);
                    finish(response.statusCode === 200 && value.status === 'ok' && value.service === 'clickup-integration' ? 'ok' : 'invalid-response');
                } catch (_) { finish('invalid-response'); }
            });
        });
        request.on('error', () => finish('unavailable'));
    });
}

async function diagnose({ checkout = path.resolve(__dirname, '..'), run, tcp = probePort, health = probeHealth } = {}) {
    const docker = await inspectDocker(run);
    const warnings = [];
    if (docker.status !== 'ready') warnings.push(`Docker ${docker.status}; container ownership could not be verified.`);
    if (docker.status === 'ready' && !docker.image) warnings.push(`Dev image ${IMAGE} is missing.`);
    const services = await Promise.all(Object.entries(SERVICES).map(async ([service, port]) => {
        const containers = docker.containers.filter(container => container.service === service).map(container => {
            const source = (container.mounts || []).find(mount => mount.Type === 'bind' && mount.Destination === `/app/services/${service}`)?.Source || null;
            const publishesPort = (container.ports?.[`${port}/tcp`] || []).some(binding => Number(binding.HostPort) === port && ['', '0.0.0.0', '127.0.0.1'].includes(binding.HostIp || ''));
            return { name: container.name.replace(/^\//, ''), project: container.project, state: container.state, image: container.image, source, matchesCheckout: source === path.join(checkout, 'services', service), publishesPort };
        }).filter(container => container.publishesPort || container.matchesCheckout);
        const reachable = await tcp(port);
        const owners = containers.filter(container => container.state === 'running' && container.publishesPort);
        const owned = owners.some(container => container.matchesCheckout);
        if (!owned) warnings.push(`${service}:${port} has no running container from this checkout publishing its expected port.`);
        for (const owner of owners) {
            if (!owner.matchesCheckout) warnings.push(`${owner.name} serves ${owner.source || 'an unrecognized source mount'}, not this checkout.`);
            if (docker.image && owner.image !== docker.image) warnings.push(`${owner.name} uses an older/different image than ${IMAGE}.`);
        }
        if (!reachable) warnings.push(`${service}:${port} is not reachable.`);
        if (reachable && !owners.length) warnings.push(`${service}:${port} is occupied by a listener not identified as a running Compose container.`);
        return { service, port, reachable, owned, containers };
    }));
    // Only ClickUp exposes a dedicated health endpoint. TCP checks above do not
    // claim that the other services or their downstream dependencies are healthy.
    const clickup = services.find(service => service.service === 'clickup-integration');
    clickup.health = clickup.owned ? await health() : 'skipped-unverified-owner';
    if (clickup.health !== 'ok') warnings.push(`ClickUp /health: ${clickup.health}.`);
    let worktree = false;
    try { worktree = fs.statSync(path.join(checkout, '.git')).isFile(); } catch (_) { /* Also usable from exported source. */ }
    return { ok: warnings.length === 0, checkout, worktree, docker: { status: docker.status, version: docker.version, image: docker.image }, services, warnings };
}

async function main(args = process.argv.slice(2), { write = line => process.stdout.write(`${line}\n`), ...dependencies } = {}) {
    if (args.some(arg => arg !== '--json') || args.length > 1) {
        write('Usage: node scripts/dev-doctor.js [--json]');
        return 2;
    }
    const report = await diagnose(dependencies);
    if (args.includes('--json')) write(JSON.stringify(report, null, 2));
    else {
        write(`Checkout: ${report.checkout}`);
        if (report.worktree) write('Worktree: separate Git files do not isolate the fixed Docker names and ports.');
        write(`Docker: ${report.docker.status}; dev image: ${report.docker.image ? 'present' : 'not verified'}`);
        for (const service of report.services) {
            write(`${service.service}:${service.port} TCP ${service.reachable ? 'reachable' : 'unreachable'}; checkout ${service.owned ? 'matches' : 'unverified'}${service.health ? `; /health ${service.health}` : ''}`);
            for (const container of service.containers) write(`  ${container.name} (${container.project}, ${container.state}): ${container.source || 'no source bind mount'}`);
        }
        write('TCP reachability is not application or downstream readiness.');
        for (const warning of report.warnings) write(`Warning: ${warning}`);
    }
    return report.ok ? 0 : 1;
}

module.exports = { diagnose, main, inspectDocker, probeHealth, probePort };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write('Diagnostics failed unexpectedly. No services were changed.\n');
    process.exitCode = 1;
});

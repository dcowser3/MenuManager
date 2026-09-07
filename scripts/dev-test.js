#!/usr/bin/env node
// Run explicit source tests in a disposable Docker container, without host mounts.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const image = process.env.DEV_TEST_IMAGE || 'menumanager/dev:latest';

function isSourceFile(file) {
    if (file.split('/').some(part => /^(?:\.env(?:\..*)?|node_modules(?:\.old)?|venv|\.venv|tmp|logs|data|storage|__pycache__|\.git)$/.test(part))) return false;
    return /^(?:package(?:-lock)?\.json|tsconfig\.json|jest(?:\.setup|\.config)?\.js)$/.test(file) ||
        /^(?:services|scripts|config|config\.example)\/.*\.(?:[cm]?js|tsx?|json|ejs|css|py|txt|ya?ml)$/.test(file) ||
        file === 'sop-processor/qa_prompt.txt';
}

function validateTests(args, root = repoRoot) {
    if (!args.length) throw new Error('Provide explicit source test paths; broad suites must be selected deliberately.');
    return args.map(file => {
        const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
        if (!relative.startsWith('services/') || relative.split('/').includes('dist') ||
            !/(?:\/__tests__\/.*|\.(?:test|spec))\.[jt]sx?$/.test(relative) || !isSourceFile(relative)) {
            throw new Error(`Expected a source test under services/: ${file}`);
        }
        const stat = fs.lstatSync(path.join(root, relative));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular source test: ${file}`);
        return relative;
    });
}

function snapshotFiles(root = repoRoot) {
    const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
    return [...new Set(listed.split('\0').filter(isSourceFile))].filter(file => {
        const full = path.join(root, file);
        if (!fs.existsSync(full)) return false; // Deleted tracked files must stay deleted.
        const parts = file.split('/');
        for (let i = 1; i <= parts.length; i++) {
            if (fs.lstatSync(path.join(root, ...parts.slice(0, i))).isSymbolicLink()) {
                throw new Error(`Source symlinks are not copied: ${file}`);
            }
        }
        return fs.statSync(full).isFile();
    }).sort();
}

function main(args) {
    if (args.length === 1 && args[0] === '--help') {
        console.log('Usage: npm run dev:test -- services/<name>/__tests__/<file>.test.js [...]\nRuns only these tests, serially, in Docker with networking disabled.\nCopies source into disposable storage; excludes .env, runtime data, samples, and host dependencies.\nUses DEV_TEST_IMAGE (default: menumanager/dev:latest); build it after dependency changes.');
        return 0;
    }
    const tests = validateTests(args);
    const imageId = execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { timeout: 10000, encoding: 'utf8', stdio: 'pipe' }).trim();
    const lockHash = createHash('sha256').update(fs.readFileSync(path.join(repoRoot, 'package-lock.json'))).digest('hex');
    const files = snapshotFiles();
    for (const test of tests) {
        if (!files.includes(test)) throw new Error(`Test is ignored by Git or excluded from the source snapshot: ${test}`);
    }
    const archive = execFileSync('tar', ['--format=ustar', '-cf', '-', '--null', '-T', '-'], {
        cwd: repoRoot, input: files.join('\0') + '\0', maxBuffer: 100 * 1024 * 1024,
        env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    console.log(`Testing ${tests.length} source file(s) in ${image}; ${files.length} files copied, no host mounts or network.`);
    // The image supplies dependencies, never stale application source. Preserve
    // each workspace's installed dependencies, then replace its code completely.
    const clearImageSource = `const fs = require('fs');
        const crypto = require('crypto');
        if (crypto.createHash('sha256').update(fs.readFileSync('/app/package-lock.json')).digest('hex') !== '${lockHash}') {
            throw new Error('Dependency lock differs from the test image. Rebuild your isolated dev image and set DEV_TEST_IMAGE.');
        }
        for (const dir of fs.readdirSync('/app/services')) {
            const service = '/app/services/' + dir;
            if (!fs.statSync(service).isDirectory()) continue;
            for (const entry of fs.readdirSync(service)) {
                if (entry !== 'node_modules' && entry !== 'venv') fs.rmSync(service + '/' + entry, { recursive: true, force: true });
            }
        }
        for (const dir of ['scripts', 'config', 'config.example', 'sop-processor']) fs.rmSync('/app/' + dir, { recursive: true, force: true });`;
    const result = spawnSync('docker', [
        'run', '--rm', '--pull=never', '--network=none', '--init', '-i', '--workdir', '/app',
        '--entrypoint', '/bin/sh', imageId, '-c',
        `node -e '${clearImageSource.replace(/'/g, "'\\''")}' && tar -xf - -C /app && for service in llm-adapter supabase-client internal-auth tenant-config; do node /app/node_modules/typescript/bin/tsc --project /app/services/$service/tsconfig.json || exit; done && exec node /app/node_modules/jest/bin/jest.js --runInBand --no-cache --runTestsByPath "$@"`,
        'dev-test', ...tests,
    ], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] });
    if (result.error) throw result.error;
    return result.status === null ? 1 : result.status;
}

if (require.main === module) {
    try { process.exitCode = main(process.argv.slice(2)); }
    catch (error) { console.error(`dev:test: ${error.message}`); process.exitCode = 1; }
}
module.exports = { isSourceFile, validateTests, snapshotFiles };

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isSourceFile, validateTests, snapshotFiles } = require('../../scripts/dev-test');

let root;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-test-'));
    execFileSync('git', ['init', '-q', root]);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function write(file, text = '') {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
}

test('copies current source and new tests, excludes ignored/runtime files and tracked deletions', () => {
    write('services/parser/index.ts', 'old');
    execFileSync('git', ['add', '.'], { cwd: root });
    fs.unlinkSync(path.join(root, 'services/parser/index.ts'));
    write('.gitignore', 'services/ignored.ts\n');
    write('services/ignored.ts');
    write('services/parser/__tests__/new.test.js');
    write('services/parser/.env');
    write('services/parser/node_modules/module/index.js');
    write('services/parser/data/private.json');
    write('services/parser/dist/index.js');
    write('tmp/secret.json');
    expect(snapshotFiles(root)).toEqual([
        'services/parser/__tests__/new.test.js',
        'services/parser/dist/index.js',
    ]);
});

test('rejects symlinked source instead of copying outside the checkout', () => {
    write('secret.txt', 'secret');
    fs.mkdirSync(path.join(root, 'services'));
    fs.symlinkSync(path.join(root, 'secret.txt'), path.join(root, 'services/source.ts'));
    expect(() => snapshotFiles(root)).toThrow('Source symlinks are not copied');
});

test('requires explicit existing source tests and rejects flags, artifacts and parent paths', () => {
    write('services/parser/__tests__/validator.test.ts');
    expect(validateTests(['services/parser/__tests__/validator.test.ts'], root)).toEqual(['services/parser/__tests__/validator.test.ts']);
    for (const args of [[], ['--watch'], ['services/parser/dist/validator.test.js'], ['../other.test.js'], ['services/parser/index.ts']]) {
        expect(() => validateTests(args, root)).toThrow();
    }
});

test.each(['.env', 'services/db/.env.bak', 'services/db/node_modules/a.js', 'services/db/tmp/input.json', 'samples/menu.docx', 'services/docx-redliner/venv/bin/tool.py'])('excludes %s from the snapshot', file => {
    expect(isSourceFile(file)).toBe(false);
});

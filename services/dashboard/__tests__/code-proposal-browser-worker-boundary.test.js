'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const sha256 = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relative))).digest('hex');

describe('B5-C2c2b3 browser-worker boundary', () => {
    test('form uses repository-owned Quill assets instead of a CDN', () => {
        const form = read('services/dashboard/views/form.ejs');
        expect(form).toContain('/vendor/quill-1.3.6/quill.js');
        expect(form).toContain('/vendor/quill-1.3.6/quill.snow.css');
        expect(form).not.toContain('cdn.quilljs.com');
    });

    test('vendored assets are the pinned Quill 1.3.6 bytes', () => {
        expect(sha256('services/dashboard/public/vendor/quill-1.3.6/quill.js')).toBe('a4da70cd71b5a0e224e95865829a8356a93907c7d47ebb6b23cb8014c6ff9c48');
        expect(sha256('services/dashboard/public/vendor/quill-1.3.6/quill.snow.css')).toBe('892e299431955e9ae388ae257f72024ee76af2d52a7a97a868f70fbe50f16144');
    });

    test('worker image pins the trusted base and neutral browser cache', () => {
        const dockerfile = read('docker/Dockerfile.code-proposal-browser-worker');
        expect(dockerfile).toContain('FROM menumanager/dev@sha256:c5c31c8c36565eda780fcfc7d99a2dde15d91bb22ade6f274d1b5041514452c5');
        expect(dockerfile).toContain('ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
        expect(dockerfile).toContain('USER 65532:65532');
        expect(dockerfile).not.toContain('--no-sandbox');
    });

    test('browser boundary documentation records the immutable provenance', () => {
        const doc = read('docs/design-docs/review-learning-b5-c2c2b3-browser-worker.md');
        expect(doc).toContain('Chromium revision 1223');
        expect(doc).toContain('network `none`');
        expect(doc).toContain('a4da70cd71b5a0e224e95865829a8356a93907c7d47ebb6b23cb8014c6ff9c48');
    });
});

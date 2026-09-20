'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const preparerPath = path.join(repoRoot, 'scripts/prepare-source-bound-preflight-v2.js');

describe('source-bound preflight preparation closure', () => {
    test('keeps every public preparer dependency present and addressable', () => {
        const preparer = fs.readFileSync(preparerPath, 'utf8');
        const dependencies = [
            {
                relative: 'scripts/run-source-bound-preflight-v2.js',
                expression: "path.join(repoRoot, 'scripts/run-source-bound-preflight-v2.js')",
            },
            {
                relative: 'services/dashboard/__fixtures__/review-learning/source-bound-preflight-v2.json',
                expression: "path.join(repoRoot, 'services/dashboard/__fixtures__/review-learning/source-bound-preflight-v2.json')",
            },
            {
                relative: 'scripts/prepare-source-bound-preflight-v2.js',
                expression: "path.join(repoRoot, 'scripts/prepare-source-bound-preflight-v2.js')",
            },
            {
                relative: 'scripts/lib/source-bound-preflight-v2.js',
                expression: "path.join(repoRoot, 'scripts/lib/source-bound-preflight-v2.js')",
            },
        ];

        for (const dependency of dependencies) {
            expect(fs.existsSync(path.join(repoRoot, dependency.relative))).toBe(true);
            expect(preparer).toContain(dependency.expression);
        }
    });

    test('keeps the checked-in template synthetic and contract-addressable', () => {
        const fixturePath = path.join(repoRoot, 'services/dashboard/__fixtures__/review-learning/source-bound-preflight-v2.json');
        const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
        expect(fixture.contractVersion).toBe('review-learning-source-bound-preflight-v2');
        expect(fixture.status).toBe('frozen_synthetic_only');
        expect(Array.isArray(fixture.cases)).toBe(true);
        expect(fixture.cases.length).toBeGreaterThan(0);
        expect(JSON.stringify(fixture)).not.toMatch(/private|credential|production|provider[_-]?key/i);
    });
});

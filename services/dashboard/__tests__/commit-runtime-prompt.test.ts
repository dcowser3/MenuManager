import path from 'path';

const {
    assessPromptReconciliation,
    parseArgs,
} = require(path.resolve(process.cwd(), 'scripts/commit-runtime-prompt.js'));

describe('commit-runtime-prompt safe reconciliation', () => {
    const oldHash = 'a'.repeat(64);
    const newHash = 'b'.repeat(64);

    test('is idempotent when the database already matches the runtime prompt', () => {
        expect(assessPromptReconciliation(newHash, newHash, oldHash)).toEqual({ status: 'in_sync' });
    });

    test('allows a guarded promotion only from the expected database hash', () => {
        expect(assessPromptReconciliation(newHash, oldHash, oldHash)).toEqual({ status: 'ready' });
        expect(assessPromptReconciliation(newHash, 'c'.repeat(64), oldHash)).toEqual(expect.objectContaining({
            status: 'blocked',
            reason: expect.stringContaining('does not match expected'),
        }));
    });

    test('rejects abbreviated or malformed expected hashes', () => {
        expect(assessPromptReconciliation(newHash, oldHash, 'abc123')).toEqual(expect.objectContaining({
            status: 'blocked',
            reason: expect.stringContaining('full 64-character'),
        }));
    });

    test('parses the production guard flag', () => {
        expect(parseArgs(['node', 'script', '--apply', '--expected-db-sha256', oldHash])).toEqual(expect.objectContaining({
            apply: true,
            expectedDbSha256: oldHash,
        }));
    });
});

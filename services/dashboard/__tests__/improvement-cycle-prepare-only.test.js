'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runPrepareOnly } = require('../../../scripts/improvement-cycle');

test('prepare-only seam runs the bounded consumer without health, gate, model, or mail dependencies', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-only-'));
    const artifactsDir = path.join(root, 'artifacts');
    const trigger = jest.fn(async ({ supabase, cycleId, proposalRow, artifactsDir: target }) => {
        expect(supabase).toEqual({ fixture: true });
        expect(cycleId).toBe('fixture-cycle');
        expect(proposalRow).toBeNull();
        fs.writeFileSync(path.join(target, 'fixture-summary.json'), JSON.stringify({ provider_calls: 0 }));
        return { status: 'completed', providerCalls: 0 };
    });
    try {
        await expect(runPrepareOnly({ supabase: { fixture: true }, cycleId: 'fixture-cycle', artifactsDir, trigger })).resolves.toMatchObject({ status: 'completed', providerCalls: 0 });
        expect(trigger).toHaveBeenCalledTimes(1);
        expect(fs.statSync(artifactsDir).isDirectory()).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(artifactsDir, 'fixture-summary.json'), 'utf8')).provider_calls).toBe(0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

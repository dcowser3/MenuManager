const fs = require('fs');
const path = require('path');

const scriptSource = fs.readFileSync(path.resolve(__dirname, '../../../scripts/improvement-cycle.js'), 'utf8');

describe('B6-D2a cycle retirement boundary', () => {
    test('has no script-local status-only retirement filter', () => {
        expect(scriptSource).toContain('replayEvidence.filter(core.isReplayRetirementVerified)');
        expect(scriptSource).toContain('observed_status: observedStatus');
        expect(scriptSource).not.toMatch(/replayEvidence\.filter\(\(entry\)\s*=>\s*entry\?\.status\s*===\s*['"]now_correct['"]\)/);
        expect(scriptSource).not.toMatch(/replayEvidence\.filter\(\(entry\)\s*=>\s*entry\.status\s*===\s*['"]now_correct['"]\)/);
    });
});

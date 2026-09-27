const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');

describe('weekly improvement schedule', () => {
    let fixture;
    beforeEach(() => {
        fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'improvement-schedule-'));
        fs.mkdirSync(path.join(fixture, 'bin'));
        fs.writeFileSync(path.join(fixture, 'bin/date'), '#!/bin/bash\n[[ "$*" == "-u +%u" ]] || exit 1\nprintf "%s\\n" "$TEST_WEEKDAY"\n', { mode: 0o755 });
        fs.writeFileSync(path.join(fixture, 'bin/docker'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$TEST_CALLS"\n', { mode: 0o755 });
    });
    afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

    function run(weekday) {
        return spawnSync('/bin/bash', [path.join(root, 'scripts/run-improvement-cycle-cron.sh')], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${fixture}/bin:${process.env.PATH}`, TEST_WEEKDAY: String(weekday), TEST_CALLS: `${fixture}/calls` },
        });
    }

    test.each([1, 2, 3, 4, 5, 6])('stale daily cron on UTC weekday %i cannot reach the cycle or mail', (weekday) => {
        const result = run(weekday);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('skipping outside Sunday');
        expect(fs.existsSync(`${fixture}/calls`)).toBe(false);
    });

    test('Sunday invokes the container cycle once, without forcing a proposal', () => {
        expect(run(7).status).toBe(0);
        const calls = fs.readFileSync(`${fixture}/calls`, 'utf8');
        expect(calls.match(/node \/app\/scripts\/improvement-cycle.js/g)).toHaveLength(1);
        expect(calls).not.toContain('--force');
    });

    test('deployment installs only the Sunday 09:15 UTC schedule', () => {
        const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-lightsail.yml'), 'utf8');
        expect(workflow).toContain('CRON_LINE="15 9 * * 0 /usr/bin/flock');
        expect(workflow).not.toContain('CRON_LINE="15 9 * * * ');
    });
});

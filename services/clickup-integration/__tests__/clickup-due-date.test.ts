import { clickUpDueDateMillis } from '../lib/clickup-due-date';

describe('clickUpDueDateMillis', () => {
    it('uses noon UTC for YYYY-MM-DD so the calendar day matches the form in US timezones', () => {
        expect(clickUpDueDateMillis('2026-05-12')).toBe(Date.UTC(2026, 4, 12, 12, 0, 0, 0));
    });

    it('does not use UTC midnight for date-only strings (that shifts the shown date earlier)', () => {
        const naiveMidnightUtc = new Date('2026-05-12').getTime();
        const fixed = clickUpDueDateMillis('2026-05-12');
        expect(fixed).not.toBe(naiveMidnightUtc);
        expect(naiveMidnightUtc).toBe(Date.UTC(2026, 4, 12, 0, 0, 0, 0));
    });

    it('returns null for empty input', () => {
        expect(clickUpDueDateMillis('')).toBeNull();
        expect(clickUpDueDateMillis('   ')).toBeNull();
    });

    it('falls back to Date parsing for non ISO-date strings', () => {
        const ms = clickUpDueDateMillis('2026-05-12T00:00:00.000Z');
        expect(ms).toBe(new Date('2026-05-12T00:00:00.000Z').getTime());
    });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const clickup_due_date_1 = require("../lib/clickup-due-date");
describe('clickUpDueDateMillis', () => {
    it('uses noon UTC for YYYY-MM-DD so the calendar day matches the form in US timezones', () => {
        expect((0, clickup_due_date_1.clickUpDueDateMillis)('2026-05-12')).toBe(Date.UTC(2026, 4, 12, 12, 0, 0, 0));
    });
    it('does not use UTC midnight for date-only strings (that shifts the shown date earlier)', () => {
        const naiveMidnightUtc = new Date('2026-05-12').getTime();
        const fixed = (0, clickup_due_date_1.clickUpDueDateMillis)('2026-05-12');
        expect(fixed).not.toBe(naiveMidnightUtc);
        expect(naiveMidnightUtc).toBe(Date.UTC(2026, 4, 12, 0, 0, 0, 0));
    });
    it('returns null for empty input', () => {
        expect((0, clickup_due_date_1.clickUpDueDateMillis)('')).toBeNull();
        expect((0, clickup_due_date_1.clickUpDueDateMillis)('   ')).toBeNull();
    });
    it('falls back to Date parsing for non ISO-date strings', () => {
        const ms = (0, clickup_due_date_1.clickUpDueDateMillis)('2026-05-12T00:00:00.000Z');
        expect(ms).toBe(new Date('2026-05-12T00:00:00.000Z').getTime());
    });
});

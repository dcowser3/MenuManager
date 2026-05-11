/**
 * Convert "Date needed" from the form (`<input type="date">` → `YYYY-MM-DD`) to epoch ms
 * for ClickUp's `due_date` field.
 *
 * `new Date("YYYY-MM-DD")` / `Date.parse` treat date-only strings as **UTC midnight**, which
 * is the **previous calendar day** in Americas timezones when ClickUp (or users) interpret
 * the instant in local time. Using **noon UTC** on the chosen calendar day keeps the due date
 * aligned with what the chef selected in almost all zones.
 */
export function clickUpDueDateMillis(dateNeeded: string): number | null {
    const trimmed = `${dateNeeded || ''}`.trim();
    if (!trimmed) {
        return null;
    }

    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        const y = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10) - 1;
        const d = parseInt(m[3], 10);
        if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) {
            return null;
        }
        return Date.UTC(y, mo, d, 12, 0, 0, 0);
    }

    const t = new Date(trimmed).getTime();
    return Number.isNaN(t) ? null : t;
}

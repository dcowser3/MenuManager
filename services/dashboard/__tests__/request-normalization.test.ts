import { normalizeApprovals } from '../lib/request-normalization';

describe('normalizeApprovals', () => {
    test('trims and lowercases the approver email and coerces approved', () => {
        const result = normalizeApprovals([
            { approved: 'yes', name: '  Grace GM  ', position: 'GM', email: '  Grace@Example.COM ' },
        ]);
        expect(result).toEqual([
            { approved: true, name: 'Grace GM', position: 'GM', email: 'grace@example.com' },
        ]);
    });

    test('coerces approved from boolean and string forms', () => {
        expect(normalizeApprovals([{ approved: true, name: 'A', position: 'P', email: 'a@b.co' }])[0].approved).toBe(true);
        expect(normalizeApprovals([{ approved: 'true', name: 'A', position: 'P', email: 'a@b.co' }])[0].approved).toBe(true);
        expect(normalizeApprovals([{ approved: false, name: 'A', position: 'P', email: 'a@b.co' }])[0].approved).toBe(false);
        expect(normalizeApprovals([{ approved: 'no', name: 'A', position: 'P', email: 'a@b.co' }])[0].approved).toBe(false);
    });

    test('drops fully-empty entries but keeps partially-filled ones', () => {
        const result = normalizeApprovals([
            { approved: false, name: '', position: '', email: '' },
            { approved: true, name: 'Solo Name', position: '', email: '' },
        ]);
        expect(result).toEqual([
            { approved: true, name: 'Solo Name', position: '', email: '' },
        ]);
    });

    test('returns an empty array for non-array input', () => {
        expect(normalizeApprovals(undefined)).toEqual([]);
        expect(normalizeApprovals(null)).toEqual([]);
        expect(normalizeApprovals('nope')).toEqual([]);
    });
});

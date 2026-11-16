'use strict';

const fs = require('fs');
const path = require('path');
const { planRetirement } = require('../../../scripts/lib/submission-retirement');

const strand = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'db', '__fixtures__', 'strand-incident.json'), 'utf8'));
const K = strand.keys;

describe('scripts/retire-submission.js planning (item 7)', () => {
    const cocktail = strand.submissions[K.cocktail];
    const menu = { ...strand.menus[cocktail.menu_id] };
    const bad = { ...cocktail, id: '00000000-0000-0000-0000-0000000bad01', legacy_id: 'form-1794852058559', reviewed_at: '2026-11-16T19:00:00Z' };
    const NOW = '2026-11-17T00:00:00.000Z';

    test('retires the submission and moves the pointer back to the newest other approved version in the same plan', () => {
        const plan = planRetirement({
            submission: bad,
            menu: { ...menu, current_submission_id: bad.legacy_id },
            menuVersions: [cocktail, bad],
            now: NOW,
        });
        expect(plan.submissionUpdate).toEqual({ status: 'deleted', updated_at: NOW, expectedStatus: 'approved' });
        expect(plan.menuUpdate).toEqual({ menuId: menu.id, expectedPointer: bad.legacy_id, current_submission_id: K.cocktail, updated_at: NOW });
    });

    test('matches a pointer stored in the uuid form', () => {
        const plan = planRetirement({ submission: bad, menu: { ...menu, current_submission_id: bad.id }, menuVersions: [cocktail, bad], now: NOW });
        expect(plan.menuUpdate.current_submission_id).toBe(K.cocktail);
    });

    test('an already-deleted row still gets its dangling pointer repaired', () => {
        const plan = planRetirement({ submission: { ...bad, status: 'deleted' }, menu: { ...menu, current_submission_id: bad.legacy_id }, menuVersions: [cocktail, bad], now: NOW });
        expect(plan.submissionUpdate).toBeNull();
        expect(plan.menuUpdate.current_submission_id).toBe(K.cocktail);
    });

    test('leaves an unrelated pointer alone and clears the pointer when no approved version remains', () => {
        expect(planRetirement({ submission: bad, menu, menuVersions: [cocktail, bad], now: NOW }).menuUpdate).toBeNull();
        const only = planRetirement({ submission: bad, menu: { ...menu, current_submission_id: bad.legacy_id }, menuVersions: [bad, { ...cocktail, status: 'deleted' }], now: NOW });
        expect(only.menuUpdate.current_submission_id).toBeNull();
    });

    test('the script is dry run by default and only writes with --apply', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'retire-submission.js'), 'utf8');
        expect(source).toContain("const apply = args.includes('--apply');");
        expect(source).toMatch(/if \(!apply\) \{\n\s+console\.log\('\\nDry run only/);
        expect(source.indexOf('if (!apply)')).toBeLessThan(source.indexOf(".update("));
    });
});

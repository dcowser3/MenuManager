import fs from 'fs';
import path from 'path';
import { detectNotNullDrift } from '../lib/schema-drift';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('detectNotNullDrift', () => {
    test('flags a required column that must be nullable', () => {
        expect(detectNotNullDrift(['original_text', 'submission_id'], ['original_text', 'corrected_text']))
            .toEqual(['original_text']);
    });

    test('flags every violated column, preserving the requested order', () => {
        expect(detectNotNullDrift(['corrected_text', 'original_text'], ['original_text', 'corrected_text']))
            .toEqual(['original_text', 'corrected_text']);
    });

    test('returns empty when the must-be-nullable columns are absent from required', () => {
        expect(detectNotNullDrift(['submission_id', 'rule'], ['original_text', 'corrected_text']))
            .toEqual([]);
    });

    test('returns empty for an empty required list (spec parsed but no NOT NULL columns)', () => {
        expect(detectNotNullDrift([], ['original_text', 'corrected_text'])).toEqual([]);
    });
});

describe('correction_rules NOT NULL drop is committed as a migration', () => {
    // The freeform-rule incident (July 2026): original_text/corrected_text must be
    // nullable, but the applied menu-scope migration omitted the DROP NOT NULL.
    // Guard that a migration re-asserting the drop exists so a fresh DB is correct.
    const migrationDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const combined = fs.readdirSync(migrationDir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => fs.readFileSync(path.join(migrationDir, f), 'utf8'))
        .join('\n');

    for (const column of ['original_text', 'corrected_text']) {
        test(`a migration drops NOT NULL on correction_rules.${column}`, () => {
            const dropNotNull = new RegExp(`ALTER\\s+COLUMN\\s+${column}\\s+DROP\\s+NOT\\s+NULL`, 'i');
            expect(dropNotNull.test(combined)).toBe(true);
        });
    }
});

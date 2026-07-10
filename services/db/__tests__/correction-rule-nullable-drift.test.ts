import fs from 'fs';
import path from 'path';
import {
    detectNotNullDrift,
    parseSchemaSql,
    parseOpenApiSpec,
    diffSchemas,
    diffNullableConstraints,
} from '../lib/schema-drift';

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

const SAMPLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS correction_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id VARCHAR(100) NOT NULL,
    original_text TEXT,
    corrected_text TEXT,
    rule TEXT NOT NULL,
    applies_to_menu_type VARCHAR(50) DEFAULT 'all' NOT NULL,
    CONSTRAINT correction_rules_applies_to_menu_type_check
        CHECK (applies_to_menu_type IN ('all', 'food', 'beverage')),
    confidence NUMERIC(4,3),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE basic_ai_check_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_content_raw TEXT,
    submission_id VARCHAR(100)
);
`;

describe('parseSchemaSql', () => {
    const parsed = parseSchemaSql(SAMPLE_SCHEMA);

    test('reads columns for each table and drops table-level constraint clauses', () => {
        const cr = parsed.get('correction_rules')!;
        expect(cr.columns.has('submission_id')).toBe(true);
        expect(cr.columns.has('original_text')).toBe(true);
        expect(cr.columns.has('confidence')).toBe(true);
        // CONSTRAINT ... CHECK (...) is not a column
        expect(cr.columns.has('CONSTRAINT')).toBe(false);
        expect(cr.columns.has('correction_rules_applies_to_menu_type_check')).toBe(false);
    });

    test('classifies NOT-NULL-without-default columns as required, but not those with a default', () => {
        const cr = parsed.get('correction_rules')!;
        expect(cr.requiredNoDefault.has('submission_id')).toBe(true); // NOT NULL, no default
        expect(cr.requiredNoDefault.has('rule')).toBe(true);
        expect(cr.requiredNoDefault.has('applies_to_menu_type')).toBe(false); // NOT NULL but has DEFAULT
        expect(cr.requiredNoDefault.has('original_text')).toBe(false); // nullable
        expect(cr.requiredNoDefault.has('id')).toBe(false); // PK with default
    });

    test('parses a second table', () => {
        expect(parsed.get('basic_ai_check_audits')!.columns.has('menu_content_raw')).toBe(true);
    });
});

describe('parseOpenApiSpec', () => {
    test('extracts columns and required from Swagger 2.0 definitions', () => {
        const spec = {
            definitions: {
                correction_rules: {
                    properties: { submission_id: {}, original_text: {}, rule: {} },
                    required: ['submission_id', 'original_text', 'rule'],
                },
            },
        };
        const live = parseOpenApiSpec(spec);
        expect(live.get('correction_rules')!.columns.has('original_text')).toBe(true);
        expect(live.get('correction_rules')!.required.has('original_text')).toBe(true);
    });

    test('supports OpenAPI 3 components.schemas and tolerates a malformed spec', () => {
        expect(parseOpenApiSpec({ components: { schemas: { t: { properties: { a: {} } } } } }).get('t')!.columns.has('a')).toBe(true);
        expect(parseOpenApiSpec(null).size).toBe(0);
        expect(parseOpenApiSpec({}).size).toBe(0);
    });
});

describe('diffSchemas', () => {
    const expected = parseSchemaSql(SAMPLE_SCHEMA);

    test('no findings when live matches schema.sql', () => {
        const live = parseOpenApiSpec({
            definitions: {
                correction_rules: {
                    properties: { submission_id: {}, original_text: {}, corrected_text: {}, rule: {}, applies_to_menu_type: {}, confidence: {}, id: {}, created_at: {} },
                    required: ['submission_id', 'rule'],
                },
                basic_ai_check_audits: {
                    properties: { menu_content_raw: {}, submission_id: {}, id: {} },
                    required: [],
                },
            },
        });
        expect(diffSchemas(expected, live)).toEqual([]);
    });

    test('does NOT flag a defaulted/PK column that PostgREST reports as required', () => {
        // Regression guard: PostgREST lists NOT-NULL-with-default columns (id, PK,
        // status DEFAULT ...) in `required`. diffSchemas must not treat those as
        // drift — that produced 17 false positives against the live DB.
        const live = parseOpenApiSpec({
            definitions: {
                correction_rules: {
                    properties: { submission_id: {}, original_text: {}, corrected_text: {}, rule: {}, applies_to_menu_type: {}, confidence: {}, id: {}, created_at: {} },
                    required: ['submission_id', 'rule', 'id', 'applies_to_menu_type'], // id + defaulted col reported required
                },
                basic_ai_check_audits: { properties: { menu_content_raw: {}, submission_id: {}, id: {} }, required: ['id'] },
            },
        });
        expect(diffSchemas(expected, live)).toEqual([]);
    });

    test('flags a missing column and a missing table as errors', () => {
        const live = parseOpenApiSpec({
            definitions: {
                correction_rules: {
                    // confidence column absent live
                    properties: { submission_id: {}, original_text: {}, corrected_text: {}, rule: {}, applies_to_menu_type: {}, id: {}, created_at: {} },
                    required: ['submission_id', 'rule'],
                },
                // basic_ai_check_audits table absent live entirely
            },
        });
        const findings = diffSchemas(expected, live);
        expect(findings).toContainEqual(expect.objectContaining({ table: 'correction_rules', column: 'confidence', kind: 'missing_column', severity: 'error' }));
        expect(findings).toContainEqual(expect.objectContaining({ table: 'basic_ai_check_audits', kind: 'missing_table', severity: 'error' }));
    });

    test('honours the ignore-tables set', () => {
        const live = parseOpenApiSpec({ definitions: {} });
        const findings = diffSchemas(expected, live, new Set(['correction_rules', 'basic_ai_check_audits']));
        expect(findings).toEqual([]);
    });
});

describe('diffNullableConstraints', () => {
    const nullableMap = { correction_rules: ['original_text', 'corrected_text'] };

    test('flags a curated must-be-nullable column that is required live (the July 2026 incident)', () => {
        const live = parseOpenApiSpec({
            definitions: {
                correction_rules: { properties: { original_text: {}, corrected_text: {} }, required: ['original_text'] },
            },
        });
        const findings = diffNullableConstraints(live, nullableMap);
        expect(findings).toContainEqual(expect.objectContaining({
            table: 'correction_rules', column: 'original_text', kind: 'unexpected_not_null', severity: 'error',
        }));
    });

    test('no findings once the constraint is dropped', () => {
        const live = parseOpenApiSpec({
            definitions: { correction_rules: { properties: { original_text: {}, corrected_text: {} }, required: [] } },
        });
        expect(diffNullableConstraints(live, nullableMap)).toEqual([]);
    });

    test('skips a table absent live (that is diffSchemas job) and honours ignore set', () => {
        expect(diffNullableConstraints(parseOpenApiSpec({ definitions: {} }), nullableMap)).toEqual([]);
        const live = parseOpenApiSpec({ definitions: { correction_rules: { properties: { original_text: {} }, required: ['original_text'] } } });
        expect(diffNullableConstraints(live, nullableMap, new Set(['correction_rules']))).toEqual([]);
    });
});

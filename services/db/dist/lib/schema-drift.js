"use strict";
// Pure Supabase schema-drift helpers, kept side-effect-free so they can be unit
// tested without loading the db service's Express app / Supabase client. Consumed
// both by the db service boot check (verifyCriticalSupabaseSchema) and by the
// standalone pre-deploy gate (scripts/check-schema-drift.js, via the compiled
// dist of this file).
Object.defineProperty(exports, "__esModule", { value: true });
exports.NULLABLE_COLUMNS = void 0;
exports.detectNotNullDrift = detectNotNullDrift;
exports.parseSchemaSql = parseSchemaSql;
exports.parseOpenApiSpec = parseOpenApiSpec;
exports.diffSchemas = diffSchemas;
exports.diffNullableConstraints = diffNullableConstraints;
// Columns that MUST be nullable, per table. Kept as a curated list because it is
// the ONLY reliable way to detect a stale NOT NULL constraint via PostgREST: its
// OpenAPI `required` array lists every NOT NULL column *including those with a
// default*, so a schema-wide "required but should be nullable" inference produces
// false positives on every PK / defaulted column. These columns have no default,
// so their presence in `required` genuinely means a stale NOT NULL constraint.
// Shared by the db boot check and the pre-deploy gate. Add an entry when a column
// must accept null (e.g. a freeform / optional field).
exports.NULLABLE_COLUMNS = {
    correction_rules: ['original_text', 'corrected_text'],
};
// Given the columns PostgREST marks `required` and the columns we require to be
// nullable, return the ones in violation (a stale NOT NULL constraint). Order
// follows `mustBeNullable`. Reliable only for no-default columns (see NULLABLE_COLUMNS).
function detectNotNullDrift(requiredColumns, mustBeNullable) {
    const required = new Set(requiredColumns);
    return mustBeNullable.filter((col) => required.has(col));
}
const CONSTRAINT_KEYWORDS = /^(constraint|primary|foreign|unique|check|exclude|like)\b/i;
// Split a CREATE TABLE column list on top-level commas only — i.e. commas that are
// not inside parentheses (types like NUMERIC(4,3), CHECK (x IN ('a','b'))).
function splitTopLevel(body) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of body) {
        if (ch === '(')
            depth += 1;
        else if (ch === ')')
            depth -= 1;
        if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
        }
        else {
            current += ch;
        }
    }
    if (current.trim())
        parts.push(current);
    return parts;
}
function stripIdentifierQuotes(name) {
    return name.replace(/^"(.*)"$/, '$1');
}
// Parse the CREATE TABLE statements in a schema.sql dump into the expected shape.
// Best-effort and conservative: it reads column names, NOT NULL, and DEFAULT from
// inline column definitions and skips table-level constraint clauses. It does not
// try to model ALTERs, indexes, or foreign keys — the gate targets the missing
// column / stale-nullability drift class, not full schema equivalence.
function parseSchemaSql(sql) {
    const tables = new Map();
    // Match CREATE TABLE [IF NOT EXISTS] name ( ... ) up to the matching close+semicolon.
    const createRe = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_."]+)\s*\(([\s\S]*?)\n\)\s*;/gi;
    let match;
    while ((match = createRe.exec(sql)) !== null) {
        const table = stripIdentifierQuotes(match[1].trim()).replace(/^[^.]*\./, ''); // drop schema prefix
        // Strip line comments BEFORE splitting: schema.sql comments contain commas
        // (e.g. `-- 'diacritic', 'spelling'`) that would otherwise fragment the
        // top-level comma split and drop the column that shares the line.
        const body = match[2].replace(/--[^\n]*/g, '');
        const columns = new Set();
        const requiredNoDefault = new Set();
        for (const rawItem of splitTopLevel(body)) {
            const item = rawItem.trim();
            if (!item || CONSTRAINT_KEYWORDS.test(item))
                continue;
            const nameToken = item.split(/\s+/)[0];
            const column = stripIdentifierQuotes(nameToken);
            if (!/^[A-Za-z0-9_]+$/.test(column))
                continue;
            columns.add(column);
            const isNotNull = /\bNOT\s+NULL\b/i.test(item);
            const hasDefault = /\bDEFAULT\b/i.test(item);
            const isSerial = /\b(serial|bigserial|generated\s+(always|by\s+default))\b/i.test(item);
            if (isNotNull && !hasDefault && !isSerial)
                requiredNoDefault.add(column);
        }
        if (columns.size > 0)
            tables.set(table, { columns, requiredNoDefault });
    }
    return tables;
}
// Parse a PostgREST OpenAPI/Swagger spec into the live shape. NOT-NULL-without-
// default columns appear in each table definition's `required` array.
function parseOpenApiSpec(spec) {
    const out = new Map();
    const defs = spec?.definitions || spec?.components?.schemas;
    if (!defs || typeof defs !== 'object')
        return out;
    for (const [table, def] of Object.entries(defs)) {
        const properties = def?.properties && typeof def.properties === 'object' ? Object.keys(def.properties) : [];
        const required = Array.isArray(def?.required) ? def.required.filter((c) => typeof c === 'string') : [];
        out.set(table, { columns: new Set(properties), required: new Set(required) });
    }
    return out;
}
// Compare the expected (repo schema.sql) against the live (PostgREST) schema.
// Scoped to the two signals PostgREST reports RELIABLY: table existence and column
// existence. (Schema-wide nullability is intentionally NOT compared here — see
// NULLABLE_COLUMNS / diffNullableConstraints for the curated, reliable NOT NULL
// check.) All findings are errors: a table/column present in schema.sql but absent
// live means a migration was not applied, and writes touching it fall to the local
// JSON fallback.
function diffSchemas(expected, live, ignoreTables = new Set()) {
    const findings = [];
    for (const [table, expectedSchema] of expected) {
        if (ignoreTables.has(table))
            continue;
        const liveSchema = live.get(table);
        if (!liveSchema) {
            findings.push({
                table,
                kind: 'missing_table',
                severity: 'error',
                message: `Table "${table}" exists in schema.sql but is not present in the live database — a migration was not applied.`,
            });
            continue;
        }
        for (const column of expectedSchema.columns) {
            if (!liveSchema.columns.has(column)) {
                findings.push({
                    table,
                    column,
                    kind: 'missing_column',
                    severity: 'error',
                    message: `Column "${table}.${column}" exists in schema.sql but is missing live — a migration was not applied. Writes touching it fall to the local JSON fallback, invisible to the improvement cycle.`,
                });
            }
        }
    }
    return findings;
}
// Curated NOT NULL drift: for columns that must accept null (NULLABLE_COLUMNS),
// flag any that the live DB still marks required (a stale NOT NULL constraint — the
// July 2026 incident). Reliable because these columns have no default. Errors:
// they block inserts that leave the column null and divert them to the fallback.
function diffNullableConstraints(live, nullableColumns = exports.NULLABLE_COLUMNS, ignoreTables = new Set()) {
    const findings = [];
    for (const [table, mustBeNullable] of Object.entries(nullableColumns)) {
        if (ignoreTables.has(table))
            continue;
        const liveSchema = live.get(table);
        if (!liveSchema)
            continue; // absence is diffSchemas' job
        for (const column of detectNotNullDrift([...liveSchema.required], mustBeNullable)) {
            findings.push({
                table,
                column,
                kind: 'unexpected_not_null',
                severity: 'error',
                message: `Column "${table}.${column}" has a NOT NULL constraint live, but must be nullable — a DROP NOT NULL migration was not applied. Inserts that leave it null fail and fall to the local JSON fallback.`,
            });
        }
    }
    return findings;
}

import fs from 'fs';
import path from 'path';

/**
 * F1 guard: every column listed in CRITICAL_SUPABASE_SCHEMA must appear in at least one
 * supabase migration or schema.sql (prevents "code expects column, migration forgotten").
 */
const REPO_ROOT = path.resolve(__dirname, '../../..');

const CRITICAL_SUPABASE_SCHEMA: Record<string, string[]> = {
    correction_rules: ['applies_to_menu_type', 'prompt_cycle_id', 'consumed_at', 'submission_ids'],
    submissions: ['form_attempt_id', 'approved_menu_content', 'approved_menu_content_html', 'menu_id'],
    menus: ['property', 'service_period', 'name', 'current_submission_id', 'status'],
    draft_sessions: ['menu_id'],
    basic_ai_check_audits: ['menu_content_raw', 'submission_id'],
    prompt_proposals: [
        'proposed_rules', 'eval_status', 'accepted_rules', 'source', 'llm_warnings',
        'replay_evidence', 'unresolved_still_missed', 'coverage_claims', 'prompt_length',
        'superseded_by_cycle_id', 'superseded_from_cycle_id',
        'supersede_carried_correction_count', 'supersede_new_correction_count',
    ],
};

function loadSchemaSqlText(): string {
    const schemaPath = path.join(REPO_ROOT, 'supabase', 'schema.sql');
    return fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : '';
}

function loadMigrationSqlText(): string {
    const dir = path.join(REPO_ROOT, 'supabase', 'migrations');
    if (!fs.existsSync(dir)) return '';
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
        .join('\n');
}

function columnDeclaredInSql(column: string, table: string, sqlBlob: string): boolean {
    const col = column.toLowerCase();
    const tbl = table.toLowerCase();
    // ADD COLUMN name / ADD COLUMN IF NOT EXISTS name
    const addCol = new RegExp(`ADD\\s+COLUMN(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${col}\\b`, 'i');
    // CREATE TABLE ... ( ... col ... ) — loose match within table block
    const createTable = new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${tbl}[\\s\\S]*?\\b${col}\\b`, 'i');
    return addCol.test(sqlBlob) || createTable.test(sqlBlob);
}

describe('CRITICAL_SUPABASE_SCHEMA migration coverage (F1)', () => {
    const schemaSql = loadSchemaSqlText();
    const migrationSql = loadMigrationSqlText();
    const combined = `${schemaSql}\n${migrationSql}`;

    for (const [table, columns] of Object.entries(CRITICAL_SUPABASE_SCHEMA)) {
        for (const column of columns) {
            test(`${table}.${column} is declared in supabase/migrations or schema.sql`, () => {
                expect(columnDeclaredInSql(column, table, combined)).toBe(true);
            });
        }
    }
});

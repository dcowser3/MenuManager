import fs from 'fs';
import os from 'os';
import path from 'path';
import * as promptSync from '../lib/prompt-sync';

const { decidePromptSync, parsePromptLineage, promptSha256, loadPromptLineage } = promptSync;
const { runPromptDeploySync } = require(path.resolve(process.cwd(), 'scripts/sync-prompt-on-deploy.js'));

// Prod ran the Jul 30 2026 prompt until Oct 13 because the startup sync always restored
// the DB's approved copy over repo edits. These pin the replacement rules.
const JUL30 = 'prompt as of Jul 30';
const SEP26 = 'prompt as of Sep 26 (allergen codes are suggestions only)';
const DASHBOARD_APPROVAL = 'prompt approved in the dashboard, never committed';
const lineage = new Set([promptSha256(JUL30), promptSha256(SEP26)]);

describe('decidePromptSync', () => {
    test('same text is in sync', () => {
        expect(decidePromptSync({ filePrompt: SEP26, dbPrompt: SEP26, lineage })).toEqual({ action: 'in_sync', reason: 'same_text' });
    });

    test('keeps the repo file when the DB copy is an older repo version (the Jul 30 case)', () => {
        expect(decidePromptSync({ filePrompt: SEP26, dbPrompt: JUL30, lineage })).toEqual({ action: 'keep_file', reason: 'repo_supersedes_db' });
    });

    test('keeps a dashboard approval git has never seen', () => {
        expect(decidePromptSync({ filePrompt: SEP26, dbPrompt: DASHBOARD_APPROVAL, lineage })).toEqual({ action: 'restore_db', reason: 'db_not_in_repo_history' });
    });

    test('falls back to the DB copy when there is no lineage', () => {
        expect(decidePromptSync({ filePrompt: SEP26, dbPrompt: JUL30, lineage: null })).toEqual({ action: 'restore_db', reason: 'no_lineage' });
        expect(decidePromptSync({ filePrompt: SEP26, dbPrompt: JUL30, lineage: new Set() })).toEqual({ action: 'restore_db', reason: 'no_lineage' });
    });

    test('keeps the file when nothing is approved yet', () => {
        expect(decidePromptSync({ filePrompt: SEP26, dbPrompt: null, lineage })).toEqual({ action: 'keep_file', reason: 'no_approved_prompt' });
    });
});

describe('prompt lineage', () => {
    test('parses one sha256 per line and ignores everything else', () => {
        const hash = promptSha256('x');
        expect([...parsePromptLineage(`${hash}\n\nnot-a-hash\n${hash.toUpperCase()}\r\n`)]).toEqual([hash]);
    });

    test('prefers the deploy-written lineage file', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-'));
        fs.writeFileSync(path.join(dir, promptSync.PROMPT_LINEAGE_FILE_NAME), `${promptSha256(JUL30)}\n`);
        const loaded = loadPromptLineage('/nonexistent-repo', dir);
        expect(loaded?.source).toBe('deploy_file');
        expect(loaded?.hashes.has(promptSha256(JUL30))).toBe(true);
    });

    test('returns null when neither the file nor git is available', () => {
        expect(loadPromptLineage('/nonexistent-repo', '/nonexistent-tmp')).toBeNull();
    });
});

describe('sync-prompt-on-deploy', () => {
    const fakeSupabase = (approvedPrompt: string | null) => {
        const inserted: Record<string, any[]> = { prompt_proposals: [], system_alerts: [] };
        const rows = approvedPrompt === null ? [] : [{ id: 'proposal-1', cycle_id: 'c', status: 'approved', final_prompt: approvedPrompt, reviewed_at: '2026-09-21T22:13:04Z' }];
        const query: any = { select: () => query, in: () => query, order: () => query, limit: async () => ({ data: rows, error: null }) };
        return {
            inserted,
            from: (table: string) => ({
                ...query,
                insert: async (row: any) => { inserted[table].push(row); return { error: null }; },
            }),
        };
    };
    const run = (supabase: any, filePrompt: string, withLineage = true, dryRun = false) => runPromptDeploySync({
        dryRun, supabase, filePrompt, lib: promptSync, commit: 'abc1234',
        lineage: withLineage ? { hashes: lineage, source: 'deploy_file' } : null,
    });

    beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    test('pins the repo prompt when the DB holds an older repo version', async () => {
        const supabase = fakeSupabase(JUL30);
        const result = await run(supabase, SEP26);
        expect(result.pinned).toBe(true);
        expect(supabase.inserted.prompt_proposals).toEqual([expect.objectContaining({
            status: 'approved', final_prompt: SEP26, current_prompt: JUL30, source: 'repo_deploy',
            cycle_id: expect.stringMatching(/^repo-deploy-/),
        })]);
        expect(supabase.inserted.system_alerts).toEqual([]);
    });

    test('a dry run writes nothing', async () => {
        const supabase = fakeSupabase(JUL30);
        expect((await run(supabase, SEP26, true, true)).pinned).toBe(false);
        expect(supabase.inserted.prompt_proposals).toEqual([]);
    });

    test('does nothing when already in sync', async () => {
        const supabase = fakeSupabase(SEP26);
        expect((await run(supabase, SEP26)).pinned).toBe(false);
        expect(supabase.inserted).toEqual({ prompt_proposals: [], system_alerts: [] });
    });

    test('alerts instead of overwriting a dashboard approval git has never seen', async () => {
        const supabase = fakeSupabase(DASHBOARD_APPROVAL);
        expect((await run(supabase, SEP26)).pinned).toBe(false);
        expect(supabase.inserted.prompt_proposals).toEqual([]);
        expect(supabase.inserted.system_alerts).toEqual([expect.objectContaining({
            alert_type: 'qa_prompt_not_in_git', service: 'deploy',
            message: expect.stringContaining('commit-runtime-prompt.js --pull'),
        })]);
    });

    test('never pins without lineage', async () => {
        const supabase = fakeSupabase(JUL30);
        expect((await run(supabase, SEP26, false)).pinned).toBe(false);
        expect(supabase.inserted.prompt_proposals).toEqual([]);
    });
});

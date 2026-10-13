"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const promptSync = __importStar(require("../lib/prompt-sync"));
const { decidePromptSync, parsePromptLineage, promptSha256, loadPromptLineage } = promptSync;
const { runPromptDeploySync } = require(path_1.default.resolve(process.cwd(), 'scripts/sync-prompt-on-deploy.js'));
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
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'lineage-'));
        fs_1.default.writeFileSync(path_1.default.join(dir, promptSync.PROMPT_LINEAGE_FILE_NAME), `${promptSha256(JUL30)}\n`);
        const loaded = loadPromptLineage('/nonexistent-repo', dir);
        expect(loaded?.source).toBe('deploy_file');
        expect(loaded?.hashes.has(promptSha256(JUL30))).toBe(true);
    });
    test('returns null when neither the file nor git is available', () => {
        expect(loadPromptLineage('/nonexistent-repo', '/nonexistent-tmp')).toBeNull();
    });
});
describe('sync-prompt-on-deploy', () => {
    const fakeSupabase = (approvedPrompt) => {
        const inserted = { prompt_proposals: [], system_alerts: [] };
        const rows = approvedPrompt === null ? [] : [{ id: 'proposal-1', cycle_id: 'c', status: 'approved', final_prompt: approvedPrompt, reviewed_at: '2026-09-21T22:13:04Z' }];
        const query = { select: () => query, in: () => query, order: () => query, limit: async () => ({ data: rows, error: null }) };
        return {
            inserted,
            from: (table) => ({
                ...query,
                insert: async (row) => { inserted[table].push(row); return { error: null }; },
            }),
        };
    };
    const run = (supabase, filePrompt, withLineage = true, dryRun = false) => runPromptDeploySync({
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

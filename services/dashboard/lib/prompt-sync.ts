/**
 * Which QA prompt should the runtime use: the repo's sop-processor/qa_prompt.txt or the
 * latest approved row in prompt_proposals?
 *
 * The old rule was "the DB always wins". Every repo edit to the prompt was therefore
 * reverted on the next deploy, and prod ran the Jul 30 2026 prompt until Oct 13 while
 * seven repo prompt commits (including "allergen codes are suggestions only") never
 * reached the model. Dashboard approvals then re-stamped that stale copy as "latest".
 *
 * The rule now uses the repo's history of the prompt file ("lineage": the sha256 of
 * every committed version):
 *   - same text                       -> in sync
 *   - DB text is in the repo history  -> the repo already has it and moved on: keep the
 *                                        repo file (the deploy step pins it in the DB)
 *   - DB text is NOT in the history   -> a dashboard approval git has never seen: keep
 *                                        the DB copy and raise an alert to commit it
 *   - no lineage available            -> previous behavior (DB wins), with a warning
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

export const PROMPT_LINEAGE_FILE_NAME = 'prompt-lineage.txt';
export const QA_PROMPT_REPO_PATH = 'sop-processor/qa_prompt.txt';

export type PromptSyncDecision =
    | { action: 'in_sync'; reason: 'same_text' }
    | { action: 'keep_file'; reason: 'no_approved_prompt' | 'repo_supersedes_db' }
    | { action: 'restore_db'; reason: 'db_not_in_repo_history' | 'no_lineage' };

export function promptSha256(text: string): string {
    return crypto.createHash('sha256').update(`${text ?? ''}`, 'utf8').digest('hex');
}

export function decidePromptSync(params: {
    filePrompt: string;
    dbPrompt: string | null;
    lineage: Set<string> | null;
}): PromptSyncDecision {
    const dbPrompt = `${params.dbPrompt ?? ''}`;
    if (!dbPrompt.trim()) return { action: 'keep_file', reason: 'no_approved_prompt' };
    const dbHash = promptSha256(dbPrompt);
    if (promptSha256(params.filePrompt) === dbHash) return { action: 'in_sync', reason: 'same_text' };
    if (!params.lineage || params.lineage.size === 0) return { action: 'restore_db', reason: 'no_lineage' };
    if (params.lineage.has(dbHash)) return { action: 'keep_file', reason: 'repo_supersedes_db' };
    return { action: 'restore_db', reason: 'db_not_in_repo_history' };
}

/** One sha256 per line; anything else is ignored. */
export function parsePromptLineage(text: string): Set<string> {
    const hashes = new Set<string>();
    for (const line of `${text || ''}`.split(/\r?\n/)) {
        const value = line.trim().toLowerCase();
        if (/^[a-f0-9]{64}$/.test(value)) hashes.add(value);
    }
    return hashes;
}

/**
 * Hashes of every committed version of the prompt. Production reads the file the
 * deploy writes into the shared tmp volume (the image has no .git); local checkouts
 * fall back to git directly.
 */
export function loadPromptLineage(repoRoot: string, tmpDir = path.join(repoRoot, 'tmp')): { hashes: Set<string>; source: 'deploy_file' | 'git' } | null {
    try {
        const fromFile = parsePromptLineage(fs.readFileSync(path.join(tmpDir, PROMPT_LINEAGE_FILE_NAME), 'utf8'));
        if (fromFile.size) return { hashes: fromFile, source: 'deploy_file' };
    } catch {
        // No deploy-written lineage; try git.
    }
    try {
        const commits = execFileSync('git', ['log', '--format=%H', '--', QA_PROMPT_REPO_PATH], {
            cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000,
        }).split('\n').map((line) => line.trim()).filter(Boolean);
        const hashes = new Set<string>();
        for (const commit of commits) {
            const content = execFileSync('git', ['show', `${commit}:${QA_PROMPT_REPO_PATH}`], {
                cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, maxBuffer: 16 * 1024 * 1024,
            });
            hashes.add(promptSha256(content));
        }
        return hashes.size ? { hashes, source: 'git' } : null;
    } catch {
        return null;
    }
}

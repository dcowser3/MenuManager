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
Object.defineProperty(exports, "__esModule", { value: true });
exports.QA_PROMPT_REPO_PATH = exports.PROMPT_LINEAGE_FILE_NAME = void 0;
exports.promptSha256 = promptSha256;
exports.decidePromptSync = decidePromptSync;
exports.parsePromptLineage = parsePromptLineage;
exports.loadPromptLineage = loadPromptLineage;
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
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
exports.PROMPT_LINEAGE_FILE_NAME = 'prompt-lineage.txt';
exports.QA_PROMPT_REPO_PATH = 'sop-processor/qa_prompt.txt';
function promptSha256(text) {
    return crypto.createHash('sha256').update(`${text ?? ''}`, 'utf8').digest('hex');
}
function decidePromptSync(params) {
    const dbPrompt = `${params.dbPrompt ?? ''}`;
    if (!dbPrompt.trim())
        return { action: 'keep_file', reason: 'no_approved_prompt' };
    const dbHash = promptSha256(dbPrompt);
    if (promptSha256(params.filePrompt) === dbHash)
        return { action: 'in_sync', reason: 'same_text' };
    if (!params.lineage || params.lineage.size === 0)
        return { action: 'restore_db', reason: 'no_lineage' };
    if (params.lineage.has(dbHash))
        return { action: 'keep_file', reason: 'repo_supersedes_db' };
    return { action: 'restore_db', reason: 'db_not_in_repo_history' };
}
/** One sha256 per line; anything else is ignored. */
function parsePromptLineage(text) {
    const hashes = new Set();
    for (const line of `${text || ''}`.split(/\r?\n/)) {
        const value = line.trim().toLowerCase();
        if (/^[a-f0-9]{64}$/.test(value))
            hashes.add(value);
    }
    return hashes;
}
/**
 * Hashes of every committed version of the prompt. Production reads the file the
 * deploy writes into the shared tmp volume (the image has no .git); local checkouts
 * fall back to git directly.
 */
function loadPromptLineage(repoRoot, tmpDir = path.join(repoRoot, 'tmp')) {
    try {
        const fromFile = parsePromptLineage(fs.readFileSync(path.join(tmpDir, exports.PROMPT_LINEAGE_FILE_NAME), 'utf8'));
        if (fromFile.size)
            return { hashes: fromFile, source: 'deploy_file' };
    }
    catch {
        // No deploy-written lineage; try git.
    }
    try {
        const commits = (0, child_process_1.execFileSync)('git', ['log', '--format=%H', '--', exports.QA_PROMPT_REPO_PATH], {
            cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000,
        }).split('\n').map((line) => line.trim()).filter(Boolean);
        const hashes = new Set();
        for (const commit of commits) {
            const content = (0, child_process_1.execFileSync)('git', ['show', `${commit}:${exports.QA_PROMPT_REPO_PATH}`], {
                cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, maxBuffer: 16 * 1024 * 1024,
            });
            hashes.add(promptSha256(content));
        }
        return hashes.size ? { hashes, source: 'git' } : null;
    }
    catch {
        return null;
    }
}

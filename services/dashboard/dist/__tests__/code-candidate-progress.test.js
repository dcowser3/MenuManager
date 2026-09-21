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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const code_candidate_progress_1 = require("../lib/code-candidate-progress");
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-b6-c-progress-'));
    const artifactDirectory = path.join(root, 'tmp', 'code-proposals', 'attempt-1');
    fs.mkdirSync(path.join(artifactDirectory, 'candidate'), { recursive: true });
    return { root, artifactDirectory };
}
function candidate(artifactDirectory, progress = null) {
    return {
        attempt_id: 'attempt-1',
        artifact_directory: artifactDirectory,
        progress,
        proof: { valid: true, owner: 'attempt-1' },
    };
}
function writeProgress(artifactDirectory, progress, fileName = 'progress.json') {
    fs.writeFileSync(path.join(artifactDirectory, 'candidate', fileName), JSON.stringify(progress));
}
describe('B6-C attempt-bound candidate progress reader', () => {
    let root = '';
    let artifactDirectory = '';
    beforeEach(() => {
        ({ root, artifactDirectory } = fixture());
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });
    test('returns null for absent candidates and missing owning progress', () => {
        expect((0, code_candidate_progress_1.readCodeCandidateProgress)(null, root)).toBeNull();
        expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory), root)).toBeNull();
        expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory, { attempt_id: 'other' }), root)).toBeNull();
    });
    test('accepts a real progress file only under the canonical trusted root', () => {
        const stored = { attempt_id: 'attempt-1', phase: 'analysis', state: 'active', completed: 1, total: 3 };
        const current = { attempt_id: 'attempt-1', phase: 'verification', state: 'waiting_on_model', completed: 2, total: 4, updated_at: '2026-09-20T12:00:00Z' };
        writeProgress(artifactDirectory, current);
        expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory, stored), root)).toMatchObject({
            attemptId: 'attempt-1', phase: 'verification', state: 'waiting_on_model', completed: 2, total: 4,
        });
    });
    test('outside-root, symlink, oversize, and malformed files fall back only to the owning stored attempt', () => {
        const stored = { attempt_id: 'attempt-1', phase: 'draft', state: 'active', completed: 3, total: 5 };
        const owner = candidate(artifactDirectory, stored);
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-b6-c-outside-'));
        try {
            writeProgress(artifactDirectory, stored);
            const outsideArtifact = path.join(outside, 'candidate');
            fs.mkdirSync(outsideArtifact, { recursive: true });
            fs.writeFileSync(path.join(outsideArtifact, 'progress.json'), JSON.stringify({ attempt_id: 'attempt-1', phase: 'verified', state: 'verified' }));
            const outsideCandidate = candidate(path.join(outside, '..', path.basename(outside)), stored);
            expect((0, code_candidate_progress_1.readCodeCandidateProgress)(outsideCandidate, root)).toMatchObject({ phase: 'draft', state: 'active', completed: 3, total: 5 });
            const symlinkPath = path.join(artifactDirectory, 'candidate', 'progress.json');
            fs.unlinkSync(symlinkPath);
            fs.symlinkSync(path.join(outsideArtifact, 'progress.json'), symlinkPath);
            expect((0, code_candidate_progress_1.readCodeCandidateProgress)(owner, root)).toMatchObject({ phase: 'draft', state: 'active', completed: 3, total: 5 });
            fs.unlinkSync(symlinkPath);
            fs.writeFileSync(symlinkPath, 'x'.repeat(65537));
            expect((0, code_candidate_progress_1.readCodeCandidateProgress)(owner, root)).toMatchObject({ phase: 'draft', state: 'active', completed: 3, total: 5 });
            fs.writeFileSync(symlinkPath, '{not-json');
            expect((0, code_candidate_progress_1.readCodeCandidateProgress)(owner, root)).toMatchObject({ phase: 'draft', state: 'active', completed: 3, total: 5 });
            const noStored = candidate(artifactDirectory, null);
            expect((0, code_candidate_progress_1.readCodeCandidateProgress)(noStored, root)).toBeNull();
        }
        finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
    test('rejects a file from another attempt and cannot override the owning stored state', () => {
        const stored = { attempt_id: 'attempt-1', phase: 'draft', state: 'active', completed: 3, total: 5 };
        writeProgress(artifactDirectory, { attempt_id: 'attempt-2', phase: 'verified', state: 'verified', completed: 99, total: 99 });
        expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory, stored), root)).toBeNull();
    });
    test('allows only known phases and states, failing closed to analysis or blocked', () => {
        writeProgress(artifactDirectory, { attempt_id: 'attempt-1', phase: 'not-a-phase', state: 'not-a-state', completed: 1, total: 2 });
        expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory), root)).toMatchObject({ phase: 'analysis', state: 'blocked' });
        writeProgress(artifactDirectory, { attempt_id: 'attempt-1', phase: 'awaiting_approval', state: 'verified', completed: 1, total: 2 });
        expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory), root)).toMatchObject({ phase: 'awaiting_approval', state: 'verified' });
    });
    test('expires active and model-waiting states into failed terminal progress', () => {
        const now = Date.parse('2026-09-20T12:00:00Z');
        for (const state of ['active', 'waiting_on_model']) {
            writeProgress(artifactDirectory, { attempt_id: 'attempt-1', phase: 'verification', state, deadline_at: '2026-09-20T11:59:59Z' });
            expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory), root, now)).toMatchObject({
                phase: 'verification', state: 'failed', failedStep: 'verification', reason: 'attempt_deadline_exceeded',
            });
        }
    });
    test('keeps failed and verified states terminal after their deadline', () => {
        const now = Date.parse('2026-09-20T12:00:00Z');
        for (const state of ['failed', 'verified']) {
            writeProgress(artifactDirectory, { attempt_id: 'attempt-1', phase: 'awaiting_approval', state, deadline_at: '2026-09-20T11:59:59Z', reason: state === 'failed' ? 'already-terminal' : 'verified-terminal' });
            expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory), root, now)).toMatchObject({
                phase: 'awaiting_approval', state, failedStep: state === 'failed' ? 'awaiting_approval' : null, reason: state === 'failed' ? 'already-terminal' : 'verified-terminal',
            });
        }
    });
    test('bounds stored reasons and only assigns deadline reason on an active transition', () => {
        const now = Date.parse('2026-09-20T12:00:00Z');
        const longReason = 'x'.repeat(300);
        writeProgress(artifactDirectory, { attempt_id: 'attempt-1', phase: 'blocked-phase', state: 'blocked', deadline_at: '2026-09-20T11:59:59Z', reason: longReason });
        expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory), root, now)).toMatchObject({ state: 'blocked', reason: 'x'.repeat(256) });
        writeProgress(artifactDirectory, { attempt_id: 'attempt-1', phase: 'verification', state: 'active', deadline_at: '2026-09-20T11:59:59Z', reason: longReason });
        expect((0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory), root, now)).toMatchObject({ state: 'failed', failedStep: 'verification', reason: 'attempt_deadline_exceeded' });
    });
    test('clamps invalid completed and total counters at zero without changing candidate proof or owner', () => {
        const stored = { attempt_id: 'attempt-1', phase: 'analysis', state: 'active', completed: -3, total: 'not-a-number' };
        const before = JSON.parse(JSON.stringify(candidate(artifactDirectory, stored)));
        const result = (0, code_candidate_progress_1.readCodeCandidateProgress)(candidate(artifactDirectory, stored), root);
        expect(result).toMatchObject({ completed: 0, total: 0, attemptId: 'attempt-1' });
        expect(result).not.toHaveProperty('proof');
        expect(stored).toEqual(before.progress);
        expect(before.proof).toEqual({ valid: true, owner: 'attempt-1' });
    });
    test('does not mutate proof, owner, or candidate state while reading terminal progress', () => {
        const original = candidate(artifactDirectory, { attempt_id: 'attempt-1', phase: 'failed', state: 'failed', completed: 4, total: 4 });
        const before = JSON.parse(JSON.stringify(original));
        const result = (0, code_candidate_progress_1.readCodeCandidateProgress)(original, root);
        expect(result).toMatchObject({ attemptId: 'attempt-1', state: 'failed' });
        expect(original).toEqual(before);
    });
});

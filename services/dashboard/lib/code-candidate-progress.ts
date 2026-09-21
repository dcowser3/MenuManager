import * as fs from 'fs';
import * as path from 'path';
const phases = new Set(['analysis', 'draft', 'unit_tests', 'retrospective_replay', 'holdout', 'verification', 'awaiting_approval', 'awaiting_deployment_approval']);
const states = new Set(['active', 'waiting_on_model', 'blocked', 'failed', 'verified']);
export function readCodeCandidateProgress(candidate: any, root: string, now = Date.now()) {
    if (!candidate) return null;
    let progress = candidate.progress;
    try {
        const allowed = fs.realpathSync(path.join(root, 'tmp/code-proposals'));
        const file = fs.realpathSync(path.join(candidate.artifact_directory || '', 'candidate/progress.json'));
        if (file.startsWith(allowed + path.sep) && fs.statSync(file).size <= 65536) {
            const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
            // A readable trusted-root record bound to another attempt is positive
            // identity-conflict evidence, not an unavailable artifact fallback.
            if (!stored || stored.attempt_id !== candidate.attempt_id) return null;
            progress = stored;
        }
    } catch { /* State stored with the owning attempt remains available if local artifacts are absent. */ }
    if (!progress || progress.attempt_id !== candidate.attempt_id) return null;
    const phase = phases.has(progress.phase) ? progress.phase : 'analysis';
    const expired = Number.isFinite(Date.parse(progress.deadline_at)) && Date.parse(progress.deadline_at) < now;
    const deadlineTransition = expired && ['active', 'waiting_on_model'].includes(progress.state);
    const state = deadlineTransition ? 'failed' : states.has(progress.state) ? progress.state : 'blocked';
    const storedReason = typeof progress.reason === 'string' ? progress.reason.slice(0, 256) : null;
    return { schemaVersion: 1, attemptId: candidate.attempt_id, phase, state,
        completed: Math.max(0, Number(progress.completed) || 0), total: Math.max(0, Number(progress.total) || 0),
        lastUpdate: progress.updated_at || null, deadline: progress.deadline_at || null,
        budget: progress.budget || null, failedStep: state === 'failed' ? phase : null,
        artifactDirectory: candidate.artifact_directory || null, reason: deadlineTransition ? 'attempt_deadline_exceeded' : storedReason };
}

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
exports.readCodeCandidateProgress = readCodeCandidateProgress;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const phases = new Set(['analysis', 'draft', 'unit_tests', 'retrospective_replay', 'holdout', 'verification', 'awaiting_approval', 'awaiting_deployment_approval']);
const states = new Set(['active', 'waiting_on_model', 'blocked', 'failed', 'verified']);
function readCodeCandidateProgress(candidate, root, now = Date.now()) {
    if (!candidate)
        return null;
    let progress = candidate.progress;
    try {
        const allowed = fs.realpathSync(path.join(root, 'tmp/code-proposals'));
        const file = fs.realpathSync(path.join(candidate.artifact_directory || '', 'candidate/progress.json'));
        if (file.startsWith(allowed + path.sep) && fs.statSync(file).size <= 65536) {
            const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
            // A readable trusted-root record bound to another attempt is positive
            // identity-conflict evidence, not an unavailable artifact fallback.
            if (!stored || stored.attempt_id !== candidate.attempt_id)
                return null;
            progress = stored;
        }
    }
    catch { /* State stored with the owning attempt remains available if local artifacts are absent. */ }
    if (!progress || progress.attempt_id !== candidate.attempt_id)
        return null;
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

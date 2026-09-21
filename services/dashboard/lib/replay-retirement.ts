import { createHash } from 'crypto';
import type { AcceptedCorrectionRule } from './pre-ai-deterministic-rules';

export const REPLAY_RETIREMENT_POLICY_VERSION = 1;

export type BackendReplayStatus = 'still_missed' | 'partially_correct' | 'now_correct' | 'replay_unavailable' | 'not_verifiable';
export type ReplayStatus = BackendReplayStatus | 'verification_required' | 'delivery_mismatch';

export type OriginalReviewAudit = {
    id?: string;
    attempt_id?: string;
    created_at?: string;
    event_type?: string;
    review_mode?: string;
    model?: string;
    ai_request?: { text?: string };
    ai_response?: { rawFeedback?: string };
    final_result?: { correctedMenu?: string };
};

export type DeterministicResponseReplay = {
    correctedMenu: string;
    parsedMenu: string;
    appliedRuleIds: string[];
    response_sha256: string;
    model_calls: 0;
};

export type ReplayRetirementEvidence = {
    version: 1;
    eligible: boolean;
    reason: string;
    original_audit_id?: string;
    original_audit_created_at?: string;
    original_model?: string;
    original_final_correct: boolean | null;
    submitted_correct: boolean | null;
    original_response_correct: boolean | null;
    deterministic_replay_correct: boolean | null;
    original_response_sha256?: string;
    applied_rule_ids?: string[];
    delivery_changes_lost?: string[];
    post_review_attribution?: 'unknown';
    model_calls: 0;
};

/** Reprocess the frozen original response with current guards; never call a model. */
export function replayOriginalResponseDeterministically(
    audit: OriginalReviewAudit | null | undefined,
    context: { menuType?: string; property?: string; templateType?: string; allergens?: string },
    acceptedCorrectionRules: AcceptedCorrectionRule[]
): DeterministicResponseReplay | null {
    const feedback = audit?.ai_response?.rawFeedback;
    const preCheckedReviewBody = audit?.ai_request?.text;
    if (!feedback?.trim() || !preCheckedReviewBody?.trim() || audit?.event_type !== 'completed' || audit?.review_mode !== 'full') return null;
    // Keep the pure retirement predicate independent of review-pipeline module
    // initialization: review rules already consume improvement-cycle-core.
    const { runPostAiPipeline } = require('./review-pipeline') as typeof import('./review-pipeline');
    const { analyzeEmbeddedSetMenus } = require('./embedded-set-menu-guard') as typeof import('./embedded-set-menu-guard');
    const post = runPostAiPipeline({
        feedback,
        preCheckedReviewBody,
        menuType: context.menuType,
        property: context.property,
        templateType: context.templateType,
        effectiveReviewAllergens: context.allergens,
        acceptedCorrectionRules,
        embeddedSetMenuAnalysis: context.menuType === 'prix_fixe'
            ? { sections: [], issues: [] }
            : analyzeEmbeddedSetMenus(preCheckedReviewBody),
        precheckEnabled: true,
    });
    if (post.parsed.fenceMissing || !post.structureGuard.safe) return null;
    return {
        correctedMenu: post.correctedMenuSanitized,
        parsedMenu: post.parsed.correctedMenu,
        appliedRuleIds: [...new Set(post.postAiDeterministic.appliedCorrections.map((entry) => entry.ruleId).filter((id): id is string => !!id))],
        response_sha256: createHash('sha256').update(feedback).digest('hex'),
        model_calls: 0,
    };
}

/** A successful backend sample is an observation, not permission to discard evidence. */
export function assessReplayRetirement(input: {
    observedStatus: BackendReplayStatus;
    originalAudit?: OriginalReviewAudit | null;
    submissionAttemptId?: string | null;
    submittedMenu?: string | null;
    deterministicReplay?: DeterministicResponseReplay | null;
    correctionApplied: (menu: string) => boolean;
    correctionProgress?: (menu: string) => { applied_changes?: string[] };
}): { status: ReplayStatus; observed_status: BackendReplayStatus; retirement_evidence: ReplayRetirementEvidence } {
    const audit = input.originalAudit;
    const proof: ReplayRetirementEvidence = {
        version: 1,
        eligible: false,
        reason: 'Original review provenance unavailable; retain correction for verification.',
        original_final_correct: null,
        submitted_correct: null,
        original_response_correct: null,
        deterministic_replay_correct: null,
        model_calls: 0,
    };
    const result = (status: ReplayStatus) => ({ status, observed_status: input.observedStatus, retirement_evidence: proof });
    const unverifiedStatus = input.observedStatus === 'now_correct' ? 'verification_required' : input.observedStatus;
    if (!audit?.id || !audit.created_at || audit.event_type !== 'completed' || audit.review_mode !== 'full'
        || !input.submissionAttemptId || audit.attempt_id !== input.submissionAttemptId
        || !audit.final_result?.correctedMenu?.trim() || !input.submittedMenu?.trim()) return result(unverifiedStatus);

    proof.original_audit_id = audit.id;
    proof.original_audit_created_at = audit.created_at;
    proof.original_model = audit.model;
    proof.original_final_correct = input.correctionApplied(audit.final_result.correctedMenu);
    proof.submitted_correct = input.correctionApplied(input.submittedMenu);
    // Compound corrections can lose a delivered allergen while still missing
    // an unrelated spelling fix. Compare individual expected deltas as well as
    // the complete correction so that both "partially correct" outputs cannot
    // hide a browser delivery failure.
    const originalChanges = input.correctionProgress?.(audit.final_result.correctedMenu).applied_changes || [];
    const submittedChanges = input.correctionProgress?.(input.submittedMenu).applied_changes || [];
    const remaining = [...submittedChanges];
    proof.delivery_changes_lost = !proof.submitted_correct ? originalChanges.filter((change) => {
        const index = remaining.indexOf(change);
        if (index < 0) return true;
        remaining.splice(index, 1);
        return false;
    }) : [];
    if ((proof.original_final_correct && !proof.submitted_correct) || proof.delivery_changes_lost.length) {
        proof.post_review_attribution = 'unknown';
        proof.reason = 'The original API and submitted text differ after review. A human may have edited the result; without edit-history evidence or a reproduced application failure, the cause is unknown. Do not infer a browser bug from this difference.';
        return result('delivery_mismatch');
    }
    if (input.observedStatus !== 'now_correct') {
        proof.reason = 'Current backend replay has not produced the complete correction.';
        return result(input.observedStatus);
    }
    if (proof.original_final_correct || proof.submitted_correct) {
        proof.reason = 'No original backend failure is established; a successful replay cannot retire this correction.';
        return result('verification_required');
    }
    const deterministic = input.deterministicReplay;
    if (!deterministic || deterministic.model_calls !== 0) {
        proof.reason = 'One backend replay passed, but no deterministic replay of the original failed response proves the fix.';
        return result('verification_required');
    }
    proof.original_response_correct = input.correctionApplied(deterministic.parsedMenu);
    proof.deterministic_replay_correct = input.correctionApplied(deterministic.correctedMenu);
    proof.original_response_sha256 = deterministic.response_sha256;
    proof.applied_rule_ids = deterministic.appliedRuleIds;
    if (proof.original_response_correct || !proof.deterministic_replay_correct) {
        proof.reason = 'The original failed response is not corrected by the current deterministic pipeline; retain for verification.';
        return result('verification_required');
    }
    proof.eligible = true;
    proof.reason = 'Current deterministic guards correct the frozen original failed response with zero model calls; original delivery has no mismatch.';
    return result('now_correct');
}

/** Fail closed for old now_correct rows and incomplete/contradictory proof. */
export function isReplayRetirementVerified(entry: { status?: string; retirement_evidence?: ReplayRetirementEvidence } | null | undefined): boolean {
    const proof = entry?.retirement_evidence;
    return entry?.status === 'now_correct' && proof?.version === 1 && proof.eligible === true
        && !!proof.original_audit_id && !!proof.original_audit_created_at && !!proof.original_response_sha256
        && proof.original_final_correct === false && proof.submitted_correct === false
        && proof.original_response_correct === false && proof.deterministic_replay_correct === true
        && !proof.delivery_changes_lost?.length
        && proof.model_calls === 0;
}

export function isReplayRetirementPolicyCurrent(summary: { replay_retirement_policy_version?: unknown } | null | undefined): boolean {
    return summary?.replay_retirement_policy_version === REPLAY_RETIREMENT_POLICY_VERSION;
}

/** Recover only exact legacy-success ids referenced by the proposal being refreshed. */
export function unverifiedReplayResolutionIds(proposal: {
    replay_evidence?: Array<{ correction_id?: string; status?: string; retirement_evidence?: ReplayRetirementEvidence }> | null;
    correction_routing?: Array<{ correction_id?: string; replay_status?: string }> | null;
} | null | undefined): string[] {
    const evidence = proposal?.replay_evidence || [];
    const byId = new Map(evidence.map((entry) => [entry.correction_id, entry]));
    const ids = new Set<string>();
    for (const entry of evidence) {
        if (entry.correction_id && entry.status === 'now_correct' && !isReplayRetirementVerified(entry)) ids.add(entry.correction_id);
    }
    for (const route of proposal?.correction_routing || []) {
        if (route.correction_id && route.replay_status === 'now_correct' && !isReplayRetirementVerified(byId.get(route.correction_id))) ids.add(route.correction_id);
    }
    return [...ids];
}

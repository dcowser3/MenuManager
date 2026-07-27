// Testable core of the daily improvement cycle (scripts/improvement-cycle.js):
// gating, effective-prompt resolution, LLM-output validation, eval summarization,
// and the mapping from LLM-proposed rules to correction_rules payloads.

import { getTenantConfig } from '@menumanager/tenant-config';

export type CycleGateInput = {
    unconsumedCorrectionCount: number;
    /** When set, a pending (non-superseded) proposal exists. */
    pendingProposal?: { id?: string; cycle_id?: string } | null;
    minNewCorrections: number;
    /** Manual/on-demand run: supersede pending even with zero new corrections. */
    force?: boolean;
};

export type CycleGateResult =
    | { run: false; reason: string }
    | { run: true; mode: 'new'; reason: string }
    | { run: true; mode: 'supersede'; reason: string; pendingProposal: { id?: string; cycle_id?: string } };

export function shouldRunCycle(input: CycleGateInput): CycleGateResult {
    const min = Math.max(1, input.minNewCorrections);
    const pending = input.pendingProposal && input.pendingProposal.cycle_id
        ? input.pendingProposal
        : null;

    if (input.force) {
        if (pending) {
            return {
                run: true,
                mode: 'supersede',
                reason: 'forced re-run superseding pending proposal',
                pendingProposal: pending,
            };
        }
        return { run: true, mode: 'new', reason: 'forced re-run' };
    }

    if (pending) {
        if (input.unconsumedCorrectionCount >= min) {
            return {
                run: true,
                mode: 'supersede',
                reason: `${input.unconsumedCorrectionCount} new correction(s); superseding pending proposal ${pending.cycle_id}`,
                pendingProposal: pending,
            };
        }
        return { run: false, reason: 'a pending proposal is already awaiting review' };
    }

    if (input.unconsumedCorrectionCount < min) {
        return {
            run: false,
            reason: `only ${input.unconsumedCorrectionCount} unconsumed correction(s); need >= ${min}`,
        };
    }
    return { run: true, mode: 'new', reason: `${input.unconsumedCorrectionCount} unconsumed correction(s) ready` };
}

/**
 * Cadence gate. The cron runs DAILY; this decides whether enough time has passed
 * since the last proposal to make another one.
 *
 * Why not just schedule the cron every other day: a run that dies (transient
 * OpenAI error, eval crash) then had no second chance for 48h, and the only
 * symptom was a missing email (observed Jul 14 and Jul 25 2026). Running daily
 * and gating on "hours since the last proposal we actually produced" keeps the
 * every-other-day cadence reviewers asked for while letting a failed run retry
 * the next night on its own.
 */
export function shouldDeferForCadence(input: {
    /** created_at of the most recent proposal produced by the cycle, any status. */
    lastProposalCreatedAt?: string | null;
    nowMs: number;
    minHours: number;
    force?: boolean;
}): { defer: boolean; reason: string; hoursSince: number | null } {
    if (input.force) return { defer: false, reason: 'forced run', hoursSince: null };
    const minHours = Number.isFinite(input.minHours) ? Math.max(0, input.minHours) : 0;
    if (!minHours) return { defer: false, reason: 'cadence gate disabled', hoursSince: null };
    const raw = `${input.lastProposalCreatedAt || ''}`.trim();
    if (!raw) return { defer: false, reason: 'no previous proposal', hoursSince: null };
    const lastMs = Date.parse(raw);
    if (!Number.isFinite(lastMs)) return { defer: false, reason: 'previous proposal has an unreadable timestamp', hoursSince: null };
    const hoursSince = (input.nowMs - lastMs) / 3_600_000;
    if (hoursSince < minHours) {
        return {
            defer: true,
            reason: `last proposal was ${hoursSince.toFixed(1)}h ago; cadence requires ${minHours}h between proposals`,
            hoursSince,
        };
    }
    return { defer: false, reason: `last proposal was ${hoursSince.toFixed(1)}h ago`, hoursSince };
}

/**
 * Transient-failure classifier for the improvement LLM call. 429 has its own
 * (rate-limit aware) path; this covers 5xx server errors and network faults,
 * which previously aborted the whole cycle on the first hit — a single OpenAI
 * 500 killed the Jul 25 2026 proposal.
 */
export function isTransientOpenAiFailure(input: { status?: number | null; error?: { message?: string } | null }): boolean {
    const status = Number(input.status);
    if (Number.isFinite(status) && status >= 500) return true;
    const message = `${input.error?.message || ''}`;
    if (!message) return false;
    return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|network|fetch failed|terminated/i.test(message);
}

export type CorrectionRuleLike = {
    id: string;
    submission_id?: string | null;
    original_text?: string | null;
    corrected_text?: string | null;
    created_at?: string | null;
    prompt_cycle_id?: string | null;
};

/** Supersede mode: unconsumed + corrections stamped to the pending proposal's cycle (excludes proposal-* rows). */
export function assembleSupersedeCorrectionSet(
    unconsumed: CorrectionRuleLike[],
    carriedOver: CorrectionRuleLike[]
): { combined: CorrectionRuleLike[]; carriedCount: number; newCount: number } {
    const carried = (carriedOver || []).filter(
        (r) => r && r.id && !`${r.submission_id || ''}`.startsWith('proposal-')
    );
    const byId = new Map<string, CorrectionRuleLike>();
    for (const r of carried) byId.set(r.id, r);
    for (const r of unconsumed || []) {
        if (r && r.id) byId.set(r.id, r);
    }
    const combined = [...byId.values()].sort(
        (a, b) => Date.parse(a.created_at || '') - Date.parse(b.created_at || '')
    );
    const carriedIds = new Set(carried.map((r) => r.id));
    const newCount = combined.filter((r) => !carriedIds.has(r.id)).length;
    return { combined, carriedCount: carried.length, newCount };
}

export type ReplayEvidenceEntry = {
    correction_id: string;
    submission_id?: string;
    original_text?: string;
    corrected_text?: string;
    status: 'still_missed' | 'now_correct' | 'replay_unavailable' | 'not_verifiable';
};

/** When replay cannot run (missing differ lib, etc.), tag every correction replay_unavailable. */
export function buildReplayUnavailableForCorrections(
    corrections: CorrectionRuleLike[],
    reason: string
): { evidence: ReplayEvidenceEntry[]; warning: string } {
    const warning = `Pre-analysis replay unavailable (${reason}); corrections tagged replay_unavailable — review replay evidence carefully before approving a no-op.`;
    const evidence: ReplayEvidenceEntry[] = (corrections || []).map((r) => ({
        correction_id: r.id,
        submission_id: `${r.submission_id || ''}` || undefined,
        original_text: `${r.original_text || ''}`,
        corrected_text: `${r.corrected_text || ''}`,
        status: 'replay_unavailable',
    }));
    return { evidence, warning };
}

/** Returns a 409 payload when review must be blocked because the proposal was superseded. */
export function supersededProposalReviewBlock(proposal: {
    status?: string | null;
    superseded_by_cycle_id?: string | null;
} | null | undefined): { error: string; superseded_by_cycle_id: string | null } | null {
    if (!proposal || `${proposal.status || ''}` !== 'superseded') return null;
    const pointer = proposal.superseded_by_cycle_id
        ? ` Review the superseding proposal (cycle ${proposal.superseded_by_cycle_id}).`
        : '';
    return {
        error: `This proposal was superseded and cannot be reviewed.${pointer}`,
        superseded_by_cycle_id: proposal.superseded_by_cycle_id || null,
    };
}

// Azure client secrets expire and then fail silently, taking down ALL Graph
// features at once (alert/proposal email + SharePoint). Track the expiry date
// in GRAPH_CLIENT_SECRET_EXPIRES (YYYY-MM-DD, from Azure) so we can warn ahead
// of time instead of discovering it from a mystery outage.
export function evaluateSecretExpiry(
    expiresIso: string | undefined | null,
    nowMs: number,
    warnDays = 30
): { status: SecretExpiryStatus; daysLeft: number | null; message: string } {
    const raw = `${expiresIso || ''}`.trim();
    if (!raw) {
        return {
            status: 'unknown',
            daysLeft: null,
            message: 'GRAPH_CLIENT_SECRET_EXPIRES is not set — secret-expiry monitoring is off. Set it to the secret\'s Azure expiry date (YYYY-MM-DD) to get advance warnings.',
        };
    }
    const expMs = Date.parse(raw);
    if (!Number.isFinite(expMs)) {
        return { status: 'unknown', daysLeft: null, message: `GRAPH_CLIENT_SECRET_EXPIRES="${raw}" is not a valid date (use YYYY-MM-DD).` };
    }
    const daysLeft = Math.floor((expMs - nowMs) / 86_400_000);
    if (daysLeft < 0) {
        return {
            status: 'expired',
            daysLeft,
            message: `Graph client secret EXPIRED ${-daysLeft} day(s) ago (${raw}). Email and SharePoint will fail until you create a new secret in Azure and update GRAPH_CLIENT_SECRET + GRAPH_CLIENT_SECRET_EXPIRES on the host.`,
        };
    }
    if (daysLeft <= warnDays) {
        return {
            status: 'warning',
            daysLeft,
            message: `Graph client secret expires in ${daysLeft} day(s) (${raw}). Rotate it in Azure and update GRAPH_CLIENT_SECRET + GRAPH_CLIENT_SECRET_EXPIRES before then to avoid an email/SharePoint outage.`,
        };
    }
    return { status: 'ok', daysLeft, message: `Graph client secret valid for ${daysLeft} more day(s) (expires ${raw}).` };
}

export type SecretExpiryStatus = 'unknown' | 'ok' | 'warning' | 'expired';

export type PromptProposalRecord = {
    status?: string;
    final_prompt?: string | null;
    proposed_prompt?: string | null;
    reviewed_at?: string | null;
};

// The runtime prompt file is baked into the Docker image, so an approval made
// through the dashboard is lost on the next redeploy. The DB record of the
// latest approved proposal is therefore the source of truth when present.
export function pickEffectivePrompt(
    approvedProposals: PromptProposalRecord[],
    filePrompt: string
): { prompt: string; source: 'approved_proposal' | 'prompt_file' } {
    const approved = (approvedProposals || [])
        .filter((proposal) => ['approved', 'approved_modified'].includes(`${proposal.status || ''}`))
        .filter((proposal) => `${proposal.final_prompt || proposal.proposed_prompt || ''}`.trim())
        .sort((a, b) => Date.parse(b.reviewed_at || '') - Date.parse(a.reviewed_at || ''));

    if (approved.length) {
        return {
            prompt: `${approved[0].final_prompt || approved[0].proposed_prompt}`,
            source: 'approved_proposal',
        };
    }
    return { prompt: filePrompt, source: 'prompt_file' };
}

export const PROPOSED_RULE_CHANGE_TYPES = new Set([
    'spelling',
    'diacritic',
    'terminology',
    'grammar',
    'punctuation',
    'capitalization',
]);

export type ProposedReplacementRule = {
    original_text: string;
    corrected_text: string;
    change_type: string;
    rule: string;
    applies_to_menu_type: 'all' | 'food' | 'beverage';
    is_location_specific: boolean;
    location: string | null;
    other_applicable_locations: string[];
    // B6 / Fix 9: recomputed from source corrections in validation (never trust LLM arithmetic)
    evidence_submission_count?: number;
    evidence_occurrence_count?: number;
    // C4a: true when the LLM synthesized this deterministic rule from a freeform guidance
    // correction (no exact original/corrected pair supplied by the human). The exact strings
    // are the model's inference and must be verified before trusting them.
    inferred_from_guidance?: boolean;
};

// C3: how each source correction was routed by the improvement LLM. Code cross-checks
// and (when needed) synthesizes 'unrouted' entries so the reviewer sees an outcome for
// every input, not just the ones the model chose to mention.
export type CorrectionRoutingLane =
    | 'replacement_rule'
    | 'prompt'
    | 'code_recommendation'
    | 'already_correct'
    | 'dismissed'
    | 'unrouted';

export type CorrectionRoutingEntry = {
    correction_id: string;
    lane: CorrectionRoutingLane;
    target: string;
    note: string;
    /** Replay tag for this correction, copied in for rendering (still_missed/now_correct/…). */
    replay_status?: ReplayEvidenceEntry['status'];
    /** Source correction text, copied in for a readable routing table (null for freeform). */
    original_text?: string | null;
    corrected_text?: string | null;
    /** The human's freeform guidance/explanation — what to show when there is no text pair. */
    guidance?: string | null;
};

export const CORRECTION_ROUTING_LANES = new Set<CorrectionRoutingLane>([
    'replacement_rule',
    'prompt',
    'code_recommendation',
    'already_correct',
    'dismissed',
    'unrouted',
]);

export type CodeRecommendation = {
    title: string;
    description: string;
    manifest_rule_ids: string[];
    target_file_hint: string | null;
};

export type ImprovementLlmOutput = {
    analysis: string;
    proposed_prompt: string;
    promptUnchanged: boolean;
    // C1: WHY the prompt is unchanged, so the retry controller can distinguish a recoverable
    // guard rejection (retry) from the model's deliberate no-change decision (accept).
    //  - 'sentinel'      the model returned the UNCHANGED sentinel (deliberate no-change).
    //  - 'identical'     the model echoed the current prompt verbatim (deliberate no-change).
    //  - 'context_leak'  a guard discarded the rewrite because it echoed input context (retryable).
    //  - 'fence_guard'   a guard discarded the rewrite because it broke code-fence structure (retryable).
    promptUnchangedReason?: 'sentinel' | 'identical' | 'context_leak' | 'fence_guard';
    proposed_replacement_rules: ProposedReplacementRule[];
    code_recommendations: CodeRecommendation[];
    warnings: string[];
    // Fix 2: set when promptUnchanged but there exist still_missed corrections with no
    // covering replacement rule or code recommendation in the proposal.
    unresolved_still_missed?: boolean;
    // Fix 5 / B2: falsifiable coverage claims. Each must include a verbatim contiguous
    // quote from the *current* prompt (validated at ingest). Replay evidence outranks this.
    coverage_claims?: Array<{ correction_id: string; prompt_quote: string; explanation: string }>;
    // C3: per-correction routing table (completeness-enforced; may contain synthesized 'unrouted').
    correction_routing?: CorrectionRoutingEntry[];
};

// C1: the two promptUnchangedReasons that mean "an automated guard discarded the model's
// rewrite" — these are recoverable formatting mistakes and warrant a retry-with-feedback.
// The sentinel/identical reasons are the model deliberately declining to change the prompt.
export function isGuardDiscardReason(reason?: string | null): boolean {
    return reason === 'context_leak' || reason === 'fence_guard';
}

// Sentinel the LLM returns instead of echoing the full prompt when no prompt
// change is warranted (echoing ~20k chars invites truncation/leak artifacts).
export const PROMPT_UNCHANGED_SENTINEL = 'UNCHANGED';

// User-prompt delimiters around the current prompt, and context-section headers
// that must never appear inside a proposed prompt. If they do, the model echoed
// its input context back; the proposal prompt is garbage even when the analysis
// and rules are sound, so we fall back to "unchanged".
export const CURRENT_PROMPT_BEGIN_MARKER = '=== BEGIN CURRENT PROMPT ===';
export const CURRENT_PROMPT_END_MARKER = '=== END CURRENT PROMPT ===';
const CONTEXT_LEAK_MARKERS = [
    CURRENT_PROMPT_BEGIN_MARKER,
    CURRENT_PROMPT_END_MARKER,
    '## Code Rules Manifest',
    '## New Reviewer Corrections',
    '## Sample Before/After Documents',
];

/**
 * True when the model must use the reasoning-model API shape (no temperature,
 * max_completion_tokens instead of max_tokens). Covers the o-series (o1, o3,
 * o4-mini, …) and the gpt-5 family (gpt-5, gpt-5.1, gpt-5-mini, …) — gpt-5
 * reasoning models reject non-default temperature, so routing them down the
 * non-reasoning path turns a working call into a 400. gpt-4o / gpt-4o-mini do
 * NOT match ("o" is not followed by a digit) and stay on the non-reasoning path.
 */
export function isReasoningModel(model: string): boolean {
    return /o[0-9]|gpt-5|reasoning/i.test(model || '');
}

/**
 * True for a 429 body that says a SINGLE request exceeds the org's per-minute
 * token cap ("Request too large for <model> … on tokens per min (TPM)").
 * Waiting and retrying can never succeed — the same request stays too large —
 * so callers must fail fast instead of burning the retry budget (observed
 * Jul 14 2026: six pointless 16s retries against o3's 30k TPM cap).
 */
export function isRequestTooLarge429(bodyText: string): boolean {
    return /request too large/i.test(`${bodyText || ''}`);
}

/**
 * Pure builder for the OpenAI chat payload used by the improvement/consolidation LLM call.
 * Extracted so it is jest-testable (prevents hidden API contract bugs in script).
 * - Non-reasoning: includes temperature + max_tokens.
 * - o-series / gpt-5 / reasoning: uses max_completion_tokens (no temperature); budget should cover reasoning tokens.
 */
export function buildImprovementLlmPayload(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    env: { IMPROVE_MAX_COMPLETION_TOKENS?: string | number } = {}
): Record<string, unknown> {
    const isReasoning = isReasoningModel(model);
    const payload: Record<string, unknown> = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
    };
    if (!isReasoning) {
        payload.max_tokens = 16000;
        payload.temperature = 0.2;
    } else {
        payload.max_completion_tokens = Number(env.IMPROVE_MAX_COMPLETION_TOKENS || 32000);
    }
    return payload;
}

// Terms whose correct form depends on what the dish actually IS (or how the
// word is used in the line), not on spelling — a blind find-replace would
// corrupt legitimate uses. These can never be deterministic replacement rules;
// the AI must reason from context in the prompt instead.
// - tartare (raw chopped protein) vs tartar (a sauce): the canonical homograph.
// - berry/berries: a standalone fruit listing reads as plural ("berries"), but
//   the same word is correct as a singular modifier ("berry compote", "berry
//   coulis") — number-context-dependent, not an always-safe swap.
// - rose/rosé: "rosé" is the wine, "rose" is the flower/rose water. Reviewers have
//   corrected in BOTH directions (rose->rosé for wine, rosé->rose for "Honeyed Rose"),
//   so neither blanket direction is safe: an accepted blanket rose->rosé rule was
//   rewriting "rose water" to "rosé water" against explicit reviewer intent.
// Match on whole words, case- and accent-insensitively (so "rosé" is caught by "rose").
export const CONTEXT_DEPENDENT_TERMS = ['tartare', 'tartar', 'berry', 'berries', 'rose'];

export function involvesContextDependentTerm(...texts: string[]): string | null {
    for (const term of CONTEXT_DEPENDENT_TERMS) {
        const pattern = new RegExp(`\\b${stripDiacriticsForComparison(term)}\\b`, 'i');
        // Compare against the diacritic-stripped text: `\b` does not treat accented
        // letters as word characters, so `\brosé\b` would never match standalone "rosé".
        if (texts.some((text) => pattern.test(stripDiacriticsForComparison(`${text || ''}`)))) return term;
    }
    return null;
}

function asText(value: unknown, maxLength = 100000): string {
    return `${value ?? ''}`.trim().slice(0, maxLength);
}

function stripDiacriticsForComparison(value: string): string {
    return `${value || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isDiacriticOnlyReplacement(originalText: string, correctedText: string): boolean {
    if (!originalText || !correctedText || originalText === correctedText) {
        return false;
    }
    return stripDiacriticsForComparison(originalText) === stripDiacriticsForComparison(correctedText);
}

/**
 * Locate the first occurrence of needle in text using tolerant matching:
 * 1) case-insensitive substring
 * 2) diacritic-stripped normalized
 * Returns {start, end} char indices in original text, or null.
 */
export function locateCorrectionSite(text: string, needle: string): { start: number; end: number } | null {
    const t = `${text || ''}`;
    const n = `${needle || ''}`;
    if (!t || !n) return null;
    // 1. case-insensitive direct
    const lowerIdx = t.toLowerCase().indexOf(n.toLowerCase());
    if (lowerIdx >= 0) return { start: lowerIdx, end: lowerIdx + n.length };
    // 2. diacritic-stripped
    const tNorm = stripDiacriticsForComparison(t);
    const nNorm = stripDiacriticsForComparison(n);
    const normIdx = tNorm.indexOf(nNorm);
    if (normIdx >= 0) {
        // Map back approximately: find a window in original that normalizes to the match
        // Simple approach: search near the norm position by scanning original windows
        // For robustness we fall back to scanning original with normalized compare.
        for (let i = 0; i <= t.length - n.length; i++) {
            if (stripDiacriticsForComparison(t.slice(i, i + n.length)) === nNorm) {
                return { start: i, end: i + n.length };
            }
        }
    }
    return null;
}

/** Trim a window to nearest line boundaries within a max radius. */
function lineBoundedWindow(text: string, center: number, radius = 300): string {
    const t = `${text || ''}`;
    if (!t) return '';
    const start = Math.max(0, center - radius);
    const end = Math.min(t.length, center + radius);
    let s = t.lastIndexOf('\n', start);
    if (s < 0 || s < start - 80) s = start; else s = s + 1;
    let e = t.indexOf('\n', end);
    if (e < 0 || e > end + 80) e = end;
    return t.slice(s, e).trim();
}

export type CorrectionExcerptWindow = {
    correction_id?: string;
    submission_id?: string;
    ai_window: string;
    final_window: string;
};

const HEAD_ORIENTATION_CHARS = 200;

/**
 * Build centered excerpt windows for corrections instead of head-slices (Fix 6 / B3).
 * Returns labeled windows + a short head slice for orientation.
 * Dedupes overlapping windows; respects per-submission and caller-enforced cycle budgets.
 */
export function buildCorrectionExcerptWindows(
    aiText: string,
    finalText: string,
    corrections: Array<{ id?: string; original_text?: string; corrected_text?: string; submission_id?: string }>,
    opts: { perSubBudgetChars?: number } = {}
): { windows: CorrectionExcerptWindow[]; head_ai: string; head_final: string } {
    const perSub = opts.perSubBudgetChars ?? 4000;
    const out: CorrectionExcerptWindow[] = [];
    const usedRanges: Array<{ s: number; e: number }> = []; // rough overlap guard on ai side

    const ai = `${aiText || ''}`;
    const fin = `${finalText || ''}`;

    for (const c of corrections || []) {
        const oid = c.id;
        const o = c.original_text || '';
        const ct = c.corrected_text || '';
        let aiWin = '(correction site not found in AI draft)';
        let finWin = '(correction site not found in final)';
        const aiHit = o ? locateCorrectionSite(ai, o) : null;
        if (aiHit) {
            aiWin = lineBoundedWindow(ai, Math.floor((aiHit.start + aiHit.end) / 2), 300);
        } else if (ai) {
            aiWin = ai.slice(0, HEAD_ORIENTATION_CHARS) + (ai.length > HEAD_ORIENTATION_CHARS ? ' …' : '');
        }
        const finHit = ct ? locateCorrectionSite(fin, ct) : null;
        if (finHit) {
            finWin = lineBoundedWindow(fin, Math.floor((finHit.start + finHit.end) / 2), 300);
        } else if (fin) {
            finWin = fin.slice(0, HEAD_ORIENTATION_CHARS) + (fin.length > HEAD_ORIENTATION_CHARS ? ' …' : '');
        }
        // dedupe rough overlap on aiWin content length heuristic
        const sig = (aiWin + '|' + finWin).slice(0, 120);
        if (out.some((w) => (w.ai_window + '|' + w.final_window).slice(0, 120) === sig)) continue;
        out.push({ correction_id: oid, submission_id: c.submission_id, ai_window: aiWin, final_window: finWin });
        // enforce per-sub budget by char count of joined text
        const currentChars = out.reduce((acc, w) => acc + w.ai_window.length + w.final_window.length, 0);
        if (currentChars > perSub) {
            // drop last if over
            out.pop();
            break;
        }
    }
    return {
        windows: out,
        head_ai: ai.slice(0, HEAD_ORIENTATION_CHARS) + (ai.length > HEAD_ORIENTATION_CHARS ? ' …' : ''),
        head_final: fin.slice(0, HEAD_ORIENTATION_CHARS) + (fin.length > HEAD_ORIENTATION_CHARS ? ' …' : ''),
    };
}

function countMarkdownCodeFences(text: string): number {
    return (text.match(/^```/gm) || []).length;
}

function looksLikeNoOpPromptAnalysis(analysis: string): boolean {
    return /already (?:covered|handled|addressed)|existing (?:rule|rules|prompt|guidance)|no (?:prompt )?change (?:is )?needed|should be handled by the prompt/i.test(analysis);
}

function normLoose(value: unknown): string {
    return `${value ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Does a replacement rule cover this correction? A rule legitimately fixes a *narrower* span
 * than the raw correction line (e.g. rule "CAST IRON CHICKEN"->"CAST-IRON CHICKEN" for a
 * correction whose text is the whole "CAST IRON CHICKEN D,G" line). So coverage is: the rule's
 * original_text appears within the correction's original_text — NOT an exact pair match, which
 * would false-flag every narrowed rule as "dropped/unresolved".
 */
function ruleCoversCorrection(
    rule: { original_text?: string | null; corrected_text?: string | null },
    correctionOriginal?: string | null,
    correctionCorrected?: string | null
): boolean {
    const ro = normLoose(rule.original_text);
    if (!ro) return false;
    const co = normLoose(correctionOriginal);
    const cc = normLoose(correctionCorrected);
    // Exact-pair match (original behavior) OR the rule's from-text sits inside the correction text.
    if (co && ro === co && normLoose(rule.corrected_text) === cc) return true;
    if (co && co.includes(ro)) return true;
    return false;
}

/**
 * C3: validate the per-correction routing table the improvement LLM emits.
 * The reviewer must see an outcome for EVERY source correction, not only the ones
 * the model chose to mention, so this:
 *  - parses/normalizes lanes (unknown lane -> 'unrouted' + warning),
 *  - enforces completeness (missing source ids -> synthesized 'unrouted' + warning),
 *  - blocks still_missed corrections from being 'dismissed'/'already_correct' (feeds
 *    unresolved_still_missed),
 *  - allows 'already_correct' only when replay says now_correct,
 *  - cross-checks 'replacement_rule' lanes against the rules that survived validation
 *    (a routing pointing at a dropped rule downgrades to 'unrouted').
 * Pure + exported so it is jest-testable independently of the LLM call.
 */
export function validateCorrectionRouting(
    rawRouting: unknown,
    opts: {
        sourceCorrections?: Array<{ id?: string; original_text?: string | null; corrected_text?: string | null; rule?: string | null }>;
        replayEvidence?: ReplayEvidenceEntry[];
        survivingRules?: Array<{ original_text: string; corrected_text: string }>;
    } = {}
): { routing: CorrectionRoutingEntry[]; warnings: string[]; unresolvedFromRouting: boolean } {
    const warnings: string[] = [];
    let unresolvedFromRouting = false;

    const sources = (opts.sourceCorrections || []).filter((c) => c && c.id);
    const replayById = new Map<string, ReplayEvidenceEntry['status']>();
    for (const e of opts.replayEvidence || []) {
        if (e && e.correction_id) replayById.set(String(e.correction_id), e.status);
    }
    const sourceById = new Map<string, { original_text?: string | null; corrected_text?: string | null; rule?: string | null }>();
    for (const c of sources) sourceById.set(String(c.id), { original_text: c.original_text ?? undefined, corrected_text: c.corrected_text ?? undefined, rule: c.rule ?? undefined });
    // Only cross-check replacement_rule lanes when the caller supplied the surviving rule set
    // (an empty array is a valid "no rules survived" assertion; undefined means "skip the check").
    const crossCheckRules = Array.isArray(opts.survivingRules);

    // Parse model-provided routing entries, keyed by correction_id (first wins; dupes warn).
    const byId = new Map<string, CorrectionRoutingEntry>();
    for (const value of Array.isArray(rawRouting) ? rawRouting : []) {
        const entry = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        const cid = asText(entry.correction_id, 200);
        if (!cid) {
            warnings.push('correction_routing entry dropped: correction_id is required');
            continue;
        }
        let lane = asText(entry.lane, 40).toLowerCase() as CorrectionRoutingLane;
        if (!CORRECTION_ROUTING_LANES.has(lane)) {
            warnings.push(`correction_routing for ${cid}: unknown lane "${lane || '(missing)'}" -> unrouted`);
            lane = 'unrouted';
        }
        if (byId.has(cid)) {
            warnings.push(`correction_routing lists ${cid} more than once; keeping the first`);
            continue;
        }
        const src = sourceById.get(cid);
        byId.set(cid, {
            correction_id: cid,
            lane,
            target: asText(entry.target, 300),
            note: asText(entry.note, 500),
            replay_status: replayById.get(cid),
            original_text: src ? (src.original_text ?? null) : undefined,
            corrected_text: src ? (src.corrected_text ?? null) : undefined,
            guidance: src ? (src.rule ?? null) : undefined,
        });
    }

    // Completeness: every source correction must appear exactly once. Missing -> synthesize unrouted.
    for (const c of sources) {
        const cid = String(c.id);
        if (!byId.has(cid)) {
            warnings.push(`correction ${cid} was not routed by the model; recorded as unrouted`);
            byId.set(cid, {
                correction_id: cid,
                lane: 'unrouted',
                target: '',
                note: 'not routed by the model',
                replay_status: replayById.get(cid),
                original_text: c.original_text ?? null,
                corrected_text: c.corrected_text ?? null,
                guidance: c.rule ?? null,
            });
        }
    }

    // Per-entry cross-checks.
    for (const entry of byId.values()) {
        const replay = replayById.get(entry.correction_id);
        if (replay === 'still_missed' && (entry.lane === 'dismissed' || entry.lane === 'already_correct')) {
            warnings.push(`correction ${entry.correction_id} is tagged still_missed by replay but routed "${entry.lane}"; replay evidence outranks this — it must result in a concrete change`);
            unresolvedFromRouting = true;
        }
        if (entry.lane === 'already_correct' && replay && replay !== 'now_correct') {
            warnings.push(`correction ${entry.correction_id} routed "already_correct" but replay status is "${replay}" (not now_correct)`);
        }
        if (entry.lane === 'replacement_rule' && crossCheckRules) {
            const src = sourceById.get(entry.correction_id);
            // Only cross-check corrections that carry an exact text pair; freeform corrections
            // (no original/corrected of their own) can be routed to a synthesized rule whose text
            // we can't line up, so we trust the model's routing there.
            if (src && src.original_text && src.corrected_text) {
                const covered = (opts.survivingRules || []).some((r) => ruleCoversCorrection(r, src.original_text, src.corrected_text));
                if (!covered) {
                    warnings.push(`correction ${entry.correction_id} routed to a replacement_rule that did not survive validation (likely dropped); recorded as unrouted`);
                    entry.lane = 'unrouted';
                    entry.note = entry.note ? `${entry.note} (rule dropped in validation)` : 'routed rule dropped in validation';
                }
            }
        }
    }

    // Order: source order first, then any extra ids the model routed.
    const ordered: CorrectionRoutingEntry[] = [];
    const seen = new Set<string>();
    for (const c of sources) {
        const e = byId.get(String(c.id));
        if (e) { ordered.push(e); seen.add(e.correction_id); }
    }
    for (const e of byId.values()) {
        if (!seen.has(e.correction_id)) ordered.push(e);
    }
    return { routing: ordered, warnings, unresolvedFromRouting };
}

function isWordCharacter(ch: string | undefined): boolean {
    return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Narrow a replacement rule to the span that actually differs, dropping unchanged
 * words carried along on either edge. Reviewer corrections arrive as whole menu lines,
 * and the improvement LLM often keeps that framing: cycle 2026-07-27 proposed
 * "Smoked Old Fashion" -> "Smoked Old Fashioned" and "del maguay" -> "del maguey",
 * which then only fire on those exact phrasings. Boundaries are snapped to whole words
 * so the span never cuts mid-token.
 *
 * Returns null when nothing can be trimmed (the rule is already minimal).
 */
export function minimalChangedSpan(
    originalText: string,
    correctedText: string
): { from: string; to: string; trimmedPrefix: string; trimmedSuffix: string } | null {
    const original = `${originalText || ''}`;
    const corrected = `${correctedText || ''}`;
    if (!original || !corrected || original === corrected) return null;

    let prefix = 0;
    while (prefix < original.length && prefix < corrected.length && original[prefix] === corrected[prefix]) prefix++;
    // Back off to a word boundary: never split a token across the edge of the span.
    while (prefix > 0 && isWordCharacter(original[prefix - 1])
        && (isWordCharacter(original[prefix]) || isWordCharacter(corrected[prefix]))) prefix--;

    let suffix = 0;
    while (suffix < original.length - prefix && suffix < corrected.length - prefix
        && original[original.length - 1 - suffix] === corrected[corrected.length - 1 - suffix]) suffix++;
    while (suffix > 0) {
        const oi = original.length - suffix;
        const ci = corrected.length - suffix;
        if (isWordCharacter(original[oi]) && (isWordCharacter(original[oi - 1]) || isWordCharacter(corrected[ci - 1]))) suffix--;
        else break;
    }

    if (prefix === 0 && suffix === 0) return null;

    const from = original.slice(prefix, original.length - suffix).trim();
    const to = corrected.slice(prefix, corrected.length - suffix).trim();
    if (!from || !to || from === to) return null;

    const trimmedPrefix = original.slice(0, prefix).trim();
    const trimmedSuffix = original.slice(original.length - suffix).trim();
    // Whitespace-only edges are not a generalization; a carried word OR a carried
    // punctuation mark is ("Veggie," never fires on "Veggie Fajitas").
    if (!trimmedPrefix && !trimmedSuffix) return null;

    return { from, to, trimmedPrefix, trimmedSuffix };
}

export type ExistingCorrectionRule = {
    id?: string | null;
    original_text?: string | null;
    corrected_text?: string | null;
    applies_to_menu_type?: string | null;
    status?: string | null;
};

export type RuleConflict = {
    kind: 'contradiction' | 'inverse' | 'chain' | 'variant';
    proposedIndex: number; // 1-based, matches the "rule N" numbering in warnings
    existingRuleId: string | null;
    message: string;
    drop: boolean;
};

/** Fold away everything that is cosmetic for brand/spelling comparison. */
function normalizeForConflict(value: string): string {
    return stripDiacriticsForComparison(`${value || ''}`)
        .replace(/[.\-_'’"]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Bounded Levenshtein: returns maxDistance + 1 as soon as it is exceeded. */
function editDistanceAtMost(a: string, b: string, maxDistance: number): number {
    if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
            if (curr[j] < rowMin) rowMin = curr[j];
        }
        if (rowMin > maxDistance) return maxDistance + 1;
        prev = curr;
    }
    return prev[b.length];
}

function menuScopesOverlap(a?: string | null, b?: string | null): boolean {
    const left = `${a || 'all'}`.toLowerCase();
    const right = `${b || 'all'}`.toLowerCase();
    return left === 'all' || right === 'all' || left === right;
}

/**
 * Cross-check proposed replacement rules against the rules already accepted in
 * `correction_rules`. The improvement LLM sees the manifest but has repeatedly failed to
 * notice that a new rule fights an existing one — cycle 2026-07-26 proposed
 * "ste. germaine" -> "st-germaine" while an accepted rule already normalized the same brand
 * to "St-Germain". These checks are deterministic, so they do not depend on model quality.
 */
export function findRuleConflicts(
    proposedRules: Array<Pick<ProposedReplacementRule, 'original_text' | 'corrected_text' | 'applies_to_menu_type'>>,
    existingRules: ExistingCorrectionRule[]
): RuleConflict[] {
    const conflicts: RuleConflict[] = [];
    const existing = (existingRules || []).filter((r) => r && r.original_text && r.corrected_text);

    for (const [index, rule] of proposedRules.entries()) {
        const proposedIndex = index + 1;
        const from = normalizeForConflict(rule.original_text);
        const to = normalizeForConflict(rule.corrected_text);
        if (!from || !to) continue;

        for (const other of existing) {
            if (!menuScopesOverlap(rule.applies_to_menu_type, other.applies_to_menu_type)) continue;
            const otherFrom = normalizeForConflict(other.original_text || '');
            const otherTo = normalizeForConflict(other.corrected_text || '');
            const otherId = other.id ? String(other.id) : null;
            if (!otherFrom || !otherTo) continue;

            // Same input, different output — one of the two must be wrong.
            if (from === otherFrom && to !== otherTo) {
                conflicts.push({
                    kind: 'contradiction', proposedIndex, existingRuleId: otherId, drop: false,
                    message: `rule ${proposedIndex} contradicts accepted rule ${otherId || '(unknown id)'}: both match "${rule.original_text}" but produce "${rule.corrected_text}" vs "${other.corrected_text}" — accepting this leaves two rules fighting over the same text`,
                });
                continue;
            }
            // A -> B while an accepted rule says B -> A: guaranteed oscillation, never valid.
            if (from === otherTo && to === otherFrom) {
                conflicts.push({
                    kind: 'inverse', proposedIndex, existingRuleId: otherId, drop: true,
                    message: `rule ${proposedIndex} dropped: it is the exact inverse of accepted rule ${otherId || '(unknown id)'} ("${other.original_text}" -> "${other.corrected_text}"); the two would undo each other, so this is context-dependent and belongs in the prompt, not a replacement rule`,
                });
                continue;
            }
            // This rule's output is another rule's input — the result gets re-corrected downstream.
            if (to === otherFrom) {
                conflicts.push({
                    kind: 'chain', proposedIndex, existingRuleId: otherId, drop: false,
                    message: `rule ${proposedIndex} produces "${rule.corrected_text}", which accepted rule ${otherId || '(unknown id)'} then rewrites to "${other.corrected_text}" — target the final form directly`,
                });
                continue;
            }
            // Near-identical corrected forms: the canonical spelling already exists and this
            // rule is teaching a variant of it (the St-Germain / st-germaine case).
            if (to !== otherTo && Math.min(to.length, otherTo.length) >= 6) {
                const distance = editDistanceAtMost(to, otherTo, 2);
                if (distance >= 1 && distance <= 2) {
                    conflicts.push({
                        kind: 'variant', proposedIndex, existingRuleId: otherId, drop: false,
                        message: `rule ${proposedIndex} normalizes to "${rule.corrected_text}", which is ${distance} edit(s) from "${other.corrected_text}" in accepted rule ${otherId || '(unknown id)'} — these are probably the same brand/term with one canonical spelling; verify which form is correct before accepting`,
                    });
                }
            }
        }
    }
    return conflicts;
}

export function validateImprovementLlmOutput(
    raw: unknown,
    opts: {
        currentPrompt?: string;
        replayEvidence?: ReplayEvidenceEntry[];
        sourceCorrections?: Array<{ id?: string; original_text?: string | null; corrected_text?: string | null; submission_id?: string; rule?: string | null }>;
        /** Already-accepted correction_rules, cross-checked by findRuleConflicts. */
        existingAcceptedRules?: ExistingCorrectionRule[];
        // Consolidation mode (F1): relaxes normal length/shrink warnings; adds reduction % checks; drops rules/recs.
        consolidation?: boolean;
    } = {}
): ImprovementLlmOutput {
    const warnings: string[] = [];
    const parsed = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    let proposedPrompt = asText(parsed.proposed_prompt);
    let promptUnchanged = false;
    let promptUnchangedReason: ImprovementLlmOutput['promptUnchangedReason'];
    if (!proposedPrompt) {
        throw new Error('LLM output is missing proposed_prompt');
    }
    if (proposedPrompt === PROMPT_UNCHANGED_SENTINEL) {
        if (!opts.currentPrompt) {
            throw new Error('LLM returned UNCHANGED but no current prompt was provided to substitute');
        }
        proposedPrompt = opts.currentPrompt;
        promptUnchanged = true;
        promptUnchangedReason = 'sentinel';
    } else {
        const leakedMarker = CONTEXT_LEAK_MARKERS.find((marker) => proposedPrompt.includes(marker));
        if (leakedMarker && opts.currentPrompt) {
            warnings.push(`proposed_prompt echoed input context (contains "${leakedMarker}"); treating the prompt as unchanged`);
            proposedPrompt = opts.currentPrompt;
            promptUnchanged = true;
            promptUnchangedReason = 'context_leak';
        } else if (leakedMarker) {
            throw new Error(`proposed_prompt echoed input context (contains "${leakedMarker}")`);
        } else if (opts.currentPrompt && proposedPrompt === opts.currentPrompt.trim()) {
            promptUnchanged = true;
            promptUnchangedReason = 'identical';
        }
    }
    if (!promptUnchanged && opts.currentPrompt) {
        const currentFenceCount = countMarkdownCodeFences(opts.currentPrompt);
        const proposedFenceCount = countMarkdownCodeFences(proposedPrompt);
        // The guard exists to stop a rewrite from breaking the fenced response-format blocks,
        // so it compares against the CURRENT prompt — never against an absolute "must be even"
        // standard. The live prompt has carried an odd fence count since the response-format
        // block was added; an absolute parity check rejects *every* possible rewrite, including
        // one that reproduces the structure exactly, which silently made the cycle incapable of
        // ever changing the prompt (cycle 2026-07-26 burned all 3 attempts on "7 -> 7").
        if (proposedFenceCount !== currentFenceCount) {
            warnings.push(`proposed_prompt changed Markdown code fence structure (${currentFenceCount} -> ${proposedFenceCount}); treating the prompt as unchanged`);
            proposedPrompt = opts.currentPrompt;
            promptUnchanged = true;
            promptUnchangedReason = 'fence_guard';
        } else if (currentFenceCount % 2 !== 0) {
            warnings.push(`current prompt has an unbalanced Markdown code fence count (${currentFenceCount}); the rewrite preserved it, but the prompt's fenced blocks should be repaired`);
        }
    }
    const isConsolidation = !!opts.consolidation;
    if (!promptUnchanged && !isConsolidation && proposedPrompt.length < 500) {
        warnings.push(`proposed_prompt is suspiciously short (${proposedPrompt.length} chars)`);
    }
    if (!promptUnchanged && !isConsolidation && opts.currentPrompt && proposedPrompt.length > opts.currentPrompt.length * 1.6) {
        warnings.push(`proposed_prompt grew from ${opts.currentPrompt.length} to ${proposedPrompt.length} chars; review for bloat or echoed context`);
    }
    const analysis = asText(parsed.analysis, 20000);
    if (promptUnchanged && looksLikeNoOpPromptAnalysis(analysis)) {
        warnings.push('analysis appears to justify no prompt change by saying the behavior is already covered/handled; reviewer corrections are evidence the current guidance was not specific enough, so review this no-op carefully');
    }

    const rules: ProposedReplacementRule[] = [];
    for (const [index, value] of (Array.isArray(parsed.proposed_replacement_rules) ? parsed.proposed_replacement_rules : []).entries()) {
        const rule = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        const originalText = asText(rule.original_text, 240);
        const correctedText = asText(rule.corrected_text, 240);
        let changeType = asText(rule.change_type, 50).toLowerCase();
        const explanation = asText(rule.rule, 2000);
        if (!originalText || !correctedText) {
            warnings.push(`rule ${index + 1} dropped: original_text and corrected_text are required`);
            continue;
        }
        if (originalText === correctedText) {
            warnings.push(`rule ${index + 1} dropped: original and corrected text are identical`);
            continue;
        }
        if (!PROPOSED_RULE_CHANGE_TYPES.has(changeType)) {
            if (isDiacriticOnlyReplacement(originalText, correctedText)) {
                warnings.push(`rule ${index + 1}: change_type "${changeType || '(missing)'}" normalized to "diacritic" because the replacement only changes diacritics/case`);
                changeType = 'diacritic';
            } else {
                warnings.push(`rule ${index + 1} dropped: change_type "${changeType}" is not deterministic-safe`);
                continue;
            }
        }
        const contextTerm = involvesContextDependentTerm(originalText, correctedText);
        if (contextTerm) {
            warnings.push(`rule ${index + 1} dropped: "${contextTerm}" is context-dependent (depends on the dish) and must be AI prompt reasoning, not a deterministic replacement`);
            continue;
        }
        const menuType = asText(rule.applies_to_menu_type, 20).toLowerCase();
        // C4a: the model may synthesize a deterministic rule from freeform guidance (no exact
        // pair supplied by the human). Such rules pass the same safety validation as any rule,
        // but the exact strings are the model's inference — flag them so the reviewer verifies.
        const inferredFromGuidance = !!rule.inferred_from_guidance;
        if (inferredFromGuidance) {
            warnings.push(`rule ${index + 1} synthesized from freeform guidance — verify the exact strings ("${originalText}" -> "${correctedText}") before trusting them`);
        }
        rules.push({
            original_text: originalText,
            corrected_text: correctedText,
            change_type: changeType,
            rule: explanation || `Replace "${originalText}" with "${correctedText}".`,
            applies_to_menu_type: menuType === 'food' || menuType === 'beverage' ? menuType : 'all',
            is_location_specific: !!rule.is_location_specific && !!asText(rule.location, 255),
            location: asText(rule.location, 255) || null,
            other_applicable_locations: Array.isArray(rule.other_applicable_locations)
                ? rule.other_applicable_locations.map((item) => asText(item, 255)).filter(Boolean)
                : [],
            ...(inferredFromGuidance ? { inferred_from_guidance: true } : {}),
        });
    }

    // Flag rules that carry unchanged context on either edge, so they only fire on the
    // exact phrasing the reviewer happened to correct. Advisory: how much context a rule
    // needs to stay safe is a human call, so this never rewrites or drops the rule.
    for (const [index, rule] of rules.entries()) {
        const span = minimalChangedSpan(rule.original_text, rule.corrected_text);
        if (!span) continue;
        const carried = [span.trimmedPrefix, span.trimmedSuffix].filter(Boolean).map((t) => `"${t}"`).join(' / ');
        warnings.push(`rule ${index + 1} carries unchanged context (${carried}), so it only fires on this exact phrasing; the minimal change is "${span.from}" -> "${span.to}" — narrow it unless the surrounding words are needed to stay unambiguous`);
    }

    // Cross-check the surviving rules against what is already accepted. Runs before the
    // routing cross-check below so a dropped rule's correction is recorded as unrouted.
    if (Array.isArray(opts.existingAcceptedRules) && opts.existingAcceptedRules.length > 0) {
        const conflicts = findRuleConflicts(rules, opts.existingAcceptedRules);
        const dropIndexes = new Set<number>();
        for (const conflict of conflicts) {
            warnings.push(conflict.message);
            if (conflict.drop) dropIndexes.add(conflict.proposedIndex);
        }
        if (dropIndexes.size > 0) {
            for (const index of [...dropIndexes].sort((a, b) => b - a)) rules.splice(index - 1, 1);
        }
    }

    const recommendations: CodeRecommendation[] = [];
    for (const value of Array.isArray(parsed.code_recommendations) ? parsed.code_recommendations : []) {
        const recommendation = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        const title = asText(recommendation.title, 200);
        const description = asText(recommendation.description, 4000);
        if (!title || !description) continue;
        recommendations.push({
            title,
            description,
            manifest_rule_ids: Array.isArray(recommendation.manifest_rule_ids)
                ? recommendation.manifest_rule_ids.map((id) => asText(id, 200)).filter(Boolean)
                : [],
            target_file_hint: asText(recommendation.target_file_hint, 300) || null,
        });
    }

    // B6 / Fix 9: recompute evidence counts for proposed rules from the actual source corrections.
    // The LLM may echo "seen Nx across M" text, but we never trust its arithmetic.
    const subByPair = new Map<string, Set<string>>();
    const occByPair = new Map<string, number>();
    for (const c of (opts.sourceCorrections || [])) {
        const o = asText(c.original_text, 240);
        const ct = asText(c.corrected_text, 240);
        if (!o || !ct) continue;
        const k = `${o}→${ct}`;
        occByPair.set(k, (occByPair.get(k) || 0) + 1);
        if (c.submission_id) {
            const set = subByPair.get(k) || new Set<string>();
            set.add(String(c.submission_id));
            subByPair.set(k, set);
        }
    }
    for (const r of rules) {
        const k = `${r.original_text}→${r.corrected_text}`;
        const subs = subByPair.get(k);
        r.evidence_submission_count = subs ? subs.size : 1;
        r.evidence_occurrence_count = occByPair.get(k) || 1;
    }

    // Consolidation mode (F1 / Fix 8): prompt-only rewrite for concision.
    // Drop any emitted rules/recs with a warning; they do not apply.
    // Warn on insufficient or suspiciously large reduction instead of the normal short/growth checks.
    if (isConsolidation) {
        if (rules.length > 0) {
            warnings.push('consolidation proposal emitted replacement rules (dropped; consolidation is prompt-only)');
            rules.length = 0;
        }
        if (recommendations.length > 0) {
            warnings.push('consolidation proposal emitted code recommendations (dropped; consolidation is prompt-only)');
            recommendations.length = 0;
        }
        if (!promptUnchanged && opts.currentPrompt) {
            const currLen = opts.currentPrompt.length;
            const propLen = proposedPrompt.length;
            const red = currLen > 0 ? (currLen - propLen) / currLen : 0;
            if (red < 0.05) {
                warnings.push('consolidation produced <5% reduction (pointless run)');
            }
            if (red > 0.50) {
                warnings.push('consolidation produced >50% reduction (suspicious; verify essential guidance was not dropped)');
            }
        }
    }

    // Fix 5 / B2: coverage_claims — must cite verbatim contiguous text from the *current* prompt.
    // Invalid quotes are dropped with a hard warning. A valid citation alone does NOT count as
    // a "cover" for still_missed corrections (replay evidence outranks citations).
    const validatedCoverageClaims: Array<{ correction_id: string; prompt_quote: string; explanation: string }> = [];
    const currentPromptForClaims = opts.currentPrompt || '';
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    for (const value of Array.isArray(parsed.coverage_claims) ? parsed.coverage_claims : []) {
        const claim = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        const cid = asText(claim.correction_id, 200);
        const quote = asText(claim.prompt_quote, 2000);
        const expl = asText(claim.explanation, 2000);
        if (!cid || !quote) {
            warnings.push('coverage claim dropped: correction_id and prompt_quote are required');
            continue;
        }
        if (currentPromptForClaims) {
            if (!norm(currentPromptForClaims).includes(norm(quote))) {
                warnings.push(`coverage claim for ${cid} cites text not present in the prompt`);
                continue;
            }
        }
        validatedCoverageClaims.push({ correction_id: cid, prompt_quote: quote, explanation: expl });
    }

    // Fix 2: unresolved_still_missed check. If prompt unchanged, any still_missed correction
    // must be referenced by at least one proposed replacement rule (exact text match) or a
    // code recommendation (loose text mention). Otherwise the proposal claims "nothing to do"
    // while evidence shows the current pipeline still misses it.
    let unresolvedStillMissed = false;
    const stillMissed = (opts.replayEvidence || []).filter((e) => e.status === 'still_missed');
    if (promptUnchanged && stillMissed.length) {
        const referenced = stillMissed.filter((e) => {
            const o = asText(e.original_text, 240);
            const c = asText(e.corrected_text, 240);
            // A rule covers this correction if its (narrower) from-text sits inside the correction
            // line — not only on an exact pair match, which would false-flag every narrowed rule.
            const ruleHits = rules.some((r) => ruleCoversCorrection(r, o, c));
            if (ruleHits) return true;
            const hay = (recommendations.map((r) => `${r.title} ${r.description}`).join(' ') + ' ' + analysis).toLowerCase();
            if (!o && !c) return false;
            return hay.includes(o.toLowerCase()) || hay.includes(c.toLowerCase());
        });
        if (referenced.length < stillMissed.length) {
            unresolvedStillMissed = true;
            warnings.push('unresolved_still_missed: prompt is unchanged and one or more still_missed corrections lack a covering replacement rule or code recommendation');
        }
    }

    // C3: per-correction routing table. Enforced only when we have identifiable source
    // corrections (skipped for consolidation, which has none). Completeness + cross-checks
    // give the reviewer an outcome for every input; a still_missed routed dismissed also
    // trips unresolved_still_missed.
    let correctionRouting: CorrectionRoutingEntry[] | undefined;
    if (!isConsolidation && (opts.sourceCorrections || []).some((c) => c && c.id)) {
        const routed = validateCorrectionRouting(parsed.correction_routing, {
            sourceCorrections: opts.sourceCorrections,
            replayEvidence: opts.replayEvidence,
            survivingRules: rules,
        });
        for (const w of routed.warnings) warnings.push(w);
        if (routed.unresolvedFromRouting) unresolvedStillMissed = true;
        correctionRouting = routed.routing.length ? routed.routing : undefined;
    }

    return {
        analysis,
        proposed_prompt: proposedPrompt,
        promptUnchanged,
        promptUnchangedReason,
        proposed_replacement_rules: rules,
        code_recommendations: recommendations,
        warnings,
        unresolved_still_missed: unresolvedStillMissed || undefined,
        coverage_claims: validatedCoverageClaims.length ? validatedCoverageClaims : undefined,
        correction_routing: correctionRouting,
    };
}

// ── C1: retry-with-feedback when a prompt-shape guard discards the rewrite ──────────────
// A single recoverable formatting mistake by the model (fence structure, echoed context)
// used to kill the whole cycle. Instead, re-call with a corrective addendum up to
// IMPROVE_MAX_RETRIES times. The controller is pure over an injected `callLlm` so it is
// jest-testable with canned responses.

/** Count of fenced code-block delimiter lines (lines starting with ```). Exported for
 *  context-assembly-time injection (buildFencePreservationNote / the retry message). */
export function countFencedCodeDelimiters(text: string): number {
    return countMarkdownCodeFences(text);
}

/** Dynamic note appended to the user prompt stating the exact fence count to preserve. */
export function buildFencePreservationNote(fenceCount: number): string {
    return `\n\nIMPORTANT — code fences: the current prompt contains exactly ${fenceCount} fenced code-block delimiter line(s) (lines starting with \`\`\`). Your proposed_prompt MUST contain the same ${fenceCount} delimiter line(s), byte-identical and in the same order, including the response-format block. Adding, removing, or reformatting any fenced block will cause an automated guard to discard your entire rewrite.`;
}

/** The corrective message appended to the conversation after a guard discards a rewrite. */
export function buildGuardRetryMessage(params: { warning: string; fenceCount: number }): string {
    return [
        `Your previous proposed_prompt was rejected by an automated guard: ${params.warning}.`,
        `The current prompt contains exactly ${params.fenceCount} fenced code-block delimiter line(s) (lines beginning with \`\`\`) — every one must appear in your rewrite verbatim and unmodified, including the response-format block. Do not add, remove, or reformat any fenced block, and do not echo the input markers or context sections.`,
        `Return the corrected COMPLETE prompt now as the same JSON object shape. If you genuinely intend no change, return "proposed_prompt": "UNCHANGED".`,
    ].join(' ');
}

export type ProposalAttempt = {
    attempt: number; // 1-based
    validated: ImprovementLlmOutput;
    guardDiscarded: boolean;
    discardedPrompt: string | null; // raw proposed_prompt a guard rejected (forensics artifact)
    model?: string;
    usage?: unknown;
};

export type ImprovementProposalResult = {
    validated: ImprovementLlmOutput; // final; warnings accumulated + labeled across attempts
    model?: string;
    usage?: unknown;
    attempts: ProposalAttempt[];
    guardRetriesExhausted: boolean; // last attempt was still guard-discarded
    discardedPrompts: string[]; // raw rewrites rejected by guards, oldest first
};

export async function runImprovementProposalWithRetry(params: {
    systemPrompt: string;
    userPrompt: string;
    currentPromptFenceCount: number;
    maxRetries?: number; // default 2 => up to 3 attempts
    validateOpts?: Parameters<typeof validateImprovementLlmOutput>[1];
    callLlm: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string; model?: string; usage?: unknown }>;
    parseJson?: (raw: string) => unknown;
}): Promise<ImprovementProposalResult> {
    const maxRetries = Number.isFinite(Number(params.maxRetries)) ? Math.max(0, Number(params.maxRetries)) : 2;
    const totalAttempts = maxRetries + 1;
    const parseJson = params.parseJson || ((raw: string) => JSON.parse(raw));
    const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
    ];
    const attempts: ProposalAttempt[] = [];
    const discardedPrompts: string[] = [];
    const attemptWarnings: string[][] = [];
    let lastModel: string | undefined;
    let lastUsage: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        const res = await params.callLlm(messages);
        lastModel = res.model;
        lastUsage = res.usage;
        let parsed: unknown;
        try {
            parsed = parseJson(res.content || '');
        } catch {
            const msg = `LLM returned non-JSON output: ${String(res.content || '').slice(0, 300)}`;
            if (attempt < totalAttempts) {
                attemptWarnings.push([msg]);
                messages.push({ role: 'assistant', content: res.content || '' });
                messages.push({ role: 'user', content: 'Your previous response was not valid JSON. Return ONLY the JSON object in the required shape, with no prose or surrounding code fences.' });
                continue;
            }
            throw new Error(msg);
        }
        const validated = validateImprovementLlmOutput(parsed, params.validateOpts || {});
        const rawProposed = asText((parsed as Record<string, unknown>)?.proposed_prompt);
        const guardDiscarded = isGuardDiscardReason(validated.promptUnchangedReason);
        attempts.push({ attempt, validated, guardDiscarded, discardedPrompt: guardDiscarded ? rawProposed : null, model: res.model, usage: res.usage });
        attemptWarnings.push(validated.warnings.slice());
        if (guardDiscarded) discardedPrompts.push(rawProposed);

        if (guardDiscarded && attempt < totalAttempts) {
            const guardWarning = validated.warnings.find((w) => /code fence|echoed input context/i.test(w))
                || validated.warnings[validated.warnings.length - 1]
                || 'a formatting guard rejected the rewrite';
            messages.push({ role: 'assistant', content: res.content || '' });
            messages.push({ role: 'user', content: buildGuardRetryMessage({ warning: guardWarning, fenceCount: params.currentPromptFenceCount }) });
            continue;
        }

        // Terminal: success, deliberate no-change, or retries exhausted while still guard-discarded.
        if (attemptWarnings.length > 1) {
            const merged: string[] = [];
            for (let i = 0; i < attemptWarnings.length; i++) {
                for (const w of attemptWarnings[i]) merged.push(`attempt ${i + 1}/${totalAttempts}: ${w}`);
            }
            validated.warnings = merged;
        }
        return { validated, model: lastModel, usage: lastUsage, attempts, guardRetriesExhausted: guardDiscarded, discardedPrompts };
    }

    // Unreachable (the loop always returns), but keep the type checker happy.
    const last = attempts[attempts.length - 1];
    return { validated: last.validated, model: lastModel, usage: lastUsage, attempts, guardRetriesExhausted: !!last?.guardDiscarded, discardedPrompts };
}

export type EvalRunSummary = {
    label: string;
    casesEvaluated: number;
    exactMatches: number;
    avgComposite: number;
    correctionF1: number;
    reportPath: string;
};

export type ProposalEvalSummary = {
    baseline: EvalRunSummary | null;
    candidate: EvalRunSummary | null;
    comparedCases: number;
    avgDelta: number;
    improved: number;
    regressed: number;            // confirmed regressions (reproduced on re-run)
    flaggedRegressed: number;     // raw count before confirmation
    noiseRegressed: number;       // discarded as nondeterminism noise
    same: number;
    regressions: Array<{ case_id: string; label: string; delta: number }>;
    error?: string;
    // Trigger progression evidence (Fix 1): per-trigger deltas vs the corrections that motivated this proposal.
    triggers?: TriggerEval[];
    triggers_improved?: number;
    triggers_unchanged?: number;
    triggers_regressed?: number;
    triggers_unavailable?: number;
};

export type TriggerEval = {
    case_id: string;
    submission_id: string;
    baseline_composite: number | null;
    candidate_composite: number | null;
    delta: number | null;
    status: 'improved' | 'regressed' | 'unchanged' | 'unavailable';
};

/**
 * Pure decision for replay tag of one correction.
 * Follow-up 2: freeform (no original/corrected pair) -> not_verifiable so it never
 * contributes to unresolved_still_missed.
 */
export function decideReplayStatus(
    originalText: string | null | undefined,
    correctedText: string | null | undefined,
    replayOutput: string | null | undefined,
    signals: Array<{ from?: string; to?: string; from_norm?: string; to_norm?: string }>
): ReplayEvidenceEntry['status'] {
    const o = `${originalText || ''}`.trim();
    const c = `${correctedText || ''}`.trim();
    if (!o && !c) return 'not_verifiable';
    if (!replayOutput) return 'replay_unavailable';
    const norm = (x: string) => `${x || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const wantFrom = norm(o);
    const wantTo = norm(c);
    const hit = signals.some((sg) => {
        const f = norm(sg.from_norm || sg.from || '');
        const t = norm(sg.to_norm || sg.to || '');
        return f === wantFrom && t === wantTo;
    });
    return hit ? 'now_correct' : 'still_missed';
}

/**
 * Classify a trigger using a baselineComparison entry (B0 / Follow-up 1).
 * Prefers confirmed_delta (fresh back-to-back from confirmation pass); falls back to freshDelta (old reports) then raw delta.
 */
export function classifyTriggerFromComparisonEntry(
    entry: { delta?: number; freshDelta?: number; confirmed_delta?: number | null } | null | undefined,
    noiseEpsilon = 0.02
): 'improved' | 'regressed' | 'unchanged' {
    if (!entry) return 'unchanged';
    const d = entry.confirmed_delta != null ? entry.confirmed_delta
            : (entry.freshDelta != null ? entry.freshDelta : entry.delta);
    if (d == null) return 'unchanged';
    if (d > noiseEpsilon) return 'improved';
    if (d < -noiseEpsilon) return 'regressed';
    return 'unchanged';
}

export function summarizeEvalReport(label: string, report: any, reportPath: string): EvalRunSummary {
    return {
        label,
        casesEvaluated: report?.summary?.casesEvaluated ?? 0,
        exactMatches: report?.summary?.exactMatches ?? 0,
        avgComposite: report?.summary?.avgComposite ?? 0,
        correctionF1: report?.summary?.corrections?.f1 ?? 0,
        reportPath,
    };
}

export function buildProposalEvalSummary(
    baseline: EvalRunSummary | null,
    candidate: EvalRunSummary | null,
    candidateReport: any
): ProposalEvalSummary {
    const comparison = candidateReport?.baselineComparison || null;
    return {
        baseline,
        candidate,
        comparedCases: comparison?.comparedCases ?? 0,
        avgDelta: comparison?.avgDelta ?? 0,
        improved: comparison?.improved ?? 0,
        regressed: comparison?.regressed ?? 0,
        flaggedRegressed: comparison?.flaggedRegressed ?? comparison?.regressed ?? 0,
        noiseRegressed: comparison?.noiseRegressed ?? 0,
        same: comparison?.same ?? 0,
        regressions: (comparison?.regressions || []).slice(0, 20).map((entry: any) => ({
            case_id: entry.case_id,
            label: entry.label,
            delta: entry.delta,
        })),
    };
}

export function evalStatusFromSummary(
    summary: ProposalEvalSummary | null,
    opts: { consolidation?: boolean } = {}
): 'passed' | 'regressed' | 'skipped' | 'failed' | 'no_effect' {
    if (!summary) return 'skipped';
    if (summary.error) return 'failed';
    if (!summary.candidate) return 'failed';
    if (summary.regressed > 0) return 'regressed';
    if (opts.consolidation) {
        // Consolidation proposals are not driven by corrections; success = no regressions introduced.
        return 'passed';
    }
    const triggersImproved = summary.triggers_improved ?? 0;
    if (triggersImproved > 0) return 'passed';
    // No confirmed regressions and no trigger improved: this proposal did not demonstrate
    // forward progress on the cases that motivated it (Fix 1). Label no_effect rather than passed.
    // (Dead opts.promptUnchanged removed per Follow-up 3; semantics focus on trigger evidence.)
    return 'no_effect';
}

// C2: a single, code-computed field describing what the proposal ACTUALLY concluded, so the
// reviewer never has to reconstruct it from scattered signals (warnings, byte-identical
// prompts, eval table). Never LLM-supplied.
export type Disposition =
    | 'prompt_change'
    | 'rules_only'
    | 'code_recs_only'
    | 'rules_and_prompt'
    | 'no_change_model_declined'
    | 'no_change_guard_discarded';

export function computeDisposition(input: {
    promptUnchanged: boolean;
    /** From validateImprovementLlmOutput; used to tell a guard discard from a deliberate no-change. */
    promptUnchangedReason?: string | null;
    /** True when C1's retries were exhausted and the last attempt was still guard-discarded. */
    guardRetriesExhausted?: boolean;
    proposedRuleCount: number;
    codeRecommendationCount: number;
}): Disposition {
    const hasRules = input.proposedRuleCount > 0;
    const hasRecs = input.codeRecommendationCount > 0;
    if (!input.promptUnchanged) {
        return hasRules ? 'rules_and_prompt' : 'prompt_change';
    }
    // Prompt unchanged. A guard discard (C1 exhausted) is the honest headline even if rules exist.
    if (isGuardDiscardReason(input.promptUnchangedReason) && input.guardRetriesExhausted) {
        return 'no_change_guard_discarded';
    }
    if (hasRules) return 'rules_only';
    if (hasRecs) return 'code_recs_only';
    return 'no_change_model_declined';
}

// Plain-language headline for each disposition (proposal page + email lead line).
export function describeDisposition(
    disposition: Disposition,
    ctx: { ruleCount?: number; recCount?: number; guardAttempts?: number; promptLenBefore?: number; promptLenAfter?: number } = {}
): string {
    const rules = ctx.ruleCount ?? 0;
    const recs = ctx.recCount ?? 0;
    const rulePhrase = `${rules} replacement rule${rules === 1 ? '' : 's'}`;
    const recPhrase = `${recs} code recommendation${recs === 1 ? '' : 's'}`;
    switch (disposition) {
        case 'prompt_change':
            return `Prompt change proposed${recs ? ` + ${recPhrase}` : ''}.`;
        case 'rules_and_prompt':
            return `${rulePhrase} + a prompt change.`;
        case 'rules_only':
            return `${rulePhrase}, no prompt change.`;
        case 'code_recs_only':
            return `${recPhrase}, no prompt or rule change.`;
        case 'no_change_model_declined':
            return 'No change proposed — the model concluded nothing needed to change.';
        case 'no_change_guard_discarded':
            return `No change proposed — the model's rewrite was discarded by a formatting guard${ctx.guardAttempts ? ` after ${ctx.guardAttempts} attempt${ctx.guardAttempts === 1 ? '' : 's'}` : ''}.`;
        default:
            return `${disposition}`;
    }
}

// C2: skip the candidate eval entirely when the candidate is byte-identical to baseline AND
// there are no candidate replacement rules — a full 204-case run would be pure waste. Verdict
// becomes no_effect with an explanatory note. (A rules-only proposal still needs the eval:
// the rules change the candidate output even with an unchanged prompt.)
export function shouldSkipCandidateEval(input: { promptUnchanged: boolean; proposedRuleCount: number }): boolean {
    return !!input.promptUnchanged && (input.proposedRuleCount || 0) === 0;
}

export const IDENTICAL_CANDIDATE_EVAL_NOTE = 'eval skipped: candidate identical to baseline';

export function resolveDashboardPublicUrl(env: {
    DASHBOARD_PUBLIC_URL?: string | null;
    DASHBOARD_URL?: string | null;
}): string {
    return `${env.DASHBOARD_PUBLIC_URL || env.DASHBOARD_URL || 'http://localhost:3005'}`.replace(/\/+$/, '');
}

export function isLoopbackBaseUrl(url: string): boolean {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(`${url || ''}`.trim().replace(/\/+$/, ''));
}

/**
 * A production run that resolves a loopback base URL emails links nobody outside
 * the container can open (observed Jul 26 2026: the proposal email's "Review the
 * proposal" link pointed at http://localhost:3005 because neither
 * DASHBOARD_PUBLIC_URL nor DASHBOARD_URL was set on the host). The email still
 * sends — a broken link beats no notification — but the run says so loudly.
 * Returns null when the configuration is fine, or outside production, where a
 * localhost base is correct.
 */
export function describePublicUrlMisconfiguration(env: {
    DASHBOARD_PUBLIC_URL?: string | null;
    DASHBOARD_URL?: string | null;
    NODE_ENV?: string | null;
}): string | null {
    if (`${env.NODE_ENV || ''}` !== 'production') return null;
    const resolved = resolveDashboardPublicUrl(env);
    const fix = 'Set DASHBOARD_URL (or DASHBOARD_PUBLIC_URL) in the host .env to '
        + 'https://sandovalhospitalitymenumanager.live and recreate the dashboard + clickup-integration containers.';

    if (isLoopbackBaseUrl(resolved)) {
        return `Outbound links resolve to ${resolved}, which is unreachable outside the container. ${fix}`;
    }
    // A bare IP is reachable, so nothing breaks outright — but recipients get an
    // unauthenticated http://<ip>:<port> link that mail filters and browsers flag,
    // and it silently rots if the instance IP changes. Production ran this way
    // until Jul 26 2026 even though the domain and its cert already existed.
    if (isBareIpBaseUrl(resolved)) {
        return `Outbound links resolve to ${resolved} — a raw IP rather than the public domain. `
            + `Recipients see an untrusted-looking link and it breaks if the instance IP changes. ${fix}`;
    }
    if (/^http:\/\//i.test(resolved)) {
        return `Outbound links resolve to ${resolved}, which is plain HTTP. ${fix}`;
    }
    return null;
}

export function isBareIpBaseUrl(url: string): boolean {
    const host = `${url || ''}`.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function escapeHtml(value: unknown): string {
    return `${value ?? ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export type PendingPromptProposalReminderInput = {
    proposal: {
        id?: string | null;
        cycle_id?: string | null;
        created_at?: string | null;
        correction_rule_count?: number | null;
        submission_count?: number | null;
        eval_status?: string | null;
        llm_model?: string | null;
    };
    dashboardUrl: string;
    unconsumedCorrectionCount?: number | null;
};

export function buildPendingProposalReminderEmail(input: PendingPromptProposalReminderInput): { subject: string; html: string } {
    const proposal = input.proposal || {};
    const cycleId = `${proposal.cycle_id || proposal.id || 'unknown-cycle'}`.trim();
    const baseUrl = `${input.dashboardUrl || ''}`.replace(/\/+$/, '');
    const generated = proposal.created_at
        ? new Date(proposal.created_at).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' })
        : 'unknown';
    const evalStatus = `${proposal.eval_status || 'unknown'}`.trim();
    const sourceCorrections = Number.isFinite(Number(proposal.correction_rule_count))
        ? Number(proposal.correction_rule_count)
        : null;
    const submissions = Number.isFinite(Number(proposal.submission_count))
        ? Number(proposal.submission_count)
        : null;
    const waitingCorrections = Number.isFinite(Number(input.unconsumedCorrectionCount))
        ? Number(input.unconsumedCorrectionCount)
        : null;

    const details = [
        `<li>Pending proposal cycle: <strong>${escapeHtml(cycleId)}</strong></li>`,
        `<li>Generated: ${escapeHtml(generated)}</li>`,
        `<li>Eval: ${escapeHtml(evalStatus)}</li>`,
        sourceCorrections === null ? '' : `<li>Source corrections in pending proposal: ${sourceCorrections}</li>`,
        submissions === null ? '' : `<li>Submissions in pending proposal: ${submissions}</li>`,
        waitingCorrections === null ? '' : `<li>Unconsumed correction rows currently waiting: ${waitingCorrections}</li>`,
        proposal.llm_model ? `<li>Model: ${escapeHtml(proposal.llm_model)}</li>` : '',
    ].filter(Boolean);

    return {
        subject: `Review-improvement proposal still pending (${cycleId})`,
        html: [
            `<p>The daily review-improvement cycle did not generate a new proposal because a previous prompt proposal is still awaiting review.</p>`,
            `<ul>`,
            ...details,
            `</ul>`,
            `<p><a href="${escapeHtml(baseUrl)}/learning/prompt-proposal">Review the pending proposal</a></p>`,
        ].join('\n'),
    };
}

// Maps an accepted LLM-proposed rule into the payload shape consumed by
// buildCorrectionRuleRecord / POST /correction-rules. Status is accepted (the
// human approved it on the proposal page); source stays 'system' so provenance
// is clear in the learning dashboard.
export function mapProposedRuleToCorrectionRulePayload(
    rule: ProposedReplacementRule,
    proposalId: string,
    index: number,
    reviewerName: string | null,
    opts: { cycleId?: string | null; consumedAt?: string | null } = {}
): Record<string, unknown> {
    return {
        submission_id: `proposal-${proposalId}`,
        correction_id: `proposal-${proposalId}-rule-${index}`,
        original_text: rule.original_text,
        corrected_text: rule.corrected_text,
        change_type: rule.change_type,
        rule: rule.rule,
        applies_to_menu_type: rule.applies_to_menu_type,
        is_location_specific: rule.is_location_specific,
        location: rule.is_location_specific ? rule.location : null,
        other_applicable_locations: rule.is_location_specific ? rule.other_applicable_locations : [],
        restaurant_name: rule.is_location_specific ? (rule.location || '') : `All ${getTenantConfig().shortName} restaurants`,
        reviewer_name: reviewerName,
        source: 'system',
        status: 'accepted',
        // Born consumed by the proposal cycle that surfaced it, so an
        // approval-inserted rule does not re-enter the gate as a "new"
        // correction next cycle. (Fresh human-added rules stay unconsumed.)
        prompt_cycle_id: opts.cycleId || `proposal-${proposalId}`,
        consumed_at: opts.consumedAt || null,
    };
}

export type CodeRecommendationIssue = {
    title: string;
    body: string;
    labels: string[];
};

// Builds the GitHub issue filed when a reviewer approves a proposal that
// carries code recommendations. The body is self-contained so the issue can be
// handed directly to an engineer or a coding agent.
export function buildCodeRecommendationIssue(
    recommendation: CodeRecommendation,
    proposal: { id: string; cycle_id?: string },
    dashboardUrl: string
): CodeRecommendationIssue {
    const baseUrl = `${dashboardUrl || ''}`.replace(/\/+$/, '');
    const bodyLines = [
        recommendation.description,
        '',
        '---',
        '',
        `- Proposed by the automated improvement cycle (proposal \`${proposal.cycle_id || proposal.id}\`), approved by a reviewer on the prompt-proposal page${baseUrl ? ` (${baseUrl}/learning/prompt-proposal)` : ''}.`,
    ];
    if (recommendation.target_file_hint) {
        bodyLines.push(`- Likely implementation file: \`${recommendation.target_file_hint}\``);
    }
    if (recommendation.manifest_rule_ids.length) {
        bodyLines.push(`- Related code-rules-manifest entries: ${recommendation.manifest_rule_ids.map((id) => `\`${id}\``).join(', ')} (see docs/references/code-rules-manifest.md)`);
    }
    bodyLines.push(
        '',
        '### Implementation checklist',
        '',
        '- [ ] Implement the rule/guard described above',
        '- [ ] Add jest coverage for the new behavior',
        '- [ ] Add a manifest entry in `services/dashboard/lib/review-rules-manifest.ts` and run `npm run rules:manifest`',
        '- [ ] Run `npm run review:eval -- --label <change>` and compare against the latest baseline',
    );
    return {
        title: `[improvement-cycle] ${recommendation.title}`.slice(0, 250),
        body: bodyLines.join('\n'),
        labels: ['improvement-cycle'],
    };
}

export const IMPROVEMENT_SYSTEM_PROMPT = `You are the review-process engineer for an AI menu editor at ${getTenantConfig().name} (${getTenantConfig().shortName}).

The review process has TWO halves:
1. A natural-language QA prompt (provided below) used by the review model.
2. Deterministic CODE rules applied before and after the model (a complete manifest is provided below). You cannot change code directly.

You will receive new human-reviewer corrections (with their explanations), the current prompt, the code-rules manifest, and recent evaluation results.

Propose improvements so the review process would have produced the human-corrected output on the first pass, WITHOUT breaking menus it currently handles correctly.

Decide the right lane for each fix:
- Prompt change: contextual, semantic, or judgment rules -> rewrite the prompt.
- Replacement rule: an exact, always-safe text replacement (spelling, diacritic, terminology, grammar, punctuation, capitalization) -> propose it as a deterministic replacement rule instead of bloating the prompt.
- Code recommendation: logic that needs new code (formatting passes, structural guards, new critical checks) -> describe it precisely for a human engineer; reference manifest rule ids where relevant.

CRITICAL — a text correction is "always-safe" (replacement-rule eligible) ONLY if the corrected form is right in EVERY context the word appears. If the correct form depends on what the dish actually is, it is NOT a replacement rule — it is a reasoning instruction for the prompt, and the prompt must teach the model to infer the right form from dish context.
- Canonical example: "tartare" (a raw chopped-protein preparation, e.g. beef/tuna tartare) vs "tartar" (a sauce/condiment). A reviewer changing "poblano tartare" to "poblano tartar" because it is the sauce does NOT mean "tartare -> tartar" everywhere — that would corrupt legitimate raw tartare dishes. Add a prompt rule telling the model to decide between "tartare" and "tartar" based on whether the item is a raw protein dish or a sauce, NOT a replacement rule.
- Apply the same test to any homograph/near-homophone whose meaning shifts the spelling. For semantic ambiguity, prefer the prompt lane.
- Accent/diacritic-only corrections are different: if the original and corrected text are the same letters after stripping accents/diacritics and lowercasing (for example "espadin" -> "espadín" or "creme anglaise" -> "crème anglaise"), default to a deterministic "diacritic" replacement rule. Do NOT call an accent-only Spanish culinary/beverage term context-dependent unless you can name a realistic menu context where the unaccented form is intentionally correct (for example a brand styling); if you do, state that counterexample explicitly in the analysis.

Prompt rewrite rules:
- Keep the same structure, section numbering, and formatting conventions.
- Do NOT remove existing rules unless a correction explicitly contradicts them.
- Do NOT duplicate rules the deterministic code layer already enforces (see manifest).
- For location-specific rules, add them in a clearly labeled subsection.
- Treat every new reviewer correction as evidence that the current first-pass process missed something. Corrections may be annotated with REPLAY EVIDENCE tags from a pre-analysis replay of the current pipeline on the same raw input:
  - still_missed: the current pipeline reproduces the exact mistake on this input. Replay evidence outranks any coverage citation. A valid prompt_quote + still_missed is diagnosis ("present but ignored"); you MUST still propose a concrete change (restructuring/examples or code guard preferred over more abstract text). Claiming "already covered" for a still_missed correction is prohibited.
  - now_correct: the current pipeline already produces the human's fix. You MAY leave this unaddressed, but your analysis must cite the replay evidence ("replay shows this is now produced") as the reason.
  - replay_unavailable: no raw input was available for replay.
  - not_verifiable: this correction is freeform guidance (no exact original/corrected text pair) and cannot be mechanically replay-verified; use judgment.
- When a still_missed correction occurs in a context the prompt already "mentions," prefer adding concrete examples, decision tables, or counter-examples over appending another abstract sentence. If prompt text is fundamentally unreliable for the case, recommend a deterministic code guard instead of more prompt text, and say so.
- Only leave the prompt unchanged when every source correction is fully handled by deterministic replacement rules, code recommendations, or a clearly invalid/out-of-scope reviewer correction — AND no correction is tagged still_missed. A still_missed correction is positive evidence the current process (prompt + code) does not yet produce the human fix; UNCHANGED is prohibited unless that evidence is addressed by a rule or code recommendation you also propose. In the analysis, explain the routing with reference to the replay tags.
- If your analysis asserts that a correction is already covered by the current prompt, you MUST also emit a "coverage_claims" entry with a verbatim contiguous substring copied from the CURRENT PROMPT (exact characters, not paraphrased). Deterministic rule coverage should be cited via manifest ids in rules or code recs instead. A citation alone does not excuse a still_missed correction; if replay shows the pipeline still misses it, you must still propose a concrete change (restructuring, examples, or code guard).
- The current prompt is provided between "=== BEGIN CURRENT PROMPT ===" and "=== END CURRENT PROMPT ===" markers. Your proposed_prompt must contain ONLY the rewritten prompt text itself — never the markers, the Code Rules Manifest, the corrections list, or any other context sections from this message.
- Return the COMPLETE rewritten prompt, not a diff. If no prompt change is warranted, set "proposed_prompt" to exactly "UNCHANGED" instead of echoing the prompt back.
- Code fences are load-bearing: the current prompt contains a fixed number of fenced code blocks (lines starting with three backticks), including the response-format block. Preserve every one of them byte-identical and in the same order. Do NOT add, remove, reindent, or reformat any fenced block. An automated guard counts the fences and DISCARDS your entire rewrite if the count or structure changes — a discarded rewrite means your work is thrown away, so treat fence preservation as mandatory.

Freeform guidance corrections:
- Some corrections are freeform guidance with no exact original/corrected text pair (they are tagged "not_verifiable" in REPLAY EVIDENCE). You MUST still route them (see correction_routing below).
- When such guidance implies an exact, always-safe replacement (it survives the always-safe test above), SYNTHESIZE the deterministic replacement rule yourself: state the inferred original_text and corrected_text explicitly and set "inferred_from_guidance": true on that rule. Example: guidance "we always accent jalapeño" implies a "jalapeno" -> "jalapeño" diacritic rule. Apply the same safety tests as any rule (reject context-dependent terms; only spelling/diacritic/terminology/grammar/punctuation/capitalization change types).
- If the correction includes a "Human-supplied example", PREFER the human's exact example strings (casing, plurals, word boundaries) over your own inference when you synthesize the rule — the example is the verified ground truth.
- When the guidance is contextual or judgment-based (not an always-safe swap), route it to the prompt lane as usual.

Handling contradictions (policy changes):
- When a new correction or manual reviewer rule contradicts older corrections, existing accepted rules, or current prompt text, the NEWEST human intent wins. Update or remove the conflicting older guidance rather than keeping both.
- Call the conflict out explicitly in your analysis: name the old rule/behavior, the new rule, and which menus the change will affect going forward.
- The eval replays HISTORICAL menus, so an intentional policy change can show up as "regressions" on old menus that were approved under the old policy. When you expect this, say so in your analysis ("regressions on menus containing X are the intended policy change, not errors") so the reviewer can read the eval verdict correctly.

Per-correction routing (REQUIRED):
- You MUST emit a "correction_routing" entry for EVERY source correction, using its correction_id from the REPLAY EVIDENCE list. This is how the reviewer sees what happened to each input; a correction you silently drop looks like it vanished.
- lane is one of: "replacement_rule" (handled by a deterministic rule you propose), "prompt" (handled by your prompt change), "code_recommendation" (needs a code guard you recommend), "already_correct" (the pipeline already produces the fix — ONLY legal when replay says now_correct), "dismissed" (invalid/out-of-scope correction, with a reason).
- A correction tagged still_missed by replay may NOT be routed "dismissed" or "already_correct" — replay proves the pipeline still gets it wrong, so it must be routed to a concrete change.
- "target" names the specific rule, prompt section, or recommendation; "note" is a one-line reason.

Respond with ONLY a JSON object in this exact shape:
{
  "analysis": "what you changed and why, referencing specific corrections; note anything you deliberately did NOT change",
  "proposed_prompt": "the full rewritten prompt",
  "proposed_replacement_rules": [
    {
      "original_text": "exact text to replace",
      "corrected_text": "replacement text",
      "change_type": "spelling|diacritic|terminology|grammar|punctuation|capitalization",
      "rule": "why, quoting the reviewer explanation when available",
      "applies_to_menu_type": "all|food|beverage",
      "is_location_specific": false,
      "location": null,
      "other_applicable_locations": [],
      "inferred_from_guidance": false
    }
  ],
  "correction_routing": [
    {
      "correction_id": "<id from the REPLAY EVIDENCE list>",
      "lane": "replacement_rule|prompt|code_recommendation|already_correct|dismissed",
      "target": "rule original->corrected, prompt section name, or recommendation title",
      "note": "one-line reason"
    }
  ],
  "code_recommendations": [
    {
      "title": "short imperative title",
      "description": "precise description of the rule/guard to implement, with examples",
      "manifest_rule_ids": ["related manifest entry ids"],
      "target_file_hint": "likely implementation file from the manifest"
    }
  ],
  "coverage_claims": [
    {
      "correction_id": "<id from the REPLAY EVIDENCE list>",
      "prompt_quote": "exact contiguous text copied from the CURRENT PROMPT (after whitespace normalization we verify presence)",
      "explanation": "why this section covers the correction (be specific)"
    }
  ]
}`;

/**
 * Dedicated system prompt for --consolidate (Fix 8 / F1).
 * Task is prompt surgery for concision/structure only — not driven by new corrections.
 * Same JSON output contract as the normal improvement prompt so the rest of the pipeline (validate, eval, storage) stays the same.
 */
export const CONSOLIDATION_SYSTEM_PROMPT = `You are the review-process engineer for an AI menu editor at ${getTenantConfig().name} (${getTenantConfig().shortName}).

Your job in this run is to **consolidate and tighten** the existing QA prompt without losing coverage or intent.

Rules for this consolidation pass:
- Merge redundant or overlapping rules into a single clearer statement.
- Convert repeated abstract instructions into ONE rule + ONE short, concrete example.
- Reorganize for scannability while keeping the original section numbering and formatting conventions where they aid readability.
- Remove nothing unless you supply an equivalent (or stronger) formulation that preserves the original intent and edge cases.
- Target at least 15% reduction in total characters while keeping deterministic behavior identical.
- Do not invent new reviewer policy; only refactor what is already present.
- Code fences are load-bearing: the current prompt contains a fixed number of fenced code blocks (lines starting with three backticks), including the response-format block. Preserve every one of them byte-identical and in the same order — do NOT add, remove, reindent, or reformat any fenced block. An automated guard counts the fences and DISCARDS your entire rewrite if the count or structure changes, which has repeatedly killed consolidation runs. Merge PROSE around the fences; never touch the fenced content itself.

Output contract (identical shape to normal improvement proposals):
- "analysis": short description of what you consolidated and the measured size change.
- "proposed_prompt": the full consolidated prompt text ONLY (no markers, no manifest, no extra sections).
- "proposed_replacement_rules": [] (emit empty; consolidation is prompt-only)
- "code_recommendations": [] (emit empty)
- "coverage_claims": [] (optional; only if you want to note a verbatim section you preserved)

If the input is already minimal, a small honest reduction is acceptable. Never produce a longer prompt.

Respond with ONLY a JSON object in the exact shape above.`;

"use strict";
// Testable core of the daily improvement cycle (scripts/improvement-cycle.js):
// gating, effective-prompt resolution, LLM-output validation, eval summarization,
// and the mapping from LLM-proposed rules to correction_rules payloads.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSOLIDATION_SYSTEM_PROMPT = exports.IMPROVEMENT_SYSTEM_PROMPT = exports.CONTEXT_DEPENDENT_TERMS = exports.CURRENT_PROMPT_END_MARKER = exports.CURRENT_PROMPT_BEGIN_MARKER = exports.PROMPT_UNCHANGED_SENTINEL = exports.PROPOSED_RULE_CHANGE_TYPES = void 0;
exports.shouldRunCycle = shouldRunCycle;
exports.assembleSupersedeCorrectionSet = assembleSupersedeCorrectionSet;
exports.buildReplayUnavailableForCorrections = buildReplayUnavailableForCorrections;
exports.supersededProposalReviewBlock = supersededProposalReviewBlock;
exports.evaluateSecretExpiry = evaluateSecretExpiry;
exports.pickEffectivePrompt = pickEffectivePrompt;
exports.buildImprovementLlmPayload = buildImprovementLlmPayload;
exports.involvesContextDependentTerm = involvesContextDependentTerm;
exports.locateCorrectionSite = locateCorrectionSite;
exports.buildCorrectionExcerptWindows = buildCorrectionExcerptWindows;
exports.validateImprovementLlmOutput = validateImprovementLlmOutput;
exports.decideReplayStatus = decideReplayStatus;
exports.classifyTriggerFromComparisonEntry = classifyTriggerFromComparisonEntry;
exports.summarizeEvalReport = summarizeEvalReport;
exports.buildProposalEvalSummary = buildProposalEvalSummary;
exports.evalStatusFromSummary = evalStatusFromSummary;
exports.resolveDashboardPublicUrl = resolveDashboardPublicUrl;
exports.buildPendingProposalReminderEmail = buildPendingProposalReminderEmail;
exports.mapProposedRuleToCorrectionRulePayload = mapProposedRuleToCorrectionRulePayload;
exports.buildCodeRecommendationIssue = buildCodeRecommendationIssue;
const tenant_config_1 = require("@menumanager/tenant-config");
function shouldRunCycle(input) {
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
/** Supersede mode: unconsumed + corrections stamped to the pending proposal's cycle (excludes proposal-* rows). */
function assembleSupersedeCorrectionSet(unconsumed, carriedOver) {
    const carried = (carriedOver || []).filter((r) => r && r.id && !`${r.submission_id || ''}`.startsWith('proposal-'));
    const byId = new Map();
    for (const r of carried)
        byId.set(r.id, r);
    for (const r of unconsumed || []) {
        if (r && r.id)
            byId.set(r.id, r);
    }
    const combined = [...byId.values()].sort((a, b) => Date.parse(a.created_at || '') - Date.parse(b.created_at || ''));
    const carriedIds = new Set(carried.map((r) => r.id));
    const newCount = combined.filter((r) => !carriedIds.has(r.id)).length;
    return { combined, carriedCount: carried.length, newCount };
}
/** When replay cannot run (missing differ lib, etc.), tag every correction replay_unavailable. */
function buildReplayUnavailableForCorrections(corrections, reason) {
    const warning = `Pre-analysis replay unavailable (${reason}); corrections tagged replay_unavailable — review replay evidence carefully before approving a no-op.`;
    const evidence = (corrections || []).map((r) => ({
        correction_id: r.id,
        submission_id: `${r.submission_id || ''}` || undefined,
        original_text: `${r.original_text || ''}`,
        corrected_text: `${r.corrected_text || ''}`,
        status: 'replay_unavailable',
    }));
    return { evidence, warning };
}
/** Returns a 409 payload when review must be blocked because the proposal was superseded. */
function supersededProposalReviewBlock(proposal) {
    if (!proposal || `${proposal.status || ''}` !== 'superseded')
        return null;
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
function evaluateSecretExpiry(expiresIso, nowMs, warnDays = 30) {
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
    const daysLeft = Math.floor((expMs - nowMs) / 86400000);
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
// The runtime prompt file is baked into the Docker image, so an approval made
// through the dashboard is lost on the next redeploy. The DB record of the
// latest approved proposal is therefore the source of truth when present.
function pickEffectivePrompt(approvedProposals, filePrompt) {
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
exports.PROPOSED_RULE_CHANGE_TYPES = new Set([
    'spelling',
    'diacritic',
    'terminology',
    'grammar',
    'punctuation',
    'capitalization',
]);
// Sentinel the LLM returns instead of echoing the full prompt when no prompt
// change is warranted (echoing ~20k chars invites truncation/leak artifacts).
exports.PROMPT_UNCHANGED_SENTINEL = 'UNCHANGED';
// User-prompt delimiters around the current prompt, and context-section headers
// that must never appear inside a proposed prompt. If they do, the model echoed
// its input context back; the proposal prompt is garbage even when the analysis
// and rules are sound, so we fall back to "unchanged".
exports.CURRENT_PROMPT_BEGIN_MARKER = '=== BEGIN CURRENT PROMPT ===';
exports.CURRENT_PROMPT_END_MARKER = '=== END CURRENT PROMPT ===';
const CONTEXT_LEAK_MARKERS = [
    exports.CURRENT_PROMPT_BEGIN_MARKER,
    exports.CURRENT_PROMPT_END_MARKER,
    '## Code Rules Manifest',
    '## New Reviewer Corrections',
    '## Sample Before/After Documents',
];
/**
 * Pure builder for the OpenAI chat payload used by the improvement/consolidation LLM call.
 * Extracted so it is jest-testable (prevents hidden API contract bugs in script).
 * - Non-reasoning: includes temperature + max_tokens.
 * - o-series/reasoning: uses max_completion_tokens (no temperature); budget should cover reasoning tokens.
 */
function buildImprovementLlmPayload(model, systemPrompt, userPrompt, env = {}) {
    const isReasoning = /o[0-9]|reasoning/i.test(model || '');
    const payload = {
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
    }
    else {
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
// Match on whole words, case-insensitive.
exports.CONTEXT_DEPENDENT_TERMS = ['tartare', 'tartar', 'berry', 'berries'];
function involvesContextDependentTerm(...texts) {
    for (const term of exports.CONTEXT_DEPENDENT_TERMS) {
        const pattern = new RegExp(`\\b${term}\\b`, 'i');
        if (texts.some((text) => pattern.test(`${text || ''}`)))
            return term;
    }
    return null;
}
function asText(value, maxLength = 100000) {
    return `${value ?? ''}`.trim().slice(0, maxLength);
}
function stripDiacriticsForComparison(value) {
    return `${value || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function isDiacriticOnlyReplacement(originalText, correctedText) {
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
function locateCorrectionSite(text, needle) {
    const t = `${text || ''}`;
    const n = `${needle || ''}`;
    if (!t || !n)
        return null;
    // 1. case-insensitive direct
    const lowerIdx = t.toLowerCase().indexOf(n.toLowerCase());
    if (lowerIdx >= 0)
        return { start: lowerIdx, end: lowerIdx + n.length };
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
function lineBoundedWindow(text, center, radius = 300) {
    const t = `${text || ''}`;
    if (!t)
        return '';
    const start = Math.max(0, center - radius);
    const end = Math.min(t.length, center + radius);
    let s = t.lastIndexOf('\n', start);
    if (s < 0 || s < start - 80)
        s = start;
    else
        s = s + 1;
    let e = t.indexOf('\n', end);
    if (e < 0 || e > end + 80)
        e = end;
    return t.slice(s, e).trim();
}
const HEAD_ORIENTATION_CHARS = 200;
/**
 * Build centered excerpt windows for corrections instead of head-slices (Fix 6 / B3).
 * Returns labeled windows + a short head slice for orientation.
 * Dedupes overlapping windows; respects per-submission and caller-enforced cycle budgets.
 */
function buildCorrectionExcerptWindows(aiText, finalText, corrections, opts = {}) {
    const perSub = opts.perSubBudgetChars ?? 4000;
    const out = [];
    const usedRanges = []; // rough overlap guard on ai side
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
        }
        else if (ai) {
            aiWin = ai.slice(0, HEAD_ORIENTATION_CHARS) + (ai.length > HEAD_ORIENTATION_CHARS ? ' …' : '');
        }
        const finHit = ct ? locateCorrectionSite(fin, ct) : null;
        if (finHit) {
            finWin = lineBoundedWindow(fin, Math.floor((finHit.start + finHit.end) / 2), 300);
        }
        else if (fin) {
            finWin = fin.slice(0, HEAD_ORIENTATION_CHARS) + (fin.length > HEAD_ORIENTATION_CHARS ? ' …' : '');
        }
        // dedupe rough overlap on aiWin content length heuristic
        const sig = (aiWin + '|' + finWin).slice(0, 120);
        if (out.some((w) => (w.ai_window + '|' + w.final_window).slice(0, 120) === sig))
            continue;
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
function countMarkdownCodeFences(text) {
    return (text.match(/^```/gm) || []).length;
}
function looksLikeNoOpPromptAnalysis(analysis) {
    return /already (?:covered|handled|addressed)|existing (?:rule|rules|prompt|guidance)|no (?:prompt )?change (?:is )?needed|should be handled by the prompt/i.test(analysis);
}
function validateImprovementLlmOutput(raw, opts = {}) {
    const warnings = [];
    const parsed = (raw && typeof raw === 'object' ? raw : {});
    let proposedPrompt = asText(parsed.proposed_prompt);
    let promptUnchanged = false;
    if (!proposedPrompt) {
        throw new Error('LLM output is missing proposed_prompt');
    }
    if (proposedPrompt === exports.PROMPT_UNCHANGED_SENTINEL) {
        if (!opts.currentPrompt) {
            throw new Error('LLM returned UNCHANGED but no current prompt was provided to substitute');
        }
        proposedPrompt = opts.currentPrompt;
        promptUnchanged = true;
    }
    else {
        const leakedMarker = CONTEXT_LEAK_MARKERS.find((marker) => proposedPrompt.includes(marker));
        if (leakedMarker && opts.currentPrompt) {
            warnings.push(`proposed_prompt echoed input context (contains "${leakedMarker}"); treating the prompt as unchanged`);
            proposedPrompt = opts.currentPrompt;
            promptUnchanged = true;
        }
        else if (leakedMarker) {
            throw new Error(`proposed_prompt echoed input context (contains "${leakedMarker}")`);
        }
        else if (opts.currentPrompt && proposedPrompt === opts.currentPrompt.trim()) {
            promptUnchanged = true;
        }
    }
    if (!promptUnchanged && opts.currentPrompt) {
        const currentFenceCount = countMarkdownCodeFences(opts.currentPrompt);
        const proposedFenceCount = countMarkdownCodeFences(proposedPrompt);
        if (proposedFenceCount % 2 !== 0 || proposedFenceCount !== currentFenceCount) {
            warnings.push(`proposed_prompt changed Markdown code fence structure (${currentFenceCount} -> ${proposedFenceCount}); treating the prompt as unchanged`);
            proposedPrompt = opts.currentPrompt;
            promptUnchanged = true;
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
    const rules = [];
    for (const [index, value] of (Array.isArray(parsed.proposed_replacement_rules) ? parsed.proposed_replacement_rules : []).entries()) {
        const rule = (value && typeof value === 'object' ? value : {});
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
        if (!exports.PROPOSED_RULE_CHANGE_TYPES.has(changeType)) {
            if (isDiacriticOnlyReplacement(originalText, correctedText)) {
                warnings.push(`rule ${index + 1}: change_type "${changeType || '(missing)'}" normalized to "diacritic" because the replacement only changes diacritics/case`);
                changeType = 'diacritic';
            }
            else {
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
        });
    }
    const recommendations = [];
    for (const value of Array.isArray(parsed.code_recommendations) ? parsed.code_recommendations : []) {
        const recommendation = (value && typeof value === 'object' ? value : {});
        const title = asText(recommendation.title, 200);
        const description = asText(recommendation.description, 4000);
        if (!title || !description)
            continue;
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
    const subByPair = new Map();
    const occByPair = new Map();
    for (const c of (opts.sourceCorrections || [])) {
        const o = asText(c.original_text, 240);
        const ct = asText(c.corrected_text, 240);
        if (!o || !ct)
            continue;
        const k = `${o}→${ct}`;
        occByPair.set(k, (occByPair.get(k) || 0) + 1);
        if (c.submission_id) {
            const set = subByPair.get(k) || new Set();
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
    const validatedCoverageClaims = [];
    const currentPromptForClaims = opts.currentPrompt || '';
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    for (const value of Array.isArray(parsed.coverage_claims) ? parsed.coverage_claims : []) {
        const claim = (value && typeof value === 'object' ? value : {});
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
            const ruleHits = rules.some((r) => r.original_text === o && r.corrected_text === c);
            if (ruleHits)
                return true;
            const hay = (recommendations.map((r) => `${r.title} ${r.description}`).join(' ') + ' ' + analysis).toLowerCase();
            if (!o && !c)
                return false;
            return hay.includes(o.toLowerCase()) || hay.includes(c.toLowerCase());
        });
        if (referenced.length < stillMissed.length) {
            unresolvedStillMissed = true;
            warnings.push('unresolved_still_missed: prompt is unchanged and one or more still_missed corrections lack a covering replacement rule or code recommendation');
        }
    }
    return {
        analysis,
        proposed_prompt: proposedPrompt,
        promptUnchanged,
        proposed_replacement_rules: rules,
        code_recommendations: recommendations,
        warnings,
        unresolved_still_missed: unresolvedStillMissed || undefined,
        coverage_claims: validatedCoverageClaims.length ? validatedCoverageClaims : undefined,
    };
}
/**
 * Pure decision for replay tag of one correction.
 * Follow-up 2: freeform (no original/corrected pair) -> not_verifiable so it never
 * contributes to unresolved_still_missed.
 */
function decideReplayStatus(originalText, correctedText, replayOutput, signals) {
    const o = `${originalText || ''}`.trim();
    const c = `${correctedText || ''}`.trim();
    if (!o && !c)
        return 'not_verifiable';
    if (!replayOutput)
        return 'replay_unavailable';
    const norm = (x) => `${x || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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
function classifyTriggerFromComparisonEntry(entry, noiseEpsilon = 0.02) {
    if (!entry)
        return 'unchanged';
    const d = entry.confirmed_delta != null ? entry.confirmed_delta
        : (entry.freshDelta != null ? entry.freshDelta : entry.delta);
    if (d == null)
        return 'unchanged';
    if (d > noiseEpsilon)
        return 'improved';
    if (d < -noiseEpsilon)
        return 'regressed';
    return 'unchanged';
}
function summarizeEvalReport(label, report, reportPath) {
    return {
        label,
        casesEvaluated: report?.summary?.casesEvaluated ?? 0,
        exactMatches: report?.summary?.exactMatches ?? 0,
        avgComposite: report?.summary?.avgComposite ?? 0,
        correctionF1: report?.summary?.corrections?.f1 ?? 0,
        reportPath,
    };
}
function buildProposalEvalSummary(baseline, candidate, candidateReport) {
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
        regressions: (comparison?.regressions || []).slice(0, 20).map((entry) => ({
            case_id: entry.case_id,
            label: entry.label,
            delta: entry.delta,
        })),
    };
}
function evalStatusFromSummary(summary, opts = {}) {
    if (!summary)
        return 'skipped';
    if (summary.error)
        return 'failed';
    if (!summary.candidate)
        return 'failed';
    if (summary.regressed > 0)
        return 'regressed';
    if (opts.consolidation) {
        // Consolidation proposals are not driven by corrections; success = no regressions introduced.
        return 'passed';
    }
    const triggersImproved = summary.triggers_improved ?? 0;
    if (triggersImproved > 0)
        return 'passed';
    // No confirmed regressions and no trigger improved: this proposal did not demonstrate
    // forward progress on the cases that motivated it (Fix 1). Label no_effect rather than passed.
    // (Dead opts.promptUnchanged removed per Follow-up 3; semantics focus on trigger evidence.)
    return 'no_effect';
}
function resolveDashboardPublicUrl(env) {
    return `${env.DASHBOARD_PUBLIC_URL || env.DASHBOARD_URL || 'http://localhost:3005'}`.replace(/\/+$/, '');
}
function escapeHtml(value) {
    return `${value ?? ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function buildPendingProposalReminderEmail(input) {
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
function mapProposedRuleToCorrectionRulePayload(rule, proposalId, index, reviewerName, opts = {}) {
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
        restaurant_name: rule.is_location_specific ? (rule.location || '') : `All ${(0, tenant_config_1.getTenantConfig)().shortName} restaurants`,
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
// Builds the GitHub issue filed when a reviewer approves a proposal that
// carries code recommendations. The body is self-contained so the issue can be
// handed directly to an engineer or a coding agent.
function buildCodeRecommendationIssue(recommendation, proposal, dashboardUrl) {
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
    bodyLines.push('', '### Implementation checklist', '', '- [ ] Implement the rule/guard described above', '- [ ] Add jest coverage for the new behavior', '- [ ] Add a manifest entry in `services/dashboard/lib/review-rules-manifest.ts` and run `npm run rules:manifest`', '- [ ] Run `npm run review:eval -- --label <change>` and compare against the latest baseline');
    return {
        title: `[improvement-cycle] ${recommendation.title}`.slice(0, 250),
        body: bodyLines.join('\n'),
        labels: ['improvement-cycle'],
    };
}
exports.IMPROVEMENT_SYSTEM_PROMPT = `You are the review-process engineer for an AI menu editor at ${(0, tenant_config_1.getTenantConfig)().name} (${(0, tenant_config_1.getTenantConfig)().shortName}).

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

Handling contradictions (policy changes):
- When a new correction or manual reviewer rule contradicts older corrections, existing accepted rules, or current prompt text, the NEWEST human intent wins. Update or remove the conflicting older guidance rather than keeping both.
- Call the conflict out explicitly in your analysis: name the old rule/behavior, the new rule, and which menus the change will affect going forward.
- The eval replays HISTORICAL menus, so an intentional policy change can show up as "regressions" on old menus that were approved under the old policy. When you expect this, say so in your analysis ("regressions on menus containing X are the intended policy change, not errors") so the reviewer can read the eval verdict correctly.

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
      "other_applicable_locations": []
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
exports.CONSOLIDATION_SYSTEM_PROMPT = `You are the review-process engineer for an AI menu editor at ${(0, tenant_config_1.getTenantConfig)().name} (${(0, tenant_config_1.getTenantConfig)().shortName}).

Your job in this run is to **consolidate and tighten** the existing QA prompt without losing coverage or intent.

Rules for this consolidation pass:
- Merge redundant or overlapping rules into a single clearer statement.
- Convert repeated abstract instructions into ONE rule + ONE short, concrete example.
- Reorganize for scannability while keeping the original section numbering and formatting conventions where they aid readability.
- Remove nothing unless you supply an equivalent (or stronger) formulation that preserves the original intent and edge cases.
- Target at least 15% reduction in total characters while keeping deterministic behavior identical.
- Do not invent new reviewer policy; only refactor what is already present.

Output contract (identical shape to normal improvement proposals):
- "analysis": short description of what you consolidated and the measured size change.
- "proposed_prompt": the full consolidated prompt text ONLY (no markers, no manifest, no extra sections).
- "proposed_replacement_rules": [] (emit empty; consolidation is prompt-only)
- "code_recommendations": [] (emit empty)
- "coverage_claims": [] (optional; only if you want to note a verbatim section you preserved)

If the input is already minimal, a small honest reduction is acceptable. Never produce a longer prompt.

Respond with ONLY a JSON object in the exact shape above.`;

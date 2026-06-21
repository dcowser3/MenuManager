// Testable core of the daily improvement cycle (scripts/improvement-cycle.js):
// gating, effective-prompt resolution, LLM-output validation, eval summarization,
// and the mapping from LLM-proposed rules to correction_rules payloads.

import { getTenantConfig } from '@menumanager/tenant-config';

export type CycleGateInput = {
    unconsumedCorrectionCount: number;
    pendingProposalExists: boolean;
    minNewCorrections: number;
};

export type SecretExpiryStatus = 'unknown' | 'ok' | 'warning' | 'expired';

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

export function shouldRunCycle(input: CycleGateInput): { run: boolean; reason: string } {
    if (input.pendingProposalExists) {
        return { run: false, reason: 'a pending proposal is already awaiting review' };
    }
    if (input.unconsumedCorrectionCount < Math.max(1, input.minNewCorrections)) {
        return {
            run: false,
            reason: `only ${input.unconsumedCorrectionCount} unconsumed correction(s); need >= ${Math.max(1, input.minNewCorrections)}`,
        };
    }
    return { run: true, reason: `${input.unconsumedCorrectionCount} unconsumed correction(s) ready` };
}

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
};

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
    proposed_replacement_rules: ProposedReplacementRule[];
    code_recommendations: CodeRecommendation[];
    warnings: string[];
};

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

// Terms whose correct form depends on what the dish actually IS (or how the
// word is used in the line), not on spelling — a blind find-replace would
// corrupt legitimate uses. These can never be deterministic replacement rules;
// the AI must reason from context in the prompt instead.
// - tartare (raw chopped protein) vs tartar (a sauce): the canonical homograph.
// - berry/berries: a standalone fruit listing reads as plural ("berries"), but
//   the same word is correct as a singular modifier ("berry compote", "berry
//   coulis") — number-context-dependent, not an always-safe swap.
// Match on whole words, case-insensitive.
export const CONTEXT_DEPENDENT_TERMS = ['tartare', 'tartar', 'berry', 'berries'];

export function involvesContextDependentTerm(...texts: string[]): string | null {
    for (const term of CONTEXT_DEPENDENT_TERMS) {
        const pattern = new RegExp(`\\b${term}\\b`, 'i');
        if (texts.some((text) => pattern.test(`${text || ''}`))) return term;
    }
    return null;
}

function asText(value: unknown, maxLength = 100000): string {
    return `${value ?? ''}`.trim().slice(0, maxLength);
}

function countMarkdownCodeFences(text: string): number {
    return (text.match(/^```/gm) || []).length;
}

export function validateImprovementLlmOutput(
    raw: unknown,
    opts: { currentPrompt?: string } = {}
): ImprovementLlmOutput {
    const warnings: string[] = [];
    const parsed = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    let proposedPrompt = asText(parsed.proposed_prompt);
    let promptUnchanged = false;
    if (!proposedPrompt) {
        throw new Error('LLM output is missing proposed_prompt');
    }
    if (proposedPrompt === PROMPT_UNCHANGED_SENTINEL) {
        if (!opts.currentPrompt) {
            throw new Error('LLM returned UNCHANGED but no current prompt was provided to substitute');
        }
        proposedPrompt = opts.currentPrompt;
        promptUnchanged = true;
    } else {
        const leakedMarker = CONTEXT_LEAK_MARKERS.find((marker) => proposedPrompt.includes(marker));
        if (leakedMarker && opts.currentPrompt) {
            warnings.push(`proposed_prompt echoed input context (contains "${leakedMarker}"); treating the prompt as unchanged`);
            proposedPrompt = opts.currentPrompt;
            promptUnchanged = true;
        } else if (leakedMarker) {
            throw new Error(`proposed_prompt echoed input context (contains "${leakedMarker}")`);
        } else if (opts.currentPrompt && proposedPrompt === opts.currentPrompt.trim()) {
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
    if (!promptUnchanged && proposedPrompt.length < 500) {
        warnings.push(`proposed_prompt is suspiciously short (${proposedPrompt.length} chars)`);
    }
    if (!promptUnchanged && opts.currentPrompt && proposedPrompt.length > opts.currentPrompt.length * 1.6) {
        warnings.push(`proposed_prompt grew from ${opts.currentPrompt.length} to ${proposedPrompt.length} chars; review for bloat or echoed context`);
    }

    const rules: ProposedReplacementRule[] = [];
    for (const [index, value] of (Array.isArray(parsed.proposed_replacement_rules) ? parsed.proposed_replacement_rules : []).entries()) {
        const rule = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        const originalText = asText(rule.original_text, 240);
        const correctedText = asText(rule.corrected_text, 240);
        const changeType = asText(rule.change_type, 50).toLowerCase();
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
            warnings.push(`rule ${index + 1} dropped: change_type "${changeType}" is not deterministic-safe`);
            continue;
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

    return {
        analysis: asText(parsed.analysis, 20000),
        proposed_prompt: proposedPrompt,
        promptUnchanged,
        proposed_replacement_rules: rules,
        code_recommendations: recommendations,
        warnings,
    };
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
};

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

export function evalStatusFromSummary(summary: ProposalEvalSummary | null): 'passed' | 'regressed' | 'skipped' | 'failed' {
    if (!summary) return 'skipped';
    if (summary.error) return 'failed';
    if (!summary.candidate) return 'failed';
    return summary.regressed > 0 ? 'regressed' : 'passed';
}

export function resolveDashboardPublicUrl(env: {
    DASHBOARD_PUBLIC_URL?: string | null;
    DASHBOARD_URL?: string | null;
}): string {
    return `${env.DASHBOARD_PUBLIC_URL || env.DASHBOARD_URL || 'http://localhost:3005'}`.replace(/\/+$/, '');
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
- Apply the same test to any homograph/near-homophone whose meaning shifts the spelling. When unsure, prefer the prompt lane.

Prompt rewrite rules:
- Keep the same structure, section numbering, and formatting conventions.
- Do NOT remove existing rules unless a correction explicitly contradicts them.
- Do NOT duplicate rules the deterministic code layer already enforces (see manifest).
- For location-specific rules, add them in a clearly labeled subsection.
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
  ]
}`;

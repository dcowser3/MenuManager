"use strict";
// Testable core of the daily improvement cycle (scripts/improvement-cycle.js):
// gating, effective-prompt resolution, LLM-output validation, eval summarization,
// and the mapping from LLM-proposed rules to correction_rules payloads.
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPROVEMENT_SYSTEM_PROMPT = exports.PROPOSED_RULE_CHANGE_TYPES = void 0;
exports.shouldRunCycle = shouldRunCycle;
exports.pickEffectivePrompt = pickEffectivePrompt;
exports.validateImprovementLlmOutput = validateImprovementLlmOutput;
exports.summarizeEvalReport = summarizeEvalReport;
exports.buildProposalEvalSummary = buildProposalEvalSummary;
exports.evalStatusFromSummary = evalStatusFromSummary;
exports.mapProposedRuleToCorrectionRulePayload = mapProposedRuleToCorrectionRulePayload;
function shouldRunCycle(input) {
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
function asText(value, maxLength = 100000) {
    return `${value ?? ''}`.trim().slice(0, maxLength);
}
function validateImprovementLlmOutput(raw) {
    const warnings = [];
    const parsed = (raw && typeof raw === 'object' ? raw : {});
    const proposedPrompt = asText(parsed.proposed_prompt);
    if (!proposedPrompt) {
        throw new Error('LLM output is missing proposed_prompt');
    }
    if (proposedPrompt.length < 500) {
        warnings.push(`proposed_prompt is suspiciously short (${proposedPrompt.length} chars)`);
    }
    const rules = [];
    for (const [index, value] of (Array.isArray(parsed.proposed_replacement_rules) ? parsed.proposed_replacement_rules : []).entries()) {
        const rule = (value && typeof value === 'object' ? value : {});
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
        if (!exports.PROPOSED_RULE_CHANGE_TYPES.has(changeType)) {
            warnings.push(`rule ${index + 1} dropped: change_type "${changeType}" is not deterministic-safe`);
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
    return {
        analysis: asText(parsed.analysis, 20000),
        proposed_prompt: proposedPrompt,
        proposed_replacement_rules: rules,
        code_recommendations: recommendations,
        warnings,
    };
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
        same: comparison?.same ?? 0,
        regressions: (comparison?.regressions || []).slice(0, 20).map((entry) => ({
            case_id: entry.case_id,
            label: entry.label,
            delta: entry.delta,
        })),
    };
}
function evalStatusFromSummary(summary) {
    if (!summary)
        return 'skipped';
    if (summary.error)
        return 'failed';
    if (!summary.candidate)
        return 'failed';
    return summary.regressed > 0 ? 'regressed' : 'passed';
}
// Maps an accepted LLM-proposed rule into the payload shape consumed by
// buildCorrectionRuleRecord / POST /correction-rules. Status is accepted (the
// human approved it on the proposal page); source stays 'system' so provenance
// is clear in the learning dashboard.
function mapProposedRuleToCorrectionRulePayload(rule, proposalId, index, reviewerName) {
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
        restaurant_name: rule.is_location_specific ? (rule.location || '') : 'All RSH restaurants',
        reviewer_name: reviewerName,
        source: 'system',
        status: 'accepted',
    };
}
exports.IMPROVEMENT_SYSTEM_PROMPT = `You are the review-process engineer for an AI menu editor at Richard Sandoval Hospitality (RSH).

The review process has TWO halves:
1. A natural-language QA prompt (provided below) used by the review model.
2. Deterministic CODE rules applied before and after the model (a complete manifest is provided below). You cannot change code directly.

You will receive new human-reviewer corrections (with their explanations), the current prompt, the code-rules manifest, and recent evaluation results.

Propose improvements so the review process would have produced the human-corrected output on the first pass, WITHOUT breaking menus it currently handles correctly.

Decide the right lane for each fix:
- Prompt change: contextual, semantic, or judgment rules -> rewrite the prompt.
- Replacement rule: an exact, always-safe text replacement (spelling, diacritic, terminology, grammar, punctuation, capitalization) -> propose it as a deterministic replacement rule instead of bloating the prompt.
- Code recommendation: logic that needs new code (formatting passes, structural guards, new critical checks) -> describe it precisely for a human engineer; reference manifest rule ids where relevant.

Prompt rewrite rules:
- Keep the same structure, section numbering, and formatting conventions.
- Do NOT remove existing rules unless a correction explicitly contradicts them.
- Do NOT duplicate rules the deterministic code layer already enforces (see manifest).
- For location-specific rules, add them in a clearly labeled subsection.
- Return the COMPLETE rewritten prompt, not a diff. If no prompt change is warranted, return the current prompt unchanged.

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

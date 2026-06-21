"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPromptProposalConsumedCorrectionRule = isPromptProposalConsumedCorrectionRule;
exports.listActionablePendingCorrectionRules = listActionablePendingCorrectionRules;
function hasText(value) {
    return `${value || ''}`.trim().length > 0;
}
function isPromptProposalConsumedCorrectionRule(rule) {
    return hasText(rule.prompt_cycle_id) || hasText(rule.consumed_at);
}
function listActionablePendingCorrectionRules(rules) {
    return rules.filter((rule) => `${rule.status || ''}`.trim().toLowerCase() === 'pending'
        && !isPromptProposalConsumedCorrectionRule(rule));
}

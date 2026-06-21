export type LearningCorrectionRuleLike = {
    status?: unknown;
    prompt_cycle_id?: unknown;
    consumed_at?: unknown;
};

function hasText(value: unknown): boolean {
    return `${value || ''}`.trim().length > 0;
}

export function isPromptProposalConsumedCorrectionRule(rule: LearningCorrectionRuleLike): boolean {
    return hasText(rule.prompt_cycle_id) || hasText(rule.consumed_at);
}

export function listActionablePendingCorrectionRules<T extends LearningCorrectionRuleLike>(rules: T[]): T[] {
    return rules.filter((rule) =>
        `${rule.status || ''}`.trim().toLowerCase() === 'pending'
        && !isPromptProposalConsumedCorrectionRule(rule)
    );
}

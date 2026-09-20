import { policyHash } from './canonical-policy';

export type ReviewContext = {
    submissionMode?: string;
    revisionSource?: string;
    property?: string;
    templateType?: string;
    menuType?: string;
    allergens?: string;
    managedRawNoticePresent?: boolean;
    baselineMenuContent?: string;
    baselineProvenance?: unknown;
    readOnlyContext?: string;
    contextProvenance?: string;
};

/** Normalize caller-owned review context before it is frozen into an envelope. */
export function reviewContextOptions(context: ReviewContext = {}) {
    return {
        submissionMode: context.submissionMode || '',
        revisionSource: context.revisionSource || '',
        property: context.property || '',
        templateType: context.templateType || 'food',
        menuType: context.menuType || 'standard',
        allergens: context.allergens || '',
        managedRawNoticePresent: context.managedRawNoticePresent === true,
        baselineMenuContent: context.baselineMenuContent || '',
        baselineProvenance: context.baselineProvenance || null,
        readOnlyContext: typeof context.readOnlyContext === 'string' ? context.readOnlyContext : '',
        contextProvenance: context.contextProvenance || 'legacy_unknown',
    };
}

export function reviewGlobalContextHash(context: ReviewContext = {}) {
    const normalized = reviewContextOptions(context);
    return policyHash({
        property: normalized.property,
        templateType: normalized.templateType,
        menuType: normalized.menuType,
        allergens: normalized.allergens,
        managedRawNoticePresent: normalized.managedRawNoticePresent,
    });
}

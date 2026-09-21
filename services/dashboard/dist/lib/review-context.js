"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewContextOptions = reviewContextOptions;
exports.reviewGlobalContextHash = reviewGlobalContextHash;
const canonical_policy_1 = require("./canonical-policy");
/** Normalize caller-owned review context before it is frozen into an envelope. */
function reviewContextOptions(context = {}) {
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
function reviewGlobalContextHash(context = {}) {
    const normalized = reviewContextOptions(context);
    return (0, canonical_policy_1.policyHash)({
        property: normalized.property,
        templateType: normalized.templateType,
        menuType: normalized.menuType,
        allergens: normalized.allergens,
        managedRawNoticePresent: normalized.managedRawNoticePresent,
    });
}

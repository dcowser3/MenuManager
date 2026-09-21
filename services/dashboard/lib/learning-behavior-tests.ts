import { createHash } from 'crypto';
import { permitsSeparatorVariants, resolveCanonicalPolicies } from './canonical-policy';
import { canonicalizeFinalTerms, getAcceptedCorrectionRulePreAiEligibility, AcceptedCorrectionRule } from './pre-ai-deterministic-rules';
export type BehaviorClassification = 'missed_review_correction' | 'incorrect_ai_edit' | 'scoped_style_policy' | 'menu_content_update' | 'needs_clarification';
export function canonicalizeBehaviorValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalizeBehaviorValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalizeBehaviorValue((value as Record<string, unknown>)[key])]));
    }
    return value;
}

/** JSONB and other object stores may reorder keys; artifact identity must not. */
export function hashBehaviorArtifact(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonicalizeBehaviorValue(value))).digest('hex');
}

const hash = hashBehaviorArtifact;
export function buildBehaviorTestRecord(correction: Record<string, any>, evidence: Record<string, any> = {}) {
    const input = correction.example_original || correction.original_text || '';
    const expected = correction.example_corrected || correction.corrected_text || '';
    const intent = correction.learning_intent || correction.change_type;
    const menuUpdate = ['menu_update_only', 'menu_content_update'].includes(intent);
    const classification: BehaviorClassification = menuUpdate ? 'menu_content_update'
        : ['missed_review_correction', 'incorrect_ai_edit', 'scoped_style_policy'].includes(intent) ? intent
        : correction.status === 'accepted' && input && expected ? 'scoped_style_policy' : 'needs_clarification';
    const stages = Object.fromEntries(['chef_input', 'ai_delivered', 'chef_submitted', 'human_approved'].map(stage => {
        const supplied = evidence.stages?.[stage];
        return [stage, supplied?.source && typeof supplied.text === 'string'
            ? { status: 'known', source: supplied.source, hash: hash(supplied.text), text: supplied.text }
            : { status: 'unknown', reference: correction.submission_id ? `submission:${correction.submission_id}:${stage}` : null }];
    }));
    return { schemaVersion: 1, id: hash({ correctionId: correction.id, input, expected, reason: correction.rule }),
        correctionId: correction.id, submissionId: correction.submission_id || null,
        inputSpan: { text: input, start: null, end: null }, expectedSpan: { text: expected, start: null, end: null },
        reason: correction.rule || '', scope: { property: correction.location || correction.restaurant_name || null,
            templateType: correction.applies_to_menu_type || 'all', menuType: null },
        classification, classificationStatus: menuUpdate || correction.learning_intent ? 'reviewed' : 'proposed',
        expectationAuthority: correction.source === 'human' && correction.reviewer_name ? 'human_explanation' : 'unverified',
        provenance: { source: correction.source || 'unknown', reviewer: correction.reviewer_name || null, createdAt: correction.created_at || null },
        stages, browserRepairSupported: evidence.reproduced_without_human === true || evidence.edit_history_proves_failure === true,
        disposition: menuUpdate ? 'excluded_from_policy_learning' : 'awaiting_behavior_verification',
    };
}
function approvedCase(source:string,target:string,force:boolean) {
    if(force)return target;
    const letters=source.replace(/[^\p{L}]/gu,'');
    if(letters && letters===letters.toUpperCase())return target.toUpperCase();
    if(letters && letters===letters.toLowerCase())return target.toLowerCase();
    const words=source.match(/\p{L}+/gu)||[];
    if(words.length && words.every(word=>word[0]===word[0].toUpperCase()))return target.replace(/\p{L}+/gu,word=>word[0].toUpperCase()+word.slice(1).toLowerCase());
    return target;
}
/** Only labels mechanically justified by an accepted policy; semantic neighbors are abstention controls. */
export function buildAcceptedPolicyTestFamily(rule: AcceptedCorrectionRule) {
    if (rule.status !== 'accepted' || !rule.original_text || !rule.corrected_text
        || !getAcceptedCorrectionRulePreAiEligibility(rule).eligible
        || ['menu_content_update','menu_update_only'].includes((rule as any).learning_intent || rule.change_type || '')) return [];
    const original = rule.original_text, target = rule.corrected_text;
    const cases: Array<{ input: string; expected: string; kind: string; scope?: string }> = [];
    if (permitsSeparatorVariants(original, target)) {
        const parts = original.split(/[ \u00a0\-\u2010\u2011]+/);
        for (const separator of [' ', '-', ' -', '- ', '\u00a0', '\u2010', '\u2011']) {
            cases.push({ input: parts.join(separator), expected: target, kind: 'accepted_separator_equivalence' });
        }
        cases.push({ input: original.toUpperCase(), expected: rule.force_target_case ? target : target.toUpperCase(), kind: 'accepted_case_convention' });
    }
    const midpoint = Math.floor(target.length / 2);
    for (const input of target.length < 3 ? [] : [target.slice(0, midpoint) + target.slice(midpoint + 1),
        target.slice(0, midpoint) + target[midpoint + 1] + target[midpoint] + target.slice(midpoint + 2)]) {
        cases.push({ input, expected: input, kind: 'deterministic_abstention_context_required' });
    }
    for (const quantity of ['12', '120', '1/2']) cases.push({ input: `${original} ${quantity}`, expected: `${target} ${quantity}`, kind: 'quantity_preservation' });
    for (const example of (rule as any).reviewed_negative_examples || []) {
        if (typeof example.text === 'string' && example.reviewer && ['valid_neighbor', 'brand', 'multilingual'].includes(example.kind))
            cases.push({ input: example.text, expected: example.text, kind: example.kind });
    }
    if (rule.is_location_specific) cases.push({ input: original, expected: original, kind: 'wrong_scope_abstention', scope: 'outside_policy' });
    return cases.map(test => ({ schemaVersion: 1, policyRuleId: rule.id || hash(rule), ...test,
        expected: ['accepted_separator_equivalence','accepted_case_convention','quantity_preservation'].includes(test.kind)
            ? approvedCase(test.input, target,rule.force_target_case===true)+(test.kind==='quantity_preservation'?(test.input.match(/ (\d+(?:\/\d+)?)$/)?.[0]||''):'') : test.expected, lane: 'deterministic' }));
}

/** Frozen by the improvement cycle before authoring. The candidate never defines its own expectations. */
export function freezeBehaviorTests(records: ReturnType<typeof buildBehaviorTestRecord>[], policies: AcceptedCorrectionRule[], allPolicies: AcceptedCorrectionRule[] = policies) {
    const excluded = new Set(records.filter(record => record.disposition === 'excluded_from_policy_learning').map(record => record.correctionId));
    const eligiblePolicies = policies.filter(rule => !excluded.has(rule.id) && !['menu_content_update','menu_update_only'].includes((rule as any).learning_intent || rule.change_type || ''));
    const tests = eligiblePolicies.flatMap(rule => {
        const context = { property: rule.location || '', templateType: rule.applies_to_menu_type === 'beverage' ? 'beverage' : 'food' };
        if (!resolveCanonicalPolicies(allPolicies.filter(row => !excluded.has(row.id)), context).rules.some(row => row.id === rule.id)) return [];
        return buildAcceptedPolicyTestFamily(rule).map((test, index) => {
            const testContext = { ...context, property: test.scope === 'outside_policy' ? '__outside_approved_scope__' : context.property };
            return { ...test, expected: test.scope === 'outside_policy'
                ? canonicalizeFinalTerms(test.input, { ...testContext, acceptedCorrectionRules: allPolicies.filter(row => !excluded.has(row.id)) }).menuText : test.expected,
                id: `${test.policyRuleId}:${index}`, correctionId: rule.id, context: testContext };
        });
    });
    const contextualTests = records.filter(record => !excluded.has(record.correctionId) && !tests.some(test => test.correctionId === record.correctionId))
        .map(record => ({ correctionId: record.correctionId, input: record.inputSpan.text, expected: record.expectedSpan.text,
            authority: record.expectationAuthority, status: 'requires_contextual_historical_proof' }));
    const artifact = { schemaVersion: 1, frozenAt: new Date().toISOString(), records, tests, contextualTests };
    return { ...artifact, sha256: hash(artifact) };
}
export function validateBehaviorArtifact(artifact: any) {
    if (!artifact || artifact.schemaVersion !== 1 || !Array.isArray(artifact.records) || !Array.isArray(artifact.tests)
        || artifact.tests.length > 5000 || !Number.isFinite(Date.parse(artifact.frozenAt))) throw new Error('Missing trusted pre-draft behavior tests.');
    const { sha256, ...body } = artifact;
    if (hash(body) !== sha256) throw new Error('Trusted behavior expectations changed after freezing.');
    return artifact;
}
export async function executeBehaviorTests(artifact: any, evaluate: (input: string, context: any) => Promise<string> | string) {
    validateBehaviorArtifact(artifact);
    const outcomes: any[] = [];
    for (const test of artifact.tests) {
        try {
            const output = await evaluate(test.input, test.context);
            outcomes.push({ id: test.id, correctionId: test.correctionId, kind: test.kind, passed: output === test.expected,
                inputHash: hash(test.input), expectedHash: hash(test.expected), outputHash: hash(output) });
        } catch (error: any) { outcomes.push({ id: test.id, correctionId: test.correctionId, kind: test.kind, passed: false, error: error.message }); }
    }
    return { artifactHash: artifact.sha256, passed: outcomes.every(test => test.passed), outcomes,
        explanations: artifact.records.map((record: any) => ({ correctionId: record.correctionId,
            disposition: record.disposition === 'excluded_from_policy_learning' ? record.disposition
                : outcomes.some(test => test.correctionId === record.correctionId && !test.passed) ? 'failed_variant'
                    : outcomes.some(test => test.correctionId === record.correctionId) ? 'variants_passed_pending_paired_proof' : 'requires_paired_historical_proof' })) };
}

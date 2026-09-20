import {
    applyAnchoredMutations,
    attributeCorrectedBlock,
    freezeReviewEnvelope,
} from '../lib/review-envelope';
import { completePreparedReview, prepareReview, runFullReviewPipeline } from '../lib/review-pipeline';
import { policyHash } from '../lib/canonical-policy';

const fenced = (text: string) => `=== CORRECTED MENU ===\n${text}\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n[]\n=== END SUGGESTIONS ===`;
const rule = { id: 'term', status: 'accepted', change_type: 'spelling', original_text: 'Fishh', corrected_text: 'Fish' };

test('validates immutable source anchors before applying offset-changing edits', () => {
    const source = 'Menu\nFishh G 12\nSoupp D 8';
    const editable = [{ id: 'fish', start: 5, end: 15 }, { id: 'soup', start: 16, end: source.length }];
    expect(applyAnchoredMutations(source, [
        { start: 5, end: 10, before: 'Fishh', after: 'Fresh fish' },
        { start: 16, end: 21, before: 'Soupp', after: 'Soup' },
    ], editable).text).toBe('Menu\nFresh fish G 12\nSoup D 8');
    expect(applyAnchoredMutations(source, [{ start: 0, end: 4, before: 'Menu', after: 'Dinner' }], editable).reason)
        .toBe('read_only_or_ambiguous_anchor');
    expect(applyAnchoredMutations(source, [{ start: 5, end: 10, before: 'wrong', after: 'Fish' }], editable).reason)
        .toBe('source_anchor_mismatch');
    expect(applyAnchoredMutations(source, [{ start: 15, end: 16, before: '\n', after: ' ' }], editable).reason)
        .toBe('read_only_or_ambiguous_anchor');
});

test('length-changing earlier edits do not shift later anchors', () => {
    const source = 'Fishh G 12\nSoupp D 8';
    const result = applyAnchoredMutations(source, [
        { start: 0, end: 5, before: 'Fishh', after: 'Fresh fish' },
        { start: 11, end: 16, before: 'Soupp', after: 'Soup' },
    ], [{ id: 'first', start: 0, end: 10 }, { id: 'second', start: 11, end: source.length }]);
    expect(result.text).toBe('Fresh fish G 12\nSoup D 8');
});

test('duplicate and read-only rows fail closed without guessing an anchor', () => {
    expect(attributeCorrectedBlock('Soup D 8\nSoup D 8', 'Stew D 8\nSoup D 8').text)
        .toBe('Soup D 8\nSoup D 8');
    const source = 'DINNER\nFishh G 12';
    const editable = [{ id: 'dish', start: 7, end: source.length }];
    expect(attributeCorrectedBlock(source, 'LUNCH\nFresh fish G 12', [rule], { editableSpans: editable }).text).toBe(source);
});

test('ambiguous whole-block changes preserve the immutable source', () => {
    const source = 'DINNER\nFishh G 12\nSoup D 8';
    expect(attributeCorrectedBlock(source, 'LUNCH\nFresh fish G 12').text).toBe(source);
});

test('envelope is frozen and records hashes, context, baseline and editable spans', async () => {
    const prepared = await prepareReview('DINNER\nFishh G 12', {
        basePrompt: 'BASE', property: 'A', templateType: 'food', menuType: 'standard',
        baselineMenuContent: 'DINNER\nFish G 12', baselineProvenance: { id: 'approved-1' },
        readOnlyContext: 'DINNER', model: 'test-model', settings: { temperature: 0 },
        acceptedCorrectionRules: [rule], precheckEnabled: false, managedRawNoticePresent: true,
    });
    expect(Object.isFrozen(prepared.envelope)).toBe(true);
    expect(Object.isFrozen(prepared.envelope.context)).toBe(true);
    expect(prepared.envelope.originalBodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.envelope.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.envelope.baselineProvenance).toEqual({ id: 'approved-1' });
    expect(prepared.envelope.editableSpans).toEqual([{ id: 'row:0', start: 0, end: 6 }, { id: 'row:1', start: 7, end: 17 }]);
    expect(prepared.envelope.context.managedRawNoticePresent).toBe(true);
});

test('envelope hashes and immutable fields do not drift when caller inputs mutate', async () => {
    const acceptedRules = [rule];
    const options: any = {
        basePrompt: 'BASE', property: 'A', templateType: 'food', menuType: 'standard',
        baselineMenuContent: 'DINNER\nFish G 12', baselineProvenance: { id: 'approved-1' },
        acceptedCorrectionRules: acceptedRules, precheckEnabled: false,
    };
    const prepared = await prepareReview('DINNER\nFishh G 12', options);
    const originalPolicyHash = policyHash(acceptedRules);
    options.property = 'MUTATED';
    options.baselineProvenance.id = 'mutated';
    acceptedRules[0].corrected_text = 'Other';
    expect(prepared.envelope.context.property).toBe('A');
    expect(prepared.envelope.baselineProvenance).toEqual({ id: 'approved-1' });
    expect(prepared.envelope.acceptedPolicyHash).toBe(originalPolicyHash);
    expect(prepared.envelope.originalBodyHash).toBe(policyHash('DINNER\nFishh G 12'));
});

test('Basic/offline coordinator adapters produce identical final bytes, guards and policy decisions', async () => {
    const menu = 'DINNER\nFishh G 12\nSoup D 8';
    const options = {
        basePrompt: 'BASE', property: 'A', templateType: 'food', menuType: 'standard',
        acceptedCorrectionRules: [rule], precheckEnabled: false, managedRawNoticePresent: true,
    };
    let modelCalls = 0;
    const caller = async (text: string, prompt: string) => {
        modelCalls++;
        expect(text).toContain('Fishh');
        expect(prompt).toContain('BASE');
        return fenced(text.replace('Fishh', 'Fish'));
    };
    const prepared = await prepareReview(menu, options);
    const coordinated = completePreparedReview(prepared, await caller(prepared.preCheckedReviewBody, prepared.promptInfo.prompt), { finishReason: 'stop' });
    const offline = await runFullReviewPipeline(menu, options, caller);
    expect(coordinated.finalCorrectedMenu).toBe('DINNER\nFish G 12\nSoup D 8');
    expect(coordinated.finalCorrectedMenu).toBe(offline.finalCorrectedMenu);
    expect(coordinated.finalSuggestions).toEqual(offline.finalSuggestions);
    expect(coordinated.post.safetyDiagnostics).toEqual(offline.post.safetyDiagnostics);
    expect(coordinated.outputHash).toBe(offline.outputHash);
    expect(coordinated.envelope).toEqual(offline.envelope);
    expect(modelCalls).toBe(2);
});

test('model failure fallback is source-preserving and still one-call', async () => {
    const menu = 'DINNER\nFishh G 12';
    let calls = 0;
    const result = await runFullReviewPipeline(menu, { basePrompt: 'BASE', acceptedCorrectionRules: [rule], precheckEnabled: false }, async () => {
        calls++;
        return 'not a valid response';
    });
    expect(calls).toBe(1);
    expect(result.finalCorrectedMenu).toBe(menu);
    expect(result.envelope.originalBodyHash).toMatch(/^[a-f0-9]{64}$/);
});

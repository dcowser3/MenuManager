"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const review_envelope_1 = require("../lib/review-envelope");
const review_pipeline_1 = require("../lib/review-pipeline");
const canonical_policy_1 = require("../lib/canonical-policy");
const fencedWithSuggestions = (text, suggestions = []) => `=== CORRECTED MENU ===\n${text}\n=== END CORRECTED MENU ===\n=== SUGGESTIONS ===\n${JSON.stringify(suggestions)}\n=== END SUGGESTIONS ===`;
const fenced = (text) => fencedWithSuggestions(text);
const rule = { id: 'term', status: 'accepted', change_type: 'spelling', original_text: 'Fishh', corrected_text: 'Fish' };
test('validates immutable source anchors before applying offset-changing edits', () => {
    const source = 'Menu\nFishh G 12\nSoupp D 8';
    const editable = [{ id: 'fish', start: 5, end: 15 }, { id: 'soup', start: 16, end: source.length }];
    expect((0, review_envelope_1.applyAnchoredMutations)(source, [
        { start: 5, end: 10, before: 'Fishh', after: 'Fresh fish' },
        { start: 16, end: 21, before: 'Soupp', after: 'Soup' },
    ], editable).text).toBe('Menu\nFresh fish G 12\nSoup D 8');
    expect((0, review_envelope_1.applyAnchoredMutations)(source, [{ start: 0, end: 4, before: 'Menu', after: 'Dinner' }], editable).reason)
        .toBe('read_only_or_ambiguous_anchor');
    expect((0, review_envelope_1.applyAnchoredMutations)(source, [{ start: 5, end: 10, before: 'wrong', after: 'Fish' }], editable).reason)
        .toBe('source_anchor_mismatch');
    expect((0, review_envelope_1.applyAnchoredMutations)(source, [{ start: 15, end: 16, before: '\n', after: ' ' }], editable).reason)
        .toBe('read_only_or_ambiguous_anchor');
    expect((0, review_envelope_1.applyAnchoredMutations)(source, [{ start: 5, end: 5, before: '', after: 'A' }, { start: 5, end: 5, before: '', after: 'B' }], editable).reason)
        .toBe('overlapping_edits');
    expect((0, review_envelope_1.applyAnchoredMutations)(source, [{ start: 5, end: 6, before: 'F', after: 'f' }], [{ id: 'x', start: 0, end: 10 }, { id: 'x', start: 11, end: source.length }]).reason)
        .toBe('ambiguous_editable_spans');
    expect((0, review_envelope_1.applyAnchoredMutations)(source, [{ start: 5, end: 6, before: 'F', after: 'f' }], [{ id: 'x', start: 0, end: 12 }, { id: 'y', start: 11, end: source.length }]).reason)
        .toBe('ambiguous_editable_spans');
    expect((0, review_envelope_1.applyAnchoredMutations)(source, [{ start: 5, end: 6, before: 'F', after: 'f' }], [{ id: '', start: 0, end: 10 }]).reason)
        .toBe('malformed_editable_spans');
});
test('length-changing earlier edits do not shift later anchors', () => {
    const source = 'Fishh G 12\nSoupp D 8';
    const result = (0, review_envelope_1.applyAnchoredMutations)(source, [
        { start: 0, end: 5, before: 'Fishh', after: 'Fresh fish' },
        { start: 11, end: 16, before: 'Soupp', after: 'Soup' },
    ], [{ id: 'first', start: 0, end: 10 }, { id: 'second', start: 11, end: source.length }]);
    expect(result.text).toBe('Fresh fish G 12\nSoup D 8');
});
test('duplicate and read-only rows fail closed without guessing an anchor', () => {
    expect((0, review_envelope_1.attributeCorrectedBlock)('Soup D 8\nSoup D 8', 'Stew D 8\nSoup D 8').text)
        .toBe('Soup D 8\nSoup D 8');
    const source = 'DINNER\nFishh G 12';
    const editable = [{ id: 'dish', start: 7, end: source.length }];
    expect((0, review_envelope_1.attributeCorrectedBlock)(source, 'LUNCH\nFresh fish G 12', [rule], { editableSpans: editable }).text).toBe(source);
});
test('ambiguous whole-block changes preserve the immutable source', () => {
    const source = 'DINNER\nFishh G 12\nSoup D 8';
    expect((0, review_envelope_1.attributeCorrectedBlock)(source, 'LUNCH\nFresh fish G 12').text).toBe(source);
});
test('envelope is frozen and records hashes, context, baseline and editable spans', async () => {
    const prepared = await (0, review_pipeline_1.prepareReview)('DINNER\nFishh G 12', {
        basePrompt: 'BASE', property: 'A', templateType: 'food', menuType: 'standard',
        baselineMenuContent: 'DINNER\nFish G 12', baselineProvenance: { id: 'approved-1' },
        readOnlyContext: 'DINNER', model: 'test-model', settings: { temperature: 0 },
        acceptedCorrectionRules: [rule], precheckEnabled: false, managedRawNoticePresent: true,
    });
    expect(Object.isFrozen(prepared.envelope)).toBe(true);
    expect(Object.isFrozen(prepared.envelope.context)).toBe(true);
    expect(prepared.envelope.originalBodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.envelope.rawInputSnapshotHash).toBe(prepared.envelope.originalBodyHash);
    expect(prepared.envelope.precheckedBody).toBe(prepared.preCheckedReviewBody);
    expect(prepared.envelope.precheckedBodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.envelope.editableSpanBasis).toBe('prechecked_review_body');
    expect(prepared.envelope.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.envelope.baselineProvenance).toEqual({ id: 'approved-1' });
    expect(prepared.envelope.editableSpans).toEqual([{ id: 'row:0', start: 0, end: 6 }, { id: 'row:1', start: 7, end: 17 }]);
    expect(prepared.envelope.context.managedRawNoticePresent).toBe(true);
});
test('prepared consumed state is frozen and completion fails closed on post-prepare drift', async () => {
    const prepared = await (0, review_pipeline_1.prepareReview)('DINNER\nFishh G 12', {
        basePrompt: 'BASE', property: 'A', acceptedCorrectionRules: [rule], precheckEnabled: false,
    });
    expect(Object.isFrozen(prepared.promptInfo)).toBe(true);
    expect(Object.isFrozen(prepared.nearMissAnalysis.findings)).toBe(true);
    prepared.promptInfo = { ...prepared.promptInfo, prompt: 'TAMPERED PROMPT' };
    const result = (0, review_pipeline_1.completePreparedReview)(prepared, fenced('DINNER\nFish G 12'));
    expect(result.finalCorrectedMenu).toBe('DINNER\nFishh G 12');
    expect(result.finalSuggestions).toEqual([]);
    expect(result.post.hasCriticalErrors).toBe(false);
    expect(result.reviewStatus.reusable).toBe(false);
    expect(result.diagnostics[0]).toEqual({ stage: 'integrity', reason: 'prepared_state_drift:prompt' });
});
test.each([
    ['editable spans', (prepared) => { prepared.envelope = { ...prepared.envelope, editableSpans: [{ id: 'tampered', start: 0, end: 1 }] }; }],
    ['managed raw notice', (prepared) => { prepared.managedRawNoticePresent = !prepared.managedRawNoticePresent; }],
    ['effective allergens', (prepared) => { prepared.effectiveReviewAllergens = 'TAMPERED'; }],
    ['sanitized menu', (prepared) => { prepared.sanitizedMenuContent = { body: 'TAMPERED' }; }],
    ['precheck result', (prepared) => { prepared.preAiDeterministic = { menuText: 'TAMPERED' }; }],
])('completion rejects replacement tampering of %s', async (_label, tamper) => {
    const prepared = await (0, review_pipeline_1.prepareReview)('DINNER\nFishh G 12', {
        basePrompt: 'BASE', acceptedCorrectionRules: [rule], precheckEnabled: false,
    });
    tamper(prepared);
    const result = (0, review_pipeline_1.completePreparedReview)(prepared, fenced('DINNER\nFish G 12'));
    expect(result.finalCorrectedMenu).toBe('DINNER\nFishh G 12');
    expect(result.reviewStatus).toEqual({ complete: false, transportStatus: 'rejected', reusable: false });
    expect(result.diagnostics[0].stage).toBe('integrity');
});
test('missing integrity fails closed without dereferencing or throwing', async () => {
    const prepared = await (0, review_pipeline_1.prepareReview)('DINNER\nFishh G 12', {
        basePrompt: 'BASE', acceptedCorrectionRules: [rule], precheckEnabled: false,
    });
    const tampered = { ...prepared };
    const result = (0, review_pipeline_1.completePreparedReview)(tampered, fenced('DINNER\nFish G 12'));
    expect(result.finalCorrectedMenu).toBe('DINNER\nFishh G 12');
    expect(result.reviewStatus).toEqual({ complete: false, transportStatus: 'rejected', reusable: false });
    expect(result.diagnostics[0]).toEqual({ stage: 'integrity', reason: 'missing_prepared_integrity' });
});
test('envelope hashes and immutable fields do not drift when caller inputs mutate', async () => {
    const acceptedRules = [rule];
    const options = {
        basePrompt: 'BASE', property: 'A', templateType: 'food', menuType: 'standard',
        baselineMenuContent: 'DINNER\nFish G 12', baselineProvenance: { id: 'approved-1' },
        acceptedCorrectionRules: acceptedRules, precheckEnabled: false,
    };
    const prepared = await (0, review_pipeline_1.prepareReview)('DINNER\nFishh G 12', options);
    const originalPolicyHash = (0, canonical_policy_1.policyHash)(acceptedRules);
    options.property = 'MUTATED';
    options.baselineProvenance.id = 'mutated';
    acceptedRules[0].corrected_text = 'Other';
    expect(prepared.envelope.context.property).toBe('A');
    expect(prepared.envelope.baselineProvenance).toEqual({ id: 'approved-1' });
    expect(prepared.envelope.acceptedPolicyHash).toBe(originalPolicyHash);
    expect(prepared.envelope.originalBodyHash).toBe((0, canonical_policy_1.policyHash)('DINNER\nFishh G 12'));
});
test('Basic/offline coordinator adapters produce identical final bytes, guards and policy decisions', async () => {
    const menu = 'DINNER\nFishh G 12\nSoup D 8';
    const options = {
        basePrompt: 'BASE', property: 'A', templateType: 'food', menuType: 'standard',
        acceptedCorrectionRules: [rule], precheckEnabled: false, managedRawNoticePresent: true,
    };
    let modelCalls = 0;
    const caller = async (text, prompt) => {
        modelCalls++;
        expect(text).toContain('Fishh');
        expect(prompt).toContain('BASE');
        return fenced(text.replace('Fishh', 'Fish'));
    };
    const prepared = await (0, review_pipeline_1.prepareReview)(menu, options);
    const coordinated = (0, review_pipeline_1.completePreparedReview)(prepared, await caller(prepared.preCheckedReviewBody, prepared.promptInfo.prompt), { finishReason: 'stop' });
    const offline = await (0, review_pipeline_1.runFullReviewPipeline)(menu, options, caller);
    expect(coordinated.finalCorrectedMenu).toBe('DINNER\nFish G 12\nSoup D 8');
    expect(coordinated.finalCorrectedMenu).toBe(offline.finalCorrectedMenu);
    expect(coordinated.finalSuggestions).toEqual(offline.finalSuggestions);
    expect(coordinated.post.safetyDiagnostics).toEqual(offline.post.safetyDiagnostics);
    expect(coordinated.post.hasCriticalErrors).toBe(offline.post.hasCriticalErrors);
    expect(coordinated.post.structureGuard.safe).toBe(offline.post.structureGuard.safe);
    expect(coordinated.post.guardedCorrectedMenu).toBe(offline.post.guardedCorrectedMenu);
    expect(coordinated.envelope.acceptedPolicyHash).toBe(offline.envelope.acceptedPolicyHash);
    expect(coordinated.outputHash).toBe(offline.outputHash);
    expect(coordinated.envelope).toEqual(offline.envelope);
    expect(modelCalls).toBe(2);
});
test('Basic/offline adapters match on rejected read-only merge and do not retain rejected critical state', async () => {
    const menu = 'DINNER\nFishh G 12';
    const options = {
        basePrompt: 'BASE', acceptedCorrectionRules: [rule], precheckEnabled: false,
        editableSpans: [{ id: 'dish-only', start: 7, end: menu.length }],
    };
    const feedback = fencedWithSuggestions('LUNCH\nFresh fish G 12', [{
            type: 'Missing Price', severity: 'critical', confidence: 'high', menuItem: 'DINNER',
            description: 'missing price', recommendation: 'Add a price',
        }]);
    let directCalls = 0;
    const directPrepared = await (0, review_pipeline_1.prepareReview)(menu, options);
    const directFeedback = await (async () => {
        directCalls++;
        return feedback;
    })();
    const direct = (0, review_pipeline_1.completePreparedReview)(directPrepared, directFeedback, { finishReason: 'stop' });
    let offlineCalls = 0;
    const offline = await (0, review_pipeline_1.runFullReviewPipeline)(menu, options, async () => {
        offlineCalls++;
        return { feedback, finishReason: 'stop' };
    });
    expect(directCalls).toBe(1);
    expect(offlineCalls).toBe(1);
    expect(direct.finalCorrectedMenu).toBe(menu);
    expect(offline.finalCorrectedMenu).toBe(menu);
    expect(direct.finalSuggestions).toEqual([]);
    expect(offline.finalSuggestions).toEqual([]);
    expect(direct.post.hasCriticalErrors).toBe(false);
    expect(offline.post.hasCriticalErrors).toBe(false);
    expect(direct.post.guardedCorrectedMenu).toBe(menu);
    expect(offline.post.guardedCorrectedMenu).toBe(menu);
    expect(direct.post.deliveredStructureGuard?.safe).toBe(true);
    expect(offline.post.deliveredStructureGuard?.safe).toBe(true);
    expect(direct.post.deliveredReconciliation?.suggestions).toEqual([]);
    expect(offline.post.deliveredReconciliation?.suggestions).toEqual([]);
    expect(direct.post.structureGuard.safe).toBe(offline.post.structureGuard.safe);
    expect(direct.reviewStatus).toEqual(offline.reviewStatus);
    expect(direct.envelope.acceptedPolicyHash).toBe(offline.envelope.acceptedPolicyHash);
});
test('rejected delivery drops bogus candidate findings but preserves genuine source criticals', async () => {
    const menu = 'First Course\nsoup\nSecond Course\nfish';
    const prepared = await (0, review_pipeline_1.prepareReview)(menu, {
        basePrompt: 'BASE', menuType: 'prix_fixe', templateType: 'beverage', precheckEnabled: false,
        editableSpans: [{ id: 'fish', start: 31, end: menu.length }],
    });
    const feedback = fencedWithSuggestions('LUNCH\nsteak\nSecond Course\nfish', [{
            type: 'Missing Price', severity: 'critical', menuItem: 'candidate-only',
            description: 'candidate-only missing price', recommendation: 'invent a price',
        }]);
    const result = (0, review_pipeline_1.completePreparedReview)(prepared, feedback, { finishReason: 'stop' });
    expect(result.finalCorrectedMenu).toBe(menu);
    expect(result.finalSuggestions.some(suggestion => suggestion.type === 'Missing Price' && suggestion.menuItem === 'candidate-only')).toBe(false);
    expect(result.finalSuggestions).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'PRICING STRUCTURE', severity: 'critical' }),
    ]));
    expect(result.post.hasCriticalErrors).toBe(true);
    expect(result.reviewStatus).toEqual({ complete: false, transportStatus: 'rejected', reusable: false });
});
test('model failure fallback is source-preserving and still one-call', async () => {
    const menu = 'DINNER\nFishh G 12';
    let calls = 0;
    const result = await (0, review_pipeline_1.runFullReviewPipeline)(menu, { basePrompt: 'BASE', acceptedCorrectionRules: [rule], precheckEnabled: false }, async () => {
        calls++;
        return 'not a valid response';
    });
    expect(calls).toBe(1);
    expect(result.finalCorrectedMenu).toBe(menu);
    expect(result.envelope.originalBodyHash).toMatch(/^[a-f0-9]{64}$/);
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const improvement_cycle_core_1 = require("../lib/improvement-cycle-core");
const review_response_contract_1 = require("../lib/review-response-contract");
describe('shouldDeferForCadence', () => {
    const now = Date.parse('2026-07-25T09:15:00Z');
    const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();
    test('defers when the last proposal is inside the cadence window', () => {
        const res = (0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: hoursAgo(24), nowMs: now, minHours: 40 });
        expect(res.defer).toBe(true);
        expect(res.reason).toContain('cadence requires 40h');
    });
    test('runs once the window has passed', () => {
        expect((0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: hoursAgo(41), nowMs: now, minHours: 40 }).defer).toBe(false);
    });
    test('a failed night (no proposal produced) retries the next night', () => {
        // Last proposal 3 days ago because the last two runs crashed before insert.
        expect((0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: hoursAgo(72), nowMs: now, minHours: 40 }).defer).toBe(false);
    });
    test('force, no history, unreadable timestamp and a zero window never defer', () => {
        expect((0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: hoursAgo(1), nowMs: now, minHours: 40, force: true }).defer).toBe(false);
        expect((0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: null, nowMs: now, minHours: 40 }).defer).toBe(false);
        expect((0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: 'not-a-date', nowMs: now, minHours: 40 }).defer).toBe(false);
        expect((0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: hoursAgo(1), nowMs: now, minHours: 0 }).defer).toBe(false);
    });
    test('a supersede-eligible run bypasses cadence even inside the window', () => {
        const res = (0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: hoursAgo(1), nowMs: now, minHours: 40, supersedeEligible: true });
        expect(res.defer).toBe(false);
        expect(res.reason).toContain('supersede eligible');
    });
    test('force still short-circuits ahead of the supersede check', () => {
        expect((0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: hoursAgo(1), nowMs: now, minHours: 40, force: true, supersedeEligible: false }).reason).toBe('forced run');
    });
    test('Jul 29→30 regression: anchor 24h ago still defers plain new-mode runs', () => {
        // The anchor here is already the attention-consuming proposal (rejected rows are
        // excluded upstream by pickCadenceAnchor). A plain new-proposal run must still wait.
        const res = (0, improvement_cycle_core_1.shouldDeferForCadence)({ lastProposalCreatedAt: hoursAgo(24), nowMs: now, minHours: 40 });
        expect(res.defer).toBe(true);
    });
});
describe('pickCadenceAnchor', () => {
    const row = (cycle_id, status, created_at = '2026-07-29T09:15:00Z') => ({ cycle_id, status, created_at });
    test('skips a leading rejected row and returns the approved one behind it', () => {
        const anchor = (0, improvement_cycle_core_1.pickCadenceAnchor)([
            row('2026-07-29', 'rejected'),
            row('2026-07-27', 'approved'),
        ]);
        expect(anchor?.cycle_id).toBe('2026-07-27');
    });
    test('skips a rejected+superseded chain to the first attention-consuming row', () => {
        const anchor = (0, improvement_cycle_core_1.pickCadenceAnchor)([
            row('2026-07-29', 'rejected'),
            row('2026-07-28', 'superseded'),
            row('2026-07-27', 'pending'),
        ]);
        expect(anchor?.cycle_id).toBe('2026-07-27');
    });
    test('returns null when every row is rejected or superseded', () => {
        expect((0, improvement_cycle_core_1.pickCadenceAnchor)([row('a', 'rejected'), row('b', 'superseded')])).toBeNull();
        expect((0, improvement_cycle_core_1.pickCadenceAnchor)([])).toBeNull();
    });
    test('a missing or unknown status counts as an anchor (fail toward deferral)', () => {
        expect((0, improvement_cycle_core_1.pickCadenceAnchor)([{ cycle_id: 'x', created_at: '2026-07-29T09:15:00Z' }])?.cycle_id).toBe('x');
        expect((0, improvement_cycle_core_1.pickCadenceAnchor)([row('y', 'weird-status')])?.cycle_id).toBe('y');
    });
});
describe('describePublicUrlMisconfiguration', () => {
    test('flags a production run that would email loopback links', () => {
        const warning = (0, improvement_cycle_core_1.describePublicUrlMisconfiguration)({ DASHBOARD_URL: 'http://localhost:3005', NODE_ENV: 'production' });
        expect(warning).toContain('unreachable outside the container');
        expect(warning).toContain('DASHBOARD_URL');
    });
    test('flags an entirely unset config in production (falls back to localhost)', () => {
        expect((0, improvement_cycle_core_1.describePublicUrlMisconfiguration)({ NODE_ENV: 'production' })).not.toBeNull();
    });
    test('silent outside production, where localhost is correct', () => {
        expect((0, improvement_cycle_core_1.describePublicUrlMisconfiguration)({ DASHBOARD_URL: 'http://localhost:3005' })).toBeNull();
        expect((0, improvement_cycle_core_1.describePublicUrlMisconfiguration)({ DASHBOARD_URL: 'http://localhost:3005', NODE_ENV: 'development' })).toBeNull();
    });
    test('flags a bare-IP base — reachable, but an untrusted-looking link that rots when the IP changes', () => {
        const warning = (0, improvement_cycle_core_1.describePublicUrlMisconfiguration)({ DASHBOARD_URL: 'http://3.231.96.95:3005', NODE_ENV: 'production' });
        expect(warning).toContain('raw IP');
        expect(warning).toContain('sandovalhospitalitymenumanager.live');
    });
    test('flags plain HTTP on a real hostname', () => {
        expect((0, improvement_cycle_core_1.describePublicUrlMisconfiguration)({ DASHBOARD_URL: 'http://menus.example.com', NODE_ENV: 'production' }))
            .toContain('plain HTTP');
    });
    test('isBareIpBaseUrl distinguishes IPs from hostnames', () => {
        expect((0, improvement_cycle_core_1.isBareIpBaseUrl)('http://3.231.96.95:3005')).toBe(true);
        expect((0, improvement_cycle_core_1.isBareIpBaseUrl)('https://10.0.0.1')).toBe(true);
        expect((0, improvement_cycle_core_1.isBareIpBaseUrl)('https://sandovalhospitalitymenumanager.live')).toBe(false);
        expect((0, improvement_cycle_core_1.isBareIpBaseUrl)('https://1.2.3.4.example.com')).toBe(false);
    });
    test('silent when a real public HTTPS address is configured', () => {
        expect((0, improvement_cycle_core_1.describePublicUrlMisconfiguration)({ DASHBOARD_URL: 'https://sandovalhospitalitymenumanager.live', NODE_ENV: 'production' })).toBeNull();
        expect((0, improvement_cycle_core_1.describePublicUrlMisconfiguration)({
            DASHBOARD_URL: 'http://localhost:3005',
            DASHBOARD_PUBLIC_URL: 'https://menus.example.com',
            NODE_ENV: 'production',
        })).toBeNull();
    });
    test('isLoopbackBaseUrl covers the loopback spellings, not lookalikes', () => {
        for (const url of ['http://localhost:3005', 'http://127.0.0.1:3005', 'https://localhost', 'http://0.0.0.0:3005', 'http://localhost:3005/']) {
            expect((0, improvement_cycle_core_1.isLoopbackBaseUrl)(url)).toBe(true);
        }
        for (const url of ['http://3.231.96.95:3005', 'https://menus.example.com', 'http://localhost.example.com']) {
            expect((0, improvement_cycle_core_1.isLoopbackBaseUrl)(url)).toBe(false);
        }
    });
});
describe('isTransientOpenAiFailure', () => {
    test('5xx is transient, 4xx is not', () => {
        expect((0, improvement_cycle_core_1.isTransientOpenAiFailure)({ status: 500 })).toBe(true);
        expect((0, improvement_cycle_core_1.isTransientOpenAiFailure)({ status: 503 })).toBe(true);
        expect((0, improvement_cycle_core_1.isTransientOpenAiFailure)({ status: 400 })).toBe(false);
        expect((0, improvement_cycle_core_1.isTransientOpenAiFailure)({ status: 401 })).toBe(false);
    });
    test('network faults are transient', () => {
        expect((0, improvement_cycle_core_1.isTransientOpenAiFailure)({ error: { message: 'fetch failed' } })).toBe(true);
        expect((0, improvement_cycle_core_1.isTransientOpenAiFailure)({ error: { message: 'read ECONNRESET' } })).toBe(true);
        expect((0, improvement_cycle_core_1.isTransientOpenAiFailure)({ error: { message: 'socket hang up' } })).toBe(true);
        expect((0, improvement_cycle_core_1.isTransientOpenAiFailure)({ error: { message: 'Invalid JSON in response' } })).toBe(false);
        expect((0, improvement_cycle_core_1.isTransientOpenAiFailure)({})).toBe(false);
    });
});
describe('shouldRunCycle gating', () => {
    const pending = { id: 'p-old', cycle_id: '2026-07-01' };
    test('pending + no new corrections: skip with reminder reason (no supersede)', () => {
        const gate = (0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 0, pendingProposal: pending, minNewCorrections: 1 });
        expect(gate.run).toBe(false);
        expect(gate.reason).toContain('pending proposal');
    });
    test('pending + enough new corrections: supersede mode', () => {
        const gate = (0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 2, pendingProposal: pending, minNewCorrections: 1 });
        expect(gate.run).toBe(true);
        expect(gate).toMatchObject({
            run: true,
            mode: 'supersede',
            pendingProposal: { cycle_id: '2026-07-01' },
        });
    });
    test('force with pending: supersede even with zero new corrections', () => {
        const gate = (0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 0, pendingProposal: pending, minNewCorrections: 1, force: true });
        expect(gate.run).toBe(true);
        if (gate.run)
            expect(gate.mode).toBe('supersede');
    });
    test('force without pending: new mode', () => {
        const gate = (0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 0, pendingProposal: null, minNewCorrections: 1, force: true });
        expect(gate).toEqual({ run: true, mode: 'new', reason: 'forced re-run' });
    });
    test('skips below the correction threshold and runs at it when no pending', () => {
        expect((0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 0, pendingProposal: null, minNewCorrections: 1 }).run).toBe(false);
        expect((0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 2, pendingProposal: null, minNewCorrections: 3 }).run).toBe(false);
        const at = (0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 3, pendingProposal: null, minNewCorrections: 3 });
        expect(at.run).toBe(true);
        if (at.run)
            expect(at.mode).toBe('new');
    });
    test('treats minNewCorrections below 1 as 1', () => {
        expect((0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 0, pendingProposal: null, minNewCorrections: 0 }).run).toBe(false);
        expect((0, improvement_cycle_core_1.shouldRunCycle)({ unconsumedCorrectionCount: 1, pendingProposal: null, minNewCorrections: 0 }).run).toBe(true);
    });
});
describe('assembleSupersedeCorrectionSet', () => {
    test('merges carried-over and unconsumed, dedupes by id, excludes proposal-* rows', () => {
        const carried = [
            { id: 'c1', submission_id: 's1', created_at: '2026-07-01T00:00:00Z' },
            { id: 'c2', submission_id: 'proposal-x', created_at: '2026-07-01T01:00:00Z' },
        ];
        const unconsumed = [
            { id: 'c3', submission_id: 's2', created_at: '2026-07-02T00:00:00Z' },
            { id: 'c1', submission_id: 's1', created_at: '2026-07-01T00:00:00Z' }, // overlap
        ];
        const { combined, carriedCount, newCount } = (0, improvement_cycle_core_1.assembleSupersedeCorrectionSet)(unconsumed, carried);
        expect(combined.map((r) => r.id)).toEqual(['c1', 'c3']);
        expect(carriedCount).toBe(1);
        expect(newCount).toBe(1);
    });
});
describe('buildReplayUnavailableForCorrections', () => {
    test('tags every correction replay_unavailable with a reviewer-visible warning', () => {
        const { evidence, warning } = (0, improvement_cycle_core_1.buildReplayUnavailableForCorrections)([{ id: 'a', submission_id: 's1', original_text: 'x', corrected_text: 'y' }], 'Differ lib unavailable');
        expect(evidence).toHaveLength(1);
        expect(evidence[0].status).toBe('replay_unavailable');
        expect(warning).toContain('replay unavailable');
        expect(warning).toContain('Differ lib unavailable');
    });
});
describe('pickEffectivePrompt', () => {
    test('prefers the latest approved proposal over the file', () => {
        const result = (0, improvement_cycle_core_1.pickEffectivePrompt)([
            { status: 'approved', final_prompt: 'OLD APPROVED', reviewed_at: '2026-06-01T00:00:00Z' },
            { status: 'approved_modified', final_prompt: 'NEWEST APPROVED', reviewed_at: '2026-06-10T00:00:00Z' },
            { status: 'rejected', final_prompt: 'REJECTED', reviewed_at: '2026-06-11T00:00:00Z' },
        ], 'FILE PROMPT');
        expect(result.source).toBe('approved_proposal');
        expect(result.prompt).toBe('NEWEST APPROVED');
    });
    test('falls back to proposed_prompt when final_prompt is empty, and to the file when nothing is approved', () => {
        expect((0, improvement_cycle_core_1.pickEffectivePrompt)([
            { status: 'approved', final_prompt: '', proposed_prompt: 'PROPOSED', reviewed_at: '2026-06-10T00:00:00Z' },
        ], 'FILE').prompt).toBe('PROPOSED');
        expect((0, improvement_cycle_core_1.pickEffectivePrompt)([], 'FILE')).toEqual({ prompt: 'FILE', source: 'prompt_file' });
        expect((0, improvement_cycle_core_1.pickEffectivePrompt)([{ status: 'rejected', final_prompt: 'X' }], 'FILE').source).toBe('prompt_file');
    });
});
describe('validateImprovementLlmOutput', () => {
    const validRule = {
        original_text: 'veggies',
        corrected_text: 'vegetables',
        change_type: 'spelling',
        rule: 'Reviewer prefers the full word.',
        applies_to_menu_type: 'all',
        is_location_specific: false,
        location: null,
        other_applicable_locations: [],
    };
    test('throws without a proposed prompt', () => {
        expect(() => (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ analysis: 'x' })).toThrow('proposed_prompt');
    });
    test('keeps valid rules and drops unsafe or incomplete ones with warnings', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            analysis: 'Did things.',
            proposed_prompt: 'P'.repeat(600),
            proposed_replacement_rules: [
                validRule,
                { ...validRule, change_type: 'content' },
                { ...validRule, corrected_text: '' },
                { ...validRule, corrected_text: 'veggies' },
            ],
            code_recommendations: [
                { title: 'Add guard', description: 'Do X precisely.', manifest_rule_ids: ['post-ai/price-integrity-guard'], target_file_hint: 'services/dashboard/lib/price-integrity-guard.ts' },
                { title: '', description: 'missing title' },
            ],
        });
        expect(output.proposed_replacement_rules).toHaveLength(1);
        expect(output.proposed_replacement_rules[0].original_text).toBe('veggies');
        expect(output.warnings.join(' ')).toContain('not deterministic-safe');
        expect(output.code_recommendations).toHaveLength(1);
        expect(output.code_recommendations[0].title).toBe('Add guard');
    });
    test('drops context-dependent terminology (tartare/tartar) from replacement rules', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'P'.repeat(600),
            proposed_replacement_rules: [
                { ...validRule, original_text: 'poblano tartare', corrected_text: 'poblano tartar', change_type: 'terminology' },
                validRule, // veggies -> vegetables, safe, should survive
            ],
        });
        expect(output.proposed_replacement_rules.map((r) => r.original_text)).toEqual(['veggies']);
        expect(output.warnings.some((w) => /context-dependent/.test(w) && /tartar/.test(w))).toBe(true);
    });
    test('normalizes accent-only replacements with unsafe labels into deterministic diacritic rules', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'P'.repeat(600),
            proposed_replacement_rules: [
                {
                    ...validRule,
                    original_text: 'espadin',
                    corrected_text: 'espadín',
                    change_type: 'content',
                    rule: 'Use the Spanish diacritic for the mezcal agave term.',
                },
            ],
        });
        expect(output.proposed_replacement_rules).toHaveLength(1);
        expect(output.proposed_replacement_rules[0]).toMatchObject({
            original_text: 'espadin',
            corrected_text: 'espadín',
            change_type: 'diacritic',
        });
        expect(output.warnings.some((w) => w.includes('normalized to "diacritic"'))).toBe(true);
    });
    test('warns on a suspiciously short prompt and normalizes menu scope', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'short prompt',
            proposed_replacement_rules: [{ ...validRule, applies_to_menu_type: 'WEIRD' }],
        });
        expect(output.warnings.some((w) => w.includes('suspiciously short'))).toBe(true);
        expect(output.proposed_replacement_rules[0].applies_to_menu_type).toBe('all');
    });
    test('UNCHANGED sentinel substitutes the current prompt', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'UNCHANGED', analysis: 'No prompt change needed.' }, { currentPrompt: 'THE CURRENT PROMPT' });
        expect(output.promptUnchanged).toBe(true);
        expect(output.proposed_prompt).toBe('THE CURRENT PROMPT');
        expect(output.warnings.some((w) => w.includes('already covered/handled'))).toBe(true);
    });
    test('warns when unchanged analysis dismisses missed prompt-lane corrections as already handled', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'UNCHANGED',
            analysis: 'The word-order corrections should be handled by the prompt, so no prompt change is needed.',
        }, { currentPrompt: 'THE CURRENT PROMPT' });
        expect(output.promptUnchanged).toBe(true);
        expect(output.warnings.some((w) => w.includes('current guidance was not specific enough'))).toBe(true);
    });
    test('echoed input context falls back to unchanged with a warning', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'Some prompt...\n## Code Rules Manifest\n| aji | ají |' }, { currentPrompt: 'THE CURRENT PROMPT' });
        expect(output.promptUnchanged).toBe(true);
        expect(output.proposed_prompt).toBe('THE CURRENT PROMPT');
        expect(output.warnings.some((w) => w.includes('echoed input context'))).toBe(true);
    });
    test('broken Markdown code fence structure falls back to unchanged with a warning', () => {
        const current = [
            'Response format:',
            '```',
            '=== CORRECTED MENU ===',
            '=== END CORRECTED MENU ===',
            '```',
            'Rules continue here.',
        ].join('\n');
        const proposed = [
            'Response format:',
            '```',
            '=== CORRECTED MENU ===',
            '=== END CORRECTED MENU ===',
            'Rules continue here.',
        ].join('\n');
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: proposed, proposed_replacement_rules: [validRule] }, { currentPrompt: current });
        expect(output.promptUnchanged).toBe(true);
        expect(output.proposed_prompt).toBe(current);
        expect(output.proposed_replacement_rules).toHaveLength(1);
        expect(output.warnings.some((w) => w.includes('code fence structure'))).toBe(true);
    });
    test('response fence markers are part of the prompt-shape guard contract', () => {
        const current = [
            'Response format:',
            '```json',
            ...Object.values(review_response_contract_1.AI_REVIEW_FENCES),
            '```',
            'Rules continue here.',
        ].join('\n');
        const proposed = current.replace(review_response_contract_1.AI_REVIEW_FENCES.suggestionsEnd, 'REMOVED');
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: proposed }, { currentPrompt: current });
        expect(output.promptUnchanged).toBe(true);
        expect(output.promptUnchangedReason).toBe('fence_guard');
        expect(output.proposed_prompt).toBe(current);
        expect(output.warnings.some((w) => w.includes('AI response fence markers'))).toBe(true);
    });
    test('an odd fence count that the rewrite preserves is allowed through, with a repair warning', () => {
        // Regression: the live prompt has 7 fence lines. The guard used to require an even
        // count outright, so every possible rewrite was discarded and the cycle could never
        // change the prompt (cycle 2026-07-26 burned all 3 attempts on "7 -> 7").
        const fences = ['```', 'block a', '```', '```', 'block b', '```', '```', 'block c'];
        const current = ['Rules here.', ...fences].join('\n');
        const proposed = ['Rules here, now clearer.', ...fences].join('\n');
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: proposed }, { currentPrompt: current });
        expect((0, improvement_cycle_core_1.countFencedCodeDelimiters)(current) % 2).toBe(1);
        expect(output.promptUnchanged).toBe(false);
        expect(output.proposed_prompt).toBe(proposed);
        expect(output.warnings.some((w) => w.includes('unbalanced Markdown code fence count (5)'))).toBe(true);
    });
    test('rose/rosé replacements are rejected as context-dependent in both directions', () => {
        expect((0, improvement_cycle_core_1.involvesContextDependentTerm)('rose', 'rosé')).toBe('rose');
        expect((0, improvement_cycle_core_1.involvesContextDependentTerm)('Honeyed Rosé', 'Honeyed Rose')).toBe('rose');
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'P'.repeat(600),
            proposed_replacement_rules: [
                { ...validRule, original_text: 'rose', corrected_text: 'rosé', change_type: 'diacritic' },
                { ...validRule, original_text: 'rosé', corrected_text: 'rose', change_type: 'diacritic' },
            ],
        });
        expect(output.proposed_replacement_rules).toHaveLength(0);
        expect(output.warnings.filter((w) => w.includes('context-dependent'))).toHaveLength(2);
    });
    test('an identical rewrite is recognized as unchanged and oversized rewrites warn', () => {
        const current = 'P'.repeat(1000);
        const identical = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: current }, { currentPrompt: current });
        expect(identical.promptUnchanged).toBe(true);
        const bloated = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'Q'.repeat(2000) }, { currentPrompt: current });
        expect(bloated.promptUnchanged).toBe(false);
        expect(bloated.warnings.some((w) => w.includes('review for bloat'))).toBe(true);
    });
    test('Fix 2: unresolved_still_missed is set when prompt unchanged and a still_missed correction has no covering rule or code rec', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'UNCHANGED', analysis: 'Nothing to change.' }, {
            currentPrompt: 'THE CURRENT',
            replayEvidence: [
                { correction_id: 'c1', submission_id: 's1', original_text: 'veggies', corrected_text: 'vegetables', status: 'still_missed' },
                { correction_id: 'c2', submission_id: 's1', original_text: 'x', corrected_text: 'y', status: 'now_correct' },
            ],
        });
        expect(out.promptUnchanged).toBe(true);
        expect(out.unresolved_still_missed).toBe(true);
        expect(out.warnings.some((w) => /unresolved_still_missed/.test(w))).toBe(true);
    });
    test('Fix 2: still_missed covered by a proposed rule does not set unresolved', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'UNCHANGED',
            analysis: 'Covered by rule.',
            proposed_replacement_rules: [{ original_text: 'veggies', corrected_text: 'vegetables', change_type: 'terminology', rule: 'use full', applies_to_menu_type: 'all', is_location_specific: false, location: null, other_applicable_locations: [] }],
        }, {
            currentPrompt: 'CUR',
            replayEvidence: [{ correction_id: 'c1', submission_id: 's1', original_text: 'veggies', corrected_text: 'vegetables', status: 'still_missed' }],
        });
        expect(out.unresolved_still_missed).toBeFalsy();
    });
    test('Follow-up 2: freeform (not_verifiable) + UNCHANGED does not set unresolved_still_missed', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'UNCHANGED', analysis: 'Handled the guidance in reasoning.' }, {
            currentPrompt: 'CUR',
            replayEvidence: [
                { correction_id: 'c1', submission_id: 's1', original_text: '', corrected_text: '', status: 'not_verifiable' },
            ],
        });
        expect(out.unresolved_still_missed).toBeFalsy();
    });
    test('Follow-up 2: exact still_missed without cover still sets unresolved (behavior preserved)', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'UNCHANGED', analysis: 'Did not address.' }, {
            currentPrompt: 'CUR',
            replayEvidence: [
                { correction_id: 'c1', submission_id: 's1', original_text: 'x', corrected_text: 'y', status: 'still_missed' },
            ],
        });
        expect(out.unresolved_still_missed).toBe(true);
    });
    test('still_missed remains unresolved when a changed prompt span is unrelated', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'Rule for oranges.', analysis: 'Updated an unrelated rule.' }, {
            currentPrompt: 'Rule for apples.',
            replayEvidence: [{ correction_id: 'c1', original_text: 'veggies', corrected_text: 'vegetables', status: 'still_missed' }],
        });
        expect(out.promptUnchanged).toBe(false);
        expect(out.unresolved_still_missed).toBe(true);
        expect(out.warnings.some((w) => /unresolved_still_missed: correction c1/.test(w))).toBe(true);
    });
    test('still_missed is resolved when the changed prompt span contains the correction', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'Rule: use vegetables for veggies.', analysis: 'Made the trigger and action explicit.' }, {
            currentPrompt: 'Rule: use the old wording.',
            replayEvidence: [{ correction_id: 'c1', original_text: 'veggies', corrected_text: 'vegetables', status: 'still_missed' }],
        });
        expect(out.promptUnchanged).toBe(false);
        expect(out.unresolved_still_missed).toBeFalsy();
        expect(out.warnings.some((w) => /unresolved_still_missed: correction c1/.test(w))).toBe(false);
    });
    test('still_missed remains resolved by a covering replacement rule despite an unrelated prompt change', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'Rule for oranges.',
            analysis: 'Updated an unrelated rule.',
            proposed_replacement_rules: [{
                    original_text: 'veggies',
                    corrected_text: 'vegetables',
                    change_type: 'terminology',
                    rule: 'Use the full term.',
                }],
        }, {
            currentPrompt: 'Rule for apples.',
            replayEvidence: [{ correction_id: 'c1', original_text: 'veggies', corrected_text: 'vegetables', status: 'still_missed' }],
        });
        expect(out.promptUnchanged).toBe(false);
        expect(out.unresolved_still_missed).toBeFalsy();
        expect(out.warnings.some((w) => /unresolved_still_missed: correction c1/.test(w))).toBe(false);
    });
    test('Fix 5: valid coverage_claim + still_missed + no rule/cover still sets unresolved_still_missed (replay outranks citation)', () => {
        const current = 'The prompt says use vegetables for veggies and other terms.';
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'UNCHANGED',
            analysis: 'No action required per existing guidance.',
            coverage_claims: [{ correction_id: 'c1', prompt_quote: 'use vegetables for veggies', explanation: 'mentions the term' }],
        }, {
            currentPrompt: current,
            replayEvidence: [{ correction_id: 'c1', submission_id: 's1', original_text: 'veggies', corrected_text: 'vegetables', status: 'still_missed' }],
        });
        expect(out.unresolved_still_missed).toBe(true);
        // The claim is accepted (present in output) but does not prevent the banner.
        expect(Array.isArray(out.coverage_claims) && out.coverage_claims.length).toBe(1);
        expect(out.coverage_claims[0].prompt_quote).toContain('vegetables for veggies');
    });
    test('Fix 5: fabricated coverage quote is dropped with warning and does not satisfy still_missed', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'UNCHANGED',
            analysis: 'Covered.',
            coverage_claims: [{ correction_id: 'c9', prompt_quote: 'this text is not in the prompt at all', explanation: 'nope' }],
        }, {
            currentPrompt: 'short prompt here',
            replayEvidence: [{ correction_id: 'c9', submission_id: 's9', original_text: 'foo', corrected_text: 'bar', status: 'still_missed' }],
        });
        expect(out.unresolved_still_missed).toBe(true);
        expect(out.warnings.some((w) => /cites text not present/.test(w))).toBe(true);
        expect(out.coverage_claims || []).toEqual([]);
    });
    test('B6: evidence counts on proposed rules are recomputed from sourceCorrections (never trust LLM)', () => {
        const corrections = [
            { original_text: 'veggies', corrected_text: 'vegetables', submission_id: 's1' },
            { original_text: 'veggies', corrected_text: 'vegetables', submission_id: 's1' }, // dup occ on same sub
            { original_text: 'veggies', corrected_text: 'vegetables', submission_id: 's2' },
            { original_text: 'radish', corrected_text: 'radishes', submission_id: 's3' },
        ];
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'SOME PROMPT',
            analysis: 'ok',
            proposed_replacement_rules: [
                { original_text: 'veggies', corrected_text: 'vegetables', change_type: 'terminology', rule: 'full word', applies_to_menu_type: 'all', is_location_specific: false, location: null, other_applicable_locations: [] },
                { original_text: 'radish', corrected_text: 'radishes', change_type: 'spelling', rule: 'plural', applies_to_menu_type: 'all', is_location_specific: false, location: null, other_applicable_locations: [] },
            ],
        }, { sourceCorrections: corrections });
        const r0 = out.proposed_replacement_rules[0];
        const r1 = out.proposed_replacement_rules[1];
        expect(r0.evidence_submission_count).toBe(2); // s1,s2
        expect(r0.evidence_occurrence_count).toBe(3);
        expect(r1.evidence_submission_count).toBe(1);
        expect(r1.evidence_occurrence_count).toBe(1);
    });
});
describe('improvement system prompt', () => {
    const replayEvidenceRule = 'REPLAY EVIDENCE OUTRANKS YOUR READING';
    test('uses reasoning-executor guidance for a reasoning executor', () => {
        const prompt = (0, improvement_cycle_core_1.buildImprovementSystemPrompt)({ executorModel: 'gpt-5.6-luna' });
        expect(prompt).toContain('gpt-5.6-luna');
        expect(prompt).toContain('a reasoning\nmodel');
        expect(prompt).toContain('concise and goal-oriented');
        expect(prompt).toContain('Explicit decision procedures are still REQUIRED');
        expect(prompt).toContain(replayEvidenceRule);
        expect(prompt).not.toContain('non-reasoning');
        expect(prompt).not.toContain('gpt-4o-mini');
    });
    test('uses non-reasoning-executor guidance for a non-reasoning executor', () => {
        const prompt = (0, improvement_cycle_core_1.buildImprovementSystemPrompt)({ executorModel: 'gpt-4o-mini' });
        expect(prompt).toContain('gpt-4o-mini');
        expect(prompt).toContain('smaller, non-reasoning model');
        expect(prompt).toContain('explicit decision procedures');
        expect(prompt).toContain(replayEvidenceRule);
        expect(prompt).not.toContain('a reasoning\nmodel');
    });
    test('treats missed prompt-lane corrections as evidence current guidance needs sharpening', () => {
        const prompt = (0, improvement_cycle_core_1.buildImprovementSystemPrompt)({ executorModel: 'test-model-x' });
        expect(prompt).toContain('Treat every new reviewer correction as evidence');
        // Updated language from Fix 2 (replay evidence + still_missed discipline)
        expect(prompt).toContain('still_missed');
        // B2 updated wording; replay outranks citation (case-insensitive match)
        expect(prompt.toLowerCase()).toContain('replay evidence outranks');
    });
});
describe('eval summary + status', () => {
    const report = (composite, regressed = 0) => ({
        summary: { casesEvaluated: 10, exactMatches: 2, avgComposite: composite, corrections: { f1: 0.5 } },
        baselineComparison: {
            comparedCases: 10,
            avgDelta: 0.01,
            improved: 3,
            regressed,
            same: 10 - 3 - regressed,
            regressions: regressed ? [{ case_id: 'c1', label: 'Case 1', delta: -0.02 }] : [],
        },
    });
    test('builds a compact summary and derives status (Fix 1: progression on triggers required for passed)', () => {
        const baseline = (0, improvement_cycle_core_1.summarizeEvalReport)('baseline', report(0.8), '/tmp/base/report.json');
        const candidate = (0, improvement_cycle_core_1.summarizeEvalReport)('candidate', report(0.82), '/tmp/cand/report.json');
        const baseSummary = (0, improvement_cycle_core_1.buildProposalEvalSummary)(baseline, candidate, report(0.82, 0));
        expect(baseSummary.improved).toBe(3);
        expect(baseSummary.regressed).toBe(0);
        // Without any trigger improvement, zero-regressed proposals are no_effect, not passed.
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(baseSummary)).toBe('no_effect');
        // A proposal that improves at least one trigger is 'passed' when there are no regressions.
        const withTriggerWin = { ...baseSummary, triggers_improved: 1, triggers: [{ case_id: 'p:1', submission_id: '1', baseline_composite: 0.7, candidate_composite: 0.9, delta: 0.2, status: 'improved' }] };
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(withTriggerWin)).toBe('passed');
        const regressedSummary = (0, improvement_cycle_core_1.buildProposalEvalSummary)(baseline, candidate, report(0.79, 2));
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(regressedSummary)).toBe('regressed');
        expect(regressedSummary.regressions[0].label).toBe('Case 1');
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(null)).toBe('skipped');
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)({ ...baseSummary, error: 'boom' })).toBe('failed');
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)({ ...baseSummary, candidate: null })).toBe('failed');
        // Byte-identical candidate (delta 0) with no trigger wins -> no_effect
        const identical = (0, improvement_cycle_core_1.buildProposalEvalSummary)(baseline, candidate, report(0.80, 0));
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(identical)).toBe('no_effect');
    });
});
describe('evaluateSecretExpiry', () => {
    const now = Date.parse('2026-06-15T00:00:00Z');
    test('unknown when unset or unparseable', () => {
        expect((0, improvement_cycle_core_1.evaluateSecretExpiry)('', now).status).toBe('unknown');
        expect((0, improvement_cycle_core_1.evaluateSecretExpiry)(undefined, now).status).toBe('unknown');
        expect((0, improvement_cycle_core_1.evaluateSecretExpiry)('not-a-date', now).status).toBe('unknown');
    });
    test('ok well before expiry', () => {
        const r = (0, improvement_cycle_core_1.evaluateSecretExpiry)('2026-12-01', now);
        expect(r.status).toBe('ok');
        expect(r.daysLeft).toBeGreaterThan(30);
    });
    test('warning within the threshold window', () => {
        const r = (0, improvement_cycle_core_1.evaluateSecretExpiry)('2026-07-01', now, 30);
        expect(r.status).toBe('warning');
        expect(r.daysLeft).toBe(16);
        expect(r.message).toContain('expires in 16');
    });
    test('expired after the date', () => {
        const r = (0, improvement_cycle_core_1.evaluateSecretExpiry)('2026-06-01', now);
        expect(r.status).toBe('expired');
        expect(r.daysLeft).toBeLessThan(0);
        expect(r.message).toContain('EXPIRED');
    });
    test('custom warn window', () => {
        expect((0, improvement_cycle_core_1.evaluateSecretExpiry)('2026-08-01', now, 30).status).toBe('ok');
        expect((0, improvement_cycle_core_1.evaluateSecretExpiry)('2026-08-01', now, 90).status).toBe('warning');
    });
});
describe('resolveDashboardPublicUrl', () => {
    test('prefers the explicit public URL and trims trailing slashes', () => {
        expect((0, improvement_cycle_core_1.resolveDashboardPublicUrl)({
            DASHBOARD_PUBLIC_URL: 'https://menus.example.com///',
            DASHBOARD_URL: 'https://fallback.example.com',
        })).toBe('https://menus.example.com');
    });
    test('falls back to DASHBOARD_URL before localhost', () => {
        expect((0, improvement_cycle_core_1.resolveDashboardPublicUrl)({
            DASHBOARD_URL: 'https://production.example.com/',
        })).toBe('https://production.example.com');
    });
    test('uses localhost only when no public dashboard URL is configured', () => {
        expect((0, improvement_cycle_core_1.resolveDashboardPublicUrl)({})).toBe('http://localhost:3005');
    });
});
describe('buildPendingProposalReminderEmail', () => {
    test('builds a reminder for the proposal blocking the next cycle', () => {
        const message = (0, improvement_cycle_core_1.buildPendingProposalReminderEmail)({
            proposal: {
                id: 'prop-1',
                cycle_id: '2026-06-26',
                created_at: '2026-06-26T09:16:55Z',
                correction_rule_count: 4,
                submission_count: 1,
                eval_status: 'passed',
                llm_model: 'gpt-4o-2024-08-06',
            },
            dashboardUrl: 'https://menus.example.com/',
            unconsumedCorrectionCount: 2,
        });
        expect(message.subject).toBe('Review-improvement proposal still pending (2026-06-26)');
        expect(message.html).toContain('did not generate a new proposal');
        expect(message.html).toContain('<strong>2026-06-26</strong>');
        expect(message.html).toContain('Eval: passed');
        expect(message.html).toContain('Source corrections in pending proposal: 4');
        expect(message.html).toContain('Unconsumed correction rows currently waiting: 2');
        expect(message.html).toContain('https://menus.example.com/learning/prompt-proposal');
    });
    test('escapes dynamic proposal fields before inserting them into HTML', () => {
        const message = (0, improvement_cycle_core_1.buildPendingProposalReminderEmail)({
            proposal: {
                id: '<script>alert(1)</script>',
                cycle_id: '<b>cycle</b>',
                eval_status: '<passed>',
                llm_model: '"model"',
            },
            dashboardUrl: 'https://menus.example.com/?x=<bad>',
        });
        expect(message.html).toContain('&lt;b&gt;cycle&lt;/b&gt;');
        expect(message.html).toContain('&lt;passed&gt;');
        expect(message.html).toContain('&quot;model&quot;');
        expect(message.html).not.toContain('<b>cycle</b>');
        expect(message.html).not.toContain('<passed>');
    });
});
describe('buildCodeRecommendationIssue', () => {
    test('builds a self-contained issue with checklist, manifest pointers, and label', () => {
        const issue = (0, improvement_cycle_core_1.buildCodeRecommendationIssue)({
            title: 'Add soft-boiled egg raw-marker coverage',
            description: 'Extend shouldAddRawAsterisk to treat soft-boiled eggs like poached eggs.',
            manifest_rule_ids: ['pre-ai/raw-asterisk-insertion'],
            target_file_hint: 'services/dashboard/lib/pre-ai-deterministic-rules.ts',
        }, { id: 'prop-9', cycle_id: '2026-06-12' }, 'https://menus.example.com/');
        expect(issue.title).toBe('[improvement-cycle] Add soft-boiled egg raw-marker coverage');
        expect(issue.labels).toEqual(['improvement-cycle']);
        expect(issue.body).toContain('soft-boiled eggs like poached eggs');
        expect(issue.body).toContain('`2026-06-12`');
        expect(issue.body).toContain('https://menus.example.com/learning/prompt-proposal');
        expect(issue.body).toContain('pre-ai/raw-asterisk-insertion');
        expect(issue.body).toContain('services/dashboard/lib/pre-ai-deterministic-rules.ts');
        expect(issue.body).toContain('npm run rules:manifest');
        expect(issue.body).toContain('npm run review:eval');
    });
    test('omits optional pointers when absent and truncates very long titles', () => {
        const issue = (0, improvement_cycle_core_1.buildCodeRecommendationIssue)({
            title: 'T'.repeat(300),
            description: 'Desc.',
            manifest_rule_ids: [],
            target_file_hint: null,
        }, { id: 'prop-1' }, '');
        expect(issue.title.length).toBeLessThanOrEqual(250);
        expect(issue.body).not.toContain('Likely implementation file');
        expect(issue.body).not.toContain('Related code-rules-manifest entries');
    });
});
describe('decideReplayStatus (Follow-up 2)', () => {
    const sig = (f, t) => ({ from: f, to: t, from_norm: f.toLowerCase(), to_norm: t.toLowerCase() });
    test('freeform (empty pair) is not_verifiable', () => {
        expect((0, improvement_cycle_core_1.decideReplayStatus)('', '', 'anything', [])).toBe('not_verifiable');
        expect((0, improvement_cycle_core_1.decideReplayStatus)(null, null, 'x', [])).toBe('not_verifiable');
    });
    test('no replay output -> replay_unavailable even with text pair', () => {
        expect((0, improvement_cycle_core_1.decideReplayStatus)('a', 'b', '', [sig('a', 'b')])).toBe('replay_unavailable');
    });
    test('hit in signals -> now_correct', () => {
        expect((0, improvement_cycle_core_1.decideReplayStatus)('veggies', 'vegetables', 'menu with vegetables', [sig('veggies', 'vegetables')])).toBe('now_correct');
    });
    test('miss but replay ran -> still_missed', () => {
        expect((0, improvement_cycle_core_1.decideReplayStatus)('a', 'b', 'menu with a', [sig('x', 'y')])).toBe('still_missed');
    });
});
describe('classifyTriggerFromComparisonEntry (Follow-up 1)', () => {
    test('uses freshDelta when present for confirmation', () => {
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)({ delta: 0.03, freshDelta: 0.001 })).toBe('unchanged');
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)({ delta: 0.03, freshDelta: 0.04 })).toBe('improved');
    });
    test('falls back to delta', () => {
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)({ delta: 0.03 })).toBe('improved');
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)({ delta: -0.03 })).toBe('regressed');
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)({ delta: 0.01 })).toBe('unchanged');
    });
    test('null/empty -> unchanged', () => {
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)(null)).toBe('unchanged');
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)(undefined)).toBe('unchanged');
    });
    test('B0: prefers confirmed_delta over freshDelta/raw for trigger classification', () => {
        // raw +3pp but confirmed ~0 => unchanged (drift)
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)({ delta: 0.03, freshDelta: 0.001, confirmed_delta: 0.001 })).toBe('unchanged');
        // confirmed positive wins
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)({ delta: 0.01, confirmed_delta: 0.03 })).toBe('improved');
        // old report fallback still works
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)({ delta: 0.03, freshDelta: 0.04 })).toBe('improved');
    });
    test('B0: synthetic baselineComparison fixture with raw/confirmed disagreement', () => {
        // Simulate the shape produced by review-eval.js after B0
        const syntheticBaselineComparison = {
            comparedCases: 2,
            noiseEpsilon: 0.02,
            avgDelta: 0.005,
            improved: 1,
            same: 1,
            regressed: 0,
            regressions: [],
            improvements: [
                { case_id: 'p:1', delta: 0.03, confirmed_delta: 0.025, outcome: 'improved' },
                { case_id: 'p:2', delta: 0.01, confirmed_delta: null, outcome: 'improved' }, // no confirmation pass
            ],
        };
        // Cycle code path: prefer confirmed_delta when present
        const e1 = syntheticBaselineComparison.improvements[0];
        const e2 = syntheticBaselineComparison.improvements[1];
        expect(e1.confirmed_delta).toBe(0.025);
        expect(e2.confirmed_delta).toBeNull();
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)(e1, 0.02)).toBe('improved');
        expect((0, improvement_cycle_core_1.classifyTriggerFromComparisonEntry)(e2, 0.02)).toBe('unchanged'); // within epsilon after confirmed null -> use raw
    });
});
describe('buildCorrectionExcerptWindows + locate (Fix 6 / B3)', () => {
    test('locate finds case-insensitive and diacritic tolerant sites', () => {
        const text = 'Grilled Salmon with radishes, fennel and veggies on the side.';
        expect((0, improvement_cycle_core_1.locateCorrectionSite)(text, 'VEGGIES')).not.toBeNull();
        expect((0, improvement_cycle_core_1.locateCorrectionSite)(text, 'radish')).not.toBeNull(); // substring
        const accented = 'Espadin mezcal and creme anglaise finish.';
        expect((0, improvement_cycle_core_1.locateCorrectionSite)(accented, 'espadín')).not.toBeNull();
        expect((0, improvement_cycle_core_1.locateCorrectionSite)(accented, 'crème anglaise')).not.toBeNull();
    });
    test('builds ±300 line-bounded windows and includes correction site deep in text', () => {
        const ai = 'Intro line.\n' + 'x'.repeat(800) + '\nPoblano tartare with veggies and radishes.\n' + 'y'.repeat(800) + '\nEnd.';
        const fin = 'Intro line.\n' + 'x'.repeat(800) + '\nPoblano tartar with vegetables and radish.\n' + 'y'.repeat(800) + '\nEnd.';
        const corrs = [
            { id: 'c10', original_text: 'veggies', corrected_text: 'vegetables' },
            { id: 'c11', original_text: 'Poblano tartare', corrected_text: 'Poblano tartar' },
        ];
        const res = (0, improvement_cycle_core_1.buildCorrectionExcerptWindows)(ai, fin, corrs, { perSubBudgetChars: 8000 });
        const joined = (res.windows.map((w) => w.ai_window + ' ' + w.final_window).join(' ')).toLowerCase();
        expect(joined).toContain('vegetables');
        expect(joined).toContain('tartar');
        // head slices are still produced for orientation
        expect(res.head_ai.length).toBeGreaterThan(0);
    });
    test('dedupes overlapping and respects per-sub budget', () => {
        const ai = 'A '.repeat(1000) + 'target word here ' + 'B '.repeat(1000);
        const fin = 'A '.repeat(1000) + 'TARGET WORD HERE ' + 'B '.repeat(1000);
        const corrs = [
            { id: 'c1', original_text: 'target word', corrected_text: 'TARGET WORD' },
            { id: 'c2', original_text: 'target word', corrected_text: 'TARGET WORD' }, // duplicate site
        ];
        const res = (0, improvement_cycle_core_1.buildCorrectionExcerptWindows)(ai, fin, corrs, { perSubBudgetChars: 200 });
        // budget small -> at most one window kept
        expect(res.windows.length).toBeLessThanOrEqual(1);
    });
});
describe('cycle script replay execution path (Follow-up 0 regression guard)', () => {
    test('executing the improvement cycle (dry-run) reaches replay assembly without TDZ/scope error', () => {
        const { spawnSync } = require('child_process');
        const path = require('path');
        const script = path.resolve(__dirname, '../../../scripts/improvement-cycle.js');
        // Provide just enough env to pass the initial getSupabase guard; the replay block will
        // still run (and hit the outer catch or log evidence). A TDZ would surface as a specific
        // ReferenceError instead of the graceful skip.
        const res = spawnSync(process.execPath, [script, '--dry-run'], {
            encoding: 'utf8',
            env: {
                ...process.env,
                SUPABASE_URL: 'https://dummy.supabase.co',
                SUPABASE_SERVICE_KEY: 'dummy',
                OPENAI_API_KEY: 'sk-dummy-for-test',
            },
            timeout: 15000,
        });
        const out = (res.stdout || '') + (res.stderr || '');
        // If TDZ or bad reference in the replay block, this string appears (or uncaught ReferenceError).
        // A test failure here catches re-introduction of the Follow-up 0 scope bug.
        expect(out).not.toMatch(/before initialization|Cannot access .*submissionIds/i);
        // The path containing the replay block was reached if we see cycle startup text or a graceful
        // replay outcome (success log or the caught skip). With dummy env some early exits are expected.
        const reached = /Improvement Cycle|Gate:|replay (evidence|skipped)|dry-run/i.test(out) || res.status !== 0;
        expect(reached).toBe(true);
    });
});
describe('mapProposedRuleToCorrectionRulePayload', () => {
    test('maps a global rule with accepted status and system source', () => {
        const payload = (0, improvement_cycle_core_1.mapProposedRuleToCorrectionRulePayload)({
            original_text: 'veggies',
            corrected_text: 'vegetables',
            change_type: 'spelling',
            rule: 'Use the full word.',
            applies_to_menu_type: 'all',
            is_location_specific: false,
            location: null,
            other_applicable_locations: [],
        }, 'abc-123', 2, 'Derian');
        expect(payload).toMatchObject({
            submission_id: 'proposal-abc-123',
            correction_id: 'proposal-abc-123-rule-2',
            original_text: 'veggies',
            corrected_text: 'vegetables',
            change_type: 'spelling',
            status: 'accepted',
            source: 'system',
            location: null,
            restaurant_name: 'All RSH restaurants',
            reviewer_name: 'Derian',
        });
        // Born consumed (by proposal id when no cycle given) so it does not
        // re-enter the gate as a new correction next cycle.
        expect(payload.prompt_cycle_id).toBe('proposal-abc-123');
    });
    test('marks the rule consumed by the proposal cycle when provided', () => {
        const payload = (0, improvement_cycle_core_1.mapProposedRuleToCorrectionRulePayload)({
            original_text: 'a', corrected_text: 'b', change_type: 'spelling', rule: 'why',
            applies_to_menu_type: 'all', is_location_specific: false, location: null, other_applicable_locations: [],
        }, 'p1', 0, null, { cycleId: '2026-06-13', consumedAt: '2026-06-13T12:00:00Z' });
        expect(payload.prompt_cycle_id).toBe('2026-06-13');
        expect(payload.consumed_at).toBe('2026-06-13T12:00:00Z');
    });
    test('keeps location fields for location-specific rules', () => {
        const payload = (0, improvement_cycle_core_1.mapProposedRuleToCorrectionRulePayload)({
            original_text: 'a',
            corrected_text: 'b',
            change_type: 'terminology',
            rule: 'why',
            applies_to_menu_type: 'food',
            is_location_specific: true,
            location: 'Zengo - Doha',
            other_applicable_locations: ['Toro - Dubai'],
        }, 'p1', 0, null);
        expect(payload.location).toBe('Zengo - Doha');
        expect(payload.other_applicable_locations).toEqual(['Toro - Dubai']);
        expect(payload.restaurant_name).toBe('Zengo - Doha');
    });
});
describe('supersededProposalReviewBlock (409 guard)', () => {
    test('returns null for pending/approved proposals', () => {
        expect((0, improvement_cycle_core_1.supersededProposalReviewBlock)({ status: 'pending' })).toBeNull();
        expect((0, improvement_cycle_core_1.supersededProposalReviewBlock)({ status: 'approved' })).toBeNull();
    });
    test('returns 409 payload with superseding cycle pointer', () => {
        const block = (0, improvement_cycle_core_1.supersededProposalReviewBlock)({ status: 'superseded', superseded_by_cycle_id: '2026-07-02' });
        expect(block?.error).toContain('superseded');
        expect(block?.error).toContain('2026-07-02');
        expect(block?.superseded_by_cycle_id).toBe('2026-07-02');
    });
});
describe('buildImprovementLlmPayload (F0 extraction)', () => {
    test('o-series / reasoning model: uses max_completion_tokens, no max_tokens, no temperature', () => {
        const p = (0, improvement_cycle_core_1.buildImprovementLlmPayload)('o3', 'sys', 'user', { IMPROVE_MAX_COMPLETION_TOKENS: '28000' });
        expect(p.model).toBe('o3');
        expect(p.max_completion_tokens).toBe(28000);
        expect(p).not.toHaveProperty('max_tokens');
        expect(p).not.toHaveProperty('temperature');
        expect(p.response_format).toEqual({ type: 'json_object' });
    });
    test('non-reasoning model: uses max_tokens + temperature, no max_completion_tokens', () => {
        const p = (0, improvement_cycle_core_1.buildImprovementLlmPayload)('gpt-4o', 'sys', 'user');
        expect(p.max_tokens).toBe(16000);
        expect(p.temperature).toBe(0.2);
        expect(p).not.toHaveProperty('max_completion_tokens');
    });
    test('falls back to 32000 for reasoning when env unset', () => {
        const p = (0, improvement_cycle_core_1.buildImprovementLlmPayload)('o4-mini', 's', 'u');
        expect(p.max_completion_tokens).toBe(32000);
    });
    test('gpt-5 family routes down the reasoning path (no temperature — gpt-5 rejects it)', () => {
        for (const model of ['gpt-5', 'gpt-5.1', 'gpt-5-mini', 'gpt-5.4-pro-2026-03-05']) {
            const p = (0, improvement_cycle_core_1.buildImprovementLlmPayload)(model, 's', 'u');
            expect(p).not.toHaveProperty('temperature');
            expect(p).not.toHaveProperty('max_tokens');
            expect(p.max_completion_tokens).toBe(32000);
        }
    });
});
describe('buildReplayRequestBody (Phase 0)', () => {
    const args = { model: 'model', temperature: 0, seed: 42, prompt: 'system', text: 'menu' };
    test('omits temperature but keeps seed for reasoning models', () => {
        const body = (0, improvement_cycle_core_1.buildReplayRequestBody)({ ...args, model: 'gpt-5.1' });
        expect(body).not.toHaveProperty('temperature');
        expect(body).toMatchObject({ model: 'gpt-5.1', seed: 42 });
    });
    test('includes temperature and seed for non-reasoning models', () => {
        const body = (0, improvement_cycle_core_1.buildReplayRequestBody)({ ...args, model: 'gpt-4o-mini' });
        expect(body).toMatchObject({ model: 'gpt-4o-mini', temperature: 0, seed: 42 });
    });
});
describe('resolveEvalBaselineModel (Phase 2)', () => {
    test('defaults to the candidate model for backward-compatible confirmation', () => {
        expect((0, improvement_cycle_core_1.resolveEvalBaselineModel)('candidate-model')).toBe('candidate-model');
        expect((0, improvement_cycle_core_1.resolveEvalBaselineModel)('candidate-model', '  ')).toBe('candidate-model');
    });
    test('uses the explicit incumbent model when provided', () => {
        expect((0, improvement_cycle_core_1.resolveEvalBaselineModel)('candidate-model', 'incumbent-model')).toBe('incumbent-model');
    });
});
describe('isReasoningModel', () => {
    test('matches o-series and gpt-5 family', () => {
        for (const m of ['o1', 'o3', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5.1', 'gpt-5-mini', 'GPT-5.2']) {
            expect((0, improvement_cycle_core_1.isReasoningModel)(m)).toBe(true);
        }
    });
    test('does not match gpt-4o family or empty', () => {
        for (const m of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4-turbo', '', undefined]) {
            expect((0, improvement_cycle_core_1.isReasoningModel)(m)).toBe(false);
        }
    });
});
describe('isRequestTooLarge429 (fail-fast guard)', () => {
    test('matches the request-too-large TPM body', () => {
        const body = '{"error":{"message":"Request too large for o3 in organization org-x on tokens per min (TPM): Limit 30000, Requested 31299","type":"tokens","code":"rate_limit_exceeded"}}';
        expect((0, improvement_cycle_core_1.isRequestTooLarge429)(body)).toBe(true);
    });
    test('does not match a normal transient 429 or empty body', () => {
        expect((0, improvement_cycle_core_1.isRequestTooLarge429)('{"error":{"message":"Rate limit reached for o3: try again in 12s","type":"requests"}}')).toBe(false);
        expect((0, improvement_cycle_core_1.isRequestTooLarge429)('')).toBe(false);
    });
});
describe('consolidation mode (F1 / Fix 8)', () => {
    test('builds an executor-aware consolidation prompt', () => {
        const prompt = (0, improvement_cycle_core_1.buildConsolidationSystemPrompt)({ executorModel: 'test-model-x' });
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(200);
        expect(prompt).toContain('consolidate');
        expect(prompt).toContain('test-model-x');
        expect(prompt).toContain('non-reasoning');
        expect(prompt).toContain('still_missed');
        expect(prompt).toContain('decision procedure');
        expect(prompt).not.toContain('gpt-4o-mini');
        expect(prompt).not.toBe((0, improvement_cycle_core_1.buildImprovementSystemPrompt)({ executorModel: 'test-model-x' }));
    });
    test('uses reasoning-executor guidance in the consolidation prompt', () => {
        const prompt = (0, improvement_cycle_core_1.buildConsolidationSystemPrompt)({ executorModel: 'gpt-5.6-luna' });
        expect(prompt).toContain('gpt-5.6-luna');
        expect(prompt).toContain('a reasoning\nmodel');
        expect(prompt).toContain('REPLAY EVIDENCE OUTRANKS YOUR READING');
        expect(prompt).not.toContain('non-reasoning');
    });
    test('validator in consolidation mode: drops rules/recs, warns on <5% or >50% reduction, does not fire short/growth', () => {
        const current = 'x'.repeat(10000);
        const tooLittle = current; // 0% reduction (promptUnchanged will be detected but we force proposed different length)
        const outLittle = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: current.slice(0, 9800), analysis: 'tiny change' }, { currentPrompt: current, consolidation: true });
        expect(outLittle.proposed_replacement_rules.length).toBe(0);
        expect(outLittle.code_recommendations.length).toBe(0);
        expect(outLittle.warnings.some((w) => /<5% reduction/.test(w))).toBe(true);
        const hugeCut = 'y'.repeat(1000);
        const outHuge = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: hugeCut, analysis: 'big cut' }, { currentPrompt: current, consolidation: true });
        expect(outHuge.warnings.some((w) => />50% reduction/.test(w))).toBe(true);
        // normal short warning should be suppressed
        const outShort = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'abc', analysis: 'short but consolidation' }, { currentPrompt: current, consolidation: true });
        expect(outShort.warnings.some((w) => /suspiciously short/.test(w))).toBe(false);
    });
    test('evalStatusFromSummary for consolidation: passed iff zero confirmed regressed (ignores triggers)', () => {
        const base = { regressed: 0, candidate: { avgComposite: 0.9 }, triggers_improved: 0 };
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(base, { consolidation: true })).toBe('passed');
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)({ ...base, regressed: 1 }, { consolidation: true })).toBe('regressed');
        // normal (non-consol) still requires a trigger win for passed
        expect((0, improvement_cycle_core_1.evalStatusFromSummary)(base)).toBe('no_effect');
    });
});
// ── C1: retry-with-feedback when a prompt-shape guard discards the rewrite ──────────────
describe('C1 guard-retry controller', () => {
    const filler = 'Review each dish name for spelling, spacing, punctuation, and accent accuracy, and keep the section order intact. ';
    const current = [
        'You are a menu reviewer.',
        filler.repeat(6),
        '```json',
        '{"format": "menu"}',
        '```',
        'End of prompt.',
    ].join('\n');
    // A >500-char rewrite that breaks fence structure (one lone ``` line).
    const badRewrite = 'You are a menu reviewer. ' + filler.repeat(6) + '\n```json\nbroken';
    // A valid rewrite that preserves both fences and differs from current.
    const goodRewrite = current + '\nAlways verify diacritics on Spanish terms.';
    function seqCaller(...contents) {
        const state = { n: 0 };
        const fn = async () => { const c = contents[state.n]; state.n++; return { content: c, model: 'test-model' }; };
        return Object.assign(fn, { state });
    }
    test('countFencedCodeDelimiters + preservation note/message carry the count', () => {
        expect((0, improvement_cycle_core_1.countFencedCodeDelimiters)(current)).toBe(2);
        expect((0, improvement_cycle_core_1.buildFencePreservationNote)(2)).toMatch(/exactly 2 fenced/);
        expect((0, improvement_cycle_core_1.buildGuardRetryMessage)({ warning: 'x', fenceCount: 2 })).toMatch(/exactly 2 fenced/);
        expect((0, improvement_cycle_core_1.isGuardDiscardReason)('fence_guard')).toBe(true);
        expect((0, improvement_cycle_core_1.isGuardDiscardReason)('context_leak')).toBe(true);
        expect((0, improvement_cycle_core_1.isGuardDiscardReason)('sentinel')).toBe(false);
        expect((0, improvement_cycle_core_1.isGuardDiscardReason)('identical')).toBe(false);
        expect((0, improvement_cycle_core_1.isGuardDiscardReason)(undefined)).toBe(false);
    });
    test('broken fences then corrected rewrite -> prompt_change with attempt-1 warnings preserved', async () => {
        const caller = seqCaller(JSON.stringify({ proposed_prompt: badRewrite, analysis: 'first' }), JSON.stringify({ proposed_prompt: goodRewrite, analysis: 'second' }));
        const result = await (0, improvement_cycle_core_1.runImprovementProposalWithRetry)({
            systemPrompt: 'sys', userPrompt: 'usr', currentPromptFenceCount: 2, maxRetries: 2,
            validateOpts: { currentPrompt: current }, callLlm: caller,
        });
        expect(result.attempts.length).toBe(2);
        expect(result.validated.promptUnchanged).toBe(false); // corrected rewrite accepted
        expect(result.guardRetriesExhausted).toBe(false);
        expect(result.discardedPrompts).toEqual([badRewrite]);
        expect(result.validated.warnings.some((w) => /attempt 1\/3/.test(w) && /fence/.test(w))).toBe(true);
    });
    test('UNCHANGED sentinel -> no retry (deliberate no-change)', async () => {
        const caller = seqCaller(JSON.stringify({ proposed_prompt: 'UNCHANGED', analysis: 'nothing' }));
        const result = await (0, improvement_cycle_core_1.runImprovementProposalWithRetry)({
            systemPrompt: 'sys', userPrompt: 'usr', currentPromptFenceCount: 2, maxRetries: 2,
            validateOpts: { currentPrompt: current }, callLlm: caller,
        });
        expect(result.attempts.length).toBe(1);
        expect(caller.state.n).toBe(1);
        expect(result.validated.promptUnchanged).toBe(true);
        expect(result.validated.promptUnchangedReason).toBe('sentinel');
        expect(result.guardRetriesExhausted).toBe(false);
    });
    test('all attempts break fences -> retries exhausted, discarded prompts collected', async () => {
        const caller = seqCaller(JSON.stringify({ proposed_prompt: badRewrite, analysis: '1' }), JSON.stringify({ proposed_prompt: badRewrite, analysis: '2' }), JSON.stringify({ proposed_prompt: badRewrite, analysis: '3' }));
        const result = await (0, improvement_cycle_core_1.runImprovementProposalWithRetry)({
            systemPrompt: 'sys', userPrompt: 'usr', currentPromptFenceCount: 2, maxRetries: 2,
            validateOpts: { currentPrompt: current }, callLlm: caller,
        });
        expect(result.attempts.length).toBe(3);
        expect(result.guardRetriesExhausted).toBe(true);
        expect(result.discardedPrompts.length).toBe(3);
        expect(result.validated.promptUnchanged).toBe(true);
        expect(result.validated.promptUnchangedReason).toBe('fence_guard');
        expect(result.validated.warnings.some((w) => /attempt 3\/3/.test(w))).toBe(true);
    });
    test('validator sets promptUnchangedReason for each unchanged path', () => {
        expect((0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'UNCHANGED' }, { currentPrompt: current }).promptUnchangedReason).toBe('sentinel');
        expect((0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: current.trim() }, { currentPrompt: current }).promptUnchangedReason).toBe('identical');
        expect((0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: badRewrite }, { currentPrompt: current }).promptUnchangedReason).toBe('fence_guard');
        const leak = `=== BEGIN CURRENT PROMPT ===\n${current}`;
        expect((0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: leak }, { currentPrompt: current }).promptUnchangedReason).toBe('context_leak');
    });
});
// ── C2: honest, structured disposition ─────────────────────────────────────────────────
describe('C2 disposition + eval-skip', () => {
    test('computeDisposition matrix', () => {
        expect((0, improvement_cycle_core_1.computeDisposition)({ promptUnchanged: false, proposedRuleCount: 0, codeRecommendationCount: 0 })).toBe('prompt_change');
        expect((0, improvement_cycle_core_1.computeDisposition)({ promptUnchanged: false, proposedRuleCount: 2, codeRecommendationCount: 0 })).toBe('rules_and_prompt');
        expect((0, improvement_cycle_core_1.computeDisposition)({ promptUnchanged: true, promptUnchangedReason: 'sentinel', proposedRuleCount: 2, codeRecommendationCount: 0 })).toBe('rules_only');
        expect((0, improvement_cycle_core_1.computeDisposition)({ promptUnchanged: true, promptUnchangedReason: 'sentinel', proposedRuleCount: 0, codeRecommendationCount: 1 })).toBe('code_recs_only');
        expect((0, improvement_cycle_core_1.computeDisposition)({ promptUnchanged: true, promptUnchangedReason: 'sentinel', proposedRuleCount: 0, codeRecommendationCount: 0 })).toBe('no_change_model_declined');
        // guard discard is the honest headline even when rules also survived
        expect((0, improvement_cycle_core_1.computeDisposition)({ promptUnchanged: true, promptUnchangedReason: 'fence_guard', guardRetriesExhausted: true, proposedRuleCount: 2, codeRecommendationCount: 0 })).toBe('no_change_guard_discarded');
        // a guard reason that was NOT exhausted is not a guard discard
        expect((0, improvement_cycle_core_1.computeDisposition)({ promptUnchanged: true, promptUnchangedReason: 'fence_guard', guardRetriesExhausted: false, proposedRuleCount: 0, codeRecommendationCount: 0 })).toBe('no_change_model_declined');
    });
    test('describeDisposition guard headline mentions attempts', () => {
        expect((0, improvement_cycle_core_1.describeDisposition)('no_change_guard_discarded', { guardAttempts: 3 })).toMatch(/discarded by a formatting guard after 3 attempts/);
        expect((0, improvement_cycle_core_1.describeDisposition)('rules_and_prompt', { ruleCount: 2 })).toMatch(/2 replacement rules \+ a prompt change/);
    });
    test('shouldSkipCandidateEval only when unchanged AND no rules', () => {
        expect((0, improvement_cycle_core_1.shouldSkipCandidateEval)({ promptUnchanged: true, proposedRuleCount: 0 })).toBe(true);
        expect((0, improvement_cycle_core_1.shouldSkipCandidateEval)({ promptUnchanged: true, proposedRuleCount: 1 })).toBe(false);
        expect((0, improvement_cycle_core_1.shouldSkipCandidateEval)({ promptUnchanged: false, proposedRuleCount: 0 })).toBe(false);
    });
});
// ── C3: per-correction routing table ───────────────────────────────────────────────────
describe('C3 validateCorrectionRouting', () => {
    const sources = [
        { id: 'a', original_text: 'X', corrected_text: 'Y' },
        { id: 'b', original_text: null, corrected_text: null },
    ];
    test('completeness: a missing source correction becomes a synthesized unrouted entry', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'prompt', target: 's1', note: 'ok' }], { sourceCorrections: sources });
        expect(out.routing.map((r) => r.correction_id).sort()).toEqual(['a', 'b']);
        const b = out.routing.find((r) => r.correction_id === 'b');
        expect(b.lane).toBe('unrouted');
        expect(out.warnings.some((w) => /correction b was not routed/.test(w))).toBe(true);
    });
    test('still_missed cannot be dismissed/already_correct (trips unresolvedFromRouting)', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'dismissed', target: '', note: 'nah' }, { correction_id: 'b', lane: 'prompt', target: 's', note: '' }], { sourceCorrections: sources, replayEvidence: [{ correction_id: 'a', status: 'still_missed' }] });
        expect(out.unresolvedFromRouting).toBe(true);
        expect(out.warnings.some((w) => /still_missed by replay but routed "dismissed"/.test(w))).toBe(true);
    });
    test('already_correct illegal unless replay is now_correct', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'already_correct', target: '', note: '' }, { correction_id: 'b', lane: 'prompt', target: 's', note: '' }], { sourceCorrections: sources, replayEvidence: [{ correction_id: 'a', status: 'replay_unavailable' }] });
        expect(out.warnings.some((w) => /routed "already_correct" but replay status is "replay_unavailable"/.test(w))).toBe(true);
    });
    test('replacement_rule pointing at a dropped rule downgrades to unrouted', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'replacement_rule', target: 'X->Y', note: '' }, { correction_id: 'b', lane: 'prompt', target: 's', note: '' }], { sourceCorrections: sources, survivingRules: [] });
        const a = out.routing.find((r) => r.correction_id === 'a');
        expect(a.lane).toBe('unrouted');
        expect(out.warnings.some((w) => /did not survive validation/.test(w))).toBe(true);
    });
    test('replacement_rule that matches a surviving rule is kept', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'replacement_rule', target: 'X->Y', note: '' }, { correction_id: 'b', lane: 'prompt', target: 's', note: '' }], { sourceCorrections: sources, survivingRules: [{ original_text: 'X', corrected_text: 'Y' }] });
        expect(out.routing.find((r) => r.correction_id === 'a').lane).toBe('replacement_rule');
    });
    test('existing_rule cleanly routes a manually seeded accepted rule when replay is unavailable', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'existing_rule', target: 'gruyere -> gruyère', note: 'already seeded' }], {
            sourceCorrections: [{ id: 'a', original_text: 'gruyere', corrected_text: 'gruyère' }],
            replayEvidence: [{ correction_id: 'a', status: 'replay_unavailable' }],
            acceptedRules: [{ original_text: 'gruyere', corrected_text: 'gruyère' }],
        });
        expect(out.routing[0].lane).toBe('existing_rule');
        expect(out.warnings).toEqual([]);
        expect(out.unresolvedFromRouting).toBe(false);
    });
    test('existing_rule without a matching accepted rule downgrades to unrouted', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'existing_rule', target: 'gruyere -> gruyère', note: '' }], {
            sourceCorrections: [{ id: 'a', original_text: 'gruyere', corrected_text: 'gruyère' }],
            acceptedRules: [{ original_text: 'maldon', corrected_text: 'Maldon' }],
        });
        expect(out.routing[0].lane).toBe('unrouted');
        expect(out.warnings.some((w) => /existing_rule.*no accepted deterministic rule/.test(w))).toBe(true);
    });
    test('still_missed replay evidence outranks an existing_rule claim', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'existing_rule', target: 'gruyere -> gruyère', note: '' }], {
            sourceCorrections: [{ id: 'a', original_text: 'gruyere', corrected_text: 'gruyère' }],
            replayEvidence: [{ correction_id: 'a', status: 'still_missed' }],
            acceptedRules: [{ original_text: 'gruyere', corrected_text: 'gruyère' }],
        });
        expect(out.routing[0].lane).toBe('existing_rule');
        expect(out.unresolvedFromRouting).toBe(true);
        expect(out.warnings.some((w) => /still_missed by replay but routed "existing_rule"; replay evidence outranks this/.test(w))).toBe(true);
    });
    test('existing_rule fails closed when the accepted-rule set is absent', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'existing_rule', target: 'gruyere -> gruyère', note: '' }], { sourceCorrections: [{ id: 'a', original_text: 'gruyere', corrected_text: 'gruyère' }] });
        expect(out.routing[0].lane).toBe('unrouted');
        expect(out.warnings.some((w) => /accepted-rule set was not supplied/.test(w))).toBe(true);
    });
    test('a rule NARROWER than the correction line is not falsely flagged as dropped', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'replacement_rule', target: 'CAST IRON CHICKEN -> CAST-IRON CHICKEN', note: '' }], {
            sourceCorrections: [{ id: 'a', original_text: 'CAST IRON CHICKEN D,G', corrected_text: 'CAST-IRON CHICKEN D,G' }],
            // the model synthesized a narrower rule than the full correction line
            survivingRules: [{ original_text: 'CAST IRON CHICKEN', corrected_text: 'CAST-IRON CHICKEN' }],
        });
        expect(out.routing.find((r) => r.correction_id === 'a').lane).toBe('replacement_rule');
        expect(out.warnings.some((w) => /did not survive validation/.test(w))).toBe(false);
    });
    test('routing carries the human guidance text for freeform corrections', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'g', lane: 'prompt', target: 'sec', note: 'ok' }], { sourceCorrections: [{ id: 'g', original_text: null, corrected_text: null, rule: 'LAURENT-PERRIER is a proper noun and must be hyphenated.' }] });
        expect(out.routing[0].guidance).toMatch(/LAURENT-PERRIER is a proper noun/);
    });
    test('a still_missed correction covered by a narrower synthesized rule does NOT trip unresolved', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'UNCHANGED',
            proposed_replacement_rules: [
                { original_text: 'sweetyellow', corrected_text: 'sweet yellow', change_type: 'spelling', rule: 'typo' },
            ],
            correction_routing: [{ correction_id: 's1', lane: 'replacement_rule', target: 'sweetyellow -> sweet yellow', note: '' }],
        }, {
            currentPrompt: 'cur',
            replayEvidence: [{ correction_id: 's1', original_text: 'Esquites sweetyellow corn', corrected_text: 'Esquites sweet yellow corn', status: 'still_missed' }],
            sourceCorrections: [{ id: 's1', original_text: 'Esquites sweetyellow corn', corrected_text: 'Esquites sweet yellow corn' }],
        });
        expect(out.unresolved_still_missed).toBeFalsy();
        expect(out.correction_routing?.find((r) => r.correction_id === 's1').lane).toBe('replacement_rule');
    });
    test('unknown lane normalizes to unrouted with a warning', () => {
        const out = (0, improvement_cycle_core_1.validateCorrectionRouting)([{ correction_id: 'a', lane: 'banish', target: '', note: '' }, { correction_id: 'b', lane: 'prompt', target: '', note: '' }], { sourceCorrections: sources });
        expect(out.routing.find((r) => r.correction_id === 'a').lane).toBe('unrouted');
        expect(out.warnings.some((w) => /unknown lane "banish"/.test(w))).toBe(true);
    });
    test('validateImprovementLlmOutput surfaces correction_routing when source ids are present', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({ proposed_prompt: 'UNCHANGED', analysis: 'x', correction_routing: [{ correction_id: 'a', lane: 'prompt', target: 's', note: '' }] }, { currentPrompt: 'cur', sourceCorrections: [{ id: 'a', original_text: 'X', corrected_text: 'Y' }] });
        expect(out.correction_routing?.length).toBe(1);
        expect(out.correction_routing?.[0].correction_id).toBe('a');
    });
});
// ── C4a: freeform-guidance synthesis ───────────────────────────────────────────────────
describe('C4a inferred_from_guidance', () => {
    test('synthesized rule passes through with flag + verify warning', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'UNCHANGED',
            proposed_replacement_rules: [
                { original_text: 'jalapeno', corrected_text: 'jalapeño', change_type: 'diacritic', rule: 'always accent', inferred_from_guidance: true },
            ],
        }, { currentPrompt: 'cur' });
        expect(out.proposed_replacement_rules).toHaveLength(1);
        expect(out.proposed_replacement_rules[0].inferred_from_guidance).toBe(true);
        expect(out.warnings.some((w) => /synthesized from freeform guidance/.test(w))).toBe(true);
    });
    test('synthesized rule still fails the same safety checks (context-dependent term dropped)', () => {
        const out = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'UNCHANGED',
            proposed_replacement_rules: [
                { original_text: 'poblano tartare', corrected_text: 'poblano tartar', change_type: 'terminology', rule: 'sauce', inferred_from_guidance: true },
            ],
        }, { currentPrompt: 'cur' });
        expect(out.proposed_replacement_rules).toHaveLength(0);
        expect(out.warnings.some((w) => /context-dependent/.test(w))).toBe(true);
    });
});
describe('findRuleConflicts', () => {
    const proposed = (original, corrected, menuType = 'all') => ({
        original_text: original,
        corrected_text: corrected,
        applies_to_menu_type: menuType,
    });
    test('flags a variant spelling of a brand that an accepted rule already canonicalizes', () => {
        // Cycle 2026-07-26 proposed this while an accepted rule already normalized the brand.
        const conflicts = (0, improvement_cycle_core_1.findRuleConflicts)([proposed('ste. germaine', 'st-germaine', 'beverage')], [{ id: 'r1', original_text: 'st. germain', corrected_text: 'St-Germain', applies_to_menu_type: 'beverage' }]);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].kind).toBe('variant');
        expect(conflicts[0].drop).toBe(false);
        expect(conflicts[0].existingRuleId).toBe('r1');
        expect(conflicts[0].message).toContain('St-Germain');
    });
    test('drops a rule that is the exact inverse of an accepted rule', () => {
        const conflicts = (0, improvement_cycle_core_1.findRuleConflicts)([proposed('rosé', 'rose')], [{ id: 'r2', original_text: 'rose', corrected_text: 'rosé', applies_to_menu_type: 'all' }]);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].kind).toBe('inverse');
        expect(conflicts[0].drop).toBe(true);
    });
    test('flags two rules that disagree on the output for the same input', () => {
        const conflicts = (0, improvement_cycle_core_1.findRuleConflicts)([proposed('aji', 'ajÍ')], [{ id: 'r3', original_text: 'aji', corrected_text: 'ají amarillo', applies_to_menu_type: 'all' }]);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].kind).toBe('contradiction');
    });
    test('flags a rule whose output another accepted rule immediately rewrites', () => {
        const conflicts = (0, improvement_cycle_core_1.findRuleConflicts)([proposed('mayonaise', 'mayonnaise')], [{ id: 'r4', original_text: 'mayonnaise', corrected_text: 'aioli', applies_to_menu_type: 'all' }]);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].kind).toBe('chain');
    });
    test('ignores unrelated rules and non-overlapping menu scopes', () => {
        expect((0, improvement_cycle_core_1.findRuleConflicts)([proposed('del maguay', 'del maguey', 'beverage')], [{ id: 'r5', original_text: 'veggies', corrected_text: 'vegetables', applies_to_menu_type: 'food' }])).toHaveLength(0);
        // Same brand variant, but food-only vs beverage-only: no overlap, no conflict.
        expect((0, improvement_cycle_core_1.findRuleConflicts)([proposed('ste. germaine', 'st-germaine', 'beverage')], [{ id: 'r6', original_text: 'st. germain', corrected_text: 'St-Germain', applies_to_menu_type: 'food' }])).toHaveLength(0);
    });
    test('validation surfaces conflicts as warnings and removes only the inverse rule', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'P'.repeat(600),
            proposed_replacement_rules: [
                { original_text: 'ste. germaine', corrected_text: 'st-germaine', change_type: 'spelling', applies_to_menu_type: 'beverage' },
                { original_text: 'del maguay', corrected_text: 'del maguey', change_type: 'spelling', applies_to_menu_type: 'beverage' },
            ],
        }, {
            existingAcceptedRules: [
                { id: 'r1', original_text: 'st. germain', corrected_text: 'St-Germain', applies_to_menu_type: 'beverage' },
            ],
        });
        // The variant rule is kept for the human to adjudicate, but is flagged.
        expect(output.proposed_replacement_rules.map((r) => r.original_text)).toEqual(['ste. germaine', 'del maguay']);
        expect(output.warnings.some((w) => w.includes('1 edit(s) from "St-Germain"'))).toBe(true);
    });
});
describe('minimalChangedSpan', () => {
    test('strips unchanged leading words', () => {
        expect((0, improvement_cycle_core_1.minimalChangedSpan)('Smoked Old Fashion', 'Smoked Old Fashioned'))
            .toMatchObject({ from: 'Fashion', to: 'Fashioned', trimmedPrefix: 'Smoked Old' });
        expect((0, improvement_cycle_core_1.minimalChangedSpan)('del maguay', 'del maguey'))
            .toMatchObject({ from: 'maguay', to: 'maguey', trimmedPrefix: 'del' });
    });
    test('strips unchanged trailing context, including punctuation', () => {
        expect((0, improvement_cycle_core_1.minimalChangedSpan)('Veggie,', 'Vegetable,'))
            .toMatchObject({ from: 'Veggie', to: 'Vegetable', trimmedSuffix: ',' });
        expect((0, improvement_cycle_core_1.minimalChangedSpan)('pickled carrots', 'pickled carrot'))
            .toMatchObject({ from: 'carrots', to: 'carrot', trimmedPrefix: 'pickled' });
    });
    test('returns null for rules that are already minimal', () => {
        expect((0, improvement_cycle_core_1.minimalChangedSpan)('tequileno', 'tequileño')).toBeNull();
        expect((0, improvement_cycle_core_1.minimalChangedSpan)('mexcican', 'mexican')).toBeNull();
        expect((0, improvement_cycle_core_1.minimalChangedSpan)('veggies', 'vegetables')).toBeNull();
    });
    test('never splits a word across the span boundary', () => {
        // "Fashion"/"Fashioned" share a 7-char prefix; the span must start at the word.
        const span = (0, improvement_cycle_core_1.minimalChangedSpan)('Old Fashion', 'Old Fashioned');
        expect(span).toMatchObject({ from: 'Fashion', to: 'Fashioned' });
    });
    test('returns null on degenerate input', () => {
        expect((0, improvement_cycle_core_1.minimalChangedSpan)('same', 'same')).toBeNull();
        expect((0, improvement_cycle_core_1.minimalChangedSpan)('', 'x')).toBeNull();
    });
    test('validation warns on an under-generalized rule without dropping it', () => {
        const output = (0, improvement_cycle_core_1.validateImprovementLlmOutput)({
            proposed_prompt: 'P'.repeat(600),
            proposed_replacement_rules: [
                { original_text: 'Smoked Old Fashion', corrected_text: 'Smoked Old Fashioned', change_type: 'spelling' },
                { original_text: 'tequileno', corrected_text: 'tequileño', change_type: 'diacritic' },
            ],
        });
        expect(output.proposed_replacement_rules).toHaveLength(2);
        const spanWarnings = output.warnings.filter((w) => w.includes('carries unchanged context'));
        expect(spanWarnings).toHaveLength(1);
        expect(spanWarnings[0]).toContain('"Fashion" -> "Fashioned"');
    });
});
describe('extractAtomicRulesFromCorpus', () => {
    const line = (id, original, corrected) => ({ id, original_text: original, corrected_text: corrected, applies_to_menu_type: 'all' });
    test('recovers the atomic pair trapped inside whole-line corrections', () => {
        const report = (0, improvement_cycle_core_1.extractAtomicRulesFromCorpus)([
            line('a', 'Grilled Tlayuda, chorizo, pickled veggies, crema fresca D,V 25', 'Grilled Tlayuda, chorizo, pickled vegetables, crema fresca D,V 25'),
            line('b', 'Market Plate, seasonal veggies, salsa verde 18', 'Market Plate, seasonal vegetables, salsa verde 18'),
        ]);
        expect(report.candidates).toHaveLength(1);
        expect(report.candidates[0]).toMatchObject({
            original_text: 'veggies',
            corrected_text: 'vegetables',
            occurrences: 2,
        });
        expect(report.candidates[0].source_rule_ids).toEqual(['a', 'b']);
    });
    test('a pair recovered in both directions is reported as context-dependent, never proposed', () => {
        const report = (0, improvement_cycle_core_1.extractAtomicRulesFromCorpus)([
            line('a', 'Salad, mixed berry compote, cream 12', 'Salad, mixed berries compote, cream 12'),
            line('b', 'Parfait, fresh berries yogurt, granola 9', 'Parfait, fresh berry yogurt, granola 9'),
        ]);
        expect(report.candidates).toHaveLength(0);
        expect(report.contextDependent.length).toBeGreaterThan(0);
    });
    test('skips multi-edit lines and does not re-propose covered pairs', () => {
        const report = (0, improvement_cycle_core_1.extractAtomicRulesFromCorpus)([
            line('a', 'Tostada, aji amarillo, creme fraiche 14', 'Tostada, ají amarillo, crème fraîche 14'),
            { id: 'b', original_text: 'flat bread', corrected_text: 'flatbread', applies_to_menu_type: 'all' },
            line('c', 'Starter, warm flat bread, dip 8', 'Starter, warm flatbread, dip 8'),
        ]);
        expect(report.skipped.some((s) => s.id === 'a')).toBe(true);
        expect(report.alreadyCovered).toContainEqual({ original_text: 'flat bread', corrected_text: 'flatbread' });
        expect(report.candidates.map((c) => c.original_text)).not.toContain('flat bread');
    });
    test('filters pairs touching a known context-dependent term', () => {
        const report = (0, improvement_cycle_core_1.extractAtomicRulesFromCorpus)([
            line('a', 'Tuna tartare, avocado, citrus 21', 'Tuna tartar, avocado, citrus 21'),
        ]);
        expect(report.candidates).toHaveLength(0);
        expect(report.contextDependent[0].reason).toContain('tartare');
    });
});

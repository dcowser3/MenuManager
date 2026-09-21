const fs = require('fs');
const path = require('path');

const scriptSource = fs.readFileSync(path.resolve(__dirname, '../../../scripts/improvement-cycle.js'), 'utf8');

describe('B6-D2 cycle retirement boundary', () => {
    test('has no script-local status-only retirement filter', () => {
        expect(scriptSource).toContain('replayEvidence.filter(core.isReplayRetirementVerified)');
        expect(scriptSource).toContain('observed_status: observedStatus');
        expect(scriptSource).not.toMatch(/replayEvidence\.filter\(\(entry\)\s*=>\s*entry\?\.status\s*===\s*['"]now_correct['"]\)/);
        expect(scriptSource).not.toMatch(/replayEvidence\.filter\(\(entry\)\s*=>\s*entry\.status\s*===\s*['"]now_correct['"]\)/);
    });

    test('binds a full same-attempt audit before deterministic retirement proof', () => {
        expect(scriptSource).toContain("requireDashboardLib('replay-audit-binding')");
        expect(scriptSource).toContain("select('id,attempt_id,created_at,event_type,review_mode,model,ai_request,ai_response,final_result')");
        expect(scriptSource).toContain('replayAuditBindingLib.bindReplayAudit');
        expect(scriptSource).toContain('replayRetirementLib.replayOriginalResponseDeterministically');
        expect(scriptSource).toContain('replayRetirementLib.assessReplayRetirement');
        expect(scriptSource).toContain('retirement_evidence: retirement.retirement_evidence');
        const retirementSource = fs.readFileSync(path.resolve(__dirname, '../lib/replay-retirement.ts'), 'utf8');
        expect(retirementSource).toContain('model_calls: 0');
        expect(retirementSource).toContain('replayOriginalResponseDeterministically');
    });

    test('refreshes stale pending policy evidence and stamps replacement summaries', () => {
        expect(scriptSource).toContain("eval_summary, replay_evidence, correction_routing");
        expect(scriptSource).toContain('core.pendingProposalNeedsReplayRetirementRefresh(pendingProposal)');
        expect(scriptSource).toContain('pendingReplayRetirementRefresh');
        expect(scriptSource).toContain('core.pendingCorrectionsRecoveredExactly(supersedePending, carriedRuleRows || [])');
        expect(scriptSource).toContain('pending proposal remains untouched');
        expect(scriptSource).toContain('core.stampReplayRetirementPolicyVersion');
        const insertAt = scriptSource.indexOf("supabase.from('prompt_proposals').insert(proposalRow)");
        const insertFailureAt = scriptSource.indexOf('if (insertError) throw new Error');
        const supersedeAt = scriptSource.indexOf('.update(supersedePatch)');
        expect(insertAt).toBeGreaterThan(-1);
        expect(insertFailureAt).toBeGreaterThan(insertAt);
        expect(supersedeAt).toBeGreaterThan(insertAt);
        expect(insertFailureAt).toBeLessThan(supersedeAt);
    });
});

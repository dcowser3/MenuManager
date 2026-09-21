const fs = require('fs');
const path = require('path');

test('approval route uses proposal cycle id for persisted correction identity', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../services/dashboard/index.ts'), 'utf8');
    expect(source).toContain('mapProposedRuleToCorrectionRulePayload(rule, proposalRecord?.cycle_id || id');
    expect(source).not.toContain('mapProposedRuleToCorrectionRulePayload(rule, id, index');
});

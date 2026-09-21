import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');

test('review page keeps the backend approval block in its render payload', () => {
    const page = source.slice(source.indexOf("app.get('/learning/prompt-proposal'"), source.indexOf('// Files approved code recommendations'));
    expect(page).toContain('approvalBlock: promptProposalApprovalBlock(proposal)');
});

test('approval mutation checks the backend block before its status write', () => {
    const routeStart = source.indexOf("app.post('/api/learning/prompt-proposal/:id/review'");
    const route = source.slice(routeStart);
    const gate = route.indexOf('promptProposalApprovalBlock(proposalRecord)');
    const statusWrite = route.indexOf('internalApi.put(`${DB_SERVICE_URL}/prompt-proposals/${encodeURIComponent(id)}`');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(statusWrite).toBeGreaterThan(gate);
});

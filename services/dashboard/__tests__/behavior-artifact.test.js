const fs = require('fs');
const os = require('os');
const path = require('path');

const core = require('../lib/improvement-cycle-core');
const { validateBehaviorArtifact } = require('../lib/learning-behavior-tests');
const { writeFrozenBehaviorArtifact } = require('../../../scripts/lib/behavior-artifact');

const acceptedRule = {
    id: 'rule-house-made',
    status: 'accepted',
    source: 'human',
    reviewer_name: 'Reviewer',
    change_type: 'terminology',
    original_text: 'house-made',
    corrected_text: 'housemade',
    rule: 'Use the accepted housemade spelling.',
};

function explanation(overrides = {}) {
    return {
        id: 'correction-1',
        submission_id: 'submission-1',
        source: 'human',
        reviewer_name: 'Reviewer',
        status: 'accepted',
        learning_intent: 'missed_review_correction',
        example_original: 'house-made',
        example_corrected: 'housemade',
        rule: 'Use the accepted housemade spelling.',
        ...overrides,
    };
}

describe('B6-D1 behavior-artifact cycle boundary', () => {
    test('writes a 0600 frozen artifact before the candidate boundary with no external calls', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-b6-d1-artifact-'));
        try {
            const artifactPath = path.join(root, 'behavior-tests.json');
            const dbCalls = jest.fn();
            const providerCalls = jest.fn();
            const networkCalls = jest.fn();
            const rows = [
                explanation(),
                explanation({ id: 'menu-update', learning_intent: 'menu_content_update', example_corrected: 'seasonal edit' }),
                // The first explanation wins deterministically for a duplicate id.
                explanation({ example_corrected: 'candidate must not replace this' }),
            ];

            const artifact = await writeFrozenBehaviorArtifact({
                artifactPath,
                core,
                explanationRows: rows,
                acceptedRules: [acceptedRule],
            });
            const modelBoundary = (candidateResponse) => {
                expect(fs.existsSync(artifactPath)).toBe(true);
                return candidateResponse;
            };
            const beforeCandidate = JSON.stringify(artifact.tests);
            const candidateResponse = modelBoundary({
                proposed_prompt: 'candidate text cannot define expectations',
                proposed_rules: [{ original_text: 'house-made', corrected_text: 'wrong' }],
            });
            expect(candidateResponse.proposed_rules[0].corrected_text).toBe('wrong');
            expect(JSON.stringify(artifact.tests)).toBe(beforeCandidate);

            const saved = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
            expect(fs.statSync(artifactPath).mode & 0o777).toBe(0o600);
            expect(validateBehaviorArtifact(saved)).toEqual(saved);
            expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/);
            expect(saved.records).toHaveLength(2);
            expect(saved.records.find((record) => record.correctionId === 'menu-update')).toMatchObject({
                disposition: 'excluded_from_policy_learning',
                classification: 'menu_content_update',
            });
            expect(saved.tests.length).toBeGreaterThan(0);
            expect(saved.records[0].stages.ai_delivered.status).toBe('unknown');
            expect(dbCalls).not.toHaveBeenCalled();
            expect(providerCalls).not.toHaveBeenCalled();
            expect(networkCalls).not.toHaveBeenCalled();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

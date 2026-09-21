#!/usr/bin/env node
'use strict';

/**
 * Credential-free B4 evaluator entrypoint smoke.
 *
 * Exercises the real review-eval argument parser, evaluation contract, and
 * current B3 review pipeline with a synthetic response. It never loads a DB,
 * provider credential, or network endpoint.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEvaluationContract } = require('./lib/evaluation-contract');
const { parseArgs, evaluateCaseThroughAdapter } = require('./review-eval');

const row = {
    case_id: 'synthetic:holdout',
    raw_input: 'Soup D 8',
    ground_truth: 'Soup D 8',
    reviewed_at: '2026-08-01',
    context: {
        property: 'Fixture',
        templateType: 'food',
        menuType: 'standard',
        servicePeriod: 'dinner',
        allergens: '',
    },
};
const training = {
    case_id: 'synthetic:training',
    raw_input: 'Bread G 12',
    reviewed_at: '2025-01-01',
    context: row.context,
};
const split = {
    schemaVersion: 1,
    frozenAt: '2026-07-01',
    cutoff: '2026-06-01',
    separationMethod: 'lineage-and-near-duplicate-v1',
    groups: { [row.case_id]: 'held-menu', [training.case_id]: 'training-menu' },
    membership: { training: [training.case_id], validation: [], holdout: [row.case_id], lockbox: [] },
};
const { inputSignature } = require('./lib/evaluation-contract');
split.inputSignatures = {
    [row.case_id]: inputSignature(row),
    [training.case_id]: inputSignature(training),
};
const vocabulary = {
    schemaVersion: 1,
    texts: ['Bread G 12'],
    terms: [],
    provenance: {
        source: 'synthetic-frozen-training',
        frozenAt: '2026-01-01',
        caseIds: [training.case_id],
    },
};

async function main() {
    const parsed = parseArgs([
        '--mode', 'holdout',
        '--vocabulary-snapshot', 'vocabulary.json',
        '--split', 'split.json',
        '--expectations', 'expectations.json',
        '--fresh',
        '--no-ai',
    ]);
    assert.equal(parsed.evaluationMode, 'holdout');
    assert.equal(parsed.fresh, true);
    assert.equal(parsed.normalizeGroundTruth, false);

    const first = createEvaluationContract({ mode: 'holdout', dataset: [row], vocabularySnapshot: vocabulary, split });
    const changed = createEvaluationContract({
        mode: 'holdout',
        dataset: [{ ...row, ground_truth: 'Changed answer D 9' }],
        vocabularySnapshot: vocabulary,
        split,
    });
    assert.deepEqual(first.inputHashes, changed.inputHashes);
    assert.equal(first.vocabularyHash, changed.vocabularyHash);
    assert.notEqual(first.expectationHash, changed.expectationHash);

    const requests = [];
    const syntheticResponse = async (text, prompt) => {
        requests.push({ text, prompt });
        return [
            '=== CORRECTED MENU ===',
            text,
            '=== END CORRECTED MENU ===',
            '',
            '=== SUGGESTIONS ===',
            '[]',
            '=== END SUGGESTIONS ===',
        ].join('\n');
    };
    const result = await evaluateCaseThroughAdapter(row, {
        basePrompt: 'Synthetic B4 prompt',
        approvedVocabularyTexts: first.vocabulary.texts,
        approvedVocabularyTerms: first.vocabulary.terms,
        acceptedCorrectionRules: [],
        precheckEnabled: false,
    }, syntheticResponse);
    assert.equal(result.finalCorrectedMenu, row.raw_input);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].text, row.raw_input);
    assert.match(requests[0].prompt, /Synthetic B4 prompt/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-learning-b4-entrypoint-'));
    try {
        fs.writeFileSync(path.join(dir, 'vocabulary.json'), JSON.stringify(vocabulary));
        fs.writeFileSync(path.join(dir, 'split.json'), JSON.stringify(split));
        fs.writeFileSync(path.join(dir, 'expectations.json'), JSON.stringify({
            schemaVersion: 1,
            approvedBy: 'synthetic-reviewer',
            revision: 'synthetic-v1',
            expectations: { [row.case_id]: row.ground_truth },
        }));
        assert.ok(fs.statSync(path.join(dir, 'vocabulary.json')).isFile());
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log(JSON.stringify({
        status: 'passed',
        tests: 8,
        providerCalls: 0,
        dbCalls: 0,
        networkCalls: 0,
        rawExpectationPreserved: true,
        holdoutVocabularyHash: first.vocabularyHash,
        expectationHashChangedOnly: first.expectationHash !== changed.expectationHash,
    }));
}

main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
});

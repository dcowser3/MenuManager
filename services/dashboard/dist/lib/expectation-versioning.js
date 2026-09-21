"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyExpectation = classifyExpectation;
exports.freezeExpectationEnvelope = freezeExpectationEnvelope;
exports.validateExpectationEnvelope = validateExpectationEnvelope;
exports.evaluateAgainstFrozenExpectations = evaluateAgainstFrozenExpectations;
exports.evaluateExpectationArms = evaluateExpectationArms;
exports.activateApprovedSuccessor = activateApprovedSuccessor;
const crypto_1 = require("crypto");
const hash = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(value)).digest('hex');
function classifyExpectation(correction) {
    if (correction.learning_intent === 'missed_review_correction' || correction.change_type === 'missed_review_correction') {
        return 'missed_existing_rule';
    }
    if (correction.learning_intent === 'superseding_policy' || correction.change_type === 'superseding_policy') {
        return correction.status === 'accepted' ? 'explicit_superseding_policy' : 'ambiguous';
    }
    return 'ambiguous';
}
function versionId(input) {
    return hash(input).slice(0, 24);
}
function freezeExpectationEnvelope(input) {
    const expectations = input.expectations.map((row) => {
        const body = {
            version: row.version || 1,
            status: row.status || (row.approvalState === 'approved' ? 'active' : 'candidate'),
            classification: row.classification,
            policyRuleId: row.policyRuleId || null,
            policyVersion: input.policyVersion,
            restaurant: row.restaurant || null,
            menuScope: row.menuScope || null,
            input: row.input,
            expected: row.expected,
            sourceExpectationId: row.sourceExpectationId || null,
            approvalState: row.approvalState,
        };
        return { ...body, id: row.id || versionId(body) };
    });
    const body = {
        schemaVersion: 1,
        activePolicyVersion: input.policyVersion,
        expectations,
        supersedes: [...(input.supersedes || [])],
    };
    return { ...body, sha256: hash(body) };
}
function validateExpectationEnvelope(envelope) {
    if (!envelope || envelope.schemaVersion !== 1 || !Array.isArray(envelope.expectations)) {
        throw new Error('Missing expectation version envelope.');
    }
    const { sha256, ...body } = envelope;
    if (hash(body) !== sha256)
        throw new Error('Expectation version envelope changed after freezing.');
    const ids = new Set();
    for (const expectation of envelope.expectations) {
        if (ids.has(expectation.id))
            throw new Error('Duplicate expectation version id.');
        ids.add(expectation.id);
        if (expectation.approvalState === 'unapproved' && expectation.status === 'active') {
            throw new Error('Unapproved expectation cannot be active.');
        }
    }
    return envelope;
}
function evaluateAgainstFrozenExpectations(envelope, outputs, candidateLabel) {
    validateExpectationEnvelope(envelope);
    return envelope.expectations.map((expectation) => {
        const output = outputs[expectation.id];
        const hasOutput = typeof output === 'string';
        const passed = hasOutput && output === expectation.expected;
        return {
            expectationId: expectation.id,
            candidate: candidateLabel,
            policyVersion: expectation.policyVersion,
            expectationVersion: expectation.version,
            restaurant: expectation.restaurant,
            classification: passed ? 'pass' : hasOutput ? 'genuine_regression' : 'uncertainty',
            passed,
            inputHash: hash(expectation.input),
            expectedHash: hash(expectation.expected),
            outputHash: hasOutput ? hash(output) : null,
        };
    });
}
function evaluateExpectationArms(input) {
    validateExpectationEnvelope(input.envelope);
    return input.envelope.expectations.map((expectation) => {
        const baseline = input.baselineOutputs[expectation.id];
        const candidate = input.candidateOutputs[expectation.id];
        const baselinePresent = typeof baseline === 'string';
        const candidatePresent = typeof candidate === 'string';
        const baselinePassed = baselinePresent && baseline === expectation.expected;
        const candidatePassed = candidatePresent && candidate === expectation.expected;
        let classification = 'uncertainty';
        if (!baselinePresent || !candidatePresent)
            classification = 'uncertainty';
        else if (!baselinePassed && !candidatePassed)
            classification = 'existing_failure';
        else if (baselinePassed && !candidatePassed)
            classification = 'genuine_regression';
        else if (baselinePassed && candidatePassed)
            classification = 'already_passing/no_change_needed';
        else if (!baselinePassed && candidatePassed)
            classification = expectation.approvalState === 'approved' ? 'expected_policy_gap' : 'expected_policy_gap';
        return {
            expectationId: expectation.id,
            policyVersion: expectation.policyVersion,
            expectationVersion: expectation.version,
            expectationHash: hash(expectation),
            baselineRunId: input.baselineRunId,
            candidateRunId: input.candidateRunId,
            classification,
            baselineOutputHash: baselinePresent ? hash(baseline) : null,
            candidateOutputHash: candidatePresent ? hash(candidate) : null,
            expectedHash: hash(expectation.expected),
        };
    });
}
function activateApprovedSuccessor(envelope, approval) {
    validateExpectationEnvelope(envelope);
    if (approval.status !== 'accepted' || approval.policyVersion !== envelope.activePolicyVersion)
        return envelope;
    const prior = envelope.expectations.find((row) => row.id === approval.supersedesId);
    const successor = envelope.expectations.find((row) => row.id === approval.successorId);
    if (!prior || !successor || successor.sourceExpectationId !== prior.id
        || successor.policyRuleId !== approval.ruleId || successor.restaurant !== approval.restaurant
        || successor.menuScope !== approval.menuScope || successor.approvalState !== 'unapproved')
        return envelope;
    const expectations = envelope.expectations.map((row) => row.id === prior.id
        ? { ...row, status: 'superseded' }
        : row.id === successor.id ? { ...row, status: 'active', approvalState: 'approved' } : row);
    const supersedes = envelope.supersedes.some((row) => row.priorId === prior.id && row.successorId === successor.id)
        ? envelope.supersedes : [...envelope.supersedes, { priorId: prior.id, successorId: successor.id }];
    const body = { schemaVersion: 1, activePolicyVersion: envelope.activePolicyVersion, expectations, supersedes };
    return { ...body, sha256: hash(body) };
}

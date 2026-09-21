"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyExpectation = classifyExpectation;
exports.freezeExpectationEnvelope = freezeExpectationEnvelope;
exports.validateExpectationEnvelope = validateExpectationEnvelope;
exports.evaluateAgainstFrozenExpectations = evaluateAgainstFrozenExpectations;
exports.evaluateExpectationArms = evaluateExpectationArms;
exports.deriveCandidateEnvelope = deriveCandidateEnvelope;
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
            version: row.version || (row.sourceExpectationId ? 2 : 1),
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
        candidatePolicyVersion: null,
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
    const linkedPrior = new Set();
    const linkedSuccessor = new Set();
    for (const link of envelope.supersedes) {
        if (linkedPrior.has(link.priorId) || linkedSuccessor.has(link.successorId))
            throw new Error('Supersession links must be one-to-one.');
        linkedPrior.add(link.priorId);
        linkedSuccessor.add(link.successorId);
        const prior = envelope.expectations.find((row) => row.id === link.priorId);
        const successor = envelope.expectations.find((row) => row.id === link.successorId);
        if (!prior || !successor || successor.sourceExpectationId !== prior.id || successor.version <= prior.version
            || successor.policyRuleId !== prior.policyRuleId || successor.restaurant !== prior.restaurant || successor.menuScope !== prior.menuScope
            || !['active', 'superseded'].includes(prior.status) || !['candidate', 'active'].includes(successor.status))
            throw new Error('Invalid supersession link.');
    }
    return envelope;
}
function evaluateAgainstFrozenExpectations(envelope, outputs, candidateLabel) {
    validateExpectationEnvelope(envelope);
    return envelope.expectations.filter((expectation) => expectation.status !== 'superseded').map((expectation) => {
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
    const candidateSuccessors = new Set(input.envelope.supersedes
        .map((link) => input.envelope.expectations.find((row) => row.id === link.successorId))
        .filter((row) => row?.status === 'candidate').map((row) => row?.sourceExpectationId));
    return input.envelope.expectations.filter((expectation) => expectation.status !== 'superseded'
        && !(expectation.status === 'active' && candidateSuccessors.has(expectation.id))).map((expectation) => {
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
function deriveCandidateEnvelope(envelope) {
    validateExpectationEnvelope(envelope);
    const replacements = new Map(envelope.supersedes.map((link) => [link.priorId, link.successorId]));
    const expectations = envelope.expectations;
    const candidateRows = expectations.filter((row) => row.status !== 'superseded'
        && !(row.status === 'active' && replacements.has(row.id)));
    const body = { schemaVersion: 1, activePolicyVersion: envelope.candidatePolicyVersion || envelope.activePolicyVersion,
        candidatePolicyVersion: null, expectations: candidateRows, supersedes: envelope.supersedes };
    return { ...body, sha256: hash(body) };
}
function activateApprovedSuccessor(envelope, approval) {
    validateExpectationEnvelope(envelope);
    if (approval.status !== 'accepted' || approval.policyVersion !== envelope.activePolicyVersion)
        return envelope;
    const prior = envelope.expectations.find((row) => row.id === approval.supersedesId);
    const successor = envelope.expectations.find((row) => row.id === approval.successorId);
    const linked = envelope.supersedes.some((row) => row.priorId === approval.supersedesId && row.successorId === approval.successorId);
    if (!linked || !prior || !successor || !['active', 'superseded'].includes(prior.status) || successor.status !== 'candidate' || successor.sourceExpectationId !== prior.id
        || successor.policyRuleId !== approval.ruleId || successor.restaurant !== approval.restaurant
        || successor.menuScope !== approval.menuScope || successor.approvalState !== 'unapproved')
        return envelope;
    const expectations = envelope.expectations.map((row) => row.id === prior.id
        ? { ...row, status: 'superseded' }
        : row.id === successor.id ? { ...row, status: 'active', approvalState: 'approved' } : row);
    const body = { schemaVersion: 1, activePolicyVersion: successor.policyVersion, candidatePolicyVersion: null, expectations, supersedes: envelope.supersedes };
    return { ...body, sha256: hash(body) };
}

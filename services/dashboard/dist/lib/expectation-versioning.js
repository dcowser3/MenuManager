"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyExpectation = classifyExpectation;
exports.freezeExpectationEnvelope = freezeExpectationEnvelope;
exports.validateExpectationEnvelope = validateExpectationEnvelope;
exports.validateApprovedExpectationAuthority = validateApprovedExpectationAuthority;
exports.evaluateAgainstFrozenExpectations = evaluateAgainstFrozenExpectations;
exports.evaluateExpectationArms = evaluateExpectationArms;
exports.deriveCandidateEnvelope = deriveCandidateEnvelope;
exports.activateApprovedSuccessor = activateApprovedSuccessor;
exports.planApprovedExpectationActivation = planApprovedExpectationActivation;
exports.attachApprovedActivationMetadata = attachApprovedActivationMetadata;
exports.deriveProposalBoundEnvelope = deriveProposalBoundEnvelope;
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
            policyVersion: row.policyVersion || input.policyVersion,
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
        candidatePolicyVersion: input.candidatePolicyVersion || null,
        expectations,
        supersedes: [...(input.supersedes || [])],
        policyChangeApprovals: input.policyChangeApprovals || [],
        parentArtifactHash: input.parentArtifactHash || null,
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
function validateApprovedExpectationAuthority(envelope) {
    validateExpectationEnvelope(envelope);
    const approvals = envelope.policyChangeApprovals || [];
    const candidates = envelope.expectations.filter((row) => row.status === 'candidate');
    if (!candidates.length || envelope.candidatePolicyVersion === envelope.activePolicyVersion || !envelope.candidatePolicyVersion)
        throw new Error('Approved policy-change authority is missing or not versioned.');
    const candidateIds = new Set(candidates.map((row) => row.id));
    if (approvals.length !== candidates.length || approvals.some((row) => !candidateIds.has(row.successorId)))
        throw new Error('Approval records contain orphan or duplicate rows.');
    for (const candidate of candidates) {
        if (candidate.classification !== 'explicit_superseding_policy' || candidate.approvalState !== 'unapproved' || !candidate.sourceExpectationId)
            throw new Error('Candidate lacks explicit policy-change classification.');
        const prior = envelope.expectations.find((row) => row.id === candidate.sourceExpectationId);
        const approval = approvals.filter((row) => row.priorId === candidate.sourceExpectationId && row.successorId === candidate.id);
        if (!prior || prior.status !== 'active' || prior.approvalState !== 'approved' || approval.length !== 1 || candidate.policyVersion !== envelope.candidatePolicyVersion)
            throw new Error('Candidate authority link is invalid.');
        const record = approval[0];
        if (!record.caseId || !record.sourceRevisionId || !record.reviewer || record.status !== 'approved' || !Number.isFinite(Date.parse(record.approvedAt)))
            throw new Error('Candidate approval provenance is incomplete.');
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
    const body = { schemaVersion: 1, activePolicyVersion: successor.policyVersion, candidatePolicyVersion: null, expectations, supersedes: envelope.supersedes,
        parentArtifactHash: envelope.parentArtifactHash, policyChangeApprovals: envelope.policyChangeApprovals };
    return { ...body, sha256: hash(body) };
}
function planApprovedExpectationActivation(envelope, acceptedRules, ruleResults, selectedIndexes = []) {
    validateExpectationEnvelope(envelope);
    const selected = acceptedRules
        .map((rule, position) => ({ rule, result: ruleResults.find((entry) => entry.index === (selectedIndexes[position] ?? position)) }))
        .find(({ rule, result }) => !!rule?.expectation_activation && result?.ok === true);
    if (!selected)
        return null;
    const metadata = selected.rule.expectation_activation;
    const successor = envelope.expectations.find((row) => row.id === metadata.successorId);
    const authority = (envelope.policyChangeApprovals || []).find((row) => row.priorId === metadata.supersedesId && row.successorId === metadata.successorId);
    if (!successor || !authority || metadata.source !== 'approved_expectation_artifact' || metadata.parentArtifactHash !== envelope.parentArtifactHash
        || metadata.derivedEnvelopeHash !== envelope.sha256 || metadata.caseId !== authority.caseId || metadata.sourceRevisionId !== authority.sourceRevisionId
        || metadata.reviewer !== authority.reviewer || metadata.approvedAt !== authority.approvedAt
        || metadata.ruleId !== successor.policyRuleId || successor.policyRuleId !== selected.result?.correctionId
        || metadata.restaurant !== (selected.result?.location || null)
        || metadata.menuScope !== (selected.result?.menuScope || null)
        || metadata.isLocationSpecific !== (selected.result?.isLocationSpecific === true))
        return null;
    return activateApprovedSuccessor(envelope, {
        ruleId: metadata.ruleId || selected.rule.id || null,
        restaurant: metadata.restaurant || selected.rule.location || null,
        menuScope: metadata.menuScope || selected.rule.applies_to_menu_type || null,
        policyVersion: metadata.policyVersion || envelope.activePolicyVersion,
        status: 'accepted',
        supersedesId: metadata.supersedesId,
        successorId: metadata.successorId,
    });
}
function attachApprovedActivationMetadata(proposedRules, envelope) {
    validateExpectationEnvelope(envelope);
    return proposedRules.map((rule) => {
        const match = envelope.expectations.find((expectation) => expectation.status === 'candidate'
            && expectation.input === rule.original_text && expectation.expected === rule.corrected_text
            && expectation.restaurant === (rule.is_location_specific ? rule.location : null)
            && expectation.menuScope === (rule.applies_to_menu_type || null)
            && ['spelling', 'diacritic', 'terminology', 'grammar', 'punctuation', 'capitalization'].includes(rule.change_type)
            && envelope.supersedes.some((link) => link.successorId === expectation.id && link.priorId === expectation.sourceExpectationId));
        if (!match)
            return rule;
        const prior = envelope.expectations.find((expectation) => expectation.id === match.sourceExpectationId);
        return { ...rule, expectation_activation: { source: 'approved_expectation_artifact', ruleId: match.policyRuleId,
                supersedesId: prior?.id, successorId: match.id, policyVersion: envelope.activePolicyVersion,
                restaurant: match.restaurant, menuScope: match.menuScope, isLocationSpecific: !!rule.is_location_specific,
                artifactHash: envelope.sha256, sourceRevision: prior?.version } };
    });
}
function deriveProposalBoundEnvelope(proposedRules, authority, proposalId) {
    validateApprovedExpectationAuthority(authority);
    const matches = proposedRules.map((rule, index) => ({ rule, index, expectations: authority.expectations.filter((row) => row.status === 'candidate'
            && row.input === rule.original_text && row.expected === rule.corrected_text
            && row.restaurant === (rule.is_location_specific ? rule.location : null)
            && row.menuScope === (rule.applies_to_menu_type || null)) }))
        .filter((entry) => entry.expectations.length);
    if (matches.some((entry) => entry.expectations.length !== 1))
        return { rules: proposedRules, envelope: null };
    const candidateToRules = new Map();
    for (const entry of matches) {
        const id = entry.expectations[0].id;
        if (candidateToRules.has(id))
            return { rules: proposedRules, envelope: null };
        candidateToRules.set(id, entry.index);
    }
    if (!matches.length)
        return { rules: proposedRules, envelope: null };
    const successorIds = new Set();
    const rules = proposedRules.map((rule, index) => {
        const match = matches.find((entry) => entry.index === index);
        if (!match || successorIds.has(match.expectations[0].id))
            return rule;
        successorIds.add(match.expectations[0].id);
        const approval = authority.policyChangeApprovals.find((row) => row.successorId === match.expectations[0].id);
        const policyRuleId = `proposal-${proposalId}-rule-${index}`;
        return { ...rule, expectation_activation: { source: 'approved_expectation_artifact', ruleId: policyRuleId,
                supersedesId: match.expectations[0].sourceExpectationId, successorId: match.expectations[0].id,
                policyVersion: authority.activePolicyVersion, restaurant: match.expectations[0].restaurant,
                menuScope: match.expectations[0].menuScope, isLocationSpecific: !!rule.is_location_specific,
                parentArtifactHash: authority.sha256, caseId: approval.caseId, sourceRevisionId: approval.sourceRevisionId,
                reviewer: approval.reviewer, approvedAt: approval.approvedAt } };
    });
    const expectations = authority.expectations.filter((row) => row.status !== 'candidate' || successorIds.has(row.id)).map((row) => {
        const match = matches.find((entry) => entry.expectations[0].id === row.id || entry.expectations[0].sourceExpectationId === row.id);
        return match ? { ...row, policyRuleId: `proposal-${proposalId}-rule-${match.index}` } : row;
    });
    const body = { schemaVersion: 1, activePolicyVersion: authority.activePolicyVersion,
        candidatePolicyVersion: authority.candidatePolicyVersion || authority.activePolicyVersion, expectations,
        supersedes: authority.supersedes.filter((link) => successorIds.has(link.successorId)), policyChangeApprovals: authority.policyChangeApprovals.filter((row) => successorIds.has(row.successorId)), parentArtifactHash: authority.sha256 };
    const derivedEnvelope = { ...body, sha256: hash(body) };
    const rulesWithHash = rules.map((rule) => rule.expectation_activation ? { ...rule, expectation_activation: { ...rule.expectation_activation, derivedEnvelopeHash: derivedEnvelope.sha256 } } : rule);
    return { rules: rulesWithHash, envelope: derivedEnvelope };
}

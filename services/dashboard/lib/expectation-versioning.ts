import { createHash } from 'crypto';

export type ExpectationClassification =
    | 'missed_existing_rule'
    | 'explicit_superseding_policy'
    | 'ambiguous';

export type ExpectationStatus = 'active' | 'candidate' | 'superseded';

export interface ExpectationVersion {
    id: string;
    version: number;
    status: ExpectationStatus;
    classification: ExpectationClassification;
    policyRuleId: string | null;
    policyVersion: string;
    restaurant: string | null;
    menuScope: string | null;
    input: string;
    expected: string;
    sourceExpectationId: string | null;
    approvalState: 'approved' | 'unapproved';
}

export interface ExpectationEnvelope {
    schemaVersion: 1;
    activePolicyVersion: string;
    expectations: ExpectationVersion[];
    supersedes: Array<{ priorId: string; successorId: string }>;
    sha256: string;
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function classifyExpectation(correction: Record<string, any>): ExpectationClassification {
    if (correction.learning_intent === 'missed_review_correction' || correction.change_type === 'missed_review_correction') {
        return 'missed_existing_rule';
    }
    if (correction.learning_intent === 'superseding_policy' || correction.change_type === 'superseding_policy') {
        return correction.status === 'accepted' ? 'explicit_superseding_policy' : 'ambiguous';
    }
    return 'ambiguous';
}

function versionId(input: Omit<ExpectationVersion, 'id'>) {
    return hash(input).slice(0, 24);
}

export function freezeExpectationEnvelope(input: {
    policyVersion: string;
    expectations: Array<{
        id?: string;
        version?: number;
        classification: ExpectationClassification;
        policyRuleId?: string | null;
        restaurant?: string | null;
        menuScope?: string | null;
        input: string;
        expected: string;
        sourceExpectationId?: string | null;
        approvalState: 'approved' | 'unapproved';
        status?: ExpectationStatus;
    }>;
    supersedes?: Array<{ priorId: string; successorId: string }>;
}): ExpectationEnvelope {
    const expectations = input.expectations.map((row) => {
        const body: Omit<ExpectationVersion, 'id'> = {
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
        schemaVersion: 1 as const,
        activePolicyVersion: input.policyVersion,
        expectations,
        supersedes: [...(input.supersedes || [])],
    };
    return { ...body, sha256: hash(body) };
}

export function validateExpectationEnvelope(envelope: ExpectationEnvelope): ExpectationEnvelope {
    if (!envelope || envelope.schemaVersion !== 1 || !Array.isArray(envelope.expectations)) {
        throw new Error('Missing expectation version envelope.');
    }
    const { sha256, ...body } = envelope;
    if (hash(body) !== sha256) throw new Error('Expectation version envelope changed after freezing.');
    const ids = new Set<string>();
    for (const expectation of envelope.expectations) {
        if (ids.has(expectation.id)) throw new Error('Duplicate expectation version id.');
        ids.add(expectation.id);
        if (expectation.approvalState === 'unapproved' && expectation.status === 'active') {
            throw new Error('Unapproved expectation cannot be active.');
        }
    }
    return envelope;
}

export function evaluateAgainstFrozenExpectations(
    envelope: ExpectationEnvelope,
    outputs: Record<string, string>,
    candidateLabel: string,
) {
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


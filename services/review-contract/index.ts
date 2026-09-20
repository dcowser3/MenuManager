import { createHash } from 'crypto';

export const COORDINATOR_SCHEMA_VERSION = 1 as const;
export const COORDINATOR_ENGINE_VERSION = 'review-coordinator-v1' as const;

export type SeedSemantics = {
    state: 'default' | 'explicit' | 'disabled';
    value: number | null;
};

export type EffectiveExecutionIdentity = {
    provider: string;
    model: string;
    temperature: number;
    seed: SeedSemantics;
};

export type CallerAttestations = {
    sourceHash: string;
    contextHash: string;
    policyHash: string;
    vocabularySnapshotHash: string;
};

export type CoordinatorReviewRequest = {
    schemaVersion: number;
    engineVersion: string;
    text: string;
    prompt: string;
    textHash: string;
    promptHash: string;
    requestDigest: string;
    callerAttestations: CallerAttestations;
    effectiveExecutionIdentity: EffectiveExecutionIdentity;
    replayIdentity: string;
};

export type CoordinatorReviewResponse = CoordinatorReviewRequest & {
    feedback: string;
    finishReason: string | null;
    model: string;
};

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => [key, canonicalize(entry)]));
    }
    return value;
}

export function stableJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashText(value: string): string {
    return sha256(value);
}

export function normalizeConfiguredSeed(env: Record<string, string | undefined>): SeedSemantics {
    const configured = env.AI_REVIEW_SEED ?? env.BASIC_AI_CHECK_SEED;
    if (configured !== undefined && configured.trim() === '') return { state: 'disabled', value: null };
    const parsed = Number(configured);
    if (configured !== undefined && Number.isInteger(parsed) && parsed >= 0) {
        return { state: 'explicit', value: parsed };
    }
    return { state: 'default', value: 42 };
}

export function normalizeConfiguredTemperature(env: Record<string, string | undefined>): number {
    const parsed = Number(env.AI_REVIEW_TEMPERATURE);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function configuredExecutionIdentity(env: Record<string, string | undefined>): EffectiveExecutionIdentity {
    return {
        provider: env.AI_REVIEW_LLM_PROVIDER || env.LLM_PROVIDER || 'openai',
        model: env.AI_REVIEW_MODEL || 'gpt-5.6-luna',
        temperature: normalizeConfiguredTemperature(env),
        seed: normalizeConfiguredSeed(env),
    };
}

export function buildRequestDigest(request: Omit<CoordinatorReviewRequest, 'requestDigest'>): string {
    return sha256(stableJson({
        schemaVersion: request.schemaVersion,
        engineVersion: request.engineVersion,
        textHash: request.textHash,
        promptHash: request.promptHash,
        callerAttestations: request.callerAttestations,
        effectiveExecutionIdentity: request.effectiveExecutionIdentity,
        replayIdentity: request.replayIdentity,
    }));
}

export function buildCoordinatorRequest(input: Omit<CoordinatorReviewRequest, 'textHash' | 'promptHash' | 'requestDigest'>): CoordinatorReviewRequest {
    const request = {
        ...input,
        textHash: hashText(input.text),
        promptHash: hashText(input.prompt),
    } as Omit<CoordinatorReviewRequest, 'requestDigest'>;
    return { ...request, requestDigest: buildRequestDigest(request) };
}

export function validateCoordinatorRequest(request: unknown): { ok: true; request: CoordinatorReviewRequest } | { ok: false; reason: string } {
    if (!request || typeof request !== 'object') return { ok: false, reason: 'malformed_request' };
    const candidate = request as CoordinatorReviewRequest;
    if (candidate.schemaVersion !== COORDINATOR_SCHEMA_VERSION || candidate.engineVersion !== COORDINATOR_ENGINE_VERSION) {
        return { ok: false, reason: 'version_mismatch' };
    }
    if (typeof candidate.text !== 'string' || !candidate.text || typeof candidate.prompt !== 'string' || !candidate.prompt) {
        return { ok: false, reason: 'missing_model_input' };
    }
    if (typeof candidate.replayIdentity !== 'string' || !candidate.replayIdentity.trim()) return { ok: false, reason: 'missing_replay_identity' };
    const attestations = candidate.callerAttestations;
    if (!attestations || !['sourceHash', 'contextHash', 'policyHash', 'vocabularySnapshotHash'].every((key) => typeof (attestations as any)[key] === 'string' && !!(attestations as any)[key])) {
        return { ok: false, reason: 'missing_identity' };
    }
    const execution = candidate.effectiveExecutionIdentity;
    if (!execution || typeof execution.provider !== 'string' || !execution.provider
        || typeof execution.model !== 'string' || !execution.model
        || typeof execution.temperature !== 'number' || !Number.isFinite(execution.temperature)
        || !execution.seed || !['default', 'explicit', 'disabled'].includes(execution.seed.state)
        || (execution.seed.state === 'disabled' && execution.seed.value !== null)
        || (execution.seed.state !== 'disabled' && (!Number.isInteger(execution.seed.value) || (execution.seed.value as number) < 0))) {
        return { ok: false, reason: 'malformed_execution_identity' };
    }
    const expectedTextHash = hashText(candidate.text);
    const expectedPromptHash = hashText(candidate.prompt);
    if (candidate.textHash !== expectedTextHash) return { ok: false, reason: 'text_hash_mismatch' };
    if (candidate.promptHash !== expectedPromptHash) return { ok: false, reason: 'prompt_hash_mismatch' };
    const expectedDigest = buildRequestDigest({ ...candidate, requestDigest: undefined } as Omit<CoordinatorReviewRequest, 'requestDigest'>);
    if (candidate.requestDigest !== expectedDigest) return { ok: false, reason: 'request_digest_mismatch' };
    return { ok: true, request: candidate };
}

export function sameExecutionIdentity(a: EffectiveExecutionIdentity, b: EffectiveExecutionIdentity): boolean {
    return stableJson(a) === stableJson(b);
}

/**
 * Cached access to the canonical menu vocabulary for the review hot path.
 *
 * Building the vocabulary reads accepted correction rules and aggregated approved-menu terms,
 * which is far too much work to repeat per submission. A short TTL keeps the review hot path
 * cheap while still picking up new approvals promptly.
 *
 * Failure is always silent and non-blocking: if the fetch throws, reviews proceed without
 * vocabulary findings rather than erroring.
 */
import {
    buildCanonicalVocabulary,
    findNearMisses,
    renderNearMissBriefing,
    CanonicalVocabulary,
    NearMissFinding,
    ApprovedVocabularyTerm,
} from './canonical-vocabulary';
import { AcceptedCorrectionRule } from './pre-ai-deterministic-rules';
import { PolicyContext, policyHash, resolveCanonicalPolicies } from './canonical-policy';
import { CONTEXT_DEPENDENT_TERMS } from './improvement-cycle-core';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

const cached = new Map<string, { vocabulary: CanonicalVocabulary; expiresAt: number }>();
const inFlight = new Map<string, Promise<CanonicalVocabulary | null>>();
const loaderIds = new WeakMap<Function, number>();
let nextLoaderId = 1;
let generation = 0;
function loaderId(fn?: Function): number {
    if (!fn) return 0;
    if (!loaderIds.has(fn)) loaderIds.set(fn, nextLoaderId++);
    return loaderIds.get(fn)!;
}

export function isCanonicalVocabularyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    // Opt-out, not opt-in: the section is additive and omitted when there is nothing to say.
    return `${env.CANONICAL_VOCABULARY_ENABLED ?? 'true'}`.toLowerCase() !== 'false';
}

/** Drops the cache. Exported for tests and for the rule-approval path. */
export function invalidateCanonicalVocabulary(): void {
    cached.clear();
    inFlight.clear();
    generation++;
}

export async function getCanonicalVocabulary(params: PolicyContext & {
    acceptedPolicyFingerprint?: string;
    vocabularySnapshotHash?: string;
    fetchAcceptedRules: () => Promise<AcceptedCorrectionRule[]>;
    fetchApprovedTexts?: () => Promise<string[]>;
    fetchApprovedTerms?: () => Promise<ApprovedVocabularyTerm[]>;
    ttlMs?: number;
    now?: () => number;
}): Promise<CanonicalVocabulary | null> {
    const now = params.now ? params.now() : Date.now();
    const key = policyHash({ tenant: params.tenantId || 'default', property: params.property || '', template: params.templateType || 'food', menu: params.menuType || 'standard',
        policy: params.acceptedPolicyFingerprint || loaderId(params.fetchAcceptedRules),
        vocabulary: params.vocabularySnapshotHash || [loaderId(params.fetchApprovedTexts), loaderId(params.fetchApprovedTerms)] });
    const hit = cached.get(key);
    if (hit && hit.expiresAt > now) return hit.vocabulary;
    if (inFlight.has(key)) return inFlight.get(key)!;
    const startedGeneration = generation;

    const ttl = params.ttlMs ?? DEFAULT_TTL_MS;
    const pending = (async () => {
        try {
            const [acceptedRules, approvedTexts, approvedTerms] = await Promise.all([
                params.fetchAcceptedRules(),
                params.fetchApprovedTexts ? params.fetchApprovedTexts() : Promise.resolve([]),
                params.fetchApprovedTerms ? params.fetchApprovedTerms() : Promise.resolve([]),
            ]);
            const vocabulary = buildCanonicalVocabulary({
                acceptedRules: resolveCanonicalPolicies(acceptedRules || [], params).rules,
                approvedTexts: approvedTexts || [],
                approvedTerms: approvedTerms || [],
                seedAmbiguousTerms: CONTEXT_DEPENDENT_TERMS,
            });
            if (startedGeneration === generation) {
                if (cached.size >= 128) cached.delete(cached.keys().next().value!);
                cached.set(key, { vocabulary, expiresAt: (params.now ? params.now() : Date.now()) + ttl });
            }
            return vocabulary;
        } catch (err) {
            console.warn(`Canonical vocabulary unavailable; continuing without near-miss findings. (${(err as Error)?.message || err})`);
            return null;
        } finally {
            if (startedGeneration === generation) inFlight.delete(key);
        }
    })();
    inFlight.set(key, pending);
    return pending;
}

/**
 * Full path from menu text to a prompt-ready briefing. Returns '' whenever the feature is
 * off, the vocabulary is unavailable, or the menu has no suspicious spellings — in which
 * case buildFinalPrompt omits the section and the prompt is unchanged.
 */
export async function buildNearMissBriefing(
    menuText: string,
    params: Parameters<typeof getCanonicalVocabulary>[0] & { env?: NodeJS.ProcessEnv }
): Promise<string> {
    return (await buildNearMissAnalysis(menuText, params)).briefing;
}

export type CanonicalNearMissAnalysis = {
    findings: NearMissFinding[];
    briefing: string;
    vocabulary: CanonicalVocabulary | null;
};

export async function buildNearMissAnalysis(
    menuText: string,
    params: Parameters<typeof getCanonicalVocabulary>[0] & { env?: NodeJS.ProcessEnv }
): Promise<CanonicalNearMissAnalysis> {
    if (!isCanonicalVocabularyEnabled(params.env)) return { findings: [], briefing: '', vocabulary: null };
    if (!`${menuText || ''}`.trim()) return { findings: [], briefing: '', vocabulary: null };
    const vocabulary = await getCanonicalVocabulary(params);
    if (!vocabulary) return { findings: [], briefing: '', vocabulary: null };
    try {
        const findings = findNearMisses(menuText, vocabulary);
        return { findings, briefing: renderNearMissBriefing(findings), vocabulary };
    } catch (err) {
        console.warn(`Near-miss detection failed; continuing without it. (${(err as Error)?.message || err})`);
        return { findings: [], briefing: '', vocabulary };
    }
}

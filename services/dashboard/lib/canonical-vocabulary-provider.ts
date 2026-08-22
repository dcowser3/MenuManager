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
import { CONTEXT_DEPENDENT_TERMS } from './improvement-cycle-core';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

let cached: { vocabulary: CanonicalVocabulary; expiresAt: number } | null = null;
let inFlight: Promise<CanonicalVocabulary | null> | null = null;

export function isCanonicalVocabularyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    // Opt-out, not opt-in: the section is additive and omitted when there is nothing to say.
    return `${env.CANONICAL_VOCABULARY_ENABLED ?? 'true'}`.toLowerCase() !== 'false';
}

/** Drops the cache. Exported for tests and for the rule-approval path. */
export function invalidateCanonicalVocabulary(): void {
    cached = null;
    inFlight = null;
}

export async function getCanonicalVocabulary(params: {
    fetchAcceptedRules: () => Promise<Array<{ original_text?: string | null; corrected_text?: string | null }>>;
    fetchApprovedTexts?: () => Promise<string[]>;
    fetchApprovedTerms?: () => Promise<ApprovedVocabularyTerm[]>;
    ttlMs?: number;
    now?: () => number;
}): Promise<CanonicalVocabulary | null> {
    const now = params.now ? params.now() : Date.now();
    if (cached && cached.expiresAt > now) return cached.vocabulary;
    if (inFlight) return inFlight;

    const ttl = params.ttlMs ?? DEFAULT_TTL_MS;
    inFlight = (async () => {
        try {
            const [acceptedRules, approvedTexts, approvedTerms] = await Promise.all([
                params.fetchAcceptedRules(),
                params.fetchApprovedTexts ? params.fetchApprovedTexts() : Promise.resolve([]),
                params.fetchApprovedTerms ? params.fetchApprovedTerms() : Promise.resolve([]),
            ]);
            const vocabulary = buildCanonicalVocabulary({
                acceptedRules: acceptedRules || [],
                approvedTexts: approvedTexts || [],
                approvedTerms: approvedTerms || [],
                seedAmbiguousTerms: CONTEXT_DEPENDENT_TERMS,
            });
            cached = { vocabulary, expiresAt: (params.now ? params.now() : Date.now()) + ttl };
            return vocabulary;
        } catch (err) {
            console.warn(`Canonical vocabulary unavailable; continuing without near-miss findings. (${(err as Error)?.message || err})`);
            return null;
        } finally {
            inFlight = null;
        }
    })();
    return inFlight;
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
};

export async function buildNearMissAnalysis(
    menuText: string,
    params: Parameters<typeof getCanonicalVocabulary>[0] & { env?: NodeJS.ProcessEnv }
): Promise<CanonicalNearMissAnalysis> {
    if (!isCanonicalVocabularyEnabled(params.env)) return { findings: [], briefing: '' };
    if (!`${menuText || ''}`.trim()) return { findings: [], briefing: '' };
    const vocabulary = await getCanonicalVocabulary(params);
    if (!vocabulary) return { findings: [], briefing: '' };
    try {
        const findings = findNearMisses(menuText, vocabulary);
        return { findings, briefing: renderNearMissBriefing(findings) };
    } catch (err) {
        console.warn(`Near-miss detection failed; continuing without it. (${(err as Error)?.message || err})`);
        return { findings: [], briefing: '' };
    }
}

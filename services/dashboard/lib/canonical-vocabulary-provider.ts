/**
 * Cached access to the canonical menu vocabulary for the review hot path.
 *
 * Building the vocabulary reads every accepted correction rule, which is far too much work
 * to repeat per submission. The vocabulary changes only when a reviewer accepts a rule, so a
 * short TTL is ample and a stale read costs nothing worse than a missing advisory finding.
 *
 * Failure is always silent and non-blocking: if the fetch throws, reviews proceed with no
 * briefing rather than erroring. This feature can only ever add a hint to the prompt.
 */
import {
    buildCanonicalVocabulary,
    findNearMisses,
    renderNearMissBriefing,
    CanonicalVocabulary,
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
    ttlMs?: number;
    now?: () => number;
}): Promise<CanonicalVocabulary | null> {
    const now = params.now ? params.now() : Date.now();
    if (cached && cached.expiresAt > now) return cached.vocabulary;
    if (inFlight) return inFlight;

    const ttl = params.ttlMs ?? DEFAULT_TTL_MS;
    inFlight = (async () => {
        try {
            const [acceptedRules, approvedTexts] = await Promise.all([
                params.fetchAcceptedRules(),
                params.fetchApprovedTexts ? params.fetchApprovedTexts() : Promise.resolve([]),
            ]);
            const vocabulary = buildCanonicalVocabulary({
                acceptedRules: acceptedRules || [],
                approvedTexts: approvedTexts || [],
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
    if (!isCanonicalVocabularyEnabled(params.env)) return '';
    if (!`${menuText || ''}`.trim()) return '';
    const vocabulary = await getCanonicalVocabulary(params);
    if (!vocabulary) return '';
    try {
        return renderNearMissBriefing(findNearMisses(menuText, vocabulary));
    } catch (err) {
        console.warn(`Near-miss detection failed; continuing without it. (${(err as Error)?.message || err})`);
        return '';
    }
}

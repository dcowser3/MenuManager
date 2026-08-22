"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCanonicalVocabularyEnabled = isCanonicalVocabularyEnabled;
exports.invalidateCanonicalVocabulary = invalidateCanonicalVocabulary;
exports.getCanonicalVocabulary = getCanonicalVocabulary;
exports.buildNearMissBriefing = buildNearMissBriefing;
exports.buildNearMissAnalysis = buildNearMissAnalysis;
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
const canonical_vocabulary_1 = require("./canonical-vocabulary");
const improvement_cycle_core_1 = require("./improvement-cycle-core");
const DEFAULT_TTL_MS = 10 * 60 * 1000;
let cached = null;
let inFlight = null;
function isCanonicalVocabularyEnabled(env = process.env) {
    // Opt-out, not opt-in: the section is additive and omitted when there is nothing to say.
    return `${env.CANONICAL_VOCABULARY_ENABLED ?? 'true'}`.toLowerCase() !== 'false';
}
/** Drops the cache. Exported for tests and for the rule-approval path. */
function invalidateCanonicalVocabulary() {
    cached = null;
    inFlight = null;
}
async function getCanonicalVocabulary(params) {
    const now = params.now ? params.now() : Date.now();
    if (cached && cached.expiresAt > now)
        return cached.vocabulary;
    if (inFlight)
        return inFlight;
    const ttl = params.ttlMs ?? DEFAULT_TTL_MS;
    inFlight = (async () => {
        try {
            const [acceptedRules, approvedTexts, approvedTerms] = await Promise.all([
                params.fetchAcceptedRules(),
                params.fetchApprovedTexts ? params.fetchApprovedTexts() : Promise.resolve([]),
                params.fetchApprovedTerms ? params.fetchApprovedTerms() : Promise.resolve([]),
            ]);
            const vocabulary = (0, canonical_vocabulary_1.buildCanonicalVocabulary)({
                acceptedRules: acceptedRules || [],
                approvedTexts: approvedTexts || [],
                approvedTerms: approvedTerms || [],
                seedAmbiguousTerms: improvement_cycle_core_1.CONTEXT_DEPENDENT_TERMS,
            });
            cached = { vocabulary, expiresAt: (params.now ? params.now() : Date.now()) + ttl };
            return vocabulary;
        }
        catch (err) {
            console.warn(`Canonical vocabulary unavailable; continuing without near-miss findings. (${err?.message || err})`);
            return null;
        }
        finally {
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
async function buildNearMissBriefing(menuText, params) {
    return (await buildNearMissAnalysis(menuText, params)).briefing;
}
async function buildNearMissAnalysis(menuText, params) {
    if (!isCanonicalVocabularyEnabled(params.env))
        return { findings: [], briefing: '' };
    if (!`${menuText || ''}`.trim())
        return { findings: [], briefing: '' };
    const vocabulary = await getCanonicalVocabulary(params);
    if (!vocabulary)
        return { findings: [], briefing: '' };
    try {
        const findings = (0, canonical_vocabulary_1.findNearMisses)(menuText, vocabulary);
        return { findings, briefing: (0, canonical_vocabulary_1.renderNearMissBriefing)(findings) };
    }
    catch (err) {
        console.warn(`Near-miss detection failed; continuing without it. (${err?.message || err})`);
        return { findings: [], briefing: '' };
    }
}

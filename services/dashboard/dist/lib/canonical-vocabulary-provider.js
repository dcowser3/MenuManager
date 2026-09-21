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
const canonical_policy_1 = require("./canonical-policy");
const improvement_cycle_core_1 = require("./improvement-cycle-core");
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const cached = new Map();
const inFlight = new Map();
const loaderIds = new WeakMap();
let nextLoaderId = 1;
let generation = 0;
function loaderId(fn) {
    if (!fn)
        return 0;
    if (!loaderIds.has(fn))
        loaderIds.set(fn, nextLoaderId++);
    return loaderIds.get(fn);
}
function isCanonicalVocabularyEnabled(env = process.env) {
    // Opt-out, not opt-in: the section is additive and omitted when there is nothing to say.
    return `${env.CANONICAL_VOCABULARY_ENABLED ?? 'true'}`.toLowerCase() !== 'false';
}
/** Drops the cache. Exported for tests and for the rule-approval path. */
function invalidateCanonicalVocabulary() {
    cached.clear();
    inFlight.clear();
    generation++;
}
async function getCanonicalVocabulary(params) {
    const now = params.now ? params.now() : Date.now();
    const key = (0, canonical_policy_1.policyHash)({ tenant: params.tenantId || 'default', property: params.property || '', template: params.templateType || 'food', menu: params.menuType || 'standard',
        policy: params.acceptedPolicyFingerprint || loaderId(params.fetchAcceptedRules),
        vocabulary: params.vocabularySnapshotHash || [loaderId(params.fetchApprovedTexts), loaderId(params.fetchApprovedTerms)] });
    const hit = cached.get(key);
    if (hit && hit.expiresAt > now)
        return hit.vocabulary;
    if (inFlight.has(key))
        return inFlight.get(key);
    const startedGeneration = generation;
    const ttl = params.ttlMs ?? DEFAULT_TTL_MS;
    const pending = (async () => {
        try {
            const [acceptedRules, approvedTexts, approvedTerms] = await Promise.all([
                params.fetchAcceptedRules(),
                params.fetchApprovedTexts ? params.fetchApprovedTexts() : Promise.resolve([]),
                params.fetchApprovedTerms ? params.fetchApprovedTerms() : Promise.resolve([]),
            ]);
            const vocabulary = (0, canonical_vocabulary_1.buildCanonicalVocabulary)({
                acceptedRules: (0, canonical_policy_1.resolveCanonicalPolicies)(acceptedRules || [], params).rules,
                approvedTexts: approvedTexts || [],
                approvedTerms: approvedTerms || [],
                seedAmbiguousTerms: improvement_cycle_core_1.CONTEXT_DEPENDENT_TERMS,
            });
            if (startedGeneration === generation) {
                if (cached.size >= 128)
                    cached.delete(cached.keys().next().value);
                cached.set(key, { vocabulary, expiresAt: (params.now ? params.now() : Date.now()) + ttl });
            }
            return vocabulary;
        }
        catch (err) {
            console.warn(`Canonical vocabulary unavailable; continuing without near-miss findings. (${err?.message || err})`);
            return null;
        }
        finally {
            if (startedGeneration === generation)
                inFlight.delete(key);
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
async function buildNearMissBriefing(menuText, params) {
    return (await buildNearMissAnalysis(menuText, params)).briefing;
}
async function buildNearMissAnalysis(menuText, params) {
    if (!isCanonicalVocabularyEnabled(params.env))
        return { findings: [], briefing: '', vocabulary: null };
    if (!`${menuText || ''}`.trim())
        return { findings: [], briefing: '', vocabulary: null };
    const vocabulary = await getCanonicalVocabulary(params);
    if (!vocabulary)
        return { findings: [], briefing: '', vocabulary: null };
    try {
        const findings = (0, canonical_vocabulary_1.findNearMisses)(menuText, vocabulary);
        return { findings, briefing: (0, canonical_vocabulary_1.renderNearMissBriefing)(findings), vocabulary };
    }
    catch (err) {
        console.warn(`Near-miss detection failed; continuing without it. (${err?.message || err})`);
        return { findings: [], briefing: '', vocabulary };
    }
}

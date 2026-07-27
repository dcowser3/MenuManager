"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_AMBIGUOUS_PAIRS = void 0;
exports.accentSensitiveKey = accentSensitiveKey;
exports.accentInsensitiveKey = accentInsensitiveKey;
exports.differsOnlyByAccent = differsOnlyByAccent;
exports.buildCanonicalVocabulary = buildCanonicalVocabulary;
exports.findNearMisses = findNearMisses;
exports.renderNearMissBriefing = renderNearMissBriefing;
/**
 * Canonical menu vocabulary + near-miss detection.
 *
 * The learned corpus grows one rule per typo: "st. germain" and "ste. germaine" each
 * needed their own row, and the next spelling of the same brand will need another. That
 * scales with (brands x typos) and never converges.
 *
 * This module inverts it. The vocabulary records the *correct* form of a term once, and
 * near-miss detection finds any spelling close to it — so the cost scales with brands
 * alone, and an unseen misspelling is caught the first time it appears.
 *
 * Findings are advisory. They are meant to be injected into the AI review's context so the
 * model adjudicates ("this line says X, which is one accent off canonical Y — verify"),
 * never applied as blind replacements. Deterministic code is good at edit distance and bad
 * at judgment; the model is the reverse.
 *
 * Ambiguity is derived, not declared: a term the corpus corrects in BOTH directions
 * ("rose" -> "rosé" for the wine, "rosé" -> "rose" for the flower) is context-dependent by
 * definition, and is reported as a question rather than a correction.
 */
const improvement_cycle_core_1 = require("./improvement-cycle-core");
/**
 * Pairs where BOTH forms are correct and only the dish decides which. These earn a
 * vocabulary entry even with no accepted rule behind them — a term nobody has written a
 * rule for is exactly the one the reviewer keeps having to explain by hand.
 * Order is irrelevant; both forms are reported to the model as equally valid.
 */
exports.KNOWN_AMBIGUOUS_PAIRS = [
    ['rosé', 'rose'],
    ['tartare', 'tartar'],
    ['berries', 'berry'],
];
const MIN_TERM_LENGTH = 4;
const MAX_CANONICAL_WORDS = 3;
const MAX_CANONICAL_CHARS = 40;
const DEFAULT_MIN_LEGITIMATE_OCCURRENCES = 5;
/** Lowercase, but KEEP accents — the whole point is telling "tequileno" from "tequileño". */
function accentSensitiveKey(value) {
    return `${value || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
}
/** Lowercase and fold accents/punctuation — for "are these the same word?" comparisons. */
function accentInsensitiveKey(value) {
    return `${value || ''}`
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[.\-_'’"\s]/g, '')
        .trim();
}
function isCanonicalShaped(text) {
    const value = `${text || ''}`.trim();
    return !!value
        && value.length >= MIN_TERM_LENGTH
        && value.length <= MAX_CANONICAL_CHARS
        && value.split(/\s+/).length <= MAX_CANONICAL_WORDS;
}
function stripDiacriticsOnly(value) {
    return `${value || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
/**
 * True when the two forms are the same word differing ONLY in accents.
 *
 * Deliberately does not use accentInsensitiveKey: that also folds punctuation, which makes
 * "titos"/"tito's" and "st germain"/"St-Germain" look like accent errors and produces a
 * message telling the reviewer to fix an accent that was never the problem.
 */
function differsOnlyByAccent(a, b) {
    if (!a || !b)
        return false;
    const left = accentSensitiveKey(a);
    const right = accentSensitiveKey(b);
    if (left === right)
        return false;
    return stripDiacriticsOnly(left) === stripDiacriticsOnly(right);
}
function buildCanonicalVocabulary(params) {
    const rules = (params.acceptedRules || []).filter((r) => r && r.original_text && r.corrected_text);
    // Direction index. Keys keep accents: folding them collapses "rose" and "rosé" to the
    // same token, which makes every accent rule look like its own reverse and marks all of
    // them ambiguous.
    const directions = new Set();
    for (const rule of rules) {
        directions.add(`${accentSensitiveKey(rule.original_text || '')}→${accentSensitiveKey(rule.corrected_text || '')}`);
    }
    const seedAmbiguous = new Set((params.seedAmbiguousTerms || []).map((t) => accentInsensitiveKey(t)));
    const byCanonical = new Map();
    for (const rule of rules) {
        const canonical = `${rule.corrected_text}`.trim();
        const variant = `${rule.original_text}`.trim();
        if (!isCanonicalShaped(canonical) || !isCanonicalShaped(variant))
            continue;
        const from = accentInsensitiveKey(variant);
        const to = accentInsensitiveKey(canonical);
        // Skip genuine no-ops only. Comparing folded keys here would discard every
        // punctuation-only rule ("st. germain" -> "St-Germain", "titos" -> "tito's"),
        // because folding strips exactly the character that the rule fixes.
        if (accentSensitiveKey(variant) === accentSensitiveKey(canonical))
            continue;
        // Corrected in both directions, or already known context-dependent.
        const ambiguous = directions.has(`${accentSensitiveKey(canonical)}→${accentSensitiveKey(variant)}`)
            || seedAmbiguous.has(to) || seedAmbiguous.has(from);
        const key = accentSensitiveKey(canonical);
        const existing = byCanonical.get(key);
        if (existing) {
            if (!existing.variants.includes(variant))
                existing.variants.push(variant);
            existing.ambiguous = existing.ambiguous || ambiguous;
            if (ambiguous && !existing.alternate)
                existing.alternate = variant;
            continue;
        }
        byCanonical.set(key, {
            canonical,
            variants: [variant],
            ambiguous,
            ...(ambiguous ? { alternate: variant } : {}),
        });
    }
    // Known both-valid pairs get an entry in both directions, so whichever form the menu
    // uses raises the same context question. An existing entry is upgraded, not replaced.
    for (const [left, right] of (params.ambiguousPairs ?? exports.KNOWN_AMBIGUOUS_PAIRS)) {
        for (const [canonical, alternate] of [[left, right], [right, left]]) {
            const key = accentSensitiveKey(canonical);
            const existing = byCanonical.get(key);
            if (existing) {
                existing.ambiguous = true;
                existing.alternate = existing.alternate || alternate;
                continue;
            }
            byCanonical.set(key, { canonical, variants: [alternate], ambiguous: true, alternate });
        }
    }
    // Legitimacy is accent-SENSITIVE: folding accents here would make the wrong form
    // ("tequileno") inherit the right form's frequency and silence every accent finding.
    const counts = new Map();
    for (const text of params.approvedTexts || []) {
        for (const token of `${text || ''}`.split(/[^\p{L}\p{N}'’]+/u)) {
            if (token.length < MIN_TERM_LENGTH)
                continue;
            const key = accentSensitiveKey(token);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    const threshold = params.minLegitimateOccurrences ?? DEFAULT_MIN_LEGITIMATE_OCCURRENCES;
    const legitimate = new Set();
    for (const [key, count] of counts) {
        if (count >= threshold)
            legitimate.add(key);
    }
    const entries = [...byCanonical.values()].sort((a, b) => a.canonical.localeCompare(b.canonical));
    return { entries, legitimate };
}
function gramsOf(text) {
    const words = `${text || ''}`.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
    const grams = [...words];
    for (let i = 0; i < words.length - 1; i++)
        grams.push(`${words[i]} ${words[i + 1]}`);
    return grams;
}
/**
 * One canonical form contained inside the other ("el tequileño" vs "tequileño") is an
 * article or modifier, not a misspelling.
 */
function isContainment(a, b) {
    const x = accentInsensitiveKey(a);
    const y = accentInsensitiveKey(b);
    return x !== y && (x.includes(y) || y.includes(x));
}
function findNearMisses(menuText, vocabulary, opts = {}) {
    const maxTypoDistance = opts.maxTypoDistance ?? 2;
    const findings = [];
    const reported = new Set();
    for (const gram of gramsOf(menuText)) {
        if (gram.length < MIN_TERM_LENGTH)
            continue;
        const gramSensitive = accentSensitiveKey(gram);
        const gramFolded = accentInsensitiveKey(gram);
        for (const entry of vocabulary.entries) {
            const canonicalSensitive = accentSensitiveKey(entry.canonical);
            if (gramSensitive === canonicalSensitive) {
                // Spelled like a canonical form — but if that form has a valid counterpart,
                // "matches the vocabulary" is not the same as "right for this dish".
                if (entry.ambiguous && entry.alternate) {
                    const dedupe = `${gramSensitive}|${accentSensitiveKey(entry.alternate)}`;
                    if (!reported.has(dedupe)) {
                        reported.add(dedupe);
                        findings.push({
                            found: gram,
                            canonical: entry.alternate,
                            kind: 'ambiguous',
                            distance: 0,
                            message: `"${gram}" and "${entry.alternate}" are both valid depending on context — decide from the dish, do not assume either spelling`,
                        });
                    }
                }
                break; // already a known form; nothing further to say
            }
            const knownVariant = entry.variants.some((v) => accentSensitiveKey(v) === gramSensitive);
            const accentOnly = differsOnlyByAccent(gram, entry.canonical);
            // A form frequent in approved menus is correct — unless the corpus explicitly
            // records it as a variant that reviewers correct.
            if (!knownVariant && vocabulary.legitimate.has(gramSensitive) && !accentOnly)
                continue;
            let kind = null;
            let distance = 0;
            let recorded = false;
            if (accentOnly) {
                kind = entry.ambiguous ? 'ambiguous' : 'diacritic';
            }
            else if (knownVariant) {
                kind = entry.ambiguous ? 'ambiguous' : 'typo';
                recorded = true;
            }
            else {
                if (isContainment(gram, entry.canonical))
                    continue;
                if (vocabulary.legitimate.has(gramSensitive))
                    continue;
                // Two edits on a short word is noise, not a misspelling: "lone"/"rose" and
                // "rosato"/"tomato" are both distance 2 and both wrong to flag.
                const budget = gramFolded.length >= 8 ? maxTypoDistance : 1;
                const d = (0, improvement_cycle_core_1.editDistanceAtMost)(gramFolded, accentInsensitiveKey(entry.canonical), budget);
                if (d >= 1 && d <= budget) {
                    kind = entry.ambiguous ? 'ambiguous' : 'typo';
                    distance = d;
                }
            }
            if (!kind)
                continue;
            const dedupe = `${gramSensitive}|${canonicalSensitive}`;
            if (reported.has(dedupe))
                break;
            reported.add(dedupe);
            findings.push({
                found: gram,
                canonical: entry.canonical,
                kind,
                distance,
                message: kind === 'ambiguous'
                    ? `"${gram}" and "${entry.canonical}" are both valid depending on context — decide from the dish, do not assume either spelling`
                    : kind === 'diacritic'
                        ? `"${gram}" is missing or misplacing the accent on canonical "${entry.canonical}"`
                        : recorded
                            ? `"${gram}" is a recorded misspelling of canonical "${entry.canonical}"`
                            : `"${gram}" is ${distance} edit(s) from canonical "${entry.canonical}"`,
            });
            break;
        }
    }
    // Ambiguous questions last: corrections are actionable, questions need judgment.
    const rank = { diacritic: 0, typo: 1, ambiguous: 2 };
    return findings.sort((a, b) => rank[a.kind] - rank[b.kind] || a.found.localeCompare(b.found));
}
/** Render findings for injection into the AI review prompt. */
function renderNearMissBriefing(findings) {
    if (!findings.length)
        return '';
    const lines = ['## Spelling suspicions from the canonical vocabulary', '',
        'Each line below is a deterministic near-miss against a known-correct term. Verify each against the dish context — apply the correction only when it is right, and ignore it when the menu is legitimately using a different word.', ''];
    for (const f of findings)
        lines.push(`- ${f.message}`);
    return lines.join('\n');
}

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
 * Findings are contextual. They are injected into the AI review so the model can adjudicate
 * them; if the model leaves a unique non-ambiguous finding untouched, the post-AI pipeline
 * turns it into a visible normal-severity suggestion. Database-only candidates are never
 * applied as blind replacements.
 *
 * Ambiguity is derived, not declared: a term the corpus corrects in BOTH directions
 * ("rose" -> "rosé" for the wine, "rosé" -> "rose" for the flower) is context-dependent by
 * definition, and is reported as a question rather than a correction.
 */
export type VocabularyEntry = {
    /** The correct form, accents and all. */
    canonical: string;
    /** Forms the corpus has corrected *to* the canonical. */
    variants: string[];
    /** True when the corpus corrects in both directions — context decides which is right. */
    ambiguous: boolean;
    /** The competing form, when ambiguous. */
    alternate?: string;
    source: 'reviewer_rule' | 'approved_corpus' | 'ambiguous_seed';
    occurrences?: number;
};

export type ApprovedVocabularyTerm = {
    term: string;
    count: number;
};

export type CanonicalVocabulary = {
    entries: VocabularyEntry[];
    /** Accent-SENSITIVE forms seen in a human-approved menu; protects rare valid terms. */
    legitimate: Set<string>;
};

export type NearMissFinding = {
    /** The text as it appears in the menu. */
    found: string;
    canonical: string;
    kind: 'diacritic' | 'typo' | 'ambiguous';
    distance: number;
    message: string;
    source: VocabularyEntry['source'];
    confidence: 'high' | 'medium';
};

/**
 * Pairs where BOTH forms are correct and only the dish decides which. These earn a
 * vocabulary entry even with no accepted rule behind them — a term nobody has written a
 * rule for is exactly the one the reviewer keeps having to explain by hand.
 * Order is irrelevant; both forms are reported to the model as equally valid.
 */
export const KNOWN_AMBIGUOUS_PAIRS: Array<[string, string]> = [
    ['rosé', 'rose'],
    ['tartare', 'tartar'],
    ['berries', 'berry'],
];

const MIN_TERM_LENGTH = 4;
const MAX_CANONICAL_WORDS = 3;
const MAX_CANONICAL_CHARS = 40;
const DEFAULT_MIN_LEGITIMATE_OCCURRENCES = 1;
const DEFAULT_MIN_CORPUS_CANONICAL_OCCURRENCES = 5;
const CORPUS_STOPWORDS = new Set([
    'about', 'after', 'again', 'against', 'along', 'also', 'among', 'and', 'another',
    'before', 'between', 'both', 'chef', 'choice', 'choose', 'each', 'from', 'house',
    'into', 'made', 'menu', 'more', 'other', 'over', 'served', 'style', 'than', 'that',
    'their', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under',
    'with', 'without', 'your',
]);

/** Lowercase, but KEEP accents — the whole point is telling "tequileno" from "tequileño". */
export function accentSensitiveKey(value: string): string {
    return `${value || ''}`.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lowercase and fold accents/punctuation — for "are these the same word?" comparisons. */
export function accentInsensitiveKey(value: string): string {
    return `${value || ''}`
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[.\-_'’"\s]/g, '')
        .trim();
}

function isCanonicalShaped(text: string): boolean {
    const value = `${text || ''}`.trim();
    return !!value
        && value.length >= MIN_TERM_LENGTH
        && value.length <= MAX_CANONICAL_CHARS
        && value.split(/\s+/).length <= MAX_CANONICAL_WORDS;
}

function stripDiacriticsOnly(value: string): string {
    return `${value || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * True when the two forms are the same word differing ONLY in accents.
 *
 * Deliberately does not use accentInsensitiveKey: that also folds punctuation, which makes
 * "titos"/"tito's" and "st germain"/"St-Germain" look like accent errors and produces a
 * message telling the reviewer to fix an accent that was never the problem.
 */
export function differsOnlyByAccent(a: string, b: string): boolean {
    if (!a || !b) return false;
    const left = accentSensitiveKey(a);
    const right = accentSensitiveKey(b);
    if (left === right) return false;
    return stripDiacriticsOnly(left) === stripDiacriticsOnly(right);
}

export function buildCanonicalVocabulary(params: {
    acceptedRules: Array<{ original_text?: string | null; corrected_text?: string | null }>;
    /** Human-approved menu text — the source of "this form is fine, never flag it". */
    approvedTexts?: string[];
    approvedTerms?: ApprovedVocabularyTerm[];
    minLegitimateOccurrences?: number;
    minCorpusCanonicalOccurrences?: number;
    /** Terms already known to be context-dependent; seeds ambiguity before evidence exists. */
    seedAmbiguousTerms?: string[];
    /** Both-forms-valid pairs to guarantee an entry for. Defaults to KNOWN_AMBIGUOUS_PAIRS. */
    ambiguousPairs?: Array<[string, string]>;
}): CanonicalVocabulary {
    const rules = (params.acceptedRules || []).filter((r) => r && r.original_text && r.corrected_text);

    // Direction index. Keys keep accents: folding them collapses "rose" and "rosé" to the
    // same token, which makes every accent rule look like its own reverse and marks all of
    // them ambiguous.
    const directions = new Set<string>();
    for (const rule of rules) {
        directions.add(`${accentSensitiveKey(rule.original_text || '')}→${accentSensitiveKey(rule.corrected_text || '')}`);
    }

    const seedAmbiguous = new Set((params.seedAmbiguousTerms || []).map((t) => accentInsensitiveKey(t)));
    const byCanonical = new Map<string, VocabularyEntry>();

    for (const rule of rules) {
        const canonical = `${rule.corrected_text}`.trim();
        const variant = `${rule.original_text}`.trim();
        if (!isCanonicalShaped(canonical) || !isCanonicalShaped(variant)) continue;

        const from = accentInsensitiveKey(variant);
        const to = accentInsensitiveKey(canonical);
        // Skip genuine no-ops only. Comparing folded keys here would discard every
        // punctuation-only rule ("st. germain" -> "St-Germain", "titos" -> "tito's"),
        // because folding strips exactly the character that the rule fixes.
        if (accentSensitiveKey(variant) === accentSensitiveKey(canonical)) continue;

        // Corrected in both directions, or already known context-dependent.
        const ambiguous = directions.has(`${accentSensitiveKey(canonical)}→${accentSensitiveKey(variant)}`)
            || seedAmbiguous.has(to) || seedAmbiguous.has(from);

        const key = accentSensitiveKey(canonical);
        const existing = byCanonical.get(key);
        if (existing) {
            if (!existing.variants.includes(variant)) existing.variants.push(variant);
            existing.ambiguous = existing.ambiguous || ambiguous;
            if (ambiguous && !existing.alternate) existing.alternate = variant;
            continue;
        }
        byCanonical.set(key, {
            canonical,
            variants: [variant],
            ambiguous,
            source: 'reviewer_rule',
            ...(ambiguous ? { alternate: variant } : {}),
        });
    }

    // Known both-valid pairs get an entry in both directions, so whichever form the menu
    // uses raises the same context question. An existing entry is upgraded, not replaced.
    for (const [left, right] of (params.ambiguousPairs ?? KNOWN_AMBIGUOUS_PAIRS)) {
        for (const [canonical, alternate] of [[left, right], [right, left]] as Array<[string, string]>) {
            const key = accentSensitiveKey(canonical);
            const existing = byCanonical.get(key);
            if (existing) {
                existing.ambiguous = true;
                existing.alternate = existing.alternate || alternate;
                continue;
            }
            byCanonical.set(key, {
                canonical,
                variants: [alternate],
                ambiguous: true,
                alternate,
                source: 'ambiguous_seed',
            });
        }
    }

    // Legitimacy is accent-SENSITIVE: folding accents here would make the wrong form
    // ("tequileno") inherit the right form's frequency and silence every accent finding.
    const counts = new Map<string, number>();
    for (const text of params.approvedTexts || []) {
        for (const token of `${text || ''}`.split(/[^\p{L}\p{N}'’]+/u)) {
            if (token.length < MIN_TERM_LENGTH) continue;
            const key = accentSensitiveKey(token);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    for (const item of params.approvedTerms || []) {
        const term = accentSensitiveKey(item?.term || '');
        const count = Number(item?.count || 0);
        if (!term || !Number.isFinite(count) || count <= 0) continue;
        counts.set(term, (counts.get(term) || 0) + count);
    }
    const threshold = params.minLegitimateOccurrences ?? DEFAULT_MIN_LEGITIMATE_OCCURRENCES;
    const legitimate = new Set<string>();
    for (const [key, count] of counts) {
        if (count >= threshold) legitimate.add(key);
    }

    // Frequent words from human-approved dish names and descriptions become
    // candidate spellings. They remain advisory: unlike reviewer-rule entries,
    // a corpus word is never blindly applied because menus contain proper names
    // and multiple languages. It can still guarantee a visible review item when
    // the model leaves a unique near miss unresolved.
    const corpusThreshold = params.minCorpusCanonicalOccurrences
        ?? DEFAULT_MIN_CORPUS_CANONICAL_OCCURRENCES;
    for (const [term, count] of counts) {
        if (
            count < corpusThreshold
            || CORPUS_STOPWORDS.has(term)
            || !isCanonicalShaped(term)
            || term.includes(' ')
            || byCanonical.has(term)
        ) continue;
        byCanonical.set(term, {
            canonical: term,
            variants: [],
            ambiguous: false,
            source: 'approved_corpus',
            occurrences: count,
        });
    }

    const entries = [...byCanonical.values()].sort((a, b) => a.canonical.localeCompare(b.canonical));
    return { entries, legitimate };
}

function gramsOf(text: string): string[] {
    const words = `${text || ''}`.normalize('NFC').split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
    const grams = [...words];
    for (let i = 0; i < words.length - 1; i++) grams.push(`${words[i]} ${words[i + 1]}`);
    return grams;
}

/**
 * One canonical form contained inside the other ("el tequileño" vs "tequileño") is an
 * article or modifier, not a misspelling.
 */
function isContainment(a: string, b: string): boolean {
    const x = accentInsensitiveKey(a);
    const y = accentInsensitiveKey(b);
    return x !== y && (x.includes(y) || y.includes(x));
}

function damerauDistanceAtMost(left: string, right: string, maxDistance: number): number {
    if (left === right) return 0;
    if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
    const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;
    for (let i = 1; i <= left.length; i += 1) {
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
            if (
                i > 1
                && j > 1
                && left[i - 1] === right[j - 2]
                && left[i - 2] === right[j - 1]
            ) {
                matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
            }
        }
    }
    const distance = matrix[left.length][right.length];
    return distance <= maxDistance ? distance : maxDistance + 1;
}

export function findNearMisses(
    menuText: string,
    vocabulary: CanonicalVocabulary,
    opts: { maxTypoDistance?: number } = {}
): NearMissFinding[] {
    const maxTypoDistance = opts.maxTypoDistance ?? 2;
    const findings: NearMissFinding[] = [];
    const reported = new Set<string>();
    const exactEntries = new Map<string, VocabularyEntry>();
    const variantEntries = new Map<string, VocabularyEntry[]>();
    const entriesByFoldedLength = new Map<number, VocabularyEntry[]>();
    for (const entry of vocabulary.entries) {
        exactEntries.set(accentSensitiveKey(entry.canonical), entry);
        const length = accentInsensitiveKey(entry.canonical).length;
        entriesByFoldedLength.set(length, [...(entriesByFoldedLength.get(length) || []), entry]);
        for (const variant of entry.variants) {
            const key = accentSensitiveKey(variant);
            variantEntries.set(key, [...(variantEntries.get(key) || []), entry]);
        }
    }

    for (const gram of gramsOf(menuText)) {
        if (gram.length < MIN_TERM_LENGTH) continue;
        const gramSensitive = accentSensitiveKey(gram);
        const gramFolded = accentInsensitiveKey(gram);

        const exact = exactEntries.get(gramSensitive);
        if (exact) {
            if (exact.ambiguous && exact.alternate) {
                const dedupe = `${gramSensitive}|${accentSensitiveKey(exact.alternate)}`;
                if (!reported.has(dedupe)) {
                    reported.add(dedupe);
                    findings.push({
                        found: gram,
                        canonical: exact.alternate,
                        kind: 'ambiguous',
                        distance: 0,
                        source: exact.source,
                        confidence: 'medium',
                        message: `"${gram}" and "${exact.alternate}" are both valid depending on context — decide from the dish, do not assume either spelling`,
                    });
                }
            }
            continue;
        }

        type Candidate = {
            entry: VocabularyEntry;
            kind: NearMissFinding['kind'];
            distance: number;
            recorded: boolean;
            rank: number;
        };
        const candidates: Candidate[] = [];
        const budget = gramFolded.length >= 8 ? maxTypoDistance : 1;
        const candidateEntries = new Set<VocabularyEntry>(variantEntries.get(gramSensitive) || []);
        for (let length = Math.max(1, gramFolded.length - budget); length <= gramFolded.length + budget; length += 1) {
            for (const entry of entriesByFoldedLength.get(length) || []) candidateEntries.add(entry);
        }
        for (const entry of candidateEntries) {
            const knownVariant = (variantEntries.get(gramSensitive) || []).includes(entry);
            const accentOnly = differsOnlyByAccent(gram, entry.canonical);
            if (entry.source === 'approved_corpus' && vocabulary.legitimate.has(gramSensitive)) continue;
            if (!knownVariant && vocabulary.legitimate.has(gramSensitive) && !accentOnly) continue;

            if (accentOnly) {
                candidates.push({
                    entry,
                    kind: entry.ambiguous ? 'ambiguous' : 'diacritic',
                    distance: 0,
                    recorded: false,
                    rank: entry.source === 'reviewer_rule' ? 1 : 2,
                });
                continue;
            }
            if (knownVariant) {
                candidates.push({
                    entry,
                    kind: entry.ambiguous ? 'ambiguous' : 'typo',
                    distance: 0,
                    recorded: true,
                    rank: 0,
                });
                continue;
            }
            if (isContainment(gram, entry.canonical) || vocabulary.legitimate.has(gramSensitive)) continue;
            if (entry.source === 'approved_corpus' && (gram.includes(' ') || entry.canonical.includes(' '))) continue;
            if (entry.source === 'approved_corpus' && !/^\p{L}+(?:['’]\p{L}+)?$/u.test(gram)) continue;
            if (entry.source === 'approved_corpus' && gramFolded.length < 6) continue;
            if (
                entry.source === 'approved_corpus'
                && (
                    gramFolded[0] !== accentInsensitiveKey(entry.canonical)[0]
                    || gramFolded.at(-1) !== accentInsensitiveKey(entry.canonical).at(-1)
                )
            ) continue;

            // Two edits on a short word is noise. Adjacent transpositions count
            // as one edit, so FUGEO can match approved FUEGO without opening the
            // short-word budget to unrelated pairs such as Lone/Rose.
            const distance = damerauDistanceAtMost(
                gramFolded,
                accentInsensitiveKey(entry.canonical),
                budget
            );
            if (distance < 1 || distance > budget) continue;
            candidates.push({
                entry,
                kind: entry.ambiguous ? 'ambiguous' : 'typo',
                distance,
                recorded: false,
                rank: 3 + distance + (entry.source === 'approved_corpus' ? 1 : 0),
            });
        }

        candidates.sort((a, b) => (
            a.rank - b.rank
            || a.distance - b.distance
            || (b.entry.occurrences || 0) - (a.entry.occurrences || 0)
            || a.entry.canonical.localeCompare(b.entry.canonical)
        ));
        const best = candidates[0];
        if (!best) continue;
        const runnerUp = candidates[1];
        if (
            runnerUp
            && runnerUp.rank === best.rank
            && runnerUp.distance === best.distance
            && accentSensitiveKey(runnerUp.entry.canonical) !== accentSensitiveKey(best.entry.canonical)
        ) {
            continue;
        }

        const canonicalSensitive = accentSensitiveKey(best.entry.canonical);
        const dedupe = `${gramSensitive}|${canonicalSensitive}`;
        if (reported.has(dedupe)) continue;
        reported.add(dedupe);
        findings.push({
            found: gram,
            canonical: best.entry.canonical,
            kind: best.kind,
            distance: best.distance,
            source: best.entry.source,
            confidence: best.entry.source === 'reviewer_rule' && best.kind !== 'ambiguous' ? 'high' : 'medium',
            message: best.kind === 'ambiguous'
                ? `"${gram}" and "${best.entry.canonical}" are both valid depending on context — decide from the dish, do not assume either spelling`
                : best.kind === 'diacritic'
                    ? `"${gram}" is missing or misplacing the accent on canonical "${best.entry.canonical}"`
                    : best.recorded
                        ? `"${gram}" is a recorded misspelling of canonical "${best.entry.canonical}"`
                        : best.entry.source === 'approved_corpus'
                            ? `"${gram}" is ${best.distance} edit(s) from approved-menu word "${best.entry.canonical}"`
                            : `"${gram}" is ${best.distance} edit(s) from canonical "${best.entry.canonical}"`,
        });
    }

    // Ambiguous questions last: corrections are actionable, questions need judgment.
    const rank = { diacritic: 0, typo: 1, ambiguous: 2 };
    return findings.sort((a, b) => rank[a.kind] - rank[b.kind] || a.found.localeCompare(b.found));
}

/** Render findings for injection into the AI review prompt. */
export function renderNearMissBriefing(findings: NearMissFinding[]): string {
    if (!findings.length) return '';
    const lines = ['## Spelling suspicions from the canonical vocabulary', '',
        'Each line below is a deterministic near-miss against reviewer-confirmed terminology or words repeatedly used in approved menus. For every non-ambiguous line, use the surrounding menu context to either apply the correction or return a medium-confidence Spelling suggestion. Do not silently ignore a suspected non-word. Ambiguous lines are questions only and must never be auto-corrected.', ''];
    for (const f of findings) lines.push(`- ${f.message}`);
    return lines.join('\n');
}

type SpellingSuggestionShape = {
    type?: string;
    confidence?: string;
    severity?: string;
    menuItem?: string;
    description?: string;
    recommendation?: string;
};

function lineContainingToken(menuText: string, token: string): string | null {
    const wanted = accentSensitiveKey(token);
    for (const line of `${menuText || ''}`.split('\n')) {
        const words = line.match(/\p{L}+(?:['’]\p{L}+)?/gu) || [];
        if (words.some((word) => accentSensitiveKey(word) === wanted)) return line.trim();
    }
    return null;
}

/**
 * The model gets first chance to use menu context. If it leaves a unique
 * non-ambiguous corpus near miss untouched and does not mention it, synthesize
 * a visible normal-severity review item so a suspected typo cannot disappear.
 */
export function ensureCanonicalSpellingSuggestions<T extends SpellingSuggestionShape>(
    correctedMenu: string,
    suggestions: T[],
    findings: NearMissFinding[]
): Array<T | SpellingSuggestionShape> {
    const output: Array<T | SpellingSuggestionShape> = [...(suggestions || [])];
    for (const finding of findings || []) {
        if (finding.kind === 'ambiguous') continue;
        const menuItem = lineContainingToken(correctedMenu, finding.found);
        if (!menuItem) continue; // The model or deterministic pass already fixed it.

        const alreadyReported = output.some((suggestion) => {
            const text = [
                suggestion.menuItem,
                suggestion.description,
                suggestion.recommendation,
            ].join(' ').toLowerCase();
            return text.includes(finding.found.toLowerCase())
                || text.includes(finding.canonical.toLowerCase());
        });
        if (alreadyReported) continue;

        output.push({
            type: finding.kind === 'diacritic' ? 'Diacritics' : 'Spelling',
            confidence: 'medium',
            severity: 'normal',
            menuItem,
            description: `"${finding.found}" looks misspelled in this menu context; the closest established menu word is "${finding.canonical}".`,
            recommendation: `Verify the intended term and, if correct, change "${finding.found}" to "${finding.canonical}".`,
        });
    }
    return output;
}

// Post-AI review pipeline: response parsing, severity normalization, guard-chain
// orchestration, and critical-suggestion reconciliation. Extracted verbatim from
// services/dashboard/index.ts handleBasicCheck so the production route and the
// offline eval harness run the SAME code.

import {
    AcceptedCorrectionRule,
    PreAiDeterministicResult,
    runPreAiDeterministicChecks,
} from './pre-ai-deterministic-rules';
import { MenuTitleGuardResult, preserveLeadingMenuTitle } from './menu-title-guard';
import { CorrectedMenuStructureGuardResult, assessCorrectedMenuStructure } from './corrected-menu-structure-guard';
import { guardAllergenAlphabetizationSuggestions } from './allergen-suggestion-guard';
import { reconcileAllergenDeliveryClaims } from './allergen-delivery-reconciliation';
import { preserveSubmittedAllergenCodes } from './allergen-source-preservation';
import { applyHighConfidenceSuggestionsToMenu } from './apply-high-confidence-suggestions';
import {
    EmbeddedSetMenuAnalysis,
    analyzeEmbeddedSetMenus,
    guardEmbeddedSetMenuPrices,
} from './embedded-set-menu-guard';
import { guardCorrectedMenuPrices } from './price-integrity-guard';
import { RAW_NOTICE_PATTERN, isGenericMissingCanonicalRawNoticeFinding, normalizeMenuFooter, stripManagedFooterText } from './menu-footer';
import { QaPromptSectionId, buildFinalPrompt } from './qa-prompt-builder';
import { buildNearMissAnalysis } from './canonical-vocabulary-provider';
import {
    ApprovedVocabularyTerm,
    NearMissFinding,
    SpellingAdjudication,
    adjudicateCanonicalSpellingFindings,
} from './canonical-vocabulary';
import { getTenantConfig } from '@menumanager/tenant-config';
import { policyHash } from './canonical-policy';
import { reviewContextOptions } from './review-context';
import { attributeCorrectedBlock, boundedMutationDiagnostics, freezeReviewEnvelope, REVIEW_ENGINE_VERSION } from './review-envelope';
import { AI_REVIEW_FENCES } from './review-response-contract';
import { ProtectedTermGuardResult, restoreProtectedTerms } from './protected-terms-guard';

export type ReviewSuggestion = {
    type?: string;
    confidence?: string;
    severity?: string;
    menuItem?: string;
    description?: string;
    recommendation?: string;
    spellingFindingId?: string;
    spellingDisposition?: string;
    sourceToken?: string;
    suggestedReplacement?: string;
};

export type ParsedAiResponse = {
    correctedMenu: string;
    /** True when the model omitted the corrected-menu response fence and the parser used the fail-safe input echo. */
    fenceMissing: boolean;
    suggestions: Array<{
        type: string;
        confidence: string;
        severity?: string;
        menuItem: string;
        description: string;
        recommendation: string;
    }>;
};

// Suggestion types forced to critical severity in parseAIResponse (layer 2 of
// critical-error blocking). Exported as data so the review-rules manifest can
// enumerate them without re-reading the implementation.
export const FORCED_CRITICAL_EXACT_TYPES = ['Missing Price', 'Incomplete Dish Name'] as const;
export const FORCED_CRITICAL_NORMALIZED_TYPES = ['set menu item price', 'course progression', 'pricing structure'] as const;
export const FORCED_CRITICAL_HIGH_CONFIDENCE_TYPES = ['unrecognized term'] as const;

const STRING_SUGGESTION_DEFAULTS = {
    type: 'General Review Note',
    confidence: 'medium',
    severity: 'normal',
    menuItem: '',
    recommendation: '',
} as const;

// The model occasionally emits a bare string in the suggestions array. Normalize
// it here, at the response boundary, so every downstream guard can rely on the
// canonical object shape instead of failing while assigning severity.
function normalizeSuggestionShape(suggestion: unknown): ReviewSuggestion | null {
    if (typeof suggestion === 'string') {
        return { ...STRING_SUGGESTION_DEFAULTS, description: suggestion };
    }
    if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion)) {
        return null;
    }
    const raw = suggestion as Record<string, unknown>;
    return {
        ...raw,
        type: `${raw.type || ''}`,
        confidence: `${raw.confidence || ''}`,
        severity: raw.severity ? `${raw.severity}` : undefined,
        menuItem: `${raw.menuItem || ''}`,
        description: `${raw.description || ''}`,
        recommendation: `${raw.recommendation || ''}`,
    };
}

export function stripDiacritics(input: string): string {
    return (input || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeForSuggestionMatch(input: string): string {
    return stripDiacritics(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function looksLikePriceOnLine(line: string): boolean {
    const compact = (line || '').trim();
    // Handles "... - 8", "... 14", "... $12", "... 12.50"
    return /(?:^|[\s\-|])\$?\d{1,3}(?:[.,]\d{1,2})?\s*$/.test(compact);
}

function isLikelyContinuationLine(previousLine: string, nextLine: string): boolean {
    const previous = (previousLine || '').trim();
    const next = (nextLine || '').trim();
    if (!previous || !next) return false;
    if (/^[A-Z][A-Za-zÀ-ÖØ-öø-ÿ\s&'’-]{1,40}$/.test(next) && !next.includes(',')) {
        return false;
    }
    if (/^[A-ZÀ-ÖØ-Þ0-9][^,\n]{1,80},/.test(next)) {
        return false;
    }
    if (/[,:;/&-]\s*$/.test(previous)) {
        return true;
    }
    return /^[a-zà-öø-ÿ]/.test(next);
}

function extendLineWithContinuations(lines: string[], startIndex: number): string {
    let combined = lines[startIndex] || '';
    for (let i = startIndex + 1; i < Math.min(lines.length, startIndex + 3); i++) {
        if (!isLikelyContinuationLine(combined, lines[i])) {
            break;
        }
        combined = `${combined.trimEnd()} ${lines[i].trim()}`;
        if (looksLikePriceOnLine(combined)) {
            break;
        }
    }
    return combined;
}

export function findCorrectedLineForMenuItem(correctedMenu: string, menuItem: string): string | null {
    const itemNorm = normalizeForSuggestionMatch(menuItem || '');
    if (!itemNorm) return null;
    const itemVariants = new Set<string>([itemNorm]);
    const addOnMatch = itemNorm.match(/^(?:add|enhance|extra)\s+(.+)$/);
    if (addOnMatch && addOnMatch[1]) {
        itemVariants.add(addOnMatch[1].trim());
    }

    const lines = (correctedMenu || '').split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNorm = normalizeForSuggestionMatch(line);
        if ([...itemVariants].some((variant) => variant && lineNorm.includes(variant))) {
            return extendLineWithContinuations(lines, i);
        }
    }
    return null;
}

function isLikelySelectionInstructionLine(line: string): boolean {
    const compact = (line || '').trim();
    if (!compact || compact.length > 100) return false;
    if (/[,.]/.test(compact)) return false;

    const normalized = normalizeForSuggestionMatch(compact);
    if (!normalized) return false;

    const countWord = '(?:one|two|three|four|five|six|seven|eight|nine|ten|[1-9][0-9]?)';
    const optionWord = '(?:appetizer|starter|entree|main|dessert|side|protein|course|dish|item|option|selection)s?';
    const numberedInstructionPatterns = [
        new RegExp(`^(?:please )?(?:choose|select|pick) (?:any |up to |one of |your )?${countWord}\\b(?: .*)?$`),
        new RegExp(`^(?:your )?choice of (?:any )?${countWord}\\b(?: .*)?$`),
    ];
    const optionInstructionPatterns = [
        new RegExp(`^(?:please )?(?:choose|select|pick) (?:your )?${optionWord}$`),
        new RegExp(`^(?:your )?choice of ${optionWord}$`),
    ];

    return [...numberedInstructionPatterns, ...optionInstructionPatterns].some((pattern) => pattern.test(normalized));
}

function isIncompleteDishNameSelectionInstructionFalsePositive(
    suggestion: { type?: string; menuItem?: string },
    correctedMenu: string
): { matchedLine: string } | null {
    const type = (suggestion.type || '').toLowerCase();
    if (!type.includes('incomplete dish name')) return null;

    const menuItem = suggestion.menuItem || '';
    const line = findCorrectedLineForMenuItem(correctedMenu, menuItem);
    if (!line) return null;
    if (!isLikelySelectionInstructionLine(line)) return null;

    const itemNorm = normalizeForSuggestionMatch(menuItem);
    const lineNorm = normalizeForSuggestionMatch(line);
    if (itemNorm !== lineNorm && !isLikelySelectionInstructionLine(menuItem)) {
        return null;
    }

    return { matchedLine: line };
}

export function isCriticalResolvedByCorrectedMenu(
    suggestion: { type?: string; menuItem?: string; description?: string; recommendation?: string },
    correctedMenu: string
): boolean {
    const type = (suggestion.type || '').toLowerCase();
    const line = findCorrectedLineForMenuItem(correctedMenu, suggestion.menuItem || '');
    if (!line) return false;

    if (type.includes('missing price')) {
        return looksLikePriceOnLine(line);
    }

    if (type.includes('incomplete dish name')) {
        const itemNorm = normalizeForSuggestionMatch(suggestion.menuItem || '');
        const lineNorm = normalizeForSuggestionMatch(line);
        const remainder = lineNorm.replace(itemNorm, '').trim();

        if (remainder.length >= 6) {
            return true;
        }

        // If AI explicitly referenced a malformed token and it's now gone, treat as resolved.
        const combined = `${suggestion.description || ''} ${suggestion.recommendation || ''}`;
        const quotedTokenMatch = combined.match(/['"]([^'"]{2,30})['"]/);
        if (quotedTokenMatch && quotedTokenMatch[1]) {
            const tokenNorm = normalizeForSuggestionMatch(quotedTokenMatch[1]);
            if (tokenNorm && !lineNorm.includes(tokenNorm)) {
                return true;
            }
        }
    }

    return false;
}

export function reconcileCriticalSuggestionsAgainstCorrectedMenu(
    correctedMenu: string,
    suggestions: ReviewSuggestion[]
): ReviewSuggestion[] {
    return reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics(correctedMenu, suggestions).suggestions;
}

export function reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics(
    correctedMenu: string,
    suggestions: ReviewSuggestion[]
): {
    suggestions: ReviewSuggestion[];
    droppedSuggestions: Array<{
        suggestion: ReviewSuggestion;
        reason: string;
        matchedLine: string | null;
    }>;
} {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return { suggestions: [], droppedSuggestions: [] };
    }

    const kept: ReviewSuggestion[] = [];
    const droppedSuggestions: Array<{
        suggestion: ReviewSuggestion;
        reason: string;
        matchedLine: string | null;
    }> = [];

    for (const s of suggestions) {
        if (s.severity !== 'critical') {
            kept.push(s);
            continue;
        }
        const selectionInstructionFalsePositive = isIncompleteDishNameSelectionInstructionFalsePositive(s, correctedMenu);
        if (selectionInstructionFalsePositive) {
            droppedSuggestions.push({
                suggestion: s,
                reason: 'critical_false_positive_selection_instruction',
                matchedLine: selectionInstructionFalsePositive.matchedLine,
            });
            continue;
        }
        if (isCriticalResolvedByCorrectedMenu(s, correctedMenu)) {
            droppedSuggestions.push({
                suggestion: s,
                reason: 'critical_resolved_in_corrected_menu',
                matchedLine: findCorrectedLineForMenuItem(correctedMenu, s.menuItem || ''),
            });
            continue;
        }
        kept.push(s);
    }

    return { suggestions: kept, droppedSuggestions };
}

export interface TopLevelPrixFixePriceEvidence {
    found: boolean;
    matchedLine?: string;
    matchedLineIndex?: number;
    matchedToken?: string;
    reason?: string;
}

const PRICE_AMOUNT = String.raw`\d{1,4}(?:[.,]\d{1,2})?`;
const EXPLICIT_PRICE_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
    { reason: 'per_person_marker', pattern: new RegExp(`\\b(${PRICE_AMOUNT})\\s*(?:pp\\b|per\\s+person\\b)`, 'i') },
    { reason: 'currency_symbol', pattern: new RegExp(`([$€£])\\s*(${PRICE_AMOUNT})\\b`, 'i') },
    { reason: 'currency_code', pattern: new RegExp(`\\b(?:(${PRICE_AMOUNT})\\s*(AED|USD|EUR|GBP|CAD|AUD)|(AED|USD|EUR|GBP|CAD|AUD)\\s*(${PRICE_AMOUNT}))\\b`, 'i') },
    { reason: 'wine_pairing', pattern: new RegExp(`\\b(${PRICE_AMOUNT})\\s*(?:\\|\\s*)?(?:wine|beverage|alcohol)\\s+pairing\\b`, 'i') },
];
const PACKAGE_PRICE_CONTEXT = /\b(?:prix\s*fixe|bottomless|set\s+menu|selection\s+per\s+course|choice(?:\s+one)?\s+selection\s+per\s+course|choice\s+per\s+course|omakase|package)\b/i;
const STANDALONE_PRICE = new RegExp(`^\\s*([$€£]?${PRICE_AMOUNT})(?:\\s*(?:pp|per\\s+person))?\\s*$`, 'i');
const NUMERIC_TOKEN = new RegExp(`\\b${PRICE_AMOUNT}\\b`, 'g');

export function detectTopLevelPrixFixePrice(menuContent: string): TopLevelPrixFixePriceEvidence {
    const topWindow = (menuContent || '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5);

    for (let lineIndex = 0; lineIndex < topWindow.length; lineIndex += 1) {
        const line = topWindow[lineIndex];
        for (const { reason, pattern } of EXPLICIT_PRICE_PATTERNS) {
            const match = line.match(pattern);
            if (match) {
                return { found: true, matchedLine: line, matchedLineIndex: lineIndex, matchedToken: match[0], reason };
            }
        }

        const standaloneMatch = line.match(STANDALONE_PRICE);
        if (standaloneMatch && !/\b(?:19|20)\d{2}\b/.test(line)) {
            return { found: true, matchedLine: line, matchedLineIndex: lineIndex, matchedToken: standaloneMatch[1], reason: 'standalone_price' };
        }

        if (!PACKAGE_PRICE_CONTEXT.test(line) || /,.*,.+\b\d{1,4}(?:[.,]\d{1,2})?\s*$/.test(line)) continue;

        for (const match of line.matchAll(NUMERIC_TOKEN)) {
            const token = match[0];
            const start = match.index || 0;
            const before = line.slice(Math.max(0, start - 12), start);
            const after = line.slice(start + token.length, start + token.length + 16);
            if (/\b(?:19|20)\d{2}\b/.test(token)) continue;
            if (/\d:\s*$/.test(before) || /^\s*:\d/.test(after)) continue;
            if (/^\s*(?:-|\s)*(?:hours?|hrs?|minutes?|mins?)\b/i.test(after)) continue;
            if (/^\s*(?:courses?|course)\b/i.test(after)) continue;
            return { found: true, matchedLine: line, matchedLineIndex: lineIndex, matchedToken: token, reason: 'package_context' };
        }
    }

    return { found: false, reason: 'no_price_evidence_in_first_five_non_empty_lines' };
}

export function enforcePrixFixeCriticalChecks(
    menuContent: string,
    suggestions: ReviewSuggestion[]
): ReviewSuggestion[] {
    const existing = [...(suggestions || [])];
    const nonEmptyLines = (menuContent || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const priceEvidence = detectTopLevelPrixFixePrice(menuContent);
    const hasTopPrixFixePrice = priceEvidence.found;

    const headingPattern = /\b(appetizers?|starters?|specialties|mains?|entrees?|desserts?|first course|second course|third course|course)\b/i;
    const headingIndexes = nonEmptyLines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => headingPattern.test(line));

    const hasCourseHeadings = headingIndexes.length >= 2;
    let missingCourseNumbers = false;
    if (hasCourseHeadings) {
        missingCourseNumbers = headingIndexes.some(({ idx, line }) => {
            const thisLineNumbered = /^\d+\b/.test(line);
            const prevLine = idx > 0 ? nonEmptyLines[idx - 1] : '';
            const prevLineNumberOnly = /^\d+$/.test(prevLine);
            return !(thisLineNumbered || prevLineNumberOnly);
        });
    }

    const isTopPriceSuggestion = (s: ReviewSuggestion) => {
        const type = `${s.type || ''}`.toLowerCase();
        const combined = `${type} ${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
        return type === 'pricing structure' && /(?:overall|package|prix\s*fixe|top(?:-level)?).*price|price.*(?:top|prix\s*fixe|package)/.test(combined)
            || /prix\s*fixe/.test(combined) && /price.*top|top.*price|single.*price/.test(combined);
    };
    const hasCourseNumberSuggestion = existing.some((s) => {
        const combined = `${s.type || ''} ${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
        return /course numbering|numbered courses|course number/.test(combined);
    });

    if (!hasTopPrixFixePrice) {
        // Canonicalize any AI version of this warning to one deterministic issue.
        for (let index = existing.length - 1; index >= 0; index -= 1) {
            if (isTopPriceSuggestion(existing[index])) existing.splice(index, 1);
        }
        existing.push({
            type: 'PRICING STRUCTURE',
            confidence: 'high',
            severity: 'critical',
            menuItem: 'Prix Fixe Menu',
            description: 'No overall prix-fixe or package price was detected near the top of the menu.',
            recommendation: 'Add a clearly labeled overall price near the top of the menu, including each package option when multiple options are offered.'
        });
    }

    if (hasCourseHeadings && missingCourseNumbers && !hasCourseNumberSuggestion) {
        existing.push({
            type: 'COURSE NUMBERING',
            confidence: 'high',
            severity: 'critical',
            menuItem: 'Course Headings',
            description: 'Prix fixe courses are present but not numbered.',
            recommendation: 'Prefix course headings with numbers (1, 2, 3...) or place a number line directly above each course heading.'
        });
    }

    // Explicit deterministic evidence is authoritative over contradictory AI output.
    const reconciled = hasTopPrixFixePrice ? existing.filter((s) => !isTopPriceSuggestion(s)) : existing;

    // Remove course numbering suggestions if numbers ARE present (AI false positive)
    if (hasCourseHeadings && !missingCourseNumbers) {
        return reconciled.filter((s) => {
            const combined = `${s.type || ''} ${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
            return !/course numbering|numbered courses|course number|not numbered/.test(combined);
        });
    }

    return reconciled;
}

// Deterministic allergen-program check: if no dish line on the menu carries an
// allergen-code cluster, inject one critical "Entire menu" suggestion. The AI
// prompt asks for this too, but LLM compliance is stochastic — this guarantees
// the flag fires on every review. Detection is conservative: a line "has codes"
// when, after stripping a trailing price token, it ends in a cluster of 1-2
// uppercase code tokens (comma-separated, no spaces), e.g. "... G,D 24".
const TRAILING_PRICE_FOR_ALLERGEN_CHECK = /\s+\$?\d+(?:[.,]\d+)?(?:\s*(?:each|pp|per\s*person))?\s*$/i;
const TRAILING_ALLERGEN_CLUSTER = /\s(?:[A-Z]{1,2}(?:,[A-Z]{1,2})+|VG|[A-Z])$/;

export function enforceAllergenProgramCheck(
    menuContent: string,
    suggestions: ReviewSuggestion[]
): ReviewSuggestion[] {
    const existing = [...(suggestions || [])];
    // Only an existing menu-wide allergen flag suppresses the injection.
    // Per-dish AI allergen suggestions must NOT — a menu with zero codes
    // still deserves the critical "no allergen program" banner.
    const hasAllergenSuggestion = existing.some((s) =>
        `${s.type || ''}`.toLowerCase().includes('allergen') &&
        `${s.menuItem || ''}`.toLowerCase().includes('entire menu'));

    const lines = (menuContent || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const codedLines = lines.filter((line) => {
        const withoutPrice = line.replace(TRAILING_PRICE_FOR_ALLERGEN_CHECK, '');
        // Ignore section headings (all-caps lines) and the allergen legend itself
        if (/^[A-Z\s&+•·-]+$/.test(withoutPrice)) return false;
        if (/allergen|contains|gluten|vegetarian|vegan/i.test(withoutPrice) && /\|/.test(withoutPrice)) return false;
        return TRAILING_ALLERGEN_CLUSTER.test(withoutPrice);
    });

    if (codedLines.length === 0 && !hasAllergenSuggestion) {
        existing.push({
            type: 'Allergen Code',
            confidence: 'high',
            severity: 'critical',
            menuItem: 'Entire menu',
            description: 'No dishes on this menu carry allergen codes — the menu has no allergen program.',
            recommendation: 'Code each dish per the allergen key (e.g., D dairy, G gluten, N nuts, S shellfish) so allergen information is available at a glance.'
        });
    }

    return existing;
}

type KnownTextArtifactPattern = {
    pattern: RegExp;
    corrected: string;
    context?: RegExp;
};

const KNOWN_TEXT_ARTIFACT_PATTERNS: KnownTextArtifactPattern[] = [
    {
        pattern: /\bctes\s+de\s+provence\b/gi,
        corrected: 'côtes de provence',
    },
    {
        pattern: /\bprovance\b/gi,
        corrected: 'provence',
        context: /\b(?:provence|ros[eé]|france|wine|wines)\b/i,
    },
    {
        pattern: /\bvallede\s+guadalupe\b/gi,
        corrected: 'valle de guadalupe',
    },
];

function hasExistingSuggestionForTextChange(suggestions: ReviewSuggestion[], original: string, corrected: string): boolean {
    const originalNorm = normalizeForSuggestionMatch(original);
    const correctedNorm = normalizeForSuggestionMatch(corrected);
    if (!originalNorm || !correctedNorm) return false;

    return suggestions.some((suggestion) => {
        const combined = normalizeForSuggestionMatch([
            suggestion.type || '',
            suggestion.menuItem || '',
            suggestion.description || '',
            suggestion.recommendation || '',
        ].join(' '));
        return combined.includes(originalNorm) && combined.includes(correctedNorm);
    });
}

export function detectKnownTextArtifactSuggestions(
    menuContent: string,
    suggestions: ReviewSuggestion[] = []
): ReviewSuggestion[] {
    const existing = [...(suggestions || [])];
    const additions: ReviewSuggestion[] = [];
    const seenChanges = new Set<string>();
    const lines = (menuContent || '').split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        for (const artifact of KNOWN_TEXT_ARTIFACT_PATTERNS) {
            if (artifact.context && !artifact.context.test(trimmedLine)) {
                continue;
            }

            artifact.pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = artifact.pattern.exec(trimmedLine)) !== null) {
                const original = match[0];
                const corrected = artifact.corrected;
                const changeKey = `${normalizeForSuggestionMatch(original)}->${normalizeForSuggestionMatch(corrected)}`;
                if (seenChanges.has(changeKey) || hasExistingSuggestionForTextChange(existing.concat(additions), original, corrected)) {
                    continue;
                }

                seenChanges.add(changeKey);
                additions.push({
                    type: 'Possible Extraction Typo',
                    confidence: 'high',
                    severity: 'normal',
                    menuItem: trimmedLine,
                    description: `The text "${original}" looks like a typo or DOCX redline cleanup artifact in this line.`,
                    recommendation: `Change "${original}" to "${corrected}".`,
                });
            }
        }
    }

    return existing.concat(additions);
}

export function parseAIResponse(feedback: string, originalMenu: string): ParsedAiResponse {
    // Extract corrected menu between markers
    const correctedMenuMatch = feedback.match(new RegExp(
        `${escapeRegExp(AI_REVIEW_FENCES.correctedMenuStart)}\\s*\\n([\\s\\S]*?)\\n${escapeRegExp(AI_REVIEW_FENCES.correctedMenuEnd)}`
    ));
    const fenceMissing = !correctedMenuMatch;
    if (fenceMissing) {
        console.warn('AI response missing the corrected-menu fence; using the original menu as the fail-safe output');
    }
    const correctedMenuRaw = correctedMenuMatch ? correctedMenuMatch[1].trim() : originalMenu;

    // Extract suggestions JSON between markers
    const suggestionsMatch = feedback.match(new RegExp(
        `${escapeRegExp(AI_REVIEW_FENCES.suggestionsStart)}\\s*\\n([\\s\\S]*?)\\n${escapeRegExp(AI_REVIEW_FENCES.suggestionsEnd)}`
    ));
    let suggestions: Array<any> = [];

    if (suggestionsMatch) {
        try {
            const jsonStr = suggestionsMatch[1].trim();
            const parsedSuggestions = JSON.parse(jsonStr);
            suggestions = Array.isArray(parsedSuggestions)
                ? parsedSuggestions
                    .map(normalizeSuggestionShape)
                    .filter((suggestion): suggestion is ReviewSuggestion => suggestion !== null)
                : [];
            console.log(`Parsed ${suggestions.length} suggestions from JSON`);
        } catch (e) {
            console.error('Failed to parse suggestions JSON:', e);
            console.log('Raw suggestions text:', suggestionsMatch[1]);
        }
    }

    // Normalize severity on all suggestions
    suggestions = suggestions.map((suggestion) => {
        const s = { ...suggestion, severity: suggestion.severity || 'normal' };
        const type = (s.type || '').toString().trim().toLowerCase();
        const descLower = (s.description || '').toLowerCase();
        const recLower = (s.recommendation || '').toLowerCase();
        const combined = `${descLower} ${recLower}`;

        const isPrixFixeTopPriceIssue =
            /prix\s*fixe/.test(combined) &&
            /(price at the top|single price at the top|include a prix fixe price at the top|top of the menu)/.test(combined);
        const isCourseNumberingIssue =
            type === 'course numbering' ||
            (/prix\s*fixe/.test(combined) && /course number|numbered courses|preceded by its course number/.test(combined));

        // Force critical severity for known critical types (safety net)
        if (
            (FORCED_CRITICAL_EXACT_TYPES as readonly string[]).includes(s.type) ||
            (FORCED_CRITICAL_NORMALIZED_TYPES as readonly string[]).includes(type) ||
            (
                (FORCED_CRITICAL_HIGH_CONFIDENCE_TYPES as readonly string[]).includes(type)
                && `${s.confidence || ''}`.trim().toLowerCase() === 'high'
            ) ||
            isPrixFixeTopPriceIssue ||
            isCourseNumberingIssue
        ) {
            s.severity = 'critical';
        }

        // Fallback regex: if description mentions missing price/dish name but type/severity wasn't set
        if (s.severity !== 'critical') {
            if (/missing\s+price|no\s+price|price\s+is\s+missing/.test(descLower) && s.type !== 'Missing Price') {
                s.type = 'Missing Price';
                s.severity = 'critical';
            } else if (/missing\s+dish\s+name|incomplete\s+dish\s+name|no\s+dish\s+name/.test(descLower) && s.type !== 'Incomplete Dish Name') {
                s.type = 'Incomplete Dish Name';
                s.severity = 'critical';
            }
        }

        return s;
    });

    // Marker placement is a brand convention (rulebook.rawMarkerPlacement).
    // 'preserve' tenants keep the author's placement; only the default
    // 'description_end' convention canonicalizes.
    const correctedMenu = getTenantConfig().rulebook.rawMarkerPlacement === 'preserve'
        ? correctedMenuRaw
        : normalizeRawAsteriskPlacement(correctedMenuRaw);

    return {
        correctedMenu,
        fenceMissing,
        suggestions
    };
}

export function normalizeRawAsteriskPlacement(text: string): string {
    const lines = (text || '').split('\n');
    return lines
        .map((line) => normalizeRawAsteriskPlacementForLine(line))
        .join('\n');
}

// Post-AI canonicalization: strips every raw marker and reinserts exactly one at
// the canonical position. Intentionally more aggressive than the conservative
// pre-AI pass in pre-ai-deterministic-rules.ts, which only fixes spacing.
function normalizeRawAsteriskPlacementForLine(line: string): string {
    const original = line || '';
    const trimmed = original.trim();
    if (!trimmed) return original;
    if (RAW_NOTICE_PATTERN.test(trimmed)) return original;
    if (!trimmed.includes('*')) return original;

    // Remove all raw markers first; we'll reinsert exactly one at canonical position.
    let working = trimmed.replace(/\*/g, '').replace(/\s{2,}/g, ' ').trim();

    // Skip obvious non-dish lines (titles/legends).
    if (/^[A-Za-zÀ-ÖØ-öø-ÿ0-9 '&\-]+$/.test(working) && !working.includes(',')) {
        return original;
    }
    if (working.includes(' | ') && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(working)) {
        return original;
    }

    let trailingPrice = '';
    let trailingAllergens = '';

    const priceMatch = working.match(/\s+(\$?\d+(?:[.,]\d+)?(?:\s*\|\s*\d+(?:[.,]\d+)?)?)\s*$/);
    if (priceMatch) {
        trailingPrice = priceMatch[1];
        working = working.slice(0, priceMatch.index).trim();
    }

    const allergenMatch = working.match(/\s+([A-Z]{1,3}(?:,[A-Z]{1,3})*)\s*$/);
    if (allergenMatch) {
        trailingAllergens = allergenMatch[1];
        working = working.slice(0, allergenMatch.index).trim();
    }

    // If we extracted any suffix, place marker before suffix; otherwise keep at line end.
    if (trailingAllergens || trailingPrice) {
        return `${working} *${trailingAllergens ? ` ${trailingAllergens}` : ''}${trailingPrice ? ` ${trailingPrice}` : ''}`.trim();
    }

    return `${working}*`;
}

export type PostAiPipelineArgs = {
    feedback: string;
    preCheckedReviewBody: string;
    menuType?: string;
    property?: string;
    templateType?: string;
    effectiveReviewAllergens?: string;
    acceptedCorrectionRules: AcceptedCorrectionRule[];
    embeddedSetMenuAnalysis: EmbeddedSetMenuAnalysis;
    canonicalSpellingFindings?: NearMissFinding[];
    precheckEnabled: boolean;
    checkId?: string;
    managedRawNoticePresent?: boolean;
};

export type PostAiPipelineResult = {
    parsed: ParsedAiResponse;
    postAiDeterministic: PreAiDeterministicResult;
    protectedTerms: ProtectedTermGuardResult;
    titleGuard: MenuTitleGuardResult;
    structureGuard: CorrectedMenuStructureGuardResult;
    guardedCorrectedMenu: string;
    allergenGuard: ReturnType<typeof guardAllergenAlphabetizationSuggestions>;
    appliedHc: ReturnType<typeof applyHighConfidenceSuggestionsToMenu>;
    setMenuGuard: ReturnType<typeof guardEmbeddedSetMenuPrices>;
    priceIntegrityGuard: ReturnType<typeof guardCorrectedMenuPrices>;
    correctedAfterHighConfidence: string;
    correctedMenuSanitized: string;
    reconciliation: ReturnType<typeof reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics>;
    reconciledSuggestions: ReviewSuggestion[];
    spellingAdjudications: SpellingAdjudication[];
    finalSuggestions: ReviewSuggestion[];
    hasCriticalErrors: boolean;
    criticalSuggestions: ReviewSuggestion[];
    safetyDiagnostics: string[];
    /** Authoritative guard/reconciliation state for the bytes actually delivered after merge. */
    deliveredStructureGuard?: CorrectedMenuStructureGuardResult;
    deliveredReconciliation?: ReturnType<typeof reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics>;
};

export function runPostAiPipeline(args: PostAiPipelineArgs): PostAiPipelineResult {
    const parsed = parseAIResponse(args.feedback, args.preCheckedReviewBody);
    const initialAllergenPreservation = preserveSubmittedAllergenCodes(args.preCheckedReviewBody, parsed.correctedMenu, args.effectiveReviewAllergens || '');
    parsed.correctedMenu = initialAllergenPreservation.menuText;
    const safetyDiagnostics = [...initialAllergenPreservation.diagnostics];
    const postAiDeterministic = runPreAiDeterministicChecks(parsed.correctedMenu, {
        enabled: args.precheckEnabled,
        property: args.property,
        templateType: args.templateType,
        allergenLegend: args.effectiveReviewAllergens,
        acceptedCorrectionRules: args.acceptedCorrectionRules,
    });
    const protectedTerms = restoreProtectedTerms(args.preCheckedReviewBody, postAiDeterministic.menuText);
    const titleGuard = preserveLeadingMenuTitle(args.preCheckedReviewBody, protectedTerms.correctedMenu);
    const structureGuard = assessCorrectedMenuStructure(args.preCheckedReviewBody, titleGuard.correctedMenu);
    const guardedCorrectedMenu = structureGuard.safe ? titleGuard.correctedMenu : args.preCheckedReviewBody;
    if (!structureGuard.safe) {
        console.warn('AI corrected menu rejected by structure guard:', {
            checkId: args.checkId,
            reasons: structureGuard.reasons,
            metrics: structureGuard.metrics,
        });
    }
    const allergenGuard = guardAllergenAlphabetizationSuggestions(guardedCorrectedMenu, parsed.suggestions);
    const appliedHc = applyHighConfidenceSuggestionsToMenu(allergenGuard.correctedMenu, allergenGuard.suggestions);
    const setMenuGuard = guardEmbeddedSetMenuPrices(
        args.preCheckedReviewBody,
        appliedHc.menuText,
        appliedHc.suggestions,
        args.embeddedSetMenuAnalysis
    );
    const priceIntegrityGuard = guardCorrectedMenuPrices(
        args.preCheckedReviewBody,
        setMenuGuard.correctedMenu,
        setMenuGuard.suggestions
    );
    const correctedAfterHighConfidence = priceIntegrityGuard.correctedMenu;
    const suggestionsAfterAutoApply = priceIntegrityGuard.suggestions;
    // Re-run the protected-term guard after every model-driven auto-apply. A
    // suggestion can otherwise reintroduce a rewrite that the earlier guard
    // correctly removed from the model's corrected-menu block.
    const finalProtectedTerms = restoreProtectedTerms(
        args.preCheckedReviewBody,
        correctedAfterHighConfidence
    );
    const protectedTermsResult: ProtectedTermGuardResult = {
        correctedMenu: finalProtectedTerms.correctedMenu,
        restoredTerms: Array.from(new Set([
            ...protectedTerms.restoredTerms,
            ...finalProtectedTerms.restoredTerms,
        ])),
    };

    let correctedMenuSanitized = stripManagedFooterText(protectedTermsResult.correctedMenu);
    const finalAllergenPreservation = preserveSubmittedAllergenCodes(args.preCheckedReviewBody, correctedMenuSanitized, args.effectiveReviewAllergens || '');
    correctedMenuSanitized = finalAllergenPreservation.menuText;
    safetyDiagnostics.push(...finalAllergenPreservation.diagnostics);
    const reconciliation = reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics(
        correctedMenuSanitized,
        suggestionsAfterAutoApply
    );
    const reconciledSuggestions = reconciliation.suggestions;

    let finalSuggestions = reconciledSuggestions;

    if (args.menuType === 'prix_fixe') {
        finalSuggestions = enforcePrixFixeCriticalChecks(correctedMenuSanitized, finalSuggestions);
    }
    // Allergen coding is a food-menu program; beverage menus legitimately carry no
    // allergen codes, so the "no allergen program" critical is a false positive on
    // them. Gate to food menus (default when templateType is unset).
    if (args.templateType !== 'beverage') {
        finalSuggestions = enforceAllergenProgramCheck(correctedMenuSanitized, finalSuggestions);
    }
    if (args.managedRawNoticePresent) {
        finalSuggestions = finalSuggestions.filter(suggestion => !isGenericMissingCanonicalRawNoticeFinding(suggestion));
    }
    finalSuggestions = detectKnownTextArtifactSuggestions(correctedMenuSanitized, finalSuggestions);
    const spellingAdjudication = adjudicateCanonicalSpellingFindings(
        correctedMenuSanitized,
        finalSuggestions,
        args.canonicalSpellingFindings || []
    );
    finalSuggestions = spellingAdjudication.suggestions as ReviewSuggestion[];
    const allergenDelivery = reconcileAllergenDeliveryClaims(args.preCheckedReviewBody, correctedMenuSanitized, finalSuggestions);
    finalSuggestions = allergenDelivery.suggestions;
    safetyDiagnostics.push(...allergenDelivery.diagnostics);

    const hasCriticalErrors = finalSuggestions.some(s => s.severity === 'critical');
    const criticalSuggestions = finalSuggestions.filter(s => s.severity === 'critical');

    return {
        parsed,
        postAiDeterministic,
        protectedTerms: protectedTermsResult,
        titleGuard,
        structureGuard,
        guardedCorrectedMenu,
        allergenGuard,
        appliedHc,
        setMenuGuard,
        priceIntegrityGuard,
        correctedAfterHighConfidence,
        correctedMenuSanitized,
        reconciliation,
        reconciledSuggestions,
        spellingAdjudications: spellingAdjudication.adjudications,
        finalSuggestions,
        hasCriticalErrors,
        criticalSuggestions,
        safetyDiagnostics,
    };
}

export type FullReviewPipelineOptions = {
    basePrompt: string;
    baselineMenuContent?: string;
    baselineProvenance?: unknown;
    readOnlyContext?: string;
    contextProvenance?: string;
    model?: string;
    settings?: Record<string, unknown>;
    editableSpans?: Array<{ id: string; start: number; end: number }>;
    menuType?: string;
    templateType?: string;
    property?: string;
    allergens?: string;
    acceptedCorrectionRules?: AcceptedCorrectionRule[];
    approvedVocabularyTexts?: string[];
    approvedVocabularyTerms?: ApprovedVocabularyTerm[];
    precheckEnabled?: boolean;
    managedRawNoticePresent?: boolean;
    // F2: when --ablate-sections, omit specific prompt sections for delta measurement.
    omitSections?: import('./qa-prompt-builder').QaPromptSectionId[];
};

export type ReviewEnvelope = {
    schemaVersion: 1;
    engineVersion: string;
    originalBody: string;
    originalBodyHash: string;
    rawInputSnapshot: string;
    rawInputSnapshotHash: string;
    precheckedBody: string;
    precheckedBodyHash: string;
    editableSpanBasis: 'prechecked_review_body';
    baselineProvenance: unknown;
    baselineHash: string;
    editableSpans: Array<{ id: string; start: number; end: number }>;
    readOnlyContext: string;
    context: ReturnType<typeof reviewContextOptions>;
    promptHash: string;
    acceptedPolicyHash: string;
    vocabularySnapshotHash: string;
    model: string;
    settings: Record<string, unknown>;
};

export type FullReviewPipelineResult = {
    envelope: ReviewEnvelope;
    diagnostics: Array<Record<string, unknown>>;
    outputHash: string;
    reviewStatus: { complete: boolean; transportStatus: string; reusable: boolean };
    preAiDeterministic: PreAiDeterministicResult;
    preCheckedReviewBody: string;
    originalMenuSanitized: string;
    effectiveReviewAllergens: string;
    embeddedSetMenuAnalysis: EmbeddedSetMenuAnalysis;
    promptInfo: { prompt: string; sections: QaPromptSectionId[] };
    post: PostAiPipelineResult;
    authoritative: DeliveredReviewState;
    finalCorrectedMenu: string;
    finalSuggestions: ReviewSuggestion[];
    hasChanges: boolean;
};

export type DeliveredReviewState = {
    correctedMenu: string;
    suggestions: ReviewSuggestion[];
    criticalSuggestions: ReviewSuggestion[];
    hasCriticalErrors: boolean;
    structureGuard: CorrectedMenuStructureGuardResult;
    reconciliation: ReturnType<typeof reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics>;
    spellingAdjudications: SpellingAdjudication[];
    reviewStatus: { complete: boolean; transportStatus: string; reusable: boolean };
    safetyDiagnostics: string[];
};

function buildReviewEnvelope(
    originalBody: string,
    reviewBody: string,
    prompt: string,
    opts: FullReviewPipelineOptions,
    effectiveAllergens: string,
    managedRawNoticePresent: boolean,
): ReviewEnvelope {
    const context = reviewContextOptions({
        ...opts,
        allergens: effectiveAllergens,
        managedRawNoticePresent,
    });
    const editableSpans = opts.editableSpans || reviewBody.split('\n').reduce<Array<{ id: string; start: number; end: number }>>((spans, row, index) => {
        const start = index === 0 ? 0 : spans[index - 1].end + 1;
        spans.push({ id: `row:${index}`, start, end: start + row.length });
        return spans;
    }, []);
    return freezeReviewEnvelope({
        schemaVersion: 1,
        engineVersion: REVIEW_ENGINE_VERSION,
        originalBody,
        originalBodyHash: policyHash(originalBody),
        rawInputSnapshot: originalBody,
        rawInputSnapshotHash: policyHash(originalBody),
        precheckedBody: reviewBody,
        precheckedBodyHash: policyHash(reviewBody),
        editableSpanBasis: 'prechecked_review_body',
        baselineProvenance: opts.baselineProvenance || { status: 'unknown' },
        baselineHash: policyHash(opts.baselineMenuContent || ''),
        editableSpans,
        readOnlyContext: opts.readOnlyContext || '',
        context,
        promptHash: policyHash(prompt),
        acceptedPolicyHash: policyHash(opts.acceptedCorrectionRules || []),
        vocabularySnapshotHash: policyHash({
            approvedTexts: opts.approvedVocabularyTexts || [],
            approvedTerms: opts.approvedVocabularyTerms || [],
        }),
        model: opts.model || 'unknown',
        settings: opts.settings || {},
    }) as ReviewEnvelope;
}

export async function prepareReview(rawMenuContent: string, options: FullReviewPipelineOptions) {
    const opts = freezeReviewEnvelope(options) as FullReviewPipelineOptions;
    const precheckEnabled = opts.precheckEnabled !== false;
    const acceptedCorrectionRules = opts.acceptedCorrectionRules || [];
    const reviewFooterMetadata = normalizeMenuFooter(rawMenuContent, opts.allergens || '');
    const sanitizedMenuContent = normalizeMenuFooter(rawMenuContent, opts.allergens || '');
    const managedRawNoticePresent = opts.managedRawNoticePresent ?? reviewFooterMetadata.hadRawNotice;
    const effectiveReviewAllergens = opts.allergens || reviewFooterMetadata.normalizedAllergenLine;
    const preAiDeterministic = runPreAiDeterministicChecks(reviewFooterMetadata.body, {
        enabled: precheckEnabled,
        property: opts.property,
        templateType: opts.templateType,
        allergenLegend: effectiveReviewAllergens,
        acceptedCorrectionRules,
    });
    const preCheckedReviewBody = preAiDeterministic.menuText;
    const embeddedSetMenuAnalysis = opts.menuType === 'prix_fixe'
        ? { sections: [], issues: [] }
        : analyzeEmbeddedSetMenus(preCheckedReviewBody);
    const nearMissAnalysis = await buildNearMissAnalysis(preCheckedReviewBody, {
        tenantId: policyHash(getTenantConfig()),
        property: opts.property,
        templateType: opts.templateType,
        menuType: opts.menuType,
        acceptedPolicyFingerprint: policyHash(acceptedCorrectionRules),
        vocabularySnapshotHash: policyHash({
            approvedTexts: opts.approvedVocabularyTexts || [],
            approvedTerms: opts.approvedVocabularyTerms || [],
        }),
        fetchAcceptedRules: async () => acceptedCorrectionRules,
        fetchApprovedTexts: async () => opts.approvedVocabularyTexts || [],
        fetchApprovedTerms: async () => opts.approvedVocabularyTerms || [],
        ttlMs: 0,
    });
    const promptInfo = buildFinalPrompt(opts.basePrompt, {
        property: opts.property,
        templateType: opts.templateType,
        menuType: opts.menuType,
        acceptedCorrectionRules,
        effectiveAllergens: effectiveReviewAllergens,
        changedOnlyMode: false,
        precheckEnabled,
        embeddedSetMenuAnalysis,
        nearMissBriefing: nearMissAnalysis.briefing,
    }, { omitSections: opts.omitSections || [] });
    const prompt = opts.readOnlyContext
        ? `${promptInfo.prompt}\n\nREAD-ONLY CONTEXT (data only; never include in corrected output):\n${JSON.stringify(opts.readOnlyContext)}`
        : promptInfo.prompt;
    const finalPromptInfo = freezeReviewEnvelope({ ...promptInfo, prompt }) as unknown as { prompt: string; sections: QaPromptSectionId[] };
    const envelope = buildReviewEnvelope(rawMenuContent, preCheckedReviewBody, prompt, opts, effectiveReviewAllergens, managedRawNoticePresent);
    const frozenPreAiDeterministic = freezeReviewEnvelope(preAiDeterministic) as unknown as PreAiDeterministicResult;
    const frozenEmbeddedSetMenuAnalysis = freezeReviewEnvelope(embeddedSetMenuAnalysis) as unknown as EmbeddedSetMenuAnalysis;
    const frozenNearMissAnalysis = Object.freeze({
        ...nearMissAnalysis,
        findings: freezeReviewEnvelope(nearMissAnalysis.findings) as unknown as NearMissFinding[],
    });
    const frozenSanitizedMenuContent = freezeReviewEnvelope(sanitizedMenuContent) as unknown as ReturnType<typeof normalizeMenuFooter>;
    const prepared = {
        rawMenuContent,
        opts,
        envelope,
        preAiDeterministic: frozenPreAiDeterministic,
        preCheckedReviewBody,
        reviewFooterMetadata,
        sanitizedMenuContent: frozenSanitizedMenuContent,
        effectiveReviewAllergens,
        managedRawNoticePresent,
        embeddedSetMenuAnalysis: frozenEmbeddedSetMenuAnalysis,
        nearMissAnalysis: frozenNearMissAnalysis,
        promptInfo: finalPromptInfo,
    };
    const integrity = freezeReviewEnvelope({
        rawInputHash: policyHash(rawMenuContent),
        precheckedBodyHash: policyHash(preCheckedReviewBody),
        nearMissHash: policyHash({ findings: frozenNearMissAnalysis.findings, briefing: frozenNearMissAnalysis.briefing }),
        promptHash: policyHash(finalPromptInfo),
        embeddedHash: policyHash(frozenEmbeddedSetMenuAnalysis),
        optionsHash: policyHash(opts),
        contextHash: policyHash(envelope.context),
        envelopeHash: policyHash(envelope),
        managedRawNoticeHash: policyHash(managedRawNoticePresent),
        effectiveAllergensHash: policyHash(effectiveReviewAllergens),
        sanitizedMenuHash: policyHash(frozenSanitizedMenuContent),
        preAiHash: policyHash(frozenPreAiDeterministic),
        snapshot: {
            rawMenuContent,
            envelope,
            opts,
            preCheckedReviewBody,
            sanitizedMenuContent: frozenSanitizedMenuContent,
            effectiveReviewAllergens,
            managedRawNoticePresent,
            preAiDeterministic: frozenPreAiDeterministic,
            embeddedSetMenuAnalysis: frozenEmbeddedSetMenuAnalysis,
            nearMissAnalysis: frozenNearMissAnalysis,
            promptInfo: finalPromptInfo,
        },
    });
    Object.defineProperty(prepared, '__integrity', {
        value: integrity,
        enumerable: false,
        configurable: false,
        writable: false,
    });
    return prepared;
}

type PreparedReview = Awaited<ReturnType<typeof prepareReview>> & {
    readonly __integrity: {
        rawInputHash: string;
        precheckedBodyHash: string;
        nearMissHash: string;
        promptHash: string;
        embeddedHash: string;
        optionsHash: string;
        contextHash: string;
        envelopeHash: string;
        managedRawNoticeHash: string;
        effectiveAllergensHash: string;
        sanitizedMenuHash: string;
        preAiHash: string;
        snapshot: Awaited<ReturnType<typeof prepareReview>>;
    };
};

function preparedReviewDrift(prepared: PreparedReview): string | null {
    try {
        const integrity = prepared.__integrity;
        if (!integrity) return 'missing_prepared_integrity';
        const checks: Array<[string, string, string]> = [
            ['raw_input', integrity.rawInputHash, policyHash(prepared.rawMenuContent)],
            ['prechecked_body', integrity.precheckedBodyHash, policyHash(prepared.preCheckedReviewBody)],
            ['near_miss', integrity.nearMissHash, policyHash({ findings: prepared.nearMissAnalysis.findings, briefing: prepared.nearMissAnalysis.briefing })],
            ['prompt', integrity.promptHash, policyHash(prepared.promptInfo)],
            ['embedded_analysis', integrity.embeddedHash, policyHash(prepared.embeddedSetMenuAnalysis)],
            ['options', integrity.optionsHash, policyHash(prepared.opts)],
            ['context', integrity.contextHash, policyHash(prepared.envelope.context)],
            ['envelope', integrity.envelopeHash, policyHash(prepared.envelope)],
            ['managed_raw_notice', integrity.managedRawNoticeHash, policyHash(prepared.managedRawNoticePresent)],
            ['effective_allergens', integrity.effectiveAllergensHash, policyHash(prepared.effectiveReviewAllergens)],
            ['sanitized_menu', integrity.sanitizedMenuHash, policyHash(prepared.sanitizedMenuContent)],
            ['pre_ai_deterministic', integrity.preAiHash, policyHash(prepared.preAiDeterministic)],
        ];
        const drift = checks.find(([, expected, actual]) => expected !== actual);
        return drift ? `prepared_state_drift:${drift[0]}` : null;
    } catch {
        return 'prepared_state_drift:malformed_state';
    }
}

function emptyReviewFeedback(menu: string): string {
    return `${AI_REVIEW_FENCES.correctedMenuStart}\n${menu}\n${AI_REVIEW_FENCES.correctedMenuEnd}\n${AI_REVIEW_FENCES.suggestionsStart}\n[]\n${AI_REVIEW_FENCES.suggestionsEnd}`;
}

function deriveDeliveredSourcePost(args: {
    source: string;
    menuType?: string;
    property?: string;
    templateType?: string;
    effectiveReviewAllergens?: string;
    embeddedSetMenuAnalysis: EmbeddedSetMenuAnalysis;
    canonicalSpellingFindings?: NearMissFinding[];
    managedRawNoticePresent?: boolean;
}): PostAiPipelineResult {
    const sourcePost = runPostAiPipeline({
        feedback: emptyReviewFeedback(args.source),
        preCheckedReviewBody: args.source,
        menuType: args.menuType,
        property: args.property,
        templateType: args.templateType,
        effectiveReviewAllergens: args.effectiveReviewAllergens,
        acceptedCorrectionRules: [],
        embeddedSetMenuAnalysis: args.embeddedSetMenuAnalysis,
        canonicalSpellingFindings: args.canonicalSpellingFindings || [],
        precheckEnabled: false,
        managedRawNoticePresent: args.managedRawNoticePresent,
    });
    sourcePost.correctedMenuSanitized = args.source;
    sourcePost.correctedAfterHighConfidence = args.source;
    sourcePost.guardedCorrectedMenu = args.source;
    sourcePost.deliveredStructureGuard = assessCorrectedMenuStructure(args.source, args.source);
    sourcePost.deliveredReconciliation = sourcePost.reconciliation;
    return sourcePost;
}

function failClosedPreparedReview(prepared: PreparedReview, reason: string): FullReviewPipelineResult {
    const integrity = (prepared as any)?.__integrity;
    const snapshot = integrity?.snapshot;
    if (!snapshot || typeof snapshot.preCheckedReviewBody !== 'string') {
        const candidate = (prepared || {}) as any;
        const source = typeof candidate.preCheckedReviewBody === 'string'
            ? candidate.preCheckedReviewBody
            : typeof candidate.rawMenuContent === 'string' ? candidate.rawMenuContent : '';
        const envelope = candidate.envelope && typeof candidate.envelope.originalBody === 'string'
            ? candidate.envelope
            : buildReviewEnvelope(source, source, '', { basePrompt: '' }, '', false);
        const post = deriveDeliveredSourcePost({ source, embeddedSetMenuAnalysis: { sections: [], issues: [] } });
        post.safetyDiagnostics = [reason, ...post.safetyDiagnostics];
        const reviewStatus = { complete: false, transportStatus: 'rejected', reusable: false };
        return {
            envelope,
            diagnostics: [{ stage: 'integrity', reason }, { stage: 'final', finalHash: policyHash(source) }],
            outputHash: policyHash(source),
            reviewStatus,
            preAiDeterministic: candidate.preAiDeterministic || runPreAiDeterministicChecks(source, { enabled: false }),
            preCheckedReviewBody: source,
            originalMenuSanitized: typeof candidate.sanitizedMenuContent?.body === 'string' ? candidate.sanitizedMenuContent.body : source,
            effectiveReviewAllergens: typeof candidate.effectiveReviewAllergens === 'string' ? candidate.effectiveReviewAllergens : '',
            embeddedSetMenuAnalysis: { sections: [], issues: [] },
            promptInfo: { prompt: '', sections: [] },
            post,
            authoritative: {
                correctedMenu: source,
                suggestions: post.finalSuggestions,
                criticalSuggestions: post.criticalSuggestions,
                hasCriticalErrors: post.hasCriticalErrors,
                structureGuard: post.deliveredStructureGuard || post.structureGuard,
                reconciliation: post.deliveredReconciliation || post.reconciliation,
                spellingAdjudications: post.spellingAdjudications,
                reviewStatus,
                safetyDiagnostics: post.safetyDiagnostics.slice(0, 200),
            },
            finalCorrectedMenu: source,
            finalSuggestions: post.finalSuggestions,
            hasChanges: false,
        };
    }
    const source = snapshot.preCheckedReviewBody;
    const post = deriveDeliveredSourcePost({
        source,
        menuType: snapshot.envelope.context.menuType,
        property: snapshot.envelope.context.property,
        templateType: snapshot.envelope.context.templateType,
        effectiveReviewAllergens: snapshot.effectiveReviewAllergens,
        embeddedSetMenuAnalysis: snapshot.embeddedSetMenuAnalysis,
        canonicalSpellingFindings: snapshot.nearMissAnalysis.findings,
        managedRawNoticePresent: snapshot.managedRawNoticePresent,
    });
    post.safetyDiagnostics = [reason, ...post.safetyDiagnostics];
    const reviewStatus = { complete: false, transportStatus: 'rejected', reusable: false };
    return {
        envelope: snapshot.envelope,
        diagnostics: [{ stage: 'integrity', reason }, { stage: 'final', finalHash: policyHash(source) }],
        outputHash: policyHash(source),
        reviewStatus,
        preAiDeterministic: snapshot.preAiDeterministic,
        preCheckedReviewBody: source,
        originalMenuSanitized: snapshot.sanitizedMenuContent.body,
        effectiveReviewAllergens: snapshot.effectiveReviewAllergens,
        embeddedSetMenuAnalysis: snapshot.embeddedSetMenuAnalysis,
        promptInfo: snapshot.promptInfo,
        post,
        authoritative: {
            correctedMenu: source,
            suggestions: post.finalSuggestions,
            criticalSuggestions: post.criticalSuggestions,
            hasCriticalErrors: post.hasCriticalErrors,
            structureGuard: post.deliveredStructureGuard || post.structureGuard,
            reconciliation: post.deliveredReconciliation || post.reconciliation,
            spellingAdjudications: post.spellingAdjudications,
            reviewStatus,
            safetyDiagnostics: post.safetyDiagnostics.slice(0, 200),
        },
        finalCorrectedMenu: source,
        finalSuggestions: post.finalSuggestions,
        hasChanges: source !== snapshot.sanitizedMenuContent.body,
    };
}

export function completePreparedReview(
    prepared: Awaited<ReturnType<typeof prepareReview>>,
    feedback: string,
    completion: { finishReason?: string | null } = {},
): FullReviewPipelineResult {
    const preparedWithIntegrity = prepared as PreparedReview;
    const drift = preparedReviewDrift(preparedWithIntegrity);
    if (drift) return failClosedPreparedReview(preparedWithIntegrity, drift);
    const snapshot = preparedWithIntegrity.__integrity.snapshot;
    const { opts } = snapshot;
    const post = runPostAiPipeline({
        feedback,
        preCheckedReviewBody: snapshot.preCheckedReviewBody,
        menuType: opts.menuType,
        property: opts.property,
        templateType: opts.templateType,
        effectiveReviewAllergens: snapshot.effectiveReviewAllergens,
        acceptedCorrectionRules: opts.acceptedCorrectionRules || [],
        embeddedSetMenuAnalysis: snapshot.embeddedSetMenuAnalysis,
        canonicalSpellingFindings: snapshot.nearMissAnalysis.findings,
        precheckEnabled: opts.precheckEnabled !== false,
        managedRawNoticePresent: snapshot.managedRawNoticePresent,
    });
    const anchored = attributeCorrectedBlock(
        snapshot.preCheckedReviewBody,
        post.correctedMenuSanitized,
        opts.acceptedCorrectionRules || [],
        { editableSpans: snapshot.envelope.editableSpans },
    );
    const finalCorrectedMenu = anchored.text;
    if (anchored.diagnostics.length) post.safetyDiagnostics.push(...anchored.diagnostics);
    const mergeRejected = anchored.diagnostics.length > 0 || !post.structureGuard.safe;
    if (!anchored.diagnostics.length && !post.structureGuard.safe) post.safetyDiagnostics.push('structure_guard_rejected');
    if (finalCorrectedMenu !== post.correctedMenuSanitized) post.correctedMenuSanitized = finalCorrectedMenu;
    const deliveredStructureGuard = assessCorrectedMenuStructure(snapshot.preCheckedReviewBody, finalCorrectedMenu);
    const deliveredSourcePost = mergeRejected
        ? deriveDeliveredSourcePost({
            source: finalCorrectedMenu,
            menuType: opts.menuType,
            property: opts.property,
            templateType: opts.templateType,
            effectiveReviewAllergens: snapshot.effectiveReviewAllergens,
            embeddedSetMenuAnalysis: snapshot.embeddedSetMenuAnalysis,
            canonicalSpellingFindings: snapshot.nearMissAnalysis.findings,
            managedRawNoticePresent: snapshot.managedRawNoticePresent,
        })
        : null;
    const deliveredReconciliation = deliveredSourcePost?.reconciliation || reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics(
        finalCorrectedMenu,
        post.finalSuggestions,
    );
    post.deliveredStructureGuard = deliveredSourcePost?.structureGuard || deliveredStructureGuard;
    post.deliveredReconciliation = deliveredReconciliation;
    post.guardedCorrectedMenu = finalCorrectedMenu;
    post.correctedAfterHighConfidence = finalCorrectedMenu;
    if (deliveredSourcePost) {
        post.finalSuggestions = deliveredSourcePost.finalSuggestions;
        post.safetyDiagnostics.push(...deliveredSourcePost.safetyDiagnostics);
    } else {
        post.finalSuggestions = deliveredReconciliation.suggestions;
    }
    post.criticalSuggestions = post.finalSuggestions.filter(suggestion => suggestion.severity === 'critical');
    post.hasCriticalErrors = post.criticalSuggestions.length > 0;
    const finalSuggestions = post.finalSuggestions;
    const transportStatus = completion.finishReason === 'stop' ? 'complete' : completion.finishReason ? 'incomplete' : 'unknown';
    const reviewStatus = {
        complete: !mergeRejected && !post.parsed.fenceMissing && transportStatus !== 'incomplete',
        transportStatus: mergeRejected ? 'rejected' : transportStatus,
        reusable: !mergeRejected && !post.parsed.fenceMissing && transportStatus === 'complete' && post.safetyDiagnostics.length === 0
            && post.structureGuard.safe && !post.hasCriticalErrors && post.finalSuggestions.length === 0,
    };
    const authoritative: DeliveredReviewState = {
        correctedMenu: finalCorrectedMenu,
        suggestions: finalSuggestions,
        criticalSuggestions: post.criticalSuggestions,
        hasCriticalErrors: post.hasCriticalErrors,
        structureGuard: post.deliveredStructureGuard || deliveredStructureGuard,
        reconciliation: post.deliveredReconciliation || deliveredReconciliation,
        spellingAdjudications: deliveredSourcePost?.spellingAdjudications || post.spellingAdjudications,
        reviewStatus,
        safetyDiagnostics: post.safetyDiagnostics.slice(0, 200),
    };
    return {
        envelope: snapshot.envelope,
        diagnostics: [
            ...anchored.diagnostics.map(reason => ({ stage: 'merge', reason })),
            ...(mergeRejected && !anchored.diagnostics.length ? [{ stage: 'merge', reason: 'structure_guard_rejected' }] : []),
            ...boundedMutationDiagnostics(snapshot.preCheckedReviewBody, finalCorrectedMenu).map(diagnostic => ({
                ...diagnostic,
                basis: snapshot.envelope.editableSpanBasis,
            })),
            { stage: 'final', finalHash: policyHash(finalCorrectedMenu) },
        ].slice(0, 200),
        outputHash: policyHash(finalCorrectedMenu),
        reviewStatus,
        preAiDeterministic: snapshot.preAiDeterministic,
        preCheckedReviewBody: snapshot.preCheckedReviewBody,
        originalMenuSanitized: snapshot.sanitizedMenuContent.body,
        effectiveReviewAllergens: snapshot.effectiveReviewAllergens,
        embeddedSetMenuAnalysis: snapshot.embeddedSetMenuAnalysis,
        promptInfo: snapshot.promptInfo,
        post,
        authoritative,
        finalCorrectedMenu,
        finalSuggestions,
        hasChanges: finalCorrectedMenu !== snapshot.sanitizedMenuContent.body,
    };
}

// One shared coordinator for Basic and offline callers. Adapters only provide
// the model callback; preparation, safe delivery and all final guards are shared.
export async function runFullReviewPipeline(
    rawMenuContent: string,
    opts: FullReviewPipelineOptions,
    aiCaller: (text: string, prompt: string) => Promise<string | { feedback: string; finishReason?: string | null }>,
): Promise<FullReviewPipelineResult> {
    const prepared = await prepareReview(rawMenuContent, opts);
    const response = await aiCaller(prepared.preCheckedReviewBody, prepared.promptInfo.prompt);
    return typeof response === 'string'
        ? completePreparedReview(prepared, response)
        : completePreparedReview(prepared, response.feedback, { finishReason: response.finishReason });
}

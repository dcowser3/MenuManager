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
import { applyHighConfidenceSuggestionsToMenu } from './apply-high-confidence-suggestions';
import {
    EmbeddedSetMenuAnalysis,
    analyzeEmbeddedSetMenus,
    guardEmbeddedSetMenuPrices,
} from './embedded-set-menu-guard';
import { guardCorrectedMenuPrices } from './price-integrity-guard';
import { RAW_NOTICE_PATTERN, normalizeMenuFooter, stripManagedFooterText } from './menu-footer';
import { QaPromptSectionId, buildFinalPrompt } from './qa-prompt-builder';

export type ReviewSuggestion = {
    type?: string;
    confidence?: string;
    severity?: string;
    menuItem?: string;
    description?: string;
    recommendation?: string;
};

export type ParsedAiResponse = {
    correctedMenu: string;
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

export function enforcePrixFixeCriticalChecks(
    menuContent: string,
    suggestions: ReviewSuggestion[]
): ReviewSuggestion[] {
    const existing = [...(suggestions || [])];
    const nonEmptyLines = (menuContent || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const topWindow = nonEmptyLines.slice(0, 5);

    const topPricePattern = /^\$?\d+(?:[.,]\d+)?(?:\s*\|\s*\$?\d+(?:[.,]\d+)?)?(?:\s*(?:pp|per\s*person|wine\s*pairing))?$/i;
    const hasTopPrixFixePrice = topWindow.some((line) => topPricePattern.test(line));

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

    const hasTopPriceSuggestion = existing.some((s) => {
        const combined = `${s.type || ''} ${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
        return /prix\s*fixe/.test(combined) && /price.*top|top.*price|single.*price/.test(combined);
    });
    const hasCourseNumberSuggestion = existing.some((s) => {
        const combined = `${s.type || ''} ${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
        return /course numbering|numbered courses|course number/.test(combined);
    });

    if (!hasTopPrixFixePrice && !hasTopPriceSuggestion) {
        existing.push({
            type: 'PRICING STRUCTURE',
            confidence: 'high',
            severity: 'critical',
            menuItem: 'Prix Fixe Menu',
            description: 'Prix fixe menu is missing a single top-level price at the top of the menu.',
            recommendation: 'Add a single prix fixe price at the top (optionally with pairing price, e.g., "185 | 85 wine pairing").'
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

    // Remove course numbering suggestions if numbers ARE present (AI false positive)
    if (hasCourseHeadings && !missingCourseNumbers) {
        return existing.filter((s) => {
            const combined = `${s.type || ''} ${s.description || ''} ${s.recommendation || ''}`.toLowerCase();
            return !/course numbering|numbered courses|course number|not numbered/.test(combined);
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
    const correctedMenuMatch = feedback.match(/=== CORRECTED MENU ===\s*\n([\s\S]*?)\n=== END CORRECTED MENU ===/);
    const correctedMenuRaw = correctedMenuMatch ? correctedMenuMatch[1].trim() : originalMenu;

    // Extract suggestions JSON between markers
    const suggestionsMatch = feedback.match(/=== SUGGESTIONS ===\s*\n([\s\S]*?)\n=== END SUGGESTIONS ===/);
    let suggestions: Array<any> = [];

    if (suggestionsMatch) {
        try {
            const jsonStr = suggestionsMatch[1].trim();
            suggestions = JSON.parse(jsonStr);
            console.log(`Parsed ${suggestions.length} suggestions from JSON`);
        } catch (e) {
            console.error('Failed to parse suggestions JSON:', e);
            console.log('Raw suggestions text:', suggestionsMatch[1]);
        }
    }

    // Normalize severity on all suggestions
    suggestions = suggestions.map(s => {
        const type = (s.type || '').toString().trim().toLowerCase();
        const descLower = (s.description || '').toLowerCase();
        const recLower = (s.recommendation || '').toLowerCase();
        const combined = `${descLower} ${recLower}`;

        // Default missing severity to "normal"
        if (!s.severity) {
            s.severity = 'normal';
        }

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

    const correctedMenu = normalizeRawAsteriskPlacement(correctedMenuRaw);

    return {
        correctedMenu,
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
    precheckEnabled: boolean;
    checkId?: string;
};

export type PostAiPipelineResult = {
    parsed: ParsedAiResponse;
    postAiDeterministic: PreAiDeterministicResult;
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
    finalSuggestions: ReviewSuggestion[];
    hasCriticalErrors: boolean;
    criticalSuggestions: ReviewSuggestion[];
};

export function runPostAiPipeline(args: PostAiPipelineArgs): PostAiPipelineResult {
    const parsed = parseAIResponse(args.feedback, args.preCheckedReviewBody);
    const postAiDeterministic = runPreAiDeterministicChecks(parsed.correctedMenu, {
        enabled: args.precheckEnabled,
        property: args.property,
        templateType: args.templateType,
        allergenLegend: args.effectiveReviewAllergens,
        acceptedCorrectionRules: args.acceptedCorrectionRules,
    });
    const titleGuard = preserveLeadingMenuTitle(args.preCheckedReviewBody, postAiDeterministic.menuText);
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

    const correctedMenuSanitized = stripManagedFooterText(correctedAfterHighConfidence);
    const reconciliation = reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics(
        correctedMenuSanitized,
        suggestionsAfterAutoApply
    );
    const reconciledSuggestions = reconciliation.suggestions;

    let finalSuggestions = reconciledSuggestions;

    if (args.menuType === 'prix_fixe') {
        finalSuggestions = enforcePrixFixeCriticalChecks(correctedMenuSanitized, finalSuggestions);
    }
    finalSuggestions = detectKnownTextArtifactSuggestions(correctedMenuSanitized, finalSuggestions);

    const hasCriticalErrors = finalSuggestions.some(s => s.severity === 'critical');
    const criticalSuggestions = finalSuggestions.filter(s => s.severity === 'critical');

    return {
        parsed,
        postAiDeterministic,
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
        finalSuggestions,
        hasCriticalErrors,
        criticalSuggestions,
    };
}

export type FullReviewPipelineOptions = {
    basePrompt: string;
    menuType?: string;
    templateType?: string;
    property?: string;
    allergens?: string;
    acceptedCorrectionRules?: AcceptedCorrectionRule[];
    precheckEnabled?: boolean;
    // F2: when --ablate-sections, omit specific prompt sections for delta measurement.
    omitSections?: import('./qa-prompt-builder').QaPromptSectionId[];
};

export type FullReviewPipelineResult = {
    preAiDeterministic: PreAiDeterministicResult;
    preCheckedReviewBody: string;
    originalMenuSanitized: string;
    effectiveReviewAllergens: string;
    embeddedSetMenuAnalysis: EmbeddedSetMenuAnalysis;
    promptInfo: { prompt: string; sections: QaPromptSectionId[] };
    post: PostAiPipelineResult;
    finalCorrectedMenu: string;
    finalSuggestions: ReviewSuggestion[];
    hasChanges: boolean;
};

// Offline-friendly composition of the full-mode Basic AI Check review:
// footer normalization -> deterministic pre-checks -> prompt assembly -> AI call
// -> post-AI pipeline. The production route runs the same units inline so it can
// interleave HTTP fallbacks, audits, and diagnostics. changed_only mode is a
// route-level concern and is not supported here.
export async function runFullReviewPipeline(
    rawMenuContent: string,
    opts: FullReviewPipelineOptions,
    aiCaller: (text: string, prompt: string) => Promise<string>
): Promise<FullReviewPipelineResult> {
    const precheckEnabled = opts.precheckEnabled !== false;
    const acceptedCorrectionRules = opts.acceptedCorrectionRules || [];

    const reviewFooterMetadata = normalizeMenuFooter(rawMenuContent, opts.allergens || '');
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

    const promptInfo = buildFinalPrompt(opts.basePrompt, {
        menuType: opts.menuType,
        effectiveAllergens: effectiveReviewAllergens,
        changedOnlyMode: false,
        precheckEnabled,
        embeddedSetMenuAnalysis,
    }, { omitSections: opts.omitSections || [] });

    const feedback = await aiCaller(preCheckedReviewBody, promptInfo.prompt);

    const post = runPostAiPipeline({
        feedback,
        preCheckedReviewBody,
        menuType: opts.menuType,
        property: opts.property,
        templateType: opts.templateType,
        effectiveReviewAllergens,
        acceptedCorrectionRules,
        embeddedSetMenuAnalysis,
        precheckEnabled,
    });

    return {
        preAiDeterministic,
        preCheckedReviewBody,
        originalMenuSanitized: reviewFooterMetadata.body,
        effectiveReviewAllergens,
        embeddedSetMenuAnalysis,
        promptInfo,
        post,
        finalCorrectedMenu: post.correctedMenuSanitized,
        finalSuggestions: post.finalSuggestions,
        hasChanges: post.correctedMenuSanitized !== reviewFooterMetadata.body,
    };
}

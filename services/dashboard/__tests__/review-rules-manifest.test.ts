import * as fs from 'fs';
import * as path from 'path';
import { BUILT_IN_REPLACEMENTS } from '../lib/pre-ai-deterministic-rules';
import { QA_PROMPT_SECTIONS } from '../lib/qa-prompt-builder';
import { FORCED_CRITICAL_EXACT_TYPES, FORCED_CRITICAL_NORMALIZED_TYPES } from '../lib/review-pipeline';
import { buildReviewRulesManifest, renderRulesManifestMarkdown } from '../lib/review-rules-manifest';

// Resolve the repo root from either the source layout (__tests__) or the
// compiled layout (dist/__tests__), which sits one level deeper.
const REPO_ROOT_CANDIDATES = [
    path.resolve(__dirname, '..', '..', '..'),
    path.resolve(__dirname, '..', '..', '..', '..'),
];
const REPO_ROOT = REPO_ROOT_CANDIDATES.find((candidate) =>
    fs.existsSync(path.join(candidate, 'docs', 'references'))
) || REPO_ROOT_CANDIDATES[0];
const COMMITTED_MD = path.join(REPO_ROOT, 'docs', 'references', 'code-rules-manifest.md');

// Every guard module wired into runPostAiPipeline must be represented in the
// manifest. Adding a new guard file requires both a manifest entry and an
// addition to this list.
const KNOWN_GUARD_FILES = [
    'services/dashboard/lib/menu-title-guard.ts',
    'services/dashboard/lib/corrected-menu-structure-guard.ts',
    'services/dashboard/lib/allergen-suggestion-guard.ts',
    'services/dashboard/lib/apply-high-confidence-suggestions.ts',
    'services/dashboard/lib/embedded-set-menu-guard.ts',
    'services/dashboard/lib/price-integrity-guard.ts',
];

describe('review rules manifest', () => {
    const manifest = buildReviewRulesManifest({ acceptedCorrectionRules: [] });

    test('committed markdown is up to date (run npm run rules:manifest after rule changes)', () => {
        const rendered = renderRulesManifestMarkdown(manifest, { includeDynamic: false });
        const committed = fs.readFileSync(COMMITTED_MD, 'utf8');
        expect(committed).toBe(rendered);
    });

    test('every built-in replacement has a manifest entry', () => {
        const replacementTitles = new Set(
            manifest.entries
                .filter((entry) => entry.id.startsWith('pre-ai/replacement/'))
                .map((entry) => entry.title)
        );
        for (const replacement of BUILT_IN_REPLACEMENTS) {
            expect(replacementTitles).toContain(`${replacement.from} -> ${replacement.to}`);
        }
        expect(replacementTitles.size).toBe(BUILT_IN_REPLACEMENTS.length);
    });

    test('every prompt section has a manifest entry', () => {
        const sectionIds = new Set(
            manifest.entries
                .filter((entry) => entry.layer === 'prompt_section')
                .map((entry) => (entry.data as { sectionId: string }).sectionId)
        );
        for (const sectionId of Object.keys(QA_PROMPT_SECTIONS)) {
            expect(sectionIds).toContain(sectionId);
        }
    });

    test('every forced-critical type has a manifest entry', () => {
        const criticalData = manifest.entries
            .filter((entry) => entry.id.startsWith('parse/forced-critical/'))
            .map((entry) => (entry.data as { type: string }).type);
        for (const type of [...FORCED_CRITICAL_EXACT_TYPES, ...FORCED_CRITICAL_NORMALIZED_TYPES]) {
            expect(criticalData).toContain(type);
        }
    });

    test('every known guard module is covered by at least one entry', () => {
        const implementationFiles = new Set(manifest.entries.map((entry) => entry.implementation.file));
        for (const guardFile of KNOWN_GUARD_FILES) {
            expect(implementationFiles).toContain(guardFile);
        }
    });

    test('manifest ids are unique', () => {
        const ids = manifest.entries.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('dynamic accepted rules append as dynamic_correction_rule entries', () => {
        const withDynamic = buildReviewRulesManifest({
            acceptedCorrectionRules: [{
                id: 'rule-1',
                original_text: 'veggies',
                corrected_text: 'vegetables',
                change_type: 'spelling',
                rule: 'Use the full word vegetables.',
                applies_to_menu_type: 'all',
                is_location_specific: false,
                location: 'All properties (global rule)',
                other_applicable_locations: [],
                status: 'accepted',
            } as any],
        });
        const dynamicEntries = withDynamic.entries.filter((entry) => entry.layer === 'dynamic_correction_rule');
        expect(dynamicEntries).toHaveLength(1);
        expect(dynamicEntries[0].title).toBe('veggies -> vegetables');
        // Dynamic entries are excluded from the committed markdown.
        const markdown = renderRulesManifestMarkdown(withDynamic, { includeDynamic: false });
        expect(markdown).not.toContain('Dynamic — Accepted reviewer correction rules');
        const fullMarkdown = renderRulesManifestMarkdown(withDynamic, { includeDynamic: true });
        expect(fullMarkdown).toContain('Dynamic — Accepted reviewer correction rules');
    });
});

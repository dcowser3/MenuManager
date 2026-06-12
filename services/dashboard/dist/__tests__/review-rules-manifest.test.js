"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pre_ai_deterministic_rules_1 = require("../lib/pre-ai-deterministic-rules");
const qa_prompt_builder_1 = require("../lib/qa-prompt-builder");
const review_pipeline_1 = require("../lib/review-pipeline");
const review_rules_manifest_1 = require("../lib/review-rules-manifest");
// Resolve the repo root from either the source layout (__tests__) or the
// compiled layout (dist/__tests__), which sits one level deeper.
const REPO_ROOT_CANDIDATES = [
    path.resolve(__dirname, '..', '..', '..'),
    path.resolve(__dirname, '..', '..', '..', '..'),
];
const REPO_ROOT = REPO_ROOT_CANDIDATES.find((candidate) => fs.existsSync(path.join(candidate, 'docs', 'references'))) || REPO_ROOT_CANDIDATES[0];
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
    const manifest = (0, review_rules_manifest_1.buildReviewRulesManifest)({ acceptedCorrectionRules: [] });
    test('committed markdown is up to date (run npm run rules:manifest after rule changes)', () => {
        const rendered = (0, review_rules_manifest_1.renderRulesManifestMarkdown)(manifest, { includeDynamic: false });
        const committed = fs.readFileSync(COMMITTED_MD, 'utf8');
        expect(committed).toBe(rendered);
    });
    test('every built-in replacement has a manifest entry', () => {
        const replacementTitles = new Set(manifest.entries
            .filter((entry) => entry.id.startsWith('pre-ai/replacement/'))
            .map((entry) => entry.title));
        for (const replacement of pre_ai_deterministic_rules_1.BUILT_IN_REPLACEMENTS) {
            expect(replacementTitles).toContain(`${replacement.from} -> ${replacement.to}`);
        }
        expect(replacementTitles.size).toBe(pre_ai_deterministic_rules_1.BUILT_IN_REPLACEMENTS.length);
    });
    test('every prompt section has a manifest entry', () => {
        const sectionIds = new Set(manifest.entries
            .filter((entry) => entry.layer === 'prompt_section')
            .map((entry) => entry.data.sectionId));
        for (const sectionId of Object.keys(qa_prompt_builder_1.QA_PROMPT_SECTIONS)) {
            expect(sectionIds).toContain(sectionId);
        }
    });
    test('every forced-critical type has a manifest entry', () => {
        const criticalData = manifest.entries
            .filter((entry) => entry.id.startsWith('parse/forced-critical/'))
            .map((entry) => entry.data.type);
        for (const type of [...review_pipeline_1.FORCED_CRITICAL_EXACT_TYPES, ...review_pipeline_1.FORCED_CRITICAL_NORMALIZED_TYPES]) {
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
        const withDynamic = (0, review_rules_manifest_1.buildReviewRulesManifest)({
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
                }],
        });
        const dynamicEntries = withDynamic.entries.filter((entry) => entry.layer === 'dynamic_correction_rule');
        expect(dynamicEntries).toHaveLength(1);
        expect(dynamicEntries[0].title).toBe('veggies -> vegetables');
        // Dynamic entries are excluded from the committed markdown.
        const markdown = (0, review_rules_manifest_1.renderRulesManifestMarkdown)(withDynamic, { includeDynamic: false });
        expect(markdown).not.toContain('Dynamic — Accepted reviewer correction rules');
        const fullMarkdown = (0, review_rules_manifest_1.renderRulesManifestMarkdown)(withDynamic, { includeDynamic: true });
        expect(fullMarkdown).toContain('Dynamic — Accepted reviewer correction rules');
    });
});

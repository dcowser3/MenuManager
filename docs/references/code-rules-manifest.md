# Code Rules Manifest

> GENERATED FILE — do not edit by hand. Regenerate with `npm run rules:manifest`.
> A jest test (`review-rules-manifest.test.ts`) fails when this file is stale.

Every rule the menu-review process applies in code, across all layers. The base AI prompt
(`sop-processor/qa_prompt.txt`) carries the natural-language rules; this manifest covers
everything else. Dynamic accepted correction rules are appended at generation time and are
not part of the committed copy.

## Layer 1 — Deterministic pre-AI checks (before the model runs)

### Built-in exact replacements (71)

| From | To | Type |
|------|----|------|
| aji tuna | ahi tuna | Spelling |
| ají tuna | ahi tuna | Spelling |
| ahí tuna | ahi tuna | Spelling |
| áhi tuna | ahi tuna | Spelling |
| aji amarillo | ají amarillo | Diacritics |
| aji panca | ají panca | Diacritics |
| chile de arbol | chile de árbol | Diacritics |
| creme brulee | crème brûlée | Diacritics |
| brulee | brûlée | Diacritics |
| creme fraiche | crème fraîche | Diacritics |
| aji | ají | Diacritics |
| albarino | albariño | Diacritics |
| anejo | añejo | Diacritics |
| cachaca | cachaça | Diacritics |
| cafe | café | Diacritics |
| camaron | camarón | Diacritics |
| chicharron | chicharrón | Diacritics |
| cocteles | cócteles | Diacritics |
| crepes | crêpes | Diacritics |
| entree | entrée | Diacritics |
| flambeed | flambéed | Diacritics |
| genoise | génoise | Diacritics |
| jalapeno | jalapeño | Diacritics |
| pina | piña | Diacritics |
| puree | purée | Diacritics |
| rhone | rhône | Diacritics |
| sauteed | sautéed | Diacritics |
| saute | sauté | Diacritics |
| taquenos | taqueños | Diacritics |
| tequenos | tequeños | Diacritics |
| tequeno | tequeño | Diacritics |
| tajin | tajín | Diacritics |
| tampiquena | tampiqueña | Diacritics |
| huancaina | huancaína | Diacritics |
| patron | Patrón | Diacritics |
| josé cuervo | Jose Cuervo | Diacritics |
| ceasar | caesar | Spelling |
| cesar | caesar | Spelling |
| mozarella | mozzarella | Spelling |
| parmesian | parmesan | Spelling |
| shitake | shiitake | Spelling |
| passion fruits | passion fruit | Spelling |
| passionfruit | passion fruit | Spelling |
| yuzu-kosho | yuzu kosho | Spelling |
| yuzukosho | yuzu kosho | Spelling |
| yuzu khoso | yuzu kosho | Spelling |
| dulche de leche | dulce de leche | Spelling |
| dry chili | dried chili | Spelling |
| honey comb | honeycomb | Spelling |
| chipothle | chipotle | Spelling |
| chipotl | chipotle | Spelling |
| nappa | napa | Spelling |
| sea food | seafood | Spelling |
| pak coy | pak choy | Spelling |
| cashu | cashew | Spelling |
| local grown | locally grown | Spelling |
| jasmin | jasmine | Spelling |
| brussels sprout | brussels sprouts | Spelling |
| veggies | vegetables | Spelling |
| chilli | chili | Spelling |
| pepper corn | peppercorn | Spelling |
| fugeo | fuego | Spelling |
| tamrind | tamarind | Spelling |
| cashew nuts sauce | cashew sauce | Terminology |
| cashew nut sauce | cashew sauce | Terminology |
| macha sauce | salsa macha | Terminology |
| macha salsa | salsa macha | Terminology |
| shimeji pickles | pickled shimeji mushroom | Terminology |
| shimeji pickle | pickled shimeji mushroom | Terminology |
| mayonnaise | aioli | Terminology |
| mayo | aioli | Terminology |

### Allergen code cluster formatting

Allergen-code clusters on a dish line are normalized to uppercase, comma-separated with no spaces, in alphabetical order. Only runs on clusters of known allergen codes.
- `crispy squid g, d,V 18` -> `crispy squid D,G,V 18`

- id: `pre-ai/allergen-cluster-normalization` · category: allergen_codes · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#normalizeAllergenClusterOnLine`

### Tres Leches requires vegetarian code

Tres Leches dessert lines must carry the V (vegetarian) allergen code; it is added to the cluster when missing. Curated code guard promoted from accepted human-review explanations.
- `tres leches, vanilla cream D,G 14` -> `tres leches, vanilla cream D,G,V 14`

- id: `pre-ai/tres-leches-vegetarian-code` · category: allergen_codes · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#ensureTresLechesVegetarianCodeOnLine`

### Named cheeses require cheese modifier

Adds "cheese" after Cotija, mozzarella, feta, or parmesan when used as an ingredient name, preserving capitalization. Already-correct modifiers and hyphenated adjective forms are left unchanged.
- `Esquites, corn, cotija, bacon D 17` -> `Esquites, corn, cotija cheese, bacon D 17`

- id: `pre-ai/cotija-cheese-modifier` · category: terminology · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#ensureCotijaCheeseModifierOnLine`

### Bounded canonical food-word correction

Reviewer-confirmed food words are matched with bounded Damerau edit distance, including adjacent transpositions. Auto-correction requires a unique match with the same first and last letters, limiting collisions with valid culinary, brand, and foreign-language terms.
- `FUGEO MAYO` -> `FUEGO AIOLI`
- `tamrind glaze` -> `tamarind glaze`

- id: `pre-ai/curated-canonical-food-spelling` · category: spelling · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#normalizeCuratedFoodSpellingsOnLine`

### Conservative singular ingredient forms

Applies verified contextual singular-ingredient corrections to comma-delimited descriptions, including jalapeños, prawns, pickles, fruit, vegetables, nuts, peppers, potatoes, croutons, and the explicit pistou herbs override; Prawn before either Tequeño or Tequeños; and a standalone Pickle side. Counted/prepared phrases, other documented plural exceptions, and dish names are preserved.
- `Guacamole, jalapeños, avocado 18` -> `Guacamole, jalapeño, avocado 18`
- `Encocado, black cod, prawns, squid 38` -> `Encocado, black cod, prawn, squid 38`
- `Prawns Tequeño, salsa 18` -> `Prawn Tequeño, salsa 18`
- `Ceviche, cucumber pickles, praline 24` -> `Ceviche, pickle, praline 24`
- `Beet Salad, caramelized walnuts, pistou herbs D,G 18` -> `Beet Salad, caramelized walnut, pistou herb D,G 18`

- id: `pre-ai/singular-ingredient-forms` · category: singular_plural · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#normalizeSingularIngredientFormsOnLine`

### Contextual compound descriptor guards

Three versioned guards generalize preserved review evidence without approving the original proposal rows: established modifier + grilled is joined only before a following food noun, cast iron is hyphenated only as an attributive food descriptor, and brûlée becomes brûléed only before a recognized ingredient. Punctuation, postnominal, material/cookware, crème brûlée, lexical dessert, standalone, and ambiguous uses remain unchanged; prices, allergens, separators, casing, and idempotence are preserved.
- `Achiote Grilled Chicken D,G 29` -> `Achiote-Grilled Chicken D,G 29`
- `Cast Iron Pancakes D,G` -> `Cast-Iron Pancakes D,G`
- `Holiday Ham, brûlée pineapple D` -> `Holiday Ham, brûléed pineapple D`

- id: `pre-ai/contextual-compound-descriptors` · category: terminology · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#normalizeContextualCompoundDescriptorsOnLine`

### Cooked shrimp ceviche raw-marker exception

Shrimp or prawn ceviche is treated as cooked under the approved house rule, so a raw marker is removed or withheld unless the line explicitly says raw/uncooked/undercooked or contains another independently raw preparation.
- `Shrimp Ceviche*, lime, avocado C 24` -> `Shrimp Ceviche, lime, avocado C 24`

- id: `pre-ai/cooked-shrimp-ceviche-marker` · category: raw_markers · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#normalizeShrimpCevicheRawMarkerOnLine`

### Raw-marker spacing normalization (pre-AI, conservative)

When a dish line has exactly one raw marker, spacing drift is fixed: the marker attaches to the last dish/description word and is separated from allergen codes. Lines with zero or multiple markers are left for the post-AI pass.
- `tuna tartare , avocado * D 18` -> `tuna tartare, avocado* D 18`

- id: `pre-ai/raw-asterisk-placement` · category: raw_markers · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#normalizeRawAsteriskPlacementForLine`

### Missing raw-marker insertion for strong raw terms

Adds a missing raw marker to dishes containing strong raw/undercooked terms: tartare, sashimi, ceviche, crudo, tiradito, poke, raw or half-shell oysters, explicit raw tuna/salmon/hamachi/fish/beef, poached egg, sunny-side-up egg, hollandaise, bearnaise/béarnaise, Caesar dressing, tiramisu, cured egg yolk, meringue, and egg white. Explicitly vegan dishes are exempt; preparation names alone are not evidence of raw animal ingredients. Cooked shrimp/prawn ceviche is exempt unless another independently raw term appears. Newly added egg-preparation terms are excluded when the same line states braised, slow-roasted, confit, or well-done.
- `salmon sashimi, ponzu 19` -> `salmon sashimi, ponzu* 19`
- `Vegan Tiradito, cucumber, avocado VG` -> `Vegan Tiradito, cucumber, avocado VG`

- id: `pre-ai/raw-asterisk-insertion` · category: raw_markers · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#shouldAddRawAsterisk`

### Interior salmon option marker

Adds a raw marker only to a bare salmon option inside a comma-separated option line; arbitrary salmon mentions and salmon sauces remain unchanged.
- `grilled chicken, salmon, pasta Bolognese D G` -> `grilled chicken, salmon*, pasta Bolognese D G`

- id: `pre-ai/raw-asterisk-interior-salmon-option` · category: raw_markers · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#addInteriorSalmonOptionMarker`

### Accepted reviewer correction rules (bounded replacements)

Accepted correction_rules rows with safe change types (spelling, diacritic, terminology, grammar, punctuation; both texts <= 240 chars) are applied when the rule scope matches the submitted property and template type. Spelling/diacritic learned rules that include tone marks match accent-insensitively while preserving word boundaries; other learned replacements remain exact. Broad content rules stay reviewer/prompt material. See the dynamic_correction_rule entries for the currently accepted set.

- id: `pre-ai/accepted-correction-rules` · category: learned_rules · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#applyAcceptedCorrectionRules`

### Managed footer extraction before review

Allergen legend lines, the canonical foodborne-illness notice, and price/welcome boilerplate are detected and removed from the review body before deterministic checks and the AI call; the extracted allergen legend becomes the effective allergen key when none was provided.

- id: `pre-ai/footer-normalization` · category: footer · implementation: `services/dashboard/lib/menu-footer.ts#normalizeMenuFooter`

## Layer 2 — Runtime prompt sections (instructions added to the base prompt)

### Prompt section: accepted_scoped_policy

Authoritative accepted term pairs from the shared scope and conflict resolver. Applies when: applicable accepted policies or conflicts.

- id: `prompt/accepted_scoped_policy` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: raw_marker_placement

Instructs the AI to preserve the author's raw-marker (*) placement as house style; missing markers are still flagged but none are moved. Applies when: rulebook.rawMarkerPlacement === 'preserve'.

- id: `prompt/raw_marker_placement` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: prix_fixe

Prix fixe pricing/course-numbering rules; suppresses per-dish missing-price flags and requires a single top price plus numbered courses. Applies when: menuType === 'prix_fixe'.

- id: `prompt/prix_fixe` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: allergens

Injects the custom or footer-extracted allergen key and restricts allergen checking to those codes. Applies when: effective allergen legend is non-empty.

- id: `prompt/allergens` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: corrected_menu_structure_rules

Requires the CORRECTED MENU block to preserve every submitted line in order with no merges, splits, reorders, or deletions. Applies when: always.

- id: `prompt/corrected_menu_structure_rules` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: pre_ai_deterministic_checks

Tells the model deterministic pre-AI fixes were already applied so it does not re-report them. Applies when: BASIC_AI_PRECHECK_ENABLED.

- id: `prompt/pre_ai_deterministic_checks` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: changed_only_scope

Restricts a revision review to changed excerpts only and pins the corrected output to the same lines. Applies when: reviewMode === 'changed_only' with a baseline.

- id: `prompt/changed_only_scope` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: footer_rules

Excludes the allergen legend and the canonical foodborne-illness footer from review scope. Applies when: always.

- id: `prompt/footer_rules` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: add_on_price_rules

Treats numbers after add-on options (pipe/slash separated) as that option price; prevents false Missing Price flags on add-on rows. Applies when: always.

- id: `prompt/add_on_price_rules` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: standard_item_price_rules

Treats a trailing whole number as a valid price even without allergen codes before it. Applies when: always.

- id: `prompt/standard_item_price_rules` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: selection_instruction_rules

Treats standalone selection instructions such as "choose one" as menu instructions, not dish entries with incomplete names. Applies when: always.

- id: `prompt/selection_instruction_rules` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: embedded_set_menu_rules

Explains detected embedded set-menu sections (package title + total price + choice-of headings) so included dishes are not flagged for missing prices. Applies when: embedded set-menu sections detected in a non prix-fixe menu.

- id: `prompt/embedded_set_menu_rules` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: canonical_vocabulary_near_misses

Lists candidate near-misses with stable IDs and requires an explicit contextual disposition for each. Historical-menu evidence is advisory; only an AI-confirmed high-confidence unresolved nonword becomes a blocking issue. Applies when: near-miss findings were computed for this menu (CANONICAL_VOCABULARY_ENABLED).

- id: `prompt/canonical_vocabulary_near_misses` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

### Prompt section: contextual_spelling_adjudication

Requires contextual spelling decisions, permits high-confidence automatic corrections, and makes only confidently malformed terms with no safe correction blocking and overrideable. Applies when: always.

- id: `prompt/contextual_spelling_adjudication` · category: prompt · implementation: `services/dashboard/lib/qa-prompt-builder.ts#buildFinalPrompt`

## Layer 3 — Response parsing and severity normalization

### Missing severity defaults to normal

AI suggestions without a severity are assigned severity "normal" before any critical forcing runs.

- id: `parse/severity-default-normal` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#parseAIResponse`

### String suggestions normalize to review-note objects

A bare string in the AI suggestions array is normalized at the parse boundary to a canonical General Review Note object with medium confidence and normal severity, so downstream review guards can score it safely.

- id: `parse/string-suggestion-normalization` · category: response_shape · implementation: `services/dashboard/lib/review-pipeline.ts#parseAIResponse`

### Prix-fixe top-price and course-numbering phrases force critical

Suggestions whose description/recommendation mention a prix fixe price at the top of the menu, or prix-fixe course numbering, are forced to critical severity even when the AI omitted the type.

- id: `parse/prix-fixe-phrase-critical` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#parseAIResponse`

### Missing price / dish-name description fallback

Non-critical suggestions whose description matches missing-price or missing/incomplete-dish-name phrasing are reclassified to the corresponding critical type (safety net for mistyped AI output).

- id: `parse/missing-price-description-fallback` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#parseAIResponse`

### Raw-marker canonicalization (post-AI, aggressive)

Every raw marker on a dish line of the AI-corrected menu is stripped and exactly one is reinserted at the canonical position: attached to the last description word, before trailing allergen codes and price. Titles, legends, and the raw notice are skipped.
- `Steak Tartare*, capers, egg yolk D,G 24` -> `Steak Tartare, capers, egg yolk* D,G 24`

- id: `parse/raw-asterisk-canonicalization` · category: raw_markers · implementation: `services/dashboard/lib/review-pipeline.ts#normalizeRawAsteriskPlacement`

### Forced critical type: Missing Price

AI suggestions with the exact type "Missing Price" are always forced to critical severity (blocks submission until overridden).

- id: `parse/forced-critical/missing-price` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#FORCED_CRITICAL_EXACT_TYPES`

### Forced critical type: Incomplete Dish Name

AI suggestions with the exact type "Incomplete Dish Name" are always forced to critical severity (blocks submission until overridden).

- id: `parse/forced-critical/incomplete-dish-name` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#FORCED_CRITICAL_EXACT_TYPES`

### Forced critical type: set menu item price

AI suggestions whose lowercased type equals "set menu item price" are always forced to critical severity.

- id: `parse/forced-critical/set-menu-item-price` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#FORCED_CRITICAL_NORMALIZED_TYPES`

### Forced critical type: course progression

AI suggestions whose lowercased type equals "course progression" are always forced to critical severity.

- id: `parse/forced-critical/course-progression` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#FORCED_CRITICAL_NORMALIZED_TYPES`

### Forced critical type: pricing structure

AI suggestions whose lowercased type equals "pricing structure" are always forced to critical severity.

- id: `parse/forced-critical/pricing-structure` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#FORCED_CRITICAL_NORMALIZED_TYPES`

### High-confidence forced critical type: unrecognized term

AI suggestions whose lowercased type equals "unrecognized term" are forced to critical severity only when confidence is high.

- id: `parse/forced-critical/unrecognized-term-high-confidence` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#FORCED_CRITICAL_HIGH_CONFIDENCE_TYPES`

## Layer 4 — Post-AI guards (model output corrections)

### Post-AI deterministic cleanup

The full deterministic pre-AI pass is re-applied to the AI-corrected menu so the model cannot reintroduce drift (unsorted allergen clusters, spaced raw markers, reverted replacements).

- id: `post-ai/deterministic-re-run` · category: deterministic · implementation: `services/dashboard/lib/pre-ai-deterministic-rules.ts#runPreAiDeterministicChecks`

### Unresolved canonical spelling finding guarantee

The model receives contextual near misses first. If it leaves a unique non-ambiguous reviewer/corpus match unchanged and does not mention it, the pipeline adds a medium-confidence, normal-severity spelling suggestion so the possible typo cannot silently pass. Ambiguous matches never synthesize a correction.

- id: `post-ai/canonical-spelling-suggestion-guarantee` · category: spelling · implementation: `services/dashboard/lib/canonical-vocabulary.ts#ensureCanonicalSpellingSuggestions`

### Protected culinary terms

Restores protected phrases that were present in the submitted menu if the AI rewrites them in its corrected-menu output. This guard is anchored to the original line and runs before the remaining post-AI guards.
- `picked herbs` -> `picked herbs`
- `twice-baked` -> `twice-baked`
- `marinated 24 hours` -> `marinated 24 hours`

- id: `post-ai/protected-terms` · category: protected_terms · implementation: `services/dashboard/lib/protected-terms-guard.ts#restoreProtectedTerms`

### Leading menu title preservation

Restores a leading "Menu"/"Menus" title line when the AI-corrected output dropped it.

- id: `post-ai/menu-title-guard` · category: structure · implementation: `services/dashboard/lib/menu-title-guard.ts#preserveLeadingMenuTitle`

### Corrected-menu structure guard

Rejects an AI-corrected menu that distorts line structure (merged, split, omitted, or reordered lines) and falls back to the pre-AI text; suggestions still apply.

- id: `post-ai/structure-guard` · category: structure · implementation: `services/dashboard/lib/corrected-menu-structure-guard.ts#assessCorrectedMenuStructure`

### Allergen alphabetization suggestion guard

Drops AI suggestions asking to alphabetize allergen codes when the corrected menu already has them in the required order.

- id: `post-ai/allergen-suggestion-guard` · category: allergen_codes · implementation: `services/dashboard/lib/allergen-suggestion-guard.ts#guardAllergenAlphabetizationSuggestions`

### Submitted allergen source preservation

Latest submitted/pre-AI allergen codes are authoritative across model and final delivery lanes; candidate-only additions are stripped and ambiguous row attribution fails closed while supported price bytes remain unchanged.

- id: `post-ai/submitted-allergen-preservation` · category: allergen_codes · implementation: `services/dashboard/lib/allergen-source-preservation.ts#preserveSubmittedAllergenCodes`

### High-confidence suggestion auto-apply

High-confidence spelling/grammar suggestions with an extractable from->to pair are applied directly to the corrected menu and removed from the remaining suggestion list.

- id: `post-ai/high-confidence-auto-apply` · category: auto_apply · implementation: `services/dashboard/lib/apply-high-confidence-suggestions.ts#applyHighConfidenceSuggestionsToMenu`

### Embedded set-menu price guard

For detected embedded set menus (package title + total price + choice-of headings): restores included set-section dish prices the AI removed, drops false Missing Price suggestions for included dishes, and synthesizes critical Set Menu Item Price suggestions for bare included-item prices.

- id: `post-ai/embedded-set-menu-guard` · category: pricing · implementation: `services/dashboard/lib/embedded-set-menu-guard.ts#guardEmbeddedSetMenuPrices`

### Price integrity guard

Prevents the AI from adding or changing trailing prices: corrected-menu prices are reconciled against the submitted text and unauthorized price edits are reverted.

- id: `post-ai/price-integrity-guard` · category: pricing · implementation: `services/dashboard/lib/price-integrity-guard.ts#guardCorrectedMenuPrices`

### Managed footer strip on corrected output

The corrected menu is stripped of managed footer content (allergen legend, raw notice, price/welcome boilerplate) before reconciliation, mirroring the pre-review normalization.

- id: `post-ai/footer-strip` · category: footer · implementation: `services/dashboard/lib/menu-footer.ts#stripManagedFooterText`

### Managed raw-notice finding suppression

Only a canonical tenant raw-food notice may suppress a whole-menu generic missing-notice duplicate; dish-specific, malformed, negated, or unrelated safety findings remain actionable.

- id: `post-ai/managed-raw-notice-suppression` · category: footer · implementation: `services/dashboard/lib/menu-footer.ts#isGenericMissingCanonicalRawNoticeFinding`

## Layer 5 — Reconciliation and deterministic critical checks

### Allergen delivery claim reconciliation

Model claims about added or retained allergen codes are reconciled against the submitted and delivered row bytes; unverified claims remain advisory and never assert an unapplied change.

- id: `post-ai/allergen-delivery-claim-reconciliation` · category: allergen_codes · implementation: `services/dashboard/lib/allergen-delivery-reconciliation.ts#reconcileAllergenDeliveryClaims`

### Resolved-critical reconciliation

Critical suggestions already resolved in the corrected menu are dropped: Missing Price when the matched line (including continuation lines) now ends in a price; Incomplete Dish Name when the line gained substance or the flagged token is gone.

- id: `reconcile/critical-resolution` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics`

### Selection instruction critical false-positive filter

Incomplete Dish Name critical suggestions are dropped when the matched line is a standalone selection instruction such as "choose one", "choice of one", "select two", or "pick your entree". These lines are preserved as menu instructions, not dish entries.
- `choose one -> Incomplete Dish Name critical` -> `choose one -> no blocker`

- id: `reconcile/selection-instruction-critical-filter` · category: severity · implementation: `services/dashboard/lib/review-pipeline.ts#reconcileCriticalSuggestionsAgainstCorrectedMenuWithDiagnostics`

### Prix-fixe deterministic critical checks

For prix fixe menus: synthesizes a critical PRICING STRUCTURE suggestion when no top-level price (incl. PP/per-person/pairing formats) appears in the first five lines, synthesizes critical COURSE NUMBERING when two or more course headings lack numbers, and removes AI course-numbering false positives when numbers are present. Prix fixe menus are exempt from per-dish missing-price criticals.

- id: `reconcile/prix-fixe-enforcement` · category: prix_fixe · implementation: `services/dashboard/lib/review-pipeline.ts#enforcePrixFixeCriticalChecks`

### Known text-artifact suggestions

Adds non-critical, high-confidence suggestions for known malformed wine/geography terms that often come from DOCX redline cleanup or obvious submitter typos, without auto-correcting or blocking submission.
- `Fleur de Mere, Rosé, ctes de provence, france GL 18/BTL 82` -> `Possible Extraction Typo suggestion: Change "ctes de provence" to "côtes de provence".`

- id: `reconcile/known-text-artifact-suggestions` · category: spelling · implementation: `services/dashboard/lib/review-pipeline.ts#detectKnownTextArtifactSuggestions`

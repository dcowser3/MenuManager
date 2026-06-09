# Approved Dish Quality And Provenance

## Status

Implemented.

## Goals

Approved dishes are a reviewable catalog, not an auto-cleaned master menu. The default quality pass is flag-first:

- suspicious existing rows stay visible until a targeted repair/re-extraction is run for their source submission
- duplicate rows remain visible unless a future manual cleanup explicitly hides them
- each row shows its source submission so reviewers can understand how it entered the database
- future extraction runs avoid appending repeated generations for the same submission

## Data Flow

Approved-dish extraction still starts from approved menu text and writes rows to `approved_dishes`. The shared extractor now prepares candidate rows, runs deterministic quality analysis, and stores only rows that are not clear non-dishes.

For beverage menus, deterministic extraction handles the common DOCX layout problems before AI review. Known beverage section headers such as `Pick Me Up`, `Cocteles`, `Zero Proof`, `Espumoso`, `Blanco`, `Rosado`, `Rojo`, `Cerveza`, `Flights`, `Mezcal`, and `Vino by the Bottle` update `menu_category` instead of becoming dish names. Visual leader runs are stripped from names before storage, so rows like `Acqua Panna 1 liter........ 8` store as `Acqua Panna 1 liter` with price `8`. Beverage rows that use `name price` followed by a no-price ingredient line consume that next line as `description`, while bare beverage names such as `Topo Chico` do not steal the next priced item.

For DB-service extraction, only targeted review-level issues are sent to `ai-review` through `POST /approved-dishes/quality-check`, batched in chunks of 100 rows. The AI response is advisory and only high-confidence `not_dish` rows are excluded. If the AI service or API key is unavailable, deterministic rules still run and extraction continues.

Future DB extraction replaces visible rows for the same `source_submission_id` after a successful non-empty extraction by deactivating the prior rows and inserting the new extraction result. This prevents repeated approval or backfill runs from appending another generation of identical active rows while retaining the old rows for audit history.

## Quality Signals

The shared analyzer emits stable issue codes used by the dashboard, audit scripts, and import dry-runs. Important codes include:

- `pricing_grid_as_dish`: pricing-grid text such as `À La Carte PricingAntojitos`
- `category_description_contamination`: a category field that looks like a dish description
- `instruction_text_name`: service/instruction copy parsed as a dish name
- `bare_low_info_dish`: a plausible priced dish with no description
- `beverage_heading_as_name`: a beverage section header parsed as a dish name
- `layout_leader_in_name`: repeated visual leader punctuation remained in a name
- `beverage_name_description_swap`: beverage ingredients appear to be stored as the name with the real name in `description`
- `exact_duplicate_within_submission`: exact repeated row from the same source submission
- `missing_source_submission`: row lacks provenance

High-confidence non-dish patterns are excluded from future writes. Informational flags remain visible for review. Exact duplicate rows are still flagged, but same-name rows in different categories are allowed because menus often reuse a name for legitimate variants such as taco and fajita proteins.

When a section has shared serving copy, such as Tamayo Fajitas' "served with flour tortillas..." line, the extractor stores that copy as the description for bare protein rows instead of storing the serving line as its own dish.

Source provenance prefers the extractor-captured source line and line number instead of fuzzy re-finding by dish name. Dashboard row details and AI-review prompts therefore show the actual row that produced the candidate when available.

## Dashboard Behavior

`/approved-dishes` and brand pages join approved dishes to their source submissions. Brand tables include:

- `Quality`: deterministic flags and severity
- `Source`: compact source filename/project label
- row details: source type, ClickUp task, reviewed/updated date, dish id, source submission id, legacy id, ClickUp link when available, approved-menu download link, and source-line context when available

The page remains a browse/review surface. It does not include delete, edit, merge, or dedupe controls.

## Operational Checks

Use Tamayo - Denver as the pilot property because it has known examples of pricing text, duplicate extraction generations, and category contamination.

Run extraction in preview/dry-run mode before writing. Bulk ClickUp imports now add quality warnings to the dry-run report and keep warning rows out of `--apply --only-clean`.

For targeted data repair, reprocess the affected source submissions with the shared extractor after confirming the dry-run has no high-severity quality rows. The reusable command is:

```bash
npm run repair:approved-dishes -- --all
npm run repair:approved-dishes -- --brand Tamayo
npm run repair:approved-dishes -- --property "Tamayo - Denver" --apply
docker compose -f docker-compose.dev.yml exec -T dashboard npm run repair:approved-dishes -- --all
```

The repair command compares active rows to a fresh extraction from the source submission's approved menu text. It scans active approved dishes with stable pagination so large cross-property runs do not duplicate or omit rows at page boundaries. A candidate is eligible only when the new extraction is non-empty, has zero high/exclude quality rows, stays inside the configured row-count drop safety cap, and removes an obvious problem such as pricing rows, category contamination, instruction text, exact duplicates, or blank descriptions. `--include-clean` allows changed clean rows that do not improve those metrics, and `--max-count-drop-ratio` adjusts the default 70% safety cap. Apply mode deactivates the previous active rows for each repaired `source_submission_id` and inserts the clean extraction output, leaving old rows available in Supabase for audit history but removing them from the dashboard.

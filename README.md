# Menu Manager

Menu Manager is an AI-powered service designed to automate the review process for menu design submissions. Chefs worldwide submit their menus via a web form, choose the property, menu type, and service period, and the system guides the submission through review and approval with AI-assisted corrections.

## Vision

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHEF SUBMISSION                                   │
│  Chef → Web Form → Select Reviewer(s) → Upload Menu → Notification Sent     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MULTI-LEVEL APPROVAL                                │
│  Reviewer 1 Dashboard → Download → Review → Upload Corrections → Approve    │
│         ↓ (if needed)                                                       │
│  Reviewer 2 Dashboard → Final Review → Approve → ClickUp Task Created       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         APPROVED DISHES DATABASE                            │
│  Extract dishes from approved menus → Store in searchable database          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Features

### Current (Phase 1)
- Web form for chef submissions
- Canonical property selection (type-to-search, value must match configured list)
- The dashboard includes a fallback property catalog so deployed forms can still search and validate properties if the DB property endpoint is temporarily unavailable
- DOCX template uploads can prefill project details and resolve split outlet/hotel/city hints to a canonical property when the match is unique
- Required service-period classification on submission (`breakfast`, `brunch`, `lunch`, `dinner`, `happy_hour`, `holiday`, `other`)
- AI-powered two-tier review (general QA + detailed corrections)
- Basic AI Check runs deterministic pre-AI corrections before calling the model: approved exact spelling/diacritic replacements, allergen-code formatting, strong raw-item markers with the asterisk attached to the last dish/description word, curated guards promoted from accepted human-review explanations, and accepted human-reviewed correction rules from learning are applied first so the AI prompt can focus on contextual issues. The same deterministic cleanup is reapplied to the model's corrected menu before returning results, and the older post-AI safety net still applies objective fixes the model reports but forgets to place in corrected text, filters false allergen alphabetization suggestions, and preserves a leading standalone `Menu` title.
- Basic AI Check rejects structurally unsafe corrected-menu responses that are much shorter than the submitted text or omit many submitted words/lines, so a model summary cannot replace the chef's menu content.
- Basic AI Check also enforces price integrity after the model responds: if the AI adds a price to an unpriced line or changes an existing submitted price value, the backend removes/restores that price before showing the corrected menu and keeps or creates the critical Missing Price blocker for human review.
- Basic AI Check treats a bare trailing whole number as a valid item price even when the item has no allergen-code cluster, and it can suppress false Missing Price suggestions when a model wraps the item description onto a continuation line.
- Basic AI Check suppresses missing-price false positives on add-on rows when an option already has a same-line price, such as `add chorizo 5 | mushrooms V 4`.
- Basic AI Check recognizes embedded set-menu sections inside standard menus, such as `Quick Lunch Menu $38` with `choice of one appetizer & one entree`; included dishes do not need item prices, explicit `+` premium prices are allowed, and bare included-item prices are flagged as critical `Set Menu Item Price` issues without being auto-removed.
- Basic AI Check now runs as an async dashboard job: the form starts a check, keeps submit blocked while it polls status, then unlocks only after AI results arrive or an explicit AI-unavailable/manual-review fallback is returned.
- If a chef edits the reviewed menu after the first Basic AI Check, the form still requires one re-run. After the second completed Basic AI Check, later edits are allowed through final submit so the chef can keep an intentional correction the AI keeps undoing.
- If the Basic AI Check service call fails, the public form keeps any deterministic pre-AI corrections that were already applied, shows an AI-unavailable warning, and allows the submission to continue to manual review instead of blocking the chef on a red error.
- For local debugging, open the form with `?debugBasicCheck=1` to include Basic AI Check diagnostics in the Network response and `window.lastBasicCheckDiagnostics`; production requires `BASIC_AI_CHECK_DEBUG_ENABLED=true`.
- `npm run smoke:basic-ai-check` runs a live async Basic AI Check smoke test against `DASHBOARD_URL` and can be configured to alert on AI-unavailable fallback.
- `npm run preai:ab-replay` runs an offline DOCX-pair replay over the curated `Training Menus` pairs, comparing historical source text against the same text after deterministic pre-AI checks and using paired human/redlined DOCX files as the target. Use `-- --source all` to include the broader sample pairs. It writes reports under `tmp/pre-ai-ab-replay/`.
- Learning/training dashboards stay off the public landing page; they are reachable by direct URL like other reviewer tools (no separate PIN step)
- Pending system-proposed learning rules can expand evidence examples showing the exact AI draft line and final approved DOCX line from eligible human-review approvals. Quick approvals, imports/backfills, AI-only changes, identical final docs, and duplicate finalizations do not feed new rule counts.
- The learning dashboard shows active pre-AI rules in a compact section, collapses the accepted-rule audit log, hides stale system proposals without current eligible evidence, and no longer displays the full AI prompt inline.
- Review highlights and persistent redlines surface punctuation/separator edits such as hyphen, comma, slash, and pipe changes
- New-menu AI review preserves pasted inline formatting such as bold dish names by projecting source HTML styles onto the corrected text with shared `diff-core` token alignment before applying green AI-change highlights.
- Modification previews preserve bold/italic inline styling from uploaded prior approved DOCX baselines, including DOCX non-breaking-space text, body-only rich HTML with preserved footer text, and live edits, by using the shared `diff-core` rich text range mapper.
- Uploaded unapproved/redlined DOCX modifications derive a synthetic original/current pair from the uploaded redlines: the left editor shows clean accepted text with bold/italic preserved, while the right persistent preview recreates the uploaded redlines through the standard dynamic diff.
- Submission normalization keeps exactly one managed allergen legend, while preserving chef-supplied legal/price/footer copy such as AED service-charge text and venue-specific foodborne warnings
- Modification previews exclude managed footer boilerplate from design-facing redlines while still preserving custom restaurant footer notes/raw warnings for generated DOCX output
- DOCX baseline uploads now prefill the allergen key field from either pipe-delimited legends or parenthesized legends such as `(C) CELERY (D) DAIRY`
- Brand-new menu submissions can import menu content from a DOCX before Basic AI Check; the form reuses the clean DOCX extraction path used by uploaded modification baselines and preloads detected project details, allergens, and raw-item notice state.
- DOCX project-detail extraction fills fields only when values are clean and confident; missing, ambiguous, or invalid extracted metadata is ignored quietly so submitters can complete the fields themselves
- Turnaround values are calculated in business days for the read-only `Date Needed` field, so weekends are skipped
- The default allergen legend is now `G contains gluten | V vegetarian | D contains dairy | S contain shellfish | N contain nuts | VG vegan`
- Approved-dish extraction now splits inline `Dish Name - description` menu rows into separate `dish_name` and `description` fields, captures trailing allergen codes, and skips the allergen legend / food-safety footer instead of storing them as dishes
- DOCX template validation and redlining
- Modification uploads with preserved redlines remain usable even if project metadata extraction cannot be parsed from the DOCX
- Public upload endpoints now enforce a 15 MB cap, validate file signatures, and sanitize stored rich-text/filename input before downstream processing; menu filenames preserve Unicode letters such as accented characters and tone marks
- Rich-text form submissions above Express's default 100 KB JSON body limit are accepted by the dashboard and DB services; override `JSON_BODY_LIMIT`, `DASHBOARD_JSON_BODY_LIMIT`, or `DB_JSON_BODY_LIMIT` only when deployment needs a different cap
- Public form attempts now emit lightweight `form_attempt_logs` telemetry for baseline uploads, Basic AI Check, final submit, and parser-level `413` failures so failed preserve-redlines submissions can be diagnosed even when no final submission row exists
- Production public-form failure events also email `FORM_ATTEMPT_ALERT_EMAIL`, defaulting to `dcowser@richardsandoval.com`, through the dashboard SMTP transport
- Required-field validation now highlights missing submitter, project-details, and approval inputs directly in the form
- The submission form footer and blocking/red form errors list `PUBLIC_FORM_SUPPORT_EMAIL` (default `dcowser@richardsandoval.com`) as the support contact for help.
- Isabella's review queue is available by direct link at `/reviews` (legacy `/review-queue` still redirects there), but it is intentionally not linked from the public welcome dashboard and `/dashboard` now returns to the welcome screen. The queue lists submissions whose Menu Manager DB status still needs human review and links each row to the browser approval editor. Isabella-submitted direct handoffs that have already been sent to ClickUp/Marketing are excluded from this queue.
- Notification system
- Approved dishes are extracted automatically when the ClickUp-reviewed DOCX is marked approved
- ClickUp tasks now include a browser approval link that opens a side-by-side approval editor: clean text editing on the left, live redline/highlight preview on the right, and final DOCX generation on submit
- Approved menus now appear in a dedicated dashboard so operations can download the finalized Word document only after Isabella approves it
- Approved dishes now appear in a dashboard at `/approved-dishes`, grouped by derived brand and subdivided by canonical property/location; brand tables include per-column filtering, sortable headers, quality flags, and source submission details

### Planned (Phase 2)
- **Web Form Submission** - Chefs upload menus and select reviewers via web form
- **Multi-Level Approval** - Configurable approval chains with email notifications
- **ClickUp Integration** - Automatic task creation for reviewers and final handoff
- **Approved Dishes Database** - Expanded editing and maintenance tools for extracted approved dishes

## Project Architecture

This project is a **monorepo** using npm workspaces with independent microservices:

```
services/
├── ai-review/        # Two-tier AI review (QA + corrections)
├── clickup-integration/ # ClickUp API + webhook + corrections email
├── dashboard/        # Web interface for reviewers + submission form
├── db/               # Database service
├── diff-core/        # Shared tokenization + LCS diff helpers
├── differ/           # AI vs human comparison for training
├── docx-redliner/    # DOCX track changes
├── parser/           # DOCX validation and extraction
└── supabase-client/  # Shared Supabase database client
```

### Planned Services
```
services/
├── submission-form/      # Public chef submission form
├── workflow-engine/      # Multi-level approval orchestration
├── clickup-integration/  # ClickUp API integration
└── approved-dishes/      # Dish extraction & database
```

## The Review Workflow

1. **Submission** - Chef uploads menu via web form, selects property from the configured catalog, and sets menu type plus service period
2. **Template Validation** - System validates `.docx` structure
3. **Tier 1 AI Review** - High-level QA check (spelling, grammar, clarity)
4. **Decision Point** - If issues found, chef is notified to resubmit
5. **Tier 2 AI Review** - Detailed corrections based on SOP rules
6. **Human Review** - Reviewer downloads, reviews, uploads corrections
7. **Multi-Level Approval** - Additional reviewers if required
8. **ClickUp Integration** - Submission creates a ClickUp task and final approval writes the approved DOCX back into Menu Manager for downstream delivery and download
9. **Dishes Database** - Approved dishes extracted from the approved menu text and stored

Current ClickUp BAU status handoff:
- New tasks start in `Pending Initial ISA Review`
- New tasks are assigned through `CLICKUP_ASSIGNEE_ID` (Isabella in production) and add Marketing group members as watchers when the ClickUp group lookup is configured; submissions from `isabella@richardsandoval.com` route directly to `CLICKUP_POST_APPROVAL_STATUS` (`To Do` by default), assign the resolved Marketing users, and update Menu Manager to `sent_to_marketing` instead of leaving the row in Isabella's review queue, even when `CLICKUP_CORRECTIONS_STATUS` is a different review-complete trigger such as `approved`
- Isabella uploads the corrected DOCX in ClickUp and moves the task to `To Do`; that status change downloads the latest DOCX and feeds the learning dashboard
- When the approved DOCX is processed from any configured review-complete status, the task is assigned to the resolved Marketing users and the configured initial reviewer is removed when applicable; the task is then moved to `To Do`, or the status update is skipped if it is already there
- Task due date is taken from the form "Date needed" using noon UTC on that calendar day so ClickUp does not display it one day early in US timezones (plain `YYYY-MM-DD` parsing used to mean UTC midnight)
- If ClickUp task creation or attachment upload fails after the menu is saved, the submitter warning includes the submission reference so support can match the screenshot to logs, `system_alerts`, and the generated DOCX.
- Submitter-facing ClickUp handoff warnings use `PUBLIC_FORM_SUPPORT_EMAIL` (default `dcowser@richardsandoval.com`), and the dashboard waits up to `CLICKUP_TASK_CREATE_TIMEOUT_MS` (default `60000`) for ClickUp task creation before showing that fallback.
- ClickUp task descriptions now spell out the selected modification workflow path instead of showing only raw `modification` / `revision_source` values.
- Pending submissions that saved successfully but have no `clickup_task_id` can be retried from the review page; retry metadata is kept in `raw_payload.clickup_handoff`.

Browser approval editor prototype:
- ClickUp tasks now include an approval link to `/approval/:submissionId`
- Isabella can open `/reviews` directly to see every pending human-review or manual-review submission; the queue is intentionally unlisted from the main welcome dashboard.
- When the dashboard form is submitted from `localhost` outside production, ClickUp task creation is skipped, the browser automatically downloads the generated original DOCX, and the success alert shows an `Open approval editor` link for that same submission
- Isabella can edit approved text in a left-side rich browser editor while a right-side panel shows the live tracked-change preview with preserved imported redlines/highlights
- For submitted DOCX files that already contain redlines, the left editor uses the clean accepted text with deleted runs removed, accepted inserted runs unwrapped, and DOCX inline formatting such as bold dish names preserved; the preview keeps the imported deletion/insertion markup visible.
- The browser approval preview and the backend differ service use shared `diff-core` tokenization/LCS helpers so punctuation, separator, and word alignment rules are reused instead of duplicated per page/service.
- The approval editor preview is rendered in the browser and does not call the `differ` service while the reviewer types; `differ` remains the backend training/learning comparison service after human approval.
- The live approval preview keeps adjacent imported deletion/insertion pairs separated after new edits, so corrections like `jalapeno` → `jalapeño` or `neapolitan` → `Neapolitan` do not get re-styled as one combined deleted token when another word is removed.
- The live approval preview keeps inline imported deletions anchored inside fully inserted rows after unrelated nearby edits, so a top-line wording change does not duplicate or move redlined text on the next menu item.
- The approval editor anchors imported DOCX redlines with extractor-provided paragraph annotation ranges and uses a preview-derived clean baseline internally, so deleting blank spacer rows does not shift existing redlines into repeated nearby words or prices.
- The live approval preview reflects rich formatting from the left editor for accepted and newly inserted text, so manual bolding stays visible on the right while deleted text keeps the original baseline styling.
- Imported-redline approval-editor previews update automatically through a browser worker with a right-panel loading indicator, one in-flight render, coalesced latest edits, stale-response guards, and timeout recovery so the preview cannot stay stuck on `Updating Preview`.
- Imported-redline preview resolving caches the shared baseline/revised token alignment once per render instead of rebuilding it for every imported annotation group; the Venga fixture benchmark should stay under one second on a local dev machine.
- The live approval preview preserves whole-row boundaries for imported deleted dishes after reviewer edits, so deleted prices stay on their own row instead of merging into the next accepted dish.
- Uploaded unapproved/redlined DOCX modifications now receive a full AI check on the accepted visible menu text, so pre-existing tracked edits such as misspelled inserted words are reviewed even if the chef makes no additional browser edits. Imported deletions/crossed-out dishes are excluded from the AI-review payload while remaining visible in the editor and persistent preview.
- Uploaded unapproved/redlined DOCX modifications keep the left revision editor clean by removing imported deletion text and unwrapping imported insertion text while preserving bold/italic markup; the right preview shows the uploaded changes by diffing the synthetic original against the current left-editor text.
- Re-running AI Check reuses the normalized editor text extractor so repeated checks do not add browser-generated blank lines between menu rows.
- Modification flows keep footer/legal copy out of the persistent redline preview, but submit it as structured preserved footer text so restaurant-specific notes and raw-food warnings are retained instead of replaced by the default notice.
- Form submission now persists uploaded approved-baseline modifications before triggering the full Tier 2 AI review asynchronously, reducing gateway timeouts on slow AI review calls; non-JSON proxy errors also show a readable submit error instead of raw HTML parsing text.
- The dashboard form now defaults to `Modification to Existing Menu`; the modification source chooser still starts blank so chefs must intentionally choose how to load the baseline.
- The `I already made my menu edits on a doc` option shows `Upload Unapproved DOCX (Preserve Redlines)` as helper text so the redline-preserving upload path is still clear.
- The modification source chooser starts blank so chefs must pick a path. The `I'll make menu changes here` path recommends choosing an approved baseline from the database; submitted ClickUp tasks appear there after the approved DOCX is processed, and DB/search failures now show as search failures instead of empty results. If the approved menu is not in the database yet, the same path lets the chef choose a prior approved DOCX and extracts it automatically.
- Both modification DOCX upload paths start extraction as soon as the chef selects a file, so the chef does not need to click a second extract button.
- The modification database baseline picker flags whether each approved baseline is the latest for its property/service period, prioritizes exact property/service matches when those fields are selected, and opens a full-screen existing-menu decision dialog before AI review/submission when a newer, mismatched, or already-approved baseline exists.
- The approval editor and `Download Original DOCX` resolve the **submitted** generated DOCX (`original_path`) first so on-screen text matches the file from the form; the modification baseline DOCX is used only when that path is missing, then `final_path`, then saved text/HTML fallback
- On modification flows, baseline extraction mode (`uploaded_baseline` vs `uploaded_unapproved`) still applies when the baseline path is the one that loads
- The approval editor preserves leading indentation from extracted DOCX text so alignment-sensitive sections such as allergen keys do not get flattened before review, trims leading empty HTML paragraphs in the preview so it lines up with the editor before the first edit, keeps bold/italic (and other inline markup from the DOCX) in both the left rich editor and the live redline preview after you type by mapping ranges from the baseline HTML, and strips temporary green AI-review highlights from saved fallback HTML while preserving real imported redlines.
- After AI review, the left editor restores leading dish-name bold from the uploaded DOCX/source HTML before rendering corrected text, so the editable menu and persistent preview stay visually aligned.
- If a reviewer edits accepted text back to the original deleted side of an imported redline (for example `24 → 25` changed back to `24`), the approval preview resolves that imported redline to plain text instead of stacking stale deletion/insertion markup.
- Submitting that page uploads the approved DOCX back to the linked ClickUp task and only then assigns Marketing and leaves/advances the task at `To Do`, matching Isabella's manual handoff flow
- The dashboard now surfaces a warning when the ClickUp attachment upload, Marketing assignment, or post-approval status move fails, instead of silently finalizing only on the local side
- Once a menu reaches approved state, the final DOCX is downloadable from `/approved-menus` for Carlos or other operations users
- The learning dashboard shows each learned submission by menu/project name with supporting property/service details, and lets reviewers delete an individual learned submission row when test data should not remain in the training history; this removes that submission from differ training data and rebuilds detected patterns without touching the property catalog.
- Learned spelling/diacritic patterns now come only from changed lines that still match the same dish, so removed or replacement dishes do not create bogus reusable rules.
- Learning review `Save Rule` controls keep dish text out of inline button handlers, so apostrophes or quotes in corrected menu text cannot corrupt the button or block saving.

Approval editor regression harness:

```bash
npm run approval-editor:harness
npm run test:approval-editor-browser
npm run benchmark:approval-preview
```

The harness serves the checked-in Venga unapproved-DOCX redline fixture at `http://localhost:3015/approval/approval-editor-venga-venga` by default. The browser regression starts its own harness on port `3016`, deletes the blank line before `SPICY SWINGER`, adds words on two lines, performs rapid edits, and fails if the preview spinner sticks or the known corruption strings (`65S`, `SPICYPICY`, `MakemakemaMakeke`, `73727273`) appear.

Design approval entry point:
- The DOCX-vs-PDF design approval tool remains in the codebase, but the welcome-page card is currently disabled and labeled `Feature Coming Soon`.

## Property Catalog

- The form property field is now restricted to a canonical list managed by the DB service.
- Submitters can type to search, but the selected value must match an allowed property.
- The old separate free-text location field is removed; location metadata is derived from the selected property.
- The form-side `Hotel Name` input is currently removed from chef entry flow.
- Learning dashboards reuse the same property list for location-specific rule assignment and filtering; when `Location-specific rule?` is unchecked, reviewer annotations save as global rules without requiring a configured property.
- Properties can also store SharePoint routing metadata:
  - base SharePoint folder path
  - resolved drive/library metadata
  - property-specific menu subfolders
- When a property has SharePoint folder metadata, the form `Service Period` dropdown is populated from that property’s stored folder names instead of the global default list.
- `Other` is always included in the `Service Period` dropdown so users can intentionally route the approved file to the property base folder when no subfolder applies.
- Approved menus can now be pushed to SharePoint after ClickUp approval using the property’s configured base folder and subfolder mapping.
- SharePoint routing supports Microsoft Graph `Sites.Selected`; once a property has a synced drive ID, uploads use that drive directly while the approved-menus dashboard remains available as the local fallback.
- SharePoint library matching treats `Shared Documents` and Graph's `Documents` drive name as the same default document library.
- Generated and SharePoint-uploaded menu DOCX files are named `Restaurant_ServicePeriod_M.D.YY.docx`, for example `Aqimero_Breakfast_11.6.23.docx`, using the restaurant/outlet name from the selected property and the submission `date_needed` value.
- Approved-menu downloads keep that generated submission filename even when the stored approved artifact uses an internal `*-approved.docx` path.
- Prix fixe prices with `PP`/`pp` suffixes, such as `50.00pp`, are recognized as valid per-person top-level prices.
- Before uploading into a matched SharePoint service subfolder, the service archives existing `.docx` files from that subfolder into its `old/` folder. Existing `.pdf` and `.ai` files are left in place.
- Seeded examples now include `Aqimero - Ritz-Carlton - Philadelphia`, `Maya - New York`, `Tamayo - Denver`, `Toro - Hotel Clio - Denver`, `Toro - Fairmont Millennium Park - Chicago`, `Toro - Dania Beach`, and `Toro - Viceroy - Snowmass`.

## Local Approved-Dish Testing

You can test approved-dish extraction directly against Supabase without replaying a full ClickUp webhook:

```bash
npm run test:approved-dishes -- --legacy-id form-1771781530178
npm run test:approved-dishes -- --legacy-id form-1771781530178 --write
```

You can also re-run the current extractor against existing source submissions to repair approved-dish rows. The command is dry-run by default and writes a JSON report under `tmp/reports/`:

```bash
npm run repair:approved-dishes -- --all
npm run repair:approved-dishes -- --brand Tamayo
npm run repair:approved-dishes -- --source-submission-id <uuid> --apply
```

In Docker, run the same maintenance flow from the dashboard workspace:

```bash
docker compose -f docker-compose.dev.yml exec -T dashboard npm run repair:approved-dishes -- --all
```

Notes:
- `--id <uuid>` also works if you want to target the Supabase submission UUID directly.
- `--approved-only` forces the test to use only `approved_menu_content`; without it the script falls back to `menu_content`, matching the DB extraction endpoint behavior.
- The dashboard route `/approved-dishes` lists brands that have approved dishes. Brand pages such as `/approved-dishes/toro-toro` group rows by location and expose search plus location filters.
- Approved-dish rows show source metadata from the originating submission, including filename/project, source type, ClickUp task when available, IDs, and source-line context when available.
- The preview now shows `dish_name` and `description` separately when the menu uses inline rows like `Guacamole - avocado / lime / cilantro 12` or comma-delimited rows like `Punta Mita, prawns, tomato, onion C,F 95`.
- Price-bearing dish rows are not treated as category headers even when they start with words like `Chicken`, and extraction recognizes extended allergen codes such as `SS`, `SL`, `SY`, `PN`, and `TN`.
- Menu-title section headers such as `Ladies Night Menu` populate `menu_category` until a more specific section header appears.
- Wrapped dish rows are joined before parsing so continuation ingredients such as `gochujang` stay in the description instead of becoming standalone dish names; service hours, weekday labels, per-guest/package labels, course labels, event instructions, attribution lines, short beverage headings such as `RED`/`GIN`, grill/service labels, oatmeal topping continuations, fused pricing grids such as `À La Carte PricingAntojitos`, and modifier rows such as `add chicken` are skipped as non-dish metadata. Beverage sections can reuse bare price-only rows such as `18` for the following drink rows. When a terse dish name is enriched from its section, the inferred word is added in parentheses, e.g. `Kale (Salad)`.
- ClickUp approval finalization, DB extract/backfill routes, dashboard design approval, local approved-dish tests, and ClickUp history imports all use the shared approved-dish extractor and pass service period when available. Future DB extraction replaces visible rows for the same `source_submission_id` after a successful non-empty extraction by deactivating previous active rows and inserting the clean extraction output, so repeated approvals do not append another generation of the same rows.
- The shared quality analyzer flags pricing grids, category/description contamination, instruction text, missing provenance, low-information plausible rows, and exact repeated rows. Questionable DB extraction rows are sent to ai-review for an advisory `dish` / `not_dish` / `uncertain` check; only high-confidence `not_dish` responses are excluded from future writes.
- `--write` stores rows in `approved_dishes` for that submission and now follows the shared replacement behavior, so use a test submission when possible.
- `repair:approved-dishes` only applies candidates whose re-extraction is non-empty, has no high/exclude quality rows, stays within the configured row-count drop safety cap, and shows an obvious quality improvement unless `--include-clean` is supplied. Apply mode deactivates the previous active rows for each repaired `source_submission_id` before inserting the clean extraction output.

## ClickUp Completed-Menu Import Dry Run

Run completed-task import discovery inside Docker so it uses the same Node dependencies and DOCX redliner venv as the app:

```bash
./dev-up.sh --rebuild -d  # required after supabase-client/shared-lib changes
docker compose -f docker-compose.dev.yml exec -T dashboard npm run clickup:completed-dry-run -- --status complete
```

The dry run writes:
- `tmp/clickup-history-import/completed-dry-run.json`
- `tmp/clickup-history-import/completed-dry-run.csv`

It downloads each newest DOCX attachment, extracts clean menu text, previews dish extraction, infers property/service period, and marks which task is newest for each property + service period. Review rows with warnings before running any write-mode importer. Historical bare `dLeña` ClickUp tasks are treated as inactive Washington, D.C. work unless the source explicitly says Houston, so the current `dLeña - Houston` baseline stays clean. If the ClickUp task title and DOCX filename imply conflicting service periods, such as a `Dessert Menu` task with a `Dinner Menu` attachment, the row is warned with `service_task_filename_conflict` and excluded from clean import.

Before treating a bulk import as final, spot-check the generated report and Supabase rows for false-positive dish names, especially wrapped lines, service-hour text, package/course labels, modifiers, and beverage list entries that may be valid names in one menu but metadata in another.

After importing a batch, run the approved-dish audit to find likely extraction misses in Supabase:

```bash
docker compose -f docker-compose.dev.yml exec -T dashboard npm run clickup:audit-approved-dishes
```

The audit is read-only. It writes `tmp/clickup-history-import/dish-extraction-audit.json` and `.csv`, flagging rows such as missing prices, prices left in `dish_name`, service hours, package/course labels, instruction text, category headings stored as dishes, category/description contamination, pricing grids, one-word wrapped ingredients, leftover allergen clusters in descriptions, and duplicate dish/category/description rows within one imported submission. Missing-price rows include `price_audit_class`, `source_line`, `previous_line`, and `next_line` columns so reviewers can separate recoverable parser misses from package/set-menu items that do not have item-level prices. Treat a zero-row audit as the gate before moving from spot checks to broader ClickUp history imports. Prices are stored as normalized values without currency symbols; enhancement section prices are stored as the numeric enhancement amount, while dishes without item-level prices inside prix fixe, event, brunch/buffet, holiday, restaurant-week, half-board, or per-person set menus are marked `prix fixe`. The extractor also handles compact `PP` prices, single trailing allergen codes after prices, cup/bowl pricing, high comma-separated wine prices, all-caps two-line table-style dish rows, section price-only beverage groups including bare numeric prices in beverage sections, shared serving descriptions for fajita protein rows, price-bearing rows followed by separate two-line dishes, and common DOCX instruction/footer rows.

To import only rows with no warnings, run:

```bash
docker compose -f docker-compose.dev.yml exec -T dashboard npm run clickup:completed-dry-run -- --status complete --apply --only-clean
```

Apply mode upserts approved submissions by ClickUp task id, deactivates that submission's previous active approved dish rows before inserting the clean extraction output, and leaves all warning rows in the JSON/CSV review report. Imported `clickup_history_import` submissions are included in approved-baseline search and latest property/service lookup.

## Getting Started

### Prerequisites

- Node.js v18+
- npm v7+ (for workspace support)
- Docker Desktop
- SMTP server credentials
- OpenAI API key
- Supabase project (free tier)

### Quick Start

1. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

2. **Start the Docker dev stack:**
   ```bash
   ./dev-up.sh -d
   ```

3. **Open the dashboard:**
   ```bash
   open http://localhost:3005
   ```

Docker dev mode is the default local workflow. It runs the TypeScript services with `ts-node-dev`, keeps `node_modules` and the DOCX redliner Python venv inside the image, and bind-mounts source files for hot reload.

### Environment Variables

Create a `.env` file with:

```
# Email sending (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_AUTH=login
SMTP_FROM=
SMTP_USER=
SMTP_PASS=
PUBLIC_FORM_SUPPORT_EMAIL=dcowser@richardsandoval.com
FORM_ATTEMPT_ALERT_EMAIL=dcowser@richardsandoval.com

# Microsoft 365 IP-based relay example:
# SMTP_HOST=richardsandoval-com.mail.protection.outlook.com
# SMTP_PORT=25
# SMTP_AUTH=none
# SMTP_REQUIRE_TLS=true
# SMTP_FROM=no-reply@richardsandoval.com
# SMTP_USER=
# SMTP_PASS=

# AI Review
OPENAI_API_KEY=
AI_REVIEW_MODEL=gpt-4o-mini
BASIC_AI_CHECK_TIMEOUT_MS=120000
AI_REVIEW_SUBMIT_TIMEOUT_MS=120000
BASIC_AI_CHECK_JOB_TTL_MS=900000

# Service URLs (override in cloud deployments)
DB_SERVICE_URL=http://localhost:3004
AI_REVIEW_URL=http://localhost:3002
DIFFER_SERVICE_URL=http://localhost:3006
CLICKUP_SERVICE_URL=http://localhost:3007
INTERNAL_API_TOKEN=replace-with-a-long-random-secret
INTERNAL_API_TIMEOUT_MS=
CLICKUP_TASK_CREATE_TIMEOUT_MS=60000

# ClickUp workflow statuses
CLICKUP_INITIAL_REVIEW_STATUS=pending initial isa review
CLICKUP_CORRECTIONS_STATUS=to do
CLICKUP_POST_APPROVAL_STATUS=to do
CLICKUP_WEBHOOK_SUBMISSION_LOOKUP_RETRIES=5
CLICKUP_WEBHOOK_SUBMISSION_LOOKUP_RETRY_DELAY_MS=1000

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

## Running Services

Use Docker for day-to-day local development:

```bash
./dev-up.sh                # Build if needed, start all services, follow logs
./dev-up.sh -d             # Start all services detached
./dev-up.sh dashboard      # Start dashboard and its compose dependencies
./dev-up.sh --down         # Stop containers
./dev-up.sh --rebuild      # Rebuild image after dependency/shared-lib changes
./dev-up.sh --reset-venv   # Rebuild the image to refresh docx-redliner's Python venv
./dev-up.sh --nuke         # Stop and remove containers plus anonymous volumes
```

Basic smoke checks:

```bash
curl -i http://localhost:3005/
curl -i http://localhost:3005/form
curl -i http://localhost:3007/health

TOKEN=$(grep ^INTERNAL_API_TOKEN .env | cut -d= -f2)
curl -i -H "x-menumanager-internal-token: $TOKEN" http://localhost:3004/properties
curl -i -H "x-menumanager-internal-token: $TOKEN" http://localhost:3006/stats
```

Internal service routes intentionally return `401` when called directly without `x-menumanager-internal-token`. That does not block normal dashboard testing; browser requests go to the dashboard, and service-to-service calls attach the shared token from `.env`.

Local form submissions from `http://localhost:3005/form` include a developer-only testing shortcut: after a successful submit, ClickUp task creation is skipped, the generated DOCX downloads automatically, and the success alert links to `/approval/<submissionId>` for the same record. This shortcut is disabled when `NODE_ENV=production` or when the request host is not localhost.

Native mode is available when you specifically do not want Docker, but it is no longer the preferred default:

```bash
npm install
npm run build --workspaces --if-present
npm start --workspace=@menumanager/dashboard   # Dashboard + Form at http://localhost:3005
npm start --workspace=@menumanager/parser      # Template validation
npm start --workspace=@menumanager/ai-review   # AI review
npm start --workspace=@menumanager/clickup-integration # ClickUp + notifications
npm start --workspace=@menumanager/db          # Database
```

Or use the helper scripts:
```bash
./start-services.sh   # Native-mode start for all services
./stop-services.sh    # Stop all services
./verify-setup.sh     # Verify configuration
```

Developer workflow notes:

- [docs/feature-delivery-workflow.md](docs/feature-delivery-workflow.md) explains the required build, test, live-verification, `dist/`, and restart process for feature work.
- [docs/local-dev-troubleshooting.md](docs/local-dev-troubleshooting.md) covers common startup failures, bad local state, and reset steps.

Additional notes:

- Docker Desktop on macOS can be unreliable when bind-mounting repos from TCC-protected folders such as `~/Documents`, `~/Desktop`, or `~/Downloads`. If services fail with `Resource deadlock avoided`, grant Docker access to the folder, switch Docker Desktop's file-sharing implementation, or move the repo to a non-protected path such as `~/code/MenuManager`.
- In native mode, `start-services.sh` runs a full workspace build by default before starting services so latest TypeScript/EJS changes are always reflected.
- To skip the native build step (faster restart when nothing changed), run: `SKIP_BUILD=1 ./start-services.sh`
- Set the same `INTERNAL_API_TOKEN` for every service process. Internal API calls now fail closed if this token is missing or mismatched, and they use `INTERNAL_API_TIMEOUT_MS` (default `5000`) when no route-specific timeout is set.

## Implementation Roadmap

| Phase | Task | Status |
|-------|------|--------|
| 1 | Set up PostgreSQL database schema (Supabase) | Pending |
| 2 | Build chef submission form with reviewer selection | Pending |
| 3 | Enhance reviewer dashboard (download/upload/approve) | Pending |
| 4 | Implement multi-level approval workflow (Inngest) | Pending |
| 5 | Add email notifications at each step (Resend) | Pending |
| 6 | Build approved dishes extraction & database | Complete |
| 7 | ClickUp integration for task creation | Complete |
| 8 | Deploy to production (Railway) | Pending |
| 9 | Add authentication & roles (Clerk) | Pending |

## Estimated Infrastructure Costs

**Starter Tier** (< 100 submissions/month): **~$5/month**

| Service | Provider | Cost |
|---------|----------|------|
| Hosting | Railway | $5/mo |
| Database | Supabase | Free |
| Auth | Clerk | Free |
| Email | Resend | Free |
| Workflows | Inngest | Free |
| ClickUp | API | Free (existing subscription) |

## Documentation

- `CLAUDE.md` — Project map and agent conventions (~66 lines)
- `docs/` — Detailed documentation (architecture, design decisions, environment, roadmap)
- `docs/design-docs/` — Feature design documents (ClickUp, critical errors, autofill, etc.)
- `docs/aws-deployment.md` — AWS deployment guide (EC2 + Docker Compose, ECS notes)
- `archive/` — Historical documentation from Phase 1

## Running Tests

```bash
npm test
```

# Fix Spec: Drifted bolding in the click-to-edit editor (offset-based formatText)

Follow-up to [edit-menu-approved-html-fix-spec.md](edit-menu-approved-html-fix-spec.md). Read `AGENTS.md` first. The symptom: the editor shows bold starting/ending mid-word and spilling across lines ("BOTTOM**LESS ENHANCEMENTS**", "tomat**o**", a bold "**g**" bleeding onto "guava…"), drifting further down the document. Verified on Tán – Brunch Bebidas (`form-1783831032380` / `145fe319-…`).

## Evidence chain (all verified on the real artifacts, 7/13/26)

1. **The approved DOCX is correct.** python-docx dump of the cleaned doc shows word-aligned runs with correct bold flags (`'Tulum' bold=True`, `'21' bold=False`, `'tomato…' bold=False`).
2. **The extraction pipeline is correct.** Running `create_clean_approved_docx.py` + `extract_clean_menu_text.py` on the raw approved DOCX yields correct HTML: `<strong>Tulum</strong><strong> </strong><strong>Breeze</strong><strong> </strong>21`. Neither the DOCX chain nor the extractor is the bug.
3. **The stored HTML for this submission is empty.** Live API (`/api/submissions/latest-approved`) returns `approvedMenuContentHtml: ""` — the submission was approved while pre-fix code was running (no `approved_menu_content_html` written; the read-side consistency guard then correctly refused the stale submitted HTML). So the editor loaded **plain text with no bolding**.
4. **Therefore every bold on screen was applied client-side afterward** by the offset-based formatting pass, and it's misaligned.

## Root cause

`views/form.ejs` applies bold via `quill.formatText(charOffset, length, …)` with offsets computed from a **text variable, not from the text actually inside the Quill document**:

- `applyHeadingFormatting(originalText, displayText)` (~line 7024) — accumulates `charOffset` over `displayText` lines.
- `applyDishNameFormattingAnchors(displayText, anchors)` (~line 7054) — ranges from `resolveDishNameFormattingRanges(displayText, …)`.
- Call sites: AI-check completion (~7625–7626, using `correctedDisplayText` after `preserveMenuStructure` + `setQuillReviewedHtmlFromText`), suggestion-apply (~7337), `recalculateHighlights` (~8511).

Whenever the Quill document's text differs from the offset-source string, every subsequent range shifts — cumulatively. The divergence is real and common because `approved_menu_content` carries whitespace debris from tracked-change extraction (`"blood orange,   passion fruit"`, `"aperol,       passion fruit"`, leading spaces) that gets collapsed/normalized differently at different stages. Each collapsed run of spaces above a line shifts that line's bold right by that many characters — exactly the observed pattern.

## Fix

### 1. Operational, do first (no code) — restore stored HTML for the broken window

Approvals finalized before the fixed code went live have `approved_menu_content_html = NULL` and fall back to unstyled text. The approved DOCX files are now all under the host bind mount, so the existing backfill resolves them **when run on the server**:

```
ssh into the Lightsail box → cd ~/MenuManager
docker compose exec dashboard node scripts/backfill-approved-menu-html.js
```

(`final_path` values are `/app/tmp/...` container paths — the script must run inside a container, not on the host.) Then discard-and-recreate any active drafts on affected menus. After this, fresh drafts load correct `<strong>` HTML at open (verified correct in step 2 above) and the offset pass isn't relied on for baseline bolding.

### 2. Client fix — never apply offsets computed from a different string

Rule: **any `quill.formatText(start, len, …)` must use offsets computed against the live editor text at application time** (`quill.getText()` / `extractCleanTextFromReviewedArea(quill.root)`), never against `displayText`/`correctedDisplayText` copies.

Concretely, in both `applyHeadingFormatting` and `applyDishNameFormattingAnchors`:

- Read `const editorText = quill.getText()` (normalize the trailing newline Quill appends) at the top and resolve all ranges against it. For heading formatting, decide *which* lines are headings from `originalText`/`displayText` as today (line-count alignment logic unchanged), but compute the *character positions* from `editorText`'s own line offsets (`buildDisplayLineRanges(editorText)`).
- For dish-name anchors, pass `editorText` (not `displayText`) into `resolveDishNameFormattingRanges`, since the anchors resolve by matching text — matching against the true editor text makes the returned offsets valid by construction.
- Add a cheap invariant guard: if `displayText` and `editorText` disagree (beyond the trailing newline), `console.warn` with both lengths — this is the regression tripwire.

Do NOT "fix" this by normalizing `displayText` to match Quill — that's re-deriving the same string two ways and hoping; the editor text is the single source of truth.

### 3. Optional hygiene (separate, small): whitespace debris at extraction

`paragraph_clean_text`/`paragraph_clean_html` (`services/docx-redliner/extract_clean_menu_text.py`) preserve multi-space runs left by tracked-change acceptance (`"orange,   passion"`). Collapsing runs of spaces to one (inside lines, both text and HTML consistently) removes the main source of divergence and cleans the diff baseline. Caveats: change text and HTML together so `htmlTextMatchesApproved` and the baseline-match lineage check (both already whitespace-normalizing) stay consistent; treat as its own change with its own tests, not bundled into the client fix.

## Tests / verification (per AGENTS.md)

- Unit (form view/browser-level, alongside `form-view.test.js` / the approval-editor browser regression pattern): seed the editor via the AI-check path with a fixture containing multi-space lines (use the real Brunch Bebidas `approved_menu_content` as the fixture — it reproduces the drift), then assert: "BOTTOMLESS ENHANCEMENTS" line fully bold, "tomato, tajín…" line has zero bold, no bold range crosses a line boundary.
- Unit for the tripwire: mismatched `displayText` vs editor text logs the warning and still bolds correctly.
- Live (Docker): backfill → discard old draft → `Edit This Menu` on Brunch Bebidas → editor opens with correct bolding *before* any AI check; run Basic AI Check → bolding still word-aligned; accept a suggestion → still aligned (`recalculateHighlights` path).

## Out of scope

- The DOCX generation/redline chain (verified correct).
- The extraction pipeline (verified correct; only the optional whitespace hygiene in §3 touches it).

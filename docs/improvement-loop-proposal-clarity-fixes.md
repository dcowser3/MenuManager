# Proposal Clarity + Guard-Retry Fixes (C1–C5)

> Status: Handoff, July 2026
> Trigger: proposal `2026-07-02-manual-1783021334646` (the consolidation run) shipped an analysis describing a "44% reduction" that the fence guard had discarded — the reviewer saw a proposal whose analysis, verdict, and diff disagreed with each other, plus no visibility into what happened to manually added rules.
> Context: [improvement-loop-fix-specs.md](improvement-loop-fix-specs.md), [design-docs/automated-improvement-loop.md](design-docs/automated-improvement-loop.md)
> Cross-cutting rules unchanged: new logic in jest-covered libs, docs in the same change set, degrade-gracefully migrations + `CRITICAL_SUPABASE_SCHEMA` updates, stubs never shipped behind real flags.

---

## C1 (P0) — Retry-with-feedback when a prompt-shape guard discards the rewrite

### Problem

`validateImprovementLlmOutput` fails closed when the proposed prompt echoes context, breaks code-fence structure, or is malformed — correct — but the cycle accepts that as the final answer. One recoverable formatting mistake by the model becomes a dead cycle. Both consolidation attempts to date died this way (fence count 7 → 0); the consolidation feature is 0-for-2 because of it.

### Spec

1. In the cycle (extract the loop controller into `improvement-cycle-core.ts` as a pure function; script stays thin): when validation ends with `promptUnchanged` caused by a **guard** (context leak, fence structure — not the model's own `UNCHANGED` sentinel), re-call the LLM up to `IMPROVE_MAX_RETRIES` (default 2) with a corrective addendum appended to the conversation, e.g.:
   > Your previous proposed_prompt was rejected by an automated guard: <exact warning text>. The current prompt contains exactly N fenced code blocks (```) — they must appear in your rewrite verbatim and unmodified. Return the corrected full prompt now.
2. Each attempt's warnings accumulate (labeled `attempt 1/2/3`) into `llm_warnings`.
3. If all attempts fail: proceed as today (prompt unchanged) but with disposition `no_change_guard_discarded` (see C2) — never present the discarded analysis as the proposal's story (C2 handles rendering).
4. Prevention as well as cure — strengthen BOTH system prompts (`IMPROVEMENT_SYSTEM_PROMPT` and `CONSOLIDATION_SYSTEM_PROMPT`): state the count of fenced blocks in the current prompt (computed at context-assembly time, injected into the message) and that each must be preserved byte-identical, including the response-format block.
5. Jest: guard-failure → retry-message construction; sentinel `UNCHANGED` → no retry; retries exhausted → disposition set; fence-count injection present in both prompts.

### Acceptance criteria

- A synthetic first-response with broken fences followed by a corrected second response yields a normal `prompt_change` proposal with attempt-1 warnings preserved.
- A consolidation run against the real prompt survives the fence guard (this is the live acceptance — it has never happened yet).

---

## C2 (P0) — Honest, structured disposition: the proposal must say what it actually concluded

### Problem

The reviewer currently reconstructs the conclusion from scattered signals (warnings array, byte-identical prompts, eval table). In the trigger incident the analysis said "big rewrite," the diff said "nothing," and the eval said "204 same." Also: the analysis displayed model-claimed metrics ("32.7k → 18.4k") that were simply false (actual prompt: 21,861 chars), and a full 204-case candidate eval ran against a byte-identical candidate — pure waste.

### Spec

1. **Computed `disposition` field** on the proposal (code-computed, never LLM-supplied): `prompt_change` | `rules_only` | `code_recs_only` | `rules_and_prompt` | `no_change_model_declined` (sentinel) | `no_change_guard_discarded` (C1 exhausted). Migration (degrade pattern + `CRITICAL_SUPABASE_SCHEMA`).
2. **Headline rendering**: proposal page and email lead with the disposition in plain language, e.g. "No change proposed — the model's rewrite was discarded by a formatting guard after 3 attempts" or "2 replacement rules + prompt change across sections 4 and 7."
3. **Discarded-rewrite honesty**: when disposition is `no_change_guard_discarded`, the analysis renders collapsed under an explicit label: "This analysis describes a rewrite that was DISCARDED by a guard and is NOT part of this proposal." Store the discarded prompt text as an artifact (`tmp/.../discarded_prompt_attempt<N>.txt`) for forensics, never in the DB.
4. **Computed metrics only**: the page shows `prompt_length` before → after computed from the actual strings. Never render model-claimed sizes/percentages; if the analysis contains them, that's the model's prose, clearly inside the collapsed/labeled analysis block.
5. **Skip pointless candidate evals**: when the candidate prompt is byte-identical to baseline AND there are zero candidate replacement rules, skip the candidate eval run entirely; set verdict `no_effect` with note `eval skipped: candidate identical to baseline`. (Saves a full 204-case run each time this happens.)
6. Jest: disposition matrix; identical-candidate eval skip; rendering test for the collapsed-analysis state.

### Acceptance criteria

- Re-running the trigger scenario produces a proposal whose headline says the rewrite was discarded, whose analysis is labeled as describing a discarded change, and which runs no candidate eval.

---

## C3 (P0) — Per-correction routing table: the reviewer sees what happened to every input

### Problem

"I don't even get its conclusion" — the routing of each source correction (deterministic rule? prompt text? code recommendation? dismissed? already correct?) exists only implicitly in the LLM's prose. Manually added freeform rules are the worst case: they enter the cycle and visibly vanish.

### Spec

1. Extend the required LLM JSON output with:
   ```json
   "correction_routing": [
     { "correction_id": "…", "lane": "replacement_rule|prompt|code_recommendation|already_correct|dismissed",
       "target": "rule index, prompt section name, or recommendation title", "note": "one-line reason" }
   ]
   ```
2. Validator enforcement (`validateImprovementLlmOutput`):
   - Every source correction id must appear exactly once; missing ids get a synthetic `{lane: 'unrouted'}` entry + warning.
   - `still_missed` corrections may NOT be `dismissed` or `already_correct` (hard warning + feeds the existing `unresolved_still_missed` flag).
   - `already_correct` is only legal when replay evidence says `now_correct`.
   - Cross-check `replacement_rule` lanes against the surviving validated rules (post-drop); a routing that points at a dropped rule downgrades to `unrouted` + warning.
3. Rendering: a "What happened to each correction" table at the TOP of the proposal page (above the prompt diff): correction text → replay tag → lane → target → note. This is the conclusion, first thing the reviewer sees. Include it in the email body (compact).
4. Persist as `correction_routing` JSONB (migration, degrade pattern, schema list).
5. Jest: completeness enforcement, still_missed/dismissed conflict, dropped-rule cross-check.

### Acceptance criteria

- A proposal sourced from N corrections renders N routing rows; a still_missed correction routed as dismissed trips the banner; the table appears in the email.

---

## C4 (P1) — Freeform manual rules: AI infers the lane, examples provide the proof

### Problem

Two distinct gaps got conflated. (a) **Lane inference:** the improvement LLM is *supposed* to read a freeform explanation and decide whether it implies an exact, always-safe swap — synthesizing the `original_text → corrected_text` pair itself (e.g. "we always accent jalapeño" → a `jalapeno → jalapeño` diacritic rule). The system prompt permits this implicitly but never says it, so in practice freeform guidance tends to get parked in the prompt lane by default. (b) **Verification:** even when the AI correctly synthesizes a rule, the exact strings are its *guess* (casing, plurals, word boundaries), and with no real instance of the mistake there is nothing to replay the guess against — the rule reaches the approval page having never been tested on a single menu.

### Spec

**C4a — Explicit AI lane inference from freeform guidance (system prompt + validator):**

1. Add to `IMPROVEMENT_SYSTEM_PROMPT`: for corrections that are freeform guidance (no exact text pair), you MUST still route them (C3). When the explanation implies an exact, always-safe replacement, SYNTHESIZE the deterministic rule yourself — state the inferred `original_text`/`corrected_text` explicitly and set a new field `"inferred_from_guidance": true` on that rule. Apply the same safety tests as any rule (context-dependent terms, change types). When the guidance is contextual, route it to the prompt lane as today.
2. Validator: pass `inferred_from_guidance` through; synthesized rules get the standard safety validation plus a distinct warning-level note (`rule N synthesized from freeform guidance — verify the exact strings`).
3. Proposal page: synthesized rules render with an "inferred from guidance" badge next to the thin-evidence badge; the checkbox default follows the existing rules (checked unless `IMPROVE_THIN_RULE_UNCHECKED`).
4. Jest: synthesis field pass-through, safety validation still applies, badge rendering.

**C4b — Example capture at entry (verification ground truth):**

1. Learning-page add-rule form: optional-but-nudged fields "Example — text as it appeared" / "Example — corrected text" (UI copy: "An example lets the system verify this rule actually gets applied"). Store on the correction row (reuse `original_text`/`corrected_text` when the rule is exact; otherwise new `example_original`/`example_corrected` columns — decide and document).
2. Replay tagging (`decideReplayStatus`): a freeform rule with an example pair is matched on the example → becomes `still_missed`/`now_correct` instead of `not_verifiable`. When present, the example also grounds the AI's synthesis in C4a (the model is told to prefer the human's example strings over its own inference).
3. The pending-rules table and the C3 routing table show a verifiability badge: `verifiable` / `guidance only`.
4. Jest: example-pair upgrade path; no-example stays `not_verifiable`; example overrides synthesis.

### Acceptance criteria

- A freeform rule whose explanation implies an exact swap yields a synthesized deterministic rule with the `inferred from guidance` badge — routed, safety-checked, and reviewer-approvable.
- A manual rule saved with an example is replay-tagged with a real tag; without one it renders `guidance only`; with both, the human's example strings win over the AI's inferred strings.

---

## C5 (P1) — Consolidation completes end-to-end (depends on C1/C2)

### Problem

Consolidation has never produced a surviving shorter prompt (0-for-2, both fence-guard deaths). With C1's retry + fence-count injection and C2's honest disposition, it should complete; this item is the explicit live verification plus the remaining polish.

### Spec

1. Apply C1's fence instructions to `CONSOLIDATION_SYSTEM_PROMPT` (list the protected fenced blocks explicitly; require byte-identical preservation).
2. Live acceptance run (Docker, `--consolidate`): candidate survives validation, is measurably shorter (warn <5% / >50% checks already exist), full eval runs, verdict reflects reality, disposition `prompt_change`, page shows computed before → after lengths.
3. Reject the run's proposal afterward (with notes) unless the user chooses to review it as a real consolidation candidate — their call, flag it to them.

### Acceptance criteria

- One completed consolidation proposal in `prompt_proposals` with a shorter candidate prompt and a real eval verdict, confirmed on the page.

---

## Suggested order

C2 → C1 (C2's disposition field is C1's failure landing pad) → C3 → C5 (live run) → C4 (touches the learning-page UI; independent). C1+C2+C3 are one coherent change set if preferred.

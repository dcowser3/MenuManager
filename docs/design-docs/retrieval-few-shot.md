# Retrieval-based Few-Shot Corrections (Fix 11 — Design Exploration)

Status: Design doc only (no implementation). See improvement-loop-fix-specs.md for the originating sketch.

## Problem / Opportunity

The automated improvement loop (and the broader review system) currently lands every learned lesson as static text in an ever-growing `qa_prompt.txt` (21k+ chars and climbing). The corrections dataset is the system's most valuable asset and it scales; the monolithic prompt does not.

Retrieval inverts the growth curve: at review time, embed the incoming menu and inject only the most relevant past (accepted) corrections as few-shot examples rather than universal abstract rules. This keeps the base prompt stable while still giving the model concrete, context-rich precedents for ambiguous cases (tartare vs tartar, context-dependent plurals, brand styling, etc.).

## Goals

- Improve first-pass correctness on context-sensitive or low-frequency corrections without bloating the prompt.
- Keep lane discipline: retrieved items are *examples*, not replacements for deterministic rules or prompt policy.
- Preserve eval reproducibility and cost characteristics.

## High-Level Design

1. **Embedding at save time**
   - When a correction rule transitions to `accepted`, compute an embedding of a canonical text: `original_text + " → " + corrected_text + "\n" + reviewer_explanation`.
   - Store the vector in Supabase (pgvector) keyed by `correction_rules.id` (or a new `correction_embeddings` table).
   - Re-embed on significant edit of an accepted rule (rare).

2. **Retrieval at review time**
   - In `buildFinalPrompt` (or a new `qa-prompt-builder` helper), embed the raw incoming menu (or a normalized "dishes + notes" view).
   - Query top-k (k≈8) accepted corrections by cosine distance.
   - Apply a distance threshold; items below the threshold are injected.
   - Format as a clearly delimited section:
     ```
     ## Recent reviewer precedents (few-shot examples — use judgment)
     - "poblano tartare" → "poblano tartar" because it is the sauce, not the preparation (menu context: "with chipotle aioli")
     ...
     ```
   - The section is appended after the static rules so that abstract policy still wins in conflicts.

3. **Lane interaction**
   - Retrieved precedents complement deterministic replacement rules and the core prompt.
   - They are most valuable for items that are intentionally *not* safe replacement rules (context-dependent).
   - The prompt must still instruct the model to prefer explicit policy over a single precedent when they conflict.

## Eval & Reproducibility (the hard part)

- A retrieval-augmented prompt is **non-deterministic across time** unless the retrieval index snapshot is captured.
- For the eval harness (`review-eval`, improvement cycle):
  - Cache the embedding index (or the exact retrieved set) keyed by the eval run id or a content hash of the correction corpus at that moment.
  - The prompt hash used for cache keys in `tmp/review-eval/cache/` **must include** the retrieved correction ids (or a stable hash of their text+explanation).
  - Without this, a back-to-back baseline vs candidate comparison can spuriously attribute a score change to retrieval churn rather than the actual prompt diff under test.
- Recommendation: add an `index_snapshot_id` (or `retrieved_correction_ids`) to the case report and to the overall report config when retrieval is active.

## Tuning Levers

- `k` (top-k): start 6–10; larger k helps rare dishes but increases token cost and noise.
- Distance threshold: calibrate so that only "quite similar" precedents are injected; too loose and you pollute context.
- Embedding model: keep cheap and stable (same one used at embed and query time); pin it.
- Scope filter: optionally restrict retrieval to same menu type (food vs beverage) or property cluster if data shows cross-contamination hurts.

Measure with the eval harness:
- Run controlled A/B on a fixed dataset with retrieval on vs off.
- Track correction F1 and composite delta; watch for regressions on menus that previously relied on the absence of a noisy precedent.

## Cost

- Embedding calls: one per accepted correction at approval time (cheap, infrequent).
- Per review: 1 embed of the menu + 1 vector query (pgvector index). Negligible compared with the review LLM call.
- Token inflation in the review prompt: k * avg precedent size (roughly 150–300 tokens each). Keep k modest; the whole point is to avoid 10k+ of static text.
- Eval cost: when running many ablations or improvement cycles, the cache key discipline above is essential to avoid recomputing identical retrieval sets.

## Open Questions / Risks

- Staleness: an accepted correction that is later superseded should be removable from the index or down-ranked.
- Over-specificity: a very specific precedent from one restaurant may mislead on another.
- Prompt injection / formatting: retrieved text must be clearly delineated and the model instructed that examples do not override explicit policy.
- Determinism for audits: any change that affects retrieval (k, threshold, embed model, accepted set) is a "policy change" and should be recorded in the improvement proposal or a changelog entry.

## Acceptance Criteria (for the design phase)

- A design doc exists (this file) covering retrieval determinism in eval, cache-key implications, k/threshold tuning against the harness, and cost.
- No code changes are required to land this doc.

## Related

- Fix 8 (prompt-bloat counterweight) — retrieval is a long-term complement to manual consolidation.
- improvement-loop-fix-specs.md (original P2 item)
- docs/design-docs/automated-improvement-loop.md (status updates)
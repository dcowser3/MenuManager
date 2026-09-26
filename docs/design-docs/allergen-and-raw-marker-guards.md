# Allergen Lock and Raw-Marker Preservation

## Invariants

1. **Allergen codes are locked.** The AI review may not add or remove allergen
   codes in the delivered menu. Each dish keeps exactly the codes present in the
   deterministic pre-AI text. The AI may only *suggest* code changes.
2. **Raw markers (`*`) are add-only.** A marker present before AI review is never
   removed. The AI may add a marker; it may not drop one.

Both are enforced in code and do not depend on prompt compliance.

## Incident (2026-09-21, tán New York dinner)

Basic AI Check `d8791b30` (gpt-5.6-luna) returned `F,S` on "Seabass & Shrimp
Ceviche" and "Tán Ceviche Trio". The submitted key (`G | V | D | S | N | VG`)
defines no `F`; the model claimed it did. Separately, the cooked-shrimp-ceviche
rule matched "Seabass & **Shrimp Ceviche**" and removed the chef's asterisk
before and after the model call.

Replaying that model output through main as of `e6027329` showed the
source-preservation guard could not see `F` (it only recognized legend codes),
so it delivered `avocado F,S S 23` and `tán ceviche F,S* S 48`, and kept the
model's "Retain F,S" suggestion.

## Enforcement

- `lib/allergen-source-preservation.ts` (`preserveSubmittedAllergenCodes`): when a
  legend exists, code-shaped tokens are recognized from the legend **plus** a
  common allergen code set (`F`, `C`, `E`, `SE`, `SY`, ...). Tokens the chef did
  not submit are stripped even if the legend does not define them. Menus with no
  legend are unchanged.
- `lib/raw-marker-integrity-guard.ts` (`guardCorrectedMenuRawMarkers`) runs after
  final allergen preservation: a pre-AI marker missing from the delivered row is
  reinserted at the end of the description, before codes and price; if only the
  marker's word position changed, the pre-AI placement is kept. Its restorations
  appear in `safetyDiagnostics` as `raw_marker_restored:<row>`.
- `lib/pre-ai-deterministic-rules.ts`: the cooked-shrimp-ceviche rule no longer
  removes markers. It only withholds an automatic marker on shrimp-only ceviche;
  lines that also name a fish (seabass, tuna, hamachi, ...) are not exempt.
- Post-AI placement and high-confidence auto-apply no longer put a space before
  the marker (`tán ceviche* S 48`, not `tán ceviche * S 48`).
- `sop-processor/qa_prompt.txt` (and the `config/rulebook` seed): allergen codes
  are suggestion-only, never remove an asterisk, no unconditional "add F" rules.

## Suggestions must describe the delivered menu

Guards change the model's corrected menu after the model has written its
suggestions, so a suggestion can describe a change that was reverted. On
2026-09-26 (audit `47df1fe9`) the model removed `S` from three fish dishes, the
allergen lock restored `S`, and the chef still saw "The corrected menu removes S".

`lib/suggestion-delivery-reconciliation.ts` (`reconcileSuggestionsWithDeliveredMenu`)
is the last suggestion stage of `runPostAiPipeline` (Basic AI Check and the
post-submit review both use it). It compares each allergen or raw-marker
suggestion's submitted row with the **delivered** row, so it is correct no matter
which guard reverted what:

- **Allergen suggestions** are always advisory. The description starts with the
  delivered fact ("Allergen codes were not changed (kept as submitted: D,G,S).")
  followed by the model's reasoning as an "AI note", with clauses that claim the
  menu was edited removed, and phrases claiming the key defines a code it does
  not (e.g. "the key defines fish as F") removed. "Retain/keep ..." recommendations
  become "Confirm with the chef ...". A literal `Change 'X' to 'Y'` is kept so the
  chef can still apply it with one click. Codes the menu key does not define are
  flagged. Hallucinated "code X is not defined" premises are dropped.
- **Raw-marker suggestions** that ask to remove an asterisk are held (asterisks are
  never removed automatically); a claimed addition is marked applied only when the
  delivered row has the asterisk.
- Every reconciled suggestion carries `deliveryStatus` (`applied` / `not_applied`)
  and `deliveredValue`. The form shows a **NOT APPLIED** badge for `not_applied`.
- Exact duplicates are dropped. Diagnostics (`suggestion_delivery_*`) go to
  `safetyDiagnostics`.

This replaces `allergen-delivery-reconciliation.ts`, which only recognized
"added/retain" wording and RSH-specific codes. The prompt also tells the model
that allergen and asterisk suggestions are advisory and must not claim the
corrected menu changed them; the code does not rely on that.

## Verification

`allergen-source-preservation.test.ts`, `raw-marker-integrity-guard.test.ts`,
`pre-ai-deterministic-rules.test.ts`, `suggestion-delivery-reconciliation.test.ts`,
and `review-pipeline.test.ts` include the exact 2026-09-21 lines and the
2026-09-26 audit `47df1fe9` suggestions.

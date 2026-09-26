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
- `lib/allergen-delivery-reconciliation.ts`: claims such as "added/retain F,S"
  are checked against any uppercase code list, not only `VG|D|G|N|S|V`, so an
  unapplied claim is rewritten to "Not applied; confirm with the chef".
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

## Verification

`allergen-source-preservation.test.ts`, `raw-marker-integrity-guard.test.ts`,
`pre-ai-deterministic-rules.test.ts`, and `review-pipeline.test.ts` include the
exact 2026-09-21 lines.

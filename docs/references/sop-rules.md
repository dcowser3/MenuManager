# SOP Rules Reference

The authoritative SOP rules document lives at:

```
sop-processor/sop_rules.md
```

This file contains the standard operating procedure rules that the AI review service uses to validate menu content. It is processed by scripts in `sop-processor/` and fed into the AI prompts.

## Active AI Policy Overrides

The AI prompt at `sop-processor/qa_prompt.txt` can intentionally diverge from the canonical SOP. Current overrides:

- **Capitalization (2026-05-19)** — The SOP's Section 1.1 (Sentence Case for dish/drink names) and Section 1.2 (lowercase descriptions, do-not-capitalize word list) are **suspended in the AI prompt**. The AI corrector preserves whatever capitalization the chef wrote and will not flag or auto-correct casing anywhere. The written SOP rule is unchanged; only AI enforcement is paused. To re-enable, restore the original Section 1.1/1.2 wording and remove the "CAPITALIZATION POLICY OVERRIDE" bullet from the IMPORTANT GUIDELINES section in `qa_prompt.txt`.
- **Shrimp ceviche raw marker (2026-08-21, revised 2026-09-26)**: Shrimp-only or prawn-only ceviche does not get an automatic raw asterisk unless raw/undercooked content is explicit. A chef-written asterisk is never removed, and ceviche that also names a fish (seabass, tuna, hamachi) is not exempt. Source: one pending reviewer correction (`09b648b4`, 2026-08-20, "shrimp not raw").
- **Allergen codes and raw markers (2026-09-26)**: The AI review never adds or removes allergen codes in the delivered menu (suggestions only), and never removes a raw asterisk. Enforced in code; see [allergen-and-raw-marker-guards.md](../design-docs/allergen-and-raw-marker-guards.md).

## Related Files

- `sop-processor/qa_prompt.txt` — The QA prompt template that references SOP rules and sets severity levels
- `sop-processor/sop_rules.md` — The actual rules document (source of truth)
- `services/ai-review/` — The service that executes AI review using these prompts

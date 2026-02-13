# SOP Rules Reference

The authoritative SOP rules document lives at:

```
sop-processor/sop_rules.md
```

This file contains the standard operating procedure rules that the AI review service uses to validate menu content. It is processed by scripts in `sop-processor/` and fed into the AI prompts.

## Related Files

- `sop-processor/qa_prompt.txt` — The QA prompt template that references SOP rules and sets severity levels
- `sop-processor/sop_rules.md` — The actual rules document (source of truth)
- `services/ai-review/` — The service that executes AI review using these prompts

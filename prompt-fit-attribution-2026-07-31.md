# Stage 3 prompt-fit attribution

Run date: 2026-07-31 local time (reports were written after midnight UTC)

The Stage 3 grid used the 251-case dataset with the existing full prompt and the new [`qa_prompt_minimal.txt`](sop-processor/qa_prompt_minimal.txt) base prompt. The harness appends its normal runtime sections to either base file. Positive ablation deltas below mean that omitting the section scored better on the 10-case ablation slice; negative values mean the section helped.

## Minimal vs full

The comparison uses only case IDs completed in both arms. F1 is micro-averaged over those common cases; composite is the mean per-case composite.

| Model | Full cases | Minimal cases | Common | Full composite | Minimal composite | Delta | Full F1 | Minimal F1 | Delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-4o-mini-2024-07-18 | 251 | 250 | 250 | 75.97% | 75.80% | -0.17 pp | 50.83% | 51.90% | +1.07 pp |
| gpt-5.6-luna | 251 | 242 | 242 | 76.09% | 66.36% | -9.74 pp | 56.14% | 28.07% | -28.07 pp |

The minimal 4o-mini result is effectively flat on composite and slightly better on correction F1. Luna degrades sharply with the minimal prompt, driven by much lower precision and increased malformed/over-eager suggestion behavior. The minimal Luna report includes one fence-missing scored failure and nine evaluator errors from the existing string-suggestion mutation exception; errors are excluded from the common-case comparison.

## Section ablation: 10 cases per section

| Prompt section | 4o composite Δ | 4o F1 Δ | Luna composite Δ | Luna F1 Δ |
|---|---:|---:|---:|---:|
| raw_marker_placement | +4.52 pp | +4.52 pp | -0.10 pp | -1.19 pp |
| prix_fixe | +0.00 pp | +0.00 pp | +0.00 pp | +0.00 pp |
| allergens | +0.53 pp | +2.30 pp | -0.57 pp | -6.04 pp |
| corrected_menu_structure_rules | -1.74 pp | -6.35 pp | +1.21 pp | +2.14 pp |
| pre_ai_deterministic_checks | +3.76 pp | +2.19 pp | +0.45 pp | +0.00 pp |
| changed_only_scope | +0.00 pp | +0.00 pp | +0.00 pp | +0.00 pp |
| footer_rules | +4.08 pp | +4.10 pp | -2.08 pp | -8.84 pp |
| add_on_price_rules | +3.80 pp | +2.19 pp | +5.50 pp | +4.56 pp |
| standard_item_price_rules | +4.56 pp | +4.52 pp | +0.81 pp | +1.11 pp |
| selection_instruction_rules | +4.08 pp | +3.33 pp | +0.42 pp | +0.00 pp |
| embedded_set_menu_rules | +0.00 pp | +0.00 pp | +0.00 pp | +0.00 pp |
| canonical_vocabulary_near_misses | +2.54 pp | -3.17 pp | -0.20 pp | -1.19 pp |

This small slice does not justify deleting rules yet. The clearest model-specific signal is `corrected_menu_structure_rules`: it helps 4o-mini but removal improves Luna. Several price/format sections score better when omitted for both models on this slice, while allergen/footer/raw-marker sections favor Luna relative to 4o. The expected “helps both” core section is not cleanly isolated by n=10; rerun at a larger cap before changing either prompt.

## Reproducibility

- Full 4o-mini: `tmp/review-eval/2026-08-01T00-05-01-927Z-phase-e-full-4o-mini/report.json`
- Full Luna: `tmp/review-eval/2026-08-01T00-13-40-973Z-phase-e-full-luna/report.json`
- Minimal 4o-mini: `tmp/review-eval/2026-08-01T00-20-53-507Z-phase-e-minimal-4o-mini/report.json`
- Minimal Luna: `tmp/review-eval/2026-08-01T00-31-02-415Z-phase-e-minimal-luna/report.json`
- Final 4o-mini ablation: `tmp/review-eval/2026-08-01T00-41-50-821Z-phase-e-ablate-4o-mini-10-final/report.json`
- Final Luna ablation: `tmp/review-eval/2026-08-01T00-41-50-806Z-phase-e-ablate-luna-10-final/report.json`

Measured token-cost proxy across the grid and first ablation runs: approximately **$6.54**, using the published [GPT-4o mini rates](https://developers.openai.com/api/docs/models/gpt-4o-mini) and [GPT-5.6 Luna rates](https://developers.openai.com/api/docs/models/gpt-5.6-luna). The final ablation reruns were cache-only.

# AI Training Pipeline

**Status:** Operational (Phase 1)
**Last updated:** Mar 2026

End-to-end documentation of how the AI prompt improves over time as menus are reviewed, corrected, and approved.

---

## Overview

The training pipeline is a closed-loop system: chefs submit menus, AI reviews them, human reviewers correct the AI's output, and those corrections feed back into future AI reviews. Over time the AI gets better at catching the same patterns reviewers keep fixing.

```
Chef submits menu
       |
       v
AI reviews (qa_prompt.txt + learned overlay)
       |
       v
Human reviewer corrects in ClickUp
       |
       v
ClickUp webhook fires
       |
       v
Differ service compares AI draft vs final
       |
       v
Token-level replacements extracted & stored
       |
       v
Rules aggregated (active / weak / conflicted)
       |
       v
Active rules injected into next AI review
       |
       v
Weekly optimization proposes prompt improvements
```

---

## 1. Data Capture (Automatic)

**Trigger:** ClickUp webhook fires when a reviewer marks a menu as corrected.

**What happens:**
1. `clickup-integration` downloads the corrected DOCX
2. Calls `differ` service: `POST /compare` with AI draft path + final approved path
3. `differ` extracts clean menu text from both DOCX files (via `extract_clean_menu_text.py`)
4. Line-diff alignment (LCS-based) matches corresponding lines between AI draft and final
5. Token-level replacements extracted as signals: `{ from: "Jalapeno", to: "Jalapeño", kind: "diacritic" }`

**What gets stored:**

| File | Format | Contents |
|------|--------|----------|
| `tmp/learning/training_data.jsonl` | JSON Lines | One entry per comparison: submission_id, timestamp, paths, analysis, signals |
| Comparison JSON (per submission) | JSON | Full line-by-line diff for the learning dashboard detail view |

**Signal types:**
- **Diacritic** — accent corrections (Jalapeno → Jalapeño)
- **Punctuation** — quote normalization, apostrophes
- **Spelling** — word corrections (mozarella → mozzarella)

**Guardrails to avoid noise:**
- Filters stopwords (of, or, the, a, an, may)
- Filters allergen codes (D, G, VG, etc.)
- Requires tokens >= 3 characters
- Rejects numeric-heavy tokens
- Levenshtein distance check for similarity
- Very long tokens filtered

---

## 2. Rule Aggregation (Automatic)

After each comparison, `differ` rebuilds `tmp/learning/learned_rules.json` from all training data.

**Rule classification:**

| Status | Criteria | In prompt? |
|--------|----------|-----------|
| **Active** | >= 2 occurrences AND dominance >= 0.6 | Yes |
| **Weak** | < 2 occurrences (seen once) | No |
| **Conflicted** | Dominance < 0.6 (same source maps to multiple targets) | No |

**Confidence scoring:** 0.35–0.95 based on:
- Base: 0.4
- Occurrence bonus (more sightings = higher)
- Submission count bonus (seen across different menus)
- Kind bonus (diacritical +0.2, punctuation +0.1)
- Conflict penalty (multiple targets reduces confidence)

**Dominance:** `occurrences_for_this_target / total_occurrences_for_source_term`. If "Jalapeno" maps to "Jalapeño" 9 times and "Jalapeno" 1 time, dominance for the accent version is 0.9.

---

## 3. Prompt Injection (Automatic)

On every AI QA check (`/api/form/basic-check`), the dashboard:

1. Loads base prompt: `sop-processor/qa_prompt.txt`
2. Fetches `GET /learning/overlay` from differ service
3. Appends overlay to prompt before sending to OpenAI

**Overlay format:**
```
### LEARNED HUMAN REVIEW CORRECTIONS (AUTO-GENERATED)
Apply these conservatively when context matches; do not force a change if uncertain.
- "Jalapeno" -> "Jalapeño" (seen 5x)
- "mozarella" -> "mozzarella" (seen 3x)
...
```

**Controls:**
- `LEARNING_MAX_OVERLAY_RULES` (default 25) — caps how many rules get injected
- Manual disable via `POST /learning/overrides` — excluded from overlay
- Fail-open: if differ is unreachable, QA check runs without overlay

---

## 4. Human Annotation (Manual)

The learning dashboard provides a review interface for understanding WHY corrections happened.

**Dashboard:** `GET /learning`
- Shows all rules: active, weak, conflicted with confidence scores
- Enable/disable toggle per rule
- Recent training submissions with change % and signal counts
- Side-by-side: base prompt vs learned overlay vs effective prompt

**Submission detail:** `GET /learning/submission/:submissionId`
- Line-by-line original vs corrected with token-level highlighting
- Per-correction annotation form:
  - **Explanation** (required): why the correction matters
  - **Restaurant name** (required)
  - **Property** (optional): tag rule to specific locations
  - **Shared properties** (optional): apply to multiple locations

**Storage:** `tmp/learning/location_specific_rules.json`
- These annotations are NOT auto-injected into the prompt
- They feed into weekly prompt optimization for human review

---

## 5. Weekly Prompt Optimization (Semi-Automated)

**Command:** `npm run prompt:optimize`

**Inputs:**
- All training data (`training_data.jsonl`, latest entry per submission)
- AI draft and final DOCX text for each submission
- Current base prompt (`qa_prompt.txt`)
- Location-specific annotations (`location_specific_rules.json`)

**Process:**
1. Builds candidate rule pool from all observed corrections
2. Train/holdout split by submission_id
3. Greedy rule selection: picks rules that improve replay score on training set
4. Measures exact-match rate and average similarity on holdout set

**Output:** `tmp/prompt-optimizer/{timestamp}/`

| File | Purpose |
|------|---------|
| `report.md` | Human-readable weekly summary |
| `report.json` | Machine-readable metrics + selected rules |
| `prompt_addendum.txt` | Candidate new guidance block |
| `candidate_prompt.txt` | Full prompt (base + addendum) |

**Usage:** Review `report.md`, decide what to merge into `qa_prompt.txt` manually. This is intentionally not automated — prompt changes need human judgment.

---

## 6. What's NOT Automated Yet

| Gap | Current State | Future |
|-----|--------------|--------|
| Auto-editing `qa_prompt.txt` | Manual merge after weekly optimization | Could auto-merge with approval gate |
| Location-specific rule injection | Captured but not in prompt | Could inject per-property rules when property is known at submission time |
| Scheduling weekly optimization | CLI command, run manually | Cron job or CI scheduled task |
| Semantic correction extraction | Token replacements only (A → B) | Could capture structural changes (line reordering, section additions) |
| Rule reasoning in prompt | Overlay says "seen 5x" but not WHY | Could include human explanations from annotations |
| Promoting weak/conflicted rules | Manual review in dashboard | Could surface candidates with approval workflow |

---

## 7. File Storage Layout

### Documents

```
{DOCUMENT_STORAGE_ROOT}/
└── {property}/
    └── {project}/
        └── {submissionId}/
            ├── original/      Chef-submitted DOCX
            ├── baseline/      Approved DOCX for revision mode
            └── approved/      Final corrected DOCX from ClickUp
```

Controlled by `DOCUMENT_STORAGE_ROOT` env var. Defaults to `tmp/documents` (ephemeral).

### Learning Data

```
tmp/learning/
├── training_data.jsonl              One JSON object per comparison (append-only)
├── learned_rules.json               Aggregated rule snapshot (rebuilt on each compare + startup)
├── rule_overrides.json              Manual enable/disable toggles
└── location_specific_rules.json     Human annotations tied to properties
```

### Prompt Optimization Output

```
tmp/prompt-optimizer/
└── {timestamp}/
    ├── report.md
    ├── report.json
    ├── prompt_addendum.txt
    └── candidate_prompt.txt
```

---

## 8. Cloud Deployment — Storage Requirements

All training data and documents currently live in `tmp/`. This is ephemeral in cloud deployments. If the container restarts, everything is lost and the learning loop resets to zero.

### Option A: Persistent Volume (EBS/Azure Disk) — Recommended for Single Container

Mount a persistent disk and point both `DOCUMENT_STORAGE_ROOT` and learning data to it.

```
/mnt/persistent/
├── documents/          DOCUMENT_STORAGE_ROOT
└── learning/           training_data.jsonl, learned_rules.json, etc.
```

| Pros | Cons |
|------|------|
| Simplest migration (no code changes) | Single-container only |
| JSONL append works naturally | Disk size must be pre-provisioned |
| Low cost (~$0.10/GB/month EBS) | Not shareable across instances |

### Option B: S3 + Database — Required for Multi-Container / Scale

| Data | Storage | Why |
|------|---------|-----|
| DOCX files (original, baseline, approved) | **S3** | Large binary files, infrequent access |
| Training data (signals, comparisons) | **DynamoDB or Supabase** | Structured, needs querying |
| Learned rules snapshot | **DynamoDB or Supabase** | Small JSON, needs atomic updates |
| Rule overrides | **DynamoDB or Supabase** | Small, needs read/write |
| Location-specific annotations | **DynamoDB or Supabase** | Needs querying by property/submission |

Would require:
- New storage abstraction layer in differ service (replace `fs.readFile`/`fs.writeFile` with provider interface)
- S3 upload/download in clickup-integration and dashboard for DOCX handling
- Database migration for learning tables

### Option C: EFS (AWS) / Azure Files — Middle Ground

Shared filesystem mount that works across multiple containers.

| Pros | Cons |
|------|------|
| No code changes (same as local fs) | Higher latency than EBS |
| Works with multiple containers | More expensive (~$0.30/GB/month) |
| JSONL append works | Needs VPC/network config |

### Recommendation

Start with **Option A** (persistent volume). It requires zero code changes and handles the expected volume. Move to **Option B** only if scaling to multiple containers or if document volume exceeds what a single disk can handle.

---

## 9. Key Files

| File | Service | Role |
|------|---------|------|
| `sop-processor/qa_prompt.txt` | — | Base AI prompt (manually maintained) |
| `services/differ/index.ts` | differ | Comparison engine, rule aggregation, learning APIs |
| `services/dashboard/index.ts` | dashboard | `/api/form/basic-check` (injects overlay), `/learning` routes |
| `services/dashboard/views/learning.ejs` | dashboard | Learning dashboard UI |
| `services/dashboard/views/learning-submission.ejs` | dashboard | Per-submission correction detail + annotation form |
| `services/clickup-integration/index.ts` | clickup | Webhook handler that triggers differ comparison |

## 10. Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LEARNING_MIN_OCCURRENCES` | `2` | Rules need this many sightings to become active |
| `LEARNING_MAX_OVERLAY_RULES` | `25` | Max rules injected into prompt overlay |
| `DOCUMENT_STORAGE_ROOT` | `tmp/documents` | Root path for all DOCX storage |

---

## Related Docs

- [Reviewer Learning Loop](reviewer-learning-loop.md) — Differ service details, endpoints, guardrails
- [Weekly Prompt Optimization](prompt-optimization.md) — Optimization command, inputs/outputs
- [Document Storage](document-storage.md) — Storage layout, deployment checklist
- [Critical Error Blocking](critical-error-blocking.md) — How critical errors interact with the AI prompt

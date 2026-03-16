# Learning Pipeline v2 — Human-in-the-Loop Prompt Evolution

> Replaces: auto-injection overlay system (v1)
> Status: Design

## Problem

The v1 learning system auto-injects correction rules into the AI prompt after 2 occurrences, with no human review. This creates risk:
- Noisy patterns (e.g., "crisp → crispy") get auto-applied to every menu
- No context about *why* a correction was made or *where* it applies
- Location-specific corrections get treated as universal rules
- The "learned overlay" is a black box that grows silently

## Design Principles

1. **Never auto-modify the prompt.** The system proposes — humans decide.
2. **Every correction carries context.** Not just "A → B" but why, where, and how broadly it applies.
3. **Weekly batch optimization.** Accumulate corrections all week, then rewrite the prompt once with full context.
4. **The base prompt is the single source of truth.** No overlay layer — just one prompt that evolves weekly.

## Architecture

```
                        ONGOING (per submission)
                        ========================

Chef submits menu
        ↓
AI reviews (current base prompt)
        ↓
Human corrects in ClickUp
        ↓
ClickUp webhook fires
        ↓
Differ extracts before/after corrections
        ↓
Dashboard shows corrections for annotation
        ↓
Human annotates each correction:
  - Why was this changed?
  - Which restaurant / location?
  - Location-specific or universal?
  - Other locations this applies to?
        ↓
Stored as "correction_rules" in Supabase
(No prompt changes yet — just accumulation)


                     WEEKLY (batch, human-gated)
                     ===========================

Cron or manual trigger: "Generate prompt proposal"
        ↓
Gather:
  - All before docs (original DOCX)
  - All after docs (approved DOCX)
  - All annotated correction_rules from the week
  - Current base prompt
        ↓
Feed everything to LLM:
  "Here is the current prompt. Here are the corrections
   humans made this week, with their reasoning. Rewrite
   the prompt so it would have gotten everything right
   the first time."
        ↓
LLM returns proposed new prompt
        ↓
Dashboard shows diff: current prompt vs proposed prompt
        ↓
Human reviews: approve / modify / reject
        ↓
If approved → new base prompt takes effect
```

## Data Model

### `correction_rules` Table (Supabase)

Replaces: `location_specific_rules.json` (local file)

```sql
CREATE TABLE IF NOT EXISTS correction_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to the submission where this correction was observed
    submission_id VARCHAR(100) NOT NULL,
    correction_id VARCHAR(100) NOT NULL,

    -- The actual correction
    original_text TEXT NOT NULL,          -- Before text (line or phrase)
    corrected_text TEXT NOT NULL,         -- After text
    change_type VARCHAR(50),             -- 'diacritic', 'spelling', 'punctuation',
                                         -- 'capitalization', 'content', 'formatting'

    -- Human annotation (the important part)
    rule TEXT NOT NULL,                   -- Human-written rule / reasoning
                                         -- e.g., "Jalapeño always needs the ñ per RSH brand guide"
    is_location_specific BOOLEAN DEFAULT false,

    -- Context
    project_name VARCHAR(255),
    restaurant_name VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,       -- Primary property
    other_applicable_locations TEXT[],     -- Other locations this rule applies to
    reviewer_name VARCHAR(255),

    -- Review status for proposed rules
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'modified'
    source VARCHAR(50) DEFAULT 'human',   -- 'human' (manually annotated) or 'system' (auto-detected pattern)

    -- For system-proposed rules: pattern detection metadata
    occurrences INTEGER DEFAULT 1,
    confidence NUMERIC(4,3),
    submission_ids TEXT[],                -- All submissions where this pattern appeared

    -- Weekly prompt cycle tracking
    prompt_cycle_id VARCHAR(100),         -- Which weekly cycle consumed this rule
    consumed_at TIMESTAMPTZ,             -- When it was incorporated into a prompt proposal

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_correction_rules_submission ON correction_rules(submission_id);
CREATE INDEX idx_correction_rules_status ON correction_rules(status);
CREATE INDEX idx_correction_rules_location ON correction_rules(location);
CREATE INDEX idx_correction_rules_unconsumed ON correction_rules(prompt_cycle_id)
    WHERE prompt_cycle_id IS NULL;
```

### `prompt_proposals` Table (Supabase)

Tracks weekly prompt rewrite proposals.

```sql
CREATE TABLE IF NOT EXISTS prompt_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The proposal
    cycle_id VARCHAR(100) NOT NULL UNIQUE,  -- e.g., "2026-W12"
    current_prompt TEXT NOT NULL,            -- Snapshot of prompt at generation time
    proposed_prompt TEXT NOT NULL,           -- LLM's proposed rewrite
    prompt_diff TEXT,                        -- Unified diff for review

    -- What went into this proposal
    correction_rule_count INTEGER,
    submission_count INTEGER,
    date_range_start DATE,
    date_range_end DATE,

    -- LLM reasoning
    llm_analysis TEXT,                      -- LLM's explanation of what it changed and why
    llm_model VARCHAR(100),                 -- Which model generated this

    -- Human review
    status VARCHAR(50) DEFAULT 'pending',   -- 'pending', 'approved', 'approved_modified', 'rejected'
    reviewer_name VARCHAR(255),
    reviewer_notes TEXT,
    final_prompt TEXT,                       -- The actually-approved prompt (may differ from proposed)
    reviewed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Flows

### Flow 1: Correction Annotation (Per Submission)

**Trigger:** Human views a completed submission in the learning dashboard.

**Current state:** The `learning-submission.ejs` view already shows before/after corrections with annotation fields. It needs enrichment.

**Changes to annotation form:**

| Field | Current | New |
|-------|---------|-----|
| Explanation | Free text | Renamed to **"Rule"** — the actionable instruction |
| Restaurant | Hidden, auto-filled | Visible, editable |
| Location | Dropdown | Dropdown + **"Location-specific?"** checkbox |
| Shared locations | Multi-select | Renamed to **"Other applicable locations"** |
| Project name | Not captured | Added from submission metadata |
| Change type | Not captured | Auto-detected + editable dropdown |
| Reviewer | Optional text | Optional text |

**Additionally:** The differ service should auto-propose rules for patterns it detects (e.g., diacritics seen 3+ times). These show up as `source: 'system'` with `status: 'pending'` — the human can accept, reject, or modify them. This replaces the current auto-promotion to "active" rules.

### Flow 2: System-Proposed Rules

**Trigger:** After each `POST /compare`, the differ service checks if any new replacement patterns cross a threshold.

**Instead of auto-promoting to the overlay:**
1. Differ detects pattern: "Jalapeno → Jalapeño" seen 3 times across 2 submissions
2. Creates a `correction_rules` record with `source: 'system'`, `status: 'pending'`
3. Dashboard shows these in a "Proposed Rules" section with an accept/reject/modify UI
4. Human reviews: accepts (optionally adds context), rejects, or modifies the rule text
5. Accepted rules feed into the weekly prompt cycle

**Key difference from v1:** System-detected patterns are *proposals*, not auto-injected rules.

### Flow 3: Weekly Prompt Rewrite

**Trigger:** Manual button in dashboard or scheduled cron (Sunday night).

**Steps:**

1. **Gather inputs:**
   - All `correction_rules` where `prompt_cycle_id IS NULL` (unconsumed)
   - Document pairs (original DOCX + approved DOCX) for those submissions
   - Current base prompt (`sop-processor/qa_prompt.txt`)

2. **Build LLM request:**
   ```
   You are a prompt engineer improving an AI menu editor.

   ## Current Prompt
   {current base prompt}

   ## This Week's Corrections
   {For each correction_rule:}
   - Submission: {project_name} / {restaurant_name} / {location}
   - Original: "{original_text}"
   - Corrected: "{corrected_text}"
   - Rule: "{rule}"
   - Scope: {location_specific ? "Location-specific: {location}" : "Universal"}
   - Also applies to: {other_applicable_locations}

   ## Sample Before/After Documents
   {For up to 10 representative submissions:}
   ### Submission {id} — {project_name}
   **AI Draft (excerpt):**
   {first 500 chars of AI draft text}
   **Human-Corrected (excerpt):**
   {first 500 chars of final text}

   ## Your Task
   Rewrite the prompt so that it would produce the human-corrected
   output on the first pass. Explain what you changed and why.
   Keep the same structure and formatting conventions.
   Do not remove existing rules unless a correction contradicts them.
   For location-specific rules, add them in a clearly labeled section.
   ```

3. **Generate proposal:**
   - Store in `prompt_proposals` table
   - Generate unified diff between current and proposed
   - Mark all consumed `correction_rules` with the `cycle_id`

4. **Human review (dashboard UI):**
   - Side-by-side: current prompt vs proposed prompt (with diff highlighting)
   - LLM's explanation of changes
   - List of correction_rules that fed into this proposal
   - Actions: Approve as-is / Edit & approve / Reject
   - On approve: write to `sop-processor/qa_prompt.txt`, record in `prompt_proposals`

## What Changes From v1

| Aspect | v1 (Current) | v2 (New) |
|--------|-------------|----------|
| Rule activation | Auto after 2 occurrences | Human accept/reject |
| Prompt modification | Overlay appended silently | Full prompt rewrite, human-approved |
| Rule context | Just "A → B (seen Nx)" | Full JSON: why, where, scope |
| Location awareness | Captured but not injected | Explicit scope (universal vs location-specific) |
| Overlay layer | Exists, grows silently | Eliminated — single prompt, no overlay |
| Weekly optimization | Token-matching script | LLM-powered prompt rewrite |
| Storage | Local JSONL/JSON files | Supabase tables |

## What Gets Removed

1. **Auto-injection:** `fetchLearnedPromptOverlay()` call in `basic-check` — remove
2. **Learned overlay box:** Dashboard "LEARNED OVERLAY (INJECTED)" section — remove
3. **Effective prompt box:** No longer needed (base prompt = effective prompt)
4. **Auto rule promotion:** `rebuildLearnedRules()` no longer promotes to active/injects
5. **Rule enable/disable toggles:** Replaced by accept/reject on proposals
6. **`learned_rules.json`:** No longer written or read for injection
7. **`rule_overrides.json`:** Replaced by `status` field on `correction_rules`

## What Gets Kept

1. **Differ comparison engine:** Still extracts before/after token-level diffs — core value
2. **Training data JSONL:** Still appended for history/audit
3. **Correction annotation UI:** Enhanced, not replaced
4. **Document pair tracking:** The assets table + `document_pairs` view we just built
5. **`rebuildLearnedRules()`:** Repurposed — instead of building an overlay, it proposes `correction_rules` with `source: 'system'`

## Migration Path

Since v1 data is minimal (the system is new), migration is straightforward:

1. Create `correction_rules` and `prompt_proposals` tables in Supabase
2. Migrate any existing `location_specific_rules.json` entries to `correction_rules`
3. Remove overlay injection from `basic-check` route
4. Update dashboard views (remove overlay/effective boxes, add proposal review UI)
5. Rewrite `scripts/prompt-optimize.js` to use LLM + Supabase
6. Keep differ's comparison engine intact — change what it does with results

## Dashboard Changes

### Learning Dashboard (`/learning`)

**Remove:**
- "Learned Overlay (Injected)" textarea
- "Effective Prompt (Current Runtime)" textarea
- Auto-promoted rules table with enable/disable toggles

**Keep:**
- "Base QA Prompt" textarea (now the only prompt view)
- Recent learned submissions table
- Location-specific rules table (now reads from Supabase)

**Add:**
- **"Proposed Rules"** section: system-detected patterns awaiting review
  - Accept / Reject / Modify buttons per rule
  - Bulk accept/reject
- **"Weekly Prompt Proposal"** section:
  - Current prompt vs proposed prompt diff
  - LLM analysis summary
  - Approve / Edit & Approve / Reject buttons
  - History of past proposals with status
- **Stats:** Corrections this week, rules pending review, last prompt update date

### Submission Detail (`/learning/submission/:submissionId`)

**Enhance annotation form:**
- Add "Rule" label (replacing "Explanation")
- Add "Location-specific?" checkbox
- Add "Project name" field (auto-filled)
- Add "Change type" dropdown (auto-detected, editable)
- Show system-proposed rules inline with accept/modify UI

## Implementation Order

1. **Create Supabase tables** — `correction_rules`, `prompt_proposals`
2. **Remove auto-injection** — delete overlay fetch from `basic-check`
3. **Update annotation form** — enrich fields, write to Supabase
4. **Add system proposal flow** — differ creates pending rules instead of auto-promoting
5. **Build proposal review UI** — accept/reject/modify in dashboard
6. **Build weekly prompt rewrite** — LLM-powered, writes to `prompt_proposals`
7. **Build prompt approval UI** — diff view, approve/edit/reject
8. **Remove v1 artifacts** — overlay boxes, toggle UI, learned_rules.json injection

## Cost Estimate

- Weekly LLM call: ~$0.50-2.00/week (depends on corpus size, using GPT-4o or Claude)
- Supabase: within free tier (small tables)
- No infrastructure changes needed — runs on existing Lightsail instance

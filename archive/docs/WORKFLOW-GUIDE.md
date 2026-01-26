# Email Processing Workflow Guide

## 🎯 Recommended Setup: Folder-Based Processing

To avoid accidentally processing correction emails or creating infinite loops, we **strongly recommend** using **folder-based processing** where the user manually moves emails to a designated folder.

## Why Folder-Based? 

### ✅ Pros
- **100% Control**: You decide exactly which emails to process
- **No False Triggers**: System won't process its own correction emails
- **No Duplicates**: Clear separation between "to process" and "processed"
- **Audit Trail**: Easy to see what's been submitted
- **Safe & Reliable**: Zero chance of infinite loops

### ❌ Auto-Processing Risks
- Could process correction emails (with RE: prefix)
- Might process unrelated .docx attachments
- Harder to prevent duplicates
- Less control over what gets reviewed

## Setup Instructions

### 1. Configure for Folder Monitoring

Edit your `.env` file:
```bash
# Set the folder name to monitor
GRAPH_FOLDER_NAME=Menu Submissions

# Optional: Remove subject filtering since folder movement is the trigger
# (Subject filtering still happens as backup safety check)
```

### 2. Create the Folder in Outlook

1. Open Outlook
2. Right-click on your Inbox
3. Select "New Folder"
4. Name it: **"Menu Submissions"** (must match GRAPH_FOLDER_NAME exactly)

### 3. How to Use

When a chef sends a menu submission:

1. **Email arrives** in inbox (subject: "Menu Design Submission")
2. **You review** the email briefly
3. **You drag** the email to "Menu Submissions" folder
4. **System automatically processes** the submission
5. **Logs show** the processing happening in real-time

## Safety Checks (Applied Automatically)

Even with folder-based processing, we have **multiple layers of safety**:

### Layer 1: Duplicate Detection ✓
- Tracks all processed message IDs
- Won't process the same email twice
- Persists across restarts

### Layer 2: System Email Exclusion ✓
- Automatically excludes emails FROM `designapproval@richardsandoval.com`
- Prevents processing our own correction emails

### Layer 3: Sender Domain Verification ✓
- Only processes emails from approved domains
- Set in `APPROVED_SENDER_DOMAINS` env variable

### Layer 4: Template Validation ✓
- Validates against RSH DESIGN BRIEF templates (FOOD or BEVERAGE)
- Auto-detects template type
- Checks for required sections and structure
- Templates:
  - Food: `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
  - Beverage: `samples/RSH Design Brief Beverage Template.docx`
- Rejects documents that don't match either template

**Note**: Reply/forward detection removed - menu submissions often come within ongoing email conversations with chefs. The template validation (Layer 4) ensures only proper submissions are processed.

## The Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Chef emails menu.docx to designapproval@...             │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Email arrives in Inbox                                   │
│    Subject: "Menu Design Submission for Location X"         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. YOU: Review and drag to "Menu Submissions" folder        │
│    [This is your quality gate]                              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Microsoft Graph webhook triggers                         │
│    System receives notification                             │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Safety Checks Applied:                                   │
│    ✓ Not already processed?                                 │
│    ✓ Not from our own system?                               │
│    ✓ Not a reply/forward?                                   │
│    ✓ From approved domain?                                  │
│    ✓ Has .docx attachment?                                  │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Download attachment & send to Parser                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Template Validation                                      │
│    ✓ Pass → AI Review                                       │
│    ✗ Fail → Notify chef to use correct template            │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Tier 1 AI Review (General QA)                           │
│    ✓ Pass → Generate draft (Tier 2)                        │
│    ✗ Fail → Send feedback to chef                          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. Tier 2: AI generates red-lined draft                    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. Internal reviewer notified                              │
│     Email sent to INTERNAL_REVIEWER_EMAIL                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 11. Human reviews in Dashboard                              │
│     Makes final corrections                                 │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 12. Final approved document sent to chef                    │
│     (This email stays in Sent Items - won't be processed)   │
└─────────────────────────────────────────────────────────────┘
```

## Current Rules & Guidance

### Tier 1: QA Pre‑Check (Chef‑Facing, SOP‑Only)
- Purpose: Gatekeep obvious quality issues before human review.
- Prompt: Uses `sop-processor/qa_prompt.txt` exactly as given to chefs in the SOP.
- Scope: General spelling/grammar/language consistency, formatting consistency, clarity, cultural appropriateness.
- No custom house rules are applied here. If it fails, the system auto‑replies instructing the chef to run the SOP prompt themselves and resubmit.

### Tier 2: Redlining (Internal, Custom Rules Applied)
- After Tier 1 passes, we generate a red‑lined draft using enhanced house rules from `sop-processor/sop_rules.json`.
- **CAPITALIZATION IS CONSERVATIVE**:
  - Do NOT capitalize lowercase adjectives in descriptions (australian, roasted, grilled, seared, shaved, stuffed, chilean, serrano, mezcal, etc.)
  - Ingredient descriptions MUST stay lowercase per RSH style
  - Only fix obvious errors (ALL CAPS that shouldn't be, proper nouns that should be capitalized)
  - Do NOT change "Choose one" to "Choose One" or similar
- **PRIX FIXE / TASTING MENU HANDLING**:
  - Automatically detects prix fixe menus by keywords (prix fixe, tasting menu, degustation, etc.)
  - Adds course numbers (1, 2, 3, 4...) before each course section header
  - Course headers are identified by patterns like "The Spark – 'El Primer Encuentro'"
- Enforced items include:
  - DO NOT change ingredient separators - keep commas and hyphens as they are
  - DO NOT split compound words (yuzu-lime, cucumber-cilantro, huitlacoche-stuffed)
  - Dual prices: use " | " (space‑bar‑space) to separate two prices, disallow "/".
  - Allergen/dietary markers: on the item line, uppercase, comma‑separated with no spaces, alphabetized.
  - Raw/undercooked items: append asterisk (*) after items with raw fish, tartare, carpaccio, raw egg, caviar, oysters.
  - Diacritics: enforce correct accents (e.g., jalapeño, tajín, crème brûlée, rosé, rhône, leña, Ànima, Vē‑vē).
  - Non‑trivial spellings: tartare (not tartar), mozzarella, parmesan, Caesar, yuzu kosho, prix fixe (not pre-fix/prefix).
  - Item names not ALL CAPS (except approved acronyms/brands).
- Legacy interpretation: When reviewing older documents, red highlight may indicate deletions. For output going forward, we always use proper redlining (red strikethrough for deletions, yellow highlight for insertions).
- Letter‑level edits are allowed when they reflect the true change (e.g., adding "ñ" in jalapeño). The redliner preserves run‑level formatting.

### Where these rules live
- SOP rules JSON: `sop-processor/sop_rules.json` (consumed by Tier 2 prompt).
- Tier 1 QA prompt: `sop-processor/qa_prompt.txt` (SOP‑only, no customizations).
- Redline system prompt: `services/ai-review/index.ts` (reads SOP rules JSON).
- AI Corrector guidance: `services/docx-redliner/ai_corrector.py` (applies normalizations).

## What Happens to Correction Emails?

When the system sends the final corrected document back to the chef:

1. **Email goes to Sent Items** folder (not inbox)
2. **Webhook doesn't trigger** (only monitors specific folder)
3. **If it somehow got into the monitored folder**:
   - ✗ Blocked by "from own system" check
   - ✗ Blocked by "already processed" check
   - ✗ Blocked by reply detection (if chef replies)

**Result**: Zero chance of processing correction emails! 🎉

## Example Scenarios

### Scenario 1: Normal Submission ✅
```
Chef → menu.docx → designapproval@... → Inbox
You → Review → Move to "Menu Submissions"
System → Process → AI Review → Success
```

### Scenario 2: Email Thread with Chef ✅ (Allowed)
```
Team → Ongoing email thread with chef about menu
Chef → Replies mid-thread with "RE: Menu Discussion" + menu.docx
Email → Arrives in inbox
You → Review, move to "Menu Submissions"
System → Validates template → Process ✓
```
**Why this works**: Template validation ensures only proper submissions process, regardless of subject line.

### Scenario 3: System Email Gets Back ❌ (Blocked)
```
System → Sends final.docx to chef@example.com
Somehow → Email loops back to designapproval@...
System → Skips (from own address) ✓
```

### Scenario 4: Resubmission ✅
```
Chef → Gets Tier 1 rejection feedback
Chef → Fixes issues, sends NEW email with same attachment
You → Move NEW email to "Menu Submissions"
System → Process (new message ID, not duplicate) ✓
```

## Alternative: Auto-Processing (Not Recommended)

If you prefer automatic processing without manual folder movement:

```bash
# Leave this EMPTY in .env
GRAPH_FOLDER_NAME=

# System will monitor entire inbox
# Uses subject filtering: "Menu" or "Design Brief"
```

**⚠️ Warning**: This approach relies entirely on automated safety checks. While we have 4 layers of protection, manual folder movement is more foolproof.

## Best Practices

1. ✅ **Always use folder-based processing** in production
2. ✅ **Review emails briefly** before moving to processing folder
3. ✅ **Don't move reply threads** to the processing folder
4. ✅ **Check logs** to verify processing started
5. ✅ **Keep folder name consistent** with .env configuration
6. ❌ **Don't process old emails** that have already been handled
7. ❌ **Don't move system correction emails** back to processing folder

## Monitoring

Watch the logs to see what's happening:

```bash
# See all processing activity
./view-logs.sh inbound-email

# Look for these log messages:
✅ Processing new submission: [subject] from [email]
📥 Downloading attachment...
📤 File sent to parser successfully
✓ Message marked as processed

# Or these (good - safety checks working):
⏭️  Message already processed, skipping
⏭️  Message is from our own system, skipping
⏭️  Message is a reply or forward, skipping
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Folder not found | Ensure folder name in Outlook matches `GRAPH_FOLDER_NAME` exactly (case-insensitive) |
| Emails not processing | Check logs: `./view-logs.sh inbound-email` |
| Duplicate processing | Check `tmp/processed_message_ids.json` - delete if needed to reset |
| System processing own emails | Verify `GRAPH_MAILBOX_ADDRESS` is set correctly |

## Summary

**Use folder-based processing** for maximum safety and control. It's one extra manual step that prevents a world of potential issues. The system has multiple safety nets, but explicit user intent (moving to folder) is the most reliable trigger.


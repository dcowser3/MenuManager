# Email Processing Safety Solution

## The Problem You Identified ✅

You correctly identified a critical issue:
- System processes emails with .docx attachments
- When system sends back corrections, it also has .docx attachments
- **Risk**: System could process its own correction emails (infinite loop!)
- **Risk**: System could re-process the same submission multiple times

## Our Multi-Layered Solution

### Primary Defense: Folder-Based Processing (RECOMMENDED)

**How it works:**
1. User manually moves emails to "Menu Submissions" folder
2. System ONLY processes emails in that specific folder
3. Correction emails stay in Sent Items (never enter the folder)
4. User has full control over what gets processed

**Configuration:**
```bash
# In .env file
GRAPH_FOLDER_NAME=Menu Submissions
```

**Why this is best:**
- ✅ **Zero chance of infinite loops** - Sent emails never get processed
- ✅ **Complete control** - You decide what to process
- ✅ **Clear audit trail** - Folder shows what's been submitted
- ✅ **Simple to understand** - Move to folder = start processing

### Backup Defenses: Multiple Safety Layers

Even with folder-based processing, we have multiple safety nets:

**Important Notes**: 
- Reply/forward detection removed - submissions often come mid-thread in conversations
- Template validation added - only processes documents matching RSH template structure

#### Layer 1: Duplicate Detection 🛡️
```typescript
// Tracks every processed message ID
if (isAlreadyProcessed(message.id)) {
    console.log('Already processed, skipping');
    return;
}
```
- Stores IDs in `tmp/processed_message_ids.json`
- Won't process same email twice
- Persists across service restarts

#### Layer 2: System Email Exclusion 🛡️
```typescript
// Blocks emails FROM our own address
if (isFromOwnSystem(message)) {
    console.log('From our own system, skipping');
    return;
}
```
- Checks if sender = `GRAPH_MAILBOX_ADDRESS`
- Prevents processing outbound correction emails

#### Layer 3: Sender Domain Verification 🛡️
```typescript
// Only approved domains
if (!meetsCriteria(message)) {
    console.log('Sender not approved, skipping');
    return;
}
```
- Only processes emails from `APPROVED_SENDER_DOMAINS`
- Adds extra validation

#### Layer 4: Template Validation 🛡️
```typescript
// Validates RSH DESIGN BRIEF template structure
const validation = await validateTemplate(filePath);
if (!validation.isValid) {
    // Notify user and reject
}
```
- **Supports both FOOD and BEVERAGE templates**
- Detects template type automatically
- Validates "PROJECT DESIGN DETAILS" section exists
- Ensures "MENU SUBMITTAL SOP" is present
- Verifies expected steps (STEP 1, STEP 2)
- Templates:
  - `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
  - `samples/RSH Design Brief Beverage Template.docx`

## Example Scenarios

### ✅ Scenario 1: Normal Submission
```
1. Chef sends menu.docx to designapproval@...
2. Email arrives in inbox
3. You move it to "Menu Submissions" folder
4. System processes it (all checks pass)
5. AI reviews and generates draft
6. Internal reviewer notified
7. Final version sent to chef
```

### ❌ Scenario 2: System Email (BLOCKED)
```
1. System sends final.docx to chef@example.com
2. Email goes to Sent Items
3. Even if it somehow got to "Menu Submissions":
   ❌ Blocked by Layer 2 (from own system)
   ❌ Blocked by Layer 1 (already processed)
```

### ✅ Scenario 3: Chef Replies in Thread (ALLOWED - With Validation)
```
1. Email thread with chef ongoing
2. Chef sends menu.docx in reply
3. You move reply to "Menu Submissions":
   ✓ Allowed (replies are OK)
   ✓ Template validated (Layer 4)
   ✓ Only correct template processed
```

### ✅ Scenario 4: Resubmission (ALLOWED)
```
1. Chef gets Tier 1 rejection
2. Chef fixes issues, sends NEW email
3. You move NEW email to folder
4. System processes (new message ID) ✓
```

## Alternative: Auto-Processing

If you prefer automatic processing:

```bash
# Leave empty in .env
GRAPH_FOLDER_NAME=
```

System monitors entire inbox and uses all 4 safety layers. **Not recommended** because:
- Less control over what gets processed
- Relies entirely on automated checks
- Could have edge cases we haven't thought of

## What We Changed

### Updated Files:
1. **`services/inbound-email/src/graph.ts`**
   - Added duplicate tracking
   - Added system email detection
   - Added reply/forward detection
   - Improved logging with emojis

2. **`.env.example`**
   - Updated comments to recommend folder-based processing

3. **Documentation (NEW)**
   - `WORKFLOW-GUIDE.md` - Detailed workflow explanation
   - `SAFETY-SOLUTION.md` - This file
   - Updated `QUICK-START.md` and `README.md`

## Recommendation

**Use folder-based processing** (set `GRAPH_FOLDER_NAME=Menu Submissions`):
- One extra manual step (moving email to folder)
- Bulletproof safety
- Clear user intent
- Easy to understand and debug

The 4 safety layers provide defense-in-depth, but explicit user action is the most reliable trigger.

## Testing the Safety Checks

To verify the safety checks are working:

```bash
# Start the system
./start-services.sh

# Watch logs
./view-logs.sh inbound-email

# Try these tests:
# 1. Move same email twice → Should see "already processed"
# 2. Reply to an email → Should see "is a reply or forward"
# 3. Test with wrong sender → Should see "does not meet criteria"
```

## Template Validation (Layer 4)

The system now validates against both RSH templates:

**Supported Templates**:
- Food: `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
- Beverage: `samples/RSH Design Brief Beverage Template.docx`

**Validation Process**:
1. System detects template type (FOOD or BEVERAGE)
2. Validates common required elements:
   - ✓ "PROJECT DESIGN DETAILS" section
   - ✓ "MENU SUBMITTAL SOP" section
   - ✓ "STEP 1: OBTAIN APPROVALS"
   - ✓ "STEP 2: DESIGN DEVELOPMENT"
   - ✓ Minimum document length
3. Accepts either template type

**What happens if validation fails**:
- Submitter receives email with rejection reason
- Original template attached for reference
- Process stops before AI review (saves costs)

## Summary

✅ **Problem solved** with multiple approaches:
- Primary: Folder-based manual triggering (recommended)
- Backup: 4 automated safety layers
- Future: Can add template-specific validation

✅ **Zero risk of infinite loops**
✅ **No duplicate processing**
✅ **Full user control**

Your instinct to be cautious about this was absolutely right! 🎯


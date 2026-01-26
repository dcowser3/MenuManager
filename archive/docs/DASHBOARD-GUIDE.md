# Dashboard Guide - Human Review System

## Overview

The dashboard is the web interface where internal reviewers approve or correct AI-generated menu drafts. This is a critical part of the workflow that ensures quality and helps train the AI system.

## Complete Workflow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Email arrives → AI generates draft                   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Email notification sent to internal reviewer         │
│    Subject: "🔔 New Menu Submission for Review"         │
│    Contains: Direct link to dashboard                   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Reviewer clicks link → Dashboard opens               │
│    URL: http://localhost:3005/review/[submission-id]    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Reviewer downloads both documents:                   │
│    • Original submission (as submitted by chef)          │
│    • AI draft (with suggested corrections)               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Reviewer compares documents and chooses:             │
│                                                          │
│    OPTION A: Quick Approve ✅                            │
│    - AI draft is perfect                                │
│    - No additional changes needed                       │
│    - Click "Approve & Send to Chef"                     │
│                                                          │
│    OPTION B: Upload Corrections 📝                       │
│    - Reviewer made additional edits to AI draft         │
│    - Upload the corrected .docx file                    │
│    - Click "Upload & Send to Chef"                      │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 6. System processes approval:                           │
│    • Marks submission as "approved"                     │
│    • Triggers differ service (learns from changes)      │
│    • Sends final document to chef via email             │
└─────────────────────────────────────────────────────────┘
```

## Dashboard Features

### 📊 Home Page (`/`)
- **Lists all pending reviews**
- Shows submission details:
  - Filename
  - Submitter email
  - Submission date
  - Status
- Click "Review Now" to view details

### 📄 Review Page (`/review/:submissionId`)
- **Submission information**
- **Download buttons**:
  - Original submission
  - AI-generated draft
- **Two approval options**:
  - Quick Approve
  - Upload Corrected Version
- **Real-time feedback** on actions

## The Two Approval Paths

## Review Standards (What the AI enforces in drafts)

- Ingredient separators: " / " (space‑slash‑space), not hyphens as separators.
- Dual prices: " | " (space‑bar‑space), not "/".
- Allergen/dietary markers: on the item line, uppercase, comma‑separated with no spaces, alphabetized; append "*" for raw/undercooked.
- Diacritics and labels: enforce correct accents (e.g., jalapeño, tajín, crème brûlée, rosé, rhône, leña, Ànima, Vē‑vē).
- Non‑trivial spellings: tartare, mozzarella, parmesan, Caesar, yuzu kosho.
- Item names not ALL CAPS (except approved acronyms/brands).
- Letter‑level edits allowed where precise (e.g., ñ), with tracked changes preserved.
- Legacy docs: red highlight may indicate deletions; our outgoing drafts always use proper redlining visuals.

### Path 1: Quick Approve ✅

**When to use**: AI draft is perfect, no changes needed

**How it works**:
1. You review AI draft
2. Agree it's ready to send
3. Click "Approve & Send to Chef"
4. System:
   - Uses AI draft as final version
   - Logs that no changes were made
   - Sends to differ service (records "AI was perfect")
   - Emails chef with AI draft

**Why this matters**: Shows AI is improving! When you approve without changes, it means AI is learning well.

### Path 2: Upload Corrected Version 📝

**When to use**: You made additional corrections to AI draft

**How it works**:
1. Download AI draft
2. Make your corrections in Word
3. Save the corrected file
4. Upload corrected .docx file
5. Click "Upload & Send to Chef"
6. System:
   - Uses YOUR version as final
   - Compares AI draft vs your version
   - Logs differences for AI learning
   - Emails chef with your corrected version

**Why this matters**: Your corrections train the AI! Every change you make helps the AI improve for future submissions.

## AI Learning System

### How It Works

When you upload corrections, the **differ service** analyzes:

1. **What did the AI get right?** (text that stayed the same)
2. **What did you change?** (your corrections)
3. **How significant?** (percentage of changes)

This data is saved to: `tmp/learning/training_data.jsonl`

### Training Data Format

Each approval creates a training entry:
```json
{
  "submission_id": "sub_1234567890",
  "timestamp": "2024-10-18T10:30:00Z",
  "changes_detected": true,
  "change_percentage": 5.2,
  "ai_draft_path": "path/to/draft.txt",
  "final_path": "path/to/final.docx"
}
```

### Future Use

This training data will be used to:
- Fine-tune the AI model
- Identify patterns in corrections
- Improve AI suggestions over time
- Reduce need for human corrections

## Email Notifications

### Reviewer Notification Email

When AI finishes a draft, you receive:

**Subject**: 🔔 New Menu Submission for Review: [filename]

**Content**:
- Submission details
- Direct link to review page
- Instructions
- Reminder that corrections help train AI

**Example**:
```
A new menu submission has passed the initial AI check 
and is ready for your review.

Submission ID: sub_1234567890
Original Filename: Fall_Menu_2024.docx
Submitter: chef@restaurant.com
Status: Pending Your Review

[📊 Review Now →] (clickable button/link)

Your review helps train the AI system...
```

### Chef Notification Email

After you approve, chef receives:

**Subject**: Final Approved Menu: [filename]

**Content**:
- Reviewed and approved message
- Final corrected document attached
- Professional formatting

## Service Architecture

### Services Involved

1. **Dashboard (`port 3005`)**
   - Web interface
   - Handles approvals
   - File downloads/uploads

2. **DB (`port 3004`)**
   - Stores submission data
   - Tracks status
   - Returns pending reviews

3. **Notifier (`port 3003`)**
   - Sends emails
   - Includes dashboard links
   - Sends final docs to chefs

4. **Differ (`port 3006`)**
   - Compares documents
   - Creates training data
   - Tracks AI performance

## URLs & Access

### Local Development
- **Dashboard**: http://localhost:3005
- **Review Link**: http://localhost:3005/review/[submission-id]

### Production (Future)
- **Dashboard**: https://dashboard.yourdomain.com
- Configure in `.env`: `DASHBOARD_URL=https://dashboard.yourdomain.com`

## Common Scenarios

### Scenario 1: Perfect AI Draft

```
1. Email arrives → "New Menu Submission for Review"
2. Click link → Opens review page
3. Download both documents
4. Compare → AI did everything correctly!
5. Click "Approve & Send to Chef"
6. ✅ Done! Chef receives email with AI draft
```

**Result**: `changes_detected: false` (AI is learning well!)

### Scenario 2: Minor Corrections Needed

```
1. Email arrives → "New Menu Submission for Review"
2. Click link → Opens review page
3. Download AI draft
4. Open in Word → Make 2-3 corrections
5. Save corrected file
6. Upload corrected file
7. Click "Upload & Send to Chef"
8. ✅ Done! Chef receives YOUR version
9. Differ service logs your changes
```

**Result**: `changes_detected: true, change_percentage: 3.5%`

### Scenario 3: Significant Corrections

```
1. Email arrives → "New Menu Submission for Review"
2. Click link → Opens review page
3. Download AI draft
4. Open in Word → Make many corrections
5. Save corrected file
6. Upload corrected file
7. Click "Upload & Send to Chef"
8. ✅ Done! Chef receives YOUR version
9. Differ service logs extensive changes
```

**Result**: `changes_detected: true, change_percentage: 25%`
(AI needs more training on this pattern)

## Dashboard Maintenance

### View Training Statistics

```bash
# Get differ service stats
curl http://localhost:3006/stats

Response:
{
  "total_comparisons": 45,
  "comparisons_with_changes": 12,
  "comparisons_without_changes": 33,
  "average_change_percentage": 4.2
}
```

### Access Training Data

```bash
# Get all training data
curl http://localhost:3006/training-data

# Data location
tmp/learning/training_data.jsonl
tmp/learning/[submission-id]-comparison.json
```

## Starting the Dashboard

### With All Services

```bash
./start-services.sh

# Dashboard will be available at:
# http://localhost:3005
```

### Dashboard Only (for testing)

```bash
cd services/dashboard
npm start

# Or from root:
npm start --workspace=@menumanager/dashboard
```

## Troubleshooting

### Dashboard won't load

**Check**:
1. Is service running? `./view-logs.sh dashboard`
2. Can you access: http://localhost:3005
3. Check port not in use: `lsof -ti:3005`

**Fix**:
```bash
./stop-services.sh
./start-services.sh
```

### No pending reviews showing

**Check**:
1. DB service running? `./view-logs.sh db`
2. Any submissions in `pending_human_review` status?
3. Test AI review completed successfully

**Debug**:
```bash
# Check DB contents
curl http://localhost:3004/submissions/pending
```

### Can't download files

**Check**:
1. Files exist in `tmp/` directories
2. Paths correct in database
3. Permissions on tmp/ folder

**Fix**:
```bash
# Ensure tmp directories exist
mkdir -p tmp/uploads tmp/ai-drafts tmp/finals
chmod -R 755 tmp/
```

### Upload not working

**Check**:
1. File is .docx format
2. File size reasonable (<10MB)
3. tmp/uploads directory writable

**Debug**: Check dashboard logs:
```bash
./view-logs.sh dashboard
```

## Best Practices

### For Reviewers

1. **Always download both documents**
   - Compare side-by-side
   - Understand what AI changed

2. **Be thorough but efficient**
   - Trust AI for simple corrections
   - Focus on complex/nuanced changes

3. **Track your time**
   - Over time, you should need less time per review
   - As AI improves, more quick approvals

4. **Provide quality corrections**
   - Your edits train the AI
   - Be consistent in your standards

### For Administrators

1. **Monitor training data**
   - Check differ stats regularly
   - Look for improvement trends

2. **Review patterns**
   - What kinds of changes are common?
   - Is AI getting better over time?

3. **Plan for fine-tuning**
   - Collect enough training data (100+ submissions)
   - Use data to fine-tune AI model

## Security Considerations

### Current Implementation
- Local deployment only
- No authentication (internal tool)
- File access via file system

### Production Recommendations
- Add authentication/login
- Use cloud storage for files
- HTTPS for all connections
- Role-based access control
- Audit logging

## Next Steps

Once dashboard is working:

1. **Test the full workflow**
   - Send test email
   - Review in dashboard
   - Approve
   - Verify chef receives email

2. **Train team**
   - Show reviewers the dashboard
   - Explain two approval paths
   - Emphasize AI learning aspect

3. **Monitor performance**
   - Track review times
   - Check approval rates
   - Review training data

4. **Plan improvements**
   - Add more sophisticated diff analysis
   - Build reporting dashboard
   - Implement AI fine-tuning

## Summary

✅ **Dashboard provides**:
- Easy review interface
- Two approval paths
- AI learning capability
- Email integration

✅ **Key features**:
- Download original & AI draft
- Quick approve or upload corrections
- Automatic differ analysis
- Email notifications with links

✅ **Benefits**:
- Quality control maintained
- AI continuously improves
- Efficient workflow
- Clear audit trail

The dashboard is the bridge between AI automation and human expertise, ensuring high-quality results while continuously improving the system!


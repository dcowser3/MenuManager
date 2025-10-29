# 🧪 Testing Guide - MenuManager

This guide will help you test and demonstrate the MenuManager system **without** connecting to live email yet.

## 🎯 Purpose

Test the complete menu review workflow locally to:
- ✅ Validate all components work correctly
- ✅ Demonstrate to stakeholders before going live
- ✅ Ensure AI review accuracy
- ✅ Test the human review dashboard
- ✅ Verify the learning feedback loop

---

## 📋 Prerequisites

### 1. Install Dependencies
```bash
npm install --workspaces
npm run build --workspaces
```

### 2. Configure Environment Variables
Edit `.env` file and set at minimum:
```bash
# Required for testing
OPENAI_API_KEY=your-openai-api-key-here

# Optional for testing (use defaults)
DB_SERVICE_URL=http://localhost:3004
PARSER_SERVICE_URL=http://localhost:3001
AI_REVIEW_SERVICE_URL=http://localhost:3002
NOTIFIER_SERVICE_URL=http://localhost:3003
DASHBOARD_URL=http://localhost:3005
```

**Note:** Azure credentials are NOT needed for local testing.

---

## 🚀 Quick Start - Automated Test

### Run the Complete Test Suite

```bash
# 1. Start all services
./start-services.sh

# 2. Run automated workflow test
./test-workflow.sh
```

This will:
1. ✅ Verify all services are running
2. ✅ Submit test menu documents (food & beverage)
3. ✅ Validate template detection
4. ✅ Simulate AI review process
5. ✅ Create mock review drafts
6. ✅ Open the dashboard for human review
7. ✅ Display test summary and demo talking points

---

## 🔬 Manual Testing - Step by Step

### Test 1: Parser & Template Validation

Test that the parser correctly validates menu templates.

```bash
# Test Food Menu Template
curl -X POST http://localhost:3001/parser \
  -F "file=@samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx" \
  -F "submitter_email=chef@test-restaurant.com"

# Test Beverage Menu Template
curl -X POST http://localhost:3001/parser \
  -F "file=@samples/RSH Design Brief Beverage Template.docx" \
  -F "submitter_email=bartender@test-restaurant.com"
```

**Expected Result:** JSON response with `submission_id` and validation details.

---

### Test 2: AI Review Process

Test the two-tier AI review system.

```bash
# Trigger AI review for a submission
curl -X POST http://localhost:3002/review \
  -H "Content-Type: application/json" \
  -d '{
    "submission_id": "YOUR_SUBMISSION_ID",
    "original_path": "/path/to/original.docx",
    "submitter_email": "chef@test-restaurant.com"
  }'
```

**Expected Result:**
- Tier 1: General QA report
- Tier 2: Red-lined draft document
- Notification sent to internal reviewer

---

### Test 3: Dashboard Human Review

1. **Open Dashboard:**
   ```bash
   open http://localhost:3005
   ```

2. **View Pending Reviews:**
   - Should see all submissions with status `pending_human_review`
   - Each shows filename, submitter, submission date

3. **Review Individual Submission:**
   - Click "Review Now →" button
   - Download original document
   - Download AI-generated draft (with red-lined corrections)

4. **Test Approval Flow:**
   - **Option A:** Click "Approve & Send to Chef" (AI draft is perfect)
   - **Option B:** Upload corrected version (you made additional changes)

---

### Test 4: Differ Service (AI Learning)

When you upload a corrected version, the system learns from your changes.

```bash
# Check learning statistics
curl http://localhost:3006/stats
```

**Expected Result:** Approval rate, common correction types, AI improvement metrics.

---

## 🎬 Demo Script for Stakeholders

### Setup (Before Meeting)
```bash
# 1. Start services
./start-services.sh

# 2. Create test data
./test-workflow.sh

# 3. Keep dashboard open
open http://localhost:3005
```

### Demo Flow

#### **Act 1: The Problem** (2 mins)
> "Currently, reviewing menu submissions is manual and time-consuming. Each menu needs to be checked against our SOP guidelines, which takes 30-45 minutes per submission. We process ~20 menus per month."

#### **Act 2: The Solution** (5 mins)

**Show Template Validation:**
```bash
# Live demo: Submit a menu
curl -X POST http://localhost:3001/validate \
  -F "document=@samples/example_pairs/RSH-Food-Template-v3.1.docx" \
  -F "submitter_email=demo-chef@restaurant.com" \
  -F "messageId=demo-$(date +%s)"
```
> "The system automatically validates that the document matches our approved RSH templates. Works for both food and beverage menus."

**Show AI Review Dashboard:**
- Navigate to http://localhost:3005
- Show the pending reviews list
- Click into a review
- Download and show the AI draft with corrections

> "The AI performs a two-tier review:
> - **Tier 1:** General QA - formatting, completeness, basic compliance
> - **Tier 2:** Red-lined draft - specific corrections based on SOP rules"

**Show Human Review:**
- Demonstrate the two options: Approve or Upload Corrected
- Explain the learning feedback loop

> "Human reviewers have final say. If they make additional corrections, the system learns and improves."

#### **Act 3: The Benefits** (2 mins)

**Time Savings:**
- AI review: 2-3 minutes
- Human verification: 5-10 minutes
- **Total: 85% time reduction**

**Consistency:**
- Every menu reviewed against same SOP rules
- No human oversight/fatigue

**Learning System:**
- Gets smarter with each human correction
- Accuracy improves over time

**Email Integration:**
- Once Azure permissions granted, fully automated
- Chefs email menu → System processes → Reviewer notified → Approval → Chef receives corrections

#### **Act 4: Next Steps** (1 min)

> "What we need to go live:
> 1. ✅ System built and tested (DONE)
> 2. ⏳ Azure admin permissions (IN PROGRESS)
> 3. ⏳ OpenAI API key approval (IN PROGRESS)
> 4. 📅 1-week pilot with 2-3 reviewers
> 5. 📅 Full rollout
>
> Estimated timeline: 2 weeks from Azure approval"

---

## 🧪 Test Scenarios

### Scenario 1: Valid Food Menu
- **Input:** Complete food menu with all required sections
- **Expected:** Pass validation, AI suggests minor formatting fixes
- **Test with:** `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`

### Scenario 2: Valid Beverage Menu
- **Input:** Complete beverage menu with categories
- **Expected:** Pass validation, AI checks pricing consistency
- **Test with:** `samples/RSH Design Brief Beverage Template.docx`

### Scenario 3: Invalid Template
- **Input:** Random Word document (not RSH template)
- **Expected:** Validation fails, submission rejected
- **Test with:** Any non-template .docx file

### Scenario 4: Human Correction
- **Input:** AI draft + human corrections
- **Expected:** Differ service captures changes, updates learning model
- **Test via:** Dashboard → Upload corrected version

### Scenario 5: Multiple Reviewers
- **Input:** Multiple pending submissions
- **Expected:** Dashboard shows all pending, each reviewable independently
- **Test via:** Run `./test-workflow.sh` multiple times

---

## 📊 Key Metrics to Show

During testing, collect these metrics for your demo:

```bash
# Total submissions processed
curl -s http://localhost:3004/submissions | jq '. | length'

# Pending reviews
curl -s http://localhost:3004/submissions/pending | jq '. | length'

# AI accuracy (from differ service)
curl -s http://localhost:3006/stats | jq '.approvalRate'

# Average review time
# (Manual tracking during testing)
```

---

## 🐛 Troubleshooting

### Services Not Starting
```bash
# Check what's using the ports
lsof -i :3000,3001,3002,3003,3004,3005,3006

# Kill all node processes and restart
pkill -f "node"
./start-services.sh
```

### OpenAI API Errors
- Ensure `OPENAI_API_KEY` is set in `.env`
- Check API quota: https://platform.openai.com/usage
- For demo without OpenAI: Use mock AI responses (see `test-workflow.sh`)

### Template Not Recognized
- Ensure `.docx` files are in the correct format
- Check parser logs: `./view-logs.sh parser`
- Verify templates contain key phrases (see `BEVERAGE-SUPPORT.md`)

### Dashboard Not Loading
- Check browser console for errors
- Verify `dist/views/` folder contains `.ejs` files
- Rebuild dashboard: `cd services/dashboard && npm run build`

---

## 🎓 Understanding the Test Results

### ✅ Successful Test Shows:

1. **Parser validates templates correctly** → Template detection working
2. **Submissions stored in database** → Data persistence working  
3. **AI generates meaningful corrections** → OpenAI integration working
4. **Dashboard displays pending reviews** → UI working
5. **Approve/upload actions complete** → Workflow end-to-end working

### 🔄 Feedback Loop Verification:

```bash
# After uploading a corrected version, check differ service
curl http://localhost:3006/stats

# Should show:
# - Total comparisons performed
# - Approval rate (AI draft accepted as-is)
# - Common correction types
# - Learning improvements over time
```

---

## 📞 Support During Demo

**If something breaks during the demo:**
1. Stay calm - shows you're testing rigorously
2. Check service logs: `./view-logs.sh <service-name>`
3. Restart services: `./start-services.sh`
4. Use prepared screenshots as backup

**Have ready:**
- Pre-recorded video of working system
- Screenshots of successful workflow
- Sample AI-generated drafts (exported beforehand)

---

## 🚀 After Successful Testing

Once all tests pass:

1. **Document results:**
   ```bash
   # Export test data
   curl http://localhost:3004/submissions > test-results.json
   ```

2. **Create stakeholder presentation:**
   - Use screenshots from dashboard
   - Include AI draft samples
   - Show before/after metrics

3. **Request Azure permissions:**
   - Show test results to IT
   - Explain email integration needs
   - Provide security documentation

4. **Plan pilot program:**
   - Select 2-3 initial reviewers
   - Choose low-risk menus for first week
   - Set success criteria

---

## 📚 Additional Resources

- **Setup Guide:** `SETUP.md` (Azure configuration)
- **Workflow Details:** `WORKFLOW-GUIDE.md`
- **Safety Features:** `SAFETY-SOLUTION.md`
- **Template Support:** `BEVERAGE-SUPPORT.md`
- **Dashboard Guide:** `DASHBOARD-GUIDE.md`

---

## ✅ Testing Checklist

Before going live, verify:

- [ ] All services start without errors
- [ ] Food menu templates validated correctly
- [ ] Beverage menu templates validated correctly
- [ ] Invalid templates rejected appropriately
- [ ] AI review generates meaningful corrections
- [ ] Dashboard displays all pending reviews
- [ ] Approval flow works end-to-end
- [ ] Upload corrected version works
- [ ] Differ service captures learning data
- [ ] Services restart automatically after errors
- [ ] Logs are clear and actionable
- [ ] Performance is acceptable (<5 sec per operation)

---

**Questions or issues during testing?**
Check service logs: `./view-logs.sh <service-name>`


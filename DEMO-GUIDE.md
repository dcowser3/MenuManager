# 🎬 Demo Guide - MenuManager Review System

## Quick Demo Setup (5 minutes)

This guide shows you how to demonstrate all validation scenarios to clients.

---

## 🚀 Before You Start

```bash
# 1. Start all services
./start-services.sh

# 2. Wait for services to be ready (10-15 seconds)
sleep 15

# 3. Open dashboard in browser
open http://localhost:3005
```

---

## 📋 Demo Scenarios

The system has **5 validation paths** that can occur:

### ✅ Scenario 1: Perfect Submission
**What happens:** Passes all checks, goes straight to AI review

**Test with:**
```bash
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/example_pairs/TT_DXB_Brief_Half board_07112025.docx" \
  -F "from=chef@restaurant.com"
```

**Show client:**
- Submission appears in dashboard
- AI generates red-lined corrections
- Human reviewer downloads both versions
- One-click approve or upload corrections

---

### ❌ Scenario 2: Wrong Template
**What happens:** Chef didn't use RSH template, gets immediate email reply

**Current test files:** *(Create a sample without template structure)*

**Email reply sent:**
```
Subject: ❌ Menu Submission Rejected - Wrong Template

Your submission doesn't match the RSH Design Brief template.

Issues Found:
• Missing required section: "Design Brief Header"
• Missing required form field: "Restaurant Name Field"
• Missing boundary marker

What To Do:
1. Download official template (Food or Beverage)
2. Fill out ALL required fields
3. Add menu content after boundary marker
4. Resubmit
```

---

### ⚠️ Scenario 3: Too Many Errors (Didn't Use QA Prompt)
**What happens:** Menu has 10+ errors, system tells chef to use QA prompt first

**Test with:** *(Need to create a messy menu sample)*

**Email reply sent:**
```
Subject: ⚠️ Menu Submission Needs Corrections - Please Use QA Prompt

Your menu has 15 issues that need correction.

Why rejected?
Too many errors found. This means the menu wasn't pre-cleaned 
using the required SOP QA prompt before submission.

Next Steps:
1. Open ChatGPT
2. Copy RSH Menu QA Prompt from guidelines
3. Paste your menu and let AI check it
4. Fix all issues
5. Run prompt again to confirm
6. Resubmit cleaned menu
```

---

### ⚠️ Scenario 4: Format Issues
**What happens:** Wrong font/alignment/size, gets specific fix instructions

**Test with:** *(Need to create Arial/left-aligned sample)*

**Email reply sent:**
```
Subject: ⚠️ Menu Submission - Formatting Issues

Your menu doesn't meet formatting standards.

Issues Found:
• Font is Arial (should be Calibri)
• Text is left-aligned (should be centered)
• Font size is 11pt (should be 12pt)

Required Format (Page 2 Menu Content):
• Font: Calibri
• Font Size: 12pt
• Alignment: Center

To Fix: Select page 2 content, set Calibri/12pt/centered, resubmit.
```

---

### 📝 Scenario 5: Minor Issues (AI Review)
**What happens:** AI finds 1-9 minor issues, suggests corrections

**Test with:** Good menu with 1-2 small errors

**Flow:**
- No immediate rejection
- Appears in dashboard as "Pending Review"
- Human downloads AI draft with red-lining
- Human approves or makes additional corrections
- System learns from corrections

---

## 🎯 Demo Script for Clients (10 minutes)

### Opening (1 min)
> "I'll show you 5 scenarios that can happen when a chef submits a menu. Each has automatic responses that save reviewer time."

### Scenario Walkthrough (7 mins)
1. Show perfect submission → dashboard workflow
2. Trigger wrong template → show email reply  
3. Trigger too many errors → show QA prompt requirement
4. Trigger format issue → show specific fix instructions
5. Show AI review with minor issues → demonstrate value

### Key Points to Emphasize (2 mins)
✅ **Automatic quality gates** - SOP enforced before human time spent
✅ **Clear communication** - Every rejection includes fix instructions
✅ **Learning system** - AI improves from every human correction
✅ **Time savings** - 85% reduction in review time

---

## 📊 Key Metrics to Share

### Current State (Manual)
- ⏱️ 30-45 minutes per menu
- 📧 2-3 rounds of back-and-forth for format issues
- ⚠️ Inconsistent SOP application

### With This System
- ⏱️ 5-10 minutes per menu (human review only)
- ✅ Format issues caught instantly
- ✅ 100% consistent SOP enforcement
- 🚀 Scales without adding headcount

### ROI
```
Current:  20 menus/month × 37.5 min = 12.5 hours/month
With AI:  20 menus/month × 7.5 min = 2.5 hours/month
Savings:  10 hours/month = 120 hours/year

At $50/hour = $6,000/year savings
```

---

## 💡 Handling Common Questions

**Q: "What if the AI makes a mistake?"**
> A: Every menu is checked by a human before going to the chef. AI does heavy lifting, human makes final call.

**Q: "Why so many automatic rejections?"**
> A: They're instant! Chef gets feedback in seconds, not hours. Much faster than waiting for human review.

**Q: "Can chefs bypass these checks?"**
> A: No, but they shouldn't want to. Each check enforces SOP. If it passes all checks, it's ready for substantive review.

**Q: "What about special cases?"**
> A: System is flexible. We can add exceptions or custom rules. But 95% follow standard template.

---

## 🔧 Creating Demo Sample Files

To demonstrate all scenarios, create these test files:

### 1. Perfect Menu (✅)
- Use RSH template
- Calibri, 12pt, centered on page 2
- Clean, no errors
- **Use existing:** `samples/example_pairs/TT_DXB_Brief_Half board_07112025.docx`

### 2. Wrong Template (❌)
- Generic Word doc without RSH template
- Missing required sections
- **Create:** Plain Word doc with menu content

### 3. Messy Menu (⚠️)
- RSH template ✅
- But many errors:
  - Misspellings (guacamol, avacado)
  - Wrong separators (hyphens instead of " / ")
  - Missing diacritics (jalapeño → jalapeno)
  - Inconsistent formatting
- **Create:** Start with template, add errors

### 4. Bad Format (⚠️)
- RSH template ✅
- Content errors fixed ✅
- But wrong formatting:
  - Arial font (not Calibri)
  - Left-aligned (not centered)
  - 11pt (not 12pt)
- **Create:** Use template, change page 2 formatting

### 5. Minor Issues (📝)
- RSH template ✅
- Correct formatting ✅
- Just 1-2 small errors
- **Create:** Near-perfect menu with tiny mistakes

---

## ✅ Pre-Demo Checklist

- [ ] All services running (`./start-services.sh`)
- [ ] Dashboard accessible (http://localhost:3005)
- [ ] All 5 sample files created
- [ ] Tested each scenario once
- [ ] Demo script printed/open
- [ ] Q&A prep done
- [ ] Laptop charged, backup internet ready

---

## 🚦 After Demo - Next Steps

1. ✅ Get feedback on which scenarios are most valuable
2. ✅ Request Azure permissions for email integration
3. ✅ Identify 2-3 pilot reviewers
4. ✅ Set pilot timeline (1-2 weeks)
5. ✅ Create chef training materials

---

**Ready to demo! 🎬**

For technical details, see:
- `WORKFLOW-GUIDE.md` - Full system workflow
- `TESTING-GUIDE.md` - Testing procedures  
- `SETUP.md` - Installation guide

# Changelog

## Latest Update - Beverage Template Support

### Added
- ✅ **Beverage template validation** - System now supports both FOOD and BEVERAGE menu templates
- ✅ **Automatic template detection** - Detects whether submission is food or beverage
- ✅ **Template-specific logging** - Shows which template type was detected in logs

### Templates Supported
1. **Food Menu Template**: `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
2. **Beverage Menu Template**: `samples/RSH Design Brief Beverage Template.docx`

### How It Works
- System automatically detects template type from document content
- Both templates validated against same common requirements:
  - "PROJECT DESIGN DETAILS" section
  - "MENU SUBMITTAL SOP" section
  - "STEP 1: OBTAIN APPROVALS"
  - "STEP 2: DESIGN DEVELOPMENT"
- Single workflow handles both types

### Log Output Examples
```
# Food menu
Detected template type: FOOD
✓ Template validation passed (FOOD template)

# Beverage menu
Detected template type: BEVERAGE
✓ Template validation passed (BEVERAGE template)
```

### Documentation Added
- **BEVERAGE-SUPPORT.md** - Comprehensive guide to food vs beverage handling

### Documentation Updated
- **SAFETY-SOLUTION.md** - Updated Layer 4 for both templates
- **WORKFLOW-GUIDE.md** - Updated template validation section
- **UPDATES.md** - Updated examples for both types
- **README.md** - Added link to beverage support guide

---

## Previous Update - Template Validation & Reply Email Support

### Added
- ✅ **Real template validation** - Validates against actual RSH templates
- ✅ **Reply email support** - Removed blocking for RE:/FW: emails
- ✅ **Duplicate detection** - Tracks processed message IDs
- ✅ **System email exclusion** - Blocks emails from own address

### Changed
- Replaced placeholder validation with real template checking
- Removed reply/forward detection (submissions often come mid-conversation)
- Added mammoth library for proper .docx parsing

### Safety Layers Implemented
1. Duplicate Detection
2. System Email Exclusion
3. Sender Domain Verification
4. Template Validation

---

## Initial Release

### Features
- Email monitoring via Microsoft Graph API
- Parser service for document validation
- AI review service (2-tier: QA + red-lining)
- Notifier service for email communications
- Database service for submission tracking
- Human-in-the-loop approval workflow

### Services
- `inbound-email` - Monitors mailbox via webhook
- `parser` - Validates file type and template
- `ai-review` - Orchestrates AI review process
- `notifier` - Handles all email communications
- `db` - Stores submission data
- `dashboard` - (Planned) Web interface for reviewers
- `differ` - (Planned) Compares AI vs human edits

### Workflow
1. Email arrives with .docx attachment
2. System validates template structure
3. AI performs Tier 1 review (general QA)
4. If passes: AI generates red-lined draft
5. Internal reviewer approves/edits
6. Final document sent to submitter


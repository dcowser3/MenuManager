# Meeting Prep: Menu Manager Project Expansion

## Summary of What We Know

### Three Workflow Scenarios (from document)

| Scenario | Nickname | Description | Upload Type |
|----------|----------|-------------|-------------|
| 1 | "Carlos" | Menu compliance + routing | PDF + Word |
| 2 | "Nancy" | Full graphic design (incomplete data problem) | PDF + Word |
| 3 | "Mandi" | Brand standards review of designed menus | PDF only (designed) — **Design Approval tool now built** |

### Form Sections Outlined
1. **Job Type** - Radio select (determines routing + SLA)
2. **Project Metadata** - Outlet, hotel, city, asset type (print/digital), dimensions
3. **Approval Attestation** - Hard gate requiring sign-off from GM, F&B Director, Chef, etc.
4. **File Upload** - PDF + Word with validation

### Routing Logic
- **Internal RSH scope** → Auto-create ClickUp task, assign to internal design team
- **Non-managed scope** → Return validated files to submitter via email
- File storage in Microsoft Teams (per-outlet, per-project folders)

---

## Loose Implementation Plan

### Phase 1: Data Model & User Management
1. Define user roles and entitlements database
2. Build organization hierarchy (Company → Region → Outlet → Users)
3. Create reviewer routing rules (which outlets → which reviewers)
4. Implement backup/failover logic for reviewer unavailability

### Phase 2: Authentication & Access Control
1. Internal users (RSH staff) - Microsoft SSO or Clerk auth
2. External users (hotel staff) - Magic link / tokenized URLs (no login required)
3. Role-based dashboard rendering

### Phase 3: Submission Form Enhancements
1. Dynamic form based on Job Type selection
2. Outlet dropdown (sourced from authoritative database)
3. Conditional fields for Print vs Digital
4. Approval attestation gate (hard requirement)
5. File upload validation

### Phase 4: Workflow Engine
1. Submission → Validation → Routing logic
2. SLA calculation (5 days new, 2 days update)
3. Reviewer assignment based on routing rules
4. Email notifications at each step
5. Failover handling (bounced emails → backup reviewer)

### Phase 5: Integrations
1. ClickUp task creation for internal scope
2. Microsoft Teams file storage (or alternative)
3. Email delivery with bounce detection

---

## Questions for the Meeting

### User & Access Management

1. **Who are all the user types?**
   - RSH internal staff (reviewers, admins, design team)
   - Hotel GMs / F&B Directors (submitters)
   - External design agencies?
   - Anyone else?

2. **For external hotel staff (non-RSH accounts):**
   - Should they have accounts at all, or just tokenized submission links?
   - Do they need to view submission status/history?
   - How do we verify they're authorized to submit for a given outlet?

3. **For internal RSH reviewers:**
   - How many reviewers are there?
   - Do they specialize (e.g., only food menus, only beverage, only certain regions)?
   - Can a single submission require multiple reviewers in sequence?

4. **Regional manager structure:**
   - How many regions exist?
   - How many outlets per region (typical range)?
   - Do regional managers review everything, or only escalations?

### Routing & Assignment

5. **How are reviewers currently assigned to outlets?**
   - Is there a master list we can import?
   - How often does this mapping change?
   - Who should have permission to edit reviewer assignments?

6. **What happens when a reviewer is unavailable?**
   - Vacation coverage?
   - Termination scenario - who is the fallback?
   - Should there always be a primary + backup reviewer per outlet?

7. **What determines "managed" vs "non-managed" scope?**
   - Is this per-outlet or per-submission?
   - Can an outlet switch from managed to non-managed?

### Form & Submission Details

8. **Outlet list:**
   - Where is the authoritative outlet list maintained today?
   - How often do outlets get added/removed?
   - What fields do we need per outlet? (Name, city, country, region, managed/non-managed, primary reviewer, backup reviewer?)

9. **Approval attestation:** ✅ DECIDED
   - Simple self-attestation system implemented
   - One required approval (name + position), optional second approver
   - No database of managers needed - submitters self-report
   - Hint text suggests appropriate roles based on menu type:
     - Food: Property GM, Director of F&B, Executive Chef, Chef de Cuisine
     - Beverage: Head of Mixology, Bar Director, Regional Director of Operations

10. **SLA logic:**
    - Is the 5-day / 2-day SLA firm, or does it vary by outlet or job type?
    - What happens when SLA is breached? (Notification? Escalation?)
    - Who can override the SLA deadline?

11. **File requirements:**
    - Is the Word doc actually necessary, or can we move to text-only input?
    - For designed menus (Scenario 3), do we need to extract text from the PDF?
    - What formats are acceptable? (PDF only, or also JPEG/PNG for digital menus?)

12. **Menu content validation:** ✅ PARTIALLY IMPLEMENTED
    - Critical error blocking now prevents submission when dishes are missing prices or have incomplete dish names
    - AI flags these as `severity: "critical"` suggestions; submit button is disabled until resolved or overridden
    - Prix fixe menus are exempt from individual dish price requirements
    - Future: extend to allergen codes and other required attributes

13. **Design Approval (DOCX vs PDF comparison):** ✅ IMPLEMENTED
    - Stateless validation tool — chef uploads approved Word doc + designer PDF, system compares them
    - Extracts project details from DOCX template table (project name, property, size, orientation, date needed)
    - Extracts menu text from DOCX (after boundary marker) and PDF (via PyMuPDF text layer)
    - Comparison algorithm: LCS line alignment, then word-by-word diffing within matched lines
    - Classifies differences by type: price, allergen, diacritical, spelling, missing, extra
    - Severity levels: critical (prices, allergens, missing items), warning (spelling, diacriticals), info (formatting)
    - Pass/fail gate: green banner if match, red banner with detailed diff view if mismatch
    - No database storage — ephemeral results, chef fixes and resubmits until clean
    - Access: `/submit/:token` welcome page → "Design Approval" card → `/design-approval`

### Integrations

13. **ClickUp:**
    - Which workspace/list should tasks be created in?
    - What fields should be populated on the task?
    - Who gets assigned by default?
    - Should task status sync back to our system?

14. **Microsoft Teams file storage:**
    - Is this required, or is an alternative acceptable (e.g., Supabase storage, SharePoint)?
    - Who needs access to these files?
    - Retention policy?

15. **Email notifications:**
    - What email addresses send these? (designapproval@richardsandoval.com or new domain?)
    - What branding/templates are needed?
    - Do we need to detect bounced emails programmatically?

### Edge Cases & Error Handling

16. **Duplicate submissions:**
    - How do we handle someone submitting the same menu twice?
    - Version control for menu iterations?

17. **Rejected submissions:**
    - What happens when a reviewer rejects a menu?
    - Does it go back to submitter for corrections?
    - How many rounds of revision are allowed?

18. **Audit trail:**
    - What needs to be logged? (All actions? Just approvals?)
    - How long must records be retained?
    - Who needs access to audit logs?

### Data Migration & Launch

19. **Historical data:**
    - Do we need to migrate existing submissions from the email inbox?
    - What about existing approved menus?

20. **Rollout plan:**
    - Pilot with one region first?
    - Training materials needed?
    - Cutover date / timeline expectations?

---

## Key Decisions Needed

| Decision | Options | Status |
|----------|---------|--------|
| External user auth | Magic links vs. accounts | Pending |
| Word doc requirement | Keep vs. eliminate | Pending |
| File storage | Teams vs. Supabase/S3 | Pending |
| Reviewer failover | Backup person vs. admin escalation | Pending |
| Outlet data source | Manual entry vs. import from existing system | Pending |
| Approval verification | Database lookup vs. self-attestation | **DECIDED: Self-attestation** |
| Design approval (Scenario 3) | Manual review vs. automated comparison | **BUILT: DOCX vs PDF comparison tool** |

---

## Data Model Sketch (Needs Validation)

```
organizations
  - id, name (e.g., "Richard Sandoval Hospitality")

regions
  - id, organization_id, name (e.g., "West Coast", "LATAM")

outlets
  - id, region_id, name, city, country
  - is_managed (boolean)
  - primary_reviewer_id, backup_reviewer_id

users
  - id, email, name, role
  - organization_id (nullable for external)

user_roles: admin | reviewer | regional_manager | submitter

outlet_permissions
  - user_id, outlet_id, can_submit, can_review

submissions
  - id, outlet_id, submitter_id, job_type, status
  - assigned_reviewer_id, sla_deadline
  - created_at, updated_at

submission_files
  - id, submission_id, file_type (pdf/word), storage_url

approval_attestations (stored as JSON on submission)
  - approved (boolean), name, position
  - Optional second approver with same fields
```

---

## Next Steps After Meeting

1. Finalize user roles and access model
2. Get outlet list (or confirm where to source it)
3. Get reviewer assignments (or confirm who maintains this)
4. Confirm file storage approach
5. Confirm Word doc requirement (keep or eliminate)
6. Start building database schema

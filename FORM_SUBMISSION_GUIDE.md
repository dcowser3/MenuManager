# Form Submission Feature Guide

## Overview

The form submission feature provides an alternative to email-based menu submissions. Instead of requiring chefs to download a template, fill it out, and email it, they can now use a web form to submit menus directly.

## Benefits

1. **No Template Validation Needed** - The form ensures the correct template structure automatically
2. **Immediate Feedback** - Basic AI check runs before submission
3. **Better UX** - Visual interface with example formatting
4. **Streamlined Workflow** - Goes directly into the review dashboard

## How It Works

### User Flow

1. **Access the Form**
   - Navigate to `http://localhost:3005/form`
   - Or click "Submit New Menu" from the dashboard homepage

2. **Fill in Project Details**
   - Project Name
   - Property
   - Size (e.g., "8.5 x 11 inches")
   - Orientation (Portrait/Landscape)
   - Date Needed
   - Your Email

3. **Enter Menu Content**
   - Left panel shows example formatting
   - Right panel is where you paste your menu
   - Content will be automatically centered
   - Use the example as a guide for structure

4. **Run Basic AI Check**
   - Click "Run Basic AI Check"
   - System runs QA validation on your menu content
   - Shows suggestions for improvements
   - **Note**: Unlike email submissions, the form shows ALL corrections regardless of count

5. **Submit for Review**
   - Click "Submit Menu for Review"
   - System generates Word document from your form data
   - Triggers AI redlining process
   - Redirects to review page

### Backend Process

When you submit the form:

1. **Document Generation** (`generate_from_form.py`)
   - Takes the template: `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
   - Populates page 1 with form fields
   - Adds menu content to page 2 (after boundary marker)
   - Saves to `/tmp/uploads/{submissionId}.docx`

2. **Database Entry**
   - Creates submission record
   - Marks source as 'form' (vs 'email')
   - Sets status to 'processing'

3. **AI Review Workflow** (Same as email submissions)
   - Extracts text from generated document
   - Runs AI review (Tier 1 QA check)
   - Generates AI draft in `/tmp/ai-drafts/`
   - Generates redlined version in `/tmp/redlined/`
   - Sets status to 'pending_human_review'

4. **Dashboard Review**
   - Appears in dashboard like any other submission
   - Reviewers can download original, AI draft, and redlined versions
   - Standard approval workflow applies

## API Endpoints

### GET `/form`
Renders the form submission page.

**Response**: HTML form interface

---

### POST `/api/form/basic-check`
Runs QA check on menu content before submission.

**Request Body**:
```json
{
  "menuContent": "For the table\nMakimono & Dips\n..."
}
```

**Response**:
```json
{
  "success": true,
  "menuContent": "...",
  "feedback": "AI feedback text...",
  "suggestions": [
    {
      "type": "Diacritics",
      "description": "Missing accent in jalapeño"
    }
  ]
}
```

---

### POST `/api/form/submit`
Submits the complete menu for review.

**Request Body**:
```json
{
  "projectName": "Holiday Menu 2024",
  "property": "Toro Boston",
  "size": "8.5 x 11 inches",
  "orientation": "Portrait",
  "dateNeeded": "2024-12-31",
  "submitterEmail": "chef@example.com",
  "menuContent": "For the table\nMakimono & Dips\n..."
}
```

**Response**:
```json
{
  "success": true,
  "submissionId": "form-1734057600000",
  "message": "Menu submitted successfully"
}
```

## Technical Implementation

### Frontend (`services/dashboard/views/form.ejs`)
- Split-view layout (example | input)
- Real-time validation
- AJAX form submission
- Auto-redirect to review page

### Backend (`services/dashboard/index.ts`)
- `/form` route - Renders form
- `/api/form/basic-check` - Calls AI review service
- `/api/form/submit` - Generates docx and triggers workflow

### Document Generation (`services/docx-redliner/generate_from_form.py`)
- Loads template using python-docx
- Populates form table cells
- Finds boundary marker
- Adds menu content as centered paragraphs
- Preserves template formatting

## Differences from Email Workflow

| Aspect | Email Workflow | Form Workflow |
|--------|---------------|---------------|
| Template | User downloads | Auto-generated |
| Validation | Parser checks template | Guaranteed correct |
| Error Threshold | Rejects if >5 issues | Shows all corrections |
| Entry Point | Port 3000 (email service) | Port 3005 (dashboard) |
| User Experience | Multi-step (download, fill, email) | Single page form |

## File Locations

- **Form View**: `services/dashboard/views/form.ejs`
- **API Routes**: `services/dashboard/index.ts` (lines 47-885)
- **Document Generator**: `services/docx-redliner/generate_from_form.py`
- **Template**: `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
- **Generated Docs**: `/tmp/uploads/{submissionId}.docx`

## Testing

### Manual Test
1. Start all services:
   ```bash
   npm run start:all
   ```

2. Access form:
   ```
   http://localhost:3005/form
   ```

3. Fill in test data:
   - Project Name: "Test Menu"
   - Property: "Test Property"
   - Size: "8.5 x 11 inches"
   - Orientation: "Portrait"
   - Date Needed: Tomorrow's date
   - Email: Your email
   - Menu Content: Paste sample menu from image

4. Click "Run Basic AI Check"
   - Should show suggestions panel

5. Click "Submit Menu for Review"
   - Should redirect to `/review/{submissionId}`
   - Check that document appears in dashboard

### Automated Test
```bash
# Test document generation
python3 services/docx-redliner/generate_from_form.py \
  "samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx" \
  /tmp/test_form_data.json \
  /tmp/test_output.docx

# Verify output exists
ls -lh /tmp/test_output.docx
```

## Future Enhancements

- [ ] Add menu preview rendering
- [ ] Support beverage menu template
- [ ] Save draft functionality
- [ ] Multi-page menu support
- [ ] Image upload for logos
- [ ] Direct chef notification from form
- [ ] Form analytics and tracking

## Troubleshooting

### Document generation fails
- Check that template exists: `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
- Verify python-docx is installed: `pip list | grep python-docx`
- Check Python version: `python3 --version` (should be 3.7+)

### AI check doesn't work
- Verify AI Review service is running (Port 3002)
- Check OpenAI API key is configured in `.env`
- Check QA prompt exists: `sop-processor/qa_prompt.txt`

### Form doesn't load
- Verify dashboard service is running (Port 3005)
- Check that form view was built: `services/dashboard/views/form.ejs`
- Rebuild dashboard: `cd services/dashboard && npm run build`

### Submission doesn't appear in dashboard
- Check database service is running (Port 3004)
- Verify submission was created: `cat /tmp/db/submissions.json`
- Check logs for errors in console

## Support

For issues or questions, check:
1. Service logs for errors
2. Browser console for frontend errors
3. `/tmp/` directory for generated files
4. Database at `/tmp/db/submissions.json`

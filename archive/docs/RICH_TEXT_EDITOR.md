# Rich Text Editor Implementation

## Overview
The form now includes a Quill.js rich text editor that preserves formatting (bold, italic, underline) when users paste or type menu content.

## What Changed

### 1. Frontend (form.ejs)
- **Added Quill.js Library**: Integrated Quill.js CDN for rich text editing
- **Replaced Textarea**: Changed plain textarea to a Quill editor container
- **Toolbar Features**:
  - Bold, Italic, Underline
  - Text alignment
  - Ordered/Unordered lists
  - Clean formatting button

### 2. JavaScript Updates
- **Editor Initialization**: Quill editor initializes on page load
- **Content Extraction**:
  - `quill.getText()` - Plain text for AI validation
  - `quill.root.innerHTML` - HTML content for formatting preservation
- **Form Submission**: Sends both text and HTML versions to backend

### 3. Backend Processing (generate_from_form.py)
- **HTML Parser**: Added `MenuHTMLParser` class to parse Quill's HTML output
- **Formatting Detection**: Identifies bold, italic, and underline tags
- **Word Document Generation**: Applies formatting to Word document runs
  - Bold text appears as bold in final .docx
  - Italic and underline also preserved
  - Font: Calibri 12pt, centered alignment maintained

## How It Works

### User Experience
1. User pastes formatted text (e.g., from Word document)
2. Formatting is preserved in the editor
3. User can add/modify formatting using toolbar
4. Bold text shows immediately in the editor
5. Submitted menu preserves all formatting in final Word document

### Technical Flow
```
Quill Editor (HTML)
    ↓
JavaScript extracts HTML and plain text
    ↓
Backend receives both formats
    ↓
Python HTML parser converts to structured data
    ↓
Word document generated with formatting
```

### Example
**Input HTML from Quill:**
```html
<p><strong>Smoked swordfish</strong>, smoked mesquite, pickled chili</p>
```

**Output in Word:**
- "Smoked swordfish" appears in bold
- Remaining text appears in normal weight
- All text centered, Calibri 12pt

## Testing the Feature

1. Start services: `./start-services.sh`
2. Navigate to: http://localhost:3005/form
3. Paste text with bold formatting
4. Verify bold text appears bold in the editor
5. Submit form and check generated Word document

## Files Modified
- `services/dashboard/views/form.ejs` - Added Quill editor
- `services/docx-redliner/generate_from_form.py` - HTML parsing and Word formatting
- `services/dashboard/index.ts` - Handles `menuContentHtml` field

## Benefits
- Users can paste from Word documents without losing formatting
- Essential information (dish names) can be bolded for emphasis
- Professional-looking menu output
- WYSIWYG editing experience

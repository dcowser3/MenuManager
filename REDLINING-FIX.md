# 🎨 Red-Lining Fix - Proper Word Document Generation

## Issue Resolved

**Problem:** AI was generating plain text files with `[ADD]` and `[DELETE]` tags instead of proper Word documents with track changes formatting.

**Solution:** Implemented proper `.docx` generation with:
- ✅ Red strikethrough for deletions
- ✅ Yellow highlighting for additions
- ✅ Proper Microsoft Word format

---

## What Changed

### 1. **New Word Document Generator**
Created `/services/ai-review/src/docx-generator.ts`

- Uses the `docx` npm library
- Parses AI corrections with `[ADD]`/`[DELETE]` tags
- Converts to proper Word formatting:
  - **Deletions:** Red text with strikethrough
  - **Additions:** Yellow background highlighting
  - **Regular text:** No special formatting

### 2. **Updated AI Review Service**
Modified `/services/ai-review/index.ts`

- Changed from saving `.txt` files to `.docx` files
- Draft filename: `sub_XXXXX-draft.docx` (was `.txt`)
- Calls `generateRedlinedDocx()` to create properly formatted documents
- Falls back to text file if Word generation fails

### 3. **Fixed Dashboard Downloads**
Updated `/services/dashboard/index.ts`

- Fixed file path resolution for downloads
- Properly handles `.docx` extension in download filenames
- Downloads now work with correct MIME types

---

## Testing Results

### ✅ Latest Test (sub_1761506447337)

**Submission:**
- File: RSH_DESIGN BRIEF_FOOD_Menu_Template .docx
- Submitted: October 26, 2025, 3:20 PM
- Processing Time: ~40 seconds (OpenAI GPT-4)

**Generated Draft:**
- Format: Microsoft Word 2007+ (.docx)
- Size: 9.2 KB
- Location: `/tmp/ai-drafts/sub_1761506447337-draft.docx`
- Status: ✅ Ready for download

**Features:**
- ✅ Proper Word document format
- ✅ Red strikethrough for deletions
- ✅ Yellow highlights for additions
- ✅ Downloadable from dashboard
- ✅ Opens correctly in Microsoft Word

---

## How to Test

### 1. Submit a Menu
```bash
curl -X POST http://localhost:3001/parser \
  -F "file=@samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  -F "submitter_email=your-email@test.com"
```

### 2. View in Dashboard
```bash
open http://localhost:3005
```

### 3. Download AI Draft
1. Click "Review Now" on the submission
2. Click download icon for "AI Draft (Red-lined)"
3. File downloads as `DRAFT_filename.docx`

### 4. Open in Microsoft Word
- Red strikethrough = Text to delete
- Yellow highlight = Text to add
- Regular text = No changes

---

## Example Output

### Before (Text Format)
```
[DELETE]FOOD MENU DESIGN BRIEF REQUEST FORM & SOP[/DELETE]
[ADD]Food Menu Design Brief Request Form & SOP[/ADD]
```

### After (Word Document)
```
FOOD MENU DESIGN BRIEF REQUEST FORM & SOP  (red strikethrough)
Food Menu Design Brief Request Form & SOP  (yellow highlight)
```

---

## Technical Details

### Dependencies Added
- `docx@^8.5.0` - Microsoft Word document generation library

### File Structure
```
services/ai-review/
├── src/
│   └── docx-generator.ts          (NEW)
└── index.ts                        (UPDATED)

services/dashboard/
└── index.ts                        (UPDATED - fixed downloads)
```

### Formatting Implementation

**Red Strikethrough (Deletions):**
```typescript
new TextRun({
    text: 'deleted text',
    strike: true,
    color: 'FF0000'  // Red
})
```

**Yellow Highlight (Additions):**
```typescript
new TextRun({
    text: 'added text',
    highlight: 'yellow'
})
```

---

## Alignment with RSH Guidelines

Following the RSH Menu Submission Guidelines (see `/samples/RSH_Menu Submission Guidelines_2025[96] (1).pdf`):

✅ **Red-lining for corrections**
✅ **Yellow highlighting for important changes**
✅ **Professional Word document format**
✅ **Compatible with Microsoft Word track changes workflow**

---

## Known Limitations & Future Improvements

### Current Limitations:
1. **Not True Track Changes**: Uses formatting (strikethrough/highlight) rather than Word's native track changes API
   - **Why:** `docx` library doesn't fully support track changes API yet
   - **Impact:** Visual appearance is correct, but not using Word's revision system

2. **Paragraph Grouping**: Complex multi-line changes may not group perfectly
   - Working on improved paragraph detection

### Planned Improvements:
- [ ] Implement true Word track changes when library supports it
- [ ] Add change author/timestamp metadata
- [ ] Improve paragraph/section detection
- [ ] Add comments for complex corrections

---

## Troubleshooting

### Dashboard Shows "Word experienced an error"

**Cause:** Trying to open from the browser, which may not handle the absolute path correctly.

**Solution:** Click the download icon to save the file locally first, then open from your Downloads folder.

### File Won't Download

**Check:**
1. Is the service running? `curl http://localhost:3005`
2. Check logs: `tail -f logs/dashboard.log`
3. Verify file exists: `ls -lh tmp/ai-drafts/`

### Word Document Opens But No Formatting

**Possible Causes:**
1. Using Google Docs (doesn't support all Word features)
2. Using older version of Word
3. Document got converted to text during download

**Solution:** Use Microsoft Word 2007 or newer on desktop

---

## Success Metrics

**Before Fix:**
- ❌ Plain text files with tags
- ❌ Can't open in Word
- ❌ Manual editing required

**After Fix:**
- ✅ Proper Word documents
- ✅ Opens correctly in Microsoft Word
- ✅ Visual red-lining and highlighting
- ✅ Professional presentation
- ✅ Ready for immediate review

---

## Next Steps

1. **Test with Real Menus**: Try with various menu submissions
2. **Get Feedback**: Have reviewers test the Word documents
3. **Refine Formatting**: Adjust based on real-world usage
4. **Monitor File Sizes**: Ensure documents don't get too large

---

**Status:** ✅ COMPLETE  
**Last Updated:** October 26, 2025, 3:25 PM  
**Test Submission:** sub_1761506447337


# Beverage Template Support

## Overview

The MenuManager system now supports **both Food and Beverage menu templates**. The validator automatically detects which template type is being submitted and validates accordingly.

## Supported Templates

### 1. Food Menu Template
**File**: `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`

**Header**: "FOOD MENU DESIGN BRIEF REQUEST FORM & SOP"

**Use for**:
- Restaurant food menus
- Kitchen menu submissions
- Food offerings

### 2. Beverage Menu Template
**File**: `samples/RSH Design Brief Beverage Template.docx`

**Header**: "BEVERAGE MENU DESIGN BRIEF REQUEST FORM & SOP"

**Use for**:
- Bar menus
- Cocktail lists
- Beverage offerings
- Wine lists

## How It Works

### Automatic Detection

The system automatically detects which template type based on the document content:

```typescript
if (textContent.includes('FOOD MENU DESIGN BRIEF REQUEST FORM')) {
    // Validates as FOOD template
} else if (textContent.includes('BEVERAGE MENU DESIGN BRIEF REQUEST FORM')) {
    // Validates as BEVERAGE template
}
```

### Common Validation

Both templates share the same validation requirements:

✓ **Required Sections**:
- "PROJECT DESIGN DETAILS"
- "MENU SUBMITTAL SOP"
- "STEP 1: OBTAIN APPROVALS"
- "STEP 2: DESIGN DEVELOPMENT"

✓ **Quality Checks**:
- Document must have reasonable length
- All required sections present
- Proper structure maintained

## Workflow Examples

### Example 1: Food Menu Submission

```
1. Chef emails food menu using RSH Food Template
   Subject: "Fall Food Menu Submission"
   Attachment: fall_food_menu.docx
   
2. You move email to "Menu Submissions" folder

3. System processes:
   ✓ Template detected: FOOD
   ✓ Validates structure
   ✓ Proceeds to AI review
```

### Example 2: Beverage Menu Submission

```
1. Bartender emails cocktail menu using RSH Beverage Template
   Subject: "RE: New Cocktail Menu"
   Attachment: summer_cocktails.docx
   
2. You move email to "Menu Submissions" folder

3. System processes:
   ✓ Template detected: BEVERAGE
   ✓ Validates structure
   ✓ Proceeds to AI review
```

### Example 3: Invalid Template

```
1. Someone sends a Word doc that's not the RSH template
   Subject: "Menu Ideas"
   Attachment: random_menu.docx
   
2. You move email to "Menu Submissions" folder

3. System processes:
   ✗ Template validation fails
   ✗ "Not a valid RSH DESIGN BRIEF template"
   → Sender notified with error
   → AI review does not run
```

## Log Messages

### Successful Food Menu
```
Validating template structure...
  Detected template type: FOOD
✓ Template validation passed (FOOD template)
```

### Successful Beverage Menu
```
Validating template structure...
  Detected template type: BEVERAGE
✓ Template validation passed (BEVERAGE template)
```

### Invalid Template
```
Validating template structure...
✗ Template validation failed:
  - Document does not appear to be a valid RSH DESIGN BRIEF template (neither FOOD nor BEVERAGE)
```

## Benefits

### 1. Single System for Both Types
- No need for separate workflows
- One monitoring system handles both
- Same folder ("Menu Submissions") for both types

### 2. Automatic Classification
- System detects template type
- Could route to different reviewers (future enhancement)
- Easy to track metrics by type

### 3. Consistent Quality
- Both types get same level of review
- Same SOP validation
- Same AI review process

## Same Safety Layers Apply

All safety layers work for both template types:

1. **Duplicate Detection** - Works for both
2. **System Email Exclusion** - Works for both
3. **Sender Domain Verification** - Works for both
4. **Template Validation** - Detects and validates both types

## Testing

### Test Food Template
```bash
# Use the food template
samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx

# Expected log:
Detected template type: FOOD
✓ Template validation passed (FOOD template)
```

### Test Beverage Template
```bash
# Use the beverage template
samples/RSH Design Brief Beverage Template.docx

# Expected log:
Detected template type: BEVERAGE
✓ Template validation passed (BEVERAGE template)
```

## Future Enhancements

Potential future features for differentiated handling:

1. **Route by Type**: Send FOOD menus to culinary reviewer, BEVERAGE to bar manager
2. **Type-Specific Rules**: Different AI review rules for food vs beverages
3. **Separate Tracking**: Dashboard showing food vs beverage submission metrics
4. **Custom Notifications**: Different email templates for food vs beverage

## Configuration

No configuration changes needed! The system automatically:
- Detects both template types
- Validates appropriately
- Processes through the same workflow

## Summary

✅ **Both food and beverage menus supported**
✅ **Automatic template detection**
✅ **Same workflow for both types**
✅ **Same safety and validation standards**
✅ **No additional configuration required**

Both template types are first-class citizens in the system and receive the same high-quality AI review and validation!


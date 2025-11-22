import mammoth from 'mammoth';
import { promises as fs } from 'fs';

interface ValidationResult {
    isValid: boolean;
    errors: string[];
    text: string;
}

/**
 * Validates that a document follows the RSH DESIGN BRIEF templates
 * Supported templates:
 *  - Food: samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx
 *  - Beverage: samples/RSH Design Brief Beverage Template.docx
 * 
 * This is a COMPREHENSIVE check that verifies:
 * 1. Correct template type (Food or Beverage)
 * 2. All required sections and form fields are present
 * 3. The boundary marker exists (where menu content should be dropped)
 * 4. Document structure matches the official template
 */
export async function validateTemplate(filePath: string): Promise<ValidationResult> {
    const errors: string[] = [];
    let textContent = '';

    try {
        // Use mammoth to extract text from the .docx file
        const buffer = await fs.readFile(filePath);
        const result = await mammoth.extractRawText({ buffer });
        textContent = result.value;

        console.log('Validating template structure...');

        // Detect template type (FOOD or BEVERAGE)
        const isFoodTemplate = textContent.includes('FOOD MENU DESIGN BRIEF REQUEST FORM');
        const isBeverageTemplate = textContent.includes('BEVERAGE MENU DESIGN BRIEF REQUEST FORM');

        if (!isFoodTemplate && !isBeverageTemplate) {
            errors.push('Document does not appear to be a valid RSH DESIGN BRIEF template (neither FOOD nor BEVERAGE)');
            errors.push('Please download and use the official template from the Menu Submission Guidelines');
        } else {
            const templateType = isFoodTemplate ? 'FOOD' : 'BEVERAGE';
            console.log(`  Detected template type: ${templateType}`);

            // COMPREHENSIVE TEMPLATE VALIDATION
            // These are the ACTUAL required sections from the official template
            
            // 1. Header section
            const headerElements = [
                { text: 'DESIGN BRIEF REQUEST FORM', name: 'Design Brief Header' },
                { text: 'PROJECT DESIGN DETAILS', name: 'Project Design Details Section' }
            ];

            // 2. Form fields that MUST be present
            const requiredFormFields = [
                { text: 'RESTAURANT NAME', name: 'Restaurant Name Field' },
                { text: 'LOCATION', name: 'Location Field' },
                { text: 'MENU NAME', name: 'Menu Name Field' },
                { text: 'MENU TYPE', name: 'Menu Type Field' },
                { text: 'EFFECTIVE DATE', name: 'Effective Date Field' },
                { text: 'SUBMITTED BY', name: 'Submitted By Field' },
                { text: 'SUBMISSION DATE', name: 'Submission Date Field' }
            ];

            // 3. SOP section (the instructions)
            const sopElements = [
                { text: 'MENU SUBMITTAL SOP', name: 'Menu Submittal SOP Section' },
                { text: 'STEP 1: OBTAIN APPROVALS', name: 'Step 1 Section' },
                { text: 'STEP 2: DESIGN DEVELOPMENT', name: 'Step 2 Section' }
            ];

            // 4. The critical boundary marker
            const boundaryMarker = 'Please drop the menu content below on page 2';

            // Check all header elements
            for (const element of headerElements) {
                if (!textContent.includes(element.text)) {
                    errors.push(`Missing required section: "${element.name}"`);
                }
            }

            // Check all required form fields
            for (const field of requiredFormFields) {
                if (!textContent.includes(field.text)) {
                    errors.push(`Missing required form field: "${field.name}"`);
                }
            }

            // Check SOP elements
            for (const element of sopElements) {
                if (!textContent.includes(element.text)) {
                    errors.push(`Missing required section: "${element.name}"`);
                }
            }

            // Check for boundary marker (critical for knowing where menu content starts)
            if (!textContent.includes(boundaryMarker)) {
                errors.push('Missing boundary marker: "Please drop the menu content below on page 2"');
                errors.push('This marker is required to separate the template form from the menu content');
            }

            // Check if document has reasonable length (not empty)
            if (textContent.trim().length < 500) {
                errors.push('Document appears to be incomplete or missing major sections');
            }

            // Additional validation: Check for menu content after boundary
            if (textContent.includes(boundaryMarker)) {
                const boundaryIndex = textContent.indexOf(boundaryMarker);
                const contentAfterBoundary = textContent.substring(boundaryIndex + boundaryMarker.length).trim();
                
                if (contentAfterBoundary.length < 50) {
                    errors.push('No menu content found after the boundary marker');
                    errors.push('Please add your menu items below "Please drop the menu content below on page 2"');
                }
            }
        }

        // Log validation results
        if (errors.length === 0) {
            const templateType = isFoodTemplate ? 'FOOD' : isBeverageTemplate ? 'BEVERAGE' : 'UNKNOWN';
            console.log(`✓ Template validation passed (${templateType} template)`);
        } else {
            console.log('✗ Template validation failed:');
            errors.forEach(err => console.log(`  - ${err}`));
        }

    } catch (error: any) {
        console.error('Error during template validation:', error);
        errors.push(`Failed to read or parse the document: ${error.message}`);
    }

    return {
        isValid: errors.length === 0,
        errors,
        text: textContent
    };
}

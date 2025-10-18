"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTemplate = validateTemplate;
const mammoth_1 = __importDefault(require("mammoth"));
const fs_1 = require("fs");
/**
 * Validates that a document follows the RSH DESIGN BRIEF templates
 * Supported templates:
 *  - Food: samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx
 *  - Beverage: samples/RSH Design Brief Beverage Template.docx
 */
async function validateTemplate(filePath) {
    const errors = [];
    let textContent = '';
    try {
        // Use mammoth to extract text from the .docx file
        const buffer = await fs_1.promises.readFile(filePath);
        const result = await mammoth_1.default.extractRawText({ buffer });
        textContent = result.value;
        console.log('Validating template structure...');
        // Detect template type (FOOD or BEVERAGE)
        const isFoodTemplate = textContent.includes('FOOD MENU DESIGN BRIEF REQUEST FORM');
        const isBeverageTemplate = textContent.includes('BEVERAGE MENU DESIGN BRIEF REQUEST FORM');
        if (!isFoodTemplate && !isBeverageTemplate) {
            errors.push('Document does not appear to be a valid RSH DESIGN BRIEF template (neither FOOD nor BEVERAGE)');
        }
        else {
            const templateType = isFoodTemplate ? 'FOOD' : 'BEVERAGE';
            console.log(`  Detected template type: ${templateType}`);
            // Common required elements for both templates
            const commonElements = [
                {
                    text: 'PROJECT DESIGN DETAILS',
                    name: 'Project Design Details Section'
                },
                {
                    text: 'MENU SUBMITTAL SOP',
                    name: 'Menu Submittal SOP Section'
                }
            ];
            // Check for common elements
            for (const element of commonElements) {
                if (!textContent.includes(element.text)) {
                    errors.push(`Missing required element: "${element.name}"`);
                }
            }
            // Check for expected SOP steps
            const expectedSteps = ['STEP 1: OBTAIN APPROVALS', 'STEP 2: DESIGN DEVELOPMENT'];
            for (const step of expectedSteps) {
                if (!textContent.includes(step)) {
                    errors.push(`Missing expected step: "${step}"`);
                }
            }
            // Check if document has reasonable length (not empty)
            if (textContent.trim().length < 100) {
                errors.push('Document appears to be empty or too short');
            }
        }
        // Log validation results
        if (errors.length === 0) {
            const templateType = isFoodTemplate ? 'FOOD' : isBeverageTemplate ? 'BEVERAGE' : 'UNKNOWN';
            console.log(`✓ Template validation passed (${templateType} template)`);
        }
        else {
            console.log('✗ Template validation failed:');
            errors.forEach(err => console.log(`  - ${err}`));
        }
    }
    catch (error) {
        console.error('Error during template validation:', error);
        errors.push(`Failed to read or parse the document: ${error.message}`);
    }
    return {
        isValid: errors.length === 0,
        errors,
        text: textContent
    };
}

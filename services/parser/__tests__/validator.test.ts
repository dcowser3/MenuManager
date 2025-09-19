import { validateTemplate } from '../src/validator';
import * as fs from 'fs';
import * as path from 'path';

describe('Parser Service - Template Validator', () => {

    const TEST_DOCS_DIR = path.join(__dirname, 'test-docs');
    
    beforeAll(() => {
        if (!fs.existsSync(TEST_DOCS_DIR)) {
            fs.mkdirSync(TEST_DOCS_DIR);
        }
    });

    it('should return isValid=false for a document missing required headings', async () => {
        const invalidDocPath = path.join(TEST_DOCS_DIR, 'invalid.txt');
        fs.writeFileSync(invalidDocPath, 'This is a test document without the required headings.');
        
        const result = await validateTemplate(invalidDocPath);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing heading: "PROJECT DESIGN DETAILS"');
        
        fs.unlinkSync(invalidDocPath);
    });

    it('should return isValid=true for a document with required headings', async () => {
        const validDocPath = path.join(TEST_DOCS_DIR, 'valid.txt');
        const content = `
            PROJECT DESIGN DETAILS
            ...
            MENU SUBMITTAL SOP
            ...
        `;
        fs.writeFileSync(validDocPath, content);

        const result = await validateTemplate(validDocPath);

        expect(result.isValid).toBe(true);
        expect(result.errors.length).toBe(0);

        fs.unlinkSync(validDocPath);
    });
});

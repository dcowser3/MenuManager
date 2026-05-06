jest.mock('mammoth', () => ({
    __esModule: true,
    default: {
        extractRawText: jest.fn(),
    },
}));

import { validateTemplate } from '../src/validator';
import * as fs from 'fs';
import * as path from 'path';
import mammoth from 'mammoth';

const mockedMammoth = mammoth as jest.Mocked<typeof mammoth>;

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

        mockedMammoth.extractRawText.mockResolvedValue({
            value: 'This is a test document without the required headings.',
            messages: [],
        } as any);
        
        const result = await validateTemplate(invalidDocPath);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Document does not appear to be a valid RSH DESIGN BRIEF template (neither FOOD nor BEVERAGE)');
        
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

        mockedMammoth.extractRawText.mockResolvedValue({
            value: `
                FOOD MENU DESIGN BRIEF REQUEST FORM
                PROJECT DESIGN DETAILS
                PROJECT NAME
                PROPERTY
                SIZE
                ORIENTATION
                DATE NEEDED
                MENU SUBMITTAL SOP
                STEP 1: OBTAIN APPROVALS
                STEP 2: DESIGN DEVELOPMENT
                Please drop the menu content below on page 2

                STARTERS
                Guacamole - avocado / lime / cilantro 12
                Tuna Tartare - avocado / ponzu / sesame 21
                Short Rib - salsa verde / crispy shallots 36
                Dessert - chocolate / sea salt / cream 14
            `,
            messages: [],
        } as any);

        const result = await validateTemplate(validDocPath);

        expect(result.isValid).toBe(true);
        expect(result.errors.length).toBe(0);

        fs.unlinkSync(validDocPath);
    });
});

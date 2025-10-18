"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const validator_1 = require("../src/validator");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
        const result = await (0, validator_1.validateTemplate)(invalidDocPath);
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
        const result = await (0, validator_1.validateTemplate)(validDocPath);
        expect(result.isValid).toBe(true);
        expect(result.errors.length).toBe(0);
        fs.unlinkSync(validDocPath);
    });
});

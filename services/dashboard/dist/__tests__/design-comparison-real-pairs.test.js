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
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const design_comparison_1 = require("../lib/design-comparison");
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const venvPython = path.join(repoRoot, 'services', 'docx-redliner', 'venv', 'bin', 'python');
const python = fs.existsSync(venvPython) ? venvPython : 'python3';
const pythonReady = (0, child_process_1.spawnSync)(python, ['-c', 'import docx, pymupdf'], { encoding: 'utf8' }).status === 0;
// The curated client menu pairs are deliberately not committed to the (public)
// repository, so this suite runs only where those files exist locally.
const pairsReady = fs.existsSync(path.join(repoRoot, 'samples', 'Design Approval Pairs', 'curated-2026-08-29'));
const integrationDescribe = pythonReady && pairsReady ? describe : describe.skip;
function extract(script, file) {
    const stdout = (0, child_process_1.execFileSync)(python, [path.join(repoRoot, 'services', 'docx-redliner', script), path.join(repoRoot, file)], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
}
const pairs = [
    {
        name: 'tán brunch',
        docx: 'samples/Design Approval Pairs/curated-2026-08-29/tan-brunch/tán_Brunch_8.19.26.docx',
        pdf: 'samples/Design Approval Pairs/curated-2026-08-29/tan-brunch/Tan_Brunch Menu_8.24.26.pdf',
        maxActionable: 15,
        expected: (differences) => {
            const blocking = differences.filter((difference) => difference.severity === 'critical');
            expect(blocking).toHaveLength(3);
            expect(blocking).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: 'required_addition_missing',
                    docxValue: expect.stringContaining('Maduros'),
                }),
                expect.objectContaining({
                    type: 'removal_failed',
                    docxValue: expect.stringContaining('Yucatan Kibis'),
                }),
                expect.objectContaining({
                    type: 'removal_failed',
                    docxValue: 'cherry',
                }),
            ]));
            expect(blocking.some((difference) => /Kale Salad/.test(difference.docxValue || ''))).toBe(false);
            expect(blocking.some((difference) => difference.type === 'allergen')).toBe(false);
        },
    },
    {
        name: 'Tamayo happy hour',
        docx: 'samples/Design Approval Pairs/curated-2026-08-29/tamayo-happy-hour/Tamayo_Happy Hour_8.27.26.docx',
        pdf: 'samples/Design Approval Pairs/curated-2026-08-29/tamayo-happy-hour/Tamayo_Happy Hour Menu_8.27.25.pdf',
        maxActionable: 18,
        expected: (differences) => {
            expect(differences.some((difference) => difference.type === 'price')).toBe(false);
            expect(differences.some((difference) => /PUREEPURÉE|SEERRANOSERRANO|AVAOCADOAVOCADO/.test(difference.docxValue || ''))).toBe(false);
        },
    },
    {
        name: 'Aqimero Día de los Muertos dinner',
        docx: 'samples/Design Approval Pairs/curated-2026-08-29/aqimero-ddlm-dinner/Aqimero_Holidays Events_8.19.26 - cleaned.docx',
        pdf: 'samples/Design Approval Pairs/curated-2026-08-29/aqimero-ddlm-dinner/Aqimero_8.5x11_DDLM26 Chef Dinner Menu.pdf',
        maxActionable: 17,
        expected: (differences) => {
            expect(differences).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'missing', severity: 'critical', docxValue: '$85 pp' }),
                expect.objectContaining({ type: 'spelling', docxValue: 'PUMKIN', pdfValue: 'PUMPKIN' }),
                expect.objectContaining({ type: 'allergen', severity: 'critical', pdfValue: 'N' }),
            ]));
            expect(differences.some((difference) => difference.type === 'price' && /2026/.test(difference.docxValue || ''))).toBe(false);
        },
    },
];
integrationDescribe('design approval real-pair regression', () => {
    test.each(pairs)('$name stays within the reviewed actionable envelope', ({ docx, pdf, maxActionable, expected }) => {
        const docxData = extract('extract_project_details.py', docx);
        const pdfData = extract('extract_pdf_text.py', pdf);
        const differences = (0, design_comparison_1.compareMenuTexts)(typeof docxData.comparison_menu_content === 'string'
            ? docxData.comparison_menu_content
            : docxData.menu_content, pdfData.full_text, {
            removedContent: docxData.removed_content || [],
            requiredContent: docxData.required_content || [],
        })
            .differences
            .filter((difference) => difference.severity !== 'info');
        expect(differences.length).toBeLessThanOrEqual(maxActionable);
        expected(differences);
    }, 30000);
});

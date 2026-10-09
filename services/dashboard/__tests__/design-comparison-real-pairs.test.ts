import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { compareMenuTexts } from '../lib/design-comparison';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const venvPython = path.join(repoRoot, 'services', 'docx-redliner', 'venv', 'bin', 'python');
const python = fs.existsSync(venvPython) ? venvPython : 'python3';
const pythonReady = spawnSync(python, ['-c', 'import docx, pymupdf'], { encoding: 'utf8' }).status === 0;
// The curated client menu pairs are deliberately not committed to the (public)
// repository, so this suite runs only where those files exist locally.
const pairsReady = fs.existsSync(path.join(repoRoot, 'samples', 'Design Approval Pairs', 'curated-2026-08-29'));
const integrationDescribe = pythonReady && pairsReady ? describe : describe.skip;

type PairExpectation = {
    name: string;
    docx: string;
    pdf: string;
    maxActionable: number;
    expected: (differences: any[]) => void;
};

function extract(script: string, file: string): any {
    const stdout = execFileSync(
        python,
        [path.join(repoRoot, 'services', 'docx-redliner', script), path.join(repoRoot, file)],
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
}

const pairs: PairExpectation[] = [
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
        const differences = compareMenuTexts(
            typeof docxData.comparison_menu_content === 'string'
                ? docxData.comparison_menu_content
                : docxData.menu_content,
            pdfData.full_text,
            {
                removedContent: docxData.removed_content || [],
                requiredContent: docxData.required_content || [],
            },
        )
            .differences
            .filter((difference) => difference.severity !== 'info');

        expect(differences.length).toBeLessThanOrEqual(maxActionable);
        expected(differences);
    }, 30_000);
});

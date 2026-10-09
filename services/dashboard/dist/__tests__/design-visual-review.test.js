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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const design_visual_review_1 = require("../lib/design-visual-review");
const brandedProductPolicy = {
    key: 'branded_product_depiction',
    label: 'Branded product illustration',
    instruction: 'Do not depict third-party branded products or packaging.',
    severity: 'critical',
};
describe('design visual review', () => {
    test('is opt-in locally with a key and fails closed by default in production', () => {
        expect((0, design_visual_review_1.isDesignVisualReviewEnabled)({ NODE_ENV: 'development' })).toBe(false);
        expect((0, design_visual_review_1.isDesignVisualReviewEnabled)({ NODE_ENV: 'development', OPENAI_API_KEY: 'sk-test' })).toBe(true);
        expect((0, design_visual_review_1.isDesignVisualReviewEnabled)({ NODE_ENV: 'production' })).toBe(true);
        expect((0, design_visual_review_1.isDesignVisualReviewEnabled)({ NODE_ENV: 'production', DESIGN_VISUAL_REVIEW_ENABLED: 'false' })).toBe(false);
    });
    test('tells the model not to confuse a printed brand name with branded artwork', () => {
        const prompt = (0, design_visual_review_1.buildDesignVisualReviewPrompt)('Example Hospitality', [brandedProductPolicy], [2]);
        expect(prompt).toContain('Ordinary menu text that merely names a brand is not a visual depiction');
        expect(prompt).toContain('PDF pages 2');
        expect(prompt).toContain('branded_product_depiction');
    });
    test('keeps clear branded artwork critical and routes uncertainty to human review', () => {
        const findings = (0, design_visual_review_1.parseDesignVisualReviewResponse)(JSON.stringify({
            findings: [
                {
                    policyKey: 'branded_product_depiction',
                    pageNumber: 1,
                    evidence: 'Recognizable Modelo Especial bottle and label',
                    description: 'A branded beer bottle is illustrated beside the bottled beer list.',
                    confidence: 'high',
                },
                {
                    policyKey: 'branded_product_depiction',
                    pageNumber: 2,
                    evidence: 'Bottle with a possible branded label',
                    description: 'The label is too small to identify confidently.',
                    confidence: 'medium',
                },
            ],
        }), [brandedProductPolicy], [1, 2]);
        expect(findings).toEqual([
            expect.objectContaining({ pageNumber: 1, severity: 'critical', confidence: 'high' }),
            expect.objectContaining({ pageNumber: 2, severity: 'warning', confidence: 'medium' }),
        ]);
        expect((0, design_visual_review_1.designVisualReviewDifferences)({
            status: 'completed',
            pagesReviewed: 2,
            totalPages: 2,
            findings,
        })).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'visual_policy', severity: 'critical', pageNumber: 1 }),
            expect.objectContaining({ type: 'visual_policy', severity: 'warning', pageNumber: 2 }),
        ]));
    });
    test('turns an unavailable enabled review into a blocking operational finding', () => {
        expect((0, design_visual_review_1.designVisualReviewDifferences)({
            status: 'unavailable',
            pagesReviewed: 0,
            totalPages: 0,
            findings: [],
            message: 'Visual review unavailable.',
        })).toEqual([
            expect.objectContaining({
                type: 'visual_review_unavailable',
                severity: 'critical',
                description: 'Visual review unavailable.',
            }),
        ]);
    });
    test('renders pages, submits image inputs, and returns structured findings', async () => {
        const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'design-visual-test-'));
        const pdfPath = path.join(tempRoot, 'menu.pdf');
        const imagePath = path.join(tempRoot, 'page.png');
        await fs.promises.writeFile(pdfPath, '%PDF-test');
        await fs.promises.writeFile(imagePath, Buffer.from([1, 2, 3, 4]));
        const callChat = jest.fn(async () => ({
            content: JSON.stringify({
                findings: [{
                        policyKey: 'branded_product_depiction',
                        pageNumber: 1,
                        evidence: 'Recognizable branded bottle label',
                        description: 'A branded product is drawn on the menu.',
                        confidence: 'high',
                    }],
            }),
            model: 'gpt-5.6-terra',
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            system_fingerprint: null,
            finish_reason: 'stop',
            provider: 'openai',
        }));
        const runner = (0, design_visual_review_1.createDesignVisualReviewRunner)({
            fs: fs.promises,
            pathModule: path,
            getDocxRedlinerDir: () => tempRoot,
            execAsync: async () => ({
                stdout: JSON.stringify({
                    pages: [{ page_number: 1, path: imagePath }],
                    page_count: 1,
                    truncated: false,
                }),
                stderr: '',
            }),
            callChat: callChat,
            env: {
                NODE_ENV: 'test',
                OPENAI_API_KEY: 'sk-test',
                DESIGN_VISUAL_REVIEW_ENABLED: 'true',
                DESIGN_VISUAL_REVIEW_MODEL: 'gpt-5.6-terra',
            },
        });
        try {
            const result = await runner({
                pdfPath,
                tenantName: 'Example Hospitality',
                policies: [brandedProductPolicy],
            });
            expect(result).toMatchObject({
                status: 'completed',
                model: 'gpt-5.6-terra',
                pagesReviewed: 1,
                totalPages: 1,
            });
            expect(result.findings).toEqual([
                expect.objectContaining({ severity: 'critical', pageNumber: 1 }),
            ]);
            const messages = callChat.mock.calls[0][1];
            expect(messages[1].content).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'image_url' }),
            ]));
        }
        finally {
            await fs.promises.rm(tempRoot, { recursive: true, force: true });
        }
    });
});

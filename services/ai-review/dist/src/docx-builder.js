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
exports.buildRedlinedDocx = buildRedlinedDocx;
const docx_1 = require("docx");
const fs_1 = require("fs");
const Diff = __importStar(require("diff"));
/**
 * Build a Word document from scratch with template + corrected menu content
 * This is simpler and more reliable than trying to modify existing XML
 */
async function buildRedlinedDocx(originalText, correctedText, outputPath) {
    try {
        console.log('📝 Building red-lined Word document from scratch...');
        // Split original and corrected text by words
        const diffs = Diff.diffWords(originalText, correctedText);
        console.log(`🔍 Found ${diffs.length} diff segments`);
        // Build paragraphs with track changes
        const paragraphs = [];
        // Add title
        paragraphs.push(new docx_1.Paragraph({
            text: 'AI-Generated Menu Review',
            heading: docx_1.HeadingLevel.HEADING_1,
            alignment: docx_1.AlignmentType.CENTER,
            spacing: { after: 200 },
        }));
        paragraphs.push(new docx_1.Paragraph({
            children: [
                new docx_1.TextRun({
                    text: 'Red strikethrough = deletion | Yellow highlight = addition',
                    italics: true,
                }),
            ],
            alignment: docx_1.AlignmentType.CENTER,
            spacing: { after: 400 },
        }));
        // Build content with inline track changes
        let currentRuns = [];
        for (const diff of diffs) {
            if (!diff.value)
                continue;
            if (diff.removed) {
                // Red strikethrough for deletions
                currentRuns.push(new docx_1.TextRun({
                    text: diff.value,
                    strike: true,
                    color: 'FF0000',
                }));
            }
            else if (diff.added) {
                // Yellow highlight for additions
                currentRuns.push(new docx_1.TextRun({
                    text: diff.value,
                    highlight: 'yellow',
                }));
            }
            else {
                // Unchanged text
                currentRuns.push(new docx_1.TextRun({
                    text: diff.value,
                }));
            }
        }
        // Add all runs to a single paragraph
        paragraphs.push(new docx_1.Paragraph({
            children: currentRuns,
            spacing: { before: 200, after: 200 },
        }));
        // Create document
        const doc = new docx_1.Document({
            sections: [{
                    properties: {},
                    children: paragraphs,
                }],
        });
        // Save using Packer
        const buffer = await docx_1.Packer.toBuffer(doc);
        await fs_1.promises.writeFile(outputPath, buffer);
        console.log(`✅ Red-lined Word document created: ${outputPath}`);
    }
    catch (error) {
        console.error('❌ Error building red-lined document:', error);
        throw error;
    }
}

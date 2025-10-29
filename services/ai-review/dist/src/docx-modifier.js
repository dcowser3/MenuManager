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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modifyExistingDocx = modifyExistingDocx;
const fs_1 = require("fs");
const pizzip_1 = __importDefault(require("pizzip"));
const Diff = __importStar(require("diff"));
async function modifyExistingDocx(originalPath, aiCorrections, outputPath) {
    try {
        console.log('📄 Reading original document...');
        const content = await fs_1.promises.readFile(originalPath);
        // Load the docx as a zip
        const zip = new pizzip_1.default(content);
        // Extract the main document XML
        const documentXml = zip.file('word/document.xml')?.asText();
        if (!documentXml) {
            throw new Error('Could not find document.xml in the Word file');
        }
        // Find the template boundary marker
        const templateMarkerPhrase = 'Please drop the menu';
        const markerIndex = documentXml.indexOf(templateMarkerPhrase);
        if (markerIndex === -1) {
            console.warn('⚠️  Template marker not found - cannot apply changes safely');
            // Just copy the original file
            await fs_1.promises.copyFile(originalPath, outputPath);
            return;
        }
        console.log('✓ Found template boundary marker');
        // Find the end of the paragraph containing the marker
        const paragraphEndIndex = documentXml.indexOf('</w:p>', markerIndex);
        const boundaryIndex = paragraphEndIndex + '</w:p>'.length;
        // Extract the template section (unchanged) and content section
        const templateSection = documentXml.substring(0, boundaryIndex);
        const contentSection = documentXml.substring(boundaryIndex);
        // Extract original text from content section (strip XML tags)
        const originalText = extractTextFromXml(contentSection);
        console.log(`📝 Original menu text (${originalText.length} chars)`);
        // Parse AI corrections to get the corrected text
        const correctedText = parseAICorrectedText(aiCorrections);
        console.log(`✅ Corrected menu text (${correctedText.length} chars)`);
        // Use diff to find exact changes
        const diffs = Diff.diffWords(originalText, correctedText);
        console.log(`🔍 Found ${diffs.length} diff segments`);
        // Apply diffs to the content XML
        let modifiedContentXml = applyDiffsToXml(contentSection, diffs);
        // Combine template + modified content
        const modifiedXml = templateSection + modifiedContentXml;
        // Update the zip with modified content
        zip.file('word/document.xml', modifiedXml);
        // Generate and save the modified document
        const modifiedContent = zip.generate({
            type: 'nodebuffer',
            compression: 'DEFLATE'
        });
        await fs_1.promises.writeFile(outputPath, modifiedContent);
        console.log(`✅ Modified Word document saved to: ${outputPath}`);
    }
    catch (error) {
        console.error('❌ Error modifying Word document:', error);
        throw error;
    }
}
/**
 * Extract plain text from XML (remove all tags)
 */
function extractTextFromXml(xml) {
    // Extract text from <w:t> tags
    const textMatches = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    return textMatches.map(match => {
        const textMatch = match.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
        return textMatch ? textMatch[1] : '';
    }).join('');
}
/**
 * Parse AI corrections and return clean corrected text (without [DELETE]/[ADD] markers)
 */
function parseAICorrectedText(aiText) {
    // Remove [DELETE]...[/DELETE] or [DELETE]...[DELETE] content
    let cleaned = aiText.replace(/\[DELETE\].*?(?:\[\/DELETE\]|\[DELETE\])/gs, '');
    // Replace [ADD]...[/ADD] or [ADD]...[ADD] with just the content
    cleaned = cleaned.replace(/\[ADD\](.*?)(?:\[\/ADD\]|\[ADD\])/gs, '$1');
    return cleaned.trim();
}
/**
 * Apply diffs to XML while preserving structure
 */
function applyDiffsToXml(xml, diffs) {
    let result = xml;
    for (const diff of diffs) {
        if (!diff.value.trim())
            continue; // Skip whitespace-only changes
        if (diff.removed) {
            // Find this text in XML and mark it with red strikethrough
            result = markTextAsDeleted(result, diff.value);
        }
        else if (diff.added) {
            // Add this text with yellow highlight
            result = insertHighlightedText(result, diff.value);
        }
        // unchanged text stays as is
    }
    return result;
}
/**
 * Mark text as deleted (red strikethrough) in XML
 */
function markTextAsDeleted(xml, text) {
    const escapedText = escapeRegex(text.trim());
    const pattern = new RegExp(`(<w:t[^>]*>)([^<]*${escapedText}[^<]*)(</w:t>)`, 'i');
    return xml.replace(pattern, (match, openTag, content, closeTag) => {
        return `<w:r><w:rPr><w:strike/><w:color w:val="FF0000"/></w:rPr>${openTag}${content}${closeTag}</w:r>`;
    });
}
/**
 * Insert highlighted text (yellow) in XML
 */
function insertHighlightedText(xml, text) {
    // Find the first paragraph and insert the highlighted text there
    const firstParagraphEnd = xml.indexOf('</w:p>');
    if (firstParagraphEnd === -1)
        return xml;
    const highlightedRun = `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`;
    return xml.substring(0, firstParagraphEnd) + highlightedRun + xml.substring(firstParagraphEnd);
}
function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function escapeXmlText(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

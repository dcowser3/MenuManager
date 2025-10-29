import { promises as fs } from 'fs';
import PizZip from 'pizzip';
import * as Diff from 'diff';

/**
 * Modifies an existing Word document by applying red-lining and yellow highlights
 * while preserving ALL original formatting, structure, and template elements
 */

interface TextChange {
    original: string;
    replacement: string;
    type: 'delete' | 'add' | 'modify';
}

export async function modifyExistingDocx(
    originalPath: string,
    aiCorrections: string,
    outputPath: string
): Promise<void> {
    try {
        console.log('📄 Reading original document...');
        const content = await fs.readFile(originalPath);
        
        // Load the docx as a zip
        const zip = new PizZip(content);
        
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
            await fs.copyFile(originalPath, outputPath);
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
        
        await fs.writeFile(outputPath, modifiedContent);
        
        console.log(`✅ Modified Word document saved to: ${outputPath}`);
        
    } catch (error) {
        console.error('❌ Error modifying Word document:', error);
        throw error;
    }
}

/**
 * Extract plain text from XML (remove all tags)
 */
function extractTextFromXml(xml: string): string {
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
function parseAICorrectedText(aiText: string): string {
    // Remove [DELETE]...[/DELETE] or [DELETE]...[DELETE] content
    let cleaned = aiText.replace(/\[DELETE\].*?(?:\[\/DELETE\]|\[DELETE\])/gs, '');
    
    // Replace [ADD]...[/ADD] or [ADD]...[ADD] with just the content
    cleaned = cleaned.replace(/\[ADD\](.*?)(?:\[\/ADD\]|\[ADD\])/gs, '$1');
    
    return cleaned.trim();
}

/**
 * Apply diffs to XML while preserving structure
 */
function applyDiffsToXml(xml: string, diffs: Diff.Change[]): string {
    let result = xml;
    
    for (const diff of diffs) {
        if (!diff.value.trim()) continue; // Skip whitespace-only changes
        
        if (diff.removed) {
            // Find this text in XML and mark it with red strikethrough
            result = markTextAsDeleted(result, diff.value);
        } else if (diff.added) {
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
function markTextAsDeleted(xml: string, text: string): string {
    const escapedText = escapeRegex(text.trim());
    const pattern = new RegExp(`(<w:t[^>]*>)([^<]*${escapedText}[^<]*)(</w:t>)`, 'i');
    
    return xml.replace(pattern, (match, openTag, content, closeTag) => {
        return `<w:r><w:rPr><w:strike/><w:color w:val="FF0000"/></w:rPr>${openTag}${content}${closeTag}</w:r>`;
    });
}

/**
 * Insert highlighted text (yellow) in XML
 */
function insertHighlightedText(xml: string, text: string): string {
    // Find the first paragraph and insert the highlighted text there
    const firstParagraphEnd = xml.indexOf('</w:p>');
    if (firstParagraphEnd === -1) return xml;
    
    const highlightedRun = `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`;
    
    return xml.substring(0, firstParagraphEnd) + highlightedRun + xml.substring(firstParagraphEnd);
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXmlText(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

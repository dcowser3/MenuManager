import { Document, Paragraph, TextRun, AlignmentType, HeadingLevel, Packer } from 'docx';
import { promises as fs } from 'fs';
import * as Diff from 'diff';

/**
 * Build a Word document from scratch with template + corrected menu content
 * This is simpler and more reliable than trying to modify existing XML
 */

export async function buildRedlinedDocx(
    originalText: string,
    correctedText: string,
    outputPath: string
): Promise<void> {
    try {
        console.log('📝 Building red-lined Word document from scratch...');
        
        // Split original and corrected text by words
        const diffs = Diff.diffWords(originalText, correctedText);
        
        console.log(`🔍 Found ${diffs.length} diff segments`);
        
        // Build paragraphs with track changes
        const paragraphs: Paragraph[] = [];
        
        // Add title
        paragraphs.push(
            new Paragraph({
                text: 'AI-Generated Menu Review',
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
            })
        );
        
        paragraphs.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: 'Red strikethrough = deletion | Yellow highlight = addition',
                        italics: true,
                    }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
            })
        );
        
        // Build content with inline track changes
        let currentRuns: TextRun[] = [];
        
        for (const diff of diffs) {
            if (!diff.value) continue;
            
            if (diff.removed) {
                // Red strikethrough for deletions
                currentRuns.push(
                    new TextRun({
                        text: diff.value,
                        strike: true,
                        color: 'FF0000',
                    })
                );
            } else if (diff.added) {
                // Yellow highlight for additions
                currentRuns.push(
                    new TextRun({
                        text: diff.value,
                        highlight: 'yellow',
                    })
                );
            } else {
                // Unchanged text
                currentRuns.push(
                    new TextRun({
                        text: diff.value,
                    })
                );
            }
        }
        
        // Add all runs to a single paragraph
        paragraphs.push(
            new Paragraph({
                children: currentRuns,
                spacing: { before: 200, after: 200 },
            })
        );
        
        // Create document
        const doc = new Document({
            sections: [{
                properties: {},
                children: paragraphs,
            }],
        });
        
        // Save using Packer
        const buffer = await Packer.toBuffer(doc);
        await fs.writeFile(outputPath, buffer);
        
        console.log(`✅ Red-lined Word document created: ${outputPath}`);
        
    } catch (error) {
        console.error('❌ Error building red-lined document:', error);
        throw error;
    }
}


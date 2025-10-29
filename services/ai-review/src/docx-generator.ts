import { Document, Paragraph, TextRun, AlignmentType, Packer } from 'docx';
import { promises as fs } from 'fs';

/**
 * Generates a Word document with red-lined deletions and yellow-highlighted additions
 * following RSH menu submission guidelines
 */

interface Change {
    type: 'add' | 'delete' | 'text';
    content: string;
}

export async function generateRedlinedDocx(
    originalText: string,
    aiCorrections: string,
    outputPath: string
): Promise<void> {
    // Parse the AI corrections to extract changes
    const changes = parseAICorrections(aiCorrections);
    
    // Create paragraphs with proper formatting
    const paragraphs: Paragraph[] = [];
    
    // Add title
    paragraphs.push(
        new Paragraph({
            text: 'AI-REVIEWED MENU DRAFT',
            heading: 'Heading1',
            spacing: { after: 200 }
        })
    );
    
    paragraphs.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: 'Red strikethrough = deletion | Yellow highlight = addition',
                    italics: true
                })
            ],
            spacing: { after: 400 }
        })
    );
    
    // Group changes into paragraphs
    let currentParagraphRuns: TextRun[] = [];
    
    for (const change of changes) {
        if (change.content.includes('\n\n') || change.content.includes('---')) {
            // End current paragraph
            if (currentParagraphRuns.length > 0) {
                paragraphs.push(new Paragraph({ children: currentParagraphRuns }));
                currentParagraphRuns = [];
            }
            
            // Add spacing
            paragraphs.push(new Paragraph({ text: '' }));
            continue;
        }
        
        const lines = change.content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (!line.trim()) {
                // Empty line - end paragraph
                if (currentParagraphRuns.length > 0) {
                    paragraphs.push(new Paragraph({ children: currentParagraphRuns }));
                    currentParagraphRuns = [];
                }
                continue;
            }
            
            // Create text run based on change type
            if (change.type === 'delete') {
                currentParagraphRuns.push(
                    new TextRun({
                        text: line,
                        strike: true,
                        color: 'FF0000', // Red color
                    })
                );
            } else if (change.type === 'add') {
                currentParagraphRuns.push(
                    new TextRun({
                        text: line,
                        highlight: 'yellow',
                    })
                );
            } else {
                currentParagraphRuns.push(
                    new TextRun({
                        text: line,
                    })
                );
            }
            
            // Add space between lines within same paragraph
            if (i < lines.length - 1 && lines[i + 1].trim()) {
                currentParagraphRuns.push(new TextRun({ text: ' ' }));
            }
        }
    }
    
    // Add any remaining runs
    if (currentParagraphRuns.length > 0) {
        paragraphs.push(new Paragraph({ children: currentParagraphRuns }));
    }
    
    // Create the document
    const doc = new Document({
        sections: [{
            properties: {},
            children: paragraphs
        }]
    });
    
    // Write to file
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);
}

function parseAICorrections(aiText: string): Change[] {
    const changes: Change[] = [];
    const lines = aiText.split('\n');
    
    for (let line of lines) {
        line = line.trim();
        
        // Skip header lines
        if (line.startsWith('===') || 
            line.includes('AI-GENERATED REVIEW') ||
            line.includes('TIER 1') ||
            line.includes('TIER 2') ||
            line.includes('Mock Mode') ||
            line.startsWith('Here is')) {
            continue;
        }
        
        // Parse [ADD] tags
        const addRegex = /\[ADD\](.*?)\[\/ADD\]/g;
        const deleteRegex = /\[DELETE\](.*?)\[\/DELETE\]/g;
        
        let lastIndex = 0;
        let hasChanges = false;
        
        // Process deletions
        let match;
        const segments: { start: number; end: number; type: 'add' | 'delete' }[] = [];
        
        while ((match = deleteRegex.exec(line)) !== null) {
            segments.push({ start: match.index, end: deleteRegex.lastIndex, type: 'delete' });
            hasChanges = true;
        }
        
        deleteRegex.lastIndex = 0;
        
        while ((match = addRegex.exec(line)) !== null) {
            segments.push({ start: match.index, end: addRegex.lastIndex, type: 'add' });
            hasChanges = true;
        }
        
        if (hasChanges) {
            // Sort segments by position
            segments.sort((a, b) => a.start - b.start);
            
            lastIndex = 0;
            for (const segment of segments) {
                // Add text before this segment
                if (segment.start > lastIndex) {
                    const plainText = line.substring(lastIndex, segment.start);
                    if (plainText.trim()) {
                        changes.push({ type: 'text', content: plainText });
                    }
                }
                
                // Add the marked segment
                const fullMatch = line.substring(segment.start, segment.end);
                const content = fullMatch.replace(/\[(ADD|DELETE)\]/g, '').replace(/\[\/(ADD|DELETE)\]/g, '');
                
                if (content.trim()) {
                    changes.push({ type: segment.type, content: content });
                }
                
                lastIndex = segment.end;
            }
            
            // Add remaining text
            if (lastIndex < line.length) {
                const remaining = line.substring(lastIndex);
                if (remaining.trim()) {
                    changes.push({ type: 'text', content: remaining });
                }
            }
            
            // Add newline
            changes.push({ type: 'text', content: '\n' });
        } else if (line.trim()) {
            // Regular line without changes
            changes.push({ type: 'text', content: line + '\n' });
        } else {
            // Empty line
            changes.push({ type: 'text', content: '\n' });
        }
    }
    
    return changes;
}


"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.htmlToRichTextLines = htmlToRichTextLines;
exports.extractBoldFormattingSignals = extractBoldFormattingSignals;
function decodeHtml(value) {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
function normalizeLineText(value) {
    return `${value || ''}`
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
function normalizeBoldText(value) {
    return normalizeLineText(value);
}
function extractParagraphBodies(html) {
    const source = `${html || ''}`;
    const bodies = [];
    const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = paragraphPattern.exec(source)) !== null) {
        bodies.push(match[1] || '');
    }
    if (bodies.length) {
        return bodies;
    }
    return source ? source.split(/<br\s*\/?>/i) : [];
}
function closeBoldRange(ranges, text, start) {
    if (start !== null && text.length > start) {
        ranges.push({
            start,
            end: text.length,
            text: text.slice(start, text.length),
        });
    }
    return null;
}
function parseRichTextLine(innerHtml) {
    let text = '';
    let boldDepth = 0;
    let boldStart = null;
    const boldRanges = [];
    const tokenPattern = /<[^>]+>|[^<]+/g;
    let match;
    while ((match = tokenPattern.exec(`${innerHtml || ''}`)) !== null) {
        const token = match[0] || '';
        if (!token) {
            continue;
        }
        if (token.startsWith('<')) {
            if (/^<\s*br\b/i.test(token)) {
                text += '\n';
                continue;
            }
            if (/^<\s*(strong|b)\b/i.test(token)) {
                if (boldDepth === 0) {
                    boldStart = text.length;
                }
                boldDepth += 1;
                continue;
            }
            if (/^<\s*\/\s*(strong|b)\s*>/i.test(token)) {
                boldDepth = Math.max(0, boldDepth - 1);
                if (boldDepth === 0) {
                    boldStart = closeBoldRange(boldRanges, text, boldStart);
                }
                continue;
            }
            continue;
        }
        text += decodeHtml(token);
    }
    if (boldDepth > 0) {
        closeBoldRange(boldRanges, text, boldStart);
    }
    const firstTextIndex = text.search(/\S/);
    const leadingRange = firstTextIndex >= 0
        ? boldRanges.find((range) => range.start <= firstTextIndex && range.end > firstTextIndex)
        : undefined;
    return {
        text,
        leadingBoldText: leadingRange ? text.slice(firstTextIndex, leadingRange.end).trim() : '',
        boldRanges,
    };
}
function htmlToRichTextLines(html) {
    return extractParagraphBodies(html).map(parseRichTextLine);
}
function buildUniqueLineMap(lines) {
    const counts = new Map();
    const indexed = lines.map((line, lineIndex) => ({
        ...line,
        lineIndex,
        normalizedText: normalizeLineText(line.text),
    }));
    for (const line of indexed) {
        if (!line.normalizedText) {
            continue;
        }
        counts.set(line.normalizedText, (counts.get(line.normalizedText) || 0) + 1);
    }
    const unique = new Map();
    for (const line of indexed) {
        if (line.normalizedText && counts.get(line.normalizedText) === 1) {
            unique.set(line.normalizedText, line);
        }
    }
    return unique;
}
function extractBoldFormattingSignals(input) {
    if (!input.aiDraftHtml || !input.finalHtml) {
        return [];
    }
    const aiLinesByText = buildUniqueLineMap(htmlToRichTextLines(input.aiDraftHtml));
    const originalLinesByText = input.originalHtml
        ? buildUniqueLineMap(htmlToRichTextLines(input.originalHtml))
        : new Map();
    const finalLines = htmlToRichTextLines(input.finalHtml).map((line, lineIndex) => ({
        ...line,
        lineIndex,
        normalizedText: normalizeLineText(line.text),
    }));
    const signals = [];
    for (const finalLine of finalLines) {
        if (!finalLine.normalizedText) {
            continue;
        }
        const aiLine = aiLinesByText.get(finalLine.normalizedText);
        if (!aiLine) {
            continue;
        }
        const aiBold = normalizeBoldText(aiLine.leadingBoldText);
        const finalBold = normalizeBoldText(finalLine.leadingBoldText);
        if (aiBold === finalBold) {
            continue;
        }
        const originalLine = originalLinesByText.get(finalLine.normalizedText);
        const originalBold = originalLine ? normalizeBoldText(originalLine.leadingBoldText) : '';
        const submitterHadFinalBold = !!(originalLine && originalBold && originalBold === finalBold);
        signals.push({
            change_type: aiBold && finalBold ? 'bold_changed' : (finalBold ? 'bold_added' : 'bold_removed'),
            line_text: finalLine.text,
            ai_line_index: aiLine.lineIndex,
            final_line_index: finalLine.lineIndex,
            ...(originalLine ? { original_line_index: originalLine.lineIndex } : {}),
            ai_bold_prefix: aiLine.leadingBoldText,
            final_bold_prefix: finalLine.leadingBoldText,
            ...(originalLine ? { original_bold_prefix: originalLine.leadingBoldText } : {}),
            submitter_had_final_bold: submitterHadFinalBold,
            ai_changed_submitter_bold: submitterHadFinalBold && aiBold !== originalBold,
        });
    }
    return signals;
}

(function (global) {
    const diffCore = (function () {
        if (global.MenuDiffCore) return global.MenuDiffCore;
        if (typeof require === 'function') {
            try {
                return require('@menumanager/diff-core');
            } catch (err) {
                return require('../../../diff-core/src');
            }
        }
        return null;
    })();

    if (!diffCore) {
        throw new Error('MenuDiffCore must be loaded before redline-preview.js');
    }

    const tokenizeDiffText = diffCore.tokenizeDiffText;
    const diffTokensEqual = diffCore.diffTokensEqual;
    const buildTokenLcs = diffCore.buildTokenLcs;
    const projectRichTextHtml = diffCore.projectRichTextHtml;

    function escapeHtml(text) {
        const div = (global.document && global.document.createElement)
            ? global.document.createElement('div')
            : null;

        if (div) {
            div.textContent = text == null ? '' : String(text);
            return div.innerHTML;
        }

        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeExtractedLines(rawLines) {
        const lines = Array.isArray(rawLines) ? [...rawLines] : [];

        while (lines.length && lines[0] === '') lines.shift();
        while (lines.length && lines[lines.length - 1] === '') lines.pop();

        const normalized = [];
        let prevEmpty = false;
        for (const line of lines) {
            if (line === '') {
                if (!prevEmpty) normalized.push('');
                prevEmpty = true;
            } else {
                normalized.push(line);
                prevEmpty = false;
            }
        }

        return normalized.join('\n');
    }

    function extractCleanTextFromElement(element) {
        const lines = [];
        if (!element) return '';
        if (!element.children || !element.children.length) {
            const text = (element.innerText || element.textContent || '')
                .replace(/\u00A0/g, ' ')
                .replace(/\r\n?/g, '\n');
            return normalizeExtractedLines(text.split('\n').map(function (line) {
                return line.trim();
            }));
        }

        for (const child of element.children) {
            const text = (child.textContent || child.innerText || '')
                .replace(/\u00A0/g, ' ')
                .trim();
            lines.push(text);
        }

        return normalizeExtractedLines(lines);
    }

    function htmlLinesToParagraphs(html) {
        const source = String(html || '');
        const lines = source.split(/<br\s*\/?>/i);
        if (!lines.length) return '<p><br></p>';

        return lines
            .map(function (lineHtml) {
                return '<p>' + (lineHtml || '<br>') + '</p>';
            })
            .join('');
    }

    function unwrapElement(element) {
        const parent = element && element.parentNode;
        if (!parent || !global.document) return;
        const fragment = global.document.createDocumentFragment();
        while (element.firstChild) {
            fragment.appendChild(element.firstChild);
        }
        parent.replaceChild(fragment, element);
    }

    function isPersistentRedlineElement(element) {
        return !!(
            element &&
            element.classList &&
            (
                element.classList.contains('existing-del') ||
                element.classList.contains('existing-ins') ||
                element.classList.contains('persistent-del') ||
                element.classList.contains('persistent-ins')
            )
        );
    }

    function stripBackgroundDeclarations(styleValue) {
        return String(styleValue || '')
            .split(';')
            .map(function (part) { return part.trim(); })
            .filter(function (part) {
                return part && !/^background(?:-color)?\s*:/i.test(part);
            })
            .join('; ');
    }

    function stripTransientReviewHighlights(html) {
        const source = String(html || '');

        if (global.document && global.document.createElement) {
            const container = global.document.createElement('div');
            container.innerHTML = source;

            container.querySelectorAll('[style]').forEach(function (node) {
                const style = node.getAttribute('style') || '';
                if (!/background/i.test(style) || isPersistentRedlineElement(node)) return;

                const nextStyle = stripBackgroundDeclarations(style);
                if (nextStyle) {
                    node.setAttribute('style', nextStyle);
                } else {
                    node.removeAttribute('style');
                }

                if (
                    node.tagName &&
                    node.tagName.toLowerCase() === 'span' &&
                    !node.getAttribute('class') &&
                    !node.getAttribute('style')
                ) {
                    unwrapElement(node);
                }
            });

            return container.innerHTML;
        }

        return source
            .replace(
                /<span\b([^>]*)\sstyle=(["'])(?=[^"']*background)[^"']*\2([^>]*)>([\s\S]*?)<\/span>/gi,
                function (_match, before, _quote, after, inner) {
                    if (/\b(existing-del|existing-ins|persistent-del|persistent-ins)\b/.test(before + after)) {
                        return _match;
                    }
                    return inner;
                }
            )
            .replace(/\sstyle=(["'])(?=[^"']*background)[^"']*\1/gi, '');
    }

    function stripLeadingEmptyBlocks(html) {
        let source = String(html || '');
        const leadingEmptyBlockPattern = /^\s*<(p|div)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>\s*/i;
        while (leadingEmptyBlockPattern.test(source)) {
            source = source.replace(leadingEmptyBlockPattern, '');
        }
        return source;
    }

    function stripExistingAnnotationsForEditor(html) {
        const source = stripTransientReviewHighlights(html);

        if (global.document && global.document.createElement) {
            const container = global.document.createElement('div');
            container.innerHTML = source;

            container.querySelectorAll('.existing-del, .persistent-del').forEach(function (node) {
                node.remove();
            });
            container.querySelectorAll('.existing-ins, .persistent-ins').forEach(function (node) {
                unwrapElement(node);
            });
            container.querySelectorAll('[contenteditable]').forEach(function (node) {
                node.removeAttribute('contenteditable');
            });

            return container.innerHTML;
        }

        return source
            .replace(/<span\b(?=[^>]*class=["'][^"']*\b(?:existing-del|persistent-del)\b)[^>]*>[\s\S]*?<\/span>/gi, '')
            .replace(/<span\b(?=[^>]*class=["'][^"']*\b(?:existing-ins|persistent-ins)\b)[^>]*>([\s\S]*?)<\/span>/gi, '$1')
            .replace(/\scontenteditable=(["']).*?\1/gi, '');
    }

    function normalizeRevisionComparisonText(text) {
        return normalizeExtractedLines(String(text || '').split('\n').map(function (line) {
            return line.trim().replace(/\s+([,.;:!?])/g, '$1');
        }));
    }

    function htmlToCleanText(html) {
        const source = String(html || '');

        if (global.document && global.document.createElement) {
            const container = global.document.createElement('div');
            container.innerHTML = source;
            return normalizeRevisionComparisonText(extractCleanTextFromElement(container));
        }

        const withLines = source
            .replace(/<\/(?:p|div|li)>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n');
        const withoutTags = withLines
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");

        return normalizeRevisionComparisonText(withoutTags);
    }

    function removeAnnotatedSpans(html, classPattern) {
        const source = String(html || '');

        if (global.document && global.document.createElement) {
            const container = global.document.createElement('div');
            container.innerHTML = source;
            container.querySelectorAll('span').forEach(function (node) {
                const className = node.getAttribute('class') || '';
                if (classPattern.test(className)) {
                    node.remove();
                }
            });
            return container.innerHTML;
        }

        return source.replace(
            /<span\b(?=[^>]*class=["']([^"']*)["'])[^>]*>[\s\S]*?<\/span>/gi,
            function (match, className) {
                return classPattern.test(className || '') ? '' : match;
            }
        );
    }

    function unwrapAnnotatedSpans(html, classPattern) {
        const source = String(html || '');

        if (global.document && global.document.createElement) {
            const container = global.document.createElement('div');
            container.innerHTML = source;
            container.querySelectorAll('span').forEach(function (node) {
                const className = node.getAttribute('class') || '';
                if (classPattern.test(className)) {
                    unwrapElement(node);
                }
            });
            container.querySelectorAll('[contenteditable]').forEach(function (node) {
                node.removeAttribute('contenteditable');
            });
            return container.innerHTML;
        }

        return source
            .replace(
                /<span\b(?=[^>]*class=["']([^"']*)["'])[^>]*>([\s\S]*?)<\/span>/gi,
                function (match, className, inner) {
                    return classPattern.test(className || '') ? inner : match;
                }
            )
            .replace(/\scontenteditable=(["']).*?\1/gi, '');
    }

    function buildRevisionComparisonFromAnnotatedHtml(html) {
        const source = stripLeadingEmptyBlocks(stripTransientReviewHighlights(html || ''));
        const deletionClassPattern = /\b(?:existing-del|persistent-del)\b/;
        const insertionClassPattern = /\b(?:existing-ins|persistent-ins)\b/;

        const originalHtml = unwrapAnnotatedSpans(
            removeAnnotatedSpans(source, insertionClassPattern),
            deletionClassPattern
        );
        const editorHtml = stripExistingAnnotationsForEditor(source);
        const currentHtml = editorHtml;

        return {
            originalText: htmlToCleanText(originalHtml),
            currentText: htmlToCleanText(currentHtml),
            editorHtml: editorHtml || '<p><br></p>',
            originalHtml: originalHtml || '<p><br></p>'
        };
    }

    function hasAnnotationMapEntries(annotationMap) {
        return Object.keys(annotationMap || {}).some(function (key) {
            const idx = Number(key);
            return Number.isInteger(idx) && !!getExistingAnnotationType(annotationMap, idx);
        });
    }

    function hasRedlineSpans(html) {
        return /\b(?:existing-del|existing-ins|persistent-del|persistent-ins)\b/.test(String(html || ''));
    }

    function buildRevisionTextSidesFromAnnotationMap(previewText, annotationMap) {
        const source = String(previewText || '');
        const annotations = annotationMap || {};
        let originalText = '';
        let currentText = '';

        for (let i = 0; i < source.length; i++) {
            const annotation = getExistingAnnotationType(annotations, i);
            if (annotation !== 'ins') {
                originalText += source[i];
            }
            if (annotation !== 'del') {
                currentText += source[i];
            }
        }

        return {
            originalText: normalizeRevisionComparisonText(originalText),
            currentText: normalizeRevisionComparisonText(currentText),
        };
    }

    function buildRevisionComparisonFromAnnotatedPreview(previewText, annotationMap, options) {
        const settings = options || {};
        const source = String(previewText || '');
        const suppliedCurrentText = normalizeRevisionComparisonText(settings.baselineText || '');
        const baselineHtml = stripTransientReviewHighlights(settings.baselineHtml || '');
        const htmlComparison = hasRedlineSpans(baselineHtml)
            ? buildRevisionComparisonFromAnnotatedHtml(baselineHtml)
            : null;
        const hasMap = hasAnnotationMapEntries(annotationMap || {});

        if (!hasMap && htmlComparison) {
            return htmlComparison;
        }

        if (!hasMap) {
            const currentText = suppliedCurrentText || normalizeRevisionComparisonText(source);
            return {
                originalText: currentText,
                currentText,
                editorHtml: buildEditableHtmlFromBaseline(baselineHtml, currentText),
                originalHtml: baselineHtml || '<p><br></p>',
            };
        }

        const textSides = buildRevisionTextSidesFromAnnotationMap(source, annotationMap || {});
        const originalText = textSides.originalText || normalizeRevisionComparisonText(source);
        const currentText = suppliedCurrentText || textSides.currentText;
        const originalHtml = htmlComparison && htmlComparison.originalHtml
            ? htmlComparison.originalHtml
            : (baselineHtml || '<p><br></p>');
        const editorHtml = htmlComparison && htmlComparison.editorHtml
            ? htmlComparison.editorHtml
            : buildEditableHtmlFromBaseline(baselineHtml, currentText);

        return {
            originalText,
            currentText,
            editorHtml: editorHtml || '<p><br></p>',
            originalHtml: originalHtml || '<p><br></p>',
        };
    }

    function getBlockChildren(container) {
        if (!container || !container.children) return [];
        return Array.from(container.children).filter(function (child) {
            return /^(p|div|li)$/i.test(child.tagName || '');
        });
    }

    function normalizeInlineText(value) {
        return String(value || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function getLeadingBoldHint(block) {
        const lineText = normalizeInlineText(block && block.textContent);
        if (!lineText || !block.querySelectorAll) return null;

        const boldNodes = Array.from(block.querySelectorAll('strong, b'));
        for (const node of boldNodes) {
            const boldText = normalizeInlineText(node.textContent);
            if (boldText && lineText.startsWith(boldText)) {
                return { lineText, boldText };
            }
        }

        return null;
    }

    function wrapLeadingTextInStrong(element, charCount) {
        if (!element || !global.document || charCount <= 0) return;
        let remaining = charCount;

        function visit(node) {
            if (!node || remaining <= 0) return;

            if (node.nodeType === 3) {
                const text = node.nodeValue || '';
                if (!text) return;
                const take = Math.min(remaining, text.length);
                const before = text.slice(0, take);
                const after = text.slice(take);
                const strong = global.document.createElement('strong');
                strong.textContent = before;
                const parent = node.parentNode;
                if (!parent) return;
                parent.insertBefore(strong, node);
                if (after) {
                    node.nodeValue = after;
                } else {
                    parent.removeChild(node);
                }
                remaining -= take;
                return;
            }

            if (node.nodeType !== 1) return;
            if (/^(strong|b)$/i.test(node.tagName || '')) {
                remaining -= (node.textContent || '').length;
                return;
            }

            Array.from(node.childNodes || []).forEach(visit);
        }

        Array.from(element.childNodes || []).forEach(visit);
    }

    function restoreLeadingBoldFromSource(sourceHtml, targetHtml) {
        if (!sourceHtml || !targetHtml) {
            return targetHtml || '';
        }

        if (!global.document || !global.document.createElement) {
            const sourceBlocks = stripExistingAnnotationsForEditor(sourceHtml).match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
            let targetIndex = 0;
            return String(targetHtml).replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, function (match, attrs, innerHtml) {
                const sourceBlock = sourceBlocks[targetIndex++] || '';
                const leadingBold = sourceBlock.match(/<p\b[^>]*>\s*<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/i);
                if (!leadingBold) return match;
                const sourceText = leadingBold[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                const targetText = innerHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                if (!sourceText || !targetText) return match;
                const commaIndex = targetText.indexOf(',');
                const boldLength = commaIndex >= 0 ? commaIndex + 1 : Math.min(sourceText.length, targetText.length);
                const prefix = targetText.slice(0, boldLength);
                if (!innerHtml.startsWith(prefix)) return match;
                return `<p${attrs}><strong>${escapeHtml(prefix)}</strong>${innerHtml.slice(prefix.length)}</p>`;
            });
        }

        const sourceContainer = global.document.createElement('div');
        sourceContainer.innerHTML = stripExistingAnnotationsForEditor(sourceHtml);
        const targetContainer = global.document.createElement('div');
        targetContainer.innerHTML = targetHtml;

        const sourceBlocks = getBlockChildren(sourceContainer);
        const targetBlocks = getBlockChildren(targetContainer);
        if (!sourceBlocks.length || !targetBlocks.length) return targetHtml;

        targetBlocks.forEach(function (targetBlock, index) {
            const hint = getLeadingBoldHint(sourceBlocks[index]);
            if (!hint) return;
            const targetText = normalizeInlineText(targetBlock.textContent);
            if (!targetText) return;

            const targetComma = targetText.indexOf(',');
            const sourceComma = hint.lineText.indexOf(',');
            const boldLength = sourceComma >= 0 && targetComma >= 0
                ? targetComma + 1
                : Math.min(hint.boldText.length, targetText.length);

            wrapLeadingTextInStrong(targetBlock, boldLength);
        });

        return targetContainer.innerHTML;
    }

    function buildEditableHtmlFromBaseline(sourceHtml, cleanText) {
        const text = String(cleanText || '');
        let inlineHtml = '';

        if (sourceHtml && projectRichTextHtml) {
            try {
                inlineHtml = projectRichTextHtml(stripExistingAnnotationsForEditor(sourceHtml), text);
            } catch (err) {
                inlineHtml = '';
            }
        }

        if (!inlineHtml) {
            inlineHtml = escapeHtml(text).replace(/\n/g, '<br>');
        }

        return stripExistingAnnotationsForEditor(htmlLinesToParagraphs(inlineHtml)) || '<p><br></p>';
    }

    function buildAnnotationMapFromParagraphAnnotations(baseText, annotations) {
        const map = {};
        if (!annotations || !annotations.length) return map;

        const lines = String(baseText || '').split('\n');
        let globalOffset = 0;
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const paraAnnotations = lineIdx < annotations.length ? annotations[lineIdx] : [];
            if (paraAnnotations && paraAnnotations.length) {
                for (const annotation of paraAnnotations) {
                    for (let c = annotation.start; c < annotation.end; c++) {
                        map[globalOffset + c] = annotation.type;
                    }
                }
            }
            globalOffset += lines[lineIdx].length + 1;
        }

        return map;
    }

    function buildAnnotationMapFromDOM(element, options) {
        const settings = options || {};
        const map = {};
        const baseline = settings.baselineText || extractCleanTextFromElement(element);
        let cursor = 0;

        element.querySelectorAll('.existing-del, .existing-ins').forEach((span) => {
            const type = span.classList.contains('existing-del') ? 'del' : 'ins';
            let text = (span.innerText || span.textContent || '').replace(/\u00A0/g, ' ');
            if (settings.trimText !== false) {
                text = text.trim();
            }
            if (!text) return;

            const idx = baseline.indexOf(text, cursor);
            if (idx !== -1) {
                for (let c = 0; c < text.length; c++) {
                    map[idx + c] = type;
                }
                cursor = idx + text.length;
            }
        });

        return map;
    }

    function buildAnnotationMapFromHtml(html, baselineText, options) {
        if (!global.document || !global.document.createElement) return {};
        const container = global.document.createElement('div');
        container.innerHTML = html || '';
        return buildAnnotationMapFromDOM(container, {
            baselineText,
            trimText: options && Object.prototype.hasOwnProperty.call(options, 'trimText')
                ? options.trimText
                : false
        });
    }

    function getExistingAnnotationType(annotationMap, charOffset) {
        const annotation = annotationMap ? annotationMap[charOffset] : null;
        return annotation === 'del' || annotation === 'ins' ? annotation : null;
    }

    function wrapExistingAnnotationHtml(type, htmlChunk) {
        if (!type || !htmlChunk) return htmlChunk || '';
        const className = type === 'del' ? 'existing-del' : 'existing-ins';
        return '<span class="' + className + '">' + htmlChunk + '</span>';
    }

    function wrapWithExistingAnnotation(token, charOffset, annotationMap) {
        const source = token || '';
        if (!source || !source.trim()) return escapeHtml(source);

        let html = '';
        let idx = 0;
        while (idx < source.length) {
            const type = getExistingAnnotationType(annotationMap, charOffset + idx);
            let end = idx + 1;
            while (
                end < source.length &&
                getExistingAnnotationType(annotationMap, charOffset + end) === type
            ) {
                end++;
            }

            const chunk = source.slice(idx, end);
            const escaped = escapeHtml(chunk);
            html += chunk.trim() ? wrapExistingAnnotationHtml(type, escaped) : escaped;
            idx = end;
        }

        return html;
    }

    function stripExistingDeletions(baseText, annotationMap) {
        const source = String(baseText || '');
        let clean = '';
        for (let i = 0; i < source.length; i++) {
            if (annotationMap[i] !== 'del') {
                clean += source[i];
            }
        }
        return clean;
    }

    function stripExistingDeletionsWithAnnotationMap(baseText, annotationMap) {
        const source = String(baseText || '');
        const cleanMap = {};
        let clean = '';

        for (let i = 0; i < source.length; i++) {
            const annotation = getExistingAnnotationType(annotationMap || {}, i);
            if (annotation === 'del') {
                continue;
            }
            if (annotation === 'ins') {
                cleanMap[clean.length] = annotation;
            }
            clean += source[i];
        }

        return { text: clean, annotationMap: cleanMap };
    }

    function transferCleanAnnotationsToRevised(cleanBaseText, revisedText, cleanAnnotationMap) {
        const cleanBase = String(cleanBaseText || '');
        const revised = String(revisedText || '');
        const sourceMap = cleanAnnotationMap || {};
        const revisedMap = {};

        if (!Object.keys(sourceMap).length) {
            return revisedMap;
        }

        const baseTokens = tokenizeDiffText(cleanBase);
        const revisedTokens = tokenizeDiffText(revised);
        if (!baseTokens.length || !revisedTokens.length) {
            return revisedMap;
        }

        const lcs = buildTokenLcs(baseTokens, revisedTokens);
        let baseIdx = 0;
        let revisedIdx = 0;

        while (baseIdx < baseTokens.length && revisedIdx < revisedTokens.length) {
            const baseCommon = lcs.commonBase.has(baseIdx);
            const revisedCommon = lcs.commonRev.has(revisedIdx);
            const baseToken = baseTokens[baseIdx];
            const revisedToken = revisedTokens[revisedIdx];

            if (baseCommon && revisedCommon && diffTokensEqual(baseToken, revisedToken)) {
                const length = Math.min(
                    baseToken.end - baseToken.start,
                    revisedToken.end - revisedToken.start
                );
                for (let c = 0; c < length; c++) {
                    const annotation = getExistingAnnotationType(sourceMap, baseToken.start + c);
                    if (annotation) {
                        revisedMap[revisedToken.start + c] = annotation;
                    }
                }
                baseIdx++;
                revisedIdx++;
                continue;
            }

            if (baseIdx < baseTokens.length && !baseCommon) {
                baseIdx++;
                continue;
            }
            if (revisedIdx < revisedTokens.length && !revisedCommon) {
                revisedIdx++;
                continue;
            }

            baseIdx++;
            revisedIdx++;
        }

        return revisedMap;
    }

    function shiftAnnotationMapForInsert(annotationMap, offset, textLength, annotationType) {
        const nextMap = {};
        const insertAt = Math.max(0, offset || 0);
        const insertedLength = Math.max(0, textLength || 0);
        const nextBoundaries = {};

        Object.keys(annotationMap || {}).forEach(function (key) {
            const idx = Number(key);
            if (!Number.isInteger(idx)) return;
            const nextIdx = idx >= insertAt ? idx + insertedLength : idx;
            nextMap[nextIdx] = annotationMap[key];
        });

        const boundaries = annotationMap && annotationMap._boundaries
            ? annotationMap._boundaries
            : {};
        Object.keys(boundaries).forEach(function (key) {
            const idx = Number(key);
            if (!Number.isInteger(idx)) return;
            const nextIdx = idx >= insertAt ? idx + insertedLength : idx;
            nextBoundaries[nextIdx] = true;
        });

        const type = annotationType === 'del' || annotationType === 'ins' ? annotationType : null;
        if (type) {
            for (let i = 0; i < insertedLength; i++) {
                nextMap[insertAt + i] = type;
            }
            nextBoundaries[insertAt] = true;
            nextBoundaries[insertAt + insertedLength] = true;
        }

        if (Object.keys(nextBoundaries).length) {
            nextMap._boundaries = nextBoundaries;
        }
        return nextMap;
    }

    function buildExistingDeletionAnchors(baseText, annotationMap) {
        const source = String(baseText || '');
        const anchors = [];
        let cleanOffset = 0;
        let i = 0;

        while (i < source.length) {
            if (annotationMap[i] === 'del') {
                let text = '';
                const start = i;
                const offset = cleanOffset;
                while (i < source.length && annotationMap[i] === 'del') {
                    text += source[i];
                    i++;
                }
                if (text) {
                    anchors.push({
                        offset: offset,
                        text: text,
                        startsAtLineStart: start === 0 || source[start - 1] === '\n',
                        endsAtLineEnd: i >= source.length || source[i] === '\n'
                    });
                }
                continue;
            }

            cleanOffset++;
            i++;
        }

        return anchors;
    }

    function buildExistingAnnotationGroups(basePreviewText, annotationMap) {
        const source = String(basePreviewText || '');
        const groups = [];
        let cleanOffset = 0;
        let i = 0;

        while (i < source.length) {
            const type = getExistingAnnotationType(annotationMap || {}, i);
            if (!type) {
                cleanOffset++;
                i++;
                continue;
            }

            const start = i;
            const cleanStart = cleanOffset;
            let delText = '';
            let insText = '';
            const deletionRuns = [];
            while (i < source.length && getExistingAnnotationType(annotationMap || {}, i)) {
                const currentType = getExistingAnnotationType(annotationMap || {}, i);
                const runStart = i;
                const runCleanStart = cleanOffset;
                let runText = '';

                while (
                    i < source.length &&
                    getExistingAnnotationType(annotationMap || {}, i) === currentType
                ) {
                    runText += source[i];
                    if (currentType === 'ins') {
                        cleanOffset++;
                    }
                    i++;
                }

                if (currentType === 'del') {
                    delText += runText;
                    deletionRuns.push({
                        text: runText,
                        cleanStart: runCleanStart,
                        startsAtLineStart: runStart === 0 || source[runStart - 1] === '\n',
                        endsAtLineEnd: i >= source.length || source[i] === '\n'
                    });
                } else {
                    insText += runText;
                }
            }

            groups.push({
                index: groups.length,
                start: start,
                end: i,
                cleanStart: cleanStart,
                cleanEnd: cleanOffset,
                delText: delText,
                insText: insText,
                deletionRuns: deletionRuns,
                previewText: source.slice(start, i),
                startsAtLineStart: start === 0 || source[start - 1] === '\n',
                endsAtLineEnd: i >= source.length || source[i] === '\n'
            });
        }

        return groups;
    }

    function buildBoundaryPreservingDeletionText(deletedText, outputText, offset, startsAtLineStart, endsAtLineEnd) {
        let text = String(deletedText || '');
        if (!text || (!startsAtLineStart && !endsAtLineEnd)) {
            return text;
        }

        const output = String(outputText || '');
        const safeOffset = Math.max(0, Math.min(offset || 0, output.length));
        const before = safeOffset > 0 ? output[safeOffset - 1] : '';
        const after = safeOffset < output.length ? output[safeOffset] : '';

        if (startsAtLineStart && before && before !== '\n' && text[0] !== '\n') {
            text = '\n' + text;
        }
        if (endsAtLineEnd && after && after !== '\n' && text[text.length - 1] !== '\n') {
            text += '\n';
        }

        return text;
    }

    function groupWasRevertedToOriginal(group, cleanBaseText, revisedText, mapOffset) {
        const revised = String(revisedText || '');
        const offset = mapOffset
            ? mapOffset(group.cleanStart)
            : mapBaselineOffsetToRevisedOffset(cleanBaseText, revised, group.cleanStart);

        if (group.delText) {
            const oldAtOffset = revised.slice(offset, offset + group.delText.length);
            const acceptedAfterOriginal = group.insText
                ? revised.slice(
                    offset + group.delText.length,
                    offset + group.delText.length + group.insText.length
                )
                : '';
            return oldAtOffset === group.delText && acceptedAfterOriginal !== group.insText;
        }

        if (group.insText) {
            return revised.slice(offset, offset + group.insText.length) !== group.insText;
        }

        return false;
    }

    function buildResolvedBasePreview(basePreviewText, annotationMap, groups, revertedIndexes) {
        const source = String(basePreviewText || '');
        const reverted = revertedIndexes || new Set();
        const nextMap = {};
        let text = '';
        let sourceIdx = 0;

        groups.forEach(function (group) {
            while (sourceIdx < group.start) {
                if (getExistingAnnotationType(annotationMap || {}, sourceIdx)) {
                    nextMap[text.length] = annotationMap[sourceIdx];
                }
                text += source[sourceIdx];
                sourceIdx++;
            }

            if (reverted.has(group.index)) {
                text += group.delText || '';
            } else {
                for (let i = group.start; i < group.end; i++) {
                    if (getExistingAnnotationType(annotationMap || {}, i)) {
                        nextMap[text.length] = annotationMap[i];
                    }
                    text += source[i];
                }
            }
            sourceIdx = group.end;
        });

        while (sourceIdx < source.length) {
            if (getExistingAnnotationType(annotationMap || {}, sourceIdx)) {
                nextMap[text.length] = annotationMap[sourceIdx];
            }
            text += source[sourceIdx];
            sourceIdx++;
        }

        return { text: text, annotationMap: nextMap };
    }

    function reinsertExistingDeletionsForGroups(cleanBaseText, revisedText, groups, revertedIndexes, mapOffset, options) {
        const cleanBase = String(cleanBaseText || '');
        const revised = String(revisedText || '');
        const settings = options || {};
        const offsetMapper = mapOffset || createBaselineOffsetMapper(cleanBase, revised);
        const reverted = revertedIndexes || new Set();
        const inserts = [];

        groups.forEach(function (group) {
            if (!group.delText || reverted.has(group.index)) {
                return;
            }

            const deletionRuns = group.deletionRuns && group.deletionRuns.length
                ? group.deletionRuns
                : [{
                    text: group.delText,
                    cleanStart: group.cleanStart,
                    startsAtLineStart: group.startsAtLineStart,
                    endsAtLineEnd: group.endsAtLineEnd
                }];

            deletionRuns.forEach(function (run, runIndex) {
                if (!run.text) return;

                const offset = offsetMapper(run.cleanStart);
                if (revised.slice(offset, offset + run.text.length) === run.text) {
                    return;
                }
                const isWholeDeletedLine = !group.insText && run.startsAtLineStart && run.endsAtLineEnd;

                inserts.push({
                    groupIndex: group.index,
                    runIndex: runIndex,
                    text: run.text,
                    offset: offset,
                    startsAtLineStart: isWholeDeletedLine,
                    endsAtLineEnd: isWholeDeletedLine
                });
            });
        });

        inserts.sort(function (a, b) {
            if (a.offset !== b.offset) return b.offset - a.offset;
            if (a.groupIndex !== b.groupIndex) return b.groupIndex - a.groupIndex;
            return b.runIndex - a.runIndex;
        });

        let output = revised;
        let outputAnnotationMap = settings.revisedAnnotationMap || {};
        inserts.forEach(function (insert) {
            const text = buildBoundaryPreservingDeletionText(
                insert.text,
                output,
                insert.offset,
                insert.startsAtLineStart,
                insert.endsAtLineEnd
            );
            output = output.slice(0, insert.offset) + text + output.slice(insert.offset);
            outputAnnotationMap = shiftAnnotationMapForInsert(
                outputAnnotationMap,
                insert.offset,
                text.length,
                'del'
            );
        });
        if (settings.returnAnnotationMap) {
            return {
                text: output,
                annotationMap: outputAnnotationMap
            };
        }
        return output;
    }

    function tokenizeAnnotatedDiffText(text, globalOffset, annotationMap) {
        const tokens = tokenizeDiffText(text);
        if (!annotationMap || !Object.keys(annotationMap).length) {
            return tokens;
        }

        const output = [];
        tokens.forEach(function (token) {
            if (!token || token.end <= token.start) return;

            let chunkStart = token.start;
            let currentType = getExistingAnnotationType(annotationMap, globalOffset + token.start);
            for (let idx = token.start + 1; idx < token.end; idx++) {
                const absoluteIdx = globalOffset + idx;
                const nextType = getExistingAnnotationType(annotationMap, absoluteIdx);
                if (
                    nextType === currentType &&
                    !(annotationMap._boundaries && annotationMap._boundaries[absoluteIdx])
                ) {
                    continue;
                }

                const value = token.value.slice(chunkStart - token.start, idx - token.start);
                if (value) {
                    output.push({
                        value,
                        start: chunkStart,
                        end: idx,
                        type: getDiffTokenTypeForAnnotatedChunk(value, token.type),
                        normalized: normalizeAnnotatedTokenValue(value),
                    });
                }
                chunkStart = idx;
                currentType = nextType;
            }

            const value = token.value.slice(chunkStart - token.start);
            if (value) {
                output.push({
                    value,
                    start: chunkStart,
                    end: token.end,
                    type: getDiffTokenTypeForAnnotatedChunk(value, token.type),
                    normalized: normalizeAnnotatedTokenValue(value),
                });
            }
        });

        return output;
    }

    function normalizeAnnotatedTokenValue(value) {
        const token = tokenizeDiffText(value)[0];
        return token ? token.normalized : String(value || '');
    }

    function getDiffTokenTypeForAnnotatedChunk(value, fallbackType) {
        const token = tokenizeDiffText(value)[0];
        return token ? token.type : fallbackType;
    }

    function collapseRevertedGroupsInHtml(html, revertedIndexes) {
        if (!html || !revertedIndexes || !revertedIndexes.size || !global.document || !global.document.createElement) {
            return html || '';
        }

        const container = global.document.createElement('div');
        container.innerHTML = html;
        let groupIndex = 0;

        Array.from(container.querySelectorAll('p, div, li')).forEach(function (block) {
            let node = block.firstChild;
            while (node) {
                if (
                    node.nodeType === 1 &&
                    node.classList &&
                    (node.classList.contains('existing-del') || node.classList.contains('existing-ins'))
                ) {
                    const groupNodes = [];
                    let cursor = node;
                    while (
                        cursor &&
                        cursor.nodeType === 1 &&
                        cursor.classList &&
                        (cursor.classList.contains('existing-del') || cursor.classList.contains('existing-ins'))
                    ) {
                        groupNodes.push(cursor);
                        cursor = cursor.nextSibling;
                    }

                    if (revertedIndexes.has(groupIndex)) {
                        const fragment = global.document.createDocumentFragment();
                        groupNodes.forEach(function (groupNode) {
                            if (!groupNode.classList.contains('existing-del')) return;
                            while (groupNode.firstChild) {
                                fragment.appendChild(groupNode.firstChild);
                            }
                        });
                        block.insertBefore(fragment, groupNodes[0]);
                        groupNodes.forEach(function (groupNode) {
                            if (groupNode.parentNode) groupNode.parentNode.removeChild(groupNode);
                        });
                    }

                    groupIndex++;
                    node = cursor;
                    continue;
                }
                node = node.nextSibling;
            }
        });

        return container.innerHTML;
    }

    function createBaselineOffsetMapper(baseText, revisedText) {
        const base = String(baseText || '');
        const revised = String(revisedText || '');

        function clampOffset(offset) {
            return Math.max(0, Math.min(offset || 0, base.length));
        }

        const baseTokens = tokenizeDiffText(base);
        const revisedTokens = tokenizeDiffText(revised);
        if (!baseTokens.length || !revisedTokens.length) {
            return function (offset) {
                return Math.max(0, Math.min(clampOffset(offset), revised.length));
            };
        }

        const lcs = buildTokenLcs(baseTokens, revisedTokens);
        const commonBase = baseTokens.filter(function (_token, idx) {
            return lcs.commonBase.has(idx);
        });
        const commonRevised = revisedTokens.filter(function (_token, idx) {
            return lcs.commonRev.has(idx);
        });

        return function (offset) {
            const target = clampOffset(offset);

            if (target <= 0) return 0;
            if (target >= base.length) return revised.length;

            let prevPair = null;
            for (let i = 0; i < commonBase.length && i < commonRevised.length; i++) {
                const baseTok = commonBase[i];
                const revisedTok = commonRevised[i];

                if (target >= baseTok.start && target <= baseTok.end) {
                    return Math.min(revisedTok.start + (target - baseTok.start), revisedTok.end);
                }

                if (baseTok.start >= target) {
                    return revisedTok.start;
                }

                prevPair = { baseTok: baseTok, revisedTok: revisedTok };
            }

            if (prevPair) {
                return Math.min(
                    revised.length,
                    prevPair.revisedTok.end + Math.max(0, target - prevPair.baseTok.end)
                );
            }

            return Math.max(0, Math.min(target, revised.length));
        };
    }

    function mapBaselineOffsetToRevisedOffset(baseText, revisedText, offset) {
        return createBaselineOffsetMapper(baseText, revisedText)(offset);
    }

    function reinsertExistingDeletions(cleanBaseText, revisedText, basePreviewText, annotationMap) {
        const cleanBase = String(cleanBaseText || '');
        const revised = String(revisedText || '');
        const previewBase = String(basePreviewText || '');
        const cleanFromPreview = stripExistingDeletions(previewBase, annotationMap || {});

        if (!previewBase || cleanFromPreview !== cleanBase) {
            return revised;
        }

        const anchors = buildExistingDeletionAnchors(previewBase, annotationMap || {});
        if (!anchors.length) {
            return revised;
        }

        const mapOffset = createBaselineOffsetMapper(cleanBase, revised);
        const inserts = anchors.map(function (anchor, idx) {
            return {
                idx: idx,
                text: anchor.text,
                offset: mapOffset(anchor.offset),
                startsAtLineStart: anchor.startsAtLineStart,
                endsAtLineEnd: anchor.endsAtLineEnd
            };
        }).sort(function (a, b) {
            if (a.offset !== b.offset) return b.offset - a.offset;
            return b.idx - a.idx;
        });

        let output = revised;
        inserts.forEach(function (insert) {
            const text = buildBoundaryPreservingDeletionText(
                insert.text,
                output,
                insert.offset,
                insert.startsAtLineStart,
                insert.endsAtLineEnd
            );
            output = output.slice(0, insert.offset) + text + output.slice(insert.offset);
        });
        return output;
    }

    function resolveExistingAnnotationRevisions(cleanBaseText, revisedText, basePreviewText, annotationMap, options) {
        const settings = options || {};
        const cleanBase = String(cleanBaseText || '');
        const revised = String(revisedText || '');
        const previewBase = String(basePreviewText || '');
        const annotations = annotationMap || {};
        const groups = buildExistingAnnotationGroups(previewBase, annotations);
        const revertedIndexes = new Set();
        const mapOffset = createBaselineOffsetMapper(cleanBase, revised);
        const cleanBaseAnnotations = stripExistingDeletionsWithAnnotationMap(previewBase, annotations);
        const revisedAnnotationMap = transferCleanAnnotationsToRevised(
            cleanBaseAnnotations.text || cleanBase,
            revised,
            cleanBaseAnnotations.annotationMap
        );

        groups.forEach(function (group) {
            if (groupWasRevertedToOriginal(group, cleanBase, revised, mapOffset)) {
                revertedIndexes.add(group.index);
            }
        });

        if (!revertedIndexes.size) {
            const revisedPreview = reinsertExistingDeletionsForGroups(
                cleanBase,
                revised,
                groups,
                revertedIndexes,
                mapOffset,
                {
                    revisedAnnotationMap,
                    returnAnnotationMap: true
                }
            );
            return {
                basePreviewText: previewBase,
                revisedPreviewText: revisedPreview.text,
                annotationMap: annotations,
                revisedAnnotationMap: revisedPreview.annotationMap,
                baselineHtml: settings.baselineHtml || ''
            };
        }

        const resolvedBase = buildResolvedBasePreview(previewBase, annotations, groups, revertedIndexes);
        const resolvedCleanAnnotations = stripExistingDeletionsWithAnnotationMap(
            resolvedBase.text,
            resolvedBase.annotationMap
        );
        const resolvedRevisedAnnotationMap = transferCleanAnnotationsToRevised(
            resolvedCleanAnnotations.text || cleanBase,
            revised,
            resolvedCleanAnnotations.annotationMap
        );
        const revisedPreview = reinsertExistingDeletionsForGroups(
            cleanBase,
            revised,
            groups,
            revertedIndexes,
            mapOffset,
            {
                revisedAnnotationMap: resolvedRevisedAnnotationMap,
                returnAnnotationMap: true
            }
        );
        return {
            basePreviewText: resolvedBase.text,
            revisedPreviewText: revisedPreview.text,
            annotationMap: resolvedBase.annotationMap,
            revisedAnnotationMap: revisedPreview.annotationMap,
            baselineHtml: collapseRevertedGroupsInHtml(settings.baselineHtml || '', revertedIndexes)
        };
    }

    /**
     * Map each character of extractCleanTextFromElement(container) to a DOM text boundary
     * so Range#cloneContents can recover inline markup (<strong>, <em>, …).
     */
    function buildTrimAwareCharIndex(container) {
        if (!container || !container.children || !container.children.length || !global.document) {
            return null;
        }

        const lines = [];
        const entries = [];

        for (let pi = 0; pi < container.children.length; pi++) {
            const p = container.children[pi];
            const r = global.document.createRange();
            r.selectNodeContents(p);
            const full = (r.toString() || '').replace(/\u00A0/g, ' ');
            const lead = (full.match(/^\s*/) || [''])[0].length;
            const trail = (full.match(/\s*$/) || [''])[0].length;
            const keepEnd = full.length - trail;

            let idxInFull = 0;
            const walker = global.document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
            let tn = walker.nextNode();
            while (tn) {
                const t = (tn.textContent || '').replace(/\u00A0/g, ' ');
                for (let k = 0; k < t.length; k++) {
                    const g = idxInFull + k;
                    if (g >= lead && g < keepEnd) {
                        entries.push({ node: tn, offset: k, ch: t[k] });
                    }
                }
                idxInFull += t.length;
                tn = walker.nextNode();
            }

            lines.push(full.slice(lead, keepEnd));

            if (pi < container.children.length - 1) {
                entries.push({ newline: true, ch: '\n' });
            }
        }

        const plain = normalizeExtractedLines(lines.join('\n'));
        const fromEntries = entries.map(function (e) { return e.ch; }).join('');
        if (fromEntries !== plain) {
            return null;
        }

        return { entries: entries, plain: plain };
    }

    var styleIndexCacheEntries = [];
    var STYLE_INDEX_CACHE_LIMIT = 4;

    function normalizeStyleIndexText(text) {
        return String(text == null ? '' : text)
            .replace(/\u00A0/g, ' ')
            .replace(/\r\n?/g, '\n');
    }

    function styleIndexTextMatches(indexPlain, baseText) {
        const source = String(indexPlain == null ? '' : indexPlain);
        const target = String(baseText == null ? '' : baseText);
        if (source.length === target.length) {
            return normalizeStyleIndexText(source) === normalizeStyleIndexText(target);
        }

        if (source.length < target.length) {
            return normalizeStyleIndexText(target.slice(0, source.length)) === normalizeStyleIndexText(source);
        }

        return false;
    }

    function buildStyleTokenMap(indexPlain, baseText) {
        const sourceTokens = tokenizeDiffText(indexPlain || '');
        const baseTokens = tokenizeDiffText(baseText || '');
        if (!sourceTokens.length || !baseTokens.length) return null;

        const lcs = buildTokenLcs(sourceTokens, baseTokens);
        const sourceByBaseStart = {};
        let sourceIdx = 0;
        let baseIdx = 0;
        let mapped = 0;

        while (sourceIdx < sourceTokens.length && baseIdx < baseTokens.length) {
            const sourceCommon = lcs.commonBase.has(sourceIdx);
            const baseCommon = lcs.commonRev.has(baseIdx);
            if (
                sourceCommon &&
                baseCommon &&
                diffTokensEqual(sourceTokens[sourceIdx], baseTokens[baseIdx])
            ) {
                sourceByBaseStart[baseTokens[baseIdx].start] = sourceTokens[sourceIdx];
                mapped++;
                sourceIdx++;
                baseIdx++;
                continue;
            }
            if (!sourceCommon) {
                sourceIdx++;
                continue;
            }
            if (!baseCommon) {
                baseIdx++;
                continue;
            }
            sourceIdx++;
            baseIdx++;
        }

        return mapped ? sourceByBaseStart : null;
    }

    function getStyleIndexForBaseline(baselineHtml, baseText) {
        if (!baselineHtml || baseText == null) {
            return null;
        }
        for (let i = 0; i < styleIndexCacheEntries.length; i++) {
            const entry = styleIndexCacheEntries[i];
            if (entry.html === baselineHtml && entry.text === baseText) {
                if (i > 0) {
                    styleIndexCacheEntries.splice(i, 1);
                    styleIndexCacheEntries.unshift(entry);
                }
                return entry.index;
            }
        }

        function cacheStyleIndex(index) {
            styleIndexCacheEntries.unshift({
                html: baselineHtml,
                text: baseText,
                index: index || null,
            });
            if (styleIndexCacheEntries.length > STYLE_INDEX_CACHE_LIMIT) {
                styleIndexCacheEntries.length = STYLE_INDEX_CACHE_LIMIT;
            }
            return index || null;
        }

        if (diffCore.createRichTextIndexFromHtml) {
            var richIdx = diffCore.createRichTextIndexFromHtml(baselineHtml);
            if (richIdx && styleIndexTextMatches(richIdx.plain, baseText)) {
                return cacheStyleIndex(richIdx);
            }
            if (richIdx) {
                const sourceByBaseStart = buildStyleTokenMap(richIdx.plain, baseText);
                if (sourceByBaseStart) {
                    richIdx.sourceByBaseStart = sourceByBaseStart;
                    return cacheStyleIndex(richIdx);
                }
            }
        }
        if (!global.document) {
            return cacheStyleIndex(null);
        }
        const wrap = global.document.createElement('div');
        wrap.innerHTML = baselineHtml;
        var idx = buildTrimAwareCharIndex(wrap);
        if (!idx || !styleIndexTextMatches(idx.plain, baseText)) {
            return cacheStyleIndex(null);
        }
        return cacheStyleIndex(idx);
    }

    function getStyleSourceToken(styleIndex, baseToken) {
        if (!styleIndex || !baseToken) return null;
        if (styleIndex.sourceByBaseStart) {
            return styleIndex.sourceByBaseStart[baseToken.start] || null;
        }
        return baseToken;
    }

    function cloneStyledTokenHtml(styleIndex, baseToken, fallbackText, annotationMap, includeExistingAnnotations) {
        const sourceToken = getStyleSourceToken(styleIndex, baseToken);
        if (!sourceToken) {
            return includeExistingAnnotations
                ? wrapWithExistingAnnotation(fallbackText || '', baseToken ? baseToken.start : 0, annotationMap || {})
                : escapeHtml(fallbackText || '');
        }

        const inner = cloneRangeHtml(styleIndex.entries, sourceToken.start, sourceToken.end, fallbackText);
        if (includeExistingAnnotations) {
            return wrapWithExistingAnnotationHtml(
                inner,
                baseToken.start,
                annotationMap || {},
                String(fallbackText || '').length
            );
        }
        return inner;
    }

    function decodeBasicHtmlText(text) {
        return String(text || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");
    }

    function htmlToRangePlainText(html) {
        return decodeBasicHtmlText(
            String(html || '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
        ).replace(/\u00A0/g, ' ');
    }

    function previewHtmlToPlainText(html) {
        return decodeBasicHtmlText(
            String(html || '')
                .replace(/<\/(?:p|div|li)>/gi, '\n')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
        )
            .replace(/\u00A0/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^\n+|\n+$/g, '');
    }

    function clonedRangeMatchesFallback(html, fallbackText) {
        if (fallbackText == null) return true;
        return htmlToRangePlainText(html) === String(fallbackText || '').replace(/\u00A0/g, ' ');
    }

    function computeInsertedTokenRanges(original, corrected) {
        const revisedTokens = tokenizeDiffText(corrected);
        const baseTokens = tokenizeDiffText(original);
        const lcs = buildTokenLcs(baseTokens, revisedTokens);
        const ranges = [];

        let idx = 0;
        while (idx < revisedTokens.length) {
            if (lcs.commonRev.has(idx)) {
                idx++;
                continue;
            }

            const start = revisedTokens[idx].start;
            let end = revisedTokens[idx].end;
            let hasVisibleToken = revisedTokens[idx].type !== 'whitespace';

            idx++;
            while (idx < revisedTokens.length && !lcs.commonRev.has(idx)) {
                end = revisedTokens[idx].end;
                if (revisedTokens[idx].type !== 'whitespace') {
                    hasVisibleToken = true;
                }
                idx++;
            }

            if (!hasVisibleToken) {
                continue;
            }

            ranges.push({
                start,
                length: end - start,
                word: String(corrected || '').slice(start, end)
            });
        }

        return ranges;
    }

    function cloneRangeHtml(entries, start, end, fallbackText) {
        if (!entries || start >= end || start < 0 || end > entries.length) {
            return escapeHtml(fallbackText || '');
        }

        if (entries._richHtml && diffCore.renderRichTextRange) {
            const html = diffCore.renderRichTextRange(entries, start, end, fallbackText || '');
            return clonedRangeMatchesFallback(html, fallbackText)
                ? html
                : escapeHtml(fallbackText || '');
        }

        var doc = global.document;
        if (!doc) {
            return escapeHtml(fallbackText || '');
        }

        var parts = [];
        var i = start;
        while (i < end) {
            if (entries[i].newline) {
                parts.push('<br>');
                i++;
                continue;
            }
            var j = i;
            while (j < end && !entries[j].newline) {
                j++;
            }
            try {
                var range = doc.createRange();
                range.setStart(entries[i].node, entries[i].offset);
                range.setEnd(entries[j - 1].node, entries[j - 1].offset + 1);
                var host = doc.createElement('div');
                host.appendChild(range.cloneContents());
                parts.push(host.innerHTML);
            } catch (err) {
                return escapeHtml(fallbackText || '');
            }
            i = j;
        }
        const html = parts.join('');
        return clonedRangeMatchesFallback(html, fallbackText)
            ? html
            : escapeHtml(fallbackText || '');
    }

    function wrapWithExistingAnnotationHtml(htmlChunk, charOffset, annotationMap, plainTokenLength) {
        var plainLen = plainTokenLength || 0;
        if (!htmlChunk) {
            return '';
        }
        if (/\b(existing-del|existing-ins)\b/.test(htmlChunk)) {
            return htmlChunk;
        }
        var stripped = htmlChunk.replace(/<[^>]+>/g, '').trim();
        if (!stripped) {
            return htmlChunk;
        }

        var delCount = 0;
        var insCount = 0;
        var len = plainLen > 0 ? plainLen : stripped.length;
        for (var c = 0; c < len; c++) {
            var annotation = annotationMap[charOffset + c];
            if (annotation === 'del') delCount++;
            else if (annotation === 'ins') insCount++;
        }

        if (delCount > 0 && delCount >= insCount) {
            return '<span class="existing-del">' + htmlChunk + '</span>';
        }
        if (insCount > 0) {
            return '<span class="existing-ins">' + htmlChunk + '</span>';
        }
        return htmlChunk;
    }

    function cloneAnnotatedRangeHtml(entries, start, end, annotationMap, fallbackText) {
        if (!entries || start >= end || start < 0 || end > entries.length) {
            return wrapWithExistingAnnotation(fallbackText || '', start, annotationMap || {});
        }

        var html = '';
        var idx = start;
        while (idx < end) {
            if (entries[idx] && entries[idx].newline) {
                html += '<br>';
                idx++;
                continue;
            }

            var type = getExistingAnnotationType(annotationMap, idx);
            var segmentEnd = idx + 1;
            while (
                segmentEnd < end &&
                !(entries[segmentEnd] && entries[segmentEnd].newline) &&
                getExistingAnnotationType(annotationMap, segmentEnd) === type
            ) {
                segmentEnd++;
            }

            var fallbackChunk = (fallbackText || '').slice(idx - start, segmentEnd - start);
            var chunkHtml = cloneRangeHtml(entries, idx, segmentEnd, fallbackChunk);
            var plainChunk = (fallbackText || '').slice(idx - start, segmentEnd - start);
            html += plainChunk.trim() ? wrapExistingAnnotationHtml(type, chunkHtml) : chunkHtml;
            idx = segmentEnd;
        }

        return html;
    }

    function buildLineRanges(text) {
        const source = String(text || '');
        const ranges = [];
        let start = 0;

        source.split('\n').forEach(function (line) {
            ranges.push({ text: line, start: start, end: start + line.length });
            start += line.length + 1;
        });

        return ranges;
    }

    function getDishNamePrefixOffset(lineText, dishName) {
        const name = String(dishName || '').trim();
        if (!name) return null;

        const sourceLine = String(lineText || '');
        const leadingWhitespaceLength = (sourceLine.match(/^\s*/) || [''])[0].length;
        if (sourceLine.slice(leadingWhitespaceLength, leadingWhitespaceLength + name.length) !== name) {
            return null;
        }

        const remainder = sourceLine.slice(leadingWhitespaceLength + name.length);
        if (remainder && !/^[\s,;:|/)-]/.test(remainder) && !/^[-–—]/.test(remainder)) {
            return null;
        }

        return leadingWhitespaceLength;
    }

    function resolveDishNameFormattingRanges(text, anchors) {
        if (!Array.isArray(anchors) || anchors.length === 0) {
            return [];
        }

        const source = String(text || '');
        const lines = buildLineRanges(source);
        const ranges = [];
        const seen = {};

        anchors.forEach(function (anchor) {
            const dishName = String(anchor && anchor.dishName || '').trim();
            if (!dishName) return;

            const targetLineText = normalizeInlineText(anchor.lineText || '');
            let matchedLine = null;

            if (targetLineText) {
                const candidates = lines.filter(function (line) {
                    return normalizeInlineText(line.text) === targetLineText;
                });
                if (candidates.length === 1) {
                    matchedLine = candidates[0];
                } else if (candidates.length > 1 && Number.isInteger(anchor.lineNumber)) {
                    const lineByNumber = lines[anchor.lineNumber - 1];
                    if (lineByNumber && normalizeInlineText(lineByNumber.text) === targetLineText) {
                        matchedLine = lineByNumber;
                    }
                }
            }

            if (matchedLine) {
                const prefixOffset = getDishNamePrefixOffset(matchedLine.text, dishName);
                if (prefixOffset !== null) {
                    const start = matchedLine.start + prefixOffset;
                    const end = start + dishName.length;
                    const key = start + ':' + end;
                    if (!seen[key]) {
                        seen[key] = true;
                        ranges.push({ start: start, end: end, dishName: dishName });
                    }
                    return;
                }
            }

            const start = Number(anchor.start);
            const end = Number(anchor.end);
            if (
                Number.isInteger(start) &&
                Number.isInteger(end) &&
                end > start &&
                source.slice(start, end) === dishName
            ) {
                const key = start + ':' + end;
                if (!seen[key]) {
                    seen[key] = true;
                    ranges.push({ start: start, end: end, dishName: dishName });
                }
            }
        });

        return ranges.sort(function (a, b) {
            return a.start - b.start || a.end - b.end;
        });
    }

    function getMeaningfulTokenValues(text) {
        return tokenizeDiffText(text)
            .map(function (token) {
                return String(token.value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
            })
            .filter(function (value) {
                return value.length > 1;
            });
    }

    function normalizeStructuralLineForDiff(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function areLinesSimilarEnoughForTokenDiff(baseLine, revisedLine) {
        const baseValues = Array.from(new Set(getMeaningfulTokenValues(baseLine)));
        const revisedValues = Array.from(new Set(getMeaningfulTokenValues(revisedLine)));
        if (!baseValues.length || !revisedValues.length) {
            return normalizeStructuralLineForDiff(baseLine) === normalizeStructuralLineForDiff(revisedLine);
        }

        const revisedSet = new Set(revisedValues);
        const shared = baseValues.filter(function (value) {
            return revisedSet.has(value);
        }).length;
        const overlap = shared / Math.min(baseValues.length, revisedValues.length);

        return overlap >= 0.35;
    }

    function shouldAlignLinesForTokenDiff(baseLine, revisedLine) {
        const baseText = String(baseLine || '');
        const revisedText = String(revisedLine || '');
        const baseTrimmed = baseText.trim();
        const revisedTrimmed = revisedText.trim();

        if (!baseTrimmed || !revisedTrimmed) {
            return !baseTrimmed && !revisedTrimmed;
        }

        return areLinesSimilarEnoughForTokenDiff(baseText, revisedText);
    }

    function buildLineLcs(baseLines, revisedLines) {
        const rows = baseLines.length + 1;
        const cols = revisedLines.length + 1;
        const table = Array.from({ length: rows }, function () {
            return Array(cols).fill(0);
        });

        for (let i = baseLines.length - 1; i >= 0; i--) {
            for (let j = revisedLines.length - 1; j >= 0; j--) {
                if (shouldAlignLinesForTokenDiff(baseLines[i].text, revisedLines[j].text)) {
                    table[i][j] = table[i + 1][j + 1] + 1;
                } else {
                    table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
                }
            }
        }

        const matches = [];
        let i = 0;
        let j = 0;
        while (i < baseLines.length && j < revisedLines.length) {
            if (shouldAlignLinesForTokenDiff(baseLines[i].text, revisedLines[j].text)) {
                matches.push({ baseIndex: i, revisedIndex: j });
                i++;
                j++;
            } else if (table[i + 1][j] >= table[i][j + 1]) {
                i++;
            } else {
                j++;
            }
        }

        return matches;
    }

    function isWhitespaceDiffToken(token) {
        return !!token && token.type === 'whitespace';
    }

    function buildPreviewTokenLcs(baseTokens, revisedTokens) {
        const rawLcs = buildTokenLcs(baseTokens, revisedTokens);
        const rawBaseIndexes = Array.from(rawLcs.commonBase).sort(function (a, b) { return a - b; });
        const rawRevisedIndexes = Array.from(rawLcs.commonRev).sort(function (a, b) { return a - b; });
        const commonBase = new Set();
        const commonRev = new Set();

        function pairHasAdjacentNonWhitespaceNeighbor(pairIndex, direction) {
            const neighborIndex = pairIndex + direction;
            if (neighborIndex < 0 || neighborIndex >= rawBaseIndexes.length || neighborIndex >= rawRevisedIndexes.length) {
                return false;
            }

            const baseIndex = rawBaseIndexes[pairIndex];
            const revisedIndex = rawRevisedIndexes[pairIndex];
            const neighborBaseIndex = rawBaseIndexes[neighborIndex];
            const neighborRevisedIndex = rawRevisedIndexes[neighborIndex];
            const neighborBaseToken = baseTokens[neighborBaseIndex];
            const neighborRevisedToken = revisedTokens[neighborRevisedIndex];

            if (isWhitespaceDiffToken(neighborBaseToken) || isWhitespaceDiffToken(neighborRevisedToken)) {
                return false;
            }

            if (direction < 0) {
                return neighborBaseIndex + 1 === baseIndex && neighborRevisedIndex + 1 === revisedIndex;
            }
            return baseIndex + 1 === neighborBaseIndex && revisedIndex + 1 === neighborRevisedIndex;
        }

        rawBaseIndexes.forEach(function (baseIndex, pairIndex) {
            if (pairIndex >= rawRevisedIndexes.length) return;
            const revisedIndex = rawRevisedIndexes[pairIndex];
            const baseToken = baseTokens[baseIndex];
            const revisedToken = revisedTokens[revisedIndex];
            const isWhitespacePair = isWhitespaceDiffToken(baseToken) && isWhitespaceDiffToken(revisedToken);

            if (
                !isWhitespacePair ||
                pairHasAdjacentNonWhitespaceNeighbor(pairIndex, -1) ||
                pairHasAdjacentNonWhitespaceNeighbor(pairIndex, 1)
            ) {
                commonBase.add(baseIndex);
                commonRev.add(revisedIndex);
            }
        });

        return { commonBase, commonRev };
    }

    function renderPersistentPreview(baseText, revisedText, options) {
        const settings = options || {};
        const annotationMap = settings.annotationMap || {};
        const revisedAnnotationMap = settings.revisedAnnotationMap || {};
        const includeExistingAnnotations = !!settings.includeExistingAnnotations;
        const baselineHtml = settings.baselineHtml || '';
        const revisedHtml = settings.revisedHtml || '';

        var styleIndex = null;
        if (baselineHtml) {
            styleIndex = getStyleIndexForBaseline(baselineHtml, baseText);
        }

        var revisedStyleIndex = null;
        if (revisedHtml) {
            revisedStyleIndex = getStyleIndexForBaseline(revisedHtml, revisedText);
        }

        let insertions = 0;
        let deletions = 0;
        let html = '';

        function cloneStyledTokenFromIndex(tokenStyleIndex, token, fallbackText) {
            if (!tokenStyleIndex || !token || !getStyleSourceToken(tokenStyleIndex, token)) {
                return '';
            }
            return cloneStyledTokenHtml(tokenStyleIndex, token, fallbackText, {}, false);
        }

        function renderAcceptedTokenHtml(baseToken, revisedToken, fallbackText) {
            let tokenHtml = cloneStyledTokenFromIndex(revisedStyleIndex, revisedToken, fallbackText);
            let hasStyledHtml = !!tokenHtml;
            if (!tokenHtml) {
                tokenHtml = cloneStyledTokenFromIndex(styleIndex, baseToken, fallbackText);
                hasStyledHtml = !!tokenHtml;
            }
            if (!tokenHtml) {
                tokenHtml = escapeHtml(fallbackText || '');
            }

            if (includeExistingAnnotations && baseToken) {
                if (!hasStyledHtml) {
                    return wrapWithExistingAnnotation(fallbackText || '', baseToken.start, annotationMap);
                }
                return wrapWithExistingAnnotationHtml(
                    tokenHtml,
                    baseToken.start,
                    annotationMap,
                    String(fallbackText || '').length
                );
            }

            return tokenHtml;
        }

        function renderRevisedTokenHtml(revisedToken, fallbackText) {
            const tokenHtml = cloneStyledTokenFromIndex(revisedStyleIndex, revisedToken, fallbackText);
            return tokenHtml || escapeHtml(fallbackText || '');
        }

        function renderWholeLineDeletion(baseSegment, baseOffset) {
            if (!String(baseSegment || '').trim()) {
                return escapeHtml(baseSegment || '');
            }
            const delInner = styleIndex && styleIndex.entries
                ? cloneRangeHtml(styleIndex.entries, baseOffset, baseOffset + baseSegment.length, baseSegment)
                : escapeHtml(baseSegment);
            deletions++;
            return '<span class="persistent-del">' + delInner + '</span>';
        }

        function renderWholeLineInsertion(revisedSegment, revisedOffset) {
            if (!String(revisedSegment || '').trim()) {
                return escapeHtml(revisedSegment || '');
            }
            let insInner = '';
            tokenizeDiffText(revisedSegment).forEach(function (token) {
                const adjustedToken = {
                    ...token,
                    start: revisedOffset + token.start,
                    end: revisedOffset + token.end,
                };
                insInner += token.value.trim()
                    ? renderRevisedTokenHtml(adjustedToken, token.value)
                    : escapeHtml(token.value);
            });
            insertions++;
            return '<span class="persistent-ins">' + (insInner || escapeHtml(revisedSegment)) + '</span>';
        }

        function appendPreviewLine(lines, lineHtml) {
            lines.push(lineHtml || '');
        }

        function appendUnmatchedLines(lines, baseStart, baseEnd, revisedStart, revisedEnd) {
            for (let revisedIndex = revisedStart; revisedIndex < revisedEnd; revisedIndex++) {
                if (String(revisedLines[revisedIndex].text || '').trim()) {
                    appendPreviewLine(
                        lines,
                        renderWholeLineInsertion(revisedLines[revisedIndex].text, revisedLines[revisedIndex].start)
                    );
                }
            }

            for (let baseIndex = baseStart; baseIndex < baseEnd; baseIndex++) {
                if (String(baseLines[baseIndex].text || '').trim()) {
                    appendPreviewLine(lines, renderWholeLineDeletion(baseLines[baseIndex].text, baseLines[baseIndex].start));
                }
            }
        }

        function renderTokenDiff(baseSegment, revisedSegment, baseOffset, revisedOffset) {
            if (
                String(baseSegment || '').trim() &&
                String(revisedSegment || '').trim() &&
                !areLinesSimilarEnoughForTokenDiff(baseSegment, revisedSegment)
            ) {
                return [
                    renderWholeLineInsertion(revisedSegment, revisedOffset),
                    renderWholeLineDeletion(baseSegment, baseOffset)
                ].join('<br>');
            }

            const hasRevisedAnnotationMap = !!(
                revisedAnnotationMap &&
                Object.keys(revisedAnnotationMap).some(function (key) {
                    return Number.isInteger(Number(key));
                })
            );
            const shouldUseAnnotatedTokens = includeExistingAnnotations && hasRevisedAnnotationMap;
            const baseTokens = shouldUseAnnotatedTokens
                ? tokenizeAnnotatedDiffText(baseSegment, baseOffset, annotationMap)
                : tokenizeDiffText(baseSegment);
            const revisedTokens = shouldUseAnnotatedTokens
                ? tokenizeAnnotatedDiffText(revisedSegment, revisedOffset, revisedAnnotationMap)
                : tokenizeDiffText(revisedSegment);
            const lcs = buildPreviewTokenLcs(baseTokens, revisedTokens);
            let segmentHtml = '';

            function globalBaseToken(token) {
                if (!token) return token;
                return {
                    ...token,
                    start: baseOffset + token.start,
                    end: baseOffset + token.end,
                };
            }

            function globalRevisedToken(token) {
                if (!token) return token;
                return {
                    ...token,
                    start: revisedOffset + token.start,
                    end: revisedOffset + token.end,
                };
            }

            function tokenSliceText(tokens) {
                return tokens.map(function (token) {
                    return token ? token.value : '';
                }).join('');
            }

            function visibleTokenCount(tokens) {
                return tokens.filter(function (token) {
                    return token && token.value && token.value.trim();
                }).length;
            }

            function renderDeletedTokens(tokens) {
                let output = '';
                tokens.forEach(function (baseTok) {
                    const adjustedBaseTok = globalBaseToken(baseTok);
                    if (baseTok && baseTok.value.trim()) {
                        const delInner = styleIndex
                            ? cloneStyledTokenHtml(styleIndex, adjustedBaseTok, baseTok.value, annotationMap, false)
                            : escapeHtml(baseTok.value);
                        output += '<span class="persistent-del">' + delInner + '</span>';
                        deletions++;
                    } else {
                        output += escapeHtml(baseTok ? baseTok.value : '');
                    }
                });
                return output;
            }

            function renderInsertedTokens(tokens) {
                let output = '';
                tokens.forEach(function (revTok) {
                    const adjustedRevTok = globalRevisedToken(revTok);
                    if (revTok && revTok.value.trim()) {
                        output += '<span class="persistent-ins">' +
                            renderRevisedTokenHtml(adjustedRevTok, revTok.value) +
                            '</span>';
                        insertions++;
                    } else {
                        output += escapeHtml(revTok ? revTok.value : '');
                    }
                });
                return output;
            }

            function needsReplacementSeparator(deletedTokens, insertedTokens) {
                const deletedText = tokenSliceText(deletedTokens);
                const insertedText = tokenSliceText(insertedTokens);
                if (!deletedText.trim() || !insertedText.trim()) {
                    return false;
                }
                if (/\s$/u.test(deletedText) || /^\s/u.test(insertedText)) {
                    return false;
                }
                return /\s/u.test(deletedText.trim()) ||
                    /\s/u.test(insertedText.trim()) ||
                    visibleTokenCount(deletedTokens) > 1 ||
                    visibleTokenCount(insertedTokens) > 1;
            }

            function renderChangedTokenRun(baseStart, baseEnd, revisedStart, revisedEnd) {
                const deletedTokens = baseTokens.slice(baseStart, baseEnd);
                const insertedTokens = revisedTokens.slice(revisedStart, revisedEnd);
                return renderDeletedTokens(deletedTokens) +
                    (needsReplacementSeparator(deletedTokens, insertedTokens) ? ' ' : '') +
                    renderInsertedTokens(insertedTokens);
            }

            const commonBaseIndexes = Array.from(lcs.commonBase).sort(function (a, b) { return a - b; });
            const commonRevisedIndexes = Array.from(lcs.commonRev).sort(function (a, b) { return a - b; });
            let baseCursor = 0;
            let revisedCursor = 0;

            commonBaseIndexes.forEach(function (baseIndex, pairIndex) {
                if (pairIndex >= commonRevisedIndexes.length) return;
                const revisedIndex = commonRevisedIndexes[pairIndex];
                const baseTok = baseTokens[baseIndex];
                const revTok = revisedTokens[revisedIndex];

                segmentHtml += renderChangedTokenRun(baseCursor, baseIndex, revisedCursor, revisedIndex);
                segmentHtml += renderAcceptedTokenHtml(
                    globalBaseToken(baseTok),
                    globalRevisedToken(revTok),
                    revTok ? revTok.value : ''
                );
                baseCursor = baseIndex + 1;
                revisedCursor = revisedIndex + 1;
            });

            segmentHtml += renderChangedTokenRun(
                baseCursor,
                baseTokens.length,
                revisedCursor,
                revisedTokens.length
            );

            return segmentHtml;
        }

        const baseLines = buildLineRanges(baseText);
        const revisedLines = buildLineRanges(revisedText);
        if (baseLines.length > 1 || revisedLines.length > 1) {
            const lineMatches = buildLineLcs(baseLines, revisedLines);
            const renderedLines = [];
            let baseIndex = 0;
            let revisedIndex = 0;

            lineMatches.forEach(function (match) {
                appendUnmatchedLines(renderedLines, baseIndex, match.baseIndex, revisedIndex, match.revisedIndex);
                appendPreviewLine(
                    renderedLines,
                    renderTokenDiff(
                        baseLines[match.baseIndex].text,
                        revisedLines[match.revisedIndex].text,
                        baseLines[match.baseIndex].start,
                        revisedLines[match.revisedIndex].start
                    )
                );
                baseIndex = match.baseIndex + 1;
                revisedIndex = match.revisedIndex + 1;
            });

            appendUnmatchedLines(renderedLines, baseIndex, baseLines.length, revisedIndex, revisedLines.length);
            html = renderedLines.join('<br>');
        } else {
            html = renderTokenDiff(baseText, revisedText, 0, 0);
        }

        return { html, insertions, deletions };
    }

    const api = {
        escapeHtml,
        normalizeExtractedLines,
        extractCleanTextFromElement,
        tokenizeDiffText,
        diffTokensEqual,
        buildTokenLcs,
        projectRichTextHtml,
        buildAnnotationMapFromParagraphAnnotations,
        buildAnnotationMapFromDOM,
        buildAnnotationMapFromHtml,
        htmlLinesToParagraphs,
        stripTransientReviewHighlights,
        stripLeadingEmptyBlocks,
        stripExistingAnnotationsForEditor,
        buildRevisionComparisonFromAnnotatedHtml,
        buildRevisionComparisonFromAnnotatedPreview,
        previewHtmlToPlainText,
        computeInsertedTokenRanges,
        restoreLeadingBoldFromSource,
        buildEditableHtmlFromBaseline,
        resolveDishNameFormattingRanges,
        wrapWithExistingAnnotation,
        stripExistingDeletions,
        buildExistingDeletionAnchors,
        buildExistingAnnotationGroups,
        createBaselineOffsetMapper,
        reinsertExistingDeletions,
        resolveExistingAnnotationRevisions,
        buildTrimAwareCharIndex,
        renderPersistentPreview
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.MenuRedlinePreview = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

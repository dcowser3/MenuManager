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
            const text = (child.innerText || '')
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

    function buildExistingDeletionAnchors(baseText, annotationMap) {
        const source = String(baseText || '');
        const anchors = [];
        let cleanOffset = 0;
        let i = 0;

        while (i < source.length) {
            if (annotationMap[i] === 'del') {
                let text = '';
                const offset = cleanOffset;
                while (i < source.length && annotationMap[i] === 'del') {
                    text += source[i];
                    i++;
                }
                if (text) {
                    anchors.push({ offset: offset, text: text });
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
            while (i < source.length && getExistingAnnotationType(annotationMap || {}, i)) {
                const currentType = getExistingAnnotationType(annotationMap || {}, i);
                if (currentType === 'del') {
                    delText += source[i];
                } else {
                    insText += source[i];
                    cleanOffset++;
                }
                i++;
            }

            groups.push({
                index: groups.length,
                start: start,
                end: i,
                cleanStart: cleanStart,
                cleanEnd: cleanOffset,
                delText: delText,
                insText: insText,
                previewText: source.slice(start, i)
            });
        }

        return groups;
    }

    function groupWasRevertedToOriginal(group, cleanBaseText, revisedText) {
        const revised = String(revisedText || '');
        const offset = mapBaselineOffsetToRevisedOffset(cleanBaseText, revised, group.cleanStart);

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

    function reinsertExistingDeletionsForGroups(cleanBaseText, revisedText, groups, revertedIndexes) {
        const cleanBase = String(cleanBaseText || '');
        const reverted = revertedIndexes || new Set();
        const inserts = [];

        groups.forEach(function (group) {
            if (!group.delText || reverted.has(group.index)) {
                return;
            }

            const offset = mapBaselineOffsetToRevisedOffset(cleanBase, revisedText, group.cleanStart);
            if (String(revisedText || '').slice(offset, offset + group.delText.length) === group.delText) {
                return;
            }

            inserts.push({
                idx: group.index,
                text: group.delText,
                offset: offset
            });
        });

        inserts.sort(function (a, b) {
            if (a.offset !== b.offset) return b.offset - a.offset;
            return b.idx - a.idx;
        });

        let output = String(revisedText || '');
        inserts.forEach(function (insert) {
            output = output.slice(0, insert.offset) + insert.text + output.slice(insert.offset);
        });
        return output;
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

    function mapBaselineOffsetToRevisedOffset(baseText, revisedText, offset) {
        const base = String(baseText || '');
        const revised = String(revisedText || '');
        const target = Math.max(0, Math.min(offset || 0, base.length));

        if (target <= 0) return 0;
        if (target >= base.length) return revised.length;

        const baseTokens = tokenizeDiffText(base);
        const revisedTokens = tokenizeDiffText(revised);
        if (!baseTokens.length || !revisedTokens.length) {
            return Math.max(0, Math.min(target, revised.length));
        }

        const lcs = buildTokenLcs(baseTokens, revisedTokens);
        const commonBase = baseTokens.filter(function (_token, idx) {
            return lcs.commonBase.has(idx);
        });
        const commonRevised = revisedTokens.filter(function (_token, idx) {
            return lcs.commonRev.has(idx);
        });

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

        const inserts = anchors.map(function (anchor, idx) {
            return {
                idx: idx,
                text: anchor.text,
                offset: mapBaselineOffsetToRevisedOffset(cleanBase, revised, anchor.offset)
            };
        }).sort(function (a, b) {
            if (a.offset !== b.offset) return b.offset - a.offset;
            return b.idx - a.idx;
        });

        let output = revised;
        inserts.forEach(function (insert) {
            output = output.slice(0, insert.offset) + insert.text + output.slice(insert.offset);
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

        groups.forEach(function (group) {
            if (groupWasRevertedToOriginal(group, cleanBase, revised)) {
                revertedIndexes.add(group.index);
            }
        });

        if (!revertedIndexes.size) {
            return {
                basePreviewText: previewBase,
                revisedPreviewText: reinsertExistingDeletionsForGroups(cleanBase, revised, groups, revertedIndexes),
                annotationMap: annotations,
                baselineHtml: settings.baselineHtml || ''
            };
        }

        const resolvedBase = buildResolvedBasePreview(previewBase, annotations, groups, revertedIndexes);
        return {
            basePreviewText: resolvedBase.text,
            revisedPreviewText: reinsertExistingDeletionsForGroups(cleanBase, revised, groups, revertedIndexes),
            annotationMap: resolvedBase.annotationMap,
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

    var baselineStyleCache = { html: '', text: '', index: null };

    function normalizeStyleIndexText(text) {
        return String(text == null ? '' : text)
            .replace(/\u00A0/g, ' ')
            .replace(/\r\n?/g, '\n');
    }

    function styleIndexTextMatches(indexPlain, baseText) {
        const source = String(indexPlain == null ? '' : indexPlain);
        const target = String(baseText == null ? '' : baseText);
        return source.length === target.length &&
            normalizeStyleIndexText(source) === normalizeStyleIndexText(target);
    }

    function getStyleIndexForBaseline(baselineHtml, baseText) {
        if (!baselineHtml || baseText == null) {
            return null;
        }
        if (baselineStyleCache.html === baselineHtml && baselineStyleCache.text === baseText && baselineStyleCache.index) {
            return baselineStyleCache.index;
        }
        if (diffCore.createRichTextIndexFromHtml) {
            var richIdx = diffCore.createRichTextIndexFromHtml(baselineHtml);
            if (richIdx && styleIndexTextMatches(richIdx.plain, baseText)) {
                baselineStyleCache = { html: baselineHtml, text: baseText, index: richIdx };
                return richIdx;
            }
        }
        if (!global.document) {
            baselineStyleCache = { html: baselineHtml, text: baseText, index: null };
            return null;
        }
        const wrap = global.document.createElement('div');
        wrap.innerHTML = baselineHtml;
        var idx = buildTrimAwareCharIndex(wrap);
        if (!idx || !styleIndexTextMatches(idx.plain, baseText)) {
            baselineStyleCache = { html: baselineHtml, text: baseText, index: null };
            return null;
        }
        baselineStyleCache = { html: baselineHtml, text: baseText, index: idx };
        return idx;
    }

    function cloneRangeHtml(entries, start, end, fallbackText) {
        if (!entries || start >= end || start < 0 || end > entries.length) {
            return escapeHtml(fallbackText || '');
        }

        if (entries._richHtml && diffCore.renderRichTextRange) {
            return diffCore.renderRichTextRange(entries, start, end, fallbackText || '');
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
        return parts.join('');
    }

    function wrapWithExistingAnnotationHtml(htmlChunk, charOffset, annotationMap, plainTokenLength) {
        var plainLen = plainTokenLength || 0;
        if (!htmlChunk) {
            return '';
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

    function renderPersistentPreview(baseText, revisedText, options) {
        const settings = options || {};
        const annotationMap = settings.annotationMap || {};
        const includeExistingAnnotations = !!settings.includeExistingAnnotations;
        const baselineHtml = settings.baselineHtml || '';

        var styleIndex = null;
        if (baselineHtml) {
            styleIndex = getStyleIndexForBaseline(baselineHtml, baseText);
        }

        const baseTokens = tokenizeDiffText(baseText);
        const revisedTokens = tokenizeDiffText(revisedText);
        const lcs = buildTokenLcs(baseTokens, revisedTokens);

        let insertions = 0;
        let deletions = 0;
        let html = '';
        let i = 0;
        let j = 0;

        while (i < baseTokens.length || j < revisedTokens.length) {
            const baseTok = i < baseTokens.length ? baseTokens[i] : null;
            const revTok = j < revisedTokens.length ? revisedTokens[j] : null;
            const baseCommon = i < baseTokens.length && lcs.commonBase.has(i);
            const revCommon = j < revisedTokens.length && lcs.commonRev.has(j);
            const sameToken =
                baseTok !== null &&
                revTok !== null &&
                diffTokensEqual(baseTok, revTok);

            if (baseCommon && revCommon && sameToken) {
                if (styleIndex) {
                    if (includeExistingAnnotations && baseTok) {
                        html += cloneAnnotatedRangeHtml(
                            styleIndex.entries,
                            baseTok.start,
                            baseTok.end,
                            annotationMap,
                            revTok.value
                        );
                    } else {
                        const inner = cloneRangeHtml(styleIndex.entries, baseTok.start, baseTok.end, revTok.value);
                        html += inner;
                    }
                } else if (includeExistingAnnotations && baseTok) {
                    html += wrapWithExistingAnnotation(revTok.value, baseTok.start, annotationMap);
                } else {
                    html += escapeHtml(revTok.value);
                }
                i++;
                j++;
                continue;
            }

            if (i < baseTokens.length && !baseCommon) {
                if (baseTok && baseTok.value.trim()) {
                    const delInner = styleIndex
                        ? cloneRangeHtml(styleIndex.entries, baseTok.start, baseTok.end, baseTok.value)
                        : escapeHtml(baseTok.value);
                    html += '<span class="persistent-del">' + delInner + '</span>';
                    deletions++;
                } else {
                    html += escapeHtml(baseTok ? baseTok.value : '');
                }
                i++;
                continue;
            }

            if (j < revisedTokens.length && !revCommon) {
                if (revTok && revTok.value.trim()) {
                    html += '<span class="persistent-ins">' + escapeHtml(revTok.value) + '</span>';
                    insertions++;
                } else {
                    html += escapeHtml(revTok ? revTok.value : '');
                }
                j++;
                continue;
            }

            if (j < revisedTokens.length) {
                html += escapeHtml(revTok ? revTok.value : '');
                j++;
            }
            if (i < baseTokens.length) {
                i++;
            }
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
        stripExistingAnnotationsForEditor,
        buildEditableHtmlFromBaseline,
        wrapWithExistingAnnotation,
        stripExistingDeletions,
        buildExistingDeletionAnchors,
        buildExistingAnnotationGroups,
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

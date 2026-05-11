(function (global) {
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
        if (!element || !element.children) return '';

        for (const child of element.children) {
            const text = (child.innerText || '')
                .replace(/\u00A0/g, ' ')
                .trim();
            lines.push(text);
        }

        return normalizeExtractedLines(lines);
    }

    function normalizeDiffTokenValue(value) {
        const normalized = (value || '').normalize('NFC').replace(/[\u2018\u2019`]/g, "'");
        if (/^\s+$/.test(normalized)) return ' ';
        return normalized;
    }

    function getDiffTokenType(value) {
        if (/^\s+$/u.test(value)) return 'whitespace';
        if (/^[\p{L}\p{N}]+(?:['’`][\p{L}\p{N}]+)*$/u.test(value)) return 'word';
        if (/^[-,./|:]$/u.test(value)) return 'separator';
        return 'punctuation';
    }

    function tokenizeDiffText(text) {
        const source = text || '';
        const tokenPattern = /\s+|[\p{L}\p{N}]+(?:['’`][\p{L}\p{N}]+)*|[^\s]/gu;
        const tokens = [];
        let match;

        while ((match = tokenPattern.exec(source)) !== null) {
            const value = match[0];
            tokens.push({
                value,
                start: match.index,
                end: match.index + value.length,
                type: getDiffTokenType(value),
                normalized: normalizeDiffTokenValue(value)
            });
        }

        return tokens;
    }

    function diffTokensEqual(left, right) {
        if (!left || !right) return false;
        return left.normalized === right.normalized;
    }

    function buildTokenLcs(baseTokens, revisedTokens) {
        const m = baseTokens.length;
        const n = revisedTokens.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = m - 1; i >= 0; i--) {
            for (let j = n - 1; j >= 0; j--) {
                if (diffTokensEqual(baseTokens[i], revisedTokens[j])) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        const commonBase = new Set();
        const commonRev = new Set();
        let i = 0;
        let j = 0;

        while (i < m && j < n) {
            if (diffTokensEqual(baseTokens[i], revisedTokens[j])) {
                commonBase.add(i);
                commonRev.add(j);
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                i++;
            } else {
                j++;
            }
        }

        return { commonBase, commonRev };
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

    function wrapWithExistingAnnotation(token, charOffset, annotationMap) {
        if (!token || !token.trim()) return escapeHtml(token || '');

        let delCount = 0;
        let insCount = 0;
        for (let c = 0; c < token.length; c++) {
            const annotation = annotationMap[charOffset + c];
            if (annotation === 'del') delCount++;
            else if (annotation === 'ins') insCount++;
        }

        if (delCount > 0 && delCount >= insCount) {
            return '<span class="existing-del">' + escapeHtml(token) + '</span>';
        }
        if (insCount > 0) {
            return '<span class="existing-ins">' + escapeHtml(token) + '</span>';
        }
        return escapeHtml(token);
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

    function getStyleIndexForBaseline(baselineHtml, baseText) {
        if (!baselineHtml || baseText == null || !global.document) {
            return null;
        }
        if (baselineStyleCache.html === baselineHtml && baselineStyleCache.text === baseText && baselineStyleCache.index) {
            return baselineStyleCache.index;
        }
        const wrap = global.document.createElement('div');
        wrap.innerHTML = baselineHtml;
        var idx = buildTrimAwareCharIndex(wrap);
        if (!idx || idx.plain !== baseText) {
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
                    const inner = cloneRangeHtml(styleIndex.entries, baseTok.start, baseTok.end, revTok.value);
                    if (includeExistingAnnotations && baseTok) {
                        html += wrapWithExistingAnnotationHtml(inner, baseTok.start, annotationMap, baseTok.value.length);
                    } else {
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
        buildAnnotationMapFromParagraphAnnotations,
        buildAnnotationMapFromDOM,
        buildAnnotationMapFromHtml,
        wrapWithExistingAnnotation,
        stripExistingDeletions,
        buildExistingDeletionAnchors,
        reinsertExistingDeletions,
        buildTrimAwareCharIndex,
        renderPersistentPreview
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.MenuRedlinePreview = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

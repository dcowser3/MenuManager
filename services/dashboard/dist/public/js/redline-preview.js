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

    function renderPersistentPreview(baseText, revisedText, options) {
        const settings = options || {};
        const annotationMap = settings.annotationMap || {};
        const includeExistingAnnotations = !!settings.includeExistingAnnotations;
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
                if (includeExistingAnnotations && baseTok) {
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
                    html += '<span class="persistent-del">' + escapeHtml(baseTok.value) + '</span>';
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
        renderPersistentPreview
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.MenuRedlinePreview = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

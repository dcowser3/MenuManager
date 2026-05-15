(function (global) {
    const blockTags = new Set([
        'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
        'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
        'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p',
        'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
        'ul'
    ]);

    function normalizeDiffTokenValue(value) {
        const normalized = (value || '').normalize('NFC').replace(/[\u2018\u2019`]/g, "'");
        if (/^\s+$/.test(normalized)) return ' ';
        return normalized;
    }

    function getDiffTokenType(value) {
        if (/^\s+$/u.test(value)) return 'whitespace';
        if (/^[\p{L}\p{N}]+(?:['\u2019`][\p{L}\p{N}]+)*$/u.test(value)) return 'word';
        if (/^[-,./|:]$/u.test(value)) return 'separator';
        return 'punctuation';
    }

    function tokenizeDiffText(text) {
        const source = text || '';
        const tokenPattern = /\s+|[\p{L}\p{N}]+(?:['\u2019`][\p{L}\p{N}]+)*|[^\s]/gu;
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

    function tokenizeWords(text) {
        return tokenizeDiffText(text || '')
            .filter(function (token) { return token.type === 'word'; })
            .map(function (token) { return token.value; });
    }

    function diffTokensEqual(left, right) {
        if (!left || !right) return false;
        return left.normalized === right.normalized;
    }

    function buildTokenLcs(baseTokens, revisedTokens) {
        const m = baseTokens.length;
        const n = revisedTokens.length;
        const dp = Array(m + 1).fill(null).map(function () {
            return Array(n + 1).fill(0);
        });

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

    function pushEdit(edits, type, token) {
        const last = edits[edits.length - 1];
        if (last && last.type === type) {
            last.tokens.push(token);
            return;
        }
        edits.push({ type, tokens: [token] });
    }

    function buildTokenEdits(baseTokens, revisedTokens) {
        const lcs = buildTokenLcs(baseTokens, revisedTokens);
        const edits = [];
        let i = 0;
        let j = 0;

        while (i < baseTokens.length || j < revisedTokens.length) {
            const baseTok = i < baseTokens.length ? baseTokens[i] : null;
            const revTok = j < revisedTokens.length ? revisedTokens[j] : null;
            const baseCommon = i < baseTokens.length && lcs.commonBase.has(i);
            const revCommon = j < revisedTokens.length && lcs.commonRev.has(j);

            if (baseCommon && revCommon && diffTokensEqual(baseTok, revTok)) {
                pushEdit(edits, 'equal', revTok);
                i++;
                j++;
                continue;
            }

            if (i < baseTokens.length && !baseCommon) {
                pushEdit(edits, 'delete', baseTok);
                i++;
                continue;
            }

            if (j < revisedTokens.length && !revCommon) {
                pushEdit(edits, 'insert', revTok);
                j++;
                continue;
            }

            if (j < revisedTokens.length) {
                pushEdit(edits, 'insert', revTok);
                j++;
            }
            if (i < baseTokens.length) {
                pushEdit(edits, 'delete', baseTok);
                i++;
            }
        }

        return edits;
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function decodeHtmlEntity(entity) {
        const named = {
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' '
        };
        if (Object.prototype.hasOwnProperty.call(named, entity)) {
            return named[entity];
        }
        if (/^#x[0-9a-f]+$/i.test(entity)) {
            return String.fromCodePoint(parseInt(entity.slice(2), 16));
        }
        if (/^#[0-9]+$/.test(entity)) {
            return String.fromCodePoint(parseInt(entity.slice(1), 10));
        }
        return '&' + entity + ';';
    }

    function decodeHtmlText(text) {
        return String(text || '').replace(/&([a-zA-Z][\w-]*|#x[0-9a-fA-F]+|#[0-9]+);/g, function (_match, entity) {
            return decodeHtmlEntity(entity);
        }).replace(/\u00A0/g, ' ');
    }

    function getTagName(tagHtml) {
        const match = String(tagHtml || '').match(/^<\/?\s*([a-zA-Z0-9:-]+)/);
        return match ? match[1].toLowerCase() : '';
    }

    function closeTagFor(openTag) {
        const name = getTagName(openTag);
        return name ? '</' + name + '>' : '';
    }

    function pushRichLine(lines, lineEntries) {
        const source = lineEntries || [];
        let start = 0;
        let end = source.length;

        while (start < end && /^\s$/.test(source[start].ch || '')) start++;
        while (end > start && /^\s$/.test(source[end - 1].ch || '')) end--;

        lines.push(source.slice(start, end));
    }

    function normalizeRichLines(lines) {
        const normalized = Array.isArray(lines) ? lines.slice() : [];

        while (normalized.length && normalized[0].length === 0) normalized.shift();
        while (normalized.length && normalized[normalized.length - 1].length === 0) normalized.pop();

        const output = [];
        let prevEmpty = false;
        normalized.forEach(function (line) {
            if (!line.length) {
                if (!prevEmpty) output.push(line);
                prevEmpty = true;
            } else {
                output.push(line);
                prevEmpty = false;
            }
        });

        return output;
    }

    function createRichTextIndexFromHtml(html) {
        const source = String(html || '');
        const pieces = source.match(/<!--[\s\S]*?-->|<\/?[^>]+>|[^<]+/g) || [];
        const lines = [];
        let lineEntries = [];
        const activeTags = [];
        let sawBlock = false;

        function finishLine(force) {
            if (force || lineEntries.length) {
                pushRichLine(lines, lineEntries);
                lineEntries = [];
            }
        }

        pieces.forEach(function (piece) {
            if (!piece) return;
            if (piece.indexOf('<!--') === 0) return;

            if (piece[0] === '<') {
                const tagName = getTagName(piece);
                if (!tagName) return;

                const isClosing = /^<\//.test(piece);
                const isSelfClosing = /\/\s*>$/.test(piece) || tagName === 'br' || tagName === 'hr';

                if (tagName === 'br') {
                    finishLine(true);
                    return;
                }

                if (blockTags.has(tagName)) {
                    if (isClosing || isSelfClosing) {
                        finishLine(sawBlock);
                        sawBlock = true;
                    } else {
                        if (lineEntries.length) finishLine(true);
                        sawBlock = true;
                    }
                    return;
                }

                if (isClosing) {
                    for (let i = activeTags.length - 1; i >= 0; i--) {
                        if (activeTags[i].name === tagName) {
                            activeTags.splice(i, 1);
                            break;
                        }
                    }
                    return;
                }

                if (!isSelfClosing) {
                    activeTags.push({ name: tagName, open: piece });
                }
                return;
            }

            const text = decodeHtmlText(piece);
            for (let i = 0; i < text.length; i++) {
                lineEntries.push({
                    ch: text[i],
                    tags: activeTags.map(function (tag) { return tag.open; })
                });
            }
        });

        finishLine(lineEntries.length > 0);

        const normalizedLines = normalizeRichLines(lines);
        const entries = [];
        normalizedLines.forEach(function (line, lineIdx) {
            if (lineIdx > 0) entries.push({ newline: true, ch: '\n', tags: [] });
            line.forEach(function (entry) {
                entries.push(entry);
            });
        });
        entries._richHtml = true;

        return {
            plain: normalizedLines.map(function (line) {
                return line.map(function (entry) { return entry.ch; }).join('');
            }).join('\n'),
            entries: entries
        };
    }

    function sameTags(left, right) {
        const a = left || [];
        const b = right || [];
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    function wrapRichTextChunk(text, tags) {
        const openTags = tags || [];
        let html = openTags.join('') + escapeHtml(text);
        for (let i = openTags.length - 1; i >= 0; i--) {
            html += closeTagFor(openTags[i]);
        }
        return html;
    }

    function renderRichTextRange(entries, start, end, fallbackText) {
        if (!entries || !entries._richHtml || start < 0 || end > entries.length || start >= end) {
            return escapeHtml(fallbackText || '');
        }

        let html = '';
        let i = start;
        while (i < end) {
            const entry = entries[i];
            if (!entry || entry.newline) {
                html += '<br>';
                i++;
                continue;
            }

            const tags = entry.tags || [];
            let text = '';
            let j = i;
            while (j < end && entries[j] && !entries[j].newline && sameTags(entries[j].tags, tags)) {
                text += entries[j].ch || '';
                j++;
            }

            html += wrapRichTextChunk(text, tags);
            i = j;
        }

        return html;
    }

    const api = {
        normalizeDiffTokenValue,
        getDiffTokenType,
        tokenizeDiffText,
        tokenizeWords,
        diffTokensEqual,
        buildTokenLcs,
        buildTokenEdits,
        createRichTextIndexFromHtml,
        renderRichTextRange
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.MenuDiffCore = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

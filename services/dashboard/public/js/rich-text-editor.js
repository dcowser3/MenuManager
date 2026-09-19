(function (global) {
    function createRichTextEditor(config) {
        const settings = config || {};
        const editor = settings.editor;
        if (!editor) {
            throw new Error('Rich text editor requires an editable element');
        }

        const documentRef = editor.ownerDocument || global.document;
        const selectionRef = () => {
            const view = documentRef.defaultView || global;
            return view && typeof view.getSelection === 'function' ? view.getSelection() : null;
        };
        const toolbar = documentRef.createElement('div');
        const boldButton = documentRef.createElement('button');
        let savedRange = null;
        let enabled = false;

        toolbar.className = 'rich-text-toolbar';
        toolbar.hidden = true;
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Text formatting');

        boldButton.type = 'button';
        boldButton.className = 'rich-text-toolbar-button';
        boldButton.dataset.command = 'bold';
        boldButton.innerHTML = '<strong>B</strong>';
        boldButton.setAttribute('aria-label', 'Bold selected text');
        boldButton.setAttribute('title', 'Bold selected text');
        boldButton.setAttribute('aria-pressed', 'false');
        toolbar.appendChild(boldButton);
        editor.parentNode.insertBefore(toolbar, editor);

        function rangeBelongsToEditor(range) {
            if (!range) return false;
            const node = range.commonAncestorContainer;
            const element = node && node.nodeType === 1 ? node : node && node.parentNode;
            return !!(element && (element === editor || editor.contains(element)));
        }

        function updateBoldState() {
            let active = false;
            try {
                active = !!documentRef.queryCommandState('bold');
            } catch (_) {
                active = false;
            }
            boldButton.classList.toggle('active', active);
            boldButton.setAttribute('aria-pressed', active ? 'true' : 'false');
        }

        function captureSelection() {
            const selection = selectionRef();
            if (!selection || !selection.rangeCount) return false;
            const range = selection.getRangeAt(0);
            if (!rangeBelongsToEditor(range)) return false;
            savedRange = typeof range.cloneRange === 'function' ? range.cloneRange() : range;
            updateBoldState();
            return true;
        }

        function restoreSelection() {
            if (!savedRange || !rangeBelongsToEditor(savedRange)) return false;
            const selection = selectionRef();
            if (!selection) return false;
            selection.removeAllRanges();
            selection.addRange(savedRange);
            return true;
        }

        function dispatchEditorInput() {
            let inputEvent;
            try {
                inputEvent = new global.Event('input', { bubbles: true, inputType: 'formatBold' });
            } catch (_) {
                inputEvent = documentRef.createEvent('Event');
                inputEvent.initEvent('input', true, false);
            }
            editor.dispatchEvent(inputEvent);
        }

        function normalizeSemanticBold() {
            if (typeof editor.querySelectorAll !== 'function') return;
            const selection = selectionRef();
            const activeRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
            let replacementForSelection = null;

            editor.querySelectorAll('span[style]').forEach((span) => {
                const weight = String(span.style && span.style.fontWeight || '').toLowerCase();
                if (weight !== 'bold' && !/^[6-9]00$/.test(weight)) return;
                if (Array.from(span.children || []).some((child) => /^(STRONG|B)$/.test(child.tagName))) return;

                const containsSelection = !!(
                    activeRange &&
                    (span === activeRange.commonAncestorContainer || span.contains(activeRange.commonAncestorContainer))
                );
                const strong = documentRef.createElement('strong');
                while (span.firstChild) strong.appendChild(span.firstChild);
                span.appendChild(strong);
                span.style.removeProperty('font-weight');
                if (!span.getAttribute('style')) span.removeAttribute('style');
                if (containsSelection) replacementForSelection = strong;
            });

            if (replacementForSelection && selection && typeof documentRef.createRange === 'function') {
                const range = documentRef.createRange();
                range.selectNodeContents(replacementForSelection);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }

        function applyBold() {
            if (!enabled || !restoreSelection()) return false;
            try {
                editor.focus({ preventScroll: true });
            } catch (_) {
                editor.focus();
            }
            restoreSelection();

            let applied = false;
            try {
                // WebKit otherwise prefers <span style="font-weight: bold">.
                // The menu HTML contract uses semantic tags so the preview and
                // DOCX generator can preserve the formatting consistently.
                documentRef.execCommand('styleWithCSS', false, false);
                // execCommand remains the interoperable editing primitive for a
                // contenteditable range, including Safari. Selection preservation
                // above avoids WebKit collapsing the range when the button is used.
                applied = documentRef.execCommand('bold', false, null) !== false;
            } catch (_) {
                applied = false;
            }

            if (applied) {
                normalizeSemanticBold();
                captureSelection();
                dispatchEditorInput();
            }
            updateBoldState();
            return applied;
        }

        function preserveSelectionOnToolbarPointer(event) {
            if (!enabled) return;
            captureSelection();
            // Safari moves focus to the button on mousedown, which discards the
            // contenteditable range before click. Keeping focus in the editor makes
            // the command deterministic while the button remains keyboard-clickable.
            event.preventDefault();
        }

        function handleSelectionChange() {
            if (enabled) captureSelection();
        }

        function handleBoldShortcut(event) {
            const key = String(event.key || '').toLowerCase();
            if (!enabled || event.isComposing || !(event.metaKey || event.ctrlKey) || key !== 'b') return;

            // Safari normally owns Command-B for contenteditable fields. Handling it
            // here preserves the same selected range and semantic markup as the
            // visible control, even when WebKit would otherwise lose the range.
            event.preventDefault();
            captureSelection();
            applyBold();
        }

        toolbar.addEventListener('mousedown', preserveSelectionOnToolbarPointer);
        boldButton.addEventListener('click', function (event) {
            event.preventDefault();
            applyBold();
        });
        editor.addEventListener('keyup', captureSelection);
        editor.addEventListener('mouseup', captureSelection);
        editor.addEventListener('touchend', captureSelection);
        editor.addEventListener('keydown', handleBoldShortcut);
        documentRef.addEventListener('selectionchange', handleSelectionChange);

        function setEnabled(nextEnabled) {
            enabled = !!nextEnabled;
            toolbar.hidden = !enabled;
            boldButton.disabled = !enabled;
            if (enabled) {
                captureSelection();
            } else {
                savedRange = null;
                boldButton.classList.remove('active');
                boldButton.setAttribute('aria-pressed', 'false');
            }
        }

        function destroy() {
            documentRef.removeEventListener('selectionchange', handleSelectionChange);
            editor.removeEventListener('keyup', captureSelection);
            editor.removeEventListener('mouseup', captureSelection);
            editor.removeEventListener('touchend', captureSelection);
            editor.removeEventListener('keydown', handleBoldShortcut);
            toolbar.remove();
        }

        return {
            applyBold,
            captureSelection,
            destroy,
            setEnabled,
            toolbar,
            boldButton,
        };
    }

    const api = { createRichTextEditor };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.MenuRichTextEditor = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

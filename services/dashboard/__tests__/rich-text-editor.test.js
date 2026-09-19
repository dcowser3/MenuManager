const fs = require('fs');
const path = require('path');
const { webkit } = require('playwright');
const { createRichTextEditor } = require('../public/js/rich-text-editor');

const browserAvailable = fs.existsSync(webkit.executablePath());
const describeWebKit = browserAvailable ? describe : describe.skip;

function createFakeElement(ownerDocument, tagName) {
    const listeners = new Map();
    const classes = new Set();
    return {
        ownerDocument,
        tagName: tagName.toUpperCase(),
        nodeType: 1,
        parentNode: null,
        children: [],
        dataset: {},
        hidden: false,
        disabled: false,
        attributes: {},
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
            contains: (name) => classes.has(name),
        },
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
        },
        insertBefore(child) {
            child.parentNode = this;
            this.children.unshift(child);
        },
        contains(node) {
            let current = node;
            while (current) {
                if (current === this) return true;
                current = current.parentNode;
            }
            return false;
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(listener);
        },
        removeEventListener(type, listener) {
            listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== listener));
        },
        dispatchEvent(event) {
            (listeners.get(event.type) || []).forEach((listener) => listener(event));
            return !event.defaultPrevented;
        },
        click() {
            this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
        },
        focus() {},
        remove() {},
    };
}

describe('shared rich text editor controller', () => {
    test('is enabled and disabled only with the shared form edit-mode toggle', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );
        const toggleStart = template.indexOf('function toggleEditMode()');
        const toggleEnd = template.indexOf('function getEditorContentForRedline()', toggleStart);
        const toggleCode = template.slice(toggleStart, toggleEnd);

        expect(toggleCode).toContain("reviewedArea.contentEditable = 'true';\n                if (reviewedRichTextEditor) reviewedRichTextEditor.setEnabled(true);");
        expect(toggleCode).toContain("reviewedArea.contentEditable = 'false';\n                if (reviewedRichTextEditor) reviewedRichTextEditor.setEnabled(false);");
        expect(template).not.toContain('const clone = element.cloneNode(true);\n                reviewedRichTextEditor.setEnabled(true);');
        expect(template).not.toContain('function handleReviewedAreaInput() {\n                reviewedRichTextEditor.setEnabled(false);');
    });

    test('restores a saved editor range before applying bold and emits input', () => {
        const documentListeners = new Map();
        const selection = {
            range: null,
            get rangeCount() { return this.range ? 1 : 0; },
            getRangeAt: () => selection.range,
            removeAllRanges: () => { selection.range = null; },
            addRange: (range) => { selection.range = range; },
        };
        const documentRef = {
            defaultView: { getSelection: () => selection },
            createElement(tagName) { return createFakeElement(documentRef, tagName); },
            createEvent: () => ({ initEvent(type) { this.type = type; } }),
            queryCommandState: jest.fn(() => false),
            execCommand: jest.fn(() => true),
            addEventListener(type, listener) { documentListeners.set(type, listener); },
            removeEventListener(type) { documentListeners.delete(type); },
        };
        const parent = createFakeElement(documentRef, 'div');
        const editor = createFakeElement(documentRef, 'div');
        const textNode = { nodeType: 3, parentNode: editor };
        const selectedRange = {
            commonAncestorContainer: textNode,
            cloneRange: () => selectedRange,
        };
        parent.appendChild(editor);
        selection.range = selectedRange;

        let inputEvents = 0;
        editor.addEventListener('input', () => { inputEvents += 1; });
        const controller = createRichTextEditor({ editor });
        controller.setEnabled(true);

        selection.removeAllRanges(); // Safari-style focus loss before the click handler.
        controller.boldButton.click();

        expect(documentRef.execCommand).toHaveBeenCalledWith('bold', false, null);
        expect(documentRef.execCommand).toHaveBeenCalledWith('styleWithCSS', false, false);
        expect(selection.range).toBe(selectedRange);
        expect(inputEvents).toBe(1);
        expect(controller.toolbar.hidden).toBe(false);
    });
});

describeWebKit('shared rich text editor in WebKit', () => {
    let browser;

    beforeAll(async () => {
        browser = await webkit.launch({ headless: true });
    }, 30000);

    afterAll(async () => {
        if (browser) await browser.close();
    });

    test('keeps the selected editor range when the bold toolbar button is clicked', async () => {
        const page = await browser.newPage();
        await page.setContent(`
            <!doctype html>
            <html>
                <body>
                    <div id="box"><div id="editor" contenteditable="true"><p>Safari bold selection</p></div></div>
                </body>
            </html>
        `);
        await page.addScriptTag({
            path: path.join(__dirname, '..', 'public', 'js', 'rich-text-editor.js'),
        });

        const result = await page.evaluate(() => {
            const editor = document.getElementById('editor');
            const controller = window.MenuRichTextEditor.createRichTextEditor({ editor });
            controller.setEnabled(true);

            let inputEvents = 0;
            editor.addEventListener('input', () => { inputEvents += 1; });

            const textNode = editor.querySelector('p').firstChild;
            const range = document.createRange();
            range.setStart(textNode, 0);
            range.setEnd(textNode, 6);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));

            controller.boldButton.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
            }));
            controller.boldButton.click();

            return {
                boldText: editor.querySelector('strong, b')?.textContent || '',
                inputEvents,
                toolbarHidden: controller.toolbar.hidden,
            };
        });

        expect(result).toEqual({
            boldText: 'Safari',
            inputEvents: 1,
            toolbarHidden: false,
        });
        await page.close();
    }, 30000);
});

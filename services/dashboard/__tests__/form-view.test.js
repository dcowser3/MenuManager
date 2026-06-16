const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('dashboard form modification source chooser', () => {
    test('defaults to modification mode without choosing a modification source', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('id="submissionModeModification" value="modification" checked');
        expect(template).toContain('id="modificationSearchSection" class="modification-search show"');
        expect(template).toContain('let submissionMode = \'modification\';');
        expect(template).not.toContain('id="submissionModeNew" value="new" checked');
    });

    test('groups database and prior approved upload under edit-here flow', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain("I'll make menu changes here");
        expect(template).toContain('Upload Prior Approved DOCX');
        expect(template).toContain('Choose from database (recommended)');
        expect(template).toContain('My menu is not in database yet');
        expect(template).toContain('I already made my menu edits on a doc');
        expect(template).toContain('Upload Unapproved DOCX (Preserve Redlines)');
        expect(template).toContain('name="approvedBaselineSource"');
        expect(template).toContain('id="modWorkflowEditHere" value="edit_here" onchange=');
        expect(template).toContain('id="modSourceDatabase" value="database" onchange=');
        expect(template).toContain('id="baselineDocUpload" accept=".docx" onchange="uploadBaselineDoc()"');
        expect(template).toContain('id="unapprovedDocUpload" accept=".docx" onchange="uploadUnapprovedDoc()"');
        expect(template).not.toContain('id="modSourceUpload" value="upload" onchange="onModificationSourceChange()">\n                            Upload Prior Approved DOCX');
        expect(template).not.toContain('Upload Approved DOCX (Preserve Redlines)');
        expect(template).not.toContain('id="modWorkflowEditHere" value="edit_here" checked');
        expect(template).not.toContain('id="modSourceDatabase" value="database" checked');
    });

    test('lets brand-new submissions import menu content from DOCX using shared upload code', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('id="newMenuDocUploadSection"');
        expect(template).toContain('id="newMenuDocUpload" accept=".docx" onchange="uploadNewMenuDoc()"');
        expect(template).toContain('function uploadCleanDocxForMenu(options)');
        expect(template).toContain("route: '/api/form/menu-doc-upload'");
        expect(template).toContain("route: '/api/modification/baseline-upload'");
        expect(template).toContain('setQuillMenuContentFromUpload(importedMenuText, importedMenuHtml);');
        expect(template).toContain('newMenuDocUploadSection.classList.add(\'show\');');
    });

    test('builds a reusable uploaded-redline comparison before rendering the clean left editor', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('reviewedArea.contentEditable = \'true\';');
        expect(template).toContain('redlinePreview.buildRevisionComparisonFromAnnotatedHtml(unapprovedBaseHtml)');
        expect(template).toContain('unapprovedDiffBaseline = revisionComparison.originalText || \'\';');
        expect(template).toContain('unapprovedOriginalHtml = revisionComparison.originalHtml || \'\';');
        expect(template).toContain('unapprovedEditorHtml = revisionComparison.editorHtml || \'\';');
        expect(template).toContain('displayReviewedContent(unapprovedEditorHtml || \'<p><br></p>\');');
        expect(template).toContain('renderPersistentPreview(unapprovedDiffBaseline, baseApprovedMenuContent);');
        expect(template).toContain('annotationMap: {},');
        expect(template).toContain('includeExistingAnnotations: false,');
        expect(template).not.toContain('displayReviewedContent(unapprovedBaseHtml);');
        expect(template).not.toContain('buildAnnotationMapFromDOM(unapprovedPreviewProbe);');
        expect(template).not.toContain('span.contentEditable = \'false\';');
        expect(template).not.toContain('querySelectorAll(\'.existing-del, .existing-ins\').forEach(span => {');
    });

    test('does not cap the left reviewed menu box below the persistent preview height', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('.reviewed-content-container');
        expect(template).toContain('max-height: none;');
        expect(template).not.toContain('max-height: 600px;');
    });

    test('renders AI suggestions above the side-by-side menu boxes after review', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        const containerStart = template.indexOf('<div class="step2-container">');
        const suggestionsStart = template.indexOf('id="aiSuggestionsSection" class="ai-suggestions-section"', containerStart);
        const leftPanelStart = template.indexOf('<div class="step2-left-panel">', containerStart);
        const rightPanelStart = template.indexOf('<div class="step2-right-panel">', containerStart);

        expect(containerStart).toBeGreaterThan(-1);
        expect(suggestionsStart).toBeGreaterThan(containerStart);
        expect(leftPanelStart).toBeGreaterThan(suggestionsStart);
        expect(rightPanelStart).toBeGreaterThan(leftPanelStart);
        expect(template).toContain('.ai-suggestions-section');
        expect(template).toContain('grid-column: 1 / -1;');
        expect(template).toContain('.ai-suggestions-section .suggestions-list');
        expect(template).toContain('flex-direction: column;');
        expect(template).toContain('max-height: min(420px, 45vh);');
        expect(template).toContain('@media (max-width: 900px)');
        expect(template).toContain('class="suggestions-list"');
        expect(template).not.toContain('grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));');
        expect(template).not.toContain('id="aiSuggestionsSection" class="ai-suggestions-section" data-step2-right-workbox');
        expect(template).not.toContain('class="suggestions-list" data-step2-right-align-box');
    });

    test('renders apply buttons only through direct suggestion change pairs', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('function getSuggestionChangePair(suggestion)');
        expect(template).toContain('window.formHelpers.extractSuggestionChangePair');
        expect(template).toContain('window.formHelpers.applySuggestionChangeToText');
        expect(template).toContain('function applySuggestionChange(idx)');
        expect(template).toContain('class="suggestion-apply-btn" onclick="applySuggestionChange(${idx})"');
        expect(template).toContain("button.textContent = 'Applied';");
        expect(template).toContain('markAiCheckStale();');
    });

    test('aligns the shared Step 2 editor with the persistent preview work box', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('class="reviewed-content-container" data-step2-editor-box');
        expect(template).toContain('class="persistent-preview show" data-step2-right-workbox');
        expect(template).toContain('class="persistent-preview-body" data-step2-right-align-box');
        expect(template).toContain('function alignStep2EditorWorkbox()');
        expect(template).toContain("document.querySelector('[data-step2-editor-box]')");
        expect(template).toContain("document.querySelectorAll('[data-step2-right-workbox]')");
        expect(template).toContain("firstVisibleRightWorkbox.querySelector('[data-step2-right-align-box]')");
        expect(template).toContain('rightWorkboxes.find(isStep2WorkboxVisible)');
        expect(template).toContain('firstVisibleRightWorkbox.style.marginTop');
        expect(template).toContain("window.addEventListener('resize', syncStep2EditorWorkboxAlignment);");
    });

    test('keeps Step 2 editor and preview text top padding aligned', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('padding: 0.75rem 1.5rem 1.5rem;');
        expect(template).toContain('padding: 0.75rem;');
    });

    test('scrolls to the moved side-by-side review boxes after AI completes', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('function scrollAiReviewResultsIntoView()');
        expect(template).toContain("const reviewPanel = document.querySelector('.step2-container');");
        expect(template).toContain("reviewPanel.scrollIntoView({ behavior: 'auto', block: 'start' });");
        expect(template).toContain('function suspendViewportScrollAnchoring()');
        expect(template).toContain("root.style.overflowAnchor = 'none';");
        expect(template).toContain('const restoreScrollAnchoring = suspendViewportScrollAnchoring();');
        expect(template).toContain('function floatMenuToBottom(onSettled)');
        expect(template).toContain('flipMove(menu, function () { slot.appendChild(menu); }, settle);');
        expect(template).toContain('setTimeout(cleanup, 600);');

        const firstRunStart = template.indexOf('showStep2(data);\n                floatMenuToBottom(scrollAiReviewResultsIntoView);');
        const firstRunEnd = template.indexOf('if (data.aiUnavailable)', firstRunStart);
        expect(firstRunStart).toBeGreaterThan(-1);
        expect(template.slice(firstRunStart, firstRunEnd)).not.toContain('scrollAiReviewResultsIntoView();');

        const rerunStart = template.indexOf('// Re-render step 2 with new results');
        const rerunEnd = template.indexOf('if (data.aiUnavailable)', rerunStart);
        expect(rerunStart).toBeGreaterThan(-1);
        expect(template.slice(rerunStart, rerunEnd)).toContain('floatMenuToBottom(scrollAiReviewResultsIntoView);');
    });

    test('renders action alerts as fixed growl toasts with countdown progress', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('id="alertContainer" aria-live="polite" aria-atomic="false"');
        expect(template).toContain('#alertContainer');
        expect(template).toContain('position: fixed;');
        expect(template).toContain('right: 1rem;');
        expect(template).toContain('.toast-progress');
        expect(template).toContain('@keyframes toastProgressShrink');
        expect(template).toContain('const DEFAULT_ALERT_DURATIONS = {');
        expect(template).toContain("progress.className = 'toast-progress';");
        expect(template).toContain("progress.style.setProperty('--toast-duration', `${autoDismissMs}ms`);");
        expect(template).toContain('dismissTimer = setTimeout(dismissAlert, autoDismissMs);');
    });

    test('does not duplicate the in-panel auto-corrections message as a growl', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('Auto-Corrected');
        expect(template).toContain('Green highlights show inserted or modified text');
        expect(template).not.toContain("showAlert('Auto-corrections applied! Green highlights show the changes.', 'success');");
    });

    test('excludes imported deletions from uploaded-unapproved AI review text', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('function extractAiReviewTextFromReviewedArea(element)');
        expect(template).toContain("clone.querySelectorAll('.existing-del, .persistent-del, del, s, [style*=\"line-through\"]')");
        expect(template).toContain('menuContent = extractAiReviewTextFromReviewedArea(reviewedArea);');
        expect(template).toContain('const menuContent = extractAiReviewTextFromReviewedArea(reviewedArea);');
    });

    test('keeps AI review output clean on the left while preserving redlines on the right', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('displayReviewedContent(quill.root.innerHTML);');
        expect(template).toContain('const aiCheckBase = (unapprovedMode && unapprovedDiffBaseline)');
        expect(template).toContain('const reviewedDisplayText = extractCleanTextFromReviewedArea(quill.root) || correctedDisplayText;');
        expect(template).toContain('const changes = computeLineDiff(originalText, reviewedDisplayText);');
        expect(template).toContain('return redlinePreview.computeInsertedTokenRanges(original, corrected);');
        expect(template).toContain('applyDishNameFormattingAnchors(correctedDisplayText, results.dishNameFormatting);');
        expect(template).toContain('renderPersistentPreview(aiCheckBase, reviewedDisplayText, quill.root.innerHTML || \'\');');
        expect(template).not.toContain('displayReviewedContent(aiReviewMenuPanel.leftPanelHtml);');
        expect(template).not.toContain('buildAiReviewedMenuPanel');
    });

    test('applies server-provided dish-name anchors through Quill formatting', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('function applyDishNameFormattingAnchors(displayText, anchors)');
        expect(template).toContain('redlinePreview.resolveDishNameFormattingRanges(sourceText, anchors || [])');
        expect(template).toContain('function shouldClearProjectedDishContinuationBold(line)');
        expect(template).toContain('quill.formatText(line.start, line.text.length, { bold: false });');
        expect(template).toContain('quill.formatText(range.start, range.end - range.start, { bold: true });');
        expect(template).toContain('revisedHtml: revisedHtml ? stripAiReviewTransientFormatting(revisedHtml) : \'\',');
    });

    test('uses a full-screen decision dialog for existing approved menu conflicts', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('id="baselineFreshnessModal"');
        expect(template).toContain('role="dialog" aria-modal="true"');
        expect(template).toContain('id="baselineFreshnessCancelBtn" class="btn btn-quiet">Cancel</button>');
        expect(template).toContain('Continue as Brand New');
        expect(template).toContain('Use Existing Menu');
        expect(template).toContain('latestBaselineFreshnessIssue = issue;');
        expect(template).not.toContain('if (issue) showBaselineFreshnessWarning(issue);');
    });

    test('does not replace uploaded-unapproved redlines with a database freshness baseline', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain("if (submissionMode === 'modification' && (unapprovedMode || revisionSource === 'uploaded_unapproved')) {");
        expect(template).toContain('return null;');
    });

    test('keeps docx metadata extraction misses silent', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).not.toContain('function showUploadNotice(message)');
        expect(template).not.toContain('alert-growl-progress');
        expect(template).not.toContain('alertGrowlCountdown');
        expect(template).not.toContain('We weren\'t able to fill in the property from your Word doc');
        expect(template).not.toContain('Extracted orientation "');
        expect(template).not.toContain('could not be parsed — please enter dimensions manually');
        expect(template).not.toContain('showUploadNotice(warning)');
        expect(template).toContain('window.formHelpers.isValidDateInputValue(extractedDate)');
        expect(template).not.toContain('markFieldAsExtracted(\'dateNeeded\');\n        }');
    });

    test('shows support email guidance in blocking form errors', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('If this keeps happening or blocks your submission, email');
        expect(template).toContain('supportLink.href = \'mailto:<%= supportEmail %>\';');
        expect(template).toContain('include screenshots with your email');
        expect(template).toContain('If you are stuck,');
        expect(template).toContain('Need help?');
        expect(template).toContain('Please fill in all required fields. Missing fields are highlighted below.');
    });

    test('uses accent-insensitive matching for form autocomplete searches', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('window.formHelpers.findSearchMatchRange');
        expect(template).toContain('window.formHelpers.searchTextIncludes(p.projectName || \'\', query)');
        expect(template).toContain('window.formHelpers.searchTextIncludes(name || \'\', query)');
        expect(template).toContain('window.formHelpers.normalizeSearchText(query).trim()');
    });

    test('offers a one-click problem report wherever support guidance appears', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        // Button in error alerts, the critical-error banner, and the footer.
        expect(template).toContain("reportBtn.textContent = 'Report this problem';");
        expect(template).toContain("sendProblemReport({ trigger: 'error_alert', context: message, sourceButton: reportBtn })");
        expect(template).toContain("onclick=\"sendProblemReport({ trigger: 'critical_error_banner', sourceButton: this })\"");
        expect(template).toContain('id="footerReportProblemBtn"');
        expect(template).toContain("onclick=\"sendProblemReport({ trigger: 'support_footer', sourceButton: this })\"");
        // Discloses what gets sent.
        expect(template).toContain('sends us a screenshot of this page and your form details');
    });

    test('problem report captures the page and full client state before any UI changes', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('async function sendProblemReport(options)');
        expect(template).toContain("script.src = '/js/html2canvas.min.js';");
        expect(template).toContain('function collectClientStateSnapshot()');
        expect(template).toContain('function collectFormFieldValues()');
        expect(template).toContain('function normalizeScreenshotCloneForHtml2Canvas(clonedDocument)');
        expect(template).toContain('onclone: normalizeScreenshotCloneForHtml2Canvas');
        expect(template).not.toContain('color-mix(');
        expect(template).toContain('const REPORT_MAX_BODY_BYTES = <%= errorReportMaxBodyBytes %>;');
        expect(template).toContain('function serializeProblemReportPayload(payload, state)');
        expect(template).toContain('byteLength(body) <= REPORT_MAX_BODY_BYTES');
        expect(template).toContain('buildCompactProblemReportState(state)');
        expect(template).toContain('buildMinimalProblemReportState(state)');
        expect(template).toContain('state snapshot minimized to stay under report payload limit');
        expect(template).not.toContain('REPORT_MAX_BODY_CHARS');
        expect(template).toContain('const incidentNote = data.incidentId');
        expect(template).toContain("fetch('/api/form/error-report'");
        expect(template).toContain('function recordClientAlert(type, message)');
        expect(template).toContain('recordClientAlert(type, message);');
        // Screenshot is captured before the "Sending report…" UI swap so the
        // open error alert is part of the image.
        const captureIndex = template.indexOf('screenshotDataUrl = await capturePageScreenshot();');
        const sendingLabelIndex = template.indexOf("btn.textContent = 'Sending report…';");
        expect(captureIndex).toBeGreaterThan(-1);
        expect(sendingLabelIndex).toBeGreaterThan(captureIndex);
        // The failure alert must not offer another report button (no loops).
        expect(template).toContain('noReportAction: true');
    });

    test('problem report screenshot helper converts Safari CSS color functions', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );
        const start = template.indexOf('function parseScreenshotColorComponent(value)');
        const end = template.indexOf('async function capturePageScreenshot()');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const helperCode = template.slice(start, end);
        const sandbox = { result: null };
        vm.runInNewContext(`
            ${helperCode}
            result = {
                srgb: fallbackCssColorForScreenshot('color(srgb 0.12 0.34 0.56 / 0.7)'),
                displayP3: fallbackCssColorForScreenshot('color(display-p3 1 50% 0)'),
                normalRgb: fallbackCssColorForScreenshot('rgb(1, 2, 3)')
            };
        `, sandbox);

        expect(sandbox.result.srgb).toBe('rgba(31, 87, 143, 0.7)');
        expect(sandbox.result.displayP3).toBe('rgb(255, 127, 0)');
        expect(sandbox.result.normalRgb).toBeNull();
    });

    test('problem report serializer compacts oversized payloads by byte size', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );
        const start = template.indexOf('function truncateReportText(value, maxChars)');
        const end = template.indexOf('async function sendProblemReport(options)');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const serializerCode = template.slice(start, end);
        const sandbox = {
            Buffer,
            result: null,
        };
        vm.runInNewContext(`
            function byteLength(value) {
                const text = typeof value === 'string' ? value : JSON.stringify(value || '');
                return Buffer.byteLength(text, 'utf8');
            }
            const REPORT_MAX_BODY_BYTES = 14000000;
            ${serializerCode}
            const state = {
                capturedAt: '2026-06-15T12:00:00.000Z',
                page: { url: 'http://localhost:3005/form', userAgent: 'jest', viewport: '1440x900 @2x' },
                fields: { projectName: 'Dinner', pastedRichText: 'é'.repeat(4000000) },
                menuEditor: {
                    menuTextLength: 4000000,
                    menuHtmlLength: 4000000,
                    menuText: 'é'.repeat(4000000),
                    menuHtml: '<p>' + 'é'.repeat(4000000) + '</p>'
                },
                appState: { submissionMode: 'modification', revisionSource: 'uploaded_unapproved', persistentDiffHtmlLength: 1500000 },
                aiCheck: { hasRun: true, hasCriticalErrors: true, suggestions: [{ message: 'Missing price'.repeat(10000) }] },
                recentAlerts: [{ time: '2026-06-15T12:00:00.000Z', type: 'error', message: 'critical blocker' }]
            };
            const payload = {
                attemptId: 'attempt-oversized',
                trigger: 'critical_error_banner',
                context: 'Resolve critical errors',
                pageUrl: state.page.url,
                userAgent: state.page.userAgent,
                viewport: state.page.viewport,
                submitterEmail: 'chef@example.com',
                projectName: 'Dinner',
                property: 'Aqimero',
                submissionMode: 'modification',
                recentAlerts: state.recentAlerts,
                screenshotError: '',
                screenshotDataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(3500000),
                state
            };
            const body = serializeProblemReportPayload(payload, state);
            result = { bytes: byteLength(body), parsed: JSON.parse(body) };
        `, sandbox);

        expect(sandbox.result.bytes).toBeLessThanOrEqual(14000000);
        expect(sandbox.result.parsed.screenshotDataUrl).toContain('data:image/jpeg;base64,');
        expect(sandbox.result.parsed.screenshotError).not.toContain('screenshot dropped');
        expect(sandbox.result.parsed.state.droppedReason).toContain('compact state');
        expect(sandbox.result.parsed.state.menuEditor.menuText.length).toBeLessThan(100000);
    });

    test('final submit success clears stale error report alerts', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );
        const submitStart = template.indexOf('async function submitMenu(skipAiReview = false)');
        const submitEnd = template.indexOf('function prepareForNextSubmission()');
        expect(submitStart).toBeGreaterThan(-1);
        expect(submitEnd).toBeGreaterThan(submitStart);

        const submitCode = template.slice(submitStart, submitEnd);
        const successAlertIndex = submitCode.indexOf("showAlert('Menu submitted successfully. Sent to ClickUp for team review. You can submit another menu now.', 'success');");
        const clearIndex = submitCode.lastIndexOf('clearErrorAlerts();', successAlertIndex);
        expect(successAlertIndex).toBeGreaterThan(-1);
        expect(clearIndex).toBeGreaterThan(-1);

        const prepareStart = submitEnd;
        const prepareEnd = template.indexOf('function escapeHtml(text)', prepareStart);
        const prepareCode = template.slice(prepareStart, prepareEnd);
        expect(prepareCode).toContain('clearErrorAlerts();');
    });

    test('allows final submit after edits made following the second AI check', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('let aiCheckCompletedCount = 0;');
        expect(template).toContain('aiCheckCompletedCount += 1;');
        expect(template).toContain('window.formHelpers.shouldBlockSubmitForStaleAiCheck');
        expect(template).toContain('return requiresAiRerun && aiCheckCompletedCount < 2;');
        expect(template).toContain('if (!skipAiReview && shouldBlockSubmitForStaleAiCheck())');
        expect(template).toContain('submittedWithPostSecondAiEdit: requiresAiRerun && !shouldBlockSubmitForStaleAiCheck()');
        expect(template).not.toContain('if (!skipAiReview && requiresAiRerun)');
    });

    test('uses the main submit button to re-run a stale AI check', () => {
        const template = fs.readFileSync(
            path.join(__dirname, '..', 'views', 'form.ejs'),
            'utf8'
        );

        expect(template).toContain('id="submitBtn" class="btn btn-success" onclick="handleSubmitButtonClick()"');
        expect(template).toContain('async function handleSubmitButtonClick()');
        expect(template).toContain('if (shouldBlockSubmitForStaleAiCheck()) {\n                await rerunAICheck({ source: \'submit_button\' });');
        expect(template).toContain("submitBtn.textContent = 'Run Basic AI Check';");
        expect(template).toContain("submitBtn.classList.remove('blocked');\n                submitBtn.textContent = 'Run Basic AI Check';");
        expect(template).toContain("submitBtn.innerHTML = '<span class=\"spinner\"></span>Running AI Check...';");
    });
});

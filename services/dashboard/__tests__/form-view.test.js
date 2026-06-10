const fs = require('fs');
const path = require('path');

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

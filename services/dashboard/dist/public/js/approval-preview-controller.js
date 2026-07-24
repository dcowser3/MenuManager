(function (global) {
    const redlinePreview = global.MenuRedlinePreview;

    if (!redlinePreview) {
        throw new Error('MenuRedlinePreview must be loaded before approval-preview-controller.js');
    }

    function nowMs() {
        return global.performance && typeof global.performance.now === 'function'
            ? global.performance.now()
            : Date.now();
    }

    function roundTiming(value) {
        return Math.round(value * 10) / 10;
    }

    function hasOwn(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    const DRAFT_KEY_PREFIX = 'menumanager.approvalDraft.v1:';
    const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const DRAFT_SAVE_DEBOUNCE_MS = 1500;

    function draftStorageKey(submissionId) {
        return `${DRAFT_KEY_PREFIX}${submissionId || 'unknown'}`;
    }

    /**
     * Cheap content fingerprint, used to tell whether a stored draft still belongs to
     * the baseline now being edited. Restoring a draft onto different source content
     * would silently submit edits made against a document the reviewer never saw.
     */
    function fingerprintText(value) {
        const text = String(value || '');
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
        }
        return `${text.length}:${hash}`;
    }

    function isRestorableDraft(draft, expected) {
        if (!draft || typeof draft !== 'object') return false;
        if (!draft.html || typeof draft.html !== 'string') return false;
        if (draft.baseline !== expected.baselineFingerprint) return false;
        if (!Number.isFinite(draft.savedAt)) return false;
        if (expected.now - draft.savedAt > expected.maxAgeMs) return false;
        // Nothing to recover when the draft never diverged from the submitted text.
        return `${draft.text || ''}` !== `${expected.baselineText || ''}`;
    }

    function formatDraftAge(savedAt, now) {
        // Floor, not round: a draft saved 30 seconds ago reads as "moments ago", not
        // "1 minute ago".
        const minutes = Math.max(0, Math.floor((now - savedAt) / 60000));
        if (minutes < 1) return 'moments ago';
        if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
        const days = Math.round(hours / 24);
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }

    function createApprovalPreviewController(config) {
        const settings = config || {};
        const elements = settings.elements || {};
        const editor = elements.editor;
        const preview = elements.preview;
        const loading = elements.loading;
        const submitBtn = elements.submitBtn;
        const restoreBtn = elements.restoreBtn;
        const alertBox = elements.alertBox;
        const diffSummary = elements.diffSummary;

        if (!editor || !preview || !submitBtn || !restoreBtn || !diffSummary) {
            throw new Error('Approval preview controller is missing required elements');
        }

        const baselineText = String(settings.baselineText || '');
        const baselinePreviewText = String(settings.baselinePreviewText || baselineText);
        const baselineAnnotations = Array.isArray(settings.baselineAnnotations)
            ? settings.baselineAnnotations
            : [];
        const baselineHtml = String(settings.baselineHtml || '');
        const displayBaselineHtml = redlinePreview.stripTransientReviewHighlights(baselineHtml);
        const debugPreviewTiming = !!settings.debugPreviewTiming;
        const debounceMs = Number.isFinite(settings.debounceMs) ? settings.debounceMs : 140;
        const workerTimeoutMs = Number.isFinite(settings.workerTimeoutMs)
            ? settings.workerTimeoutMs
            : 6000;
        const richPreviewTextLimit = Number.isFinite(settings.richPreviewTextLimit)
            ? settings.richPreviewTextLimit
            : 2400;
        const hasImportedAnnotations = baselineAnnotations.some((row) => Array.isArray(row) && row.length);
        const annotationMap = Array.isArray(baselineAnnotations) && baselineAnnotations.length
            ? redlinePreview.buildAnnotationMapFromParagraphAnnotations(baselinePreviewText, baselineAnnotations)
            : redlinePreview.buildAnnotationMapFromHtml(
                displayBaselineHtml,
                baselinePreviewText,
                { trimText: false }
            );
        const canonicalBaseline = redlinePreview.buildRevisionComparisonFromAnnotatedPreview(
            baselinePreviewText,
            annotationMap,
            {
                baselineText,
                baselineHtml: displayBaselineHtml,
            }
        );
        const baselineOriginalText = canonicalBaseline.originalText || baselineText;
        const baselineFixedText = canonicalBaseline.currentText || baselineText;
        const baselineOriginalHtml = canonicalBaseline.originalHtml || displayBaselineHtml || '';
        const baselineEditorHtml = canonicalBaseline.editorHtml ||
            redlinePreview.buildEditableHtmlFromBaseline(displayBaselineHtml, baselineFixedText);
        const canUseWorker = hasImportedAnnotations && typeof global.Worker === 'function';
        const workerUrl = settings.workerUrl || '/js/approval-preview-worker.js?v=20260609-structural-line-match';

        let worker = null;
        let previewUpdateTimer = null;
        let lastRenderedEditorText = baselineFixedText;
        let lastRenderedEditorHtml = '';
        let pendingRichPreview = false;
        let editorHasUserInput = false;
        let previewIsStale = false;
        let lastRenderedHtml = '';
        let latestRevision = 0;
        let nextRequestId = 0;
        let activeRequest = null;
        let queuedRequest = null;
        let destroyed = false;

        function showAlert(message, type) {
            if (!alertBox) return;
            alertBox.textContent = message;
            alertBox.className = `alert show ${type || 'success'}`;
            global.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function setLoading(isLoading) {
            if (!loading) return;
            loading.hidden = !isLoading;
        }

        function setPreviewStatus(message) {
            diffSummary.textContent = message;
        }

        function markPreviewStale() {
            previewIsStale = true;
            setLoading(true);
            setPreviewStatus('Live changes: updating preview...');
        }

        function markPreviewFresh(rendered) {
            previewIsStale = false;
            setLoading(false);
            if (rendered) {
                setPreviewStatus(`Live changes: ${rendered.insertions} insertions, ${rendered.deletions} deletions`);
            }
        }

        function getEditorText() {
            return redlinePreview.extractCleanTextFromElement(editor).replace(/\r/g, '');
        }

        function getEditorHtml() {
            return editor.innerHTML || '';
        }

        // Local draft recovery. This editor has no server-side draft store, and adding one
        // would mean a hand-applied migration that has silently lagged in production before
        // — failing back to container-local JSON that a redeploy discards, which is exactly
        // the loss this guards against. localStorage keeps a reviewer's session across a
        // crash, an accidental close, or a failed submit without that risk.
        const draftKey = draftStorageKey(settings.submissionId);
        const draftSaveDebounceMs = Number.isFinite(settings.draftSaveDebounceMs)
            ? settings.draftSaveDebounceMs
            : DRAFT_SAVE_DEBOUNCE_MS;
        const draftMaxAgeMs = Number.isFinite(settings.draftMaxAgeMs)
            ? settings.draftMaxAgeMs
            : DRAFT_MAX_AGE_MS;
        const baselineFingerprint = fingerprintText(baselineFixedText);
        let draftSaveTimer = null;

        function getDraftStorage() {
            if (settings.storage) return settings.storage;
            try {
                return global.localStorage || null;
            } catch (error) {
                return null; // Private mode or blocked storage.
            }
        }

        function readStoredDraft() {
            const storage = getDraftStorage();
            if (!storage) return null;
            try {
                const raw = storage.getItem(draftKey);
                return raw ? JSON.parse(raw) : null;
            } catch (error) {
                return null;
            }
        }

        function clearStoredDraft() {
            clearTimeout(draftSaveTimer);
            const storage = getDraftStorage();
            if (!storage) return;
            try {
                storage.removeItem(draftKey);
            } catch (error) {
                // Storage unavailable; nothing to clean up.
            }
        }

        function saveDraftNow() {
            const storage = getDraftStorage();
            if (!storage) return;
            const text = getEditorText();
            if (text === baselineFixedText) {
                clearStoredDraft(); // Back at the submitted text — nothing worth recovering.
                return;
            }
            try {
                storage.setItem(draftKey, JSON.stringify({
                    html: getEditorHtml(),
                    text,
                    savedAt: Date.now(),
                    baseline: baselineFingerprint,
                }));
            } catch (error) {
                // Quota or blocked storage. Recovery is best-effort and must never
                // interrupt an edit in progress.
                console.warn('Could not save approval editor draft:', error && error.message);
            }
        }

        function scheduleDraftSave() {
            clearTimeout(draftSaveTimer);
            draftSaveTimer = setTimeout(saveDraftNow, draftSaveDebounceMs);
        }

        function restoreDraftIfAvailable() {
            const draft = readStoredDraft();
            const restorable = isRestorableDraft(draft, {
                baselineFingerprint,
                baselineText: baselineFixedText,
                maxAgeMs: draftMaxAgeMs,
                now: Date.now(),
            });
            if (!restorable) return null;
            editor.innerHTML = draft.html;
            return draft;
        }

        function logPreviewTiming(label, timings) {
            if (!debugPreviewTiming || !global.console || !console.table) return;
            const rounded = {};
            Object.entries(timings || {}).forEach(([key, value]) => {
                rounded[key] = typeof value === 'number' ? roundTiming(value) : value;
            });
            console.table({ [label]: rounded });
        }

        function renderPreviewOnMainThread(revisedText, revisedHtml, scheduleTimings) {
            const renderStart = nowMs();
            const resolveEnd = nowMs();
            const rendered = redlinePreview.renderPersistentPreview(
                baselineOriginalText,
                revisedText,
                {
                    baselineHtml: baselineOriginalHtml || '',
                    revisedHtml,
                }
            );
            const renderEnd = nowMs();
            logPreviewTiming('approval-preview-main', {
                ...(scheduleTimings || {}),
                resolveMs: resolveEnd - renderStart,
                renderMs: renderEnd - resolveEnd,
                totalRenderMs: renderEnd - renderStart,
            });
            return rendered;
        }

        function applyRenderedPreview(rendered, revisedText, revisedHtml) {
            lastRenderedHtml = rendered.html;
            lastRenderedEditorText = revisedText;
            lastRenderedEditorHtml = revisedHtml || '';
            preview.innerHTML = rendered.html;
            markPreviewFresh(rendered);
        }

        function settleRequest(request, error, rendered) {
            const waiters = request && Array.isArray(request.waiters) ? request.waiters : [];
            request.waiters = [];
            waiters.forEach((waiter) => {
                if (error) {
                    waiter.reject(error);
                } else {
                    waiter.resolve(rendered);
                }
            });
        }

        function clearActiveTimeout() {
            if (activeRequest && activeRequest.timeoutId) {
                clearTimeout(activeRequest.timeoutId);
                activeRequest.timeoutId = null;
            }
        }

        function startQueuedRequest() {
            if (!queuedRequest || activeRequest || destroyed) return;
            const request = queuedRequest;
            queuedRequest = null;
            startRenderRequest(request);
        }

        function resetWorker() {
            if (worker && typeof worker.terminate === 'function') {
                worker.terminate();
            }
            worker = null;
            if (canUseWorker && !destroyed) {
                worker = createWorker();
            }
        }

        function handleRenderFailure(request, error) {
            if (activeRequest === request) {
                clearActiveTimeout();
                activeRequest = null;
            }

            settleRequest(request, error);

            if (queuedRequest) {
                startQueuedRequest();
                return;
            }

            setLoading(false);
            setPreviewStatus(`Live changes: preview error - ${error.message || 'unable to render'}`);
        }

        function handleRenderedRequest(request, data) {
            if (activeRequest !== request) return;
            clearActiveTimeout();
            activeRequest = null;

            const rendered = {
                html: data.html || '',
                insertions: data.insertions || 0,
                deletions: data.deletions || 0,
            };

            if (!request.superseded && request.revision === latestRevision) {
                applyRenderedPreview(rendered, data.revisedText || request.revisedText, data.revisedHtml || request.revisedHtml || '');
                logPreviewTiming(data.source || 'approval-preview-worker', {
                    ...(request.scheduleTimings || {}),
                    workerMs: data.durationMs || 0,
                });
                settleRequest(request, null, rendered);
            } else if (queuedRequest) {
                queuedRequest.waiters = request.waiters.concat(queuedRequest.waiters || []);
                request.waiters = [];
            } else {
                settleRequest(request, null, { ...rendered, stale: true });
            }

            startQueuedRequest();
        }

        function createWorker() {
            let nextWorker = null;
            try {
                nextWorker = new global.Worker(workerUrl);
            } catch (error) {
                if (global.console && console.warn) {
                    console.warn('Approval preview worker unavailable; falling back to main-thread preview.', error);
                }
                return null;
            }

            nextWorker.onmessage = function (event) {
                const data = event.data || {};
                if (!activeRequest || data.requestId !== activeRequest.requestId) {
                    return;
                }

                const request = activeRequest;
                if (data.type === 'error') {
                    handleRenderFailure(request, new Error(data.message || 'Preview render failed'));
                    return;
                }
                if (data.type !== 'rendered') return;

                handleRenderedRequest(request, data);
            };

            nextWorker.onerror = function (event) {
                if (!activeRequest) return;
                const message = event && event.message ? event.message : 'Preview worker failed';
                handleRenderFailure(activeRequest, new Error(message));
            };

            return nextWorker;
        }

        function buildRenderRequest(options) {
            const opts = options || {};
            const extractStart = nowMs();
            const revisedText = hasOwn(opts, 'revisedText') ? String(opts.revisedText || '') : getEditorText();
            const extractEnd = nowMs();
            const shouldIncludeRichHtml = pendingRichPreview ||
                !!opts.forceRichPreview ||
                revisedText === lastRenderedEditorText ||
                revisedText.length <= richPreviewTextLimit;
            const htmlStart = nowMs();
            const revisedHtml = hasOwn(opts, 'revisedHtml')
                ? String(opts.revisedHtml || '')
                : (shouldIncludeRichHtml ? getEditorHtml() : '');
            const htmlEnd = nowMs();

            pendingRichPreview = false;

            return {
                requestId: ++nextRequestId,
                revision: latestRevision,
                revisedText,
                revisedHtml,
                forceRender: !!opts.forceRender,
                waiters: [],
                superseded: false,
                timeoutId: null,
                scheduleTimings: {
                    extractTextMs: extractEnd - extractStart,
                    getHtmlMs: htmlEnd - htmlStart,
                    revisedChars: revisedText.length,
                    richHtmlChars: revisedHtml.length,
                },
            };
        }

        function startRenderRequest(request) {
            if (destroyed) {
                settleRequest(request, new Error('Approval preview controller was destroyed'));
                return;
            }

            activeRequest = request;

            if (!worker) {
                setTimeout(() => {
                    if (activeRequest !== request) return;
                    try {
                        const rendered = renderPreviewOnMainThread(
                            request.revisedText,
                            request.revisedHtml,
                            request.scheduleTimings
                        );
                        handleRenderedRequest(request, {
                            type: 'rendered',
                            requestId: request.requestId,
                            html: rendered.html,
                            insertions: rendered.insertions,
                            deletions: rendered.deletions,
                            revisedText: request.revisedText,
                            revisedHtml: request.revisedHtml,
                            durationMs: 0,
                            source: 'approval-preview-main',
                        });
                    } catch (error) {
                        handleRenderFailure(request, error);
                    }
                }, 0);
                return;
            }

            request.timeoutId = setTimeout(() => {
                if (activeRequest !== request) return;
                const error = new Error('Preview render timed out; keep editing while the preview retries.');
                resetWorker();
                handleRenderFailure(request, error);
            }, workerTimeoutMs);

            worker.postMessage({
                type: 'render',
                requestId: request.requestId,
                baselineText,
                baselinePreviewText,
                baselineAnnotations,
                baselineHtml: baselineOriginalHtml || displayBaselineHtml || '',
                baselineOriginalText,
                baselineOriginalHtml,
                annotationMap,
                revisedText: request.revisedText,
                revisedHtml: request.revisedHtml,
            });
        }

        function enqueueRenderRequest(request) {
            if (activeRequest) {
                activeRequest.superseded = true;
                request.waiters = activeRequest.waiters.concat(request.waiters || []);
                activeRequest.waiters = [];

                if (queuedRequest) {
                    request.waiters = queuedRequest.waiters.concat(request.waiters || []);
                }
                queuedRequest = request;
                return;
            }

            if (queuedRequest) {
                request.waiters = queuedRequest.waiters.concat(request.waiters || []);
            }
            queuedRequest = request;
            startQueuedRequest();
        }

        function renderLatestPreview(options) {
            const request = buildRenderRequest(options);

            if (!request.forceRender &&
                request.revisedText === lastRenderedEditorText &&
                request.revisedHtml === lastRenderedEditorHtml) {
                markPreviewFresh();
                return Promise.resolve({ unchanged: true });
            }

            return new Promise((resolve, reject) => {
                request.waiters.push({ resolve, reject });
                enqueueRenderRequest(request);
            });
        }

        function schedulePreviewUpdate(options) {
            const opts = options || {};
            editorHasUserInput = true;
            pendingRichPreview = pendingRichPreview || !!opts.forceRichPreview;
            previewIsStale = true;
            latestRevision++;
            markPreviewStale();

            clearTimeout(previewUpdateTimer);
            const delay = opts.immediate ? 0 : debounceMs;
            previewUpdateTimer = setTimeout(() => {
                renderLatestPreview().catch((error) => {
                    setLoading(false);
                    setPreviewStatus(`Live changes: preview error - ${error.message}`);
                });
            }, delay);
        }

        function buildSubmissionPreviewHtml() {
            if (!lastRenderedHtml) {
                return displayBaselineHtml || '';
            }
            return lastRenderedHtml
                .split('\n')
                .map((lineHtml) => `<p>${lineHtml || '<br>'}</p>`)
                .join('');
        }

        async function submitApproval() {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';

            try {
                const menuContentText = getEditorText();
                if (previewIsStale || lastRenderedEditorText !== menuContentText) {
                    submitBtn.textContent = 'Refreshing preview...';
                    await renderLatestPreview({ revisedText: menuContentText, forceRender: true });
                }
                const editorHtml = buildSubmissionPreviewHtml();

                if (!menuContentText.trim()) {
                    throw new Error('Approval editor is empty.');
                }

                const response = await fetch(settings.submitUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        editorHtml,
                        menuContentText,
                    }),
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to submit approval');
                }

                const targetSubmissionId = (data && data.submissionId) || settings.submissionId;
                // Only after the server confirms the approval — a failed submit must leave
                // the draft intact, since that is precisely when it is needed.
                clearStoredDraft();
                submitBtn.textContent = 'Loading corrections...';
                global.location.assign(settings.learningUrlBase + encodeURIComponent(targetSubmissionId));
            } catch (error) {
                console.error(error);
                showAlert(`Error submitting approval: ${error.message}`, 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Approval';
            }
        }

        function cancelActiveAndQueued() {
            if (queuedRequest) {
                settleRequest(queuedRequest, null, { stale: true });
                queuedRequest = null;
            }
            if (activeRequest) {
                activeRequest.superseded = true;
                clearActiveTimeout();
                settleRequest(activeRequest, null, { stale: true });
                activeRequest = null;
            }
        }

        function restoreOriginal() {
            editor.innerHTML = baselineEditorHtml;
            editorHasUserInput = false;
            pendingRichPreview = false;
            previewIsStale = false;
            clearTimeout(previewUpdateTimer);
            cancelActiveAndQueued();
            lastRenderedHtml = '';
            lastRenderedEditorText = baselineFixedText;
            lastRenderedEditorHtml = '';
            const rendered = renderPreviewOnMainThread(
                baselineFixedText,
                baselineEditorHtml,
                null
            );
            lastRenderedHtml = rendered.html;
            lastRenderedEditorHtml = baselineEditorHtml;
            preview.innerHTML = rendered.html;
            markPreviewFresh(rendered);
            clearStoredDraft(); // Explicit revert — the recovered session is no longer wanted.
            editor.focus();
            showAlert('Editor reset to the submitted menu text.', 'success');
        }

        worker = canUseWorker ? createWorker() : null;
        editor.innerHTML = baselineEditorHtml;
        const restoredDraft = restoreDraftIfAvailable();
        const initialEditorText = restoredDraft ? getEditorText() : baselineFixedText;
        const initialEditorHtml = restoredDraft ? getEditorHtml() : baselineEditorHtml;
        const initialRendered = renderPreviewOnMainThread(
            initialEditorText,
            initialEditorHtml,
            null
        );
        applyRenderedPreview(initialRendered, initialEditorText, initialEditorHtml);

        if (restoredDraft) {
            editorHasUserInput = true;
            showAlert(
                `Restored your unsaved edits from ${formatDraftAge(restoredDraft.savedAt, Date.now())}. `
                + 'Use "Restore Original" to go back to the submitted menu.',
                'success'
            );
        }

        editor.addEventListener('input', () => {
            schedulePreviewUpdate();
            scheduleDraftSave();
        });

        // Closing the tab mid-debounce would otherwise drop the last edits — the exact
        // moment recovery matters most.
        const flushDraftOnExit = () => saveDraftNow();
        if (typeof global.addEventListener === 'function') {
            global.addEventListener('beforeunload', flushDraftOnExit);
        }
        editor.addEventListener('keydown', (event) => {
            const key = String(event.key || '').toLowerCase();
            if ((event.metaKey || event.ctrlKey) && key === 'b') {
                setTimeout(() => schedulePreviewUpdate({ forceRichPreview: true }), 0);
            }
        });
        restoreBtn.addEventListener('click', restoreOriginal);
        submitBtn.addEventListener('click', submitApproval);

        return {
            schedulePreviewUpdate,
            renderLatestPreview,
            getDebugState() {
                return {
                    activeRequestId: activeRequest ? activeRequest.requestId : null,
                    queuedRequestId: queuedRequest ? queuedRequest.requestId : null,
                    previewIsStale,
                    latestRevision,
                };
            },
            saveDraftNow,
            clearStoredDraft,
            destroy() {
                destroyed = true;
                clearTimeout(draftSaveTimer);
                if (typeof global.removeEventListener === 'function') {
                    global.removeEventListener('beforeunload', flushDraftOnExit);
                }
                clearTimeout(previewUpdateTimer);
                cancelActiveAndQueued();
                if (worker) worker.terminate();
                worker = null;
            },
        };
    }

    const api = {
        createApprovalPreviewController,
        draftStorageKey,
        fingerprintText,
        isRestorableDraft,
        formatDraftAge,
    };

    global.MenuApprovalPreviewController = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

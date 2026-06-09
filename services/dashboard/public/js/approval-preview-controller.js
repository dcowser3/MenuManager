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
        const baselineResolverText = redlinePreview.stripExistingDeletions(
            baselinePreviewText,
            annotationMap
        );
        const baselineEditorHtml = redlinePreview.buildEditableHtmlFromBaseline(displayBaselineHtml, baselineText);
        const canUseWorker = hasImportedAnnotations && typeof global.Worker === 'function';
        const workerUrl = settings.workerUrl || '/js/approval-preview-worker.js';

        let worker = null;
        let previewUpdateTimer = null;
        let lastRenderedEditorText = baselineText;
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
            const resolvedPreview = redlinePreview.resolveExistingAnnotationRevisions(
                baselineResolverText || baselineText,
                revisedText,
                baselinePreviewText,
                annotationMap,
                { baselineHtml: displayBaselineHtml || '' }
            );
            const resolveEnd = nowMs();
            const rendered = redlinePreview.renderPersistentPreview(
                resolvedPreview.basePreviewText,
                resolvedPreview.revisedPreviewText,
                {
                    annotationMap: resolvedPreview.annotationMap,
                    revisedAnnotationMap: resolvedPreview.revisedAnnotationMap,
                    includeExistingAnnotations: true,
                    baselineHtml: resolvedPreview.baselineHtml || '',
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
                baselineHtml: displayBaselineHtml || '',
                baselineResolverText,
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
            lastRenderedEditorText = baselineText;
            lastRenderedEditorHtml = '';
            preview.innerHTML = displayBaselineHtml || '';
            markPreviewFresh({ insertions: 0, deletions: 0 });
            editor.focus();
            showAlert('Editor reset to the submitted menu text.', 'success');
        }

        worker = canUseWorker ? createWorker() : null;
        editor.innerHTML = baselineEditorHtml;
        preview.innerHTML = displayBaselineHtml || '';
        markPreviewFresh({ insertions: 0, deletions: 0 });

        editor.addEventListener('input', () => schedulePreviewUpdate());
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
            destroy() {
                destroyed = true;
                clearTimeout(previewUpdateTimer);
                cancelActiveAndQueued();
                if (worker) worker.terminate();
                worker = null;
            },
        };
    }

    const api = {
        createApprovalPreviewController,
    };

    global.MenuApprovalPreviewController = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

importScripts('/js/diff-core.js', '/js/redline-preview.js');

(function () {
    const redlinePreview = self.MenuRedlinePreview;

    function buildAnnotationMap(previewText, annotations) {
        return Array.isArray(annotations) && annotations.length
            ? redlinePreview.buildAnnotationMapFromParagraphAnnotations(previewText, annotations)
            : {};
    }

    self.onmessage = function (event) {
        const payload = event.data || {};
        if (payload.type !== 'render') return;

        const startedAt = Date.now();
        try {
            const annotationMap = payload.annotationMap || buildAnnotationMap(
                payload.baselinePreviewText || '',
                payload.baselineAnnotations || []
            );
            const baselineResolverText = payload.baselineResolverText ||
                redlinePreview.stripExistingDeletions(payload.baselinePreviewText || '', annotationMap);
            const resolvedPreview = redlinePreview.resolveExistingAnnotationRevisions(
                baselineResolverText || payload.baselineText || '',
                payload.revisedText || '',
                payload.baselinePreviewText || payload.baselineText || '',
                annotationMap,
                { baselineHtml: payload.baselineHtml || '' }
            );
            const rendered = redlinePreview.renderPersistentPreview(
                resolvedPreview.basePreviewText,
                resolvedPreview.revisedPreviewText,
                {
                    annotationMap: resolvedPreview.annotationMap,
                    includeExistingAnnotations: true,
                    baselineHtml: resolvedPreview.baselineHtml || '',
                    revisedHtml: payload.revisedHtml || '',
                }
            );

            self.postMessage({
                type: 'rendered',
                requestId: payload.requestId,
                html: rendered.html,
                insertions: rendered.insertions,
                deletions: rendered.deletions,
                revisedText: payload.revisedText || '',
                revisedHtml: payload.revisedHtml || '',
                durationMs: Date.now() - startedAt,
            });
        } catch (error) {
            self.postMessage({
                type: 'error',
                requestId: payload.requestId,
                message: error && error.message ? error.message : String(error),
            });
        }
    };
})();

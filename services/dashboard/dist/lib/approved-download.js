"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveApprovedDownload = resolveApprovedDownload;
/**
 * Resolve an approved DOCX without ever regenerating the reviewer-original
 * artifact. The caller supplies the storage and HTTP details so this ordering
 * remains unit-testable and independent of Express.
 */
async function resolveApprovedDownload(input, deps) {
    const localPath = await deps.findLocal();
    if (localPath) {
        return { source: 'local', filePath: localPath };
    }
    if (input.hasSharePointCopy) {
        const sharePointContents = await deps.fetchSharePoint();
        if (sharePointContents) {
            return {
                source: 'sharepoint',
                filePath: await deps.materializeSharePoint(sharePointContents),
            };
        }
    }
    if (input.allowRegeneration) {
        const regeneratedPath = await deps.regenerateClean();
        if (regeneratedPath) {
            return { source: 'regenerated', filePath: regeneratedPath };
        }
    }
    return { source: 'unavailable', filePath: null };
}

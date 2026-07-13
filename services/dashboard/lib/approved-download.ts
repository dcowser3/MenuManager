export type ApprovedDownloadFallbackInput = {
    hasSharePointCopy: boolean;
    allowRegeneration: boolean;
};

export type ApprovedDownloadFallbackDeps = {
    findLocal: () => Promise<string | null>;
    fetchSharePoint: () => Promise<Buffer | null>;
    materializeSharePoint: (contents: Buffer) => Promise<string>;
    regenerateClean: () => Promise<string | null>;
};

export type ApprovedDownloadResolution =
    | { source: 'local' | 'sharepoint' | 'regenerated'; filePath: string }
    | { source: 'unavailable'; filePath: null };

/**
 * Resolve an approved DOCX without ever regenerating the reviewer-original
 * artifact. The caller supplies the storage and HTTP details so this ordering
 * remains unit-testable and independent of Express.
 */
export async function resolveApprovedDownload(
    input: ApprovedDownloadFallbackInput,
    deps: ApprovedDownloadFallbackDeps
): Promise<ApprovedDownloadResolution> {
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

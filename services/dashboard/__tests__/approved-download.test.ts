import { resolveApprovedDownload } from '../lib/approved-download';

function createDeps(overrides: Partial<any> = {}) {
    return {
        findLocal: jest.fn(async () => null),
        fetchSharePoint: jest.fn(async () => null),
        materializeSharePoint: jest.fn(async () => '/mnt/documents/recovered.docx'),
        regenerateClean: jest.fn(async () => '/mnt/documents/regenerated-clean.docx'),
        ...overrides,
    };
}

describe('approved DOCX download fallback chain', () => {
    test('uses a local artifact without contacting SharePoint or regenerating', async () => {
        const deps = createDeps({ findLocal: jest.fn(async () => '/mnt/documents/approved.docx') });

        await expect(resolveApprovedDownload({ hasSharePointCopy: true, allowRegeneration: true }, deps))
            .resolves.toEqual({ source: 'local', filePath: '/mnt/documents/approved.docx' });

        expect(deps.fetchSharePoint).not.toHaveBeenCalled();
        expect(deps.regenerateClean).not.toHaveBeenCalled();
    });

    test('uses and materializes the SharePoint copy after a local miss', async () => {
        const contents = Buffer.from('docx');
        const deps = createDeps({ fetchSharePoint: jest.fn(async () => contents) });

        await expect(resolveApprovedDownload({ hasSharePointCopy: true, allowRegeneration: true }, deps))
            .resolves.toEqual({ source: 'sharepoint', filePath: '/mnt/documents/recovered.docx' });

        expect(deps.materializeSharePoint).toHaveBeenCalledWith(contents);
        expect(deps.regenerateClean).not.toHaveBeenCalled();
    });

    test('regenerates only the clean download after local and SharePoint misses', async () => {
        const deps = createDeps();

        await expect(resolveApprovedDownload({ hasSharePointCopy: true, allowRegeneration: true }, deps))
            .resolves.toEqual({ source: 'regenerated', filePath: '/mnt/documents/regenerated-clean.docx' });

        expect(deps.fetchSharePoint).toHaveBeenCalledTimes(1);
        expect(deps.regenerateClean).toHaveBeenCalledTimes(1);
    });

    test('does not regenerate the original approved download', async () => {
        const deps = createDeps();

        await expect(resolveApprovedDownload({ hasSharePointCopy: true, allowRegeneration: false }, deps))
            .resolves.toEqual({ source: 'unavailable', filePath: null });

        expect(deps.regenerateClean).not.toHaveBeenCalled();
    });
});

import {
    buildSharePointUploadLogLine,
    logSharePointUploadEvent,
} from '../lib/sharepoint-upload-logging';

describe('SharePoint upload logging', () => {
    test('builds compact structured log lines without empty fields', () => {
        const line = buildSharePointUploadLogLine('skipped', {
            submissionId: 'sub_123',
            property: 'Tamayo - Denver',
            servicePeriod: 'Dinner',
            skipped: 'graph credentials not configured',
            emptyValue: '',
            nullValue: null,
            undefinedValue: undefined,
        });

        expect(line).toBe('[sharepoint-upload] skipped {"submissionId":"sub_123","property":"Tamayo - Denver","servicePeriod":"Dinner","skipped":"graph credentials not configured"}');
    });

    test('writes the same structured line to console', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        logSharePointUploadEvent('start', {
            submissionId: 'sub_456',
            storagePath: 'Tamayo/Brand & Marketing/Media Library/Menu Files/Dinner/Tamayo_Dinner_5.22.26.docx',
        });

        expect(logSpy).toHaveBeenCalledWith(
            '[sharepoint-upload] start {"submissionId":"sub_456","storagePath":"Tamayo/Brand & Marketing/Media Library/Menu Files/Dinner/Tamayo_Dinner_5.22.26.docx"}'
        );

        logSpy.mockRestore();
    });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sharepoint_upload_logging_1 = require("../lib/sharepoint-upload-logging");
describe('describeSharePointSkip', () => {
    test('an unconfigured property alerts, naming the property and the fix', () => {
        const alert = (0, sharepoint_upload_logging_1.describeSharePointSkip)('property has no sharepoint routing config', {
            projectName: 'Lona Dinner Menu',
            property: 'Lona - Noelle - Nashville',
        });
        expect(alert).toMatchObject({
            alert_type: 'sharepoint_property_unconfigured',
            severity: 'warning',
        });
        expect(alert?.message).toContain('was NOT uploaded');
        expect(alert?.message).toContain('Lona - Noelle - Nashville');
        expect(alert?.message).toContain('sync-sharepoint-property.js');
    });
    test('cooldown key is per property so one property does not mute another', () => {
        const nashville = (0, sharepoint_upload_logging_1.describeSharePointSkip)('property has no sharepoint routing config', {
            projectName: 'A',
            property: 'Lona - Noelle - Nashville',
        });
        const tampa = (0, sharepoint_upload_logging_1.describeSharePointSkip)('property has no sharepoint routing config', {
            projectName: 'B',
            property: 'Lona - Marriott Tampa Water Street - Tampa',
        });
        expect(nashville?.cooldownKey).not.toBe(tampa?.cooldownKey);
        expect(nashville?.cooldownKey).toBe('sharepoint_property_unconfigured:Lona - Noelle - Nashville');
    });
    test('missing graph credentials keeps its existing alert type and global cooldown', () => {
        const alert = (0, sharepoint_upload_logging_1.describeSharePointSkip)('graph credentials not configured', { projectName: 'X', property: 'Y' });
        expect(alert?.alert_type).toBe('sharepoint_upload_skipped');
        expect(alert?.cooldownKey).toBe('sharepoint_upload_skipped');
    });
    test('a successful upload or an unknown reason produces no alert', () => {
        expect((0, sharepoint_upload_logging_1.describeSharePointSkip)(undefined, {})).toBeNull();
        expect((0, sharepoint_upload_logging_1.describeSharePointSkip)('', {})).toBeNull();
        expect((0, sharepoint_upload_logging_1.describeSharePointSkip)('some future reason', {})).toBeNull();
    });
    test('falls back to placeholders when project/property are missing', () => {
        const alert = (0, sharepoint_upload_logging_1.describeSharePointSkip)('property has no sharepoint routing config', {});
        expect(alert?.message).toContain('Untitled menu');
        expect(alert?.cooldownKey).toBe('sharepoint_property_unconfigured:unknown');
    });
});
describe('SharePoint upload logging', () => {
    test('builds compact structured log lines without empty fields', () => {
        const line = (0, sharepoint_upload_logging_1.buildSharePointUploadLogLine)('skipped', {
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
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        (0, sharepoint_upload_logging_1.logSharePointUploadEvent)('start', {
            submissionId: 'sub_456',
            storagePath: 'Tamayo/Brand & Marketing/Media Library/Menu Files/Dinner/Tamayo_Dinner_5.22.26.docx',
        });
        expect(logSpy).toHaveBeenCalledWith('[sharepoint-upload] start {"submissionId":"sub_456","storagePath":"Tamayo/Brand & Marketing/Media Library/Menu Files/Dinner/Tamayo_Dinner_5.22.26.docx"}');
        logSpy.mockRestore();
    });
});

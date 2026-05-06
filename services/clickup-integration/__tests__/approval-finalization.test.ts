import {
    buildApprovedDocxAssetRecord,
    buildApprovedSubmissionUpdate,
    buildSharePointApprovedDocxAssetRecord,
} from '../lib/approval-finalization';

describe('clickup approval finalization builders', () => {
    test('buildApprovedSubmissionUpdate shapes the approved submission patch', () => {
        const now = new Date('2026-05-05T14:00:00.000Z');
        expect(buildApprovedSubmissionUpdate({
            approvedPath: '/tmp/documents/form-1/approved/form-1-approved.docx',
            extractedRaw: 'RAW MENU',
            extractedClean: 'Clean Menu',
            now,
        })).toEqual({
            status: 'approved',
            final_path: '/tmp/documents/form-1/approved/form-1-approved.docx',
            approved_menu_content_raw: 'RAW MENU',
            approved_menu_content: 'Clean Menu',
            approved_text_extracted_at: '2026-05-05T14:00:00.000Z',
        });
    });

    test('buildApprovedSubmissionUpdate omits extracted text metadata when clean text is empty', () => {
        expect(buildApprovedSubmissionUpdate({
            approvedPath: '/tmp/documents/form-1/approved/form-1-approved.docx',
            extractedRaw: '  ',
            extractedClean: '',
        })).toEqual({
            status: 'approved',
            final_path: '/tmp/documents/form-1/approved/form-1-approved.docx',
            approved_menu_content_raw: undefined,
            approved_menu_content: undefined,
            approved_text_extracted_at: undefined,
        });
    });

    test('buildApprovedDocxAssetRecord shapes the local approved doc asset', () => {
        expect(buildApprovedDocxAssetRecord({
            submissionId: 'sub_1',
            approvedPath: '/tmp/documents/form-1/approved/form-1-approved.docx',
            source: 'browser_approval_editor',
            clickupTaskId: 'cu_123',
            attachmentId: 'att_456',
        })).toEqual({
            submission_id: 'sub_1',
            asset_type: 'approved_docx',
            source: 'browser_approval_editor',
            storage_provider: 'local',
            storage_path: '/tmp/documents/form-1/approved/form-1-approved.docx',
            file_name: 'form-1-approved.docx',
            meta: {
                clickup_task_id: 'cu_123',
                attachment_id: 'att_456',
            },
        });
    });

    test('buildSharePointApprovedDocxAssetRecord shapes the SharePoint asset metadata', () => {
        expect(buildSharePointApprovedDocxAssetRecord({
            submissionId: 'sub_1',
            storagePath: 'Properties/Toro/approved/Spring Menu.docx',
            approvedFileName: 'Spring Menu.docx',
            clickupTaskId: 'cu_123',
            siteId: 'site_1',
            driveId: 'drive_1',
            webUrl: 'https://example.com/docx',
            matchedFolder: 'Toro/approved',
            archivedDocxCount: 2,
        })).toEqual({
            submission_id: 'sub_1',
            asset_type: 'sharepoint_approved_docx',
            source: 'sharepoint_graph',
            storage_provider: 'sharepoint',
            storage_path: 'Properties/Toro/approved/Spring Menu.docx',
            file_name: 'Spring Menu.docx',
            meta: {
                clickup_task_id: 'cu_123',
                site_id: 'site_1',
                drive_id: 'drive_1',
                web_url: 'https://example.com/docx',
                matched_folder: 'Toro/approved',
                archived_docx_count: 2,
            },
        });
    });
});

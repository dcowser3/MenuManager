import {
    buildApprovalFinalizeRequest,
    buildApprovedSubmissionUpdate,
    buildDesignedPdfAssetRecord,
    buildDesignApprovalOverrideUpdate,
    buildDesignApprovalSubmissionRecord,
} from '../lib/approval-transitions';

describe('approval transition builders', () => {
    test('buildApprovedSubmissionUpdate shapes the standard approval patch', () => {
        const now = new Date('2026-05-05T12:00:00.000Z');
        expect(buildApprovedSubmissionUpdate({
            finalPath: '/tmp/finals/form-1-final.docx',
            changesMade: true,
            now,
        })).toEqual({
            status: 'approved',
            final_path: '/tmp/finals/form-1-final.docx',
            reviewed_at: '2026-05-05T12:00:00.000Z',
            changes_made: true,
        });
    });

    test('buildDesignApprovalSubmissionRecord shapes the design approval record', () => {
        const now = new Date('2026-05-05T12:30:00.000Z');
        expect(buildDesignApprovalSubmissionRecord({
            submissionId: 'design-123',
            submitterEmail: 'isa@example.com',
            submitterName: 'Isabella',
            submitterJobTitle: 'Designer',
            projectName: 'Summer Menu',
            property: 'Toro - Chicago',
            size: '8.5 x 11',
            orientation: 'Portrait',
            pdfFileName: 'summer.pdf',
            pdfPath: '/tmp/documents/design-123/summer.pdf',
            status: 'needs_correction',
            requiredApprovals: [{ role: 'GM', approved: true }],
            sourceMenuId: 'menu-1',
            sourceSubmissionId: 'form-1',
            clickupTaskId: 'cu-1',
            differences: [{ type: 'missing', severity: 'critical' }],
            visualReview: { status: 'completed' },
            servicePeriod: 'Dinner',
            now,
        })).toEqual({
            id: 'design-123',
            submitter_email: 'isa@example.com',
            submitter_name: 'Isabella',
            submitter_job_title: 'Designer',
            project_name: 'Summer Menu',
            property: 'Toro - Chicago',
            size: '8.5 x 11',
            orientation: 'Portrait',
            service_period: 'Dinner',
            filename: 'summer.pdf',
            asset_type: 'design_pdf',
            status: 'needs_correction',
            created_at: '2026-05-05T12:30:00.000Z',
            reviewed_at: undefined,
            source: 'design_approval',
            revision_base_submission_id: 'form-1',
            clickup_task_id: 'cu-1',
            approvals: JSON.stringify([{ role: 'GM', approved: true }]),
            mismatch_override: false,
            raw_payload: {
                design_approval: {
                    menu_id: 'menu-1',
                    source_submission_id: 'form-1',
                    pdf_path: '/tmp/documents/design-123/summer.pdf',
                    pdf_file_name: 'summer.pdf',
                    comparison_passed: false,
                    differences: [{ type: 'missing', severity: 'critical' }],
                    visual_review: { status: 'completed' },
                    handoff: { status: 'not_started' },
                },
            },
        });
    });

    test('buildDesignedPdfAssetRecord links the proof to its review and approved source', () => {
        expect(buildDesignedPdfAssetRecord({
            submissionId: 'design-123',
            sourceSubmissionId: 'form-1',
            sourceMenuId: 'menu-1',
            pdfPath: '/tmp/documents/design-123/summer.pdf',
            pdfFileName: 'summer.pdf',
            clickupTaskId: 'cu-1',
        })).toEqual({
            submission_id: 'design-123',
            revision_submission_id: 'form-1',
            asset_type: 'designed_pdf',
            source: 'design_approval',
            storage_provider: 'local',
            storage_path: '/tmp/documents/design-123/summer.pdf',
            file_name: 'summer.pdf',
            meta: {
                source_menu_id: 'menu-1',
                source_submission_id: 'form-1',
                clickup_task_id: 'cu-1',
            },
        });
    });

    test('buildDesignApprovalOverrideUpdate shapes the override patch', () => {
        const now = new Date('2026-05-05T13:00:00.000Z');
        expect(buildDesignApprovalOverrideUpdate('Approved by exception', now)).toEqual({
            status: 'approved_override',
            reviewed_at: '2026-05-05T13:00:00.000Z',
            mismatch_override: true,
            mismatch_override_reason: 'Approved by exception',
            mismatch_override_at: '2026-05-05T13:00:00.000Z',
        });
    });

    test('buildApprovalFinalizeRequest shapes the finalize payload', () => {
        expect(buildApprovalFinalizeRequest({
            submissionId: 'sub_approval_1',
            approvedPath: '/tmp/documents/sub_approval_1-approved.docx',
            approvedFileName: 'Spring Menu.docx',
        })).toEqual({
            submissionId: 'sub_approval_1',
            approvedPath: '/tmp/documents/sub_approval_1-approved.docx',
            approvedFileName: 'Spring Menu.docx',
        });
    });
});

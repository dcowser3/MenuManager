"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const approval_transitions_1 = require("../lib/approval-transitions");
describe('approval transition builders', () => {
    test('buildApprovedSubmissionUpdate shapes the standard approval patch', () => {
        const now = new Date('2026-05-05T12:00:00.000Z');
        expect((0, approval_transitions_1.buildApprovedSubmissionUpdate)({
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
        expect((0, approval_transitions_1.buildDesignApprovalSubmissionRecord)({
            submissionId: 'design-123',
            submitterEmail: 'isa@example.com',
            submitterName: 'Isabella',
            submitterJobTitle: 'Designer',
            projectName: 'Summer Menu',
            property: 'Toro - Chicago',
            size: '8.5 x 11',
            orientation: 'Portrait',
            fileName: 'summer.docx',
            status: 'needs_correction',
            requiredApprovals: [{ role: 'GM', approved: true }],
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
            filename: 'summer.docx',
            status: 'needs_correction',
            created_at: '2026-05-05T12:30:00.000Z',
            source: 'design_approval',
            approvals: JSON.stringify([{ role: 'GM', approved: true }]),
            mismatch_override: false,
        });
    });
    test('buildDesignApprovalOverrideUpdate shapes the override patch', () => {
        const now = new Date('2026-05-05T13:00:00.000Z');
        expect((0, approval_transitions_1.buildDesignApprovalOverrideUpdate)('Approved by exception', now)).toEqual({
            status: 'approved_override',
            mismatch_override: true,
            mismatch_override_reason: 'Approved by exception',
            mismatch_override_at: '2026-05-05T13:00:00.000Z',
        });
    });
    test('buildApprovalFinalizeRequest shapes the finalize payload', () => {
        expect((0, approval_transitions_1.buildApprovalFinalizeRequest)({
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

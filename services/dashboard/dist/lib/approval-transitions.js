"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApprovedSubmissionUpdate = buildApprovedSubmissionUpdate;
exports.buildDesignApprovalSubmissionRecord = buildDesignApprovalSubmissionRecord;
exports.buildDesignedPdfAssetRecord = buildDesignedPdfAssetRecord;
exports.buildDesignApprovalOverrideUpdate = buildDesignApprovalOverrideUpdate;
exports.buildApprovalFinalizeRequest = buildApprovalFinalizeRequest;
function buildApprovedSubmissionUpdate(input) {
    return {
        status: 'approved',
        final_path: input.finalPath,
        reviewed_at: (input.now || new Date()).toISOString(),
        changes_made: input.changesMade,
    };
}
function buildDesignApprovalSubmissionRecord(input) {
    const now = input.now || new Date();
    return {
        id: input.submissionId,
        submitter_email: input.submitterEmail,
        submitter_name: input.submitterName,
        submitter_job_title: input.submitterJobTitle,
        project_name: input.projectName || 'Design Approval',
        property: input.property || '',
        size: input.size || '',
        orientation: input.orientation || '',
        service_period: input.servicePeriod || '',
        filename: input.pdfFileName || 'design-approval.pdf',
        asset_type: 'design_pdf',
        status: input.status,
        created_at: now.toISOString(),
        reviewed_at: input.status === 'approved' ? now.toISOString() : undefined,
        source: 'design_approval',
        revision_base_submission_id: input.sourceSubmissionId,
        clickup_task_id: input.clickupTaskId || undefined,
        approvals: JSON.stringify(input.requiredApprovals),
        mismatch_override: false,
        raw_payload: {
            design_approval: {
                menu_id: input.sourceMenuId,
                source_submission_id: input.sourceSubmissionId,
                pdf_path: input.pdfPath,
                pdf_file_name: input.pdfFileName,
                comparison_passed: input.status === 'approved',
                differences: input.differences || [],
                visual_review: input.visualReview || null,
                handoff: {
                    status: input.status === 'approved' ? 'pending' : 'not_started',
                },
            },
        },
    };
}
function buildDesignedPdfAssetRecord(input) {
    return {
        submission_id: input.submissionId,
        revision_submission_id: input.sourceSubmissionId,
        asset_type: 'designed_pdf',
        source: 'design_approval',
        storage_provider: 'local',
        storage_path: input.pdfPath,
        file_name: input.pdfFileName,
        meta: {
            source_menu_id: input.sourceMenuId,
            source_submission_id: input.sourceSubmissionId,
            clickup_task_id: input.clickupTaskId || null,
        },
    };
}
function buildDesignApprovalOverrideUpdate(reason, now = new Date()) {
    return {
        status: 'approved_override',
        reviewed_at: now.toISOString(),
        mismatch_override: true,
        mismatch_override_reason: reason,
        mismatch_override_at: now.toISOString(),
    };
}
function buildApprovalFinalizeRequest(input) {
    return {
        submissionId: input.submissionId,
        approvedPath: input.approvedPath,
        approvedFileName: input.approvedFileName,
    };
}

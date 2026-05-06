"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApprovedSubmissionUpdate = buildApprovedSubmissionUpdate;
exports.buildDesignApprovalSubmissionRecord = buildDesignApprovalSubmissionRecord;
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
    return {
        id: input.submissionId,
        submitter_email: input.submitterEmail,
        submitter_name: input.submitterName,
        submitter_job_title: input.submitterJobTitle,
        project_name: input.projectName || 'Design Approval',
        property: input.property || '',
        size: input.size || '',
        orientation: input.orientation || '',
        filename: input.fileName || 'design-approval.docx',
        status: input.status,
        created_at: (input.now || new Date()).toISOString(),
        source: 'design_approval',
        approvals: JSON.stringify(input.requiredApprovals),
        mismatch_override: false,
    };
}
function buildDesignApprovalOverrideUpdate(reason, now = new Date()) {
    return {
        status: 'approved_override',
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

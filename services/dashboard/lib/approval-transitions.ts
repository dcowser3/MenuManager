type ApprovedSubmissionUpdateInput = {
    finalPath: string;
    changesMade: boolean;
    now?: Date;
};

type DesignApprovalSubmissionRecordInput = {
    submissionId: string;
    submitterEmail: string;
    submitterName: string;
    submitterJobTitle: string;
    projectName: string;
    property: string;
    size: string;
    orientation: string;
    fileName: string;
    status: 'approved' | 'needs_correction';
    requiredApprovals: any[];
    servicePeriod?: string;
    now?: Date;
};

type ApprovalFinalizeRequestInput = {
    submissionId: string;
    approvedPath: string;
    approvedFileName: string;
};

export function buildApprovedSubmissionUpdate(input: ApprovedSubmissionUpdateInput) {
    return {
        status: 'approved',
        final_path: input.finalPath,
        reviewed_at: (input.now || new Date()).toISOString(),
        changes_made: input.changesMade,
    };
}

export function buildDesignApprovalSubmissionRecord(input: DesignApprovalSubmissionRecordInput) {
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
        filename: input.fileName || 'design-approval.docx',
        status: input.status,
        created_at: (input.now || new Date()).toISOString(),
        source: 'design_approval',
        approvals: JSON.stringify(input.requiredApprovals),
        mismatch_override: false,
    };
}

export function buildDesignApprovalOverrideUpdate(reason: string, now = new Date()) {
    return {
        status: 'approved_override',
        mismatch_override: true,
        mismatch_override_reason: reason,
        mismatch_override_at: now.toISOString(),
    };
}

export function buildApprovalFinalizeRequest(input: ApprovalFinalizeRequestInput) {
    return {
        submissionId: input.submissionId,
        approvedPath: input.approvedPath,
        approvedFileName: input.approvedFileName,
    };
}

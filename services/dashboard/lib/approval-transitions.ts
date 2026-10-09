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
    pdfFileName: string;
    pdfPath: string;
    status: 'approved' | 'needs_correction';
    requiredApprovals: any[];
    sourceMenuId: string;
    sourceSubmissionId: string;
    clickupTaskId?: string;
    differences?: any[];
    visualReview?: any;
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

export function buildDesignedPdfAssetRecord(input: {
    submissionId: string;
    sourceSubmissionId: string;
    sourceMenuId: string;
    pdfPath: string;
    pdfFileName: string;
    clickupTaskId?: string;
}) {
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

export function buildDesignApprovalOverrideUpdate(reason: string, now = new Date()) {
    return {
        status: 'approved_override',
        reviewed_at: now.toISOString(),
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

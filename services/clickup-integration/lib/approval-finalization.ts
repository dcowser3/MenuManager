import path from 'path';

type ApprovedSubmissionUpdateInput = {
    approvedPath: string;
    extractedRaw?: string;
    extractedClean?: string;
    now?: Date;
};

type ApprovedDocxAssetRecordInput = {
    submissionId: string;
    approvedPath: string;
    source: string;
    clickupTaskId?: string | null;
    attachmentId?: string | null;
};

type SharePointApprovedDocxAssetRecordInput = {
    submissionId: string;
    storagePath: string;
    approvedFileName: string;
    clickupTaskId?: string | null;
    siteId?: string | null;
    driveId?: string | null;
    webUrl?: string | null;
    matchedFolder?: string | null;
    archivedDocxCount?: number;
};

export function buildApprovedSubmissionUpdate(input: ApprovedSubmissionUpdateInput) {
    const extractedClean = (input.extractedClean || '').trim();
    const extractedRaw = (input.extractedRaw || '').trim();

    return {
        status: 'approved',
        final_path: input.approvedPath,
        approved_menu_content_raw: extractedRaw || undefined,
        approved_menu_content: extractedClean || undefined,
        approved_text_extracted_at: extractedClean ? (input.now || new Date()).toISOString() : undefined,
    };
}

export function buildApprovedDocxAssetRecord(input: ApprovedDocxAssetRecordInput) {
    return {
        submission_id: input.submissionId,
        asset_type: 'approved_docx',
        source: input.source,
        storage_provider: 'local',
        storage_path: input.approvedPath,
        file_name: path.basename(input.approvedPath),
        meta: {
            clickup_task_id: input.clickupTaskId || null,
            attachment_id: input.attachmentId || null,
        },
    };
}

export function buildSharePointApprovedDocxAssetRecord(input: SharePointApprovedDocxAssetRecordInput) {
    return {
        submission_id: input.submissionId,
        asset_type: 'sharepoint_approved_docx',
        source: 'sharepoint_graph',
        storage_provider: 'sharepoint',
        storage_path: input.storagePath,
        file_name: path.basename(input.storagePath || input.approvedFileName),
        meta: {
            clickup_task_id: input.clickupTaskId || null,
            site_id: input.siteId || null,
            drive_id: input.driveId || null,
            web_url: input.webUrl || null,
            matched_folder: input.matchedFolder || null,
            archived_docx_count: input.archivedDocxCount || 0,
        },
    };
}

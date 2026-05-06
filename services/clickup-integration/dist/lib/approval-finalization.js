"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApprovedSubmissionUpdate = buildApprovedSubmissionUpdate;
exports.buildApprovedDocxAssetRecord = buildApprovedDocxAssetRecord;
exports.buildSharePointApprovedDocxAssetRecord = buildSharePointApprovedDocxAssetRecord;
const path_1 = __importDefault(require("path"));
function buildApprovedSubmissionUpdate(input) {
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
function buildApprovedDocxAssetRecord(input) {
    return {
        submission_id: input.submissionId,
        asset_type: 'approved_docx',
        source: input.source,
        storage_provider: 'local',
        storage_path: input.approvedPath,
        file_name: path_1.default.basename(input.approvedPath),
        meta: {
            clickup_task_id: input.clickupTaskId || null,
            attachment_id: input.attachmentId || null,
        },
    };
}
function buildSharePointApprovedDocxAssetRecord(input) {
    return {
        submission_id: input.submissionId,
        asset_type: 'sharepoint_approved_docx',
        source: 'sharepoint_graph',
        storage_provider: 'sharepoint',
        storage_path: input.storagePath,
        file_name: path_1.default.basename(input.storagePath || input.approvedFileName),
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

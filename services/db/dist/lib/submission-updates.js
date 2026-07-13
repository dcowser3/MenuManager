"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDITABLE_SUBMISSION_FIELDS = exports.ALLOWED_SUBMISSION_STATUSES = void 0;
exports.sanitizeSubmissionUpdates = sanitizeSubmissionUpdates;
const path_1 = __importDefault(require("path"));
const EDITABLE_SUBMISSION_FIELDS = new Set([
    'status',
    'template_errors',
    'sop_format_issues',
    'sop_format_samples',
    'qa_feedback',
    'error_count',
    'ai_draft_path',
    'final_path',
    'clickup_task_id',
    'changes_made',
    'reviewed_at',
    'approved_menu_content_raw',
    'approved_menu_content',
    'approved_menu_content_html',
    'approved_text_extracted_at',
    'mismatch_override',
    'mismatch_override_reason',
    'mismatch_override_at',
    'raw_payload',
]);
exports.EDITABLE_SUBMISSION_FIELDS = EDITABLE_SUBMISSION_FIELDS;
const ALLOWED_SUBMISSION_STATUSES = new Set([
    'processing',
    'pending_human_review',
    'submitted_no_ai_review',
    'sent_to_marketing',
    'rejected_template',
    'rejected_tier1',
    'needs_prompt_fix',
    'needs_correction',
    'approved',
    'approved_override',
    'deleted',
]);
exports.ALLOWED_SUBMISSION_STATUSES = ALLOWED_SUBMISSION_STATUSES;
const ARRAY_FIELDS = new Set([
    'template_errors',
    'sop_format_issues',
    'sop_format_samples',
]);
const DATE_FIELDS = new Set([
    'reviewed_at',
    'approved_text_extracted_at',
    'mismatch_override_at',
]);
const PATH_FIELDS = new Set([
    'ai_draft_path',
    'final_path',
]);
function isInsideDirectory(candidate, root) {
    const relative = path_1.default.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path_1.default.isAbsolute(relative));
}
function sanitizeSubmissionUpdates(updates, options) {
    const allowedFields = {};
    const rejectedFields = [];
    const errors = [];
    const repoTmpRoot = path_1.default.join(options.repoRoot, 'tmp');
    const documentStorageRoot = path_1.default.resolve(options.documentStorageRoot || process.env.DOCUMENT_STORAGE_ROOT || path_1.default.join(repoTmpRoot, 'documents'));
    for (const [key, value] of Object.entries(updates || {})) {
        if (!EDITABLE_SUBMISSION_FIELDS.has(key)) {
            rejectedFields.push(key);
            continue;
        }
        if (key === 'status') {
            const normalizedStatus = `${value || ''}`.trim();
            if (!ALLOWED_SUBMISSION_STATUSES.has(normalizedStatus)) {
                errors.push(`status must be one of: ${Array.from(ALLOWED_SUBMISSION_STATUSES).join(', ')}`);
                continue;
            }
            allowedFields.status = normalizedStatus;
            continue;
        }
        if (PATH_FIELDS.has(key)) {
            const rawPath = `${value || ''}`.trim();
            if (!rawPath) {
                errors.push(`${key} must be a non-empty path inside tmp/`);
                continue;
            }
            const resolvedPath = path_1.default.resolve(rawPath);
            if (!isInsideDirectory(resolvedPath, repoTmpRoot) && !isInsideDirectory(resolvedPath, documentStorageRoot)) {
                errors.push(`${key} must stay inside the repository tmp/ directory or DOCUMENT_STORAGE_ROOT`);
                continue;
            }
            allowedFields[key] = resolvedPath;
            continue;
        }
        if (ARRAY_FIELDS.has(key)) {
            if (!Array.isArray(value)) {
                errors.push(`${key} must be an array`);
                continue;
            }
            allowedFields[key] = value;
            continue;
        }
        if (DATE_FIELDS.has(key)) {
            const normalizedDate = `${value || ''}`.trim();
            if (!normalizedDate || Number.isNaN(Date.parse(normalizedDate))) {
                errors.push(`${key} must be a valid ISO timestamp`);
                continue;
            }
            allowedFields[key] = normalizedDate;
            continue;
        }
        if (key === 'error_count') {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 0) {
                errors.push('error_count must be a non-negative number');
                continue;
            }
            allowedFields.error_count = parsed;
            continue;
        }
        if (key === 'changes_made' || key === 'mismatch_override') {
            if (typeof value !== 'boolean') {
                errors.push(`${key} must be a boolean`);
                continue;
            }
            allowedFields[key] = value;
            continue;
        }
        if (key === 'clickup_task_id') {
            if (value === null) {
                allowedFields[key] = null;
                continue;
            }
            const normalizedTaskId = `${value || ''}`.trim();
            if (!normalizedTaskId) {
                errors.push('clickup_task_id must be a non-empty string when provided');
                continue;
            }
            allowedFields[key] = normalizedTaskId;
            continue;
        }
        if (key === 'raw_payload') {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                errors.push('raw_payload must be an object');
                continue;
            }
            allowedFields[key] = value;
            continue;
        }
        if (value === null) {
            allowedFields[key] = null;
            continue;
        }
        allowedFields[key] = typeof value === 'string' ? value.trim() : value;
    }
    return {
        allowedFields,
        rejectedFields,
        errors,
    };
}

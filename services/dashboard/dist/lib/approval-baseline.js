"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.textToParagraphHtml = textToParagraphHtml;
exports.normalizeApprovalEditorText = normalizeApprovalEditorText;
exports.getApprovalSourceDocCandidates = getApprovalSourceDocCandidates;
exports.resolveApprovalSourceDocument = resolveApprovalSourceDocument;
exports.loadApprovalBaselineFromSubmission = loadApprovalBaselineFromSubmission;
const fs_1 = require("fs");
function coalesceString(...values) {
    for (const value of values) {
        const normalized = `${value ?? ''}`.trim();
        if (normalized)
            return normalized;
    }
    return '';
}
function escapeHtml(value) {
    return `${value || ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function textToParagraphHtml(text) {
    const lines = `${text || ''}`.split('\n');
    if (!lines.length)
        return '<p><br></p>';
    return lines
        .map((line) => {
        const escaped = escapeHtml(line);
        return escaped ? `<p>${escaped}</p>` : '<p><br></p>';
    })
        .join('');
}
function normalizeApprovalEditorText(text) {
    const lines = `${text || ''}`
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.replace(/\u00A0/g, ' ').replace(/[ \t]+$/g, ''));
    while (lines.length && !lines[0].trim())
        lines.shift();
    while (lines.length && !lines[lines.length - 1].trim())
        lines.pop();
    const normalized = [];
    let prevBlank = false;
    for (const line of lines) {
        if (!line.trim()) {
            if (!prevBlank)
                normalized.push('');
            prevBlank = true;
            continue;
        }
        normalized.push(line);
        prevBlank = false;
    }
    return normalized.join('\n');
}
function getSourceLabel(sourceMode) {
    if (sourceMode === 'original_docx') {
        return 'Submitted DOCX with preserved redlines';
    }
    if (sourceMode === 'approved_docx') {
        return 'Stored approved DOCX with preserved redlines';
    }
    return 'Saved submission data fallback';
}
function getSourceLabelForCandidate(candidate) {
    if (candidate.sourceMode === 'revision_baseline_docx') {
        return candidate.extractionMode === 'approved'
            ? 'Uploaded baseline DOCX from submission form'
            : 'Uploaded unapproved DOCX with preserved redlines';
    }
    return getSourceLabel(candidate.sourceMode);
}
function getApprovalSourceDocCandidates(submission) {
    const candidates = [];
    const revisionBaselinePath = coalesceString(submission.revision_baseline_doc_path);
    if (revisionBaselinePath) {
        const revisionSource = coalesceString(submission.revision_source);
        candidates.push({
            fileName: coalesceString(submission.revision_baseline_file_name, submission.filename, `${submission.id || 'submission'}.docx`),
            filePath: revisionBaselinePath,
            sourceMode: 'revision_baseline_docx',
            extractionMode: revisionSource === 'uploaded_baseline' ? 'approved' : 'unapproved',
        });
    }
    const originalPath = coalesceString(submission.original_path);
    if (originalPath) {
        candidates.push({
            fileName: coalesceString(submission.filename, `${submission.id || 'submission'}.docx`),
            filePath: originalPath,
            sourceMode: 'original_docx',
            extractionMode: 'unapproved',
        });
    }
    const finalPath = coalesceString(submission.final_path);
    if (finalPath) {
        candidates.push({
            fileName: coalesceString(submission.filename, `${submission.id || 'submission'}.docx`),
            filePath: finalPath,
            sourceMode: 'approved_docx',
            extractionMode: 'unapproved',
        });
    }
    return candidates;
}
async function resolveApprovalSourceDocument(submission, options) {
    for (const candidate of getApprovalSourceDocCandidates(submission)) {
        try {
            const absolutePath = options.resolveStoredPath(candidate.filePath);
            await fs_1.promises.access(absolutePath);
            return {
                ...candidate,
                absolutePath,
            };
        }
        catch (resolveError) {
            console.warn(`Failed to resolve approval source ${candidate.sourceMode}:`, resolveError?.message || resolveError);
        }
    }
    return null;
}
async function loadApprovalBaselineFromSubmission(submission, options) {
    let editorHtml = '';
    let visibleText = '';
    let sourceMode = 'saved_submission_data';
    let sourceLabel = getSourceLabel('saved_submission_data');
    for (const candidate of getApprovalSourceDocCandidates(submission)) {
        try {
            const absolutePath = options.resolveStoredPath(candidate.filePath);
            await fs_1.promises.access(absolutePath);
            if (candidate.extractionMode === 'approved') {
                const extracted = await options.extractApprovedFromDocx(absolutePath);
                editorHtml = `${extracted.approvedMenuContentHtml || ''}`.trim();
                visibleText = normalizeApprovalEditorText(extracted.approvedMenuContent || '');
            }
            else {
                const extracted = await options.extractUnapprovedFromDocx(absolutePath);
                editorHtml = `${extracted.unapprovedHtml || ''}`.trim();
                visibleText = normalizeApprovalEditorText(extracted.visibleText || '');
            }
            sourceMode = candidate.sourceMode;
            sourceLabel = getSourceLabelForCandidate(candidate);
            break;
        }
        catch (extractError) {
            console.warn(`Failed to load approval editor from ${candidate.sourceMode}:`, extractError?.message || extractError);
        }
    }
    if (!visibleText) {
        visibleText = normalizeApprovalEditorText(coalesceString(submission.approved_menu_content_raw, submission.approved_menu_content, submission.menu_content, submission.raw_payload?.approved_menu_content_raw, submission.raw_payload?.approved_menu_content, submission.raw_payload?.menuContent));
    }
    if (!editorHtml) {
        editorHtml = textToParagraphHtml(visibleText);
        sourceMode = 'saved_submission_data';
    }
    return {
        editorHtml,
        visibleText,
        sourceMode,
        sourceLabel,
    };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.textToParagraphHtml = textToParagraphHtml;
exports.normalizeApprovalEditorText = normalizeApprovalEditorText;
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
        .map((line) => line.replace(/\u00A0/g, ' ').trim());
    while (lines.length && !lines[0])
        lines.shift();
    while (lines.length && !lines[lines.length - 1])
        lines.pop();
    return lines.filter(Boolean).join('\n');
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
async function loadApprovalBaselineFromSubmission(submission, options) {
    let editorHtml = '';
    let visibleText = '';
    let sourceMode = 'saved_submission_data';
    const sourceDocCandidates = [
        { label: 'original_docx', filePath: coalesceString(submission.original_path) },
        { label: 'approved_docx', filePath: coalesceString(submission.final_path) },
    ];
    for (const candidate of sourceDocCandidates) {
        if (!candidate.filePath)
            continue;
        const absolutePath = options.resolveStoredPath(candidate.filePath);
        try {
            await fs_1.promises.access(absolutePath);
            const extracted = await options.extractUnapprovedFromDocx(absolutePath);
            editorHtml = `${extracted.unapprovedHtml || ''}`.trim();
            visibleText = normalizeApprovalEditorText(extracted.visibleText || '');
            sourceMode = candidate.label;
            break;
        }
        catch (extractError) {
            console.warn(`Failed to load approval editor from ${candidate.label}:`, extractError?.message || extractError);
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
        sourceLabel: getSourceLabel(sourceMode),
    };
}

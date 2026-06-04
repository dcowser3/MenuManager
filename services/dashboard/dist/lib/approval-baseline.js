"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.textToParagraphHtml = textToParagraphHtml;
exports.normalizeApprovalEditorText = normalizeApprovalEditorText;
exports.normalizeApprovalEditorHtml = normalizeApprovalEditorHtml;
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
function normalizeApprovalEditorTextWithAnnotations(text, annotations) {
    const lines = `${text || ''}`
        .replace(/\r/g, '')
        .split('\n')
        .map((line, index) => ({
        text: line.replace(/\u00A0/g, ' ').replace(/[ \t]+$/g, ''),
        annotations: Array.isArray(annotations?.[index])
            ? annotations[index].filter((annotation) => (annotation.type === 'del' || annotation.type === 'ins') &&
                Number.isFinite(annotation.start) &&
                Number.isFinite(annotation.end) &&
                annotation.end > annotation.start)
            : [],
    }));
    while (lines.length && !lines[0].text.trim())
        lines.shift();
    while (lines.length && !lines[lines.length - 1].text.trim())
        lines.pop();
    const normalized = [];
    let prevBlank = false;
    for (const line of lines) {
        if (!line.text.trim()) {
            if (!prevBlank) {
                normalized.push({ text: '', annotations: [] });
            }
            prevBlank = true;
            continue;
        }
        normalized.push(line);
        prevBlank = false;
    }
    return {
        text: normalized.map((line) => line.text).join('\n'),
        annotations: normalized.map((line) => line.annotations),
    };
}
/**
 * Strip leading/trailing empty paragraphs from DOCX-derived HTML so the live preview
 * vertically aligns with the textarea (which uses normalizeApprovalEditorText on visible text).
 */
function normalizeApprovalEditorHtml(html) {
    const h = `${html || ''}`.trim();
    if (!h) {
        return h;
    }
    const lead = /^(?:\s*<p>\s*(?:<br\s*\/?>|&nbsp;|\s*)<\/p>\s*)+/i;
    const trail = /(?:\s*<p>\s*(?:<br\s*\/?>|&nbsp;|\s*)<\/p>\s*)+$/i;
    return h.replace(lead, '').replace(trail, '').trim();
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
    // Prefer the submission artifact (generated DOCX at submit time) so the editor matches
    // what chefs get from "Download" and what was produced from the form — not the
    // modification baseline reference doc, which can be an older approved version.
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
    let previewText = '';
    let previewAnnotations = [];
    let sourceMode = 'saved_submission_data';
    let sourceLabel = getSourceLabel('saved_submission_data');
    const submissionTag = submission.id || submission.filename || 'unknown';
    const candidates = getApprovalSourceDocCandidates(submission);
    const candidateFailures = [];
    if (!candidates.length) {
        console.warn(`[approval-baseline] submission=${submissionTag} no DOCX candidates on submission row ` +
            `(revision_baseline_doc_path / original_path / final_path are all empty)`);
    }
    for (const candidate of candidates) {
        let stage = 'resolve';
        try {
            const absolutePath = options.resolveStoredPath(candidate.filePath);
            stage = 'access';
            await fs_1.promises.access(absolutePath);
            stage = 'extract';
            if (candidate.extractionMode === 'approved') {
                const extracted = await options.extractApprovedFromDocx(absolutePath);
                editorHtml = normalizeApprovalEditorHtml(`${extracted.approvedMenuContentHtml || ''}`.trim());
                visibleText = normalizeApprovalEditorText(extracted.approvedMenuContent || '');
            }
            else {
                const extracted = await options.extractUnapprovedFromDocx(absolutePath);
                editorHtml = normalizeApprovalEditorHtml(`${extracted.unapprovedHtml || ''}`.trim());
                const normalizedPreview = normalizeApprovalEditorTextWithAnnotations(extracted.visibleText || '', extracted.annotations);
                previewText = normalizedPreview.text;
                previewAnnotations = normalizedPreview.annotations;
                visibleText = normalizeApprovalEditorText(extracted.cleanVisibleText || extracted.visibleText || '');
            }
            sourceMode = candidate.sourceMode;
            sourceLabel = getSourceLabelForCandidate(candidate);
            break;
        }
        catch (extractError) {
            const reason = extractError?.message || `${extractError}`;
            candidateFailures.push({ sourceMode: candidate.sourceMode, reason, stage });
            console.warn(`[approval-baseline] submission=${submissionTag} candidate=${candidate.sourceMode} ` +
                `stage=${stage} path=${candidate.filePath} failed: ${reason}`);
        }
    }
    if (!visibleText) {
        visibleText = normalizeApprovalEditorText(coalesceString(submission.approved_menu_content_raw, submission.approved_menu_content, submission.menu_content, submission.raw_payload?.approved_menu_content_raw, submission.raw_payload?.approved_menu_content, submission.raw_payload?.menuContent));
    }
    if (!previewText) {
        previewText = visibleText;
    }
    if (!editorHtml) {
        const savedHtml = coalesceString(submission.menu_content_html, submission.raw_payload?.menu_content_html, submission.raw_payload?.menuContentHtml);
        if (savedHtml) {
            editorHtml = normalizeApprovalEditorHtml(savedHtml);
            console.warn(`[approval-baseline] submission=${submissionTag} using saved menu_content_html ` +
                `fallback (DOCX extraction unavailable). failures=${JSON.stringify(candidateFailures)}`);
        }
        else {
            editorHtml = textToParagraphHtml(visibleText);
            console.warn(`[approval-baseline] submission=${submissionTag} degraded to plain-text fallback ` +
                `(no DOCX and no saved menu_content_html). failures=${JSON.stringify(candidateFailures)}`);
        }
        sourceMode = 'saved_submission_data';
    }
    return {
        editorHtml,
        visibleText,
        previewText,
        previewAnnotations,
        sourceMode,
        sourceLabel,
    };
}

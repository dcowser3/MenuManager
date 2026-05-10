import { promises as fs } from 'fs';

export type ApprovalBaselineSourceMode =
    | 'revision_baseline_docx'
    | 'original_docx'
    | 'approved_docx'
    | 'saved_submission_data';

type ExtractedApprovedDocx = {
    approvedMenuContent: string;
    approvedMenuContentHtml: string;
};

type ExtractedUnapprovedDocx = {
    visibleText: string;
    unapprovedHtml: string;
};

type ApprovalSourceExtractionMode = 'approved' | 'unapproved';

type LoadApprovalBaselineOptions = {
    extractApprovedFromDocx: (filePath: string) => Promise<ExtractedApprovedDocx>;
    extractUnapprovedFromDocx: (filePath: string) => Promise<ExtractedUnapprovedDocx>;
    resolveStoredPath: (filePath: string) => string;
};

type SubmissionLike = {
    id?: string;
    filename?: string;
    original_path?: string;
    final_path?: string;
    revision_source?: string;
    revision_baseline_doc_path?: string;
    revision_baseline_file_name?: string;
    approved_menu_content_raw?: string;
    approved_menu_content?: string;
    menu_content?: string;
    menu_content_html?: string;
    raw_payload?: Record<string, any>;
};

export type ApprovalBaselineResult = {
    editorHtml: string;
    visibleText: string;
    sourceMode: ApprovalBaselineSourceMode;
    sourceLabel: string;
};

export type ApprovalSourceDocumentCandidate = {
    fileName: string;
    filePath: string;
    sourceMode: Exclude<ApprovalBaselineSourceMode, 'saved_submission_data'>;
    extractionMode: ApprovalSourceExtractionMode;
};

export type ResolvedApprovalSourceDocument = ApprovalSourceDocumentCandidate & {
    absolutePath: string;
};

function coalesceString(...values: any[]): string {
    for (const value of values) {
        const normalized = `${value ?? ''}`.trim();
        if (normalized) return normalized;
    }
    return '';
}

function escapeHtml(value: string): string {
    return `${value || ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function textToParagraphHtml(text: string): string {
    const lines = `${text || ''}`.split('\n');
    if (!lines.length) return '<p><br></p>';
    return lines
        .map((line) => {
            const escaped = escapeHtml(line);
            return escaped ? `<p>${escaped}</p>` : '<p><br></p>';
        })
        .join('');
}

export function normalizeApprovalEditorText(text: string): string {
    const lines = `${text || ''}`
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.replace(/\u00A0/g, ' ').replace(/[ \t]+$/g, ''));

    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

    const normalized: string[] = [];
    let prevBlank = false;
    for (const line of lines) {
        if (!line.trim()) {
            if (!prevBlank) normalized.push('');
            prevBlank = true;
            continue;
        }
        normalized.push(line);
        prevBlank = false;
    }

    return normalized.join('\n');
}

/**
 * Strip leading/trailing empty paragraphs from DOCX-derived HTML so the live preview
 * vertically aligns with the textarea (which uses normalizeApprovalEditorText on visible text).
 */
export function normalizeApprovalEditorHtml(html: string): string {
    const h = `${html || ''}`.trim();
    if (!h) {
        return h;
    }
    const lead = /^(?:\s*<p>\s*(?:<br\s*\/?>|&nbsp;|\s*)<\/p>\s*)+/i;
    const trail = /(?:\s*<p>\s*(?:<br\s*\/?>|&nbsp;|\s*)<\/p>\s*)+$/i;
    return h.replace(lead, '').replace(trail, '').trim();
}

function getSourceLabel(sourceMode: ApprovalBaselineSourceMode): string {
    if (sourceMode === 'original_docx') {
        return 'Submitted DOCX with preserved redlines';
    }
    if (sourceMode === 'approved_docx') {
        return 'Stored approved DOCX with preserved redlines';
    }
    return 'Saved submission data fallback';
}

function getSourceLabelForCandidate(candidate: ApprovalSourceDocumentCandidate): string {
    if (candidate.sourceMode === 'revision_baseline_docx') {
        return candidate.extractionMode === 'approved'
            ? 'Uploaded baseline DOCX from submission form'
            : 'Uploaded unapproved DOCX with preserved redlines';
    }
    return getSourceLabel(candidate.sourceMode);
}

export function getApprovalSourceDocCandidates(submission: SubmissionLike): ApprovalSourceDocumentCandidate[] {
    const candidates: ApprovalSourceDocumentCandidate[] = [];

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
            fileName: coalesceString(
                submission.revision_baseline_file_name,
                submission.filename,
                `${submission.id || 'submission'}.docx`
            ),
            filePath: revisionBaselinePath,
            sourceMode: 'revision_baseline_docx',
            extractionMode: revisionSource === 'uploaded_baseline' ? 'approved' : 'unapproved',
        });
    }

    return candidates;
}

export async function resolveApprovalSourceDocument(
    submission: SubmissionLike,
    options: Pick<LoadApprovalBaselineOptions, 'resolveStoredPath'>
): Promise<ResolvedApprovalSourceDocument | null> {
    for (const candidate of getApprovalSourceDocCandidates(submission)) {
        try {
            const absolutePath = options.resolveStoredPath(candidate.filePath);
            await fs.access(absolutePath);
            return {
                ...candidate,
                absolutePath,
            };
        } catch (resolveError: any) {
            console.warn(
                `Failed to resolve approval source ${candidate.sourceMode}:`,
                resolveError?.message || resolveError
            );
        }
    }

    return null;
}

export async function loadApprovalBaselineFromSubmission(
    submission: SubmissionLike,
    options: LoadApprovalBaselineOptions
): Promise<ApprovalBaselineResult> {
    let editorHtml = '';
    let visibleText = '';
    let sourceMode: ApprovalBaselineSourceMode = 'saved_submission_data';
    let sourceLabel = getSourceLabel('saved_submission_data');
    const submissionTag = submission.id || submission.filename || 'unknown';
    const candidates = getApprovalSourceDocCandidates(submission);
    const candidateFailures: Array<{ sourceMode: string; reason: string; stage: string }> = [];

    if (!candidates.length) {
        console.warn(
            `[approval-baseline] submission=${submissionTag} no DOCX candidates on submission row ` +
            `(revision_baseline_doc_path / original_path / final_path are all empty)`
        );
    }

    for (const candidate of candidates) {
        let stage: 'resolve' | 'access' | 'extract' = 'resolve';
        try {
            const absolutePath = options.resolveStoredPath(candidate.filePath);
            stage = 'access';
            await fs.access(absolutePath);
            stage = 'extract';

            if (candidate.extractionMode === 'approved') {
                const extracted = await options.extractApprovedFromDocx(absolutePath);
                editorHtml = normalizeApprovalEditorHtml(`${extracted.approvedMenuContentHtml || ''}`.trim());
                visibleText = normalizeApprovalEditorText(extracted.approvedMenuContent || '');
            } else {
                const extracted = await options.extractUnapprovedFromDocx(absolutePath);
                editorHtml = normalizeApprovalEditorHtml(`${extracted.unapprovedHtml || ''}`.trim());
                visibleText = normalizeApprovalEditorText(extracted.visibleText || '');
            }

            sourceMode = candidate.sourceMode;
            sourceLabel = getSourceLabelForCandidate(candidate);
            break;
        } catch (extractError: any) {
            const reason = extractError?.message || `${extractError}`;
            candidateFailures.push({ sourceMode: candidate.sourceMode, reason, stage });
            console.warn(
                `[approval-baseline] submission=${submissionTag} candidate=${candidate.sourceMode} ` +
                `stage=${stage} path=${candidate.filePath} failed: ${reason}`
            );
        }
    }

    if (!visibleText) {
        visibleText = normalizeApprovalEditorText(
            coalesceString(
                submission.approved_menu_content_raw,
                submission.approved_menu_content,
                submission.menu_content,
                submission.raw_payload?.approved_menu_content_raw,
                submission.raw_payload?.approved_menu_content,
                submission.raw_payload?.menuContent
            )
        );
    }

    if (!editorHtml) {
        const savedHtml = coalesceString(
            submission.menu_content_html,
            submission.raw_payload?.menu_content_html,
            submission.raw_payload?.menuContentHtml
        );

        if (savedHtml) {
            editorHtml = normalizeApprovalEditorHtml(savedHtml);
            console.warn(
                `[approval-baseline] submission=${submissionTag} using saved menu_content_html ` +
                `fallback (DOCX extraction unavailable). failures=${JSON.stringify(candidateFailures)}`
            );
        } else {
            editorHtml = textToParagraphHtml(visibleText);
            console.warn(
                `[approval-baseline] submission=${submissionTag} degraded to plain-text fallback ` +
                `(no DOCX and no saved menu_content_html). failures=${JSON.stringify(candidateFailures)}`
            );
        }
        sourceMode = 'saved_submission_data';
    }

    return {
        editorHtml,
        visibleText,
        sourceMode,
        sourceLabel,
    };
}

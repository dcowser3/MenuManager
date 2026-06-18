"use strict";
// Pure helpers for the post-submission confirmation email (submitter + approvers
// receive one grouped copy of the submitted menu document). Kept separate from
// index.ts so the recipient/dedup and HTML logic are unit-testable without the
// mail transport. index.ts owns reading the docx and calling sendAlertMail.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLikelyEmailAddress = isLikelyEmailAddress;
exports.buildSubmissionConfirmationRecipients = buildSubmissionConfirmationRecipients;
exports.buildSubmissionEmailSubject = buildSubmissionEmailSubject;
exports.buildSubmissionReceiptHtml = buildSubmissionReceiptHtml;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isLikelyEmailAddress(value) {
    return EMAIL_PATTERN.test(`${value ?? ''}`.trim());
}
function escapeEmailHtml(value) {
    return `${value ?? ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/**
 * Build the de-duplicated recipient list: the submitter first, then each
 * distinct, valid approver email that isn't the submitter. Invalid/blank
 * addresses are dropped so the caller never tries to mail them.
 */
function buildSubmissionConfirmationRecipients(input) {
    const recipients = [];
    const seen = new Set();
    const submitterEmail = `${input.submitterEmail || ''}`.trim().toLowerCase();
    if (isLikelyEmailAddress(submitterEmail)) {
        recipients.push({ email: submitterEmail, role: 'submitter' });
        seen.add(submitterEmail);
    }
    for (const approval of input.approvals || []) {
        const email = `${approval?.email || ''}`.trim().toLowerCase();
        if (!isLikelyEmailAddress(email) || seen.has(email))
            continue;
        seen.add(email);
        recipients.push({ email, role: 'approver' });
    }
    return recipients;
}
function buildSubmissionEmailSubject(input) {
    return `Menu submitted for review: ${input.projectName}`;
}
function buildSubmissionReceiptHtml(input, attachmentDropped, dashboardUrl) {
    const rows = [
        ['Project', input.projectName],
        ['Property', input.property],
        ['Submitted by', input.submitterName || input.submitterEmail],
        ['Submission ID', input.submissionId],
    ]
        .filter(([, value]) => `${value ?? ''}`.trim() !== '')
        .map(([label, value]) => `<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold;width:150px">${escapeEmailHtml(label)}</td><td style="padding:6px 12px">${escapeEmailHtml(value)}</td></tr>`)
        .join('');
    const approverList = (input.approvals || [])
        .filter((a) => `${a?.name || ''}`.trim() || `${a?.email || ''}`.trim())
        .map((a) => `<li>${escapeEmailHtml(a.name || a.email)}${a.position ? ` — ${escapeEmailHtml(a.position)}` : ''}${a.email ? ` (${escapeEmailHtml(a.email)})` : ''}</li>`)
        .join('');
    const docCopy = attachmentDropped ? 'available on the dashboard' : 'attached for your records';
    const intro = `<p>${escapeEmailHtml(input.submitterName || 'A team member')} submitted the menu <strong>${escapeEmailHtml(input.projectName)}</strong> for <strong>${escapeEmailHtml(input.property)}</strong>. This copy is for visibility and recordkeeping so the team can confirm the submitted document looks right. A copy of the submitted document is ${docCopy}.</p>`;
    const reviewUrl = `${(dashboardUrl || '').replace(/\/+$/, '')}/review/${encodeURIComponent(input.submissionId)}`;
    return `
        <div style="font-family:sans-serif;max-width:640px">
            <h2 style="margin-bottom:4px">Menu submission received</h2>
            ${intro}
            <table style="border-collapse:collapse;width:100%;margin:12px 0">${rows}</table>
            ${approverList ? `<p style="margin-bottom:4px"><strong>Approvers:</strong></p><ul>${approverList}</ul>` : ''}
            ${attachmentDropped ? `<p style="color:#b71c1c">The document was too large to attach; download it from <a href="${reviewUrl}">the submission page</a>.</p>` : ''}
            <p style="color:#888;font-size:12px;margin-top:16px">This is an automated message from Menu Manager.</p>
        </div>
    `;
}

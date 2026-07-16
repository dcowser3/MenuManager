// Pure helpers for the post-submission confirmation email (submitter + approvers
// receive one grouped copy of the submitted menu document). Kept separate from
// index.ts so the recipient/dedup and HTML logic are unit-testable without the
// mail transport. index.ts owns reading the docx and calling sendAlertMail.

export type ConfirmationApproval = {
    approved?: boolean;
    name?: string;
    position?: string;
    email?: string;
};

export type SubmissionConfirmationInput = {
    submissionId: string;
    projectName: string;
    property: string;
    submitterName: string;
    submitterEmail: string;
    approvals: ConfirmationApproval[];
    docxPath: string;
    filename: string;
    approverDisputeToken?: string;
};

export type ConfirmationRecipient = {
    email: string;
    role: 'submitter' | 'approver';
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESERVED_EMAIL_DOMAINS = new Set([
    'example.com',
    'example.net',
    'example.org',
]);
const RESERVED_EMAIL_TLDS = new Set([
    'example',
    'invalid',
    'localhost',
    'test',
]);

export function isLikelyEmailAddress(value: unknown): boolean {
    return EMAIL_PATTERN.test(`${value ?? ''}`.trim());
}

export function isReservedPlaceholderEmailAddress(value: unknown): boolean {
    const email = `${value ?? ''}`.trim().toLowerCase();
    if (!isLikelyEmailAddress(email)) return false;
    const domain = email.split('@').pop() || '';
    const labels = domain.split('.');
    const topLevelDomain = labels[labels.length - 1] || '';
    return RESERVED_EMAIL_DOMAINS.has(domain) || RESERVED_EMAIL_TLDS.has(topLevelDomain);
}

export function isDeliverableEmailAddress(value: unknown): boolean {
    return isLikelyEmailAddress(value) && !isReservedPlaceholderEmailAddress(value);
}

function escapeEmailHtml(value: unknown): string {
    return `${value ?? ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Build the de-duplicated recipient list: the submitter first, then each
 * distinct, deliverable-looking approver email that isn't the submitter.
 * Invalid/blank/reserved placeholder addresses are dropped so the caller never
 * tries to mail them.
 */
export function buildSubmissionConfirmationRecipients(input: SubmissionConfirmationInput): ConfirmationRecipient[] {
    const recipients: ConfirmationRecipient[] = [];
    const seen = new Set<string>();

    const submitterEmail = `${input.submitterEmail || ''}`.trim().toLowerCase();
    if (isDeliverableEmailAddress(submitterEmail)) {
        recipients.push({ email: submitterEmail, role: 'submitter' });
        seen.add(submitterEmail);
    }

    for (const approval of input.approvals || []) {
        const email = `${approval?.email || ''}`.trim().toLowerCase();
        if (!isDeliverableEmailAddress(email) || seen.has(email)) continue;
        seen.add(email);
        recipients.push({ email, role: 'approver' });
    }

    return recipients;
}

export function buildSubmissionConfirmationCc(
    primaryRecipient: ConfirmationRecipient | undefined,
    ccRecipients: ConfirmationRecipient[],
    alwaysCcEmails: unknown = [],
): string[] {
    const cc: string[] = [];
    const seen = new Set<string>();

    if (primaryRecipient?.email) {
        seen.add(primaryRecipient.email.trim().toLowerCase());
    }

    const add = (value: unknown): void => {
        const email = `${value ?? ''}`.trim().toLowerCase();
        if (!isDeliverableEmailAddress(email) || seen.has(email)) return;
        seen.add(email);
        cc.push(email);
    };

    for (const recipient of ccRecipients || []) {
        add(recipient?.email);
    }
    const configuredEmails = Array.isArray(alwaysCcEmails) ? alwaysCcEmails : [alwaysCcEmails];
    for (const email of configuredEmails) {
        add(email);
    }

    return cc;
}

export function buildSubmissionEmailSubject(input: SubmissionConfirmationInput): string {
    return `Menu submitted for review: ${input.projectName}`;
}

/** Approver dispute link URL, or '' when no token is available. */
export function buildApproverDisputeUrl(dashboardUrl: string, token: string): string {
    const trimmed = `${token || ''}`.trim();
    if (!trimmed) return '';
    return `${(dashboardUrl || '').replace(/\/+$/, '')}/approval-dispute/${encodeURIComponent(trimmed)}`;
}

export function buildSubmissionReceiptHtml(
    input: SubmissionConfirmationInput,
    attachmentDropped: boolean,
    dashboardUrl: string,
    options: { includeDisputeLink?: boolean } = {},
): string {
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

    // Negative confirmation, approver copies only: silence means all is well.
    const disputeUrl = options.includeDisputeLink ? buildApproverDisputeUrl(dashboardUrl, input.approverDisputeToken || '') : '';
    const disputeLine = disputeUrl
        ? `<p style="margin-top:12px;padding:10px 12px;background:#fff8e1;border:1px solid #ffe082">If you did <strong>not</strong> approve this menu, <a href="${disputeUrl}">let us know</a>.</p>`
        : '';

    return `
        <div style="font-family:sans-serif;max-width:640px">
            <h2 style="margin-bottom:4px">Menu submission received</h2>
            ${intro}
            <table style="border-collapse:collapse;width:100%;margin:12px 0">${rows}</table>
            ${approverList ? `<p style="margin-bottom:4px"><strong>Approvers:</strong></p><ul>${approverList}</ul>` : ''}
            ${disputeLine}
            ${attachmentDropped ? `<p style="color:#b71c1c">The document was too large to attach; download it from <a href="${reviewUrl}">the submission page</a>.</p>` : ''}
            <p style="color:#888;font-size:12px;margin-top:16px">This is an automated message from Menu Manager.</p>
        </div>
    `;
}

import {
    buildSubmissionConfirmationRecipients,
    buildSubmissionEmailSubject,
    buildSubmissionReceiptHtml,
    isLikelyEmailAddress,
    SubmissionConfirmationInput,
} from '../lib/submission-confirmation-mail';

function input(overrides: Partial<SubmissionConfirmationInput> = {}): SubmissionConfirmationInput {
    return {
        submissionId: 'form-123',
        projectName: 'Dinner Menu',
        property: 'Toro Toro',
        submitterName: 'Ada Chef',
        submitterEmail: 'ada@example.com',
        approvals: [
            { approved: true, name: 'Grace GM', position: 'General Manager', email: 'grace@example.com' },
        ],
        docxPath: '/tmp/menu.docx',
        filename: 'menu.docx',
        ...overrides,
    };
}

describe('isLikelyEmailAddress', () => {
    test('accepts a normal address and rejects junk', () => {
        expect(isLikelyEmailAddress('a@b.co')).toBe(true);
        expect(isLikelyEmailAddress('  a@b.co  ')).toBe(true);
        expect(isLikelyEmailAddress('not-an-email')).toBe(false);
        expect(isLikelyEmailAddress('a@b')).toBe(false);
        expect(isLikelyEmailAddress('')).toBe(false);
        expect(isLikelyEmailAddress(undefined)).toBe(false);
    });
});

describe('buildSubmissionConfirmationRecipients', () => {
    test('returns the submitter then each distinct valid approver', () => {
        const recipients = buildSubmissionConfirmationRecipients(input());
        expect(recipients).toEqual([
            { email: 'ada@example.com', role: 'submitter' },
            { email: 'grace@example.com', role: 'approver' },
        ]);
    });

    test('de-duplicates an approver that is also the submitter', () => {
        const recipients = buildSubmissionConfirmationRecipients(input({
            approvals: [{ approved: true, name: 'Ada', position: 'Chef', email: 'ADA@example.com' }],
        }));
        expect(recipients).toEqual([{ email: 'ada@example.com', role: 'submitter' }]);
    });

    test('de-duplicates repeated approver emails (case-insensitively)', () => {
        const recipients = buildSubmissionConfirmationRecipients(input({
            approvals: [
                { approved: true, name: 'Grace', position: 'GM', email: 'grace@example.com' },
                { approved: true, name: 'Grace Again', position: 'GM', email: 'GRACE@example.com' },
            ],
        }));
        expect(recipients).toEqual([
            { email: 'ada@example.com', role: 'submitter' },
            { email: 'grace@example.com', role: 'approver' },
        ]);
    });

    test('drops blank or invalid approver emails', () => {
        const recipients = buildSubmissionConfirmationRecipients(input({
            approvals: [
                { approved: true, name: 'No Email', position: 'GM', email: '' },
                { approved: true, name: 'Bad', position: 'GM', email: 'nope' },
            ],
        }));
        expect(recipients).toEqual([{ email: 'ada@example.com', role: 'submitter' }]);
    });

    test('skips the submitter when their email is invalid', () => {
        const recipients = buildSubmissionConfirmationRecipients(input({ submitterEmail: 'bad' }));
        expect(recipients).toEqual([{ email: 'grace@example.com', role: 'approver' }]);
    });
});

describe('buildSubmissionEmailSubject', () => {
    test('uses one receipt subject for the grouped message', () => {
        expect(buildSubmissionEmailSubject(input())).toBe('Menu submitted for review: Dinner Menu');
    });
});

describe('buildSubmissionReceiptHtml', () => {
    test('receipt copy explains the document is attached and lists approvers', () => {
        const html = buildSubmissionReceiptHtml(input(), false, 'https://dash.example.com');
        expect(html).toContain('for visibility and recordkeeping');
        expect(html).toContain('attached for your records');
        expect(html).toContain('Grace GM');
        expect(html).not.toContain('the submission page');
    });

    test('receipt copy names the submitter without asking for approval', () => {
        const html = buildSubmissionReceiptHtml(input(), false, 'https://dash.example.com');
        expect(html).toContain('Ada Chef');
        expect(html).not.toContain('listed you as an approver');
        expect(html).not.toContain('for your approval');
    });

    test('falls back to a dashboard link when the attachment was dropped', () => {
        const html = buildSubmissionReceiptHtml(input(), true, 'https://dash.example.com/');
        expect(html).toContain('too large to attach');
        expect(html).toContain('https://dash.example.com/review/form-123');
    });

    test('escapes HTML in user-supplied values', () => {
        const html = buildSubmissionReceiptHtml(
            input({ projectName: '<script>x</script>' }),
            false,
            'https://dash.example.com',
        );
        expect(html).not.toContain('<script>x</script>');
        expect(html).toContain('&lt;script&gt;');
    });
});

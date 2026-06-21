"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const submission_confirmation_mail_1 = require("../lib/submission-confirmation-mail");
function input(overrides = {}) {
    return {
        submissionId: 'form-123',
        projectName: 'Dinner Menu',
        property: 'Toro Toro',
        submitterName: 'Ada Chef',
        submitterEmail: 'ada@menumanager.dev',
        approvals: [
            { approved: true, name: 'Grace GM', position: 'General Manager', email: 'grace@menumanager.dev' },
        ],
        docxPath: '/tmp/menu.docx',
        filename: 'menu.docx',
        ...overrides,
    };
}
describe('isLikelyEmailAddress', () => {
    test('accepts a normal address and rejects junk', () => {
        expect((0, submission_confirmation_mail_1.isLikelyEmailAddress)('a@b.co')).toBe(true);
        expect((0, submission_confirmation_mail_1.isLikelyEmailAddress)('  a@b.co  ')).toBe(true);
        expect((0, submission_confirmation_mail_1.isLikelyEmailAddress)('not-an-email')).toBe(false);
        expect((0, submission_confirmation_mail_1.isLikelyEmailAddress)('a@b')).toBe(false);
        expect((0, submission_confirmation_mail_1.isLikelyEmailAddress)('')).toBe(false);
        expect((0, submission_confirmation_mail_1.isLikelyEmailAddress)(undefined)).toBe(false);
    });
});
describe('isReservedPlaceholderEmailAddress', () => {
    test('identifies RFC-reserved placeholder domains', () => {
        expect((0, submission_confirmation_mail_1.isReservedPlaceholderEmailAddress)('chef@example.com')).toBe(true);
        expect((0, submission_confirmation_mail_1.isReservedPlaceholderEmailAddress)('chef@example.org')).toBe(true);
        expect((0, submission_confirmation_mail_1.isReservedPlaceholderEmailAddress)('chef@example.net')).toBe(true);
        expect((0, submission_confirmation_mail_1.isReservedPlaceholderEmailAddress)('chef@menus.test')).toBe(true);
        expect((0, submission_confirmation_mail_1.isReservedPlaceholderEmailAddress)('chef@menumanager.dev')).toBe(false);
    });
});
describe('isDeliverableEmailAddress', () => {
    test('requires valid syntax and rejects reserved placeholders', () => {
        expect((0, submission_confirmation_mail_1.isDeliverableEmailAddress)('chef@menumanager.dev')).toBe(true);
        expect((0, submission_confirmation_mail_1.isDeliverableEmailAddress)('chef@example.com')).toBe(false);
        expect((0, submission_confirmation_mail_1.isDeliverableEmailAddress)('not-an-email')).toBe(false);
    });
});
describe('buildSubmissionConfirmationRecipients', () => {
    test('returns the submitter then each distinct valid approver', () => {
        const recipients = (0, submission_confirmation_mail_1.buildSubmissionConfirmationRecipients)(input());
        expect(recipients).toEqual([
            { email: 'ada@menumanager.dev', role: 'submitter' },
            { email: 'grace@menumanager.dev', role: 'approver' },
        ]);
    });
    test('de-duplicates an approver that is also the submitter', () => {
        const recipients = (0, submission_confirmation_mail_1.buildSubmissionConfirmationRecipients)(input({
            approvals: [{ approved: true, name: 'Ada', position: 'Chef', email: 'ADA@menumanager.dev' }],
        }));
        expect(recipients).toEqual([{ email: 'ada@menumanager.dev', role: 'submitter' }]);
    });
    test('de-duplicates repeated approver emails (case-insensitively)', () => {
        const recipients = (0, submission_confirmation_mail_1.buildSubmissionConfirmationRecipients)(input({
            approvals: [
                { approved: true, name: 'Grace', position: 'GM', email: 'grace@menumanager.dev' },
                { approved: true, name: 'Grace Again', position: 'GM', email: 'GRACE@menumanager.dev' },
            ],
        }));
        expect(recipients).toEqual([
            { email: 'ada@menumanager.dev', role: 'submitter' },
            { email: 'grace@menumanager.dev', role: 'approver' },
        ]);
    });
    test('drops blank or invalid approver emails', () => {
        const recipients = (0, submission_confirmation_mail_1.buildSubmissionConfirmationRecipients)(input({
            approvals: [
                { approved: true, name: 'No Email', position: 'GM', email: '' },
                { approved: true, name: 'Bad', position: 'GM', email: 'nope' },
            ],
        }));
        expect(recipients).toEqual([{ email: 'ada@menumanager.dev', role: 'submitter' }]);
    });
    test('skips the submitter when their email is invalid', () => {
        const recipients = (0, submission_confirmation_mail_1.buildSubmissionConfirmationRecipients)(input({ submitterEmail: 'bad' }));
        expect(recipients).toEqual([{ email: 'grace@menumanager.dev', role: 'approver' }]);
    });
    test('drops reserved placeholder recipients before outbound mail', () => {
        const recipients = (0, submission_confirmation_mail_1.buildSubmissionConfirmationRecipients)(input({
            submitterEmail: 'chef@example.com',
            approvals: [
                { approved: true, name: 'Placeholder', position: 'GM', email: 'approver@example.net' },
                { approved: true, name: 'Real', position: 'Ops', email: 'real@menumanager.dev' },
            ],
        }));
        expect(recipients).toEqual([{ email: 'real@menumanager.dev', role: 'approver' }]);
    });
});
describe('buildSubmissionEmailSubject', () => {
    test('uses one receipt subject for the grouped message', () => {
        expect((0, submission_confirmation_mail_1.buildSubmissionEmailSubject)(input())).toBe('Menu submitted for review: Dinner Menu');
    });
});
describe('buildSubmissionReceiptHtml', () => {
    test('receipt copy explains the document is attached and lists approvers', () => {
        const html = (0, submission_confirmation_mail_1.buildSubmissionReceiptHtml)(input(), false, 'https://dash.example.com');
        expect(html).toContain('for visibility and recordkeeping');
        expect(html).toContain('attached for your records');
        expect(html).toContain('Grace GM');
        expect(html).not.toContain('the submission page');
    });
    test('receipt copy names the submitter without asking for approval', () => {
        const html = (0, submission_confirmation_mail_1.buildSubmissionReceiptHtml)(input(), false, 'https://dash.example.com');
        expect(html).toContain('Ada Chef');
        expect(html).not.toContain('listed you as an approver');
        expect(html).not.toContain('for your approval');
    });
    test('falls back to a dashboard link when the attachment was dropped', () => {
        const html = (0, submission_confirmation_mail_1.buildSubmissionReceiptHtml)(input(), true, 'https://dash.example.com/');
        expect(html).toContain('too large to attach');
        expect(html).toContain('https://dash.example.com/review/form-123');
    });
    test('escapes HTML in user-supplied values', () => {
        const html = (0, submission_confirmation_mail_1.buildSubmissionReceiptHtml)(input({ projectName: '<script>x</script>' }), false, 'https://dash.example.com');
        expect(html).not.toContain('<script>x</script>');
        expect(html).toContain('&lt;script&gt;');
    });
});

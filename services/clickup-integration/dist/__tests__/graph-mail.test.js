"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graph_mail_1 = require("../lib/graph-mail");
const GRAPH_ENV = {
    GRAPH_TENANT_ID: 'tenant-1',
    GRAPH_CLIENT_ID: 'client-1',
    GRAPH_CLIENT_SECRET: 'secret-1',
    GRAPH_MAILBOX_ADDRESS: 'sender@example.com',
};
describe('graph mail configuration', () => {
    test('is configured only when every credential and a sendable mailbox exist', () => {
        expect((0, graph_mail_1.isGraphMailConfigured)(GRAPH_ENV)).toBe(true);
        expect((0, graph_mail_1.isGraphMailConfigured)({ ...GRAPH_ENV, GRAPH_CLIENT_SECRET: '' })).toBe(false);
        expect((0, graph_mail_1.isGraphMailConfigured)({ ...GRAPH_ENV, GRAPH_MAILBOX_ADDRESS: '' })).toBe(false);
        expect((0, graph_mail_1.isGraphMailConfigured)({})).toBe(false);
    });
    test('falls back to GRAPH_USER_EMAIL for the mailbox address', () => {
        expect((0, graph_mail_1.getGraphMailboxAddress)({ GRAPH_USER_EMAIL: 'fallback@example.com' })).toBe('fallback@example.com');
        expect((0, graph_mail_1.getGraphMailboxAddress)({ ...GRAPH_ENV, GRAPH_USER_EMAIL: 'ignored@example.com' }))
            .toBe('sender@example.com');
    });
});
describe('graph sendMail request', () => {
    test('encodes the DOCX attachment as a base64 file attachment', () => {
        const request = (0, graph_mail_1.buildGraphSendMailRequest)({
            to: 'chef@example.com',
            subject: 'Corrections Ready: Summer Menu',
            html: '<p>Attached</p>',
            attachments: [{
                    filename: 'summer-menu.docx',
                    content: Buffer.from('docx-bytes'),
                    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                }],
        });
        expect(request.message.toRecipients).toEqual([{ emailAddress: { address: 'chef@example.com' } }]);
        expect(request.message.attachments).toHaveLength(1);
        expect(request.message.attachments[0]).toMatchObject({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: 'summer-menu.docx',
        });
        expect(Buffer.from(request.message.attachments[0].contentBytes, 'base64').toString()).toBe('docx-bytes');
    });
    test('omits attachment and cc keys when there are none', () => {
        const request = (0, graph_mail_1.buildGraphSendMailRequest)({ to: 'a@example.com', subject: 's', html: '<p>h</p>' });
        expect(request.message.attachments).toBeUndefined();
        expect(request.message.ccRecipients).toBeUndefined();
    });
});
describe('sendGraphMail', () => {
    test('posts to the mailbox sendMail endpoint with a bearer token', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true, status: 202, text: async () => '' }));
        await (0, graph_mail_1.sendGraphMail)({
            message: { to: 'chef@example.com', subject: 'Corrections Ready', html: '<p>hi</p>' },
            mailboxAddress: 'sender@example.com',
            getAccessToken: async () => 'token-abc',
            fetchImpl,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://graph.microsoft.com/v1.0/users/sender%40example.com/sendMail');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer token-abc');
        expect(JSON.parse(init.body).message.subject).toBe('Corrections Ready');
    });
    test('surfaces the Graph status and body when the send is rejected', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: false,
            status: 403,
            text: async () => '{"error":{"code":"ErrorAccessDenied"}}',
        }));
        await expect((0, graph_mail_1.sendGraphMail)({
            message: { to: 'chef@example.com', subject: 's', html: '<p>h</p>' },
            mailboxAddress: 'sender@example.com',
            getAccessToken: async () => 'token-abc',
            fetchImpl,
        })).rejects.toThrow(/Graph sendMail failed \(403\).*ErrorAccessDenied/);
    });
    // An oversized attachment otherwise comes back as an opaque Graph 413.
    test('rejects an oversized attachment before calling Graph', async () => {
        const fetchImpl = jest.fn();
        await expect((0, graph_mail_1.sendGraphMail)({
            message: {
                to: 'chef@example.com',
                subject: 's',
                html: '<p>h</p>',
                attachments: [{
                        filename: 'huge.docx',
                        content: Buffer.alloc(4 * 1024 * 1024),
                        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    }],
            },
            mailboxAddress: 'sender@example.com',
            getAccessToken: async () => 'token-abc',
            fetchImpl,
        })).rejects.toThrow(/attachment is too large/);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

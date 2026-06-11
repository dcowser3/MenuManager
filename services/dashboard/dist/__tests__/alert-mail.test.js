"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const alert_mail_1 = require("../lib/alert-mail");
function fakeResponse(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}
const GRAPH_ENV = {
    GRAPH_TENANT_ID: 'tenant-1',
    GRAPH_CLIENT_ID: 'client-1',
    GRAPH_CLIENT_SECRET: 'secret-1',
    GRAPH_MAILBOX_ADDRESS: 'alerts@example.com',
};
const MESSAGE = {
    fromName: 'Menu Manager Alerts',
    to: 'support@example.com',
    subject: 'Test alert',
    html: '<p>hello</p>',
    attachments: [
        { filename: 'state.json', content: '{"a":1}', contentType: 'application/json' },
        { filename: 'shot.png', content: Buffer.from([1, 2, 3]), contentType: 'image/png' },
    ],
};
describe('alert mail transport', () => {
    beforeEach(() => {
        (0, alert_mail_1.resetGraphTokenCacheForTests)();
    });
    describe('buildGraphMailConfig', () => {
        test('enables only with full credentials and a mailbox', () => {
            expect((0, alert_mail_1.buildGraphMailConfig)(GRAPH_ENV).enabled).toBe(true);
            expect((0, alert_mail_1.buildGraphMailConfig)({ ...GRAPH_ENV, GRAPH_CLIENT_SECRET: '' }).enabled).toBe(false);
            expect((0, alert_mail_1.buildGraphMailConfig)({}).enabled).toBe(false);
        });
        test('falls back to GRAPH_USER_EMAIL for the mailbox and honors the disable flag', () => {
            const viaUserEmail = (0, alert_mail_1.buildGraphMailConfig)({
                ...GRAPH_ENV,
                GRAPH_MAILBOX_ADDRESS: undefined,
                GRAPH_USER_EMAIL: 'design@example.com',
            });
            expect(viaUserEmail.enabled).toBe(true);
            expect(viaUserEmail.mailboxAddress).toBe('design@example.com');
            expect((0, alert_mail_1.buildGraphMailConfig)({ ...GRAPH_ENV, ALERT_MAIL_GRAPH_DISABLED: 'true' }).enabled).toBe(false);
        });
    });
    describe('buildGraphSendMailRequest', () => {
        test('builds an HTML message with base64 file attachments', () => {
            const payload = (0, alert_mail_1.buildGraphSendMailRequest)(MESSAGE);
            expect(payload.saveToSentItems).toBe(false);
            expect(payload.message.subject).toBe('Test alert');
            expect(payload.message.body).toEqual({ contentType: 'HTML', content: '<p>hello</p>' });
            expect(payload.message.toRecipients).toEqual([{ emailAddress: { address: 'support@example.com' } }]);
            expect(payload.message.attachments).toHaveLength(2);
            expect(payload.message.attachments[0]).toMatchObject({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: 'state.json',
                contentType: 'application/json',
                contentBytes: Buffer.from('{"a":1}').toString('base64'),
            });
        });
    });
    describe('sendAlertMail', () => {
        test('sends through Graph and caches the token', async () => {
            const calls = [];
            const fetchImpl = async (url, init) => {
                calls.push({ url, init });
                if (url.includes('/oauth2/'))
                    return fakeResponse(200, { access_token: 'tok', expires_in: 3600 });
                return fakeResponse(202);
            };
            const deps = { graphConfig: (0, alert_mail_1.buildGraphMailConfig)(GRAPH_ENV), fetchImpl };
            const first = await (0, alert_mail_1.sendAlertMail)(MESSAGE, deps);
            const second = await (0, alert_mail_1.sendAlertMail)(MESSAGE, deps);
            expect(first).toEqual({ transport: 'graph', attachmentsDropped: false });
            expect(second.transport).toBe('graph');
            const tokenCalls = calls.filter((c) => c.url.includes('/oauth2/'));
            const sendCalls = calls.filter((c) => c.url.includes('/sendMail'));
            expect(tokenCalls).toHaveLength(1);
            expect(sendCalls).toHaveLength(2);
            expect(sendCalls[0].url).toContain('alerts%40example.com');
            expect(sendCalls[0].init.headers.Authorization).toBe('Bearer tok');
        });
        test('falls back to SMTP when Graph fails and reports both errors when SMTP also fails', async () => {
            const fetchImpl = async (url) => url.includes('/oauth2/')
                ? fakeResponse(200, { access_token: 'tok', expires_in: 3600 })
                : fakeResponse(403, { error: { code: 'ErrorAccessDenied' } });
            const sendMail = jest.fn().mockResolvedValue({});
            const viaSmtp = await (0, alert_mail_1.sendAlertMail)(MESSAGE, {
                graphConfig: (0, alert_mail_1.buildGraphMailConfig)(GRAPH_ENV),
                smtpTransporter: { sendMail },
                smtpFromAddress: 'noreply@example.com',
                fetchImpl,
            });
            expect(viaSmtp.transport).toBe('smtp');
            expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
                from: '"Menu Manager Alerts" <noreply@example.com>',
                to: 'support@example.com',
                attachments: expect.arrayContaining([expect.objectContaining({ filename: 'shot.png' })]),
            }));
            (0, alert_mail_1.resetGraphTokenCacheForTests)();
            const failingSmtp = { sendMail: jest.fn().mockRejectedValue(new Error('Connection timeout')) };
            await expect((0, alert_mail_1.sendAlertMail)(MESSAGE, {
                graphConfig: (0, alert_mail_1.buildGraphMailConfig)(GRAPH_ENV),
                smtpTransporter: failingSmtp,
                fetchImpl,
            })).rejects.toThrow(/graph: .*403.*\| smtp: Connection timeout/);
        });
        test('drops attachments when the Graph payload exceeds the size limit', async () => {
            const sendBodies = [];
            const fetchImpl = async (url, init) => {
                if (url.includes('/oauth2/'))
                    return fakeResponse(200, { access_token: 'tok', expires_in: 3600 });
                sendBodies.push(init.body);
                return fakeResponse(202);
            };
            const huge = {
                ...MESSAGE,
                attachments: [{ filename: 'huge.json', content: 'x'.repeat(4000000), contentType: 'application/json' }],
            };
            const result = await (0, alert_mail_1.sendAlertMail)(huge, { graphConfig: (0, alert_mail_1.buildGraphMailConfig)(GRAPH_ENV), fetchImpl });
            expect(result).toEqual({ transport: 'graph', attachmentsDropped: true });
            expect(sendBodies).toHaveLength(1);
            const sent = JSON.parse(sendBodies[0]);
            expect(sent.message.attachments).toBeUndefined();
            expect(sent.message.body.content).toContain('exceeded the email size limit');
        });
        test('throws when no transport is configured', async () => {
            await expect((0, alert_mail_1.sendAlertMail)(MESSAGE, { graphConfig: (0, alert_mail_1.buildGraphMailConfig)({}) }))
                .rejects.toThrow('No alert mail transport configured');
        });
    });
});

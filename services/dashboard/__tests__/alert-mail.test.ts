import {
    buildGraphMailConfig,
    buildGraphSendMailRequest,
    canSendAlertMail,
    resetGraphTokenCacheForTests,
    sendAlertMail,
} from '../lib/alert-mail';

function fakeResponse(status: number, body: any = {}): any {
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
        resetGraphTokenCacheForTests();
    });

    describe('buildGraphMailConfig', () => {
        test('enables only with full credentials and a mailbox', () => {
            expect(buildGraphMailConfig(GRAPH_ENV).enabled).toBe(true);
            expect(buildGraphMailConfig({ ...GRAPH_ENV, GRAPH_CLIENT_SECRET: '' }).enabled).toBe(false);
            expect(buildGraphMailConfig({}).enabled).toBe(false);
        });

        test('falls back to GRAPH_USER_EMAIL for the mailbox and honors the disable flag', () => {
            const viaUserEmail = buildGraphMailConfig({
                ...GRAPH_ENV,
                GRAPH_MAILBOX_ADDRESS: undefined,
                GRAPH_USER_EMAIL: 'design@example.com',
            });
            expect(viaUserEmail.enabled).toBe(true);
            expect(viaUserEmail.mailboxAddress).toBe('design@example.com');
            expect(buildGraphMailConfig({ ...GRAPH_ENV, ALERT_MAIL_GRAPH_DISABLED: 'true' }).enabled).toBe(false);
        });
    });

    describe('buildGraphSendMailRequest', () => {
        test('builds an HTML message with base64 file attachments', () => {
            const payload = buildGraphSendMailRequest({ ...MESSAGE, cc: ['ops@example.com'] });
            expect(payload.saveToSentItems).toBe(false);
            expect(payload.message.subject).toBe('Test alert');
            expect(payload.message.body).toEqual({ contentType: 'HTML', content: '<p>hello</p>' });
            expect(payload.message.toRecipients).toEqual([{ emailAddress: { address: 'support@example.com' } }]);
            expect(payload.message.ccRecipients).toEqual([{ emailAddress: { address: 'ops@example.com' } }]);
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
            const calls: Array<{ url: string; init: any }> = [];
            const fetchImpl: any = async (url: string, init: any) => {
                calls.push({ url, init });
                if (url.includes('/oauth2/')) return fakeResponse(200, { access_token: 'tok', expires_in: 3600 });
                return fakeResponse(202);
            };
            const deps = { graphConfig: buildGraphMailConfig(GRAPH_ENV), fetchImpl };

            const first = await sendAlertMail(MESSAGE, deps);
            const second = await sendAlertMail(MESSAGE, deps);

            expect(first).toEqual({ transport: 'graph', attachmentsDropped: false });
            expect(second.transport).toBe('graph');
            const tokenCalls = calls.filter((c) => c.url.includes('/oauth2/'));
            const sendCalls = calls.filter((c) => c.url.includes('/sendMail'));
            expect(tokenCalls).toHaveLength(1);
            expect(sendCalls).toHaveLength(2);
            expect(sendCalls[0].url).toContain('alerts%40example.com');
            expect(sendCalls[0].init.headers.Authorization).toBe('Bearer tok');
        });

        test('writes directly into the recipient inbox when sendMail lacks Mail.Send', async () => {
            const calls: Array<{ url: string; init: any }> = [];
            const fetchImpl: any = async (url: string, init: any) => {
                calls.push({ url, init });
                if (url.includes('/oauth2/')) return fakeResponse(200, { access_token: 'tok', expires_in: 3600 });
                if (url.includes('/sendMail')) return fakeResponse(403, { error: { code: 'ErrorAccessDenied' } });
                return fakeResponse(201, { id: 'msg-1' });
            };

            const result = await sendAlertMail(MESSAGE, { graphConfig: buildGraphMailConfig(GRAPH_ENV), fetchImpl });

            expect(result).toEqual({ transport: 'graph-inbox-write', attachmentsDropped: false });
            const inboxCall = calls.find((c) => c.url.includes('/mailFolders/inbox/messages'));
            expect(inboxCall).toBeDefined();
            expect(inboxCall!.url).toContain('support%40example.com');
            const payload = JSON.parse(inboxCall!.init.body);
            expect(payload.singleValueExtendedProperties).toEqual([{ id: 'Integer 0x0E07', value: '4' }]);
            expect(payload.from.emailAddress).toEqual({ name: 'Menu Manager Alerts', address: 'alerts@example.com' });
            expect(payload.attachments).toHaveLength(2);
            expect(payload.saveToSentItems).toBeUndefined();
        });

        test('falls back to SMTP when Graph fails and reports all errors when SMTP also fails', async () => {
            const fetchImpl: any = async (url: string) =>
                url.includes('/oauth2/')
                    ? fakeResponse(200, { access_token: 'tok', expires_in: 3600 })
                    : url.includes('/sendMail')
                        ? fakeResponse(403, { error: { code: 'ErrorAccessDenied' } })
                        : fakeResponse(404, { error: { code: 'ErrorInvalidUser' } });

            const sendMail = jest.fn().mockResolvedValue({});
            const viaSmtp = await sendAlertMail(MESSAGE, {
                graphConfig: buildGraphMailConfig(GRAPH_ENV),
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

            resetGraphTokenCacheForTests();
            const failingSmtp = { sendMail: jest.fn().mockRejectedValue(new Error('Connection timeout')) };
            await expect(sendAlertMail(MESSAGE, {
                graphConfig: buildGraphMailConfig(GRAPH_ENV),
                smtpTransporter: failingSmtp,
                fetchImpl,
            })).rejects.toThrow(/graph: .*403.*Graph inbox write failed \(404\).*\| smtp: Connection timeout/);
        });

        test('uses SMTP for cc messages when Graph sendMail fails', async () => {
            const calls: string[] = [];
            const fetchImpl: any = async (url: string) => {
                calls.push(url);
                return url.includes('/oauth2/')
                    ? fakeResponse(200, { access_token: 'tok', expires_in: 3600 })
                    : fakeResponse(403, { error: { code: 'ErrorAccessDenied' } });
            };
            const sendMail = jest.fn().mockResolvedValue({});

            const result = await sendAlertMail({ ...MESSAGE, cc: ['ops@example.com'] }, {
                graphConfig: buildGraphMailConfig(GRAPH_ENV),
                smtpTransporter: { sendMail },
                smtpFromAddress: 'noreply@example.com',
                fetchImpl,
            });

            expect(result.transport).toBe('smtp');
            expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
                to: 'support@example.com',
                cc: ['ops@example.com'],
            }));
            expect(calls.some((url) => url.includes('/mailFolders/inbox/messages'))).toBe(false);
        });

        test('includes Azure token error details without echoing the submitted secret', async () => {
            const calls: string[] = [];
            const fetchImpl: any = async (url: string) => {
                calls.push(url);
                return url.includes('/oauth2/')
                    ? fakeResponse(401, {
                        error: 'invalid_client',
                        error_codes: [7000215],
                        error_description: 'AADSTS7000215: Invalid client secret provided. secret-1 should not be echoed.',
                    })
                    : fakeResponse(202);
            };

            await expect(sendAlertMail(MESSAGE, {
                graphConfig: buildGraphMailConfig(GRAPH_ENV),
                fetchImpl,
            })).rejects.toThrow(/Graph token request failed \(401\): error=invalid_client; codes=7000215; description=AADSTS7000215: Invalid client secret provided\. <redacted> should not be echoed\./);
            expect(calls.filter((url) => url.includes('/oauth2/'))).toHaveLength(1);
            expect(calls.some((url) => url.includes('/mailFolders/inbox/messages'))).toBe(false);
        });

        test('drops attachments when the Graph payload exceeds the size limit', async () => {
            const sendBodies: string[] = [];
            const fetchImpl: any = async (url: string, init: any) => {
                if (url.includes('/oauth2/')) return fakeResponse(200, { access_token: 'tok', expires_in: 3600 });
                sendBodies.push(init.body);
                return fakeResponse(202);
            };
            const huge = {
                ...MESSAGE,
                attachments: [{ filename: 'huge.json', content: 'x'.repeat(4_000_000), contentType: 'application/json' }],
            };

            const result = await sendAlertMail(huge, { graphConfig: buildGraphMailConfig(GRAPH_ENV), fetchImpl });

            expect(result).toEqual({ transport: 'graph', attachmentsDropped: true });
            expect(sendBodies).toHaveLength(1);
            const sent = JSON.parse(sendBodies[0]);
            expect(sent.message.attachments).toBeUndefined();
            expect(sent.message.body.content).toContain('exceeded the email size limit');
        });

        test('throws when no transport is configured', async () => {
            await expect(sendAlertMail(MESSAGE, { graphConfig: buildGraphMailConfig({}) }))
                .rejects.toThrow('No alert mail transport configured');
        });
    });
});

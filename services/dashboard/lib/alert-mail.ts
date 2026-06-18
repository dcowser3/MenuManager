// Alert email transport: Microsoft Graph sendMail first, SMTP fallback.
//
// Production runs on Lightsail where outbound port 25 is blocked by AWS, so
// the SMTP relay path (richardsandoval-com.mail.protection.outlook.com:25)
// hangs and alert mail never sends. Graph sendMail goes over HTTPS/443 and
// reuses the app registration already configured for SharePoint. It requires
// the Mail.Send application permission with admin consent, and a real
// licensed/shared mailbox to send as (GRAPH_MAILBOX_ADDRESS — a distribution
// list like design@ is NOT a sendable mailbox and returns ErrorInvalidUser).

export interface AlertMailAttachment {
    filename: string;
    content: Buffer | string;
    contentType: string;
}

export interface AlertMailMessage {
    fromName: string;
    to: string;
    cc?: string[];
    subject: string;
    html: string;
    attachments?: AlertMailAttachment[];
}

export interface GraphMailConfig {
    enabled: boolean;
    tenantId: string;
    clientId: string;
    clientSecret: string;
    mailboxAddress: string;
}

export interface SendAlertMailDeps {
    graphConfig?: GraphMailConfig | null;
    smtpTransporter?: { sendMail(options: any): Promise<any> } | null;
    smtpFromAddress?: string;
    fetchImpl?: typeof fetch;
}

export interface SendAlertMailResult {
    transport: 'graph' | 'graph-inbox-write' | 'smtp';
    attachmentsDropped: boolean;
}

// Graph's direct sendMail endpoint rejects requests around 4MB; leave room
// for the ~4/3 base64 inflation plus JSON overhead.
const GRAPH_MAX_REQUEST_CHARS = 3_500_000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function buildGraphMailConfig(env: Record<string, string | undefined> = process.env as any): GraphMailConfig {
    const tenantId = `${env.GRAPH_TENANT_ID || ''}`.trim();
    const clientId = `${env.GRAPH_CLIENT_ID || ''}`.trim();
    const clientSecret = `${env.GRAPH_CLIENT_SECRET || ''}`.trim();
    const mailboxAddress = `${env.GRAPH_MAILBOX_ADDRESS || env.GRAPH_USER_EMAIL || ''}`.trim();
    const disabled = ['1', 'true', 'yes', 'on'].includes(`${env.ALERT_MAIL_GRAPH_DISABLED || ''}`.trim().toLowerCase());
    return {
        enabled: !disabled && !!(tenantId && clientId && clientSecret && mailboxAddress),
        tenantId,
        clientId,
        clientSecret,
        mailboxAddress,
    };
}

export function canSendAlertMail(deps: SendAlertMailDeps): boolean {
    return !!(deps.graphConfig?.enabled || deps.smtpTransporter);
}

export function buildGraphSendMailRequest(message: AlertMailMessage): Record<string, any> {
    const attachments = (message.attachments || []).map((attachment) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.filename,
        contentType: attachment.contentType,
        contentBytes: (Buffer.isBuffer(attachment.content)
            ? attachment.content
            : Buffer.from(`${attachment.content}`)
        ).toString('base64'),
    }));
    return {
        message: {
            subject: message.subject,
            body: { contentType: 'HTML', content: message.html },
            toRecipients: [{ emailAddress: { address: message.to } }],
            ...(message.cc?.length ? { ccRecipients: message.cc.map((address) => ({ emailAddress: { address } })) } : {}),
            ...(attachments.length ? { attachments } : {}),
        },
        saveToSentItems: false,
    };
}

let cachedGraphToken: { token: string; expiresAt: number } | null = null;

export function resetGraphTokenCacheForTests(): void {
    cachedGraphToken = null;
}

async function formatGraphTokenError(response: Response, config: GraphMailConfig): Promise<string> {
    const raw = (await response.text().catch(() => '')).slice(0, 1000);
    const redact = (value: string, text: string): string => (value ? text.split(value).join('<redacted>') : text);
    let details = raw;

    try {
        const parsed = JSON.parse(raw);
        const parts = [
            parsed.error ? `error=${parsed.error}` : null,
            Array.isArray(parsed.error_codes) && parsed.error_codes.length
                ? `codes=${parsed.error_codes.join(',')}`
                : null,
            parsed.error_description ? `description=${parsed.error_description}` : null,
        ].filter(Boolean);
        details = parts.join('; ') || raw;
    } catch {
        // Keep the raw response text when Azure returns non-JSON diagnostics.
    }

    details = redact(config.clientSecret, details);
    return details
        ? `Graph token request failed (${response.status}): ${details}`
        : `Graph token request failed (${response.status})`;
}

async function getGraphToken(config: GraphMailConfig, fetchImpl: typeof fetch): Promise<string> {
    if (cachedGraphToken && cachedGraphToken.expiresAt > Date.now()) {
        return cachedGraphToken.token;
    }
    const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });
    const response = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    if (!response.ok) {
        throw new Error(await formatGraphTokenError(response, config));
    }
    const data: any = await response.json();
    if (!data?.access_token) {
        throw new Error('Graph token response missing access_token');
    }
    const lifetimeMs = Math.max(60_000, ((data.expires_in || 3600) * 1000) - TOKEN_REFRESH_MARGIN_MS);
    cachedGraphToken = { token: data.access_token, expiresAt: Date.now() + lifetimeMs };
    return cachedGraphToken.token;
}

function withoutAttachments(message: AlertMailMessage): AlertMailMessage {
    const dropped = (message.attachments || []).map((attachment) => attachment.filename).join(', ');
    return {
        ...message,
        attachments: [],
        html: `${message.html}<p style="color:#b71c1c"><strong>Note:</strong> attachments (${dropped}) exceeded the email size limit and were dropped; the full report is saved on the server.</p>`,
    };
}

async function sendViaGraph(
    config: GraphMailConfig,
    message: AlertMailMessage,
    fetchImpl: typeof fetch
): Promise<SendAlertMailResult> {
    const token = await getGraphToken(config, fetchImpl);

    let attachmentsDropped = false;
    let payload = buildGraphSendMailRequest(message);
    let body = JSON.stringify(payload);
    if (body.length > GRAPH_MAX_REQUEST_CHARS && (message.attachments || []).length) {
        attachmentsDropped = true;
        payload = buildGraphSendMailRequest(withoutAttachments(message));
        body = JSON.stringify(payload);
    }

    const send = (requestBody: string) => fetchImpl(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailboxAddress)}/sendMail`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: requestBody,
        }
    );

    let response = await send(body);
    if (response.status === 413 && !attachmentsDropped && (message.attachments || []).length) {
        attachmentsDropped = true;
        response = await send(JSON.stringify(buildGraphSendMailRequest(withoutAttachments(message))));
    }
    if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 400);
        throw new Error(`Graph sendMail failed (${response.status}): ${errorText}`);
    }
    return { transport: 'graph', attachmentsDropped };
}

/**
 * Interim path while the Mail.Send permission awaits admin consent: with the
 * already-granted Mail.ReadWrite application permission, write the alert
 * directly into the recipient's inbox (alerts always go to an in-tenant
 * support mailbox). PR_MESSAGE_FLAGS=4 clears the draft flag so the message
 * lands as a normal unread item. Out-of-tenant recipients 404 and fall
 * through to SMTP.
 */
async function sendViaGraphInboxWrite(
    config: GraphMailConfig,
    message: AlertMailMessage,
    fetchImpl: typeof fetch
): Promise<SendAlertMailResult> {
    if (message.cc?.length) {
        throw new Error('Graph inbox write fallback does not support cc recipients');
    }

    const token = await getGraphToken(config, fetchImpl);

    const buildBody = (msg: AlertMailMessage) => {
        const payload = buildGraphSendMailRequest(msg).message;
        return JSON.stringify({
            ...payload,
            from: { emailAddress: { name: msg.fromName, address: config.mailboxAddress } },
            singleValueExtendedProperties: [{ id: 'Integer 0x0E07', value: '4' }],
        });
    };

    let attachmentsDropped = false;
    let body = buildBody(message);
    if (body.length > GRAPH_MAX_REQUEST_CHARS && (message.attachments || []).length) {
        attachmentsDropped = true;
        body = buildBody(withoutAttachments(message));
    }

    const response = await fetchImpl(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(message.to)}/mailFolders/inbox/messages`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body,
        }
    );
    if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 400);
        throw new Error(`Graph inbox write failed (${response.status}): ${errorText}`);
    }
    return { transport: 'graph-inbox-write', attachmentsDropped };
}

/**
 * Send an alert email via Graph when configured (sendMail, then direct
 * inbox write), falling back to SMTP. Throws only when every configured
 * transport fails; callers fire-and-forget.
 */
export async function sendAlertMail(message: AlertMailMessage, deps: SendAlertMailDeps): Promise<SendAlertMailResult> {
    const fetchImpl = deps.fetchImpl || (globalThis.fetch as typeof fetch | undefined);
    let graphError: Error | null = null;

    if (deps.graphConfig?.enabled && fetchImpl) {
        try {
            return await sendViaGraph(deps.graphConfig, message, fetchImpl);
        } catch (error: any) {
            graphError = error;
        }
        if (!graphError?.message?.startsWith('Graph token request failed')) {
            try {
                return await sendViaGraphInboxWrite(deps.graphConfig, message, fetchImpl);
            } catch (error: any) {
                graphError = new Error(`${graphError ? `${graphError.message} | ` : ''}${error.message}`);
            }
        }
    }

    if (deps.smtpTransporter) {
        try {
            await deps.smtpTransporter.sendMail({
                from: `"${message.fromName}" <${deps.smtpFromAddress || message.to}>`,
                to: message.to,
                cc: message.cc,
                subject: message.subject,
                html: message.html,
                attachments: (message.attachments || []).map((attachment) => ({
                    filename: attachment.filename,
                    content: attachment.content,
                    contentType: attachment.contentType,
                })),
            });
            return { transport: 'smtp', attachmentsDropped: false };
        } catch (smtpError: any) {
            throw new Error(
                [graphError ? `graph: ${graphError.message}` : null, `smtp: ${smtpError.message}`]
                    .filter(Boolean)
                    .join(' | ')
            );
        }
    }

    throw graphError || new Error('No alert mail transport configured');
}

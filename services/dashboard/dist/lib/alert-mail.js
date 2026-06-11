"use strict";
// Alert email transport: Microsoft Graph sendMail first, SMTP fallback.
//
// Production runs on Lightsail where outbound port 25 is blocked by AWS, so
// the SMTP relay path (richardsandoval-com.mail.protection.outlook.com:25)
// hangs and alert mail never sends. Graph sendMail goes over HTTPS/443 and
// reuses the app registration already configured for SharePoint. It requires
// the Mail.Send application permission with admin consent, and a real
// licensed/shared mailbox to send as (GRAPH_MAILBOX_ADDRESS — a distribution
// list like design@ is NOT a sendable mailbox and returns ErrorInvalidUser).
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGraphMailConfig = buildGraphMailConfig;
exports.canSendAlertMail = canSendAlertMail;
exports.buildGraphSendMailRequest = buildGraphSendMailRequest;
exports.resetGraphTokenCacheForTests = resetGraphTokenCacheForTests;
exports.sendAlertMail = sendAlertMail;
// Graph's direct sendMail endpoint rejects requests around 4MB; leave room
// for the ~4/3 base64 inflation plus JSON overhead.
const GRAPH_MAX_REQUEST_CHARS = 3500000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
function buildGraphMailConfig(env = process.env) {
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
function canSendAlertMail(deps) {
    return !!(deps.graphConfig?.enabled || deps.smtpTransporter);
}
function buildGraphSendMailRequest(message) {
    const attachments = (message.attachments || []).map((attachment) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.filename,
        contentType: attachment.contentType,
        contentBytes: (Buffer.isBuffer(attachment.content)
            ? attachment.content
            : Buffer.from(`${attachment.content}`)).toString('base64'),
    }));
    return {
        message: {
            subject: message.subject,
            body: { contentType: 'HTML', content: message.html },
            toRecipients: [{ emailAddress: { address: message.to } }],
            ...(attachments.length ? { attachments } : {}),
        },
        saveToSentItems: false,
    };
}
let cachedGraphToken = null;
function resetGraphTokenCacheForTests() {
    cachedGraphToken = null;
}
async function getGraphToken(config, fetchImpl) {
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
        throw new Error(`Graph token request failed (${response.status})`);
    }
    const data = await response.json();
    if (!data?.access_token) {
        throw new Error('Graph token response missing access_token');
    }
    const lifetimeMs = Math.max(60000, ((data.expires_in || 3600) * 1000) - TOKEN_REFRESH_MARGIN_MS);
    cachedGraphToken = { token: data.access_token, expiresAt: Date.now() + lifetimeMs };
    return cachedGraphToken.token;
}
function withoutAttachments(message) {
    const dropped = (message.attachments || []).map((attachment) => attachment.filename).join(', ');
    return {
        ...message,
        attachments: [],
        html: `${message.html}<p style="color:#b71c1c"><strong>Note:</strong> attachments (${dropped}) exceeded the email size limit and were dropped; the full report is saved on the server.</p>`,
    };
}
async function sendViaGraph(config, message, fetchImpl) {
    const token = await getGraphToken(config, fetchImpl);
    let attachmentsDropped = false;
    let payload = buildGraphSendMailRequest(message);
    let body = JSON.stringify(payload);
    if (body.length > GRAPH_MAX_REQUEST_CHARS && (message.attachments || []).length) {
        attachmentsDropped = true;
        payload = buildGraphSendMailRequest(withoutAttachments(message));
        body = JSON.stringify(payload);
    }
    const send = (requestBody) => fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailboxAddress)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: requestBody,
    });
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
 * Send an alert email via Graph when configured, falling back to SMTP.
 * Throws only when every configured transport fails; callers fire-and-forget.
 */
async function sendAlertMail(message, deps) {
    const fetchImpl = deps.fetchImpl || globalThis.fetch;
    let graphError = null;
    if (deps.graphConfig?.enabled && fetchImpl) {
        try {
            return await sendViaGraph(deps.graphConfig, message, fetchImpl);
        }
        catch (error) {
            graphError = error;
        }
    }
    if (deps.smtpTransporter) {
        try {
            await deps.smtpTransporter.sendMail({
                from: `"${message.fromName}" <${deps.smtpFromAddress || message.to}>`,
                to: message.to,
                subject: message.subject,
                html: message.html,
                attachments: (message.attachments || []).map((attachment) => ({
                    filename: attachment.filename,
                    content: attachment.content,
                    contentType: attachment.contentType,
                })),
            });
            return { transport: 'smtp', attachmentsDropped: false };
        }
        catch (smtpError) {
            throw new Error([graphError ? `graph: ${graphError.message}` : null, `smtp: ${smtpError.message}`]
                .filter(Boolean)
                .join(' | '));
        }
    }
    throw graphError || new Error('No alert mail transport configured');
}

"use strict";
// Outbound mail over Microsoft Graph sendMail (HTTPS/443).
//
// Production runs on Lightsail, where AWS blocks outbound port 25. The SMTP relay
// (richardsandoval-com.mail.protection.outlook.com:25) therefore hangs until it times
// out, so every SMTP-only notification silently failed — submitters never received
// their corrections email, and the ~2 minute hang pushed approval finalize past its
// caller's timeout. Graph reuses the app registration already used for SharePoint and
// needs the Mail.Send application permission plus a real sendable mailbox
// (GRAPH_MAILBOX_ADDRESS — a distribution list is not sendable and returns
// ErrorInvalidUser). Mirrors services/dashboard/lib/alert-mail.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGraphMailConfigured = isGraphMailConfigured;
exports.getGraphMailboxAddress = getGraphMailboxAddress;
exports.buildGraphSendMailRequest = buildGraphSendMailRequest;
exports.sendGraphMail = sendGraphMail;
// Graph's direct sendMail endpoint rejects requests around 4MB; leave room for the
// ~4/3 base64 inflation plus JSON overhead.
const GRAPH_MAX_REQUEST_CHARS = 3500000;
function isGraphMailConfigured(env = process.env) {
    return !!(`${env.GRAPH_TENANT_ID || ''}`.trim() &&
        `${env.GRAPH_CLIENT_ID || ''}`.trim() &&
        `${env.GRAPH_CLIENT_SECRET || ''}`.trim() &&
        getGraphMailboxAddress(env));
}
function getGraphMailboxAddress(env = process.env) {
    return `${env.GRAPH_MAILBOX_ADDRESS || env.GRAPH_USER_EMAIL || ''}`.trim();
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
            ...(message.cc?.length ? { ccRecipients: message.cc.map((address) => ({ emailAddress: { address } })) } : {}),
            ...(attachments.length ? { attachments } : {}),
        },
        saveToSentItems: false,
    };
}
async function sendGraphMail(input) {
    const body = JSON.stringify(buildGraphSendMailRequest(input.message));
    if (body.length > GRAPH_MAX_REQUEST_CHARS) {
        // Surfacing this beats letting Graph answer with an opaque 413: the caller
        // alerts on the thrown message, so ops learn the attachment was the problem.
        throw new Error(`Graph sendMail payload is ${body.length} chars, over the ${GRAPH_MAX_REQUEST_CHARS} limit; attachment is too large to send.`);
    }
    const doFetch = input.fetchImpl || fetch;
    const accessToken = await input.getAccessToken();
    const response = await doFetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(input.mailboxAddress)}/sendMail`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body,
    });
    if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 500);
        throw new Error(`Graph sendMail failed (${response.status}): ${errorText}`);
    }
}

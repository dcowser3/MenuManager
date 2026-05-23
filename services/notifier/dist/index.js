"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv = require("dotenv");
const fs_1 = require("fs");
const smtp_config_1 = require("./src/smtp-config");
dotenv.config({ path: '../../../.env' });
const app = express();
const port = 3003;
const smtpConfig = (0, smtp_config_1.buildSmtpRuntimeConfig)();
const hasSmtpConfig = smtpConfig.enabled;
const mailFromAddress = smtpConfig.fromAddress;
const ALERT_EMAIL = process.env.ALERT_EMAIL || process.env.INTERNAL_REVIEWER_EMAIL || '';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3005';
// Dedup: track last alert time per alert_type (15-min cooldown)
const alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const transporter = hasSmtpConfig ? nodemailer_1.default.createTransport(smtpConfig.transportOptions) : null;
app.use(express.json());
app.post('/notify', async (req, res) => {
    const { type, payload } = req.body;
    if (!type || !payload) {
        return res.status(400).send('Missing notification type or payload.');
    }
    if (!hasSmtpConfig) {
        console.warn(`SMTP not configured. Skipping notification type "${type}".`);
        return res.status(200).json({ skipped: true, reason: 'smtp_not_configured' });
    }
    try {
        let mailOptions;
        switch (type) {
            case 'corrections_ready':
                const correctedBuffer = await fs_1.promises.readFile(payload.corrected_path);
                mailOptions = {
                    from: `"Menu Review Bot" <${mailFromAddress}>`,
                    to: payload.submitter_email,
                    subject: `Corrections Ready: ${payload.project_name || payload.filename}`,
                    html: `
                        <p>Hello ${payload.submitter_name || ''},</p>
                        <p>The corrected version of your menu submission is ready. Please find it attached.</p>
                        <p>Thank you,</p>
                        <p>Menu Review Bot</p>
                    `,
                    attachments: [
                        {
                            filename: payload.filename || 'corrected-menu.docx',
                            content: correctedBuffer,
                            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        },
                    ],
                };
                break;
            case 'admin_alert': {
                if (!ALERT_EMAIL) {
                    console.warn('No ALERT_EMAIL configured. Skipping admin alert.');
                    return res.status(200).json({ skipped: true, reason: 'no_alert_email' });
                }
                const alertType = payload.alert_type || 'unknown';
                const lastSent = alertCooldowns.get(alertType) || 0;
                if (Date.now() - lastSent < ALERT_COOLDOWN_MS) {
                    console.log(`Alert "${alertType}" suppressed (cooldown). Last sent ${Math.round((Date.now() - lastSent) / 1000)}s ago.`);
                    return res.status(200).json({ skipped: true, reason: 'cooldown', alert_type: alertType });
                }
                const severityLabel = (payload.severity || 'error').toUpperCase();
                const serviceName = payload.service || 'unknown';
                const submissionId = payload.submission_id || '';
                const message = payload.message || 'No details provided';
                const details = payload.details || '';
                mailOptions = {
                    from: `"Menu Manager Alerts" <${mailFromAddress}>`,
                    to: ALERT_EMAIL,
                    subject: `[${severityLabel}] ${alertType} — Menu Manager`,
                    html: `
                        <div style="font-family: sans-serif; max-width: 600px;">
                            <h2 style="color: ${severityLabel === 'CRITICAL' ? '#d32f2f' : '#e65100'}; margin-bottom: 4px;">
                                ${severityLabel}: ${alertType.replace(/_/g, ' ')}
                            </h2>
                            <table style="border-collapse: collapse; width: 100%; margin: 12px 0;">
                                <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold; width: 120px;">Service</td><td style="padding: 6px 12px;">${serviceName}</td></tr>
                                ${submissionId ? `<tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Submission</td><td style="padding: 6px 12px;">${submissionId}</td></tr>` : ''}
                                <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Time</td><td style="padding: 6px 12px;">${new Date().toISOString()}</td></tr>
                            </table>
                            <div style="background: #fff3e0; border-left: 4px solid #e65100; padding: 12px; margin: 12px 0;">
                                <strong>Message:</strong><br>${message}
                            </div>
                            ${details ? `<details style="margin: 12px 0;"><summary style="cursor: pointer; font-weight: bold;">Technical Details</summary><pre style="background: #f5f5f5; padding: 12px; overflow: auto; font-size: 12px;">${typeof details === 'string' ? details : JSON.stringify(details, null, 2)}</pre></details>` : ''}
                            ${submissionId ? `<p><a href="${DASHBOARD_URL}/review/${submissionId}">View Submission</a></p>` : ''}
                        </div>
                    `,
                };
                alertCooldowns.set(alertType, Date.now());
                break;
            }
            default:
                return res.status(200).json({ skipped: true, reason: 'notification_type_disabled', type });
        }
        await transporter.sendMail(mailOptions);
        console.log(`Notification email (${type}) sent successfully.`);
        res.status(200).send('Notification sent successfully.');
    }
    catch (error) {
        console.error('Error sending email:', error);
        res.status(500).send('Error sending notification.');
    }
});
app.listen(port, () => {
    console.log(`notifier service listening at http://localhost:${port}`);
    if (!hasSmtpConfig) {
        console.log('Notifier mode: SMTP not configured, notifications will be skipped.');
    }
});

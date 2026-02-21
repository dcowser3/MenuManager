"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = require("fs");
dotenv_1.default.config({ path: '../../../.env' });
const app = (0, express_1.default)();
const port = 3003;
const hasSmtpConfig = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
app.use(express_1.default.json());
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
                    from: `"Menu Review Bot" <${process.env.GRAPH_MAILBOX_ADDRESS}>`,
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

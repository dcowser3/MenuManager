import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config({ path: '../../../.env' });

const app = express();
const port = 3003;

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

app.use(express.json());

app.post('/notify', async (req, res) => {
    const { report, submitter_email } = req.body;

    if (!report || !submitter_email) {
        return res.status(400).send('Missing report or submitter email.');
    }

    try {
        let mailOptions;

        if (report.needs_resubmit) {
            mailOptions = {
                from: `"Menu Review Bot" <${process.env.GRAPH_MAILBOX_ADDRESS}>`,
                to: submitter_email,
                subject: 'Action Required: Menu Submission Review',
                html: `
                    <p>Hello,</p>
                    <p>Your recent menu submission requires a few corrections. Please review the issues below and resubmit:</p>
                    <ul>
                        ${report.issues.map((issue: any) => `<li><b>${issue.type} at ${issue.location}:</b> ${issue.explanation} (Suggested fix: ${issue.fix})</li>`).join('')}
                    </ul>
                    <p>Thank you,</p>
                    <p>Menu Review Bot</p>
                `,
            };
        } else {
            mailOptions = {
                from: `"Menu Review Bot" <${process.env.GRAPH_MAILBOX_ADDRESS}>`,
                to: submitter_email,
                subject: 'Your Menu Submission has been Processed',
                html: `
                    <p>Hello,</p>
                    <p>Your menu submission has been reviewed and corrected. Please find the red-lined version attached.</p>
                    <p>Summary of changes: ${report.summary}</p>
                    <p>Thank you,</p>
                    <p>Menu Review Bot</p>
                `,
                attachments: [
                    {
                        filename: 'redlined_document.docx',
                        content: report.redlined_doc,
                        encoding: 'base64',
                        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    },
                ],
            };
        }

        await transporter.sendMail(mailOptions);
        console.log('Notification email sent to:', submitter_email);
        res.status(200).send('Notification sent successfully.');

    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).send('Error sending notification.');
    }
});

app.listen(port, () => {
    console.log(`notifier service listening at http://localhost:${port}`);
});

import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { generateRedlinedDoc } from './src/doc-generator';

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

        if (report.status === 'needs_resubmission') {
            // Tier 1 Failure: Send general feedback email
            mailOptions = {
                from: `"Menu Review Bot" <${process.env.GRAPH_MAILBOX_ADDRESS}>`,
                to: submitter_email,
                subject: 'Action Required: Menu Submission Review',
                html: `
                    <p>Hello,</p>
                    <p>Your recent menu submission requires corrections before it can be finalized. Please review the feedback below and submit a revised version.</p>
                    <hr>
                    <h3>Automated Review Feedback:</h3>
                    <pre style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; white-space: pre-wrap;">${report.feedback_content}</pre>
                    <p>Thank you,</p>
                    <p>Menu Review Bot</p>
                `,
            };
        } else if (report.status === 'approved_with_edits') {
            // Tier 2 Success: Generate and send red-lined document
            const docBuffer = await generateRedlinedDoc(report.redlined_content);

            mailOptions = {
                from: `"Menu Review Bot" <${process.env.GRAPH_MAILBOX_ADDRESS}>`,
                to: submitter_email,
                subject: 'Your Menu Submission has been Processed',
                html: `
                    <p>Hello,</p>
                    <p>Your menu submission has been reviewed and corrected. Please find the red-lined version attached for your final approval.</p>
                    <p>Thank you,</p>
                    <p>Menu Review Bot</p>
                `,
                attachments: [
                    {
                        filename: 'redlined_menu.docx',
                        content: docBuffer,
                        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    },
                ],
            };
        } else {
            return res.status(400).send('Invalid report status.');
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

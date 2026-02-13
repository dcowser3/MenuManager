import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { promises as fsPromises } from 'fs';
import { generateRedlinedDoc } from './src/doc-generator';

dotenv.config({ path: '../../../.env' });

const app = express();
const port = 3003;

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

app.use(express.json());

app.post('/notify', async (req, res) => {
    const { type, payload } = req.body;

    if (!type || !payload) {
        return res.status(400).send('Missing notification type or payload.');
    }

    try {
        let mailOptions;

        switch (type) {
            case 'tier1_rejection':
                mailOptions = {
                    from: `"Menu Review Bot" <${process.env.GRAPH_MAILBOX_ADDRESS}>`,
                    to: payload.submitter_email,
                    subject: 'Action Required: Menu Submission Review',
                    html: `
                        <p>Hello,</p>
                        <p>Your recent menu submission requires corrections before it can be finalized. Please review the feedback below and submit a revised version.</p>
                        <hr>
                        <h3>Automated Review Feedback:</h3>
                        <pre style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; white-space: pre-wrap;">${payload.feedback_content}</pre>
                        <p>Thank you,</p>
                        <p>Menu Review Bot</p>
                    `,
                };
                break;

            case 'internal_review_request':
                const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3005';
                const reviewUrl = `${dashboardUrl}/review/${payload.submission_id}`;
                
                mailOptions = {
                    from: `"Menu Review Bot" <${process.env.GRAPH_MAILBOX_ADDRESS}>`,
                    to: process.env.INTERNAL_REVIEWER_EMAIL,
                    subject: `🔔 New Menu Submission for Review: ${payload.filename}`,
                    html: `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <style>
                                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                                .content { background: #f7fafc; padding: 30px; border-radius: 0 0 8px 8px; }
                                .info-box { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #667eea; }
                                .info-box strong { color: #667eea; }
                                .button { display: inline-block; padding: 15px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
                                .footer { text-align: center; color: #718096; font-size: 14px; margin-top: 30px; }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <div class="header">
                                    <h1 style="margin: 0; font-size: 24px;">🍽️ New Menu Review Request</h1>
                                </div>
                                <div class="content">
                                    <p>Hello,</p>
                                    <p>A new menu submission has <strong>passed the initial AI check</strong> and is ready for your review.</p>
                                    
                                    <div class="info-box">
                                        <p><strong>Submission ID:</strong> ${payload.submission_id}</p>
                                        <p><strong>Original Filename:</strong> ${payload.filename}</p>
                                        <p><strong>Submitter:</strong> ${payload.submitter_email || 'N/A'}</p>
                                        <p><strong>Status:</strong> Pending Your Review</p>
                                    </div>
                                    
                                    <p><strong>Next Steps:</strong></p>
                                    <ol>
                                        <li>Click the button below to access the review dashboard</li>
                                        <li>Download both the original and AI draft documents</li>
                                        <li>Compare the AI's suggested changes</li>
                                        <li>Either approve the AI draft or upload your corrected version</li>
                                    </ol>
                                    
                                    <div style="text-align: center;">
                                        <a href="${reviewUrl}" class="button">
                                            📊 Review Now →
                                        </a>
                                    </div>
                                    
                                    <p style="font-size: 14px; color: #718096; margin-top: 20px;">
                                        <em>Important: Your review helps train the AI system. If you make any corrections to the AI draft, those changes will be analyzed to improve future suggestions.</em>
                                    </p>
                                </div>
                                <div class="footer">
                                    <p>RSH Menu Management System</p>
                                    <p style="font-size: 12px;">Dashboard URL: ${reviewUrl}</p>
                                </div>
                            </div>
                        </body>
                        </html>
                    `,
                };
                break;
            
            case 'final_approval_to_chef':
                const docBuffer = await generateRedlinedDoc(payload.redlined_content);
                mailOptions = {
                    from: `"Menu Review Bot" <${process.env.GRAPH_MAILBOX_ADDRESS}>`,
                    to: payload.submitter_email,
                    subject: `Final Approved Menu: ${payload.filename}`,
                    html: `
                        <p>Hello,</p>
                        <p>Your menu submission has been reviewed and approved. Please find the final, red-lined version attached.</p>
                        <p>Thank you,</p>
                        <p>Menu Review Bot</p>
                    `,
                    attachments: [
                        {
                            filename: `final_${payload.filename}`,
                            content: docBuffer,
                            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        },
                    ],
                };
                break;

            case 'corrections_ready':
                const correctedBuffer = await fsPromises.readFile(payload.corrected_path);
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
                return res.status(400).send('Invalid notification type.');
        }

        await transporter.sendMail(mailOptions);
        console.log(`Notification email (${type}) sent successfully.`);
        res.status(200).send('Notification sent successfully.');

    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).send('Error sending notification.');
    }
});

app.listen(port, () => {
    console.log(`notifier service listening at http://localhost:${port}`);
});

import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const app = express();
const port = 3007;

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;
const CLICKUP_ASSIGNEE_ID = process.env.CLICKUP_ASSIGNEE_ID;
const CLICKUP_TEAM_ID = process.env.CLICKUP_TEAM_ID;
const CLICKUP_WEBHOOK_URL = process.env.CLICKUP_WEBHOOK_URL;
const CLICKUP_CORRECTIONS_STATUS = (process.env.CLICKUP_CORRECTIONS_STATUS || 'corrections complete').toLowerCase();

const clickupHeaders = {
    'Authorization': CLICKUP_API_TOKEN || '',
    'Content-Type': 'application/json',
};

app.use(express.json());

/**
 * POST /create-task — Called by Dashboard after form submit.
 * Creates a ClickUp task with the generated DOCX attached.
 */
app.post('/create-task', async (req, res) => {
    try {
        if (!CLICKUP_API_TOKEN || !CLICKUP_LIST_ID) {
            console.log('ClickUp not configured, skipping task creation');
            return res.json({ skipped: true });
        }

        const {
            submissionId,
            submitterName,
            submitterEmail,
            submitterJobTitle,
            projectName,
            property,
            width,
            height,
            cropMarks,
            bleedMarks,
            fileSizeLimit,
            fileSizeLimitMb,
            fileDeliveryNotes,
            orientation,
            menuType,
            templateType,
            dateNeeded,
            hotelName,
            cityCountry,
            assetType,
            docxPath,
        } = req.body;

        // Create task in ClickUp
        const taskPayload: any = {
            name: `${projectName} — ${property}`,
            description: [
                `**Submission ID:** ${submissionId}`,
                `**Submitter:** ${submitterName} (${submitterEmail})`,
                `**Job Title:** ${submitterJobTitle || 'N/A'}`,
                `**Menu Type:** ${menuType || 'standard'}`,
                `**Template:** ${templateType || 'food'}`,
                `**Dimensions:** ${width} x ${height} ${assetType === 'PRINT' ? 'inches' : 'pixels'}`,
                `**Orientation:** ${orientation || 'N/A'}`,
                `**Hotel:** ${hotelName || 'N/A'}`,
                `**Location:** ${cityCountry || 'N/A'}`,
                `**Asset Type:** ${assetType || 'N/A'}`,
                `**Date Needed:** ${dateNeeded || 'N/A'}`,
                ...(assetType === 'PRINT' ? [
                    `**Crop Marks:** ${cropMarks || 'No'}`,
                    `**Bleed Marks:** ${bleedMarks || 'No'}`,
                    `**File Size Limit:** ${fileSizeLimit === 'yes' ? `Yes (${fileSizeLimitMb || 'N/A'} MB)` : 'No'}`,
                    ...(fileDeliveryNotes ? [`**Delivery Notes:** ${fileDeliveryNotes}`] : []),
                ] : []),
            ].join('\n'),
            status: 'to do',
        };

        if (CLICKUP_ASSIGNEE_ID) {
            taskPayload.assignees = [parseInt(CLICKUP_ASSIGNEE_ID)];
        }

        if (dateNeeded) {
            taskPayload.due_date = new Date(dateNeeded).getTime();
        }

        const taskResponse = await axios.post(
            `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`,
            taskPayload,
            { headers: clickupHeaders }
        );

        const taskId = taskResponse.data.id;
        console.log(`ClickUp task created: ${taskId}`);

        // Upload DOCX attachment if file exists
        if (docxPath && fs.existsSync(docxPath)) {
            const form = new FormData();
            form.append('attachment', fs.createReadStream(docxPath), {
                filename: path.basename(docxPath),
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });

            await axios.post(
                `https://api.clickup.com/api/v2/task/${taskId}/attachment`,
                form,
                {
                    headers: {
                        'Authorization': CLICKUP_API_TOKEN,
                        ...form.getHeaders(),
                    },
                }
            );
            console.log(`DOCX attached to ClickUp task ${taskId}`);
        }

        // Store clickup_task_id on submission
        if (submissionId) {
            await axios.put(`http://localhost:3004/submissions/${submissionId}`, {
                clickup_task_id: taskId,
            });
            console.log(`Stored clickup_task_id ${taskId} on submission ${submissionId}`);
        }

        res.json({ success: true, taskId });
    } catch (error: any) {
        console.error('Error creating ClickUp task:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to create ClickUp task', details: error.message });
    }
});

/**
 * POST /webhook/clickup — Receives ClickUp webhook events.
 * When a task status changes to "corrections complete", downloads the
 * corrected file and triggers notifications + differ.
 */
app.post('/webhook/clickup', async (req, res) => {
    // Immediately respond 200 (ClickUp retries on non-2xx)
    res.status(200).send('OK');

    try {
        const { event, task_id: clickupTaskId, history_items } = req.body;

        // Only handle taskStatusUpdated
        if (event !== 'taskStatusUpdated') return;

        // Check if the new status matches our target
        const statusChange = history_items?.find((h: any) => h.field === 'status');
        const newStatus = (statusChange?.after?.status || '').toLowerCase();
        if (newStatus !== CLICKUP_CORRECTIONS_STATUS) return;

        console.log(`ClickUp task ${clickupTaskId} moved to "${newStatus}"`);

        // Look up submission by clickup_task_id
        const subResponse = await axios.get(
            `http://localhost:3004/submissions/by-clickup-task/${clickupTaskId}`
        );
        const submission = subResponse.data;
        console.log(`Found submission ${submission.id} for ClickUp task ${clickupTaskId}`);

        // Fetch task from ClickUp to get attachments
        const taskResponse = await axios.get(
            `https://api.clickup.com/api/v2/task/${clickupTaskId}`,
            { headers: clickupHeaders }
        );

        const attachments = taskResponse.data.attachments || [];
        if (attachments.length === 0) {
            console.log(`No attachments on ClickUp task ${clickupTaskId}, skipping download`);
            return;
        }

        // Download the latest attachment
        const latestAttachment = attachments[attachments.length - 1];
        const uploadsDir = path.join(__dirname, '..', '..', '..', 'tmp', 'uploads');
        await fs.promises.mkdir(uploadsDir, { recursive: true });
        const correctedPath = path.join(uploadsDir, `${submission.id}-corrected.docx`);

        const fileResponse = await axios.get(latestAttachment.url, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': CLICKUP_API_TOKEN || '' },
        });
        await fs.promises.writeFile(correctedPath, fileResponse.data);
        console.log(`Downloaded corrected file to ${correctedPath}`);

        // Update submission status and final_path
        await axios.put(`http://localhost:3004/submissions/${submission.id}`, {
            status: 'approved',
            final_path: correctedPath,
        });
        console.log(`Updated submission ${submission.id} to approved`);

        // Notify submitter (fire-and-forget)
        axios.post('http://localhost:3003/notify', {
            type: 'corrections_ready',
            payload: {
                submitter_email: submission.submitter_email,
                submitter_name: submission.submitter_name,
                project_name: submission.project_name,
                corrected_path: correctedPath,
                filename: submission.filename,
            },
        }).catch(err => console.error('Failed to send corrections_ready notification:', err.message));

        // Feed to differ for training (fire-and-forget)
        axios.post('http://localhost:3006/compare', {
            ai_draft_path: submission.ai_draft_path,
            final_path: correctedPath,
            submission_id: submission.id,
        }).catch(err => console.error('Failed to trigger differ comparison:', err.message));

    } catch (error: any) {
        console.error('Error processing ClickUp webhook:', error.response?.data || error.message);
    }
});

/**
 * POST /webhook/register — One-time webhook setup with ClickUp.
 */
app.post('/webhook/register', async (req, res) => {
    try {
        if (!CLICKUP_API_TOKEN || !CLICKUP_TEAM_ID || !CLICKUP_WEBHOOK_URL) {
            return res.status(400).json({
                error: 'Missing required env vars: CLICKUP_API_TOKEN, CLICKUP_TEAM_ID, CLICKUP_WEBHOOK_URL',
            });
        }

        const response = await axios.post(
            `https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/webhook`,
            {
                endpoint: CLICKUP_WEBHOOK_URL,
                events: ['taskStatusUpdated'],
            },
            { headers: clickupHeaders }
        );

        console.log('ClickUp webhook registered:', response.data);
        res.json({ success: true, webhook: response.data });
    } catch (error: any) {
        console.error('Error registering ClickUp webhook:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to register webhook', details: error.message });
    }
});

/**
 * GET /health — Health check.
 */
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'clickup-integration',
        configured: !!(CLICKUP_API_TOKEN && CLICKUP_LIST_ID),
    });
});

app.listen(port, () => {
    console.log(`clickup-integration service listening at http://localhost:${port}`);
    if (!CLICKUP_API_TOKEN) {
        console.log('ClickUp API token not configured — task creation will be skipped');
    }
});

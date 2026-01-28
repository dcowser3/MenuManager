import express from 'express';
import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';
import dotenv from 'dotenv';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { processNotification } from './src/graph';
import multer from 'multer';
import FormData from 'form-data';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: '../../.env' });

const app = express();
const port = 3000;

const config = {
    auth: {
        clientId: process.env.GRAPH_CLIENT_ID!,
        authority: `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}`,
        clientSecret: process.env.GRAPH_CLIENT_SECRET!,
    },
};

const cca = new ConfidentialClientApplication(config);

// Initialize Graph Client
const client = Client.initWithMiddleware({
    authProvider: {
        getAccessToken: async () => {
            const tokenRequest = {
                scopes: ['https://graph.microsoft.com/.default'],
            };
            const response = await cca.acquireTokenByClientCredential(tokenRequest);
            return response!.accessToken;
        }
    }
});

app.use(express.json());

// Endpoint for Microsoft Graph webhook notifications
app.post('/webhook', (req, res) => {
    // Handle webhook validation
    if (req.query.validationToken) {
        console.log('Validating webhook...');
        res.status(200).send(req.query.validationToken);
        return;
    }

    console.log('Received a webhook notification:');
    processNotification(req.body, client);

    res.status(202).send(); // Acknowledge receipt of the notification
});

/**
 * Test-only endpoint: Simulate an inbound email with an attachment.
 * This bypasses Graph but exercises the exact same downstream path (parser → ai-review → db → dashboard).
 * 
 * multipart/form-data:
 *  - file: .docx attachment
 *  - submitter_email: email address of the sender
 *  - subject (optional)
 */
const upload = multer({ dest: path.join(__dirname, '..', '..', '..', 'tmp', 'uploads') });
app.post('/simulate-email', upload.single('file') as any, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const submitterEmail = (req.body.submitter_email || 'tester@example.com').toString();
        const originalName = req.file.originalname || path.basename(req.file.path);

        const form = new FormData();
        form.append('file', fs.createReadStream(req.file.path), originalName);
        form.append('submitter_email', submitterEmail);
        form.append('message_id', `sim_${Date.now()}`);

        const parserUrl = 'http://localhost:3001/parser';
        const response = await axios.post(parserUrl, form, { headers: form.getHeaders() });

        res.status(200).json({
            ok: true,
            forwarded_to: parserUrl,
            parser_response: response.data
        });
    } catch (error: any) {
        console.error('simulate-email error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to simulate email', details: error.response?.data || error.message });
    }
});

app.listen(port, async () => {
    console.log(`inbound-email service listening at http://localhost:${port}`);
    // Create the subscription to the mailbox
    await createSubscription();
});

async function getFolderResource(): Promise<string> {
    const folderName = process.env.GRAPH_FOLDER_NAME;
    
    // If no folder name specified, monitor the entire inbox
    if (!folderName || folderName.trim() === '') {
        console.log('Monitoring entire inbox (no specific folder configured)');
        return `/users/${process.env.GRAPH_MAILBOX_ADDRESS}/mailFolders('inbox')/messages`;
    }

    try {
        // Search for the folder by name
        console.log(`Looking for folder: "${folderName}"`);
        const folders = await client.api(`/users/${process.env.GRAPH_MAILBOX_ADDRESS}/mailFolders`).get();
        
        const targetFolder = folders.value.find((folder: any) => 
            folder.displayName.toLowerCase() === folderName.toLowerCase()
        );

        if (targetFolder) {
            console.log(`Found folder "${folderName}" with ID: ${targetFolder.id}`);
            return `/users/${process.env.GRAPH_MAILBOX_ADDRESS}/mailFolders('${targetFolder.id}')/messages`;
        } else {
            console.warn(`Folder "${folderName}" not found. Falling back to inbox.`);
            return `/users/${process.env.GRAPH_MAILBOX_ADDRESS}/mailFolders('inbox')/messages`;
        }
    } catch (error) {
        console.error('Error finding folder, falling back to inbox:', error);
        return `/users/${process.env.GRAPH_MAILBOX_ADDRESS}/mailFolders('inbox')/messages`;
    }
}

async function createSubscription() {
    try {
        const webhookUrl = process.env.WEBHOOK_URL;
        
        if (!webhookUrl || webhookUrl.includes('your-public-url')) {
            console.error('\n⚠️  WEBHOOK_URL not configured in .env file!');
            console.error('Set up ngrok (ngrok http 3000) and update WEBHOOK_URL in .env');
            console.error('Subscription creation skipped.\n');
            return;
        }

        const resource = await getFolderResource();
        
        const subscription = {
            changeType: 'created',
            notificationUrl: webhookUrl,
            resource: resource,
            expirationDateTime: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
            clientState: 'secretClientValue'
        };

        console.log('Creating subscription with resource:', resource);
        const response = await client.api('/subscriptions').post(subscription);
        console.log('✅ Subscription created successfully:', response.id);
        console.log(`Expires at: ${response.expirationDateTime}`);
    } catch (error: any) {
        console.error('❌ Error creating subscription:', error.message);
        if (error.body) {
            console.error('Details:', error.body);
        }
    }
}

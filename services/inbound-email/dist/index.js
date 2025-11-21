"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const microsoft_graph_client_1 = require("@microsoft/microsoft-graph-client");
require("isomorphic-fetch");
const dotenv_1 = __importDefault(require("dotenv"));
const msal_node_1 = require("@azure/msal-node");
const graph_1 = require("./src/graph");
const multer_1 = __importDefault(require("multer"));
const form_data_1 = __importDefault(require("form-data"));
const axios_1 = __importDefault(require("axios"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
dotenv_1.default.config({ path: '../../.env' });
const app = (0, express_1.default)();
const port = 3000;
const config = {
    auth: {
        clientId: process.env.GRAPH_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}`,
        clientSecret: process.env.GRAPH_CLIENT_SECRET,
    },
};
const cca = new msal_node_1.ConfidentialClientApplication(config);
// Initialize Graph Client
const client = microsoft_graph_client_1.Client.initWithMiddleware({
    authProvider: {
        getAccessToken: async () => {
            const tokenRequest = {
                scopes: ['https://graph.microsoft.com/.default'],
            };
            const response = await cca.acquireTokenByClientCredential(tokenRequest);
            return response.accessToken;
        }
    }
});
app.use(express_1.default.json());
// Endpoint for Microsoft Graph webhook notifications
app.post('/webhook', (req, res) => {
    // Handle webhook validation
    if (req.query.validationToken) {
        console.log('Validating webhook...');
        res.status(200).send(req.query.validationToken);
        return;
    }
    console.log('Received a webhook notification:');
    (0, graph_1.processNotification)(req.body, client);
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
const upload = (0, multer_1.default)({ dest: path.join(__dirname, '..', '..', '..', 'tmp', 'uploads') });
app.post('/simulate-email', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const submitterEmail = (req.body.submitter_email || 'tester@example.com').toString();
        const originalName = req.file.originalname || path.basename(req.file.path);
        const form = new form_data_1.default();
        form.append('file', fs.createReadStream(req.file.path), originalName);
        form.append('submitter_email', submitterEmail);
        form.append('message_id', `sim_${Date.now()}`);
        const parserUrl = 'http://localhost:3001/parser';
        const response = await axios_1.default.post(parserUrl, form, { headers: form.getHeaders() });
        res.status(200).json({
            ok: true,
            forwarded_to: parserUrl,
            parser_response: response.data
        });
    }
    catch (error) {
        console.error('simulate-email error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to simulate email', details: error.response?.data || error.message });
    }
});
app.listen(port, async () => {
    console.log(`inbound-email service listening at http://localhost:${port}`);
    // Create the subscription to the mailbox
    await createSubscription();
});
async function getFolderResource() {
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
        const targetFolder = folders.value.find((folder) => folder.displayName.toLowerCase() === folderName.toLowerCase());
        if (targetFolder) {
            console.log(`Found folder "${folderName}" with ID: ${targetFolder.id}`);
            return `/users/${process.env.GRAPH_MAILBOX_ADDRESS}/mailFolders('${targetFolder.id}')/messages`;
        }
        else {
            console.warn(`Folder "${folderName}" not found. Falling back to inbox.`);
            return `/users/${process.env.GRAPH_MAILBOX_ADDRESS}/mailFolders('inbox')/messages`;
        }
    }
    catch (error) {
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
    }
    catch (error) {
        console.error('❌ Error creating subscription:', error.message);
        if (error.body) {
            console.error('Details:', error.body);
        }
    }
}

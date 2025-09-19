import express from 'express';
import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';
import dotenv from 'dotenv';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { processNotification } from './src/graph';

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

app.listen(port, () => {
    console.log(`inbound-email service listening at http://localhost:${port}`);
    // Here you would also create the subscription to the mailbox
    // using the Microsoft Graph API.
    createSubscription();
});

async function createSubscription() {
    try {
        const subscription = {
            changeType: 'created',
            notificationUrl: 'YOUR_PUBLIC_NGROK_OR_SERVER_URL/webhook', // Replace with your webhook URL
            resource: `/users/${process.env.GRAPH_MAILBOX_ADDRESS}/mailFolders('inbox')/messages`,
            expirationDateTime: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
            clientState: 'secretClientValue'
        };

        const response = await client.api('/subscriptions').post(subscription);
        console.log('Subscription created:', response);
    } catch (error) {
        console.error('Error creating subscription:', error);
    }
}

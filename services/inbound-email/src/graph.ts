import { Client } from '@microsoft/microsoft-graph-client';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function processNotification(notification: any, client: Client) {
    for (const resource of notification.value) {
        try {
            const message = await client.api(resource.resourceData['@odata.id']).get();

            if (!meetsCriteria(message)) {
                console.log(`Message ${message.id} does not meet criteria, skipping.`);
                continue;
            }

            const attachments = await client.api(`/messages/${message.id}/attachments`).get();

            for (const attachment of attachments.value) {
                if (attachment.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                    console.log(`Downloading attachment ${attachment.name} from message ${message.id}`);
                    
                    const attachmentContent = await client.api(`/messages/${message.id}/attachments/${attachment.id}`).get();
                    const attachmentBytes = Buffer.from(attachmentContent.contentBytes, 'base64');
                    
                    const filePath = path.join(UPLOAD_DIR, attachment.name);
                    fs.writeFileSync(filePath, attachmentBytes);
                    console.log(`Attachment saved to ${filePath}`);

                    // Here you would POST the file + metadata to the /parser endpoint
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    }
}

function meetsCriteria(message: any): boolean {
    const approvedSenders = (process.env.APPROVED_SENDER_DOMAINS || '').split(',');

    const subjectMatch = message.subject && (message.subject.includes('Menu') || message.subject.includes('Design Brief'));
    const senderMatch = approvedSenders.some(domain => message.sender.emailAddress.address.endsWith(domain));
    const hasAttachments = message.hasAttachments;

    return subjectMatch && senderMatch && hasAttachments;
}

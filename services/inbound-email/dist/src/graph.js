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
exports.processNotification = processNotification;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'uploads');
const PROCESSED_IDS_FILE = path.join(__dirname, '..', '..', '..', 'tmp', 'processed_message_ids.json');
// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
// Load processed message IDs
let processedMessageIds = new Set();
try {
    if (fs.existsSync(PROCESSED_IDS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf-8'));
        processedMessageIds = new Set(data);
    }
}
catch (error) {
    console.error('Error loading processed message IDs:', error);
}
// Save processed message ID
function markAsProcessed(messageId) {
    processedMessageIds.add(messageId);
    fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(Array.from(processedMessageIds), null, 2));
}
// Check if already processed
function isAlreadyProcessed(messageId) {
    return processedMessageIds.has(messageId);
}
async function processNotification(notification, client) {
    for (const resource of notification.value) {
        try {
            const message = await client.api(resource.resourceData['@odata.id']).get();
            // SAFETY CHECK 1: Check if we've already processed this message
            if (isAlreadyProcessed(message.id)) {
                console.log(`⏭️  Message ${message.id} already processed, skipping.`);
                continue;
            }
            // SAFETY CHECK 2: Exclude emails FROM our own system
            if (isFromOwnSystem(message)) {
                console.log(`⏭️  Message ${message.id} is from our own system, skipping.`);
                continue;
            }
            // SAFETY CHECK 3: Apply custom criteria (sender domain, attachments, etc.)
            if (!meetsCriteria(message)) {
                console.log(`⏭️  Message ${message.id} does not meet criteria, skipping.`);
                continue;
            }
            console.log(`✅ Processing new submission: ${message.subject} from ${message.sender.emailAddress.address}`);
            const attachments = await client.api(`/messages/${message.id}/attachments`).get();
            const submitterEmail = message.sender.emailAddress.address;
            for (const attachment of attachments.value) {
                if (attachment.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                    console.log(`📥 Downloading attachment ${attachment.name} from message ${message.id}`);
                    const attachmentContent = await client.api(`/messages/${message.id}/attachments/${attachment.id}`).get();
                    const attachmentBytes = Buffer.from(attachmentContent.contentBytes, 'base64');
                    const filePath = path.join(UPLOAD_DIR, `${Date.now()}_${attachment.name}`);
                    fs.writeFileSync(filePath, attachmentBytes);
                    console.log(`💾 Attachment saved to ${filePath}`);
                    // POST the file to the parser service
                    await sendToParser(filePath, attachment.name, submitterEmail, message.id);
                    // Mark this message as processed after successful submission
                    markAsProcessed(message.id);
                    console.log(`✓ Message ${message.id} marked as processed`);
                }
            }
        }
        catch (error) {
            console.error('❌ Error processing message:', error);
        }
    }
}
async function sendToParser(filePath, originalFilename, submitterEmail, messageId) {
    try {
        const formData = new form_data_1.default();
        formData.append('file', fs.createReadStream(filePath));
        formData.append('submitter_email', submitterEmail);
        formData.append('message_id', messageId);
        const response = await axios_1.default.post('http://localhost:3001/parser', formData, {
            headers: formData.getHeaders(),
        });
        console.log(`📤 File ${originalFilename} sent to parser successfully:`, response.data);
    }
    catch (error) {
        console.error(`❌ Error sending file to parser:`, error.response?.data || error.message);
        throw error; // Re-throw to prevent marking as processed if it failed
    }
    finally {
        // Clean up the temporary file after sending
        try {
            fs.unlinkSync(filePath);
            console.log(`🗑️  Temporary file ${filePath} cleaned up.`);
        }
        catch (cleanupError) {
            console.error(`⚠️  Error cleaning up file ${filePath}:`, cleanupError);
        }
    }
}
// Check if email is from our own system
function isFromOwnSystem(message) {
    const systemEmail = process.env.GRAPH_MAILBOX_ADDRESS?.toLowerCase();
    const senderEmail = message.sender.emailAddress.address.toLowerCase();
    return senderEmail === systemEmail;
}
function meetsCriteria(message) {
    const approvedSenders = (process.env.APPROVED_SENDER_DOMAINS || '').split(',');
    const subjectMatch = message.subject && (message.subject.includes('Menu') || message.subject.includes('Design Brief'));
    const senderMatch = approvedSenders.some(domain => message.sender.emailAddress.address.endsWith(domain));
    const hasAttachments = message.hasAttachments;
    return subjectMatch && senderMatch && hasAttachments;
}

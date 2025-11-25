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
                    await sendToParser(filePath, attachment.name, submitterEmail, message.id, client);
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
async function sendToParser(filePath, originalFilename, submitterEmail, messageId, client) {
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
        // Send reply email explaining the rejection
        const errorData = error.response?.data;
        if (errorData && client) {
            await sendRejectionEmail(client, messageId, submitterEmail, originalFilename, errorData);
        }
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
/**
 * Send a reply email to the chef explaining why their submission was rejected
 */
async function sendRejectionEmail(client, messageId, toEmail, filename, errorData) {
    try {
        console.log(`📧 Sending rejection email to ${toEmail} for ${filename}...`);
        let subject = '';
        let htmlBody = '';
        // Determine rejection type and generate appropriate email
        if (errorData.errors && Array.isArray(errorData.errors)) {
            // Template validation failure
            subject = `❌ Menu Submission Rejected - Wrong Template`;
            htmlBody = buildTemplateFailureEmail(filename, errorData.errors);
        }
        else if (errorData.status === 'needs_prompt_fix' && errorData.error_count) {
            // Pre-check failure
            subject = `⚠️ Menu Submission Needs Corrections - Please Use QA Prompt`;
            htmlBody = buildPrecheckFailureEmail(filename, errorData);
        }
        else if (errorData.status === 'needs_prompt_fix' && errorData.reasons) {
            // Format failure
            subject = `⚠️ Menu Submission - Formatting Issues`;
            htmlBody = buildFormatFailureEmail(filename, errorData);
        }
        else {
            // Generic error
            subject = `❌ Menu Submission Error`;
            htmlBody = buildGenericErrorEmail(filename, errorData.message || 'Unknown error');
        }
        // Create and send reply using Microsoft Graph API
        const mailboxAddress = process.env.GRAPH_MAILBOX_ADDRESS;
        const replyMessage = {
            subject: subject,
            body: {
                contentType: 'HTML',
                content: htmlBody
            },
            toRecipients: [
                {
                    emailAddress: {
                        address: toEmail
                    }
                }
            ]
        };
        // Send as a new message (reply functionality requires different approach)
        await client.api(`/users/${mailboxAddress}/sendMail`).post({
            message: replyMessage,
            saveToSentItems: true
        });
        console.log(`✅ Rejection email sent to ${toEmail}`);
    }
    catch (error) {
        console.error(`❌ Error sending reply email:`, error.message);
        // Don't throw - rejection email is nice-to-have, shouldn't break workflow
    }
}
function buildTemplateFailureEmail(filename, errors) {
    const errorList = errors.map(err => `<div style="color: #c53030; margin: 10px 0;">• ${err}</div>`).join('');
    return `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background: #e53e3e; color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">❌ Template Validation Failed</h1>
        </div>
        <div style="background: #fff5f5; padding: 30px;">
            <p>Hello,</p>
            <p>Your menu submission <strong>"${filename}"</strong> could not be processed because it does not match the required RSH Design Brief template.</p>
            
            <div style="background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #e53e3e;">
                <h3 style="margin-top: 0; color: #c53030;">Issues Found:</h3>
                ${errorList}
            </div>
            
            <div style="background: #edf2f7; padding: 20px; border-radius: 6px; margin: 20px 0;">
                <h3 style="margin-top: 0;">📋 What You Need To Do:</h3>
                <ol>
                    <li><strong>Download the official template:</strong>
                        <ul>
                            <li>Food Menu: RSH_DESIGN BRIEF_FOOD_Menu_Template.docx</li>
                            <li>Beverage Menu: RSH Design Brief Beverage Template.docx</li>
                        </ul>
                    </li>
                    <li><strong>Fill out ALL required fields</strong> in the template form (page 1)</li>
                    <li><strong>Add your menu content</strong> after "Please drop the menu content below on page 2"</li>
                    <li><strong>Resubmit</strong> your completed menu</li>
                </ol>
            </div>
            
            <p><strong>Important:</strong> Do not create your own template. Use the official template exactly as provided.</p>
            <p>Thank you,<br>RSH Menu Review System</p>
        </div>
    </div>
</body>
</html>`;
}
function buildPrecheckFailureEmail(filename, errorData) {
    const feedback = (errorData.feedback_preview || errorData.feedback || '').substring(0, 1500);
    return `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background: #ed8936; color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">⚠️ Pre-Check Failed</h1>
        </div>
        <div style="background: #fffaf0; padding: 30px;">
            <p>Hello,</p>
            <p>Your menu submission <strong>"${filename}"</strong> has <strong>${errorData.error_count} issues</strong> that need to be corrected.</p>
            
            <div style="background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ed8936;">
                <h3 style="margin-top: 0; color: #c05621;">Why was my submission rejected?</h3>
                <p>Our pre-check found too many errors (${errorData.error_count} issues). This indicates the menu wasn't cleaned using the required SOP QA prompt before submission.</p>
                <p><strong>All menus must be run through the QA prompt BEFORE submission.</strong></p>
            </div>
            
            <div style="background: #f7fafc; padding: 15px; border-radius: 6px; margin: 15px 0; font-family: monospace; font-size: 13px; max-height: 300px; overflow-y: auto; white-space: pre-wrap;">${feedback}</div>
            
            <div style="background: #e6fffa; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #38b2ac;">
                <h3 style="margin-top: 0;">✅ Next Steps:</h3>
                <ol>
                    <li><strong>Open ChatGPT</strong> (or your AI assistant)</li>
                    <li><strong>Copy the RSH Menu QA Prompt</strong> from guidelines</li>
                    <li><strong>Paste your menu content</strong> and let AI check it</li>
                    <li><strong>Fix all issues</strong> identified</li>
                    <li><strong>Run the prompt again</strong> to confirm fixes</li>
                    <li><strong>Resubmit your cleaned menu</strong></li>
                </ol>
            </div>
            
            <p>Thank you,<br>RSH Menu Review System</p>
        </div>
    </div>
</body>
</html>`;
}
function buildFormatFailureEmail(filename, errorData) {
    const reasons = errorData.reasons || [];
    const reasonList = reasons.map((r) => `<div style="margin: 10px 0; padding: 10px; background: #f7fafc; border-radius: 4px;">${r}</div>`).join('');
    return `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background: #ed8936; color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">⚠️ Formatting Issues</h1>
        </div>
        <div style="background: #fffaf0; padding: 30px;">
            <p>Hello,</p>
            <p>Your menu submission <strong>"${filename}"</strong> does not meet required formatting standards.</p>
            
            <div style="background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ed8936;">
                <h3 style="margin-top: 0; color: #c05621;">Formatting Issues Found:</h3>
                ${reasonList}
            </div>
            
            <div style="background: #e6fffa; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #38b2ac;">
                <h3 style="margin-top: 0;">📐 Required Format (Page 2 Content):</h3>
                <ul>
                    <li><strong>Font:</strong> Calibri</li>
                    <li><strong>Font Size:</strong> 12pt</li>
                    <li><strong>Alignment:</strong> Center aligned</li>
                </ul>
            </div>
            
            <p><strong>To Fix:</strong> Select all content on page 2, set to Calibri/12pt/centered, then resubmit.</p>
            <p>Thank you,<br>RSH Menu Review System</p>
        </div>
    </div>
</body>
</html>`;
}
function buildGenericErrorEmail(filename, errorMessage) {
    return `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background: #e53e3e; color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">❌ Submission Error</h1>
        </div>
        <div style="background: #fff5f5; padding: 30px;">
            <p>Hello,</p>
            <p>Your menu submission <strong>"${filename}"</strong> could not be processed.</p>
            <p><strong>Error:</strong> ${errorMessage}</p>
            <p>Please review and resubmit. Contact the design team if issues persist.</p>
            <p>Thank you,<br>RSH Menu Review System</p>
        </div>
    </div>
</body>
</html>`;
}

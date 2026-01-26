# Quick Start Guide

## 🚀 Getting Started in 5 Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your Azure credentials, OpenAI key, and SMTP settings
```

See [SETUP.md](./SETUP.md) for detailed Azure configuration.

### 3. Set Up ngrok (for local testing)
```bash
# In a separate terminal
ngrok http 3000

# Copy the https URL (e.g., https://abc123.ngrok.io)
# Update WEBHOOK_URL in .env with: https://abc123.ngrok.io/webhook
```

### 4. Build and Start Services
```bash
# Build all services
npm run build --workspaces

# Start all services at once
./start-services.sh

# OR start individually in separate terminals:
npm start --workspace=@menumanager/db
npm start --workspace=@menumanager/parser
npm start --workspace=@menumanager/ai-review
npm start --workspace=@menumanager/notifier
npm start --workspace=@menumanager/inbound-email
```

### 5. Verify Setup
```bash
./verify-setup.sh
```

## 📧 How It Works

1. **Email arrives** at `designapproval@richardsandoval.com`
2. **Webhook triggered** → Microsoft Graph notifies your service
3. **File downloaded** → .docx attachment extracted
4. **Template validated** → Parser checks structure
5. **AI review** → Two-tier analysis:
   - Tier 1: General QA (if fails → notify submitter)
   - Tier 2: Red-line draft generation
6. **Human review** → Internal reviewer gets notification
7. **Final approval** → Chef receives reviewed document

## 🎯 Testing the Flow

### ✅ RECOMMENDED: Folder-Based Processing
This is the safest approach to avoid processing correction emails or creating loops.

1. Set `GRAPH_FOLDER_NAME=Menu Submissions` in `.env`
2. Create folder in Outlook named "Menu Submissions"
3. When email arrives with .docx, **manually move it** to that folder
4. System processes automatically
5. **Benefits**: 
   - You control what gets processed
   - Won't process correction emails
   - No risk of infinite loops

### ⚠️ Alternative: Auto-Processing Entire Inbox (Not Recommended)
1. Leave `GRAPH_FOLDER_NAME` empty in `.env`
2. System monitors ALL emails in inbox
3. Relies on automated safety checks
4. **Risks**: Less control, though we have multiple safety layers including template validation

**See [WORKFLOW-GUIDE.md](./WORKFLOW-GUIDE.md) for detailed explanation.**

## 📝 Useful Commands

```bash
# Verify setup
./verify-setup.sh

# Start all services
./start-services.sh

# Stop all services
./stop-services.sh

# View logs
./view-logs.sh all                  # All logs
./view-logs.sh inbound-email        # Specific service

# Rebuild after code changes
npm run build --workspaces

# Run tests
npm test
```

## 🔧 Key Environment Variables

```bash
# Azure (required)
GRAPH_CLIENT_ID=...
GRAPH_CLIENT_SECRET=...
GRAPH_TENANT_ID=...
GRAPH_MAILBOX_ADDRESS=designapproval@richardsandoval.com

# Webhook (required)
WEBHOOK_URL=https://your-ngrok-url.ngrok.io/webhook

# OpenAI (required)
OPENAI_API_KEY=sk-...

# SMTP (required)
SMTP_HOST=smtp.gmail.com
SMTP_USER=...
SMTP_PASS=...

# Optional
GRAPH_FOLDER_NAME=Menu Submissions
APPROVED_SENDER_DOMAINS=richardsandoval.com
INTERNAL_REVIEWER_EMAIL=reviewer@richardsandoval.com
```

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Webhook not receiving notifications | Check ngrok is running, WEBHOOK_URL matches ngrok URL |
| Subscription creation fails | Verify Azure credentials and API permissions granted |
| No emails processed | Check sender domain in APPROVED_SENDER_DOMAINS |
| Template validation fails | Ensure .docx has proper structure/headings |
| AI review errors | Verify OPENAI_API_KEY is valid and has credits |

## 📚 More Information

- [SETUP.md](./SETUP.md) - Detailed Azure setup
- [README.md](./README.md) - Full project documentation
- [services/*/](./services/) - Individual service details

## 🆘 Need Help?

1. Run `./verify-setup.sh` to check configuration
2. Check logs: `./view-logs.sh all`
3. Review [SETUP.md](./SETUP.md) for detailed instructions
4. Ensure all Azure permissions are granted

## 🔄 Subscription Renewal

⚠️ Webhook subscriptions expire after 1 hour (for testing).

To renew:
```bash
# Stop and restart inbound-email service
./stop-services.sh
./start-services.sh
```

For production, implement automatic renewal logic.


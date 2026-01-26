# Setup Guide - Email Integration

This guide will walk you through setting up the email monitoring system from scratch.

## Prerequisites

- Node.js v18+ and npm
- Microsoft 365 account with access to Azure Portal
- ngrok installed (for local testing): `brew install ngrok` or download from https://ngrok.com
- OpenAI API key

## Step 1: Azure App Registration

1. **Go to Azure Portal**: https://portal.azure.com
2. **Navigate to**: Azure Active Directory → App registrations → New registration
3. **Configure the registration**:
   - Name: `MenuManager Email Monitor`
   - Supported account types: `Accounts in this organizational directory only`
   - Redirect URI: Leave blank
   - Click **Register**

4. **Copy credentials** (you'll need these for `.env`):
   - Go to **Overview** page
   - Copy: `Application (client) ID` → This is your `GRAPH_CLIENT_ID`
   - Copy: `Directory (tenant) ID` → This is your `GRAPH_TENANT_ID`

5. **Create a client secret**:
   - Go to **Certificates & secrets** → Client secrets → New client secret
   - Description: `MenuManager Secret`
   - Expires: Choose your preference (e.g., 24 months)
   - Click **Add**
   - **IMPORTANT**: Copy the secret VALUE immediately → This is your `GRAPH_CLIENT_SECRET`
   - You won't be able to see it again!

6. **Add API permissions**:
   - Go to **API permissions** → Add a permission → Microsoft Graph → Application permissions
   - Add these permissions:
     - `Mail.Read` - Read mail in all mailboxes
     - `Mail.ReadWrite` - Read and write mail in all mailboxes (if you want to mark as read/move emails)
   - Click **Add permissions**
   - Click **Grant admin consent** (requires admin rights)

## Step 2: Configure Environment Variables

1. **Copy the example file**:
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` and fill in your values**:
   ```bash
   # From Azure App Registration
   GRAPH_CLIENT_ID=your_application_id_here
   GRAPH_CLIENT_SECRET=your_secret_value_here
   GRAPH_TENANT_ID=your_tenant_id_here
   GRAPH_MAILBOX_ADDRESS=designapproval@richardsandoval.com
   
   # We'll set this up in Step 3
   WEBHOOK_URL=https://your-ngrok-url.ngrok.io/webhook
   
   # Optional: specific folder to monitor
   GRAPH_FOLDER_NAME=Menu Submissions
   
   # SMTP for sending emails (example with Gmail)
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=your_app_password
   
   # Internal reviewer email
   INTERNAL_REVIEWER_EMAIL=reviewer@richardsandoval.com
   
   # Approved sender domains
   APPROVED_SENDER_DOMAINS=richardsandoval.com
   
   # OpenAI
   OPENAI_API_KEY=sk-your_key_here
   
   # Paths
   SOP_DOC_PATH=samples/sop.txt
   ```

## Step 3: Set Up ngrok (for local testing)

1. **Start ngrok** in a separate terminal:
   ```bash
   ngrok http 3000
   ```

2. **Copy the forwarding URL**:
   - Look for the line: `Forwarding https://xxxx-xx-xx-xx-xx.ngrok.io -> http://localhost:3000`
   - Copy the `https://xxxx-xx-xx-xx-xx.ngrok.io` URL

3. **Update your `.env` file**:
   ```bash
   WEBHOOK_URL=https://xxxx-xx-xx-xx-xx.ngrok.io/webhook
   ```

**Note**: Each time you restart ngrok, you'll get a new URL and need to update `.env` and restart the service. Consider ngrok's paid plan for a static domain.

## Step 4: Install Dependencies

```bash
cd /Users/deriancowser/Documents/MenuManager
npm install
```

This will install all dependencies for the monorepo and all services.

## Step 5: Build the Services

```bash
npm run build --workspaces
```

This compiles all TypeScript services.

## Step 6: Start the Services

Open **5 separate terminal windows/tabs** and run each service:

### Terminal 1 - Database Service
```bash
cd /Users/deriancowser/Documents/MenuManager
npm start --workspace=@menumanager/db
```

### Terminal 2 - Parser Service
```bash
cd /Users/deriancowser/Documents/MenuManager
npm start --workspace=@menumanager/parser
```

### Terminal 3 - AI Review Service
```bash
cd /Users/deriancowser/Documents/MenuManager
npm start --workspace=@menumanager/ai-review
```

### Terminal 4 - Notifier Service
```bash
cd /Users/deriancowser/Documents/MenuManager
npm start --workspace=@menumanager/notifier
```

### Terminal 5 - Inbound Email Service
```bash
cd /Users/deriancowser/Documents/MenuManager
npm start --workspace=@menumanager/inbound-email
```

Watch for:
- ✅ `Subscription created successfully` - Good! Webhook is working
- ⚠️  `WEBHOOK_URL not configured` - Update your `.env` with ngrok URL
- ❌ Error messages - Check Azure permissions or credentials

## Step 7: Test the System

### Option A: Monitor Specific Folder
1. In Outlook, create a folder called "Menu Submissions" (or whatever you set in `GRAPH_FOLDER_NAME`)
2. Have someone email a .docx file to `designapproval@richardsandoval.com`
3. Move the email into the "Menu Submissions" folder
4. Watch the logs in the inbound-email terminal

### Option B: Monitor Entire Inbox
1. Leave `GRAPH_FOLDER_NAME` empty in `.env`
2. Have someone email a .docx file with "Menu" or "Design Brief" in the subject
3. Watch the logs automatically process it

### What Should Happen:
1. Email arrives → webhook notification received
2. File downloaded and sent to parser
3. Parser validates template structure
4. AI performs Tier 1 review
5. Either:
   - **Rejected**: Submitter gets feedback email
   - **Approved**: Internal reviewer gets notification email

## Troubleshooting

### Webhook Validation Fails
- Ensure ngrok is running
- Check that `WEBHOOK_URL` in `.env` matches your ngrok URL exactly
- Azure sends a validation request on subscription creation - the webhook must respond with the validation token

### No Emails Being Processed
- Check that sender domain is in `APPROVED_SENDER_DOMAINS`
- Check that subject contains "Menu" or "Design Brief"
- Check that email has a .docx attachment
- Verify folder name matches exactly (case-insensitive)

### Authentication Errors
- Verify all Azure credentials are correct in `.env`
- Check that admin consent was granted in Azure Portal
- Ensure Mail.Read permissions are active

### Subscription Expires
- Subscriptions expire after 1 hour (for testing)
- Restart the inbound-email service to create a new subscription
- In production, implement subscription renewal logic

## Production Deployment

For production, you'll need to:

1. **Deploy to a server** with a static public URL (no ngrok)
2. **Update `WEBHOOK_URL`** to your production URL
3. **Implement subscription renewal**:
   - Subscriptions expire and need renewal
   - Add a cron job or background task to renew before expiration
4. **Set up proper logging** and monitoring
5. **Use a real database** instead of JSON files
6. **Secure your endpoints** with authentication
7. **Handle errors gracefully** with retries and alerts

## Next Steps

Once the basic email flow is working:
- Build the **Dashboard** for human review
- Implement the **Differ** service for learning/improvement
- Add production-grade error handling
- Set up proper cloud storage for files
- Implement database migrations


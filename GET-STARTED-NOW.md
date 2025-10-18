# Get Started Now - Step-by-Step Guide

## Your Action Plan

Follow these steps in order to get MenuManager running and connected to your email account.

---

## Phase 1: Azure Setup (15-20 minutes)

### Step 1: Create Azure App Registration

1. Go to https://portal.azure.com
2. Navigate to: **Azure Active Directory** → **App registrations** → **New registration**
3. Fill in:
   - Name: `MenuManager Email Monitor`
   - Supported account types: `Accounts in this organizational directory only`
   - Redirect URI: Leave blank
4. Click **Register**

### Step 2: Copy Your Credentials

After registration, you'll see the Overview page:

1. **Copy Application (client) ID**
   - This is your `GRAPH_CLIENT_ID`
   - Save it somewhere temporarily

2. **Copy Directory (tenant) ID**
   - This is your `GRAPH_TENANT_ID`
   - Save it somewhere temporarily

### Step 3: Create Client Secret

1. In your app, go to: **Certificates & secrets** → **Client secrets** → **New client secret**
2. Description: `MenuManager Secret`
3. Expires: Choose duration (12 or 24 months recommended)
4. Click **Add**
5. **IMMEDIATELY copy the VALUE** (not the Secret ID)
   - This is your `GRAPH_CLIENT_SECRET`
   - You won't be able to see it again!
   - Save it somewhere temporarily

### Step 4: Add API Permissions

1. Go to: **API permissions** → **Add a permission**
2. Choose: **Microsoft Graph** → **Application permissions**
3. Add these permissions:
   - Search for `Mail.Read` and check it
   - Search for `Mail.ReadWrite` and check it (optional, for marking as read)
4. Click **Add permissions**
5. Click **Grant admin consent for [your organization]**
   - You need admin rights for this
   - Wait for the green checkmarks

✅ **Azure setup complete!** Save those three values for the next step.

---

## Phase 2: Local Environment Setup (10 minutes)

### Step 5: Create .env File

```bash
cd /Users/deriancowser/Documents/MenuManager
cp .env.example .env
```

### Step 6: Edit .env File

Open `.env` in your text editor and fill in:

```bash
# Azure credentials from Step 2-3
GRAPH_CLIENT_ID=paste_your_client_id_here
GRAPH_CLIENT_SECRET=paste_your_secret_here
GRAPH_TENANT_ID=paste_your_tenant_id_here
GRAPH_MAILBOX_ADDRESS=designapproval@richardsandoval.com

# Leave this empty for now, we'll fill it in Step 9
WEBHOOK_URL=

# Folder to monitor (RECOMMENDED)
GRAPH_FOLDER_NAME=Menu Submissions

# SMTP settings for sending emails
# Example with Gmail (or use your company SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password_here

# Who gets internal review notifications
INTERNAL_REVIEWER_EMAIL=reviewer@richardsandoval.com

# Only process emails from these domains
APPROVED_SENDER_DOMAINS=richardsandoval.com

# Your OpenAI API key
OPENAI_API_KEY=sk-your_key_here

# Path to SOP document
SOP_DOC_PATH=samples/sop.txt
```

**Important**: Make sure to fill in all the required values!

### Step 7: Install Dependencies

```bash
npm install
```

This will install all dependencies for all services.

### Step 8: Build All Services

```bash
npm run build --workspaces
```

You should see successful builds for each service.

✅ **Environment setup complete!**

---

## Phase 3: Webhook Setup (5 minutes)

### Step 9: Install and Start ngrok

**If you don't have ngrok**:
```bash
# Mac
brew install ngrok

# Or download from https://ngrok.com
```

**Start ngrok**:
```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding https://abc123xyz.ngrok.io -> http://localhost:3000
```

### Step 10: Update .env with Webhook URL

1. Copy the `https://` URL from ngrok (e.g., `https://abc123xyz.ngrok.io`)
2. Open `.env` again
3. Update:
   ```bash
   WEBHOOK_URL=https://abc123xyz.ngrok.io/webhook
   ```
4. Save the file

**Important**: Keep the ngrok terminal window open! If you close it or restart ngrok, you'll get a new URL and need to update `.env` again.

✅ **Webhook setup complete!**

---

## Phase 4: Create Email Folder (2 minutes)

### Step 11: Create Folder in Outlook

1. Open Outlook (web or desktop)
2. Go to the mailbox: `designapproval@richardsandoval.com`
3. Right-click on **Inbox**
4. Select **New Folder**
5. Name it exactly: `Menu Submissions` (case doesn't matter, but spelling does)
6. Create the folder

✅ **Folder created!**

---

## Phase 5: Start the System (2 minutes)

### Step 12: Verify Setup

```bash
./verify-setup.sh
```

This will check if everything is configured correctly.

### Step 13: Start All Services

**Option A - All at Once (Recommended)**:
```bash
./start-services.sh
```

**Option B - Individual Terminals** (if you want to see each service):

Terminal 1:
```bash
npm start --workspace=@menumanager/db
```

Terminal 2:
```bash
npm start --workspace=@menumanager/parser
```

Terminal 3:
```bash
npm start --workspace=@menumanager/ai-review
```

Terminal 4:
```bash
npm start --workspace=@menumanager/notifier
```

Terminal 5:
```bash
npm start --workspace=@menumanager/inbound-email
```

### Step 14: Watch for Success Messages

In the inbound-email service logs, look for:

✅ `✅ Subscription created successfully: [subscription-id]`
✅ `Expires at: [timestamp]`

If you see these, **you're connected to the email!** 🎉

If you see:
❌ `⚠️ WEBHOOK_URL not configured`
→ Go back and check your `.env` file

❌ `Error creating subscription`
→ Check your Azure permissions and credentials

✅ **System is running!**

---

## Phase 6: Test the System (5 minutes)

### Step 15: Send a Test Email

**From a personal email** (or ask a colleague):

1. Create an email to: `designapproval@richardsandoval.com`
2. Subject: `Test Menu Submission`
3. Attach one of these templates:
   - `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx` (fill it out)
   - OR `samples/RSH Design Brief Beverage Template.docx` (fill it out)
4. Send it

### Step 16: Move Email to Folder

1. Wait for email to arrive in inbox
2. **Manually move/drag** the email to the "Menu Submissions" folder
3. Watch your terminal logs!

### Step 17: Watch the Logs

```bash
# In another terminal
./view-logs.sh all

# Or specific services:
./view-logs.sh inbound-email
./view-logs.sh parser
./view-logs.sh ai-review
```

**You should see**:
```
inbound-email: ✅ Processing new submission: Test Menu...
inbound-email: 📥 Downloading attachment...
inbound-email: 💾 Attachment saved...
inbound-email: 📤 File sent to parser successfully
parser: Validating template structure...
parser: Detected template type: FOOD (or BEVERAGE)
parser: ✓ Template validation passed
ai-review: Running Tier 1 QA review...
```

✅ **System is working!** If you see these logs, everything is functioning correctly.

---

## Phase 7: Monitor and Maintain

### View Logs Anytime

```bash
./view-logs.sh all          # All services
./view-logs.sh inbound-email # Email monitoring
./view-logs.sh parser        # Template validation
./view-logs.sh ai-review     # AI review process
```

### Stop Services

```bash
./stop-services.sh
```

### Restart Services

```bash
./stop-services.sh
./start-services.sh
```

### Important Notes

**ngrok URL Changes**:
- Each time you restart ngrok, you get a new URL
- You'll need to update `WEBHOOK_URL` in `.env`
- Then restart the inbound-email service
- For production, get a static ngrok domain or deploy to a server

**Subscription Expiration**:
- Webhook subscriptions expire after 1 hour (for testing)
- Restart inbound-email service to renew
- For production, implement auto-renewal

---

## Troubleshooting

### Issue: Subscription creation fails

**Check**:
1. Azure credentials correct in `.env`?
2. API permissions granted in Azure?
3. ngrok running and URL in `.env` correct?

**Fix**:
```bash
# Restart inbound-email service
./stop-services.sh
./start-services.sh
```

### Issue: Emails not being processed

**Check**:
1. Email moved to "Menu Submissions" folder?
2. Sender domain in `APPROVED_SENDER_DOMAINS`?
3. Attachment is a .docx file?
4. Using correct RSH template?

**Debug**:
```bash
./view-logs.sh inbound-email
# Look for "skipping" messages
```

### Issue: Template validation fails

**Check**:
1. Using one of the official templates?
   - `samples/RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
   - `samples/RSH Design Brief Beverage Template.docx`
2. Template has all required sections?

**Debug**:
```bash
./view-logs.sh parser
# Will show specific validation errors
```

### Issue: AI review not running

**Check**:
1. `OPENAI_API_KEY` correct in `.env`?
2. OpenAI account has credits?
3. Template validation passed?

**Debug**:
```bash
./view-logs.sh ai-review
```

---

## Quick Reference

### Start System
```bash
./start-services.sh
```

### Stop System
```bash
./stop-services.sh
```

### View Logs
```bash
./view-logs.sh all
```

### Check Setup
```bash
./verify-setup.sh
```

### Restart After .env Changes
```bash
./stop-services.sh
# Edit .env
./start-services.sh
```

---

## What Happens Next?

Once the system is running:

1. **Emails arrive** at `designapproval@richardsandoval.com`
2. **You review** and move valid submissions to "Menu Submissions" folder
3. **System automatically**:
   - Downloads attachment
   - Validates template (FOOD or BEVERAGE)
   - Runs AI Tier 1 review
   - If passes: Generates red-lined draft
   - Notifies internal reviewer
4. **Human reviewer** (via future dashboard):
   - Reviews AI draft
   - Makes final edits
   - Approves
5. **System sends** final document to chef

---

## Production Checklist (Future)

When ready for production deployment:

- [ ] Deploy to a server (not localhost)
- [ ] Get static webhook URL (not ngrok)
- [ ] Implement subscription auto-renewal
- [ ] Set up proper logging/monitoring
- [ ] Use real database (not JSON files)
- [ ] Build the dashboard for reviewers
- [ ] Implement the differ service
- [ ] Set up backup/disaster recovery
- [ ] Configure email templates
- [ ] Train team on workflow

---

## Support Documentation

- **Quick Start**: `QUICK-START.md`
- **Detailed Setup**: `SETUP.md`
- **Workflow Guide**: `WORKFLOW-GUIDE.md`
- **Beverage Support**: `BEVERAGE-SUPPORT.md`
- **Safety Info**: `SAFETY-SOLUTION.md`
- **Updates**: `CHANGELOG.md`

---

## You're Ready! 🚀

Follow these steps in order, and you'll have a fully functional email monitoring and AI review system!

Questions? Check the troubleshooting section above or the documentation files.


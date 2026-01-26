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
# SharePoint property routing

How an approved menu reaches SharePoint, why most properties silently don't, and
how to configure one.

## The pipeline

`finalizeApprovedSubmission` (services/clickup-integration/index.ts) uploads the
approved DOCX to the property's SharePoint folder. It needs two independent
things, and **both** are per-property:

1. **Graph permission to the site.** The app registration (client id
   `347b024c-3b49-40bb-b59f-02c6023849cb`) holds the `Sites.Selected` role — it
   can only touch sites an admin has individually granted it. It cannot discover
   or self-grant sites.
2. **Routing config on the `properties` row** — `sharepoint_base_folder_path`
   plus either `sharepoint_drive_id`, or `sharepoint_site_url` +
   `sharepoint_library_name`.

Missing either one and the upload is skipped. Since Jul 2026 a skip for reason 2
raises a `sharepoint_property_unconfigured` alert (per property, so one property
does not mute another) instead of only writing a console line — before that, the
approval completed looking healthy and the DOCX simply never left the box.

## Current state (Jul 25 2026)

11 of 52 properties are configured. The other 41 — including all three Lona
locations (Nashville, Tampa, Fort Lauderdale) — have null `sharepoint_*` routing
and silently skip upload on every approval.

## Verifying access before configuring

```bash
node -e '
const fs=require("fs");const env={};
for(const l of fs.readFileSync(".env","utf8").split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
(async()=>{
  const body=new URLSearchParams({client_id:env.GRAPH_CLIENT_ID,client_secret:env.GRAPH_CLIENT_SECRET,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"});
  const tok=await(await fetch(`https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,{method:"POST",body})).json();
  const r=await fetch("https://graph.microsoft.com/v1.0/sites/richardsandoval.sharepoint.com:/sites/"+process.argv[1],{headers:{Authorization:`Bearer ${tok.access_token}`}});
  console.log(r.status, JSON.stringify(await r.json()).slice(0,200));
})();' Lona
```

Read the status code carefully — it tells you which of the two problems you have:

| Status | Meaning | Fix |
|--------|---------|-----|
| `200` | Site exists and the app is granted | Go straight to "Configure the property" |
| `403 accessDenied` | Site exists, app **not** granted | Needs the admin grant below |
| `404 itemNotFound` | Wrong slug — that site does not exist | Find the real URL in SharePoint |

`/sites/Lona` currently returns **403**: the site is real, the app just has no
grant on it. `Sites.Selected` also blocks reading a site's own permission list,
so this cannot be diagnosed or repaired from inside the app.

## Granting the app a new site (admin action)

**Who can do this:** Derian holds the SharePoint Administrator role (granted by
Verticomm, Jun 11 2026), so this is self-serve — no ticket needed. Verticomm's
standing request is to **keep the app at `Sites.Selected`** and ask them before
any app takes broader permissions.

**There is no UI for it.** Per-site grants to an Entra app are API-only:

- The site's own Permissions / "Share site" UI manages *user and group* access.
  It cannot grant an application.
- SharePoint admin center → "API access" approves *tenant-wide* Graph permission
  requests, which is the opposite of what we want here.
- The legacy `_layouts/15/appinv.aspx` page grants ACS app-only permissions, a
  retired model that does not apply to Entra apps using Graph.

So it's PnP PowerShell (needs the SharePoint Administrator role) or a Graph call
from an identity holding `Sites.FullControl.All`:

```powershell
Install-Module PnP.PowerShell -Scope CurrentUser        # first time only
Register-PnPEntraIDAppForInteractiveLogin `
  -ApplicationName "PnP PowerShell (Menu Manager admin)" `
  -Tenant richardsandoval.onmicrosoft.com -Interactive  # first time only

Connect-PnPOnline -Url "https://richardsandoval.sharepoint.com/sites/Lona" -Interactive
Grant-PnPAzureADAppSitePermission `
  -AppId "347b024c-3b49-40bb-b59f-02c6023849cb" `
  -DisplayName "Menu Manager" `
  -Site "https://richardsandoval.sharepoint.com/sites/Lona" `
  -Permissions Write
```

`Register-PnPEntraIDAppForInteractiveLogin` is required since Microsoft retired
the shared multi-tenant PnP app — PnP now needs its own registration in the
tenant. It is a one-time step and unrelated to the Menu Manager app registration.

The Graph equivalent (`POST /sites/{site-id}/permissions`) needs the *caller* to
hold `Sites.FullControl.All`, so it is an admin identity either way — never this
app, which cannot grant itself anything.

The broader alternative — adding the `Sites.ReadWrite.All` application role in
Entra with admin consent, after which the app reaches every site with no per-site
step — is what Verticomm has asked us not to do. It is also the weaker posture:
`Sites.Selected` is why a leaked key today reaches 11 sites instead of all of
them. Per-site grants are a few seconds each; keep them.

## Configure the property

Once the site returns `200`, find the library and folder path in SharePoint, then:

```bash
node scripts/sync-sharepoint-property.js \
  --property "Lona - Noelle - Nashville" \
  --site-url "https://richardsandoval.sharepoint.com/sites/Lona" \
  --library-name "Shared Documents" \
  --base-folder-path "<folder path inside the library>"
```

The script resolves and stores the drive id, so later uploads skip site lookup.

Existing conventions to match when picking the folder path:

- Single-location brands: site `OwnedOperated2-<Brand>`, folder
  `<Brand>/Brand & Marketing/Media Library/Menu Files`
  (Tamayo, Maya NYC, Aqimero, Venga Venga, tán).
- Multi-location brands: one site per brand, folder
  `<Brand> by Chef Richard Sandoval/Marketing - Locations/<City>/Menus`
  (Toro, Toro Toro).

Lona has three locations, so it most likely follows the multi-location shape —
but confirm against the actual site rather than assuming; the folder must exist.

`sharepoint_service_folders` (already populated for every property) selects a
subfolder by service period when one matches; otherwise the base folder is used.

## Verify

1. Re-run the access probe → `200`.
2. Approve a menu for that property (or re-run
   `scripts/backfill-sharepoint-approved.js` for historical ones).
3. Check the container log for `[sharepoint-upload] uploaded` and confirm no new
   `sharepoint_property_unconfigured` alert at `/alerts`.

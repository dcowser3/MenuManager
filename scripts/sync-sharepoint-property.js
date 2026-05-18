#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = 'true';
            continue;
        }
        parsed[key] = next;
        i += 1;
    }
    return parsed;
}

function usage() {
    console.error([
        'Usage:',
        '  node scripts/sync-sharepoint-property.js \\',
        '    --property "Tamayo - Denver" \\',
        '    --site-url "https://richardsandoval.sharepoint.com/sites/OwnedOperated2-Tamayo" \\',
        '    --library-name "Shared Documents" \\',
        '    --base-folder-path "Tamayo/Brand & Marketing/Media Library/Menu Files"',
        '',
        'Optional:',
        '  --db-service-url "http://localhost:3004"',
        '  --site-id "<selected-site-id>"',
        '  --drive-id "<existing-drive-id>"',
    ].join('\n'));
}

function normalizeSitePath(siteUrl) {
    const parsed = new URL(siteUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 2 && (segments[0] === 'sites' || segments[0] === 'teams')) {
        return {
            hostname: parsed.hostname,
            sitePath: `/${segments[0]}/${segments[1]}`,
        };
    }
    throw new Error(`Could not derive a SharePoint site path from ${siteUrl}`);
}

function encodeGraphPath(folderPath) {
    return folderPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

function normalizeSharePointLibraryName(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'shared documents' ? 'documents' : normalized;
}

function sharePointLibraryNameMatches(actual, expected) {
    return normalizeSharePointLibraryName(actual) === normalizeSharePointLibraryName(expected);
}

async function getGraphAccessToken() {
    const clientId = process.env.GRAPH_CLIENT_ID;
    const tenantId = process.env.GRAPH_TENANT_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET;

    if (!clientId || !tenantId || !clientSecret) {
        throw new Error('Missing GRAPH_CLIENT_ID, GRAPH_TENANT_ID, or GRAPH_CLIENT_SECRET in .env');
    }

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!response.ok) {
        throw new Error(`Failed to acquire Graph token: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    if (!data.access_token) {
        throw new Error('Graph token response did not include access_token');
    }
    return data.access_token;
}

async function graphRequest(token, graphPath) {
    const response = await fetch(`https://graph.microsoft.com/v1.0${graphPath}`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        throw new Error(`Graph request failed for ${graphPath}: ${response.status} ${await response.text()}`);
    }

    return response.json();
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const property = `${args.property || ''}`.trim();
    const siteUrl = `${args['site-url'] || ''}`.trim();
    const libraryName = `${args['library-name'] || ''}`.trim();
    const baseFolderPath = `${args['base-folder-path'] || ''}`.trim();
    const dbServiceUrl = `${args['db-service-url'] || process.env.DB_SERVICE_URL || 'http://localhost:3004'}`.trim();
    const existingSiteId = `${args['site-id'] || ''}`.trim();
    const existingDriveId = `${args['drive-id'] || ''}`.trim();

    if (!property || !siteUrl || !libraryName || !baseFolderPath) {
        usage();
        process.exit(1);
    }

    const token = await getGraphAccessToken();
    let site = existingSiteId ? { id: existingSiteId } : null;
    if (!site) {
        const { hostname, sitePath } = normalizeSitePath(siteUrl);
        site = await graphRequest(token, `/sites/${hostname}:${sitePath}`);
    }

    let driveId = existingDriveId;
    if (!driveId) {
        const drives = await graphRequest(token, `/sites/${site.id}/drives`);
        const drive = (drives.value || []).find((item) =>
            sharePointLibraryNameMatches(item?.name, libraryName)
        );

        if (!drive?.id) {
            throw new Error(`SharePoint library "${libraryName}" not found on site ${siteUrl}`);
        }
        driveId = drive.id;
    }

    const children = await graphRequest(
        token,
        `/drives/${driveId}/root:/${encodeGraphPath(baseFolderPath)}:/children`
    );

    const serviceFolders = (children.value || [])
        .filter((item) => !!item?.folder)
        .map((item) => `${item.name || ''}`.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

    const syncResponse = await fetch(
        `${dbServiceUrl.replace(/\/+$/, '')}/properties/${encodeURIComponent(property)}/sharepoint-config`,
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.INTERNAL_API_TOKEN
                    ? { 'x-menumanager-internal-token': process.env.INTERNAL_API_TOKEN }
                    : {}),
            },
            body: JSON.stringify({
                sharepoint_site_url: siteUrl,
                sharepoint_library_name: libraryName,
                sharepoint_drive_id: driveId,
                sharepoint_base_folder_path: baseFolderPath,
                sharepoint_service_folders: serviceFolders,
                sharepoint_last_synced_at: new Date().toISOString(),
            }),
        }
    );

    if (!syncResponse.ok) {
        throw new Error(`Failed to store property SharePoint config: ${syncResponse.status} ${await syncResponse.text()}`);
    }

    const syncResult = await syncResponse.json();
    console.log(JSON.stringify({
        success: true,
        property,
        siteId: site.id,
        driveId,
        baseFolderPath,
        serviceFolders,
        stored: syncResult.property || null,
    }, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

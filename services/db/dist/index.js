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
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const dotenv = require("dotenv");
const supabase_client_1 = require("@menumanager/supabase-client");
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const app = express();
const port = 3004;
const DB_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'db');
const SUBMISSIONS_DB = path.join(DB_DIR, 'submissions.json');
const REPORTS_DB = path.join(DB_DIR, 'reports.json');
const PROFILES_DB = path.join(DB_DIR, 'submitter_profiles.json');
const ASSETS_DB = path.join(DB_DIR, 'assets.json');
const PROPERTIES_DB = path.join(DB_DIR, 'properties.json');
const SUBMISSIONS_TABLE = 'submissions';
const SUBMITTER_PROFILES_TABLE = 'submitter_profiles';
const ASSETS_TABLE = 'assets';
const PROPERTIES_TABLE = 'properties';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PROPERTY_NAMES = [
    '89Agave - Sedona',
    'Agent\'s Only - Pasadena',
    'Anchor & Brine - Marriott Tampa Water Street - Tampa',
    'Aqimero - Ritz-Carlton - Philadelphia',
    'Bayou & Bottle - Four Seasons - Houston',
    'Beacon - Tampa',
    'Casa Chi - InterContinental - Chicago',
    'Cayao - Four Seasons Cabo Del Sol - Los Cabos',
    'Ciclo - Four Seasons - Austin',
    'Coraluz - Four Seasons Cabo Del Sol - Los Cabos',
    'D\'Taco Joint - Newark',
    'dLeña - Houston',
    'dLeña - Washington, D.C.',
    'Driftwood - Tampa',
    'DRINK Bar (Fareground) - Austin',
    'Ellis Bar (Fareground) - Austin',
    'Fareground - Austin',
    'Ironwood - Fairmont Scottsdale Princess - Scottsdale',
    'La Hacienda - Fairmont Scottsdale Princess - Scottsdale',
    'Live Oak - Four Seasons - Austin',
    'Lona - Westin - Fort Lauderdale',
    'Lona - Noelle - Nashville',
    'Lona - Marriott Tampa Water Street - Tampa',
    'Maya - Le Royal Meridien - Dubai',
    'Maya - New York',
    'Raya - Ritz-Carlton Laguna Niguel - Laguna Niguel',
    'Sidecut - Four Seasons - Whistler',
    'Sora - Four Seasons Cabo Del Sol - Los Cabos',
    'Spa at JW - Tampa',
    'Stoke & Rye - Westin Riverfront - Avon',
    'Taco Pegaso - Austin',
    'Tamayo - Denver',
    'tán - New York',
    'Toro - Belgrade',
    'Toro - Dania Beach',
    'Toro - Fairmont Millennium Park - Chicago',
    'Toro - Hotel Clio - Denver',
    'Toro - Six Senses Kocatas Mansions - Istanbul',
    'Toro - Los Cabos',
    'Toro - Marrakech',
    'Toro - St. Regis Kanai - Riviera Maya',
    'Toro - Fairmont Scottsdale Princess - Scottsdale',
    'Toro - Viceroy - Snowmass',
    'Toro Del Mar - Athens',
    'Toro Toro - Grosvenor House - Dubai',
    'Toro Toro - Worthington Renaissance - Fort Worth',
    'Toro Toro - Four Seasons - Houston',
    'Toro Toro - Malta',
    'Toro Toro - InterContinental - Miami',
    'Venga Venga - Snowmass',
    'Zengo - Kempinski - Doha',
    'Zengo - Le Royal Meridien - Dubai',
];
const DEFAULT_SHAREPOINT_PROPERTY_CONFIG = {
    'Aqimero - Ritz-Carlton - Philadelphia': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/OwnedOperated2-Aqimero',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Aqimero/Brand & Marketing/Media Library/Menu Files',
        sharepoint_service_folders: [
            'Beverage',
            'Breakfast',
            'Brunch',
            'Dessert',
            'Dining Room Beverage',
            'Dinner',
            'Holidays & Events',
            'Late Night',
            'Lunch',
            'Sunday Dinner',
            'Wine',
        ],
    },
    'Maya - New York': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/OwnedOperated2-Maya',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Maya NYC/Brand & Marketing/Media Library/Menu Files',
        sharepoint_service_folders: [
            'Bar & Lounge',
            'Brunch',
            'Dessert',
            'Dinner',
            'Happy Hour',
            'Holidays & Events',
            'Lunch',
            'Menu Board',
            'Restaurant Week',
            'Tequila',
        ],
    },
    'tán - New York': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/OwnedOperated2-Tn',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Tán/Brand & Marketing/Media Library/Menu Files',
        sharepoint_service_folders: [
            'Beverage',
            'Brunch',
            'Brunch Beverage',
            'Dessert',
            'Dinner',
            'Happy Hour',
            'Holidays & Events',
            'Kids',
            'Lunch',
            'Menu Box',
        ],
    },
    'Tamayo - Denver': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/OwnedOperated2-Tamayo',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Tamayo/Brand & Marketing/Media Library/Menu Files',
        sharepoint_service_folders: [
            'Afternoon Brunch',
            'Beverage',
            'Brunch',
            'Dessert',
            'Dinner',
            'Happy Hour',
            'Holidays & Events',
            'Kids',
            'Lunch',
            'Menu Box',
        ],
    },
    'Toro - Hotel Clio - Denver': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/Toro2',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Toro by Chef Richard Sandoval/Marketing - Locations/Denver/Menus',
        sharepoint_service_folders: [
            'Beverage',
            'Breakfast',
            'Brunch',
            'Dessert',
            'Dinner',
            'Happy Hour',
            'Holidays & Events',
            'Lunch',
        ],
    },
    'Toro - Fairmont Millennium Park - Chicago': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/Toro2',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Toro by Chef Richard Sandoval/Marketing - Locations/Chicago/Menus',
        sharepoint_service_folders: [
            'Beverage',
            'Bloody Bar',
            'Breakfast',
            'Brunch',
            'Dessert',
            'Dinner',
            'Happy Hour',
            'Holidays & Events',
            'Lunch',
        ],
    },
    'Toro - Dania Beach': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/Toro2',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Toro by Chef Richard Sandoval/Marketing - Locations/Dania Beach/Menus',
        sharepoint_service_folders: [
            'Dinner',
            'Happy Hour',
            'Holidays & Events',
        ],
    },
    'Toro - Viceroy - Snowmass': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/Toro2',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Toro by Chef Richard Sandoval/Marketing - Locations/Snowmass/Menus',
        sharepoint_service_folders: [
            'Large party_Pre-Fixe menu',
            'Winter Breakfast menu',
            'Winter Dessert Menu',
            'Winter Dinner Menu',
            'Winter Kids Breakfast menu',
            'Winter Kids Dinner Menu',
            'Winter Wine List',
        ],
    },
    'Toro Toro - Worthington Renaissance - Fort Worth': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/ToroToro',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Toro Toro by Chef Richard Sandoval/Marketing - Locations/Fort Worth/Menus',
        sharepoint_service_folders: [
            'Beverage',
            'Brunch',
            'Dinner',
            'Holidays & Events',
            'Lounge Bar',
            'Lunch',
        ],
    },
    'Toro Toro - InterContinental - Miami': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/ToroToro',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Toro Toro by Chef Richard Sandoval/Marketing - Locations/Miami/Menus',
        sharepoint_service_folders: [
            'Beverage',
            'Dessert',
            'Dinner',
            'Lunch',
        ],
    },
    'Venga Venga - Snowmass': {
        sharepoint_site_url: 'https://richardsandoval.sharepoint.com/sites/OwnedOperated2-VengaVenga',
        sharepoint_library_name: 'Shared Documents',
        sharepoint_base_folder_path: 'Venga Venga/Brand & Marketing/Media Library/Menu Files',
        sharepoint_service_folders: [
            'All Day',
            'Beverage',
            'Brunch',
            'Dessert',
            'Happy Hour',
            'Holidays & Events',
            'Kids',
            'Menu Box',
        ],
    },
};
function deriveCityCountryFromProperty(name) {
    const idx = name.lastIndexOf(' - ');
    if (idx < 0)
        return '';
    return name.slice(idx + 3).trim();
}
function buildDefaultPropertyCatalog() {
    return DEFAULT_PROPERTY_NAMES.map((name) => ({
        name,
        city_country: deriveCityCountryFromProperty(name),
        is_active: true,
        ...DEFAULT_SHAREPOINT_PROPERTY_CONFIG[name],
    }));
}
function normalizeServiceFolders(input) {
    if (!Array.isArray(input))
        return [];
    const seen = new Set();
    return input
        .map((value) => `${value || ''}`.trim())
        .filter(Boolean)
        .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function normalizePropertyCatalogRecord(input) {
    const name = `${input?.name || ''}`.trim();
    const defaults = DEFAULT_SHAREPOINT_PROPERTY_CONFIG[name] || {};
    return {
        name,
        city_country: `${input?.city_country || deriveCityCountryFromProperty(name) || ''}`.trim(),
        hotel: input?.hotel || undefined,
        is_active: input?.is_active !== false,
        sharepoint_site_url: `${input?.sharepoint_site_url || defaults.sharepoint_site_url || ''}`.trim() || undefined,
        sharepoint_library_name: `${input?.sharepoint_library_name || defaults.sharepoint_library_name || ''}`.trim() || undefined,
        sharepoint_drive_id: `${input?.sharepoint_drive_id || defaults.sharepoint_drive_id || ''}`.trim() || undefined,
        sharepoint_base_folder_path: `${input?.sharepoint_base_folder_path || defaults.sharepoint_base_folder_path || ''}`.trim() || undefined,
        sharepoint_service_folders: normalizeServiceFolders(input?.sharepoint_service_folders ?? defaults.sharepoint_service_folders),
        sharepoint_last_synced_at: `${input?.sharepoint_last_synced_at || defaults.sharepoint_last_synced_at || ''}`.trim() || undefined,
    };
}
async function writeLocalPropertyCatalog(records) {
    await fs_1.promises.writeFile(PROPERTIES_DB, JSON.stringify(records.map((item) => normalizePropertyCatalogRecord(item)), null, 2));
}
async function updateLocalPropertyCatalogEntry(propertyName, updates) {
    const catalog = await readLocalPropertyCatalog();
    const matchIndex = catalog.findIndex((item) => item.name.toLowerCase() === propertyName.trim().toLowerCase());
    if (matchIndex < 0)
        return null;
    const merged = normalizePropertyCatalogRecord({
        ...catalog[matchIndex],
        ...updates,
        name: catalog[matchIndex].name,
    });
    catalog[matchIndex] = merged;
    await writeLocalPropertyCatalog(catalog);
    return merged;
}
async function mirrorPropertyCatalogUpdateToSupabase(record) {
    if (!(0, supabase_client_1.isSupabaseConfigured)())
        return;
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const payload = {
        name: record.name,
        city_country: record.city_country,
        hotel: record.hotel || null,
        is_active: record.is_active !== false,
        sharepoint_site_url: record.sharepoint_site_url || null,
        sharepoint_library_name: record.sharepoint_library_name || null,
        sharepoint_drive_id: record.sharepoint_drive_id || null,
        sharepoint_base_folder_path: record.sharepoint_base_folder_path || null,
        sharepoint_service_folders: record.sharepoint_service_folders || [],
        sharepoint_last_synced_at: record.sharepoint_last_synced_at || null,
        updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
        .from(PROPERTIES_TABLE)
        .upsert(payload, { onConflict: 'name' });
    if (error) {
        throw new Error(`Supabase property upsert failed: ${error.message}`);
    }
}
const SUPABASE_SUBMISSION_COLUMNS = new Set([
    'id',
    'legacy_id',
    'project_name',
    'property',
    'width',
    'height',
    'crop_marks',
    'bleed_marks',
    'file_size_limit',
    'file_size_limit_mb',
    'file_delivery_notes',
    'orientation',
    'menu_type',
    'service_period',
    'template_type',
    'date_needed',
    'submitter_email',
    'submitter_name',
    'submitter_job_title',
    'hotel_name',
    'city_country',
    'asset_type',
    'menu_content',
    'menu_content_html',
    'approvals',
    'critical_overrides',
    'submission_mode',
    'revision_source',
    'revision_base_submission_id',
    'revision_baseline_doc_path',
    'revision_baseline_file_name',
    'base_approved_menu_content',
    'chef_persistent_diff',
    'approved_menu_content_raw',
    'approved_menu_content',
    'approved_text_extracted_at',
    'filename',
    'original_path',
    'ai_draft_path',
    'final_path',
    'clickup_task_id',
    'status',
    'changes_made',
    'source',
    'created_at',
    'updated_at',
    'reviewed_at',
    'raw_payload',
]);
function toSupabaseSubmissionRecord(payload) {
    const mapped = {};
    for (const [key, value] of Object.entries(payload || {})) {
        if (!SUPABASE_SUBMISSION_COLUMNS.has(key))
            continue;
        if (value === undefined)
            continue;
        mapped[key] = value;
    }
    const incomingId = (payload?.id || '').toString().trim();
    if (incomingId) {
        if (UUID_REGEX.test(incomingId)) {
            mapped.id = incomingId;
        }
        else {
            mapped.legacy_id = incomingId;
            delete mapped.id;
        }
    }
    // Preserve the complete submission payload for audit/debug parity.
    // This guarantees no field is lost even if schema evolves later.
    mapped.raw_payload = payload;
    return mapped;
}
async function mirrorSubmissionCreateToSupabase(localSubmission) {
    if (!(0, supabase_client_1.isSupabaseConfigured)())
        return;
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const record = toSupabaseSubmissionRecord(localSubmission);
    const legacyId = record.legacy_id;
    if (legacyId) {
        const { data: existing, error: lookupError } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('id')
            .eq('legacy_id', legacyId)
            .maybeSingle();
        if (lookupError) {
            throw new Error(`Supabase lookup failed: ${lookupError.message}`);
        }
        if (existing?.id) {
            const { error: updateError } = await supabase
                .from(SUBMISSIONS_TABLE)
                .update({ ...record, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
            if (updateError) {
                throw new Error(`Supabase update failed: ${updateError.message}`);
            }
            return;
        }
    }
    const { error } = await supabase.from(SUBMISSIONS_TABLE).insert(record);
    if (error) {
        throw new Error(`Supabase insert failed: ${error.message}`);
    }
}
async function mirrorSubmissionUpdateToSupabase(localId, updates) {
    if (!(0, supabase_client_1.isSupabaseConfigured)())
        return;
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const record = toSupabaseSubmissionRecord(updates);
    delete record.id;
    delete record.legacy_id;
    record.updated_at = new Date().toISOString();
    let matchId = localId;
    if (!UUID_REGEX.test(localId)) {
        const { data, error } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('id')
            .eq('legacy_id', localId)
            .maybeSingle();
        if (error) {
            throw new Error(`Supabase legacy lookup failed: ${error.message}`);
        }
        if (!data?.id) {
            // No Supabase row yet — self-heal by reading local JSON and creating it.
            try {
                const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
                const localRecord = submissions[localId];
                if (localRecord) {
                    const merged = { ...localRecord, ...updates, updated_at: new Date().toISOString() };
                    await mirrorSubmissionCreateToSupabase(merged);
                    console.log(`Supabase self-healed: created missing row for ${localId}`);
                }
                else {
                    console.warn(`Supabase mirror update skipped: no local record for ${localId}`);
                }
            }
            catch (healError) {
                console.error(`Supabase self-heal failed for ${localId}:`, healError.message);
                (0, supabase_client_1.logAlert)({
                    alert_type: 'supabase_mirror_failed',
                    severity: 'error',
                    service: 'db',
                    submission_id: localId,
                    message: `Supabase self-heal failed for submission ${localId}`,
                    details: { error: healError.message },
                });
            }
            return;
        }
        matchId = data.id;
    }
    const { error } = await supabase
        .from(SUBMISSIONS_TABLE)
        .update(record)
        .eq('id', matchId);
    if (error) {
        throw new Error(`Supabase update failed: ${error.message}`);
    }
}
async function getSubmissionRecordById(id) {
    const normalizedId = `${id || ''}`.trim();
    if (!normalizedId)
        return null;
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const idColumn = UUID_REGEX.test(normalizedId) ? 'id' : 'legacy_id';
        const { data, error } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('*')
            .eq(idColumn, normalizedId)
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to fetch submission from Supabase: ${error.message}`);
        }
        if (data) {
            return data;
        }
    }
    const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
    if (submissions[normalizedId]) {
        return submissions[normalizedId];
    }
    const match = Object.values(submissions).find((submission) => (submission?.id === normalizedId || submission?.legacy_id === normalizedId));
    return match || null;
}
async function readLocalPropertyCatalog() {
    try {
        const content = await fs_1.promises.readFile(PROPERTIES_DB, 'utf-8');
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed))
            return buildDefaultPropertyCatalog();
        return parsed
            .map((item) => normalizePropertyCatalogRecord(item))
            .filter((item) => !!item.name);
    }
    catch {
        return buildDefaultPropertyCatalog();
    }
}
async function getPropertyCatalog() {
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        try {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(PROPERTIES_TABLE)
                .select('name, city_country, hotel, is_active, sharepoint_site_url, sharepoint_library_name, sharepoint_drive_id, sharepoint_base_folder_path, sharepoint_service_folders, sharepoint_last_synced_at')
                .eq('is_active', true)
                .order('name', { ascending: true });
            if (!error && Array.isArray(data) && data.length > 0) {
                return data
                    .map((item) => normalizePropertyCatalogRecord(item))
                    .filter((item) => !!item.name);
            }
        }
        catch (error) {
            console.warn('Falling back to local property catalog:', error?.message || error);
        }
    }
    const local = await readLocalPropertyCatalog();
    return local
        .filter((item) => item.is_active !== false)
        .sort((a, b) => a.name.localeCompare(b.name));
}
// Ensure DB directory and files exist
async function initDb() {
    try {
        await fs_1.promises.mkdir(DB_DIR, { recursive: true });
        await fs_1.promises.access(SUBMISSIONS_DB).catch(() => fs_1.promises.writeFile(SUBMISSIONS_DB, '{}')); // Now an object
        await fs_1.promises.access(REPORTS_DB).catch(() => fs_1.promises.writeFile(REPORTS_DB, '[]'));
        await fs_1.promises.access(PROFILES_DB).catch(() => fs_1.promises.writeFile(PROFILES_DB, '{}'));
        await fs_1.promises.access(ASSETS_DB).catch(() => fs_1.promises.writeFile(ASSETS_DB, '[]'));
        await fs_1.promises.access(PROPERTIES_DB).catch(() => fs_1.promises.writeFile(PROPERTIES_DB, JSON.stringify(buildDefaultPropertyCatalog(), null, 2)));
    }
    catch (error) {
        console.error('Failed to initialize database:', error);
    }
}
app.use(express.json());
// Endpoint to create a new submission
app.post('/submissions', async (req, res) => {
    try {
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const newId = req.body.id || `sub_${Date.now()}`;
        const newSubmission = {
            ...req.body,
            id: newId,
            status: req.body.status || 'processing',
            created_at: req.body.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        submissions[newId] = newSubmission;
        await fs_1.promises.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        try {
            await mirrorSubmissionCreateToSupabase(newSubmission);
        }
        catch (supabaseError) {
            console.error(`Supabase mirror create failed for ${newId} (kept local JSON write):`, supabaseError.message);
            (0, supabase_client_1.logAlert)({
                alert_type: 'supabase_mirror_failed',
                severity: 'error',
                service: 'db',
                submission_id: newId,
                message: `Supabase mirror create failed for new submission ${newId}`,
                details: { error: supabaseError.message },
            });
        }
        res.status(201).json(newSubmission);
    }
    catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).send('Error saving submission.');
    }
});
// Endpoint to get all pending submissions (for dashboard)
// IMPORTANT: This must come BEFORE the /:id route
app.get('/submissions/pending', async (req, res) => {
    try {
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('status', 'pending_human_review')
                .order('created_at', { ascending: false });
            if (error) {
                throw new Error(error.message);
            }
            return res.status(200).json(data || []);
        }
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const pending = Object.values(submissions).filter((sub) => sub.status === 'pending_human_review');
        res.status(200).json(pending);
    }
    catch (error) {
        console.error('Error getting pending submissions:', error);
        res.status(500).send('Error getting pending submissions.');
    }
});
// Endpoint to get recent projects (grouped by project_name)
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/recent-projects', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        let allSubs = [];
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('source', 'form')
                .not('project_name', 'is', null)
                .order('created_at', { ascending: false })
                .limit(500);
            if (error) {
                throw new Error(error.message);
            }
            allSubs = data || [];
        }
        else {
            const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
            allSubs = Object.values(submissions);
        }
        // Filter to form submissions only
        const formSubs = allSubs.filter(s => s.source === 'form' && s.project_name);
        // Group by project_name (case-insensitive), keep most recent
        const projectMap = {};
        formSubs.forEach(s => {
            const key = (s.project_name || '').toLowerCase().trim();
            if (!key)
                return;
            if (!projectMap[key] || new Date(s.created_at) > new Date(projectMap[key].created_at)) {
                projectMap[key] = s;
            }
        });
        // Sort by most recent, return top N
        const projects = Object.values(projectMap)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit)
            .map((s) => ({
            projectName: s.project_name,
            property: s.property || '',
            width: s.width || '',
            height: s.height || '',
            printWidth: s.print_width || s.raw_payload?.printWidth || '',
            printHeight: s.print_height || s.raw_payload?.printHeight || '',
            printRegion: s.print_region || s.raw_payload?.printRegion || '',
            printSize: s.print_size || s.raw_payload?.printSize || '',
            folded: s.folded || s.raw_payload?.folded || '',
            digitalWidth: s.digital_width || s.raw_payload?.digitalWidth || '',
            digitalHeight: s.digital_height || s.raw_payload?.digitalHeight || '',
            cropMarks: s.crop_marks || '',
            bleedMarks: s.bleed_marks || '',
            fileSizeLimit: s.file_size_limit || '',
            fileSizeLimitMb: s.file_size_limit_mb || '',
            fileDeliveryNotes: s.file_delivery_notes || '',
            orientation: s.orientation || '',
            menuType: s.menu_type || 'standard',
            servicePeriod: s.service_period || s.raw_payload?.servicePeriod || '',
            templateType: s.template_type || 'food',
            hotelName: s.hotel_name || '',
            cityCountry: s.city_country || '',
            assetType: s.asset_type || '',
            turnaroundDays: s.turnaround_days || s.raw_payload?.turnaroundDays || '',
        }));
        res.json(projects);
    }
    catch (error) {
        console.error('Error getting recent projects:', error);
        res.status(500).json([]);
    }
});
// Search approved submissions for "modification" flow.
// Query can match project/property/submitter and returns newest first.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
        if (q.length < 2) {
            return res.json([]);
        }
        let sourceRows = [];
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const like = `%${q}%`;
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('status', 'approved')
                .or(`project_name.ilike.${like},property.ilike.${like},submitter_name.ilike.${like},submitter_email.ilike.${like},hotel_name.ilike.${like},city_country.ilike.${like}`)
                .order('updated_at', { ascending: false })
                .limit(limit);
            if (error) {
                throw new Error(error.message);
            }
            sourceRows = data || [];
        }
        else {
            const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
            const approvedStatuses = new Set(['approved']);
            sourceRows = Object.values(submissions)
                .filter((s) => approvedStatuses.has((s.status || '').toLowerCase()))
                .filter((s) => {
                const haystack = [
                    s.project_name,
                    s.property,
                    s.submitter_name,
                    s.submitter_email,
                    s.hotel_name,
                    s.city_country,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(q);
            })
                .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
                .slice(0, limit);
        }
        const results = sourceRows.map((s) => ({
            id: s.legacy_id || s.id,
            projectName: s.project_name || '',
            property: s.property || '',
            width: s.width || '',
            height: s.height || '',
            printWidth: s.print_width || s.raw_payload?.printWidth || '',
            printHeight: s.print_height || s.raw_payload?.printHeight || '',
            printRegion: s.print_region || s.raw_payload?.printRegion || '',
            printSize: s.print_size || s.raw_payload?.printSize || '',
            folded: s.folded || s.raw_payload?.folded || '',
            digitalWidth: s.digital_width || s.raw_payload?.digitalWidth || '',
            digitalHeight: s.digital_height || s.raw_payload?.digitalHeight || '',
            cropMarks: s.crop_marks || '',
            bleedMarks: s.bleed_marks || '',
            fileSizeLimit: s.file_size_limit || '',
            fileSizeLimitMb: s.file_size_limit_mb || '',
            fileDeliveryNotes: s.file_delivery_notes || '',
            orientation: s.orientation || '',
            menuType: s.menu_type || 'standard',
            servicePeriod: s.service_period || s.raw_payload?.servicePeriod || '',
            templateType: s.template_type || 'food',
            hotelName: s.hotel_name || '',
            cityCountry: s.city_country || '',
            assetType: s.asset_type || '',
            submitterName: s.submitter_name || '',
            submitterEmail: s.submitter_email || '',
            dateNeeded: s.date_needed || '',
            turnaroundDays: s.turnaround_days || s.raw_payload?.turnaroundDays || '',
            updatedAt: s.updated_at || s.created_at,
            approvedMenuContent: s.approved_menu_content || s.menu_content || '',
            allergens: s.allergens || '',
            status: s.status,
        }));
        res.json(results);
    }
    catch (error) {
        console.error('Error searching submissions:', error);
        res.status(500).json([]);
    }
});
// Canonical property list used by form + learning dashboard.
app.get('/properties', async (_req, res) => {
    try {
        const catalog = await getPropertyCatalog();
        res.json({
            properties: catalog.map((item) => item.name),
            catalog,
        });
    }
    catch (error) {
        console.error('Error fetching property catalog:', error);
        res.status(500).json({ properties: [], catalog: [] });
    }
});
app.get('/properties/validate', async (req, res) => {
    try {
        const name = `${req.query.name || ''}`.trim();
        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }
        const catalog = await getPropertyCatalog();
        const match = catalog.find((item) => item.name.toLowerCase() === name.toLowerCase());
        if (!match) {
            return res.json({ valid: false });
        }
        res.json({ valid: true, property: match });
    }
    catch (error) {
        console.error('Error validating property:', error);
        res.status(500).json({ valid: false });
    }
});
app.put('/properties/:name/sharepoint-config', async (req, res) => {
    try {
        const propertyName = `${req.params.name || ''}`.trim();
        if (!propertyName) {
            return res.status(400).json({ error: 'property name is required' });
        }
        const normalizedUpdates = {
            sharepoint_site_url: `${req.body?.sharepoint_site_url || req.body?.siteUrl || ''}`.trim() || undefined,
            sharepoint_library_name: `${req.body?.sharepoint_library_name || req.body?.libraryName || ''}`.trim() || undefined,
            sharepoint_drive_id: `${req.body?.sharepoint_drive_id || req.body?.driveId || ''}`.trim() || undefined,
            sharepoint_base_folder_path: `${req.body?.sharepoint_base_folder_path || req.body?.baseFolderPath || ''}`.trim() || undefined,
            sharepoint_service_folders: normalizeServiceFolders(req.body?.sharepoint_service_folders || req.body?.serviceFolders),
            sharepoint_last_synced_at: `${req.body?.sharepoint_last_synced_at || req.body?.lastSyncedAt || new Date().toISOString()}`.trim(),
        };
        const updated = await updateLocalPropertyCatalogEntry(propertyName, normalizedUpdates);
        if (!updated) {
            return res.status(404).json({ error: `property "${propertyName}" not found` });
        }
        try {
            await mirrorPropertyCatalogUpdateToSupabase(updated);
        }
        catch (supabaseError) {
            console.error(`Supabase property mirror failed for ${propertyName}:`, supabaseError.message);
            (0, supabase_client_1.logAlert)({
                alert_type: 'supabase_mirror_failed',
                severity: 'warning',
                service: 'db',
                message: `Supabase property mirror failed for ${propertyName}`,
                details: { error: supabaseError.message, property: propertyName },
            });
        }
        res.json({ success: true, property: updated });
    }
    catch (error) {
        console.error('Error saving property SharePoint config:', error);
        res.status(500).json({ error: 'Failed to save property SharePoint config' });
    }
});
// Backward-compatible alias.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/properties', async (_req, res) => {
    try {
        const catalog = await getPropertyCatalog();
        res.json({ properties: catalog.map((item) => item.name) });
    }
    catch (error) {
        console.error('Error fetching property names:', error);
        res.status(500).json({ properties: [] });
    }
});
// Latest approved submission for a project/property pair.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/latest-approved', async (req, res) => {
    try {
        const projectName = (req.query.projectName || '').trim().toLowerCase();
        const property = (req.query.property || '').trim().toLowerCase();
        if (!projectName || !property) {
            return res.status(400).json({ error: 'projectName and property are required' });
        }
        let match = null;
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('status', 'approved')
                .ilike('project_name', projectName)
                .ilike('property', property)
                .order('updated_at', { ascending: false })
                .limit(1);
            if (error) {
                throw new Error(error.message);
            }
            match = (data || [])[0] || null;
        }
        else {
            const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
            match = Object.values(submissions)
                .filter((s) => (s.status || '').toLowerCase() === 'approved')
                .filter((s) => (s.project_name || '').trim().toLowerCase() === projectName &&
                (s.property || '').trim().toLowerCase() === property)
                .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())[0];
        }
        if (!match) {
            return res.status(404).json({ error: 'No approved submission found' });
        }
        res.json(match);
    }
    catch (error) {
        console.error('Error finding latest approved submission:', error);
        res.status(500).json({ error: 'Failed to find approved submission' });
    }
});
// Submitter profile search
app.get('/submitter-profiles/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        if (q.length < 2) {
            return res.json([]);
        }
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const like = `%${q}%`;
            const { data, error } = await supabase
                .from(SUBMITTER_PROFILES_TABLE)
                .select('*')
                .ilike('name', like)
                .order('last_used', { ascending: false })
                .limit(8);
            if (!error && data) {
                return res.json(data.map((p) => ({
                    name: p.name || '',
                    email: p.email || '',
                    jobTitle: p.job_title || '',
                    lastUsed: p.last_used || p.updated_at || p.created_at,
                })));
            }
        }
        const profiles = JSON.parse(await fs_1.promises.readFile(PROFILES_DB, 'utf-8'));
        const matches = Object.values(profiles)
            .filter((p) => p.name.toLowerCase().includes(q))
            .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
            .slice(0, 8);
        res.json(matches);
    }
    catch (error) {
        console.error('Error searching submitter profiles:', error);
        res.json([]);
    }
});
// Submitter profile upsert
app.post('/submitter-profiles', async (req, res) => {
    try {
        const { name, email, jobTitle } = req.body;
        if (!name || !email) {
            return res.status(400).json({ error: 'name and email are required' });
        }
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const now = new Date().toISOString();
            const { error } = await supabase
                .from(SUBMITTER_PROFILES_TABLE)
                .upsert({
                name: name.trim(),
                email: email.trim(),
                job_title: (jobTitle || '').trim(),
                last_used: now,
                updated_at: now,
            }, { onConflict: 'email' });
            if (error) {
                console.error('Supabase submitter profile upsert failed, falling back local:', error.message);
            }
        }
        const key = name.toLowerCase().trim();
        const profiles = JSON.parse(await fs_1.promises.readFile(PROFILES_DB, 'utf-8'));
        const now = new Date().toISOString();
        profiles[key] = {
            name: name.trim(),
            email: email.trim(),
            jobTitle: (jobTitle || '').trim(),
            lastUsed: now,
        };
        await fs_1.promises.writeFile(PROFILES_DB, JSON.stringify(profiles, null, 2));
        res.json(profiles[key]);
    }
    catch (error) {
        console.error('Error saving submitter profile:', error);
        res.status(500).json({ error: 'Failed to save profile' });
    }
});
// Lookup submission by ClickUp task ID
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/by-clickup-task/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('clickup_task_id', taskId)
                .maybeSingle();
            if (!error && data) {
                return res.json(data);
            }
        }
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const match = Object.values(submissions).find((sub) => sub.clickup_task_id === taskId);
        if (!match) {
            return res.status(404).json({ error: 'No submission found for this ClickUp task' });
        }
        res.json(match);
    }
    catch (error) {
        console.error('Error looking up submission by ClickUp task:', error);
        res.status(500).send('Error looking up submission.');
    }
});
// Endpoint to get a single submission by ID
app.get('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const submission = await getSubmissionRecordById(id);
        if (!submission) {
            return res.status(404).send('Submission not found.');
        }
        res.status(200).json(submission);
    }
    catch (error) {
        console.error('Error getting submission:', error);
        res.status(500).send('Error getting submission.');
    }
});
app.post('/approved-dishes/extract', async (req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.status(503).json({ error: 'Supabase not configured for approved dish extraction' });
        }
        const submissionId = `${req.body?.submissionId || ''}`.trim();
        if (!submissionId) {
            return res.status(400).json({ error: 'submissionId is required' });
        }
        const submission = await getSubmissionRecordById(submissionId);
        const resolvedSubmissionId = `${submission?.id || submissionId}`.trim();
        if (!UUID_REGEX.test(resolvedSubmissionId)) {
            return res.status(400).json({ error: 'Resolved submission ID must be a Supabase UUID' });
        }
        const approvedMenuContent = `${req.body?.approvedMenuContent || submission?.approved_menu_content || submission?.menu_content || ''}`.trim();
        if (!approvedMenuContent) {
            return res.status(400).json({ error: 'No approved menu content available for extraction' });
        }
        const property = `${req.body?.property || submission?.property || ''}`.trim() || 'Unknown';
        const servicePeriod = `${req.body?.servicePeriod || submission?.service_period || submission?.raw_payload?.servicePeriod || ''}`.trim() || undefined;
        const result = await (0, supabase_client_1.extractAndStoreDishes)(approvedMenuContent, property, resolvedSubmissionId, {
            servicePeriod,
        });
        res.json({
            success: true,
            submissionId: resolvedSubmissionId,
            added: result.added,
        });
    }
    catch (error) {
        console.error('Error extracting approved dishes:', error.message);
        res.status(500).json({ error: 'Failed to extract approved dishes', details: error.message });
    }
});
app.post('/approved-dishes/backfill-approved', async (req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.status(503).json({ error: 'Supabase not configured for approved dish backfill' });
        }
        const limit = Math.min(Math.max(Number(req.body?.limit || 200), 1), 1000);
        const force = req.body?.force === true;
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data: submissions, error: submissionError } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('id, property, service_period, approved_menu_content, menu_content, raw_payload')
            .eq('status', 'approved')
            .order('updated_at', { ascending: false })
            .limit(limit);
        if (submissionError) {
            throw new Error(`Failed to load approved submissions: ${submissionError.message}`);
        }
        const summary = {
            scanned: 0,
            processed: 0,
            skipped_existing: 0,
            skipped_empty: 0,
            failed: 0,
            added: 0,
            details: [],
        };
        for (const submission of submissions || []) {
            summary.scanned += 1;
            try {
                if (!force) {
                    const { count, error: countError } = await supabase
                        .from('approved_dishes')
                        .select('id', { count: 'exact', head: true })
                        .eq('source_submission_id', submission.id);
                    if (countError) {
                        throw new Error(`Failed to count existing dishes: ${countError.message}`);
                    }
                    if ((count || 0) > 0) {
                        summary.skipped_existing += 1;
                        summary.details.push({
                            submission_id: submission.id,
                            status: 'skipped_existing',
                            reason: `${count} dishes already exist`,
                        });
                        continue;
                    }
                }
                const approvedMenuContent = `${submission.approved_menu_content || submission.menu_content || ''}`.trim();
                if (!approvedMenuContent) {
                    summary.skipped_empty += 1;
                    summary.details.push({
                        submission_id: submission.id,
                        status: 'skipped_empty',
                        reason: 'No approved menu content available',
                    });
                    continue;
                }
                const property = `${submission.property || ''}`.trim() || 'Unknown';
                const servicePeriod = `${submission.service_period || submission.raw_payload?.servicePeriod || ''}`.trim() || undefined;
                const result = await (0, supabase_client_1.extractAndStoreDishes)(approvedMenuContent, property, submission.id, {
                    servicePeriod,
                });
                summary.processed += 1;
                summary.added += result.added;
                summary.details.push({
                    submission_id: submission.id,
                    status: 'processed',
                    added: result.added,
                });
            }
            catch (error) {
                summary.failed += 1;
                summary.details.push({
                    submission_id: submission.id,
                    status: 'failed',
                    reason: error.message,
                });
            }
        }
        res.json({ success: true, ...summary });
    }
    catch (error) {
        console.error('Error backfilling approved dishes:', error.message);
        res.status(500).json({ error: 'Failed to backfill approved dishes', details: error.message });
    }
});
// Endpoint to update a submission's status and paths
app.put('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        let resolvedId = id;
        // When Supabase is enabled, callers may pass UUID `id`, but local JSON
        // uses legacy form IDs as keys. Resolve UUID -> local key if needed.
        if (!submissions[resolvedId]) {
            const match = Object.entries(submissions).find(([, value]) => {
                return value?.id === id || value?.legacy_id === id;
            });
            if (match) {
                resolvedId = match[0];
            }
        }
        if (!submissions[resolvedId]) {
            if ((0, supabase_client_1.isSupabaseConfigured)()) {
                // Allow UUID/legacy-id updates even when local JSON entry is missing.
                try {
                    await mirrorSubmissionUpdateToSupabase(id, req.body || {});
                    const supabase = (0, supabase_client_1.getSupabaseClient)();
                    const idColumn = UUID_REGEX.test(id) ? 'id' : 'legacy_id';
                    const { data } = await supabase
                        .from(SUBMISSIONS_TABLE)
                        .select('*')
                        .eq(idColumn, id)
                        .maybeSingle();
                    return res.status(200).json(data || { id, ...req.body, updated_at: new Date().toISOString() });
                }
                catch (supabaseError) {
                    console.error('Supabase-only submission update failed:', supabaseError.message);
                }
            }
            return res.status(404).send('Submission not found.');
        }
        const updatedSubmission = { ...submissions[resolvedId], ...req.body, updated_at: new Date().toISOString() };
        submissions[resolvedId] = updatedSubmission;
        await fs_1.promises.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        try {
            await mirrorSubmissionUpdateToSupabase(id, updatedSubmission);
        }
        catch (supabaseError) {
            console.error('Supabase mirror update failed (kept local JSON write):', supabaseError.message);
        }
        res.status(200).json(updatedSubmission);
    }
    catch (error) {
        console.error('Error updating submission:', error);
        res.status(500).send('Error updating submission.');
    }
});
// Asset metadata for storage abstraction (local now, Teams later)
app.post('/assets', async (req, res) => {
    try {
        const { submission_id, revision_submission_id, asset_type, source, storage_provider, storage_path, file_name, meta } = req.body;
        if (!submission_id || !asset_type || !storage_path) {
            return res.status(400).json({ error: 'submission_id, asset_type, and storage_path are required' });
        }
        const assets = JSON.parse(await fs_1.promises.readFile(ASSETS_DB, 'utf-8'));
        const newAsset = {
            id: `asset_${Date.now()}`,
            submission_id,
            revision_submission_id: revision_submission_id || null,
            asset_type,
            source: source || 'system',
            storage_provider: storage_provider || 'local',
            storage_path,
            file_name: file_name || null,
            meta: meta || null,
            created_at: new Date().toISOString(),
        };
        assets.push(newAsset);
        await fs_1.promises.writeFile(ASSETS_DB, JSON.stringify(assets, null, 2));
        // Fire-and-forget Supabase mirror
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            (async () => {
                try {
                    const supabase = (0, supabase_client_1.getSupabaseClient)();
                    const { id: _localId, ...supabaseRecord } = newAsset;
                    const { error: sbError } = await supabase.from(ASSETS_TABLE).insert(supabaseRecord);
                    if (sbError)
                        console.error(`Supabase asset mirror failed for ${newAsset.submission_id}:`, sbError.message);
                }
                catch (err) {
                    console.error(`Supabase asset mirror error for ${newAsset.submission_id}:`, err.message);
                }
            })();
        }
        res.status(201).json(newAsset);
    }
    catch (error) {
        console.error('Error saving asset metadata:', error);
        res.status(500).json({ error: 'Failed to save asset metadata' });
    }
});
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/assets/by-submission/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(ASSETS_TABLE)
                .select('*')
                .eq('submission_id', submissionId)
                .order('created_at', { ascending: false });
            if (!error && data && data.length > 0) {
                return res.json(data);
            }
        }
        // Fallback to local JSON
        const assets = JSON.parse(await fs_1.promises.readFile(ASSETS_DB, 'utf-8'));
        const matches = assets
            .filter((a) => a.submission_id === submissionId)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        res.json(matches);
    }
    catch (error) {
        console.error('Error getting submission assets:', error);
        res.status(500).json([]);
    }
});
// Document pairs for learning pipeline — original DOCX ↔ approved DOCX
app.get('/assets/document-pairs', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from('document_pairs')
                .select('*')
                .order('approved_at', { ascending: false })
                .limit(limit);
            if (!error && data) {
                return res.json(data);
            }
            if (error) {
                console.warn('Supabase document_pairs view query failed, falling back to local:', error.message);
            }
        }
        // Local fallback: join assets by submission_id
        const assets = JSON.parse(await fs_1.promises.readFile(ASSETS_DB, 'utf-8'));
        const bySubmission = new Map();
        for (const a of assets) {
            if (a.asset_type === 'original_docx' || a.asset_type === 'approved_docx') {
                if (!bySubmission.has(a.submission_id))
                    bySubmission.set(a.submission_id, {});
                const entry = bySubmission.get(a.submission_id);
                if (a.asset_type === 'original_docx')
                    entry.original = a;
                if (a.asset_type === 'approved_docx')
                    entry.approved = a;
            }
        }
        const pairs = Array.from(bySubmission.entries())
            .filter(([, v]) => v.original && v.approved)
            .map(([submissionId, v]) => ({
            submission_id: submissionId,
            original_path: v.original.storage_path,
            original_filename: v.original.file_name,
            approved_path: v.approved.storage_path,
            approved_filename: v.approved.file_name,
            submitted_at: v.original.created_at,
            approved_at: v.approved.created_at,
        }))
            .sort((a, b) => new Date(b.approved_at).getTime() - new Date(a.approved_at).getTime())
            .slice(0, limit);
        res.json(pairs);
    }
    catch (error) {
        console.error('Error getting document pairs:', error);
        res.status(500).json([]);
    }
});
// Endpoint to create a new report (can be deprecated or used for logging)
app.post('/reports', async (req, res) => {
    try {
        const { submission_id, report_json, ai_confidence } = req.body;
        const reports = JSON.parse(await fs_1.promises.readFile(REPORTS_DB, 'utf-8'));
        const newReport = {
            id: Date.now().toString(),
            submission_id,
            report_json,
            ai_confidence,
            created_at: new Date().toISOString()
        };
        reports.push(newReport);
        await fs_1.promises.writeFile(REPORTS_DB, JSON.stringify(reports, null, 2));
        res.status(201).json(newReport);
    }
    catch (error) {
        console.error('Error saving report:', error);
        res.status(500).send('Error saving report.');
    }
});
// ============================================================================
// Correction Rules (Learning Pipeline v2)
// ============================================================================
const CORRECTION_RULES_TABLE = 'correction_rules';
app.post('/correction-rules', async (req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.status(503).json({ error: 'Supabase not configured — correction_rules require Supabase' });
        }
        const record = req.body || {};
        if (!record.submission_id || !record.correction_id || !record.original_text || !record.corrected_text || !record.rule) {
            return res.status(400).json({ error: 'submission_id, correction_id, original_text, corrected_text, and rule are required' });
        }
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(CORRECTION_RULES_TABLE)
            .insert({
            submission_id: record.submission_id,
            correction_id: record.correction_id,
            original_text: record.original_text,
            corrected_text: record.corrected_text,
            change_type: record.change_type || null,
            rule: record.rule,
            is_location_specific: record.is_location_specific || false,
            project_name: record.project_name || null,
            restaurant_name: record.restaurant_name || '',
            location: record.location || 'All properties (global rule)',
            other_applicable_locations: record.other_applicable_locations || [],
            reviewer_name: record.reviewer_name || null,
            source: record.source || 'human',
            status: record.status || 'accepted',
            occurrences: record.occurrences || 1,
            confidence: record.confidence || null,
            submission_ids: record.submission_ids || null,
        })
            .select()
            .single();
        if (error) {
            throw new Error(error.message);
        }
        res.status(201).json(data);
    }
    catch (error) {
        console.error('Error creating correction rule:', error.message);
        res.status(500).json({ error: 'Failed to create correction rule' });
    }
});
app.get('/correction-rules', async (req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.json([]);
        }
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        let query = supabase
            .from(CORRECTION_RULES_TABLE)
            .select('*')
            .order('created_at', { ascending: false });
        if (req.query.submission_id) {
            query = query.eq('submission_id', req.query.submission_id);
        }
        if (req.query.status) {
            query = query.eq('status', req.query.status);
        }
        if (req.query.source) {
            query = query.eq('source', req.query.source);
        }
        const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
        query = query.limit(limit);
        const { data, error } = await query;
        if (error) {
            throw new Error(error.message);
        }
        res.json(data || []);
    }
    catch (error) {
        console.error('Error fetching correction rules:', error.message);
        res.status(500).json([]);
    }
});
// IMPORTANT: Must come BEFORE any /:id route in correction-rules
app.get('/correction-rules/pending', async (req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.json([]);
        }
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(CORRECTION_RULES_TABLE)
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) {
            throw new Error(error.message);
        }
        res.json(data || []);
    }
    catch (error) {
        console.error('Error fetching pending correction rules:', error.message);
        res.status(500).json([]);
    }
});
app.put('/correction-rules/:id', async (req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.status(503).json({ error: 'Supabase not configured' });
        }
        const { id } = req.params;
        const updates = req.body || {};
        // Only allow specific fields to be updated
        const allowedFields = {};
        const editable = ['status', 'rule', 'is_location_specific', 'other_applicable_locations',
            'change_type', 'restaurant_name', 'location', 'project_name', 'reviewer_name'];
        for (const key of editable) {
            if (updates[key] !== undefined) {
                allowedFields[key] = updates[key];
            }
        }
        if (Object.keys(allowedFields).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        allowedFields.updated_at = new Date().toISOString();
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(CORRECTION_RULES_TABLE)
            .update(allowedFields)
            .eq('id', id)
            .select()
            .single();
        if (error) {
            throw new Error(error.message);
        }
        res.json(data);
    }
    catch (error) {
        console.error('Error updating correction rule:', error.message);
        res.status(500).json({ error: 'Failed to update correction rule' });
    }
});
// ============================================================================
// Prompt Proposals (Learning Pipeline v2)
// ============================================================================
const PROMPT_PROPOSALS_TABLE = 'prompt_proposals';
app.get('/prompt-proposals/latest', async (_req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.json(null);
        }
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(PROMPT_PROPOSALS_TABLE)
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error)
            throw new Error(error.message);
        res.json(data || null);
    }
    catch (error) {
        console.error('Error fetching latest prompt proposal:', error.message);
        res.status(500).json(null);
    }
});
app.get('/prompt-proposals', async (_req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.json([]);
        }
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(PROMPT_PROPOSALS_TABLE)
            .select('id, cycle_id, status, correction_rule_count, submission_count, date_range_start, date_range_end, llm_model, reviewer_name, reviewed_at, created_at')
            .order('created_at', { ascending: false })
            .limit(20);
        if (error)
            throw new Error(error.message);
        res.json(data || []);
    }
    catch (error) {
        console.error('Error fetching prompt proposals:', error.message);
        res.status(500).json([]);
    }
});
app.get('/prompt-proposals/:id', async (req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.status(404).json({ error: 'Supabase not configured' });
        }
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(PROMPT_PROPOSALS_TABLE)
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();
        if (error)
            throw new Error(error.message);
        if (!data)
            return res.status(404).json({ error: 'Proposal not found' });
        res.json(data);
    }
    catch (error) {
        console.error('Error fetching prompt proposal:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposal' });
    }
});
app.put('/prompt-proposals/:id', async (req, res) => {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)()) {
            return res.status(503).json({ error: 'Supabase not configured' });
        }
        const updates = req.body || {};
        const allowedFields = {};
        const editable = ['status', 'reviewer_name', 'reviewer_notes', 'final_prompt', 'reviewed_at'];
        for (const key of editable) {
            if (updates[key] !== undefined) {
                allowedFields[key] = updates[key];
            }
        }
        if (Object.keys(allowedFields).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(PROMPT_PROPOSALS_TABLE)
            .update(allowedFields)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error)
            throw new Error(error.message);
        res.json(data);
    }
    catch (error) {
        console.error('Error updating prompt proposal:', error.message);
        res.status(500).json({ error: 'Failed to update proposal' });
    }
});
app.listen(port, () => {
    console.log(`db service listening at http://localhost:${port}`);
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        console.log('Supabase mirror: enabled');
    }
    else {
        console.log('Supabase mirror: disabled (missing SUPABASE_URL/SUPABASE_*_KEY)');
    }
    initDb();
});

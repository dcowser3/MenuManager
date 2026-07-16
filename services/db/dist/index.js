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
exports.htmlTextMatchesApproved = htmlTextMatchesApproved;
exports.mapApprovedSubmissionForClient = mapApprovedSubmissionForClient;
exports.findApprovedChildren = findApprovedChildren;
const express = require("express");
const crypto = require("crypto");
const fs_1 = require("fs");
const fsSync = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv = require("dotenv");
const supabase_client_1 = require("@menumanager/supabase-client");
const submission_updates_1 = require("./lib/submission-updates");
const schema_drift_1 = require("./lib/schema-drift");
const internal_auth_1 = require("@menumanager/internal-auth");
const tenant_config_1 = require("@menumanager/tenant-config");
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const app = express();
const port = 3004;
const JSON_BODY_LIMIT = process.env.DB_JSON_BODY_LIMIT || process.env.JSON_BODY_LIMIT || '5mb';
const AI_REVIEW_URL = process.env.AI_REVIEW_URL || 'http://localhost:3002';
const DISH_QUALITY_AI_TIMEOUT_MS = Number(process.env.APPROVED_DISH_AI_QUALITY_TIMEOUT_MS || 20000);
const DB_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'db');
const SUBMISSIONS_DB = path.join(DB_DIR, 'submissions.json');
const REPORTS_DB = path.join(DB_DIR, 'reports.json');
const PROFILES_DB = path.join(DB_DIR, 'submitter_profiles.json');
const ASSETS_DB = path.join(DB_DIR, 'assets.json');
const PROPERTIES_DB = path.join(DB_DIR, 'properties.json');
const CORRECTION_RULES_DB = path.join(DB_DIR, 'correction_rules.json');
const DRAFT_SESSIONS_DB = path.join(DB_DIR, 'draft_sessions.json');
const MENUS_DB = path.join(DB_DIR, 'menus.json');
const SUBMISSIONS_TABLE = 'submissions';
const SUBMITTER_PROFILES_TABLE = 'submitter_profiles';
const ASSETS_TABLE = 'assets';
const PROPERTIES_TABLE = 'properties';
const DRAFT_SESSIONS_TABLE = 'draft_sessions';
const MENUS_TABLE = 'menus';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPROVED_SUBMISSION_STATUSES = ['approved', 'approved_override'];
const REVIEW_QUEUE_STATUSES = ['pending_human_review', 'submitted_no_ai_review'];
// Internal reviewer / direct-handoff submitter identity (configurable per business).
const ISABELLA_EMAIL = (0, tenant_config_1.getTenantConfig)().emails.clickupHandoffSubmitter;
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
function getRepoRoot() {
    const candidates = [
        path.resolve(__dirname, '..', '..'),
        path.resolve(__dirname, '..', '..', '..'),
    ];
    for (const candidate of candidates) {
        if (fsSync.existsSync(path.join(candidate, 'services')) && fsSync.existsSync(path.join(candidate, 'samples'))) {
            return candidate;
        }
    }
    return candidates[0];
}
function deriveCityCountryFromProperty(name) {
    const idx = name.lastIndexOf(' - ');
    if (idx < 0)
        return '';
    return name.slice(idx + 3).trim();
}
// Seed catalog for a fresh database/local store. The property list is the single
// source of truth in the config bundle (config/properties.json); SharePoint
// routing is backfilled per-name by normalizePropertyCatalogRecord from
// DEFAULT_SHAREPOINT_PROPERTY_CONFIG. Returns an empty catalog (not RSH data) if
// the bundle has no usable list, so a fresh business never seeds as RSH.
function buildDefaultPropertyCatalog() {
    try {
        const file = (0, tenant_config_1.resolveTenantFile)((0, tenant_config_1.getTenantConfig)().propertiesSeedFile);
        if (fsSync.existsSync(file)) {
            const parsed = JSON.parse(fsSync.readFileSync(file, 'utf-8'));
            if (Array.isArray(parsed)) {
                return parsed.map((record) => normalizePropertyCatalogRecord(record));
            }
        }
        console.warn(`Property seed not found or invalid at ${file}; starting with an empty catalog.`);
    }
    catch (error) {
        console.warn('Could not read property seed; starting with an empty catalog:', error?.message || error);
    }
    return [];
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
function normalizeMenuSizeBoolean(value) {
    const normalized = `${value || ''}`.trim().toLowerCase();
    if (['y', 'yes', 'true', '1'].includes(normalized))
        return 'yes';
    if (['n', 'no', 'false', '0'].includes(normalized))
        return 'no';
    return '';
}
function normalizeMenuSizeDefaults(input) {
    if (!Array.isArray(input))
        return [];
    return input
        .map((row) => ({
        menu_type: `${row?.menu_type || row?.menuType || ''}`.trim(),
        width: `${row?.width || ''}`.trim(),
        height: `${row?.height || ''}`.trim(),
        folded: normalizeMenuSizeBoolean(row?.folded),
        crop_marks: normalizeMenuSizeBoolean(row?.crop_marks ?? row?.cropMarks),
        bleed_marks: normalizeMenuSizeBoolean(row?.bleed_marks ?? row?.bleedMarks),
    }))
        .filter((row) => row.menu_type && row.width && row.height);
}
function normalizePropertyCatalogRecord(input) {
    const name = `${input?.name || ''}`.trim();
    const defaults = DEFAULT_SHAREPOINT_PROPERTY_CONFIG[name] || {};
    return {
        name,
        city_country: `${input?.city_country || deriveCityCountryFromProperty(name) || ''}`.trim(),
        hotel: input?.hotel || undefined,
        is_active: input?.is_active !== false,
        menu_size_defaults: normalizeMenuSizeDefaults(input?.menu_size_defaults),
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
    'menu_id',
    'approver_dispute_token',
    'approver_disputed_at',
    'approver_dispute_note',
    'revision_baseline_doc_path',
    'revision_baseline_file_name',
    'base_approved_menu_content',
    'chef_persistent_diff',
    'form_attempt_id',
    'approved_menu_content_raw',
    'approved_menu_content',
    'approved_menu_content_html',
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
function toSupabaseSubmissionRecord(payload, options) {
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
    if (options?.includeRawPayload !== false) {
        // Preserve the complete submission payload for audit/debug parity.
        // This guarantees no field is lost even if schema evolves later.
        mapped.raw_payload = payload;
    }
    return mapped;
}
async function mirrorSubmissionCreateToSupabase(localSubmission) {
    if (!(0, supabase_client_1.isSupabaseConfigured)())
        return;
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const record = toSupabaseSubmissionRecord(localSubmission, { includeRawPayload: true });
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
    const record = toSupabaseSubmissionRecord(updates, { includeRawPayload: false });
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
async function findSubmissionByDisputeToken(token) {
    const normalized = `${token || ''}`.trim();
    if (!normalized)
        return null;
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const { data, error } = await (0, supabase_client_1.getSupabaseClient)()
            .from(SUBMISSIONS_TABLE)
            .select('*')
            .eq('approver_dispute_token', normalized)
            .maybeSingle();
        if (error)
            throw new Error(`Failed to look up dispute token: ${error.message}`);
        if (data)
            return data;
    }
    const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
    return Object.values(submissions).find((row) => `${row?.approver_dispute_token || ''}`.trim() === normalized) || null;
}
function getDraftExpiryDays() {
    const configured = Number((0, tenant_config_1.getTenantConfig)().draftSessions?.expiryDays);
    return Number.isFinite(configured) && configured > 0 ? configured : 30;
}
function getDraftExpiryCutoff() {
    return Date.now() - getDraftExpiryDays() * 24 * 60 * 60 * 1000;
}
function isDraftExpired(draft) {
    if (!draft || draft.status !== 'active')
        return false;
    const updatedAt = Date.parse(`${draft.updated_at || draft.created_at || ''}`);
    return Number.isFinite(updatedAt) && updatedAt < getDraftExpiryCutoff();
}
function normalizeDraftSession(row) {
    const formState = typeof row?.form_state === 'string'
        ? (() => {
            try {
                return JSON.parse(row.form_state);
            }
            catch {
                return {};
            }
        })()
        : (row?.form_state || {});
    return {
        id: `${row?.id || ''}`,
        token: `${row?.token || ''}`,
        base_submission_id: `${row?.base_submission_id || ''}`,
        menu_content_html: `${row?.menu_content_html || ''}`,
        form_state: formState && typeof formState === 'object' ? formState : {},
        status: `${row?.status || 'active'}`,
        created_at: `${row?.created_at || ''}`,
        updated_at: `${row?.updated_at || ''}`,
        submitted_submission_id: row?.submitted_submission_id || null,
        last_edited_by: `${row?.last_edited_by || ''}`,
        menu_id: row?.menu_id || null,
    };
}
// JSON storage has no database constraints. Serialize create/replace work per
// baseline so its behavior matches Supabase's partial unique index.
const activeDraftMutations = new Map();
async function withActiveDraftMutation(baseSubmissionId, work) {
    const key = `${baseSubmissionId || ''}`.trim();
    const previous = activeDraftMutations.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    activeDraftMutations.set(key, queued);
    await previous;
    try {
        return await work();
    }
    finally {
        release();
        if (activeDraftMutations.get(key) === queued)
            activeDraftMutations.delete(key);
    }
}
async function readLocalDraftSessions() {
    try {
        return JSON.parse(await fs_1.promises.readFile(DRAFT_SESSIONS_DB, 'utf-8'));
    }
    catch {
        return {};
    }
}
async function writeLocalDraftSessions(drafts) {
    await fs_1.promises.writeFile(DRAFT_SESSIONS_DB, JSON.stringify(drafts, null, 2));
}
async function loadDraftByToken(token) {
    const normalizedToken = `${token || ''}`.trim();
    if (!normalizedToken)
        return null;
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(DRAFT_SESSIONS_TABLE)
            .select('*')
            .eq('token', normalizedToken)
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to load draft session: ${error.message}`);
        }
        if (data) {
            return normalizeDraftSession(data);
        }
    }
    const drafts = await readLocalDraftSessions();
    const local = Object.values(drafts).find((draft) => draft?.token === normalizedToken);
    return local ? normalizeDraftSession(local) : null;
}
async function saveDraftSession(draft) {
    const normalized = normalizeDraftSession(draft);
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const record = {
            id: normalized.id,
            token: normalized.token,
            base_submission_id: normalized.base_submission_id,
            menu_content_html: normalized.menu_content_html || null,
            form_state: normalized.form_state || {},
            status: normalized.status,
            created_at: normalized.created_at,
            updated_at: normalized.updated_at,
            submitted_submission_id: normalized.submitted_submission_id || null,
            last_edited_by: normalized.last_edited_by || null,
            menu_id: normalized.menu_id || null,
        };
        const { error } = await supabase
            .from(DRAFT_SESSIONS_TABLE)
            .upsert(record, { onConflict: 'id' });
        if (error) {
            throw new Error(`Failed to save draft session: ${error.message}`);
        }
    }
    const drafts = await readLocalDraftSessions();
    drafts[normalized.id] = normalized;
    await writeLocalDraftSessions(drafts);
    return normalized;
}
async function findActiveDraftForBase(baseSubmissionId) {
    const normalizedBaseId = `${baseSubmissionId || ''}`.trim();
    if (!normalizedBaseId)
        return null;
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const { data, error } = await (0, supabase_client_1.getSupabaseClient)()
            .from(DRAFT_SESSIONS_TABLE)
            .select('*')
            .eq('base_submission_id', normalizedBaseId)
            .eq('status', 'active')
            .order('updated_at', { ascending: false })
            .limit(1);
        if (error)
            throw new Error(`Failed to find active draft: ${error.message}`);
        if (data?.[0])
            return normalizeDraftSession(data[0]);
    }
    const drafts = await readLocalDraftSessions();
    const active = Object.values(drafts)
        .map(normalizeDraftSession)
        .filter((draft) => draft.base_submission_id === normalizedBaseId && draft.status === 'active')
        .sort((a, b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || ''))[0];
    return active || null;
}
// Phase 3: one active draft per MENU (re-keys findActiveDraftForBase). Falls
// back to per-baseline lookup when the draft's menu isn't known yet.
async function findActiveDraftForMenu(menuId) {
    const normalizedMenuId = `${menuId || ''}`.trim();
    if (!normalizedMenuId)
        return null;
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const { data, error } = await (0, supabase_client_1.getSupabaseClient)()
            .from(DRAFT_SESSIONS_TABLE)
            .select('*')
            .eq('menu_id', normalizedMenuId)
            .eq('status', 'active')
            .order('updated_at', { ascending: false })
            .limit(1);
        if (error)
            throw new Error(`Failed to find active draft for menu: ${error.message}`);
        if (data?.[0])
            return normalizeDraftSession(data[0]);
    }
    const drafts = await readLocalDraftSessions();
    const active = Object.values(drafts)
        .map(normalizeDraftSession)
        .filter((draft) => draft.menu_id === normalizedMenuId && draft.status === 'active')
        .sort((a, b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || ''))[0];
    return active || null;
}
async function listDraftSessions(options = {}) {
    const statuses = (options.statuses || []).map((status) => status.trim()).filter(Boolean);
    const baseIds = (options.baseSubmissionIds || []).map((id) => id.trim()).filter(Boolean);
    let rows = [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        let query = (0, supabase_client_1.getSupabaseClient)().from(DRAFT_SESSIONS_TABLE).select('*').order('updated_at', { ascending: false });
        if (statuses.length)
            query = query.in('status', statuses);
        if (baseIds.length)
            query = query.in('base_submission_id', baseIds);
        if (options.since)
            query = query.gte('updated_at', new Date(options.since).toISOString());
        const { data, error } = await query;
        if (error)
            throw new Error(`Failed to list draft sessions: ${error.message}`);
        rows = data || [];
    }
    else {
        rows = Object.values(await readLocalDraftSessions());
    }
    const result = [];
    for (const row of rows) {
        const draft = await expireDraftIfNeeded(normalizeDraftSession(row));
        if (statuses.length && !statuses.includes(draft.status))
            continue;
        if (baseIds.length && !baseIds.includes(draft.base_submission_id))
            continue;
        if (options.since && Date.parse(draft.updated_at || '') < options.since)
            continue;
        result.push(draft);
    }
    return result.sort((a, b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || ''));
}
async function expireDraftIfNeeded(draft) {
    if (!isDraftExpired(draft))
        return draft;
    const expired = {
        ...draft,
        status: 'expired',
        updated_at: new Date().toISOString(),
    };
    return saveDraftSession(expired);
}
function toDraftClientPayload(draft, baseline) {
    return {
        ...normalizeDraftSession(draft),
        token: draft.token ? `${draft.token}` : '',
        baseline,
        expiresInDays: getDraftExpiryDays(),
    };
}
// ---------------------------------------------------------------------------
// Menus (Phase 1 — menu-as-an-entity). Supabase-primary with JSON mirror, same
// convention as draft sessions. No DB constraints on the JSON fallback — the
// single-menu-per-group and pointer invariants are enforced in code.
// ---------------------------------------------------------------------------
const VALID_MENU_STATUSES = ['active', 'retired'];
function normalizeMenu(row) {
    const status = `${row?.status || 'active'}`.trim().toLowerCase();
    return {
        id: `${row?.id || ''}`,
        property: `${row?.property || ''}`,
        service_period: `${row?.service_period || ''}`,
        name: `${row?.name || ''}`,
        current_submission_id: row?.current_submission_id ? `${row.current_submission_id}` : null,
        status: VALID_MENU_STATUSES.includes(status) ? status : 'active',
        created_at: `${row?.created_at || ''}`,
        updated_at: `${row?.updated_at || ''}`,
    };
}
async function readLocalMenus() {
    try {
        return JSON.parse(await fs_1.promises.readFile(MENUS_DB, 'utf-8'));
    }
    catch {
        return {};
    }
}
async function writeLocalMenus(menus) {
    await fs_1.promises.writeFile(MENUS_DB, JSON.stringify(menus, null, 2));
}
async function getMenuById(id) {
    const normalizedId = `${id || ''}`.trim();
    if (!normalizedId)
        return null;
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const { data, error } = await (0, supabase_client_1.getSupabaseClient)()
            .from(MENUS_TABLE)
            .select('*')
            .eq('id', normalizedId)
            .maybeSingle();
        if (error)
            throw new Error(`Failed to load menu: ${error.message}`);
        if (data)
            return normalizeMenu(data);
    }
    const menus = await readLocalMenus();
    return menus[normalizedId] ? normalizeMenu(menus[normalizedId]) : null;
}
async function getMenusByIds(ids) {
    const normalizedIds = [...new Set((ids || []).map((id) => `${id || ''}`.trim()).filter(Boolean))];
    if (!normalizedIds.length)
        return [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const { data, error } = await (0, supabase_client_1.getSupabaseClient)()
            .from(MENUS_TABLE)
            .select('*')
            .in('id', normalizedIds);
        if (error)
            throw new Error(`Failed to batch-load menus: ${error.message}`);
        return (data || []).map(normalizeMenu);
    }
    const menus = await readLocalMenus();
    return normalizedIds.map((id) => menus[id]).filter(Boolean).map(normalizeMenu);
}
async function findMenus(filters = {}) {
    const propertyKey = filters.property ? normalizeApprovedLookupValue(filters.property) : '';
    const serviceKey = filters.servicePeriod ? normalizeApprovedLookupValue(filters.servicePeriod) : '';
    const statusKey = filters.status ? `${filters.status}`.trim().toLowerCase() : '';
    let rows = [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        let query = (0, supabase_client_1.getSupabaseClient)().from(MENUS_TABLE).select('*').order('updated_at', { ascending: false });
        if (filters.property)
            query = query.ilike('property', filters.property);
        if (statusKey)
            query = query.eq('status', statusKey);
        const { data, error } = await query;
        if (error)
            throw new Error(`Failed to find menus: ${error.message}`);
        rows = data || [];
    }
    else {
        rows = Object.values(await readLocalMenus());
    }
    return rows
        .map(normalizeMenu)
        .filter((menu) => !propertyKey || normalizeApprovedLookupValue(menu.property) === propertyKey)
        .filter((menu) => !serviceKey || normalizeApprovedLookupValue(menu.service_period) === serviceKey)
        .filter((menu) => !statusKey || menu.status === statusKey)
        .sort((a, b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || ''));
}
async function saveMenu(menu) {
    const now = new Date().toISOString();
    const normalized = normalizeMenu({
        ...menu,
        id: menu?.id || crypto.randomUUID(),
        created_at: menu?.created_at || now,
        updated_at: menu?.updated_at || now,
    });
    if (!normalized.property || !normalized.service_period || !normalized.name) {
        const error = new Error('Menu requires property, service_period, and name');
        error.statusCode = 400;
        throw error;
    }
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const record = {
            id: normalized.id,
            property: normalized.property,
            service_period: normalized.service_period,
            name: normalized.name,
            current_submission_id: normalized.current_submission_id,
            status: normalized.status,
            created_at: normalized.created_at,
            updated_at: normalized.updated_at,
        };
        const { error } = await (0, supabase_client_1.getSupabaseClient)().from(MENUS_TABLE).upsert(record, { onConflict: 'id' });
        if (error)
            throw new Error(`Failed to save menu: ${error.message}`);
    }
    const menus = await readLocalMenus();
    menus[normalized.id] = normalized;
    await writeLocalMenus(menus);
    return normalized;
}
// Phase 2 chokepoint: when a submission enters an approved status and is linked
// to a menu, advance that menu's current_submission_id — but never backward. A
// late-arriving approval of an older version (lower approved timestamp than the
// current pointer) must not move the pointer (latest reviewed_at wins, same rule
// as today's lineage tip). Derived bookkeeping: failures are logged, never fatal
// to the approval itself.
// Phase 2 brand-new resolution: a submission being approved with no menu link
// gets a menu resolved now (never at submit — rejected submissions must not
// create menus). No name collision → create silently. Collision (active menu,
// same property + service + name) → honor the reviewer's `menuDecision` if one
// was passed; otherwise default to a SEPARATE menu and warn (the ClickUp-webhook
// path and any non-prompting caller land here — never a silent merge). Returns
// the menu id to link, or null when the submission lacks the fields to form a
// menu. Creates the menu row but leaves the pointer to reconcileMenuPointer.
async function resolveBrandNewMenuId(submission, menuDecision) {
    const property = `${submission?.property || ''}`.trim();
    const servicePeriod = getSubmissionServicePeriod(submission);
    const name = `${submission?.project_name || ''}`.trim();
    if (!property || !servicePeriod || !name) {
        console.warn(`resolveBrandNewMenuId: submission ${getPublicSubmissionId(submission)} missing property/service/name — no menu created`);
        return { menuId: null, collisionDefaulted: false };
    }
    const nameKey = normalizeApprovedLookupValue(name);
    const candidates = (await findMenus({ property, servicePeriod, status: 'active' }))
        .filter((menu) => normalizeApprovedLookupValue(menu.name) === nameKey);
    const decision = `${menuDecision || ''}`.trim();
    if (candidates.length > 0 && decision && decision.toLowerCase() !== 'separate') {
        // Reviewer chose "new version of <existing>": link to that menu.
        const chosen = candidates.find((menu) => menu.id === decision);
        if (chosen)
            return { menuId: chosen.id, collisionDefaulted: false };
        console.warn(`resolveBrandNewMenuId: menuDecision ${decision} not among candidates — creating separate menu`);
    }
    const collisionDefaulted = candidates.length > 0 && (!decision || decision.toLowerCase() === 'separate');
    if (candidates.length > 0 && !decision) {
        console.warn(`resolveBrandNewMenuId: name collision on "${name}" (${property} / ${servicePeriod}) with no reviewer decision — defaulting to a separate menu`);
    }
    const created = await saveMenu({ property, service_period: servicePeriod, name, current_submission_id: null, status: 'active' });
    return { menuId: created.id, collisionDefaulted };
}
// When an update approves a still-unlinked submission, resolve its menu and add
// menu_id to the write so the link and the pointer move land together. Never
// fatal to the approval — logs and leaves the submission unlinked on failure.
async function injectResolvedMenuIdIfApproving(existingRecord, allowedFields, menuDecision) {
    const mergedStatus = `${allowedFields.status ?? existingRecord?.status ?? ''}`.trim().toLowerCase();
    if (!APPROVED_SUBMISSION_STATUSES.includes(mergedStatus))
        return;
    if (existingRecord?.menu_id || allowedFields.menu_id)
        return; // already linked or being linked
    try {
        const { menuId } = await resolveBrandNewMenuId({ ...existingRecord, ...allowedFields }, menuDecision);
        if (menuId)
            allowedFields.menu_id = menuId;
    }
    catch (error) {
        console.error('Brand-new menu resolution failed (approval kept, left unlinked):', error.message);
    }
}
// Only reconcile when the write could affect the pointer: a status entering an
// approved state, or a menu link being (re)assigned on the submission.
function shouldReconcileMenuPointer(allowedFields) {
    const status = `${allowedFields?.status || ''}`.trim().toLowerCase();
    return APPROVED_SUBMISSION_STATUSES.includes(status) || Object.prototype.hasOwnProperty.call(allowedFields || {}, 'menu_id');
}
async function reconcileMenuPointerOnApproval(submission) {
    const status = `${submission?.status || ''}`.trim().toLowerCase();
    if (!APPROVED_SUBMISSION_STATUSES.includes(status))
        return;
    const menuId = `${submission?.menu_id || ''}`.trim();
    if (!menuId)
        return;
    const menu = await getMenuById(menuId);
    if (!menu) {
        console.warn(`reconcileMenuPointerOnApproval: submission links to unknown menu ${menuId}`);
        return;
    }
    const submissionPublicId = getPublicSubmissionId(submission);
    if (!submissionPublicId)
        return;
    if (menu.current_submission_id) {
        if (menu.current_submission_id === submissionPublicId)
            return; // already the tip
        const currentPointer = await getSubmissionRecordById(menu.current_submission_id);
        if (currentPointer && getApprovedTimestamp(submission) < getApprovedTimestamp(currentPointer)) {
            return; // older version approved late — don't move the pointer backward
        }
    }
    await saveMenu({ ...menu, current_submission_id: submissionPublicId, updated_at: new Date().toISOString() });
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
    const seedCatalog = buildDefaultPropertyCatalog();
    const seedByName = new Map(seedCatalog.map((item) => [item.name.toLowerCase(), item]));
    const mergeSeedMenuSizeDefaults = (catalog) => catalog
        .map((item) => {
        const seed = seedByName.get(item.name.toLowerCase());
        if ((!item.menu_size_defaults || item.menu_size_defaults.length === 0) && seed?.menu_size_defaults?.length) {
            return { ...item, menu_size_defaults: seed.menu_size_defaults };
        }
        return item;
    });
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        try {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const { data, error } = await supabase
                .from(PROPERTIES_TABLE)
                .select('name, city_country, hotel, is_active, sharepoint_site_url, sharepoint_library_name, sharepoint_drive_id, sharepoint_base_folder_path, sharepoint_service_folders, sharepoint_last_synced_at')
                .eq('is_active', true)
                .order('name', { ascending: true });
            if (!error && Array.isArray(data) && data.length > 0) {
                return mergeSeedMenuSizeDefaults(data
                    .map((item) => normalizePropertyCatalogRecord(item))
                    .filter((item) => !!item.name));
            }
        }
        catch (error) {
            console.warn('Falling back to local property catalog:', error?.message || error);
        }
    }
    const local = await readLocalPropertyCatalog();
    return mergeSeedMenuSizeDefaults(local
        .filter((item) => item.is_active !== false)
        .sort((a, b) => a.name.localeCompare(b.name)));
}
function normalizeApprovedLookupValue(value) {
    return `${value || ''}`
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ');
}
function normalizeSearchValue(value) {
    return `${value || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ');
}
function searchFieldsInclude(values, query) {
    const normalizedQuery = normalizeSearchValue(query);
    if (normalizedQuery.length < 2)
        return false;
    return normalizeSearchValue(values.filter(Boolean).join(' ')).includes(normalizedQuery);
}
function getRawPayloadObject(submission) {
    const rawPayload = submission?.raw_payload;
    if (!rawPayload)
        return {};
    if (typeof rawPayload === 'object')
        return rawPayload;
    if (typeof rawPayload !== 'string')
        return {};
    try {
        const parsed = JSON.parse(rawPayload);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function isIsabellaDirectHandoff(submission) {
    const submitterEmail = `${submission?.submitter_email || ''}`.trim().toLowerCase();
    if (submitterEmail !== ISABELLA_EMAIL)
        return false;
    const clickupHandoff = getRawPayloadObject(submission).clickup_handoff || {};
    const clickupTaskId = `${submission?.clickup_task_id || clickupHandoff.task_id || ''}`.trim();
    return !!clickupTaskId;
}
function getSubmissionServicePeriod(submission) {
    return `${submission?.service_period || submission?.raw_payload?.servicePeriod || ''}`.trim();
}
function getApprovedTimestamp(submission) {
    const candidates = [
        submission?.reviewed_at,
        submission?.approved_text_extracted_at,
        submission?.updated_at,
        submission?.created_at,
    ];
    for (const value of candidates) {
        const parsed = Date.parse(`${value || ''}`);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return 0;
}
function getPublicSubmissionId(submission) {
    return `${submission?.legacy_id || submission?.id || ''}`.trim();
}
function isApprovedBaselineSource(submission) {
    const source = `${submission?.source || ''}`.trim();
    return !source || source === 'form' || source === 'clickup_history_import';
}
function normalizeComparableMenuText(value) {
    return `${value || ''}`
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p\s*>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase();
}
function htmlTextMatchesApproved(html, approvedText) {
    const normalizedHtml = normalizeComparableMenuText(html);
    const normalizedApproved = normalizeComparableMenuText(approvedText);
    return !!normalizedHtml && !!normalizedApproved && normalizedHtml === normalizedApproved;
}
function mapApprovedSubmissionForClient(submission, latestForPropertyService) {
    const publicId = getPublicSubmissionId(submission);
    const latestPublicId = latestForPropertyService ? getPublicSubmissionId(latestForPropertyService) : '';
    return {
        id: publicId,
        projectName: submission.project_name || '',
        property: submission.property || '',
        width: submission.width || '',
        height: submission.height || '',
        printWidth: submission.print_width || submission.raw_payload?.printWidth || '',
        printHeight: submission.print_height || submission.raw_payload?.printHeight || '',
        printRegion: submission.print_region || submission.raw_payload?.printRegion || '',
        printSize: submission.print_size || submission.raw_payload?.printSize || '',
        folded: submission.folded || submission.raw_payload?.folded || '',
        digitalWidth: submission.digital_width || submission.raw_payload?.digitalWidth || '',
        digitalHeight: submission.digital_height || submission.raw_payload?.digitalHeight || '',
        cropMarks: submission.crop_marks || '',
        bleedMarks: submission.bleed_marks || '',
        fileSizeLimit: submission.file_size_limit || '',
        fileSizeLimitMb: submission.file_size_limit_mb || '',
        fileDeliveryNotes: submission.file_delivery_notes || '',
        orientation: submission.orientation || '',
        menuType: submission.menu_type || 'standard',
        servicePeriod: getSubmissionServicePeriod(submission),
        templateType: submission.template_type || 'food',
        hotelName: submission.hotel_name || '',
        cityCountry: submission.city_country || '',
        assetType: submission.asset_type || '',
        submitterName: submission.submitter_name || '',
        submitterEmail: submission.submitter_email || '',
        dateNeeded: submission.date_needed || '',
        turnaroundDays: submission.turnaround_days || submission.raw_payload?.turnaroundDays || '',
        updatedAt: submission.updated_at || submission.created_at,
        reviewedAt: submission.reviewed_at || submission.approved_text_extracted_at || submission.updated_at || submission.created_at || '',
        approvedMenuContent: submission.approved_menu_content || submission.menu_content || '',
        // Never open an approved baseline with pre-review HTML. Historical rows
        // may only have submitted HTML; retain it solely when its text agrees
        // with canonical approved text, otherwise the form safely uses plain text.
        approvedMenuContentHtml: submission.approved_menu_content_html
            || (htmlTextMatchesApproved(submission.menu_content_html || submission.raw_payload?.menuContentHtml || '', submission.approved_menu_content || submission.menu_content || '') ? (submission.menu_content_html || submission.raw_payload?.menuContentHtml || '') : ''),
        allergens: submission.allergens || '',
        status: submission.status,
        menuId: submission.menu_id || null,
        isLatestForPropertyService: latestForPropertyService ? latestPublicId === publicId : null,
        latestForPropertyService: latestForPropertyService ? {
            id: latestPublicId,
            projectName: latestForPropertyService.project_name || '',
            property: latestForPropertyService.property || '',
            servicePeriod: getSubmissionServicePeriod(latestForPropertyService),
            reviewedAt: latestForPropertyService.reviewed_at || latestForPropertyService.approved_text_extracted_at || latestForPropertyService.updated_at || latestForPropertyService.created_at || '',
            updatedAt: latestForPropertyService.updated_at || latestForPropertyService.created_at || '',
            filename: latestForPropertyService.filename || '',
        } : null,
    };
}
async function findLatestApprovedByPropertyService(property, servicePeriod) {
    const propertyKey = normalizeApprovedLookupValue(property);
    const serviceKey = normalizeApprovedLookupValue(servicePeriod);
    if (!propertyKey || !serviceKey) {
        return null;
    }
    let candidates = [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('*')
            .in('status', APPROVED_SUBMISSION_STATUSES)
            .not('final_path', 'is', null)
            .ilike('property', property)
            .limit(200);
        if (error) {
            throw new Error(error.message);
        }
        candidates = data || [];
    }
    else {
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        candidates = Object.values(submissions);
    }
    return candidates
        .filter((submission) => APPROVED_SUBMISSION_STATUSES.includes(`${submission.status || ''}`.trim().toLowerCase()))
        .filter((submission) => !!submission.final_path)
        .filter(isApprovedBaselineSource)
        .filter((submission) => normalizeApprovedLookupValue(submission.property) === propertyKey)
        .filter((submission) => normalizeApprovedLookupValue(getSubmissionServicePeriod(submission)) === serviceKey)
        .sort((a, b) => getApprovedTimestamp(b) - getApprovedTimestamp(a))[0] || null;
}
async function getSubmissionRecordsByIds(ids) {
    const normalizedIds = [...new Set(ids.map((id) => `${id || ''}`.trim()).filter(Boolean))];
    if (!normalizedIds.length)
        return [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const uuidIds = normalizedIds.filter((id) => UUID_REGEX.test(id));
        const legacyIds = normalizedIds.filter((id) => !UUID_REGEX.test(id));
        const rows = [];
        if (uuidIds.length) {
            const { data, error } = await (0, supabase_client_1.getSupabaseClient)().from(SUBMISSIONS_TABLE).select('*').in('id', uuidIds);
            if (error)
                throw new Error(`Failed to fetch baselines: ${error.message}`);
            rows.push(...(data || []));
        }
        if (legacyIds.length) {
            const { data, error } = await (0, supabase_client_1.getSupabaseClient)().from(SUBMISSIONS_TABLE).select('*').in('legacy_id', legacyIds);
            if (error)
                throw new Error(`Failed to fetch baselines: ${error.message}`);
            rows.push(...(data || []));
        }
        return rows;
    }
    const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
    return Object.values(submissions).filter((row) => normalizedIds.includes(getPublicSubmissionId(row)));
}
async function findApprovedChildren(submissionIds) {
    const ids = [...new Set(submissionIds.map((id) => `${id || ''}`.trim()).filter(Boolean))];
    const childrenByParent = Object.fromEntries(ids.map((id) => [id, []]));
    if (!ids.length)
        return childrenByParent;
    let candidates = [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const { data, error } = await (0, supabase_client_1.getSupabaseClient)()
            .from(SUBMISSIONS_TABLE)
            .select('*')
            .in('revision_base_submission_id', ids)
            .in('status', APPROVED_SUBMISSION_STATUSES);
        if (error)
            throw new Error(`Failed to find approved children: ${error.message}`);
        candidates = data || [];
    }
    else {
        candidates = Object.values(JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8')));
    }
    for (const candidate of candidates) {
        const parentId = `${candidate?.revision_base_submission_id || ''}`.trim();
        if (!childrenByParent[parentId])
            continue;
        if (!APPROVED_SUBMISSION_STATUSES.includes(`${candidate?.status || ''}`.trim().toLowerCase()))
            continue;
        childrenByParent[parentId].push(candidate);
    }
    for (const children of Object.values(childrenByParent)) {
        children.sort((a, b) => getApprovedTimestamp(b) - getApprovedTimestamp(a));
    }
    return childrenByParent;
}
function toSupersededBy(child) {
    return {
        id: getPublicSubmissionId(child),
        projectName: child?.project_name || '',
        approvedAt: child?.reviewed_at || child?.updated_at || child?.created_at || '',
    };
}
function normalizeBaselineMatchLines(value) {
    return `${value || ''}`
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean);
}
function isNearExactBaselineMatch(candidate, extractedText) {
    const candidateLines = new Set(normalizeBaselineMatchLines(candidate));
    const extractedLines = new Set(normalizeBaselineMatchLines(extractedText));
    if (!candidateLines.size || !extractedLines.size)
        return false;
    const intersection = [...candidateLines].filter((line) => extractedLines.has(line)).length;
    return intersection / candidateLines.size >= 0.95 && intersection / extractedLines.size >= 0.95;
}
async function findBaselineMatch(extractedText, property, servicePeriod) {
    const propertyKey = normalizeApprovedLookupValue(property);
    const serviceKey = normalizeApprovedLookupValue(servicePeriod);
    if (!propertyKey || !normalizeBaselineMatchLines(extractedText).length)
        return null;
    let rows = [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        let query = (0, supabase_client_1.getSupabaseClient)().from(SUBMISSIONS_TABLE).select('*').in('status', APPROVED_SUBMISSION_STATUSES).ilike('property', property);
        if (serviceKey)
            query = query.ilike('service_period', servicePeriod || '');
        const { data, error } = await query;
        if (error)
            throw new Error(`Failed to match approved baseline: ${error.message}`);
        rows = data || [];
    }
    else {
        rows = Object.values(JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8')));
    }
    return rows
        .filter((row) => APPROVED_SUBMISSION_STATUSES.includes(`${row.status || ''}`.trim().toLowerCase()))
        .filter((row) => normalizeApprovedLookupValue(row.property) === propertyKey)
        .filter((row) => !serviceKey || normalizeApprovedLookupValue(getSubmissionServicePeriod(row)) === serviceKey)
        .filter((row) => isNearExactBaselineMatch(row.approved_menu_content, extractedText))
        .sort((a, b) => getApprovedTimestamp(b) - getApprovedTimestamp(a))[0] || null;
}
async function findLatestApprovedByProjectProperty(projectName, property) {
    const projectKey = normalizeApprovedLookupValue(projectName);
    const propertyKey = normalizeApprovedLookupValue(property);
    if (!projectKey || !propertyKey) {
        return null;
    }
    let candidates = [];
    if ((0, supabase_client_1.isSupabaseConfigured)()) {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        const { data, error } = await supabase
            .from(SUBMISSIONS_TABLE)
            .select('*')
            .in('status', APPROVED_SUBMISSION_STATUSES)
            .not('final_path', 'is', null)
            .ilike('property', property)
            .limit(200);
        if (error) {
            throw new Error(error.message);
        }
        candidates = data || [];
    }
    else {
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        candidates = Object.values(submissions);
    }
    return candidates
        .filter((submission) => APPROVED_SUBMISSION_STATUSES.includes(`${submission.status || ''}`.trim().toLowerCase()))
        .filter((submission) => !!submission.final_path)
        .filter(isApprovedBaselineSource)
        .filter((submission) => normalizeApprovedLookupValue(submission.property) === propertyKey)
        .filter((submission) => normalizeApprovedLookupValue(submission.project_name) === projectKey)
        .sort((a, b) => getApprovedTimestamp(b) - getApprovedTimestamp(a))[0] || null;
}
function normalizeCorrectionRuleMenuScope(value) {
    const normalized = `${value || 'all'}`.trim().toLowerCase();
    return ['all', 'food', 'beverage'].includes(normalized) ? normalized : '';
}
function buildCorrectionRuleStorageRecord(record) {
    if (!record.submission_id || !record.correction_id || !record.rule) {
        return null;
    }
    const appliesToMenuType = normalizeCorrectionRuleMenuScope(record.applies_to_menu_type);
    if (!appliesToMenuType) {
        return null;
    }
    return {
        submission_id: `${record.submission_id}`,
        correction_id: `${record.correction_id}`,
        original_text: record.original_text || null,
        corrected_text: record.corrected_text || null,
        change_type: record.change_type || null,
        rule: `${record.rule}`,
        applies_to_menu_type: appliesToMenuType,
        is_location_specific: record.is_location_specific || false,
        project_name: record.project_name || null,
        restaurant_name: record.restaurant_name || '',
        location: record.location || 'All properties (global rule)',
        other_applicable_locations: Array.isArray(record.other_applicable_locations)
            ? record.other_applicable_locations
            : [],
        reviewer_name: record.reviewer_name || null,
        source: record.source || 'human',
        status: record.status || 'accepted',
        occurrences: Number(record.occurrences || 1),
        confidence: record.confidence || null,
        submission_ids: Array.isArray(record.submission_ids) ? record.submission_ids : null,
        prompt_cycle_id: record.prompt_cycle_id || null,
        consumed_at: record.consumed_at || null,
        example_original: record.example_original || null,
        example_corrected: record.example_corrected || null,
        inferred_from_guidance: record.inferred_from_guidance === true,
    };
}
async function readLocalCorrectionRules() {
    try {
        const raw = await fs_1.promises.readFile(CORRECTION_RULES_DB, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
async function writeLocalCorrectionRules(rules) {
    await fs_1.promises.mkdir(DB_DIR, { recursive: true });
    await fs_1.promises.writeFile(CORRECTION_RULES_DB, JSON.stringify(rules, null, 2));
}
function localCorrectionRuleId() {
    return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
async function createLocalCorrectionRule(record) {
    const rules = await readLocalCorrectionRules();
    const now = new Date().toISOString();
    const localRecord = {
        ...record,
        id: record.id || localCorrectionRuleId(),
        created_at: record.created_at || now,
        updated_at: record.updated_at || now,
    };
    rules.push(localRecord);
    await writeLocalCorrectionRules(rules);
    return localRecord;
}
function filterCorrectionRules(rules, query) {
    return rules
        .filter((rule) => !query.submission_id || rule.submission_id === query.submission_id)
        .filter((rule) => !query.status || rule.status === query.status)
        .filter((rule) => !query.source || rule.source === query.source);
}
function correctionRuleDedupeKey(rule) {
    return [
        rule.submission_id,
        rule.correction_id,
        rule.original_text || '',
        rule.corrected_text || '',
        rule.rule,
        rule.source,
    ].join('\u0000');
}
function mergeCorrectionRules(primary, fallback) {
    const ids = new Set();
    const keys = new Set();
    const merged = [];
    for (const rule of [...primary, ...fallback]) {
        const id = `${rule.id || ''}`.trim();
        const key = correctionRuleDedupeKey(rule);
        if ((id && ids.has(id)) || keys.has(key)) {
            continue;
        }
        if (id)
            ids.add(id);
        keys.add(key);
        merged.push(rule);
    }
    return merged.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}
function buildCorrectionRuleUpdateFields(updates) {
    const allowedFields = {};
    const editable = [
        'status',
        'rule',
        'is_location_specific',
        'other_applicable_locations',
        'change_type',
        'restaurant_name',
        'location',
        'project_name',
        'reviewer_name',
        'applies_to_menu_type',
    ];
    for (const key of editable) {
        if (updates[key] !== undefined) {
            allowedFields[key] = updates[key];
        }
    }
    if (allowedFields.applies_to_menu_type !== undefined) {
        const normalized = normalizeCorrectionRuleMenuScope(allowedFields.applies_to_menu_type);
        if (!normalized) {
            throw new Error('applies_to_menu_type must be all, food, or beverage');
        }
        allowedFields.applies_to_menu_type = normalized;
    }
    return allowedFields;
}
async function updateLocalCorrectionRule(id, updates) {
    const rules = await readLocalCorrectionRules();
    const index = rules.findIndex((rule) => `${rule.id || ''}` === id);
    if (index < 0) {
        return null;
    }
    const next = {
        ...rules[index],
        ...updates,
        updated_at: new Date().toISOString(),
    };
    rules[index] = next;
    await writeLocalCorrectionRules(rules);
    return next;
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
        await fs_1.promises.access(CORRECTION_RULES_DB).catch(() => fs_1.promises.writeFile(CORRECTION_RULES_DB, '[]'));
        await fs_1.promises.access(DRAFT_SESSIONS_DB).catch(() => fs_1.promises.writeFile(DRAFT_SESSIONS_DB, '{}'));
        await fs_1.promises.access(MENUS_DB).catch(() => fs_1.promises.writeFile(MENUS_DB, '{}')); // keyed by id
    }
    catch (error) {
        console.error('Failed to initialize database:', error);
    }
}
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use((error, _req, res, next) => {
    if (error?.type === 'entity.too.large') {
        return res.status(413).json({
            error: `Request payload is too large. DB service JSON bodies are limited to ${JSON_BODY_LIMIT}.`,
        });
    }
    if (error instanceof SyntaxError && 'body' in error) {
        return res.status(400).json({ error: 'Request body must be valid JSON' });
    }
    return next(error);
});
app.use(internal_auth_1.requireInternalServiceAuth);
app.post('/draft-sessions', async (req, res) => {
    try {
        const baseSubmissionId = `${req.body?.baseSubmissionId || req.body?.base_submission_id || ''}`.trim();
        if (!baseSubmissionId) {
            return res.status(400).json({ error: 'baseSubmissionId is required' });
        }
        const submission = await getSubmissionRecordById(baseSubmissionId);
        if (!submission) {
            return res.status(404).json({ error: 'Approved baseline not found' });
        }
        const status = `${submission.status || ''}`.trim().toLowerCase();
        if (!APPROVED_SUBMISSION_STATUSES.includes(status) || !isApprovedBaselineSource(submission)) {
            return res.status(400).json({ error: 'Drafts can only start from approved form submissions' });
        }
        const servicePeriod = getSubmissionServicePeriod(submission);
        const latest = await findLatestApprovedByPropertyService(`${submission.property || ''}`, servicePeriod);
        const baseline = mapApprovedSubmissionForClient(submission, latest || submission);
        const baseId = baseline.id || baseSubmissionId;
        // Phase 3 gating: prefer the menu pointer. A draft must start from the
        // menu's current version — not an outdated one. When the baseline has no
        // menu yet (pre-backfill), fall back to the old lineage-children gate.
        const menuId = `${submission.menu_id || ''}`.trim();
        let draftKey = baseId;
        if (menuId) {
            const menu = await getMenuById(menuId);
            const currentVersionId = `${menu?.current_submission_id || ''}`.trim();
            if (currentVersionId && currentVersionId !== baseId) {
                const currentRecord = await getSubmissionRecordById(currentVersionId);
                return res.status(409).json({
                    error: 'A newer version of this menu has been approved. Edit the current version instead.',
                    currentVersion: currentRecord ? mapApprovedSubmissionForClient(currentRecord, currentRecord) : { id: currentVersionId },
                });
            }
            draftKey = menuId;
        }
        else {
            const approvedChildren = await findApprovedChildren([baseId]);
            const children = approvedChildren[baseId] || [];
            if (children.length) {
                return res.status(409).json({
                    error: 'This menu has been superseded by an approved revision.',
                    supersededBy: toSupersededBy(children[0]),
                });
            }
        }
        const findActiveDraft = () => (menuId ? findActiveDraftForMenu(menuId) : findActiveDraftForBase(baseId));
        const replaceToken = `${req.body?.replaceToken || req.body?.replace_token || ''}`.trim();
        const result = await withActiveDraftMutation(draftKey, async () => {
            const existing = await findActiveDraft();
            const current = existing ? await expireDraftIfNeeded(existing) : null;
            if (current?.status === 'active') {
                if (!replaceToken)
                    return { draft: current, resumed: true };
                if (current.token !== replaceToken) {
                    const error = new Error('replaceToken does not match the active draft for this menu');
                    error.statusCode = 400;
                    throw error;
                }
                await saveDraftSession({ ...current, status: 'discarded', updated_at: new Date().toISOString() });
            }
            else if (replaceToken) {
                const error = new Error('replaceToken does not match the active draft for this menu');
                error.statusCode = 400;
                throw error;
            }
            const now = new Date().toISOString();
            let draft;
            try {
                draft = await saveDraftSession({
                    id: crypto.randomUUID(), token: crypto.randomBytes(32).toString('base64url'),
                    base_submission_id: baseId, menu_id: menuId || null, menu_content_html: '',
                    form_state: { previewCollapsed: true, aiCheckHasRun: false }, status: 'active',
                    created_at: now, updated_at: now, submitted_submission_id: null, last_edited_by: '',
                });
            }
            catch (error) {
                // A second service process may win the partial-index race. Treat
                // PostgreSQL's unique violation as a resume, never as a 500.
                if ((0, supabase_client_1.isSupabaseConfigured)() && (error?.message || '').match(/unique|duplicate|23505/i)) {
                    const racedDraft = await findActiveDraft();
                    if (racedDraft)
                        return { draft: racedDraft, resumed: true };
                }
                throw error;
            }
            return { draft, resumed: false };
        });
        return res.status(result.resumed ? 200 : 201).json({
            ...toDraftClientPayload(result.draft, baseline), resumed: result.resumed,
        });
    }
    catch (error) {
        console.error('Error creating draft session:', error.message);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Failed to create draft session' });
    }
});
// Named list route must precede /draft-sessions/:token.
app.get('/draft-sessions', async (req, res) => {
    try {
        const statuses = `${req.query.status || ''}`.split(',').map((value) => value.trim()).filter(Boolean);
        const baseSubmissionIds = `${req.query.baseSubmissionIds || req.query.base_submission_ids || ''}`.split(',').map((value) => value.trim()).filter(Boolean);
        const sinceDays = Number(req.query.sinceDays || 0);
        const since = Number.isFinite(sinceDays) && sinceDays > 0 ? Date.now() - sinceDays * 86400000 : undefined;
        const drafts = await listDraftSessions({ statuses, baseSubmissionIds, since });
        const baselines = await getSubmissionRecordsByIds(drafts.map((draft) => draft.base_submission_id));
        const baselineById = new Map(baselines.map((baseline) => [getPublicSubmissionId(baseline), baseline]));
        return res.json(drafts.map((draft) => {
            const baseline = baselineById.get(draft.base_submission_id);
            return toDraftClientPayload(draft, baseline ? mapApprovedSubmissionForClient(baseline) : null);
        }));
    }
    catch (error) {
        console.error('Error listing draft sessions:', error.message);
        return res.status(500).json({ error: 'Failed to list draft sessions' });
    }
});
app.post('/draft-sessions/:token/discard', async (req, res) => {
    try {
        const draft = await loadDraftByToken(req.params.token);
        if (!draft)
            return res.status(404).json({ error: 'Draft session not found' });
        const current = await expireDraftIfNeeded(draft);
        if (current.status === 'submitted')
            return res.status(409).json({ error: 'Submitted drafts cannot be discarded.', draft: current });
        if (current.status === 'discarded' || current.status === 'expired')
            return res.json(toDraftClientPayload(current, null));
        const discarded = await withActiveDraftMutation(current.base_submission_id, async () => saveDraftSession({ ...current, status: 'discarded', updated_at: new Date().toISOString() }));
        return res.json(toDraftClientPayload(discarded, null));
    }
    catch (error) {
        console.error('Error discarding draft session:', error.message);
        return res.status(500).json({ error: 'Failed to discard draft session' });
    }
});
app.get('/draft-sessions/:token', async (req, res) => {
    try {
        const draft = await loadDraftByToken(req.params.token);
        if (!draft) {
            return res.status(404).json({ error: 'Draft session not found' });
        }
        const currentDraft = await expireDraftIfNeeded(draft);
        const baselineSubmission = await getSubmissionRecordById(currentDraft.base_submission_id);
        const servicePeriod = getSubmissionServicePeriod(baselineSubmission);
        const latest = baselineSubmission
            ? await findLatestApprovedByPropertyService(`${baselineSubmission.property || ''}`, servicePeriod)
            : null;
        const baseline = baselineSubmission
            ? mapApprovedSubmissionForClient(baselineSubmission, latest || baselineSubmission)
            : null;
        res.json(toDraftClientPayload(currentDraft, baseline));
    }
    catch (error) {
        console.error('Error loading draft session:', error.message);
        res.status(500).json({ error: 'Failed to load draft session' });
    }
});
app.put('/draft-sessions/:token', async (req, res) => {
    try {
        const draft = await loadDraftByToken(req.params.token);
        if (!draft) {
            return res.status(404).json({ error: 'Draft session not found' });
        }
        const currentDraft = await expireDraftIfNeeded(draft);
        if (currentDraft.status === 'submitted') {
            return res.status(409).json({
                error: 'This draft has already been submitted.',
                draft: currentDraft,
            });
        }
        if (currentDraft.status === 'expired') {
            return res.status(410).json({
                error: 'This draft has expired. Start a fresh edit from the approved menu.',
                draft: currentDraft,
            });
        }
        const clientUpdatedAt = `${req.body?.updatedAt || req.body?.updated_at || ''}`.trim();
        const serverUpdatedAt = `${currentDraft.updated_at || ''}`.trim();
        if (clientUpdatedAt && serverUpdatedAt && Date.parse(serverUpdatedAt) > Date.parse(clientUpdatedAt)) {
            return res.status(409).json({
                error: 'This draft was updated by someone else — reload to get the latest edits.',
                draft: currentDraft,
            });
        }
        const updated = await saveDraftSession({
            ...currentDraft,
            menu_content_html: `${req.body?.menuContentHtml || req.body?.menu_content_html || currentDraft.menu_content_html || ''}`,
            form_state: req.body?.formState && typeof req.body.formState === 'object'
                ? req.body.formState
                : (req.body?.form_state && typeof req.body.form_state === 'object' ? req.body.form_state : currentDraft.form_state),
            updated_at: new Date().toISOString(),
            last_edited_by: `${req.body?.lastEditedBy || req.body?.last_edited_by || currentDraft.last_edited_by || ''}`.trim().slice(0, 160),
        });
        res.json(toDraftClientPayload(updated, null));
    }
    catch (error) {
        console.error('Error saving draft session:', error.message);
        res.status(500).json({ error: 'Failed to save draft session' });
    }
});
app.post('/draft-sessions/:token/submit', async (req, res) => {
    try {
        const draft = await loadDraftByToken(req.params.token);
        if (!draft) {
            return res.status(404).json({ error: 'Draft session not found' });
        }
        const currentDraft = await expireDraftIfNeeded(draft);
        if (currentDraft.status === 'submitted') {
            return res.status(409).json({
                error: 'This draft has already been submitted.',
                draft: currentDraft,
            });
        }
        if (currentDraft.status === 'expired') {
            return res.status(410).json({
                error: 'This draft has expired. Start a fresh edit from the approved menu.',
                draft: currentDraft,
            });
        }
        const submittedSubmissionId = `${req.body?.submittedSubmissionId || req.body?.submitted_submission_id || ''}`.trim();
        if (!submittedSubmissionId) {
            return res.status(400).json({ error: 'submittedSubmissionId is required' });
        }
        const updated = await saveDraftSession({
            ...currentDraft,
            status: 'submitted',
            submitted_submission_id: submittedSubmissionId,
            updated_at: new Date().toISOString(),
        });
        res.json(toDraftClientPayload(updated, null));
    }
    catch (error) {
        console.error('Error locking submitted draft session:', error.message);
        res.status(500).json({ error: 'Failed to lock draft session' });
    }
});
// ---------------------------------------------------------------------------
// Menu entity routes (Phase 1). Named list route must precede /menus/:id.
// ---------------------------------------------------------------------------
app.get('/menus', async (req, res) => {
    try {
        const menus = await findMenus({
            property: `${req.query.property || ''}`.trim() || undefined,
            servicePeriod: `${req.query.servicePeriod || req.query.service_period || ''}`.trim() || undefined,
            status: `${req.query.status || ''}`.trim() || undefined,
        });
        res.json({ menus });
    }
    catch (error) {
        console.error('Error listing menus:', error.message);
        res.status(500).json({ error: 'Failed to list menus' });
    }
});
app.post('/menus', async (req, res) => {
    try {
        const menu = await saveMenu({
            id: req.body?.id,
            property: `${req.body?.property || ''}`.trim(),
            service_period: `${req.body?.servicePeriod || req.body?.service_period || ''}`.trim(),
            name: `${req.body?.name || ''}`.trim(),
            current_submission_id: req.body?.currentSubmissionId || req.body?.current_submission_id || null,
            status: req.body?.status,
        });
        res.status(201).json({ menu });
    }
    catch (error) {
        console.error('Error saving menu:', error.message);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Failed to save menu' });
    }
});
// Resolve whether a brand-new submission collides with existing active menus
// (same property + service period + normalized name). Named route before
// /menus/:id. Used by the reviewer approval flow to decide silent-create vs
// "new version or separate menu?" prompt.
app.get('/menus/resolve', async (req, res) => {
    try {
        const property = `${req.query.property || ''}`.trim();
        const servicePeriod = `${req.query.servicePeriod || req.query.service_period || ''}`.trim();
        const name = `${req.query.name || ''}`.trim();
        if (!property || !servicePeriod || !name) {
            return res.status(400).json({ error: 'property, servicePeriod, and name are required' });
        }
        const nameKey = normalizeApprovedLookupValue(name);
        const candidates = (await findMenus({ property, servicePeriod, status: 'active' }))
            .filter((menu) => normalizeApprovedLookupValue(menu.name) === nameKey);
        res.json({ collision: candidates.length > 0, candidates });
    }
    catch (error) {
        console.error('Error resolving menu:', error.message);
        res.status(500).json({ error: 'Failed to resolve menu' });
    }
});
app.get('/menus/:id', async (req, res) => {
    try {
        const menu = await getMenuById(req.params.id);
        if (!menu)
            return res.status(404).json({ error: 'Menu not found' });
        res.json({ menu });
    }
    catch (error) {
        console.error('Error loading menu:', error.message);
        res.status(500).json({ error: 'Failed to load menu' });
    }
});
// Approver dispute token routes (Identity Stage 2). Named — before /submissions/:id.
app.get('/submissions/dispute/:token', async (req, res) => {
    try {
        const submission = await findSubmissionByDisputeToken(req.params.token);
        if (!submission)
            return res.status(404).json({ error: 'Dispute link not found' });
        return res.json({
            submissionId: getPublicSubmissionId(submission),
            projectName: submission.project_name || '',
            property: submission.property || '',
            servicePeriod: getSubmissionServicePeriod(submission),
            disputed: !!submission.approver_disputed_at,
            disputedAt: submission.approver_disputed_at || null,
            disputeNote: submission.approver_dispute_note || '',
        });
    }
    catch (error) {
        console.error('Error loading dispute:', error.message);
        return res.status(500).json({ error: 'Failed to load dispute' });
    }
});
app.post('/submissions/dispute/:token', async (req, res) => {
    try {
        const submission = await findSubmissionByDisputeToken(req.params.token);
        if (!submission)
            return res.status(404).json({ error: 'Dispute link not found' });
        const publicId = getPublicSubmissionId(submission);
        const summary = {
            submissionId: publicId,
            projectName: submission.project_name || '',
            property: submission.property || '',
            servicePeriod: getSubmissionServicePeriod(submission),
        };
        // Idempotent: a re-visit after recording just echoes the stored state.
        if (submission.approver_disputed_at) {
            return res.json({ ...summary, disputed: true, disputedAt: submission.approver_disputed_at, alreadyRecorded: true });
        }
        const note = `${req.body?.note || ''}`.trim().slice(0, 500);
        const disputedAt = new Date().toISOString();
        const updates = { approver_disputed_at: disputedAt, approver_dispute_note: note || null };
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const localKey = Object.keys(submissions).find((key) => getPublicSubmissionId(submissions[key]) === publicId);
        if (localKey) {
            submissions[localKey] = { ...submissions[localKey], ...updates, updated_at: disputedAt };
            await fs_1.promises.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        }
        try {
            await mirrorSubmissionUpdateToSupabase(publicId, updates);
        }
        catch (mirrorError) {
            console.error('Dispute mirror failed (kept local write):', mirrorError.message);
        }
        return res.json({ ...summary, disputed: true, disputedAt });
    }
    catch (error) {
        console.error('Error recording dispute:', error.message);
        return res.status(500).json({ error: 'Failed to record dispute' });
    }
});
// Named submission routes must remain before /submissions/:id.
app.get('/submissions/lineage-children', async (req, res) => {
    try {
        const ids = `${req.query.ids || req.query.submissionIds || ''}`.split(',').map((id) => id.trim()).filter(Boolean);
        const childrenByParent = await findApprovedChildren(ids);
        const payload = {};
        for (const [parentId, children] of Object.entries(childrenByParent)) {
            payload[parentId] = {
                supersededBy: children.length ? toSupersededBy(children[0]) : null,
                approvedChildren: children.map(toSupersededBy),
            };
        }
        return res.json(payload);
    }
    catch (error) {
        console.error('Error finding lineage children:', error.message);
        return res.status(500).json({ error: 'Failed to find lineage children' });
    }
});
app.post('/submissions/baseline-match', async (req, res) => {
    try {
        const extractedText = `${req.body?.extractedText || req.body?.extracted_text || ''}`;
        const property = `${req.body?.property || ''}`.trim();
        const servicePeriod = `${req.body?.servicePeriod || req.body?.service_period || ''}`.trim();
        if (!extractedText.trim() || !property)
            return res.status(400).json({ error: 'extractedText and property are required' });
        const match = await findBaselineMatch(extractedText, property, servicePeriod);
        return res.json({ match: match ? {
                id: getPublicSubmissionId(match), projectName: match.project_name || '',
                servicePeriod: getSubmissionServicePeriod(match), approvedAt: match.reviewed_at || match.updated_at || match.created_at || '',
            } : null });
    }
    catch (error) {
        console.error('Error matching uploaded baseline:', error.message);
        return res.status(500).json({ error: 'Failed to match uploaded baseline' });
    }
});
// Endpoint to create a new submission
app.post('/submissions', async (req, res) => {
    try {
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const newId = req.body.id || `sub_${Date.now()}`;
        const newSubmission = {
            ...req.body,
            id: newId,
            status: req.body.status || 'processing',
            // Per-submission approver dispute token (Identity Stage 2), minted
            // once at creation like draft tokens. Never regenerated.
            approver_dispute_token: req.body.approver_dispute_token || crypto.randomBytes(32).toString('base64url').slice(0, 64),
            created_at: req.body.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        // Phase 2 menu resolution — guided paths inherit their menu from the
        // baseline they revise (draft submit, DB-baseline mod, doc-upload confirm
        // all carry revision_base_submission_id here). Brand-new submissions get
        // their menu resolved at approval time, not now (rejected submissions
        // must never create menus).
        if (!newSubmission.menu_id && newSubmission.revision_base_submission_id) {
            try {
                const baseline = await getSubmissionRecordById(`${newSubmission.revision_base_submission_id}`);
                if (baseline?.menu_id)
                    newSubmission.menu_id = baseline.menu_id;
            }
            catch (baselineError) {
                console.warn(`Could not inherit menu_id from baseline for ${newId}:`, baselineError.message);
            }
        }
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
                .in('status', REVIEW_QUEUE_STATUSES)
                .order('created_at', { ascending: false });
            if (error) {
                throw new Error(error.message);
            }
            const pending = (data || []).filter((submission) => !isIsabellaDirectHandoff(submission));
            return res.status(200).json(pending);
        }
        const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
        const pending = Object.values(submissions).filter((sub) => REVIEW_QUEUE_STATUSES.includes(sub.status)).filter((submission) => !isIsabellaDirectHandoff(submission))
            .sort((a, b) => {
            const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
            const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
            return bTime - aTime;
        });
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
// List approved submissions for post-approval download dashboard.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/approved-list', async (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);
        const approvedStatuses = new Set(APPROVED_SUBMISSION_STATUSES);
        let sourceRows = [];
        let approvedAssetRows = [];
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            let query = supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .in('status', Array.from(approvedStatuses))
                .not('final_path', 'is', null)
                .order('reviewed_at', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(limit);
            if (q) {
                const like = `%${q}%`;
                query = query.or(`project_name.ilike.${like},property.ilike.${like},filename.ilike.${like},submitter_name.ilike.${like},service_period.ilike.${like}`);
            }
            const { data, error } = await query;
            if (error) {
                throw new Error(error.message);
            }
            sourceRows = (data || []).filter(isApprovedBaselineSource);
            const submissionIds = sourceRows
                .map((row) => `${row.id || row.legacy_id || ''}`.trim())
                .filter(Boolean);
            if (submissionIds.length > 0) {
                const { data: assetData, error: assetError } = await supabase
                    .from(ASSETS_TABLE)
                    .select('*')
                    .eq('asset_type', 'approved_docx')
                    .in('submission_id', submissionIds)
                    .order('created_at', { ascending: false });
                if (assetError) {
                    console.warn('Failed to fetch approved_docx assets for approved-list:', assetError.message);
                }
                else {
                    approvedAssetRows = assetData || [];
                }
            }
        }
        else {
            const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
            sourceRows = Object.values(submissions)
                .filter((s) => approvedStatuses.has((s.status || '').toLowerCase()))
                .filter((s) => !!s.final_path)
                .filter(isApprovedBaselineSource)
                .filter((s) => {
                if (!q)
                    return true;
                const haystack = [
                    s.project_name,
                    s.property,
                    s.filename,
                    s.submitter_name,
                    s.service_period,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(q);
            })
                .sort((a, b) => new Date(b.reviewed_at || b.updated_at || b.created_at).getTime() - new Date(a.reviewed_at || a.updated_at || a.created_at).getTime())
                .slice(0, limit);
            const assets = JSON.parse(await fs_1.promises.readFile(ASSETS_DB, 'utf-8'));
            approvedAssetRows = assets
                .filter((asset) => asset.asset_type === 'approved_docx')
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        }
        const approvedAssetBySubmission = new Map();
        for (const asset of approvedAssetRows) {
            const key = `${asset.submission_id || ''}`.trim();
            if (key && !approvedAssetBySubmission.has(key)) {
                approvedAssetBySubmission.set(key, asset);
            }
        }
        const results = sourceRows.map((s) => {
            const submissionKey = `${s.id || s.legacy_id || ''}`.trim();
            const approvedAsset = approvedAssetBySubmission.get(submissionKey);
            return {
                id: s.legacy_id || s.id,
                projectName: s.project_name || '',
                property: s.property || '',
                filename: s.filename || '',
                approvedFileName: approvedAsset?.file_name || s.filename || `${s.project_name || 'approved-menu'}.docx`,
                finalPath: s.final_path || '',
                status: s.status || '',
                servicePeriod: s.service_period || s.raw_payload?.servicePeriod || '',
                dateNeeded: s.date_needed || '',
                reviewedAt: s.reviewed_at || s.updated_at || s.created_at || '',
                submitterName: s.submitter_name || '',
                submitterEmail: s.submitter_email || '',
            };
        });
        res.json(results);
    }
    catch (error) {
        console.error('Error listing approved submissions:', error);
        res.status(500).json([]);
    }
});
// Search approved submissions for "modification" flow.
// Query can match project/property/submitter and returns newest first.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        const normalizedQuery = normalizeSearchValue(q);
        const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
        const preferredProperty = `${req.query.property || ''}`.trim();
        const preferredServicePeriod = `${req.query.servicePeriod || ''}`.trim();
        if (normalizedQuery.length < 2) {
            return res.json([]);
        }
        let sourceRows = [];
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const rowsById = new Map();
            const addRows = (rows = []) => {
                rows.forEach((row) => {
                    const key = `${row?.id || row?.legacy_id || JSON.stringify(row)}`;
                    if (!rowsById.has(key)) {
                        rowsById.set(key, row);
                    }
                });
            };
            const like = `%${q}%`;
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .in('status', APPROVED_SUBMISSION_STATUSES)
                .not('final_path', 'is', null)
                .or(`project_name.ilike.${like},property.ilike.${like},service_period.ilike.${like},filename.ilike.${like},submitter_name.ilike.${like},submitter_email.ilike.${like},hotel_name.ilike.${like},city_country.ilike.${like}`)
                .order('reviewed_at', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(limit);
            if (error) {
                throw new Error(error.message);
            }
            addRows(data || []);
            const { data: recentData, error: recentError } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .in('status', APPROVED_SUBMISSION_STATUSES)
                .not('final_path', 'is', null)
                .order('reviewed_at', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(500);
            if (recentError) {
                throw new Error(recentError.message);
            }
            addRows(recentData || []);
            sourceRows = Array.from(rowsById.values())
                .filter((s) => searchFieldsInclude([
                s.project_name,
                s.property,
                s.service_period,
                s.filename,
                s.submitter_name,
                s.submitter_email,
                s.hotel_name,
                s.city_country,
            ], q))
                .slice(0, limit);
        }
        else {
            const submissions = JSON.parse(await fs_1.promises.readFile(SUBMISSIONS_DB, 'utf-8'));
            const approvedStatuses = new Set(APPROVED_SUBMISSION_STATUSES);
            sourceRows = Object.values(submissions)
                .filter((s) => approvedStatuses.has((s.status || '').toLowerCase()))
                .filter((s) => !!s.final_path)
                .filter((s) => searchFieldsInclude([
                s.project_name,
                s.property,
                s.service_period,
                s.filename,
                s.submitter_name,
                s.submitter_email,
                s.hotel_name,
                s.city_country,
            ], q))
                .sort((a, b) => getApprovedTimestamp(b) - getApprovedTimestamp(a))
                .slice(0, limit);
        }
        const preferredPropertyKey = normalizeApprovedLookupValue(preferredProperty);
        const preferredServiceKey = normalizeApprovedLookupValue(preferredServicePeriod);
        sourceRows = sourceRows.sort((a, b) => {
            const aExact = preferredPropertyKey && preferredServiceKey &&
                normalizeApprovedLookupValue(a.property) === preferredPropertyKey &&
                normalizeApprovedLookupValue(getSubmissionServicePeriod(a)) === preferredServiceKey;
            const bExact = preferredPropertyKey && preferredServiceKey &&
                normalizeApprovedLookupValue(b.property) === preferredPropertyKey &&
                normalizeApprovedLookupValue(getSubmissionServicePeriod(b)) === preferredServiceKey;
            if (aExact !== bExact) {
                return aExact ? -1 : 1;
            }
            return getApprovedTimestamp(b) - getApprovedTimestamp(a);
        });
        const latestCache = new Map();
        const results = await Promise.all(sourceRows.map(async (s) => {
            const property = `${s.property || ''}`.trim();
            const servicePeriod = getSubmissionServicePeriod(s);
            const cacheKey = `${normalizeApprovedLookupValue(property)}|${normalizeApprovedLookupValue(servicePeriod)}`;
            let latest = latestCache.get(cacheKey);
            if (!latestCache.has(cacheKey)) {
                latest = await findLatestApprovedByPropertyService(property, servicePeriod);
                latestCache.set(cacheKey, latest);
            }
            return mapApprovedSubmissionForClient(s, latest);
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
// Latest approved submission for a property/service pair. Falls back to the
// legacy project/property lookup when servicePeriod is not provided.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/latest-approved', async (req, res) => {
    try {
        const projectName = (req.query.projectName || '').trim();
        const property = (req.query.property || '').trim();
        const servicePeriod = (req.query.servicePeriod || '').trim();
        if (!property || (!servicePeriod && !projectName)) {
            return res.status(400).json({ error: 'property and servicePeriod are required' });
        }
        const match = servicePeriod
            ? await findLatestApprovedByPropertyService(property, servicePeriod)
            : await findLatestApprovedByProjectProperty(projectName, property);
        if (!match) {
            return res.status(404).json({ error: 'No approved submission found' });
        }
        res.json(mapApprovedSubmissionForClient(match, match));
    }
    catch (error) {
        console.error('Error finding latest approved submission:', error);
        res.status(500).json({ error: 'Failed to find approved submission' });
    }
});
// Submitter profile search
app.get('/submitter-profiles/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        const normalizedQuery = normalizeSearchValue(q);
        if (normalizedQuery.length < 2) {
            return res.json([]);
        }
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            const supabase = (0, supabase_client_1.getSupabaseClient)();
            const profilesByKey = new Map();
            const addProfiles = (profiles = []) => {
                profiles.forEach((profile) => {
                    const key = `${profile?.email || profile?.id || profile?.name || JSON.stringify(profile)}`.toLowerCase();
                    if (!profilesByKey.has(key)) {
                        profilesByKey.set(key, profile);
                    }
                });
            };
            const like = `%${q}%`;
            const { data, error } = await supabase
                .from(SUBMITTER_PROFILES_TABLE)
                .select('*')
                .ilike('name', like)
                .order('last_used', { ascending: false })
                .limit(8);
            if (!error && data) {
                addProfiles(data || []);
                const { data: recentData, error: recentError } = await supabase
                    .from(SUBMITTER_PROFILES_TABLE)
                    .select('*')
                    .order('last_used', { ascending: false })
                    .limit(200);
                if (!recentError && recentData) {
                    addProfiles(recentData);
                }
                return res.json(Array.from(profilesByKey.values())
                    .filter((p) => searchFieldsInclude([p.name], q))
                    .slice(0, 8)
                    .map((p) => ({
                    name: p.name || '',
                    email: p.email || '',
                    jobTitle: p.job_title || '',
                    lastUsed: p.last_used || p.updated_at || p.created_at,
                })));
            }
        }
        const profiles = JSON.parse(await fs_1.promises.readFile(PROFILES_DB, 'utf-8'));
        const matches = Object.values(profiles)
            .filter((p) => searchFieldsInclude([p.name], q))
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
const DISH_QUALITY_AI_BATCH_SIZE = 100;
const DISH_QUALITY_AI_REVIEW_CODES = new Set([
    'beverage_heading_as_name',
    'beverage_name_description_swap',
    'category_as_name',
    'description_contains_allergen_cluster',
    'modifier_row_name',
    'name_equals_category',
]);
function shouldReviewPreparedDishWithAi(dish) {
    if (dish.excludedByRule || dish.quality.disposition !== 'review') {
        return false;
    }
    return dish.quality.issues.some((issue) => DISH_QUALITY_AI_REVIEW_CODES.has(issue.code));
}
function buildApprovedDishAiRows(candidates) {
    return candidates.map((dish) => ({
        index: dish.index,
        dishName: dish.input.dish_name,
        description: dish.input.description,
        category: dish.input.menu_category,
        servicePeriod: dish.input.service_period,
        price: dish.input.price,
        allergens: dish.input.allergens || [],
        qualityIssues: dish.quality.issues,
        sourceContext: dish.sourceContext,
    }));
}
async function reviewPreparedDishesWithAi(input) {
    const candidates = input.prepared.filter(shouldReviewPreparedDishWithAi);
    if (candidates.length === 0) {
        return {
            attempted: false,
            reviewed: 0,
            excludedIndexes: new Set(),
            results: [],
        };
    }
    try {
        const results = [];
        for (let start = 0; start < candidates.length; start += DISH_QUALITY_AI_BATCH_SIZE) {
            const batch = candidates.slice(start, start + DISH_QUALITY_AI_BATCH_SIZE);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), Number.isFinite(DISH_QUALITY_AI_TIMEOUT_MS) && DISH_QUALITY_AI_TIMEOUT_MS > 0
                ? DISH_QUALITY_AI_TIMEOUT_MS
                : 20000);
            try {
                const response = await fetch(`${AI_REVIEW_URL}/approved-dishes/quality-check`, {
                    method: 'POST',
                    headers: (0, internal_auth_1.buildInternalServiceHeaders)({
                        'content-type': 'application/json',
                    }),
                    body: JSON.stringify({
                        property: input.property,
                        servicePeriod: input.servicePeriod,
                        submissionId: input.submissionId,
                        rows: buildApprovedDishAiRows(batch),
                    }),
                    signal: controller.signal,
                });
                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    throw new Error(`AI quality check failed with ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
                }
                const payload = await response.json();
                results.push(...(Array.isArray(payload.results) ? payload.results : []));
            }
            finally {
                clearTimeout(timeout);
            }
        }
        const excludedIndexes = new Set();
        for (const result of results) {
            if (result.verdict === 'not_dish' && result.confidence === 'high') {
                excludedIndexes.add(result.index);
            }
        }
        return {
            attempted: true,
            reviewed: candidates.length,
            excludedIndexes,
            results,
        };
    }
    catch (error) {
        return {
            attempted: true,
            reviewed: candidates.length,
            excludedIndexes: new Set(),
            results: [],
            error: error?.name === 'AbortError' ? 'AI quality check timed out' : error.message,
        };
    }
}
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
        const prepared = (0, supabase_client_1.prepareApprovedDishInputs)(approvedMenuContent, property, resolvedSubmissionId, {
            servicePeriod,
        });
        const aiReview = await reviewPreparedDishesWithAi({
            prepared,
            property,
            servicePeriod,
            submissionId: resolvedSubmissionId,
        });
        const result = await (0, supabase_client_1.storePreparedApprovedDishes)(prepared, resolvedSubmissionId, {
            replaceExisting: true,
            excludeIndexes: aiReview.excludedIndexes,
        });
        res.json({
            success: true,
            submissionId: resolvedSubmissionId,
            added: result.added,
            extracted: result.extracted,
            skipped: result.skipped,
            quality: {
                review_count: result.qualityReviewCount,
                excluded_by_rule_count: result.excludedByRuleCount,
                excluded_by_ai_count: aiReview.excludedIndexes.size,
                ai_attempted: aiReview.attempted,
                ai_reviewed: aiReview.reviewed,
                ai_error: aiReview.error,
            },
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
        // menu_decision is an approval-time control input (reviewer's "new version
        // vs separate menu?" answer), not a submission column — pull it out before
        // sanitizing so it isn't rejected as an unknown field.
        const { menu_decision, menuDecision: menuDecisionCamel, ...updateBody } = req.body || {};
        const menuDecision = menu_decision ?? menuDecisionCamel;
        const { allowedFields, rejectedFields, errors } = (0, submission_updates_1.sanitizeSubmissionUpdates)(updateBody, {
            repoRoot: getRepoRoot(),
            documentStorageRoot: process.env.DOCUMENT_STORAGE_ROOT,
        });
        if (rejectedFields.length > 0 || errors.length > 0) {
            return res.status(400).json({
                error: 'Invalid submission update payload',
                rejectedFields,
                details: errors,
            });
        }
        if (Object.keys(allowedFields).length === 0) {
            return res.status(400).json({ error: 'No valid submission fields to update' });
        }
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
                    const currentRemote = await getSubmissionRecordById(id);
                    await injectResolvedMenuIdIfApproving(currentRemote, allowedFields, menuDecision);
                    await mirrorSubmissionUpdateToSupabase(id, allowedFields);
                    const supabase = (0, supabase_client_1.getSupabaseClient)();
                    const idColumn = UUID_REGEX.test(id) ? 'id' : 'legacy_id';
                    const { data } = await supabase
                        .from(SUBMISSIONS_TABLE)
                        .select('*')
                        .eq(idColumn, id)
                        .maybeSingle();
                    if (data && shouldReconcileMenuPointer(allowedFields)) {
                        try {
                            await reconcileMenuPointerOnApproval(data);
                        }
                        catch (menuError) {
                            console.error('Menu pointer reconcile failed (approval kept):', menuError.message);
                        }
                    }
                    return res.status(200).json(data || { id, ...allowedFields, updated_at: new Date().toISOString() });
                }
                catch (supabaseError) {
                    console.error('Supabase-only submission update failed:', supabaseError.message);
                }
            }
            return res.status(404).send('Submission not found.');
        }
        await injectResolvedMenuIdIfApproving(submissions[resolvedId], allowedFields, menuDecision);
        const updatedSubmission = { ...submissions[resolvedId], ...allowedFields, updated_at: new Date().toISOString() };
        submissions[resolvedId] = updatedSubmission;
        await fs_1.promises.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));
        try {
            await mirrorSubmissionUpdateToSupabase(id, allowedFields);
        }
        catch (supabaseError) {
            console.error('Supabase mirror update failed (kept local JSON write):', supabaseError.message);
        }
        if (shouldReconcileMenuPointer(allowedFields)) {
            try {
                await reconcileMenuPointerOnApproval(updatedSubmission);
            }
            catch (menuError) {
                console.error('Menu pointer reconcile failed (approval kept):', menuError.message);
            }
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
        const record = req.body || {};
        const storageRecord = buildCorrectionRuleStorageRecord(record);
        if (!storageRecord) {
            if (record.submission_id
                && record.correction_id
                && record.rule
                && !normalizeCorrectionRuleMenuScope(record.applies_to_menu_type)) {
                return res.status(400).json({ error: 'applies_to_menu_type must be all, food, or beverage' });
            }
            return res.status(400).json({ error: 'submission_id, correction_id, and rule are required' });
        }
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            try {
                const supabase = (0, supabase_client_1.getSupabaseClient)();
                let insertRecord = storageRecord;
                let { data, error } = await supabase
                    .from(CORRECTION_RULES_TABLE)
                    .insert(insertRecord)
                    .select()
                    .single();
                // Degrade gracefully if the C4a/C4b columns are not yet migrated: strip them
                // and retry so the rule still lands in Supabase (where the cycle can see it)
                // rather than being stranded in the local JSON fallback.
                if (error && /(example_original|example_corrected|inferred_from_guidance)/i.test(error.message || '')) {
                    console.warn(`correction_rules example/inferred columns unavailable; storing without. Apply supabase/migrations/20260711_add_correction_rule_examples.sql. (${error.message})`);
                    const { example_original: _eo, example_corrected: _ec, inferred_from_guidance: _ig, ...fallback } = insertRecord;
                    insertRecord = fallback;
                    ({ data, error } = await supabase
                        .from(CORRECTION_RULES_TABLE)
                        .insert(insertRecord)
                        .select()
                        .single());
                }
                if (error) {
                    throw new Error(error.message);
                }
                return res.status(201).json(data);
            }
            catch (error) {
                console.error('Supabase correction rule insert failed, falling back local:', error.message);
                // The rule is kept in the local JSON fallback, which the improvement
                // cycle cannot see (it reads Supabase directly). This is silent data
                // loss from the cycle's perspective, so raise a visible alert rather
                // than only logging — a stale NOT NULL / missing column / RLS change
                // otherwise strands reviewer rules for weeks (see the July 2026
                // freeform-rule incident).
                (0, supabase_client_1.logAlert)({
                    alert_type: 'correction_rule_mirror_failed',
                    severity: 'error',
                    service: 'db',
                    message: `Supabase correction rule insert failed for ${storageRecord.submission_id}/${storageRecord.correction_id}; kept only in the local JSON fallback, which the improvement cycle cannot see.`,
                    details: {
                        submission_id: storageRecord.submission_id,
                        correction_id: storageRecord.correction_id,
                        error: error.message,
                    },
                });
            }
        }
        const localRecord = await createLocalCorrectionRule(storageRecord);
        res.status(201).json(localRecord);
    }
    catch (error) {
        console.error('Error creating correction rule:', error.message);
        res.status(500).json({ error: 'Failed to create correction rule' });
    }
});
app.get('/correction-rules', async (req, res) => {
    try {
        const localRules = filterCorrectionRules(await readLocalCorrectionRules(), req.query);
        let supabaseRules = [];
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            try {
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
                supabaseRules = data || [];
            }
            catch (error) {
                console.error('Supabase correction rule fetch failed, falling back local:', error.message);
            }
        }
        const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
        res.json(mergeCorrectionRules(supabaseRules, localRules).slice(0, limit));
    }
    catch (error) {
        console.error('Error fetching correction rules:', error.message);
        res.status(500).json([]);
    }
});
// IMPORTANT: Must come BEFORE any /:id route in correction-rules
app.get('/correction-rules/pending', async (req, res) => {
    try {
        const localRules = filterCorrectionRules(await readLocalCorrectionRules(), { ...req.query, status: 'pending' });
        let supabaseRules = [];
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            try {
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
                supabaseRules = data || [];
            }
            catch (error) {
                console.error('Supabase pending correction rule fetch failed, falling back local:', error.message);
            }
        }
        res.json(mergeCorrectionRules(supabaseRules, localRules).slice(0, 100));
    }
    catch (error) {
        console.error('Error fetching pending correction rules:', error.message);
        res.status(500).json([]);
    }
});
app.put('/correction-rules/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body || {};
        let allowedFields;
        try {
            allowedFields = buildCorrectionRuleUpdateFields(updates);
        }
        catch (error) {
            return res.status(400).json({ error: error.message });
        }
        if (Object.keys(allowedFields).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        allowedFields.updated_at = new Date().toISOString();
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            try {
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
                return res.json(data);
            }
            catch (error) {
                console.error('Supabase correction rule update failed, falling back local:', error.message);
            }
        }
        const localRule = await updateLocalCorrectionRule(id, allowedFields);
        if (!localRule) {
            return res.status(404).json({ error: 'Correction rule not found' });
        }
        res.json(localRule);
    }
    catch (error) {
        console.error('Error updating correction rule:', error.message);
        res.status(500).json({ error: 'Failed to update correction rule' });
    }
});
// Un-consume corrections that were stamped by a prompt proposal cycle on rejection.
// Never un-consumes the synthetic output rows (submission_id 'proposal-%') created on approval.
app.post('/correction-rules/unconsume-for-cycle', async (req, res) => {
    try {
        const { cycle_id } = req.body || {};
        if (!cycle_id)
            return res.status(400).json({ error: 'cycle_id is required' });
        const updates = { prompt_cycle_id: null, consumed_at: null, updated_at: new Date().toISOString() };
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            try {
                const supabase = (0, supabase_client_1.getSupabaseClient)();
                const { data, error } = await supabase
                    .from(CORRECTION_RULES_TABLE)
                    .update(updates)
                    .eq('prompt_cycle_id', cycle_id)
                    .not('submission_id', 'like', 'proposal-%')
                    .select('id');
                if (error)
                    throw new Error(error.message);
                return res.json({ ok: true, reset: (data || []).length });
            }
            catch (e) {
                console.warn('Supabase unconsume failed, trying local fallback:', e.message);
            }
        }
        // Local JSON fallback
        const all = JSON.parse(await fs_1.promises.readFile(CORRECTION_RULES_DB, 'utf8'));
        let count = 0;
        const now = updates.updated_at;
        for (const r of all) {
            if (r.prompt_cycle_id === cycle_id && !String(r.submission_id || '').startsWith('proposal-')) {
                r.prompt_cycle_id = null;
                r.consumed_at = null;
                r.updated_at = now;
                count += 1;
            }
        }
        await fs_1.promises.writeFile(CORRECTION_RULES_DB, JSON.stringify(all, null, 2));
        res.json({ ok: true, reset: count });
    }
    catch (error) {
        console.error('Error unconsuming corrections for cycle:', error.message);
        res.status(500).json({ error: 'Failed to unconsume corrections' });
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
            .eq('status', 'pending')
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
            .select('id, cycle_id, status, correction_rule_count, submission_count, date_range_start, date_range_end, llm_model, reviewer_name, reviewed_at, created_at, eval_status, superseded_by_cycle_id')
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
        const editable = ['status', 'reviewer_name', 'reviewer_notes', 'final_prompt', 'reviewed_at', 'accepted_rules'];
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
// Critical Supabase columns whose absence silently routes writes to the local
// JSON fallback (invisible to the improvement cycle, which reads Supabase). A
// missing column here means a migration was not applied — surface it loudly
// instead of losing reviewer data. Update when a migration adds load-bearing columns.
const CRITICAL_SUPABASE_SCHEMA = {
    correction_rules: ['applies_to_menu_type', 'prompt_cycle_id', 'consumed_at', 'submission_ids', 'example_original', 'example_corrected', 'inferred_from_guidance'],
    submissions: ['form_attempt_id', 'approved_menu_content', 'approved_menu_content_html', 'menu_id', 'approver_dispute_token', 'approver_disputed_at', 'approver_dispute_note'],
    menus: ['property', 'service_period', 'name', 'current_submission_id', 'status'],
    draft_sessions: ['token', 'base_submission_id', 'form_state', 'status', 'submitted_submission_id', 'last_edited_by', 'menu_id'],
    form_attempt_logs: ['draft_session_id'],
    basic_ai_check_audits: ['menu_content_raw', 'submission_id'],
    prompt_proposals: ['proposed_rules', 'eval_status', 'accepted_rules', 'source', 'llm_warnings', 'replay_evidence', 'unresolved_still_missed', 'coverage_claims', 'prompt_length', 'superseded_by_cycle_id', 'superseded_from_cycle_id', 'supersede_carried_correction_count', 'supersede_new_correction_count', 'disposition', 'correction_routing'],
};
// Columns that MUST be nullable (shared NULLABLE_COLUMNS). A stale NOT NULL
// constraint here silently routes writes to the local JSON fallback exactly like a
// missing column would — but the `select` probe above cannot detect it, because
// SELECT succeeds regardless of nullability. This is the July 2026 incident:
// freeform correction rules (no before/after text) have null original_text/
// corrected_text and bounced off a NOT NULL constraint that migration 20260607
// should have dropped, stranding weeks of reviewer rules in the fallback.
// PostgREST's OpenAPI (Swagger 2.0) spec lists every NOT-NULL-without-default
// column of a table in that table's `required` array. Fetching it is fully
// read-only, so we can detect a stale NOT NULL constraint without writing a probe
// row. Returns null (skip, no false alarm) if the spec is unavailable or shaped
// unexpectedly.
async function fetchRequiredColumns(table) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY
        || process.env.SUPABASE_ANON_KEY;
    if (!url || !key)
        return null;
    try {
        const resp = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (!resp.ok)
            return null;
        const spec = await resp.json();
        const def = spec?.definitions?.[table] || spec?.components?.schemas?.[table];
        if (!def || !Array.isArray(def.required))
            return null;
        return def.required.filter((c) => typeof c === 'string');
    }
    catch {
        return null;
    }
}
async function verifyCriticalSupabaseSchema() {
    try {
        if (!(0, supabase_client_1.isSupabaseConfigured)())
            return;
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        for (const [table, columns] of Object.entries(CRITICAL_SUPABASE_SCHEMA)) {
            const { error } = await supabase.from(table).select(columns.join(',')).limit(1);
            if (error) {
                const message = `Supabase schema drift on ${table}: ${error.message}. Apply the pending migration in supabase/migrations — until then writes fall to local JSON and are invisible to the improvement cycle.`;
                console.error(`SCHEMA DRIFT: ${message}`);
                (0, supabase_client_1.logAlert)({
                    alert_type: 'supabase_schema_drift',
                    severity: 'error',
                    service: 'db',
                    message,
                    details: { table, expectedColumns: columns, error: error.message },
                });
            }
        }
        for (const [table, mustBeNullable] of Object.entries(schema_drift_1.NULLABLE_COLUMNS)) {
            const required = await fetchRequiredColumns(table);
            if (!required)
                continue; // spec unavailable — degrade to the runtime insert alert
            const drifted = (0, schema_drift_1.detectNotNullDrift)(required, mustBeNullable);
            if (drifted.length > 0) {
                const message = `Supabase schema drift on ${table}: column(s) ${drifted.join(', ')} still carry a NOT NULL constraint that should have been dropped. Freeform correction rules (no before/after text) fail to insert and fall to local JSON, invisible to the improvement cycle. Apply supabase/migrations/20260710_drop_correction_rule_text_not_null.sql.`;
                console.error(`SCHEMA DRIFT: ${message}`);
                (0, supabase_client_1.logAlert)({
                    alert_type: 'supabase_schema_drift',
                    severity: 'error',
                    service: 'db',
                    message,
                    details: { table, nonNullableColumns: drifted },
                });
            }
        }
    }
    catch (error) {
        console.error('Supabase schema verification failed:', error.message);
    }
}
if (require.main === module) {
    app.listen(port, () => {
        console.log(`db service listening at http://localhost:${port}`);
        if ((0, supabase_client_1.isSupabaseConfigured)()) {
            console.log('Supabase mirror: enabled');
        }
        else {
            console.log('Supabase mirror: disabled (missing SUPABASE_URL/SUPABASE_*_KEY)');
        }
        initDb();
        void verifyCriticalSupabaseSchema();
    });
}
exports.default = app;

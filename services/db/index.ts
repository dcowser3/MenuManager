import express = require('express');
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import dotenv = require('dotenv');
import { getSupabaseClient, isSupabaseConfigured, logAlert, extractAndStoreDishes } from '@menumanager/supabase-client';
import { sanitizeSubmissionUpdates } from './lib/submission-updates';
import { requireInternalServiceAuth } from '@menumanager/internal-auth';

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const app = express();
const port = 3004;
const JSON_BODY_LIMIT = process.env.DB_JSON_BODY_LIMIT || process.env.JSON_BODY_LIMIT || '5mb';

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
const APPROVED_SUBMISSION_STATUSES = ['approved', 'approved_override'];
const REVIEW_QUEUE_STATUSES = ['pending_human_review', 'submitted_no_ai_review'];
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

type PropertyCatalogRecord = {
    name: string;
    city_country: string;
    hotel?: string;
    is_active: boolean;
    sharepoint_site_url?: string;
    sharepoint_library_name?: string;
    sharepoint_drive_id?: string;
    sharepoint_base_folder_path?: string;
    sharepoint_service_folders?: string[];
    sharepoint_last_synced_at?: string;
};

const DEFAULT_SHAREPOINT_PROPERTY_CONFIG: Record<string, Partial<PropertyCatalogRecord>> = {
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

function getRepoRoot(): string {
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

function deriveCityCountryFromProperty(name: string): string {
    const idx = name.lastIndexOf(' - ');
    if (idx < 0) return '';
    return name.slice(idx + 3).trim();
}

function buildDefaultPropertyCatalog(): PropertyCatalogRecord[] {
    return DEFAULT_PROPERTY_NAMES.map((name) => ({
        name,
        city_country: deriveCityCountryFromProperty(name),
        is_active: true,
        ...DEFAULT_SHAREPOINT_PROPERTY_CONFIG[name],
    }));
}

function normalizeServiceFolders(input: any): string[] {
    if (!Array.isArray(input)) return [];

    const seen = new Set<string>();
    return input
        .map((value) => `${value || ''}`.trim())
        .filter(Boolean)
        .filter((value) => {
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function normalizePropertyCatalogRecord(input: any): PropertyCatalogRecord {
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
        sharepoint_service_folders: normalizeServiceFolders(
            input?.sharepoint_service_folders ?? defaults.sharepoint_service_folders
        ),
        sharepoint_last_synced_at: `${input?.sharepoint_last_synced_at || defaults.sharepoint_last_synced_at || ''}`.trim() || undefined,
    };
}

async function writeLocalPropertyCatalog(records: PropertyCatalogRecord[]): Promise<void> {
    await fs.writeFile(
        PROPERTIES_DB,
        JSON.stringify(records.map((item) => normalizePropertyCatalogRecord(item)), null, 2)
    );
}

async function updateLocalPropertyCatalogEntry(
    propertyName: string,
    updates: Partial<PropertyCatalogRecord>
): Promise<PropertyCatalogRecord | null> {
    const catalog = await readLocalPropertyCatalog();
    const matchIndex = catalog.findIndex((item) => item.name.toLowerCase() === propertyName.trim().toLowerCase());
    if (matchIndex < 0) return null;

    const merged = normalizePropertyCatalogRecord({
        ...catalog[matchIndex],
        ...updates,
        name: catalog[matchIndex].name,
    });

    catalog[matchIndex] = merged;
    await writeLocalPropertyCatalog(catalog);
    return merged;
}

async function mirrorPropertyCatalogUpdateToSupabase(record: PropertyCatalogRecord): Promise<void> {
    if (!isSupabaseConfigured()) return;

    const supabase = getSupabaseClient();
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

function toSupabaseSubmissionRecord(payload: any, options?: { includeRawPayload?: boolean }): Record<string, any> {
    const mapped: Record<string, any> = {};
    for (const [key, value] of Object.entries(payload || {})) {
        if (!SUPABASE_SUBMISSION_COLUMNS.has(key)) continue;
        if (value === undefined) continue;
        mapped[key] = value;
    }

    const incomingId = (payload?.id || '').toString().trim();
    if (incomingId) {
        if (UUID_REGEX.test(incomingId)) {
            mapped.id = incomingId;
        } else {
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

async function mirrorSubmissionCreateToSupabase(localSubmission: any): Promise<void> {
    if (!isSupabaseConfigured()) return;

    const supabase = getSupabaseClient();
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

async function mirrorSubmissionUpdateToSupabase(localId: string, updates: any): Promise<void> {
    if (!isSupabaseConfigured()) return;

    const supabase = getSupabaseClient();
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
                const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
                const localRecord = submissions[localId];
                if (localRecord) {
                    const merged = { ...localRecord, ...updates, updated_at: new Date().toISOString() };
                    await mirrorSubmissionCreateToSupabase(merged);
                    console.log(`Supabase self-healed: created missing row for ${localId}`);
                } else {
                    console.warn(`Supabase mirror update skipped: no local record for ${localId}`);
                }
            } catch (healError: any) {
                console.error(`Supabase self-heal failed for ${localId}:`, healError.message);
                logAlert({
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

async function getSubmissionRecordById(id: string): Promise<any | null> {
    const normalizedId = `${id || ''}`.trim();
    if (!normalizedId) return null;

    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
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

    const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
    if (submissions[normalizedId]) {
        return submissions[normalizedId];
    }

    const match = Object.values(submissions).find((submission: any) => (
        submission?.id === normalizedId || submission?.legacy_id === normalizedId
    ));
    return match || null;
}

async function readLocalPropertyCatalog(): Promise<PropertyCatalogRecord[]> {
    try {
        const content = await fs.readFile(PROPERTIES_DB, 'utf-8');
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) return buildDefaultPropertyCatalog();
        return parsed
            .map((item: any) => normalizePropertyCatalogRecord(item))
            .filter((item: PropertyCatalogRecord) => !!item.name);
    } catch {
        return buildDefaultPropertyCatalog();
    }
}

async function getPropertyCatalog(): Promise<PropertyCatalogRecord[]> {
    if (isSupabaseConfigured()) {
        try {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from(PROPERTIES_TABLE)
                .select('name, city_country, hotel, is_active, sharepoint_site_url, sharepoint_library_name, sharepoint_drive_id, sharepoint_base_folder_path, sharepoint_service_folders, sharepoint_last_synced_at')
                .eq('is_active', true)
                .order('name', { ascending: true });

            if (!error && Array.isArray(data) && data.length > 0) {
                return data
                    .map((item: any) => normalizePropertyCatalogRecord(item))
                    .filter((item: PropertyCatalogRecord) => !!item.name);
            }
        } catch (error: any) {
            console.warn('Falling back to local property catalog:', error?.message || error);
        }
    }

    const local = await readLocalPropertyCatalog();
    return local
        .filter((item) => item.is_active !== false)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeApprovedLookupValue(value: any): string {
    return `${value || ''}`
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ');
}

function getSubmissionServicePeriod(submission: any): string {
    return `${submission?.service_period || submission?.raw_payload?.servicePeriod || ''}`.trim();
}

function getApprovedTimestamp(submission: any): number {
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

function getPublicSubmissionId(submission: any): string {
    return `${submission?.legacy_id || submission?.id || ''}`.trim();
}

function isApprovedBaselineSource(submission: any): boolean {
    const source = `${submission?.source || ''}`.trim();
    return !source || source === 'form' || source === 'clickup_history_import';
}

function mapApprovedSubmissionForClient(submission: any, latestForPropertyService?: any | null): any {
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
        allergens: submission.allergens || '',
        status: submission.status,
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

async function findLatestApprovedByPropertyService(property: string, servicePeriod: string): Promise<any | null> {
    const propertyKey = normalizeApprovedLookupValue(property);
    const serviceKey = normalizeApprovedLookupValue(servicePeriod);
    if (!propertyKey || !serviceKey) {
        return null;
    }

    let candidates: any[] = [];
    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
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
    } else {
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        candidates = Object.values(submissions) as any[];
    }

    return candidates
        .filter((submission) => APPROVED_SUBMISSION_STATUSES.includes(`${submission.status || ''}`.trim().toLowerCase()))
        .filter((submission) => !!submission.final_path)
        .filter(isApprovedBaselineSource)
        .filter((submission) => normalizeApprovedLookupValue(submission.property) === propertyKey)
        .filter((submission) => normalizeApprovedLookupValue(getSubmissionServicePeriod(submission)) === serviceKey)
        .sort((a, b) => getApprovedTimestamp(b) - getApprovedTimestamp(a))[0] || null;
}

async function findLatestApprovedByProjectProperty(projectName: string, property: string): Promise<any | null> {
    const projectKey = normalizeApprovedLookupValue(projectName);
    const propertyKey = normalizeApprovedLookupValue(property);
    if (!projectKey || !propertyKey) {
        return null;
    }

    let candidates: any[] = [];
    if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
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
    } else {
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        candidates = Object.values(submissions) as any[];
    }

    return candidates
        .filter((submission) => APPROVED_SUBMISSION_STATUSES.includes(`${submission.status || ''}`.trim().toLowerCase()))
        .filter((submission) => !!submission.final_path)
        .filter(isApprovedBaselineSource)
        .filter((submission) => normalizeApprovedLookupValue(submission.property) === propertyKey)
        .filter((submission) => normalizeApprovedLookupValue(submission.project_name) === projectKey)
        .sort((a, b) => getApprovedTimestamp(b) - getApprovedTimestamp(a))[0] || null;
}

// Ensure DB directory and files exist
async function initDb() {
    try {
        await fs.mkdir(DB_DIR, { recursive: true });
        await fs.access(SUBMISSIONS_DB).catch(() => fs.writeFile(SUBMISSIONS_DB, '{}')); // Now an object
        await fs.access(REPORTS_DB).catch(() => fs.writeFile(REPORTS_DB, '[]'));
        await fs.access(PROFILES_DB).catch(() => fs.writeFile(PROFILES_DB, '{}'));
        await fs.access(ASSETS_DB).catch(() => fs.writeFile(ASSETS_DB, '[]'));
        await fs.access(PROPERTIES_DB).catch(() => fs.writeFile(PROPERTIES_DB, JSON.stringify(buildDefaultPropertyCatalog(), null, 2)));
    } catch (error) {
        console.error('Failed to initialize database:', error);
    }
}

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
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
app.use(requireInternalServiceAuth);

// Endpoint to create a new submission
app.post('/submissions', async (req, res) => {
    try {
        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        const newId = req.body.id || `sub_${Date.now()}`;
        const newSubmission = {
            ...req.body,
            id: newId,
            status: req.body.status || 'processing',
            created_at: req.body.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        submissions[newId] = newSubmission;
        await fs.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));

        try {
            await mirrorSubmissionCreateToSupabase(newSubmission);
        } catch (supabaseError: any) {
            console.error(`Supabase mirror create failed for ${newId} (kept local JSON write):`, supabaseError.message);
            logAlert({
                alert_type: 'supabase_mirror_failed',
                severity: 'error',
                service: 'db',
                submission_id: newId,
                message: `Supabase mirror create failed for new submission ${newId}`,
                details: { error: supabaseError.message },
            });
        }

        res.status(201).json(newSubmission);
    } catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).send('Error saving submission.');
    }
});

// Endpoint to get all pending submissions (for dashboard)
// IMPORTANT: This must come BEFORE the /:id route
app.get('/submissions/pending', async (req, res) => {
    try {
        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .in('status', REVIEW_QUEUE_STATUSES)
                .order('created_at', { ascending: false });
            if (error) {
                throw new Error(error.message);
            }
            return res.status(200).json(data || []);
        }

        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        const pending = Object.values(submissions).filter(
            (sub: any) => REVIEW_QUEUE_STATUSES.includes(sub.status)
        ).sort((a: any, b: any) => {
            const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
            const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
            return bTime - aTime;
        });
        res.status(200).json(pending);
    } catch (error) {
        console.error('Error getting pending submissions:', error);
        res.status(500).send('Error getting pending submissions.');
    }
});

// Endpoint to get recent projects (grouped by project_name)
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/recent-projects', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 20;
        let allSubs: any[] = [];

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
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
        } else {
            const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
            allSubs = Object.values(submissions) as any[];
        }

        // Filter to form submissions only
        const formSubs = allSubs.filter(s => s.source === 'form' && s.project_name);

        // Group by project_name (case-insensitive), keep most recent
        const projectMap: Record<string, any> = {};
        formSubs.forEach(s => {
            const key = (s.project_name || '').toLowerCase().trim();
            if (!key) return;
            if (!projectMap[key] || new Date(s.created_at) > new Date(projectMap[key].created_at)) {
                projectMap[key] = s;
            }
        });

        // Sort by most recent, return top N
        const projects = Object.values(projectMap)
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit)
            .map((s: any) => ({
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
    } catch (error) {
        console.error('Error getting recent projects:', error);
        res.status(500).json([]);
    }
});

// List approved submissions for post-approval download dashboard.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/approved-list', async (req, res) => {
    try {
        const q = ((req.query.q as string) || '').trim().toLowerCase();
        const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 200);
        const approvedStatuses = new Set(APPROVED_SUBMISSION_STATUSES);
        let sourceRows: any[] = [];
        let approvedAssetRows: any[] = [];

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
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
                .map((row: any) => `${row.id || row.legacy_id || ''}`.trim())
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
                } else {
                    approvedAssetRows = assetData || [];
                }
            }
        } else {
            const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
            sourceRows = (Object.values(submissions) as any[])
                .filter((s) => approvedStatuses.has((s.status || '').toLowerCase()))
                .filter((s) => !!s.final_path)
                .filter(isApprovedBaselineSource)
                .filter((s) => {
                    if (!q) return true;
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

            const assets = JSON.parse(await fs.readFile(ASSETS_DB, 'utf-8'));
            approvedAssetRows = (assets as any[])
                .filter((asset) => asset.asset_type === 'approved_docx')
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        }

        const approvedAssetBySubmission = new Map<string, any>();
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
    } catch (error) {
        console.error('Error listing approved submissions:', error);
        res.status(500).json([]);
    }
});

// Search approved submissions for "modification" flow.
// Query can match project/property/submitter and returns newest first.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/search', async (req, res) => {
    try {
        const q = ((req.query.q as string) || '').trim().toLowerCase();
        const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 50);
        const preferredProperty = `${req.query.property || ''}`.trim();
        const preferredServicePeriod = `${req.query.servicePeriod || ''}`.trim();
        if (q.length < 2) {
            return res.json([]);
        }

        let sourceRows: any[] = [];
        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
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
            sourceRows = data || [];
        } else {
            const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
            const approvedStatuses = new Set(APPROVED_SUBMISSION_STATUSES);
            sourceRows = (Object.values(submissions) as any[])
                .filter((s) => approvedStatuses.has((s.status || '').toLowerCase()))
                .filter((s) => !!s.final_path)
                .filter((s) => {
                    const haystack = [
                        s.project_name,
                        s.property,
                        s.service_period,
                        s.filename,
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

        const latestCache = new Map<string, any | null>();
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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

        const normalizedUpdates: Partial<PropertyCatalogRecord> = {
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
        } catch (supabaseError: any) {
            console.error(`Supabase property mirror failed for ${propertyName}:`, supabaseError.message);
            logAlert({
                alert_type: 'supabase_mirror_failed',
                severity: 'warning',
                service: 'db',
                message: `Supabase property mirror failed for ${propertyName}`,
                details: { error: supabaseError.message, property: propertyName },
            });
        }

        res.json({ success: true, property: updated });
    } catch (error) {
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
    } catch (error) {
        console.error('Error fetching property names:', error);
        res.status(500).json({ properties: [] });
    }
});

// Latest approved submission for a property/service pair. Falls back to the
// legacy project/property lookup when servicePeriod is not provided.
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/latest-approved', async (req, res) => {
    try {
        const projectName = ((req.query.projectName as string) || '').trim();
        const property = ((req.query.property as string) || '').trim();
        const servicePeriod = ((req.query.servicePeriod as string) || '').trim();
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
    } catch (error) {
        console.error('Error finding latest approved submission:', error);
        res.status(500).json({ error: 'Failed to find approved submission' });
    }
});

// Submitter profile search
app.get('/submitter-profiles/search', async (req, res) => {
    try {
        const q = (req.query.q as string || '').trim().toLowerCase();
        if (q.length < 2) {
            return res.json([]);
        }

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
            const like = `%${q}%`;
            const { data, error } = await supabase
                .from(SUBMITTER_PROFILES_TABLE)
                .select('*')
                .ilike('name', like)
                .order('last_used', { ascending: false })
                .limit(8);

            if (!error && data) {
                return res.json(
                    data.map((p: any) => ({
                        name: p.name || '',
                        email: p.email || '',
                        jobTitle: p.job_title || '',
                        lastUsed: p.last_used || p.updated_at || p.created_at,
                    }))
                );
            }
        }

        const profiles = JSON.parse(await fs.readFile(PROFILES_DB, 'utf-8'));
        const matches = Object.values(profiles)
            .filter((p: any) => p.name.toLowerCase().includes(q))
            .sort((a: any, b: any) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
            .slice(0, 8);

        res.json(matches);
    } catch (error) {
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

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
            const now = new Date().toISOString();
            const { error } = await supabase
                .from(SUBMITTER_PROFILES_TABLE)
                .upsert(
                    {
                        name: name.trim(),
                        email: email.trim(),
                        job_title: (jobTitle || '').trim(),
                        last_used: now,
                        updated_at: now,
                    },
                    { onConflict: 'email' }
                );
            if (error) {
                console.error('Supabase submitter profile upsert failed, falling back local:', error.message);
            }
        }

        const key = name.toLowerCase().trim();
        const profiles = JSON.parse(await fs.readFile(PROFILES_DB, 'utf-8'));
        const now = new Date().toISOString();

        profiles[key] = {
            name: name.trim(),
            email: email.trim(),
            jobTitle: (jobTitle || '').trim(),
            lastUsed: now,
        };

        await fs.writeFile(PROFILES_DB, JSON.stringify(profiles, null, 2));
        res.json(profiles[key]);
    } catch (error) {
        console.error('Error saving submitter profile:', error);
        res.status(500).json({ error: 'Failed to save profile' });
    }
});

// Lookup submission by ClickUp task ID
// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/submissions/by-clickup-task/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from(SUBMISSIONS_TABLE)
                .select('*')
                .eq('clickup_task_id', taskId)
                .maybeSingle();
            if (!error && data) {
                return res.json(data);
            }
        }

        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        const match = Object.values(submissions).find(
            (sub: any) => sub.clickup_task_id === taskId
        );

        if (!match) {
            return res.status(404).json({ error: 'No submission found for this ClickUp task' });
        }

        res.json(match);
    } catch (error) {
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
    } catch (error) {
        console.error('Error getting submission:', error);
        res.status(500).send('Error getting submission.');
    }
});

app.post('/approved-dishes/extract', async (req, res) => {
    try {
        if (!isSupabaseConfigured()) {
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

        const result = await extractAndStoreDishes(approvedMenuContent, property, resolvedSubmissionId, {
            servicePeriod,
        });

        res.json({
            success: true,
            submissionId: resolvedSubmissionId,
            added: result.added,
        });
    } catch (error: any) {
        console.error('Error extracting approved dishes:', error.message);
        res.status(500).json({ error: 'Failed to extract approved dishes', details: error.message });
    }
});

app.post('/approved-dishes/backfill-approved', async (req, res) => {
    try {
        if (!isSupabaseConfigured()) {
            return res.status(503).json({ error: 'Supabase not configured for approved dish backfill' });
        }

        const limit = Math.min(Math.max(Number(req.body?.limit || 200), 1), 1000);
        const force = req.body?.force === true;
        const supabase = getSupabaseClient();

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
            details: [] as Array<{ submission_id: string; status: 'processed' | 'skipped_existing' | 'skipped_empty' | 'failed'; added?: number; reason?: string }>,
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
                const result = await extractAndStoreDishes(approvedMenuContent, property, submission.id, {
                    servicePeriod,
                });

                summary.processed += 1;
                summary.added += result.added;
                summary.details.push({
                    submission_id: submission.id,
                    status: 'processed',
                    added: result.added,
                });
            } catch (error: any) {
                summary.failed += 1;
                summary.details.push({
                    submission_id: submission.id,
                    status: 'failed',
                    reason: error.message,
                });
            }
        }

        res.json({ success: true, ...summary });
    } catch (error: any) {
        console.error('Error backfilling approved dishes:', error.message);
        res.status(500).json({ error: 'Failed to backfill approved dishes', details: error.message });
    }
});

// Endpoint to update a submission's status and paths
app.put('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { allowedFields, rejectedFields, errors } = sanitizeSubmissionUpdates(req.body || {}, {
            repoRoot: getRepoRoot(),
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

        const submissions = JSON.parse(await fs.readFile(SUBMISSIONS_DB, 'utf-8'));
        let resolvedId = id;

        // When Supabase is enabled, callers may pass UUID `id`, but local JSON
        // uses legacy form IDs as keys. Resolve UUID -> local key if needed.
        if (!submissions[resolvedId]) {
            const match = Object.entries(submissions).find(([, value]: any) => {
                return value?.id === id || value?.legacy_id === id;
            });
            if (match) {
                resolvedId = match[0];
            }
        }

        if (!submissions[resolvedId]) {
            if (isSupabaseConfigured()) {
                // Allow UUID/legacy-id updates even when local JSON entry is missing.
                try {
                    await mirrorSubmissionUpdateToSupabase(id, allowedFields);
                    const supabase = getSupabaseClient();
                    const idColumn = UUID_REGEX.test(id) ? 'id' : 'legacy_id';
                    const { data } = await supabase
                        .from(SUBMISSIONS_TABLE)
                        .select('*')
                        .eq(idColumn, id)
                        .maybeSingle();
                    return res.status(200).json(data || { id, ...allowedFields, updated_at: new Date().toISOString() });
                } catch (supabaseError: any) {
                    console.error('Supabase-only submission update failed:', supabaseError.message);
                }
            }
            return res.status(404).send('Submission not found.');
        }

        const updatedSubmission = { ...submissions[resolvedId], ...allowedFields, updated_at: new Date().toISOString() };
        submissions[resolvedId] = updatedSubmission;

        await fs.writeFile(SUBMISSIONS_DB, JSON.stringify(submissions, null, 2));

        try {
            await mirrorSubmissionUpdateToSupabase(id, allowedFields);
        } catch (supabaseError: any) {
            console.error('Supabase mirror update failed (kept local JSON write):', supabaseError.message);
        }

        res.status(200).json(updatedSubmission);
    } catch (error) {
        console.error('Error updating submission:', error);
        res.status(500).send('Error updating submission.');
    }
});

// Asset metadata for storage abstraction (local now, Teams later)
app.post('/assets', async (req, res) => {
    try {
        const {
            submission_id,
            revision_submission_id,
            asset_type,
            source,
            storage_provider,
            storage_path,
            file_name,
            meta
        } = req.body;

        if (!submission_id || !asset_type || !storage_path) {
            return res.status(400).json({ error: 'submission_id, asset_type, and storage_path are required' });
        }

        const assets = JSON.parse(await fs.readFile(ASSETS_DB, 'utf-8'));
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
        await fs.writeFile(ASSETS_DB, JSON.stringify(assets, null, 2));

        // Fire-and-forget Supabase mirror
        if (isSupabaseConfigured()) {
            (async () => {
                try {
                    const supabase = getSupabaseClient();
                    const { id: _localId, ...supabaseRecord } = newAsset;
                    const { error: sbError } = await supabase.from(ASSETS_TABLE).insert(supabaseRecord);
                    if (sbError) console.error(`Supabase asset mirror failed for ${newAsset.submission_id}:`, sbError.message);
                } catch (err: any) {
                    console.error(`Supabase asset mirror error for ${newAsset.submission_id}:`, err.message);
                }
            })();
        }

        res.status(201).json(newAsset);
    } catch (error) {
        console.error('Error saving asset metadata:', error);
        res.status(500).json({ error: 'Failed to save asset metadata' });
    }
});

// IMPORTANT: Must come BEFORE /submissions/:id
app.get('/assets/by-submission/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
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
        const assets = JSON.parse(await fs.readFile(ASSETS_DB, 'utf-8'));
        const matches = (assets as any[])
            .filter((a) => a.submission_id === submissionId)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        res.json(matches);
    } catch (error) {
        console.error('Error getting submission assets:', error);
        res.status(500).json([]);
    }
});


// Document pairs for learning pipeline — original DOCX ↔ approved DOCX
app.get('/assets/document-pairs', async (req, res) => {
    try {
        const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
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
        const assets = JSON.parse(await fs.readFile(ASSETS_DB, 'utf-8')) as any[];
        const bySubmission = new Map<string, { original?: any; approved?: any }>();
        for (const a of assets) {
            if (a.asset_type === 'original_docx' || a.asset_type === 'approved_docx') {
                if (!bySubmission.has(a.submission_id)) bySubmission.set(a.submission_id, {});
                const entry = bySubmission.get(a.submission_id)!;
                if (a.asset_type === 'original_docx') entry.original = a;
                if (a.asset_type === 'approved_docx') entry.approved = a;
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
    } catch (error) {
        console.error('Error getting document pairs:', error);
        res.status(500).json([]);
    }
});

// Endpoint to create a new report (can be deprecated or used for logging)
app.post('/reports', async (req, res) => {
    try {
        const { submission_id, report_json, ai_confidence } = req.body;
        const reports = JSON.parse(await fs.readFile(REPORTS_DB, 'utf-8'));
        const newReport = {
            id: Date.now().toString(),
            submission_id,
            report_json,
            ai_confidence,
            created_at: new Date().toISOString()
        };
        reports.push(newReport);
        await fs.writeFile(REPORTS_DB, JSON.stringify(reports, null, 2));
        res.status(201).json(newReport);
    } catch (error) {
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
        if (!isSupabaseConfigured()) {
            return res.status(503).json({ error: 'Supabase not configured — correction_rules require Supabase' });
        }

        const record = req.body || {};
        if (!record.submission_id || !record.correction_id || !record.original_text || !record.corrected_text || !record.rule) {
            return res.status(400).json({ error: 'submission_id, correction_id, original_text, corrected_text, and rule are required' });
        }

        const supabase = getSupabaseClient();
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
    } catch (error: any) {
        console.error('Error creating correction rule:', error.message);
        res.status(500).json({ error: 'Failed to create correction rule' });
    }
});

app.get('/correction-rules', async (req, res) => {
    try {
        if (!isSupabaseConfigured()) {
            return res.json([]);
        }

        const supabase = getSupabaseClient();
        let query = supabase
            .from(CORRECTION_RULES_TABLE)
            .select('*')
            .order('created_at', { ascending: false });

        if (req.query.submission_id) {
            query = query.eq('submission_id', req.query.submission_id as string);
        }
        if (req.query.status) {
            query = query.eq('status', req.query.status as string);
        }
        if (req.query.source) {
            query = query.eq('source', req.query.source as string);
        }

        const limit = Math.min(parseInt((req.query.limit as string) || '200', 10), 500);
        query = query.limit(limit);

        const { data, error } = await query;
        if (error) {
            throw new Error(error.message);
        }
        res.json(data || []);
    } catch (error: any) {
        console.error('Error fetching correction rules:', error.message);
        res.status(500).json([]);
    }
});

// IMPORTANT: Must come BEFORE any /:id route in correction-rules
app.get('/correction-rules/pending', async (req, res) => {
    try {
        if (!isSupabaseConfigured()) {
            return res.json([]);
        }

        const supabase = getSupabaseClient();
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
    } catch (error: any) {
        console.error('Error fetching pending correction rules:', error.message);
        res.status(500).json([]);
    }
});

app.put('/correction-rules/:id', async (req, res) => {
    try {
        if (!isSupabaseConfigured()) {
            return res.status(503).json({ error: 'Supabase not configured' });
        }

        const { id } = req.params;
        const updates = req.body || {};

        // Only allow specific fields to be updated
        const allowedFields: Record<string, any> = {};
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

        const supabase = getSupabaseClient();
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
    } catch (error: any) {
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
        if (!isSupabaseConfigured()) {
            return res.json(null);
        }
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from(PROMPT_PROPOSALS_TABLE)
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw new Error(error.message);
        res.json(data || null);
    } catch (error: any) {
        console.error('Error fetching latest prompt proposal:', error.message);
        res.status(500).json(null);
    }
});

app.get('/prompt-proposals', async (_req, res) => {
    try {
        if (!isSupabaseConfigured()) {
            return res.json([]);
        }
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from(PROMPT_PROPOSALS_TABLE)
            .select('id, cycle_id, status, correction_rule_count, submission_count, date_range_start, date_range_end, llm_model, reviewer_name, reviewed_at, created_at')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw new Error(error.message);
        res.json(data || []);
    } catch (error: any) {
        console.error('Error fetching prompt proposals:', error.message);
        res.status(500).json([]);
    }
});

app.get('/prompt-proposals/:id', async (req, res) => {
    try {
        if (!isSupabaseConfigured()) {
            return res.status(404).json({ error: 'Supabase not configured' });
        }
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from(PROMPT_PROPOSALS_TABLE)
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();

        if (error) throw new Error(error.message);
        if (!data) return res.status(404).json({ error: 'Proposal not found' });
        res.json(data);
    } catch (error: any) {
        console.error('Error fetching prompt proposal:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposal' });
    }
});

app.put('/prompt-proposals/:id', async (req, res) => {
    try {
        if (!isSupabaseConfigured()) {
            return res.status(503).json({ error: 'Supabase not configured' });
        }

        const updates = req.body || {};
        const allowedFields: Record<string, any> = {};
        const editable = ['status', 'reviewer_name', 'reviewer_notes', 'final_prompt', 'reviewed_at'];
        for (const key of editable) {
            if (updates[key] !== undefined) {
                allowedFields[key] = updates[key];
            }
        }

        if (Object.keys(allowedFields).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from(PROMPT_PROPOSALS_TABLE)
            .update(allowedFields)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw new Error(error.message);
        res.json(data);
    } catch (error: any) {
        console.error('Error updating prompt proposal:', error.message);
        res.status(500).json({ error: 'Failed to update proposal' });
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`db service listening at http://localhost:${port}`);
        if (isSupabaseConfigured()) {
            console.log('Supabase mirror: enabled');
        } else {
            console.log('Supabase mirror: disabled (missing SUPABASE_URL/SUPABASE_*_KEY)');
        }
        initDb();
    });
}

export default app;

import * as fs from 'fs';
import { getTenantConfig, resolveTenantFile } from '@menumanager/tenant-config';

export type PropertyCatalogRecord = {
    name: string;
    city_country: string;
    hotel?: string;
    is_active?: boolean;
    sharepoint_site_url?: string;
    sharepoint_library_name?: string;
    sharepoint_drive_id?: string;
    sharepoint_base_folder_path?: string;
    sharepoint_service_folders?: string[];
    sharepoint_last_synced_at?: string;
};

// The property list is the single source of truth in the config bundle
// (config/properties.json), read by buildFallbackPropertyCatalog().

export function deriveCityCountryFromProperty(name: string): string {
    const idx = name.lastIndexOf(' - ');
    if (idx < 0) return '';
    return name.slice(idx + 3).trim();
}

export function deriveHotelFromProperty(name: string): string {
    const parts = name.split(' - ').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) return '';
    return parts.slice(1, -1).join(' - ');
}

export function normalizePropertyCatalogRecord(input: any): PropertyCatalogRecord {
    const name = `${input?.name || ''}`.trim();
    return {
        name,
        city_country: `${input?.city_country || deriveCityCountryFromProperty(name)}`.trim(),
        hotel: `${input?.hotel || deriveHotelFromProperty(name)}`.trim() || undefined,
        is_active: input?.is_active !== false,
        sharepoint_site_url: `${input?.sharepoint_site_url || ''}`.trim() || undefined,
        sharepoint_library_name: `${input?.sharepoint_library_name || ''}`.trim() || undefined,
        sharepoint_drive_id: `${input?.sharepoint_drive_id || ''}`.trim() || undefined,
        sharepoint_base_folder_path: `${input?.sharepoint_base_folder_path || ''}`.trim() || undefined,
        sharepoint_service_folders: Array.isArray(input?.sharepoint_service_folders)
            ? input.sharepoint_service_folders.map((value: any) => `${value || ''}`.trim()).filter(Boolean)
            : [],
        sharepoint_last_synced_at: `${input?.sharepoint_last_synced_at || ''}`.trim() || undefined,
    };
}

// Fallback catalog for the form when the db service is unreachable. The property
// list lives only in the config bundle (config/properties.json) — the single
// source shared with the db seed — so the dropdown stays per-business. Returns
// an empty list if the bundle has no usable catalog.
export function buildFallbackPropertyCatalog(): PropertyCatalogRecord[] {
    try {
        const file = resolveTenantFile(getTenantConfig().propertiesSeedFile);
        if (fs.existsSync(file)) {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
            if (Array.isArray(parsed)) {
                return parsed.map((record) => normalizePropertyCatalogRecord(record));
            }
        }
    } catch {
        /* fall through to empty list */
    }
    return [];
}

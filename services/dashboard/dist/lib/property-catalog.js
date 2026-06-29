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
exports.deriveCityCountryFromProperty = deriveCityCountryFromProperty;
exports.deriveHotelFromProperty = deriveHotelFromProperty;
exports.normalizePropertyCatalogRecord = normalizePropertyCatalogRecord;
exports.buildFallbackPropertyCatalog = buildFallbackPropertyCatalog;
const fs = __importStar(require("fs"));
const tenant_config_1 = require("@menumanager/tenant-config");
// The property list is the single source of truth in the config bundle
// (config/properties.json), read by buildFallbackPropertyCatalog().
function deriveCityCountryFromProperty(name) {
    const idx = name.lastIndexOf(' - ');
    if (idx < 0)
        return '';
    return name.slice(idx + 3).trim();
}
function deriveHotelFromProperty(name) {
    const parts = name.split(' - ').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3)
        return '';
    return parts.slice(1, -1).join(' - ');
}
function normalizePropertyCatalogRecord(input) {
    const name = `${input?.name || ''}`.trim();
    return {
        name,
        city_country: `${input?.city_country || deriveCityCountryFromProperty(name)}`.trim(),
        hotel: `${input?.hotel || deriveHotelFromProperty(name)}`.trim() || undefined,
        is_active: input?.is_active !== false,
        menu_size_defaults: normalizeMenuSizeDefaults(input?.menu_size_defaults),
        sharepoint_site_url: `${input?.sharepoint_site_url || ''}`.trim() || undefined,
        sharepoint_library_name: `${input?.sharepoint_library_name || ''}`.trim() || undefined,
        sharepoint_drive_id: `${input?.sharepoint_drive_id || ''}`.trim() || undefined,
        sharepoint_base_folder_path: `${input?.sharepoint_base_folder_path || ''}`.trim() || undefined,
        sharepoint_service_folders: Array.isArray(input?.sharepoint_service_folders)
            ? input.sharepoint_service_folders.map((value) => `${value || ''}`.trim()).filter(Boolean)
            : [],
        sharepoint_last_synced_at: `${input?.sharepoint_last_synced_at || ''}`.trim() || undefined,
    };
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
// Fallback catalog for the form when the db service is unreachable. The property
// list lives only in the config bundle (config/properties.json) — the single
// source shared with the db seed — so the dropdown stays per-business. Returns
// an empty list if the bundle has no usable catalog.
function buildFallbackPropertyCatalog() {
    try {
        const file = (0, tenant_config_1.resolveTenantFile)((0, tenant_config_1.getTenantConfig)().propertiesSeedFile);
        if (fs.existsSync(file)) {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
            if (Array.isArray(parsed)) {
                return parsed.map((record) => normalizePropertyCatalogRecord(record));
            }
        }
    }
    catch {
        /* fall through to empty list */
    }
    return [];
}

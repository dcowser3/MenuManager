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

export function buildFallbackPropertyCatalog(): PropertyCatalogRecord[] {
    return DEFAULT_PROPERTY_NAMES.map((name) => normalizePropertyCatalogRecord({ name }));
}

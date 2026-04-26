UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/ToroToro',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro Toro by Chef Richard Sandoval/Marketing - Locations/Fort Worth/Menus',
    sharepoint_service_folders = ARRAY[
        'Beverage',
        'Brunch',
        'Dinner',
        'Holidays & Events',
        'Lounge Bar',
        'Lunch'
    ],
    updated_at = NOW()
WHERE name = 'Toro Toro - Worthington Renaissance - Fort Worth';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/ToroToro',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro Toro by Chef Richard Sandoval/Marketing - Locations/Miami/Menus',
    sharepoint_service_folders = ARRAY[
        'Beverage',
        'Dessert',
        'Dinner',
        'Lunch'
    ],
    updated_at = NOW()
WHERE name = 'Toro Toro - InterContinental - Miami';

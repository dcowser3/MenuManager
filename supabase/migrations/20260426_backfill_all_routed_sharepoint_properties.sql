INSERT INTO properties (name, city_country, hotel)
VALUES ('Toro - Dania Beach', 'Dania Beach', NULL)
ON CONFLICT (name) DO NOTHING;

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/Toro2',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro by Chef Richard Sandoval/Marketing - Locations/Denver/Menus',
    sharepoint_service_folders = ARRAY[
        'Beverage',
        'Breakfast',
        'Brunch',
        'Dessert',
        'Dinner',
        
        'Happy Hour',
        'Holidays & Events',
        'Lunch'
    ],
    updated_at = NOW()
WHERE name = 'Toro - Hotel Clio - Denver';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/Toro2',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro by Chef Richard Sandoval/Marketing - Locations/Chicago/Menus',
    sharepoint_service_folders = ARRAY[
        'Beverage',
        'Bloody Bar',
        'Breakfast',
        'Brunch',
        'Dessert',
        'Dinner',
        'Happy Hour',
        'Holidays & Events',
        'Lunch'
    ],
    updated_at = NOW()
WHERE name = 'Toro - Fairmont Millennium Park - Chicago';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/Toro2',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro by Chef Richard Sandoval/Marketing - Locations/Dania Beach/Menus',
    sharepoint_service_folders = ARRAY[
        'Dinner',
        'Happy Hour',
        'Holidays & Events'
    ],
    updated_at = NOW()
WHERE name = 'Toro - Dania Beach';

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/Toro2',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Toro by Chef Richard Sandoval/Marketing - Locations/Snowmass/Menus',
    sharepoint_service_folders = ARRAY[
        'Large party_Pre-Fixe menu',
        'Winter Breakfast menu',
        'Winter Dessert Menu',
        'Winter Dinner Menu',
        'Winter Kids Breakfast menu',
        'Winter Kids Dinner Menu',
        'Winter Wine List'
    ],
    updated_at = NOW()
WHERE name = 'Toro - Viceroy - Snowmass';

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

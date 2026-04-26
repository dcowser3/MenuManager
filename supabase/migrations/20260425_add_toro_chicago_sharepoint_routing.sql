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

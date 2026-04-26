ALTER TABLE properties
ADD COLUMN IF NOT EXISTS sharepoint_site_url TEXT,
ADD COLUMN IF NOT EXISTS sharepoint_library_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS sharepoint_drive_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS sharepoint_base_folder_path TEXT,
ADD COLUMN IF NOT EXISTS sharepoint_service_folders TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS sharepoint_last_synced_at TIMESTAMPTZ;

ALTER TABLE submissions
ALTER COLUMN service_period TYPE VARCHAR(100);

ALTER TABLE approved_dishes
ALTER COLUMN service_period TYPE VARCHAR(100);

UPDATE properties
SET
    sharepoint_site_url = 'https://richardsandoval.sharepoint.com/sites/OwnedOperated2-Tamayo',
    sharepoint_library_name = 'Shared Documents',
    sharepoint_base_folder_path = 'Tamayo/Brand & Marketing/Media Library/Menu Files',
    sharepoint_service_folders = ARRAY[
        'Afternoon Brunch',
        'Beverage',
        'Brunch',
        'Dessert',
        'Dinner',
        'Happy Hour',
        'Holidays & Events',
        'Kids',
        'Lunch',
        'Menu Box'
    ],
    updated_at = NOW()
WHERE name = 'Tamayo - Denver';

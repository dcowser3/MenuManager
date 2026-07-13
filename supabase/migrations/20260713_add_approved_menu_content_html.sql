ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS approved_menu_content_html TEXT;

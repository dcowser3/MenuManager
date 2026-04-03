ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS service_period VARCHAR(50) DEFAULT 'other';

ALTER TABLE approved_dishes
ADD COLUMN IF NOT EXISTS service_period VARCHAR(50);

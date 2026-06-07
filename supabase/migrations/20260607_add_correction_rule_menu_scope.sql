ALTER TABLE correction_rules
    ADD COLUMN IF NOT EXISTS applies_to_menu_type VARCHAR(50) NOT NULL DEFAULT 'all';

ALTER TABLE correction_rules
    ALTER COLUMN original_text DROP NOT NULL,
    ALTER COLUMN corrected_text DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'correction_rules_applies_to_menu_type_check'
    ) THEN
        ALTER TABLE correction_rules
            ADD CONSTRAINT correction_rules_applies_to_menu_type_check
            CHECK (applies_to_menu_type IN ('all', 'food', 'beverage')) NOT VALID;
    END IF;
END $$;

ALTER TABLE correction_rules
    VALIDATE CONSTRAINT correction_rules_applies_to_menu_type_check;

CREATE INDEX IF NOT EXISTS idx_correction_rules_menu_scope
    ON correction_rules(applies_to_menu_type);

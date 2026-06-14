-- Production correction_rules was missing applies_to_menu_type, so EVERY
-- reviewer correction the dashboard saved failed its Supabase insert and fell
-- to the db container's local JSON fallback (invisible to the improvement
-- cycle, which reads Supabase directly). This adds the missing column so saves
-- land in Supabase again. Run scripts/reconcile-correction-rules.js afterward
-- to recover rules already stranded in the local fallback.

ALTER TABLE correction_rules
    ADD COLUMN IF NOT EXISTS applies_to_menu_type VARCHAR(50) DEFAULT 'all' NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'correction_rules_applies_to_menu_type_check'
    ) THEN
        ALTER TABLE correction_rules
            ADD CONSTRAINT correction_rules_applies_to_menu_type_check
            CHECK (applies_to_menu_type IN ('all', 'food', 'beverage'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_correction_rules_menu_scope ON correction_rules(applies_to_menu_type);

-- Seed provenance for Basic AI Check audit rows.
-- Nullable: historical reviews and intentionally seed-disabled reviews have no value.
ALTER TABLE basic_ai_check_audits
    ADD COLUMN IF NOT EXISTS seed INTEGER;

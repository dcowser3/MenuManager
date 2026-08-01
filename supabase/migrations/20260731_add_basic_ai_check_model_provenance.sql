-- Model provenance for Basic AI Check audit rows.
-- Nullable by design: historical rows predate this metadata and cannot be
-- backfilled without inventing values.
ALTER TABLE basic_ai_check_audits
    ADD COLUMN IF NOT EXISTS model TEXT;

ALTER TABLE basic_ai_check_audits
    ADD COLUMN IF NOT EXISTS system_fingerprint TEXT;

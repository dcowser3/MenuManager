-- Preserve the exact trusted source span used when a reviewer saves an
-- explanation. Existing rows remain nullable/legacy; new dashboard-created
-- human explanations include this server-assembled envelope.
ALTER TABLE correction_rules
    ADD COLUMN IF NOT EXISTS source_binding JSONB;

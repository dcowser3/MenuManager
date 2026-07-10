-- Freeform correction rules (a pure instruction with no before/after text) have
-- null original_text / corrected_text. Migration 20260607 dropped the NOT NULL
-- constraints on those columns, but the later 20260614 menu-scope migration was
-- the one applied in production and it omitted the DROP NOT NULL — so every
-- freeform rule silently failed its Supabase insert and accumulated in the db
-- service's local JSON fallback, invisible to the improvement cycle (July 2026).
--
-- This migration re-asserts the drop idempotently so any environment that missed
-- 20260607 is corrected. DROP NOT NULL is a no-op when the constraint is already
-- gone, so this is safe to run anywhere.
ALTER TABLE correction_rules
    ALTER COLUMN original_text DROP NOT NULL,
    ALTER COLUMN corrected_text DROP NOT NULL;

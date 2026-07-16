-- Menu as an Entity (Phase 3 — draft invariant re-key).
-- Runs AFTER 20260716_menu_entity.sql AND after the menu backfill has populated
-- submissions.menu_id (scripts/backfill-menus.js --apply). Re-keys the single-
-- active-draft invariant from base_submission_id to menu_id: one active draft
-- per MENU, not per baseline submission.
--
-- Order matters (same pattern as the Phase-A cleanup): backfill draft_sessions
-- .menu_id from each draft's baseline first, collapse duplicate actives, then
-- swap the partial unique index.

-- 1. Backfill draft_sessions.menu_id from the baseline submission's menu.
UPDATE draft_sessions d
SET menu_id = s.menu_id
FROM submissions s
WHERE d.menu_id IS NULL
  AND s.menu_id IS NOT NULL
  AND (s.id::text = d.base_submission_id OR s.legacy_id = d.base_submission_id);

-- 2. Collapse duplicate active drafts that now share a menu — keep the newest.
WITH ranked AS (
    SELECT id, row_number() OVER (
        PARTITION BY menu_id
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rank
    FROM draft_sessions
    WHERE status = 'active' AND menu_id IS NOT NULL
)
UPDATE draft_sessions
SET status = 'discarded', updated_at = NOW()
WHERE id IN (SELECT id FROM ranked WHERE rank > 1);

-- 3. Swap the partial unique index from base_submission_id to menu_id.
-- Drafts whose baseline was never backfilled (menu_id still null) keep falling
-- back to the per-base index below, so nothing is left ungated.
DROP INDEX IF EXISTS idx_draft_sessions_one_active_per_base;
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_sessions_one_active_per_menu
ON draft_sessions(menu_id)
WHERE status = 'active' AND menu_id IS NOT NULL;

-- Retain a per-base guard for the un-backfilled tail (menu_id null).
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_sessions_one_active_per_base_nullmenu
ON draft_sessions(base_submission_id)
WHERE status = 'active' AND menu_id IS NULL;

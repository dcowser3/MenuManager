-- Fix: menus.current_submission_id must hold a PUBLIC submission id, not a UUID.
--
-- The pointer (and every read-path comparison) uses getPublicSubmissionId =
-- legacy_id || id. clickup_history_import rows carry non-UUID legacy_id strings
-- (e.g. "clickup-86b4q079a"), so a UUID column rejects them — this broke the
-- backfill and was silently failing the Phase 2 pointer move for legacy rows.
-- Move the column to VARCHAR(100), matching draft_sessions.base_submission_id
-- and staying consistent with public ids everywhere.
--
-- NOTE: submissions.menu_id and draft_sessions.menu_id stay UUID on purpose —
-- they hold MENU ids (which we mint as UUIDs), not submission public ids.

ALTER TABLE menus
    ALTER COLUMN current_submission_id TYPE VARCHAR(100) USING current_submission_id::text;

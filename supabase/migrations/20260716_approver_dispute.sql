-- Identity Stage 2 — approver dispute link (negative confirmation).
-- Design: docs/design-docs/menu-entity-and-identity.md (Part 2, Stage 2)
--
-- A per-submission token lets a named approver say "I did NOT approve this."
-- Silence means everything is fine. A click records the dispute + flags the
-- submission on the review dashboard; it never unwinds anything automatically.

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS approver_dispute_token VARCHAR(64);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS approver_disputed_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS approver_dispute_note VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_submissions_approver_dispute_token ON submissions(approver_dispute_token);

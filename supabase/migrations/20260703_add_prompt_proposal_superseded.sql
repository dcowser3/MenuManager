-- Part 2: pending-proposal supersede — admit superseded status and link rows.
ALTER TABLE prompt_proposals
  ADD COLUMN IF NOT EXISTS superseded_by_cycle_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS superseded_from_cycle_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supersede_carried_correction_count INTEGER,
  ADD COLUMN IF NOT EXISTS supersede_new_correction_count INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prompt_proposals_status_check'
      AND conrelid = 'prompt_proposals'::regclass
  ) THEN
    ALTER TABLE prompt_proposals
      ADD CONSTRAINT prompt_proposals_status_check
      CHECK (status IS NULL OR status IN (
        'pending', 'approved', 'approved_modified', 'rejected', 'superseded'
      ));
  END IF;
END
$$;

COMMENT ON COLUMN prompt_proposals.superseded_by_cycle_id IS
  'When status=superseded, the cycle_id of the replacement proposal that superseded this row.';
COMMENT ON COLUMN prompt_proposals.superseded_from_cycle_id IS
  'When this pending proposal superseded an older one, the prior cycle_id.';
COMMENT ON COLUMN prompt_proposals.supersede_carried_correction_count IS
  'Supersede run: corrections carried forward from the superseded proposal.';
COMMENT ON COLUMN prompt_proposals.supersede_new_correction_count IS
  'Supersede run: newly unconsumed corrections included in this proposal.';

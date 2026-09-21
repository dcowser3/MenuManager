-- Guarded, transactional reconciliation for the reviewed contextual descriptor
-- guards. This migration is intentionally unapplied by the engineering plan.
-- The caller supplies the complete pre-update row as JSONB (excluding xmin);
-- PostgreSQL jsonb equality ignores object-key order but preserves array order
-- and nulls. The row lock plus xmin check prevents duplicate or stale writes.

CREATE OR REPLACE FUNCTION public.reconcile_contextual_descriptor_proposal(
    p_proposal_id uuid,
    p_expected_xmin text,
    p_expected_substantive jsonb,
    p_new_proposed_rules jsonb,
    p_new_correction_routing jsonb
)
RETURNS SETOF public.prompt_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    locked record;
BEGIN
    IF p_proposal_id IS NULL OR coalesce(p_expected_xmin, '') = ''
        OR p_expected_substantive IS NULL OR jsonb_typeof(p_expected_substantive) <> 'object'
        OR p_new_proposed_rules IS NULL OR jsonb_typeof(p_new_proposed_rules) <> 'array'
        OR p_new_correction_routing IS NULL OR jsonb_typeof(p_new_correction_routing) <> 'array' THEN
        RAISE EXCEPTION 'contextual descriptor reconciliation expectations are incomplete' USING ERRCODE = '22023';
    END IF;

    SELECT p.*, p.xmin::text AS row_xmin INTO locked
      FROM public.prompt_proposals AS p
     WHERE p.id = p_proposal_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'contextual descriptor proposal not found' USING ERRCODE = 'P0002';
    END IF;
    IF locked.row_xmin <> p_expected_xmin THEN
        RAISE EXCEPTION 'contextual descriptor proposal xmin conflict' USING ERRCODE = '40001';
    END IF;
    IF locked.status <> 'pending' OR locked.eval_status <> 'regressed' OR locked.disposition <> 'rules_only' THEN
        RAISE EXCEPTION 'contextual descriptor proposal state conflict' USING ERRCODE = '40001';
    END IF;
    IF locked.eval_summary->'code_candidate' IS NULL
       OR coalesce(locked.eval_summary->'code_candidate'->>'status', '') NOT IN ('blocked', 'completed')
       OR coalesce(locked.eval_summary->'code_candidate'->>'closed_at', '') = '' THEN
        RAISE EXCEPTION 'contextual descriptor terminal owner conflict' USING ERRCODE = '40001';
    END IF;
    IF (to_jsonb(locked) - 'row_xmin') <> p_expected_substantive THEN
        RAISE EXCEPTION 'contextual descriptor substantive snapshot conflict' USING ERRCODE = '40001';
    END IF;

    UPDATE public.prompt_proposals
       SET proposed_rules = p_new_proposed_rules,
           correction_routing = p_new_correction_routing
     WHERE id = p_proposal_id;
    RETURN QUERY SELECT * FROM public.prompt_proposals WHERE id = p_proposal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_contextual_descriptor_proposal(uuid, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_contextual_descriptor_proposal(uuid, text, jsonb, jsonb, jsonb) TO service_role;

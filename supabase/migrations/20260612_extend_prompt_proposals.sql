-- Improvement-cycle extensions to prompt_proposals: proposals now carry
-- deterministic replacement-rule candidates, code recommendations, and the
-- eval-harness verdict alongside the prompt rewrite.

ALTER TABLE prompt_proposals ADD COLUMN IF NOT EXISTS proposed_rules JSONB;
-- [{original_text, corrected_text, change_type, rule, applies_to_menu_type,
--   is_location_specific, location, other_applicable_locations}]

ALTER TABLE prompt_proposals ADD COLUMN IF NOT EXISTS code_recommendations JSONB;
-- [{title, description, manifest_rule_ids, target_file_hint}]

ALTER TABLE prompt_proposals ADD COLUMN IF NOT EXISTS eval_summary JSONB;
-- {baseline:{...}, candidate:{...}, comparedCases, avgDelta, improved, regressed,
--  same, regressions:[{case_id,label,delta}], error?}

ALTER TABLE prompt_proposals ADD COLUMN IF NOT EXISTS eval_status VARCHAR(30);
-- 'passed' | 'regressed' | 'skipped' | 'failed'

ALTER TABLE prompt_proposals ADD COLUMN IF NOT EXISTS accepted_rules JSONB;
-- reviewer-selected subset of proposed_rules recorded at approval

ALTER TABLE prompt_proposals ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'prompt_rewrite';
-- 'prompt_rewrite' (legacy manual script) | 'improvement_cycle'

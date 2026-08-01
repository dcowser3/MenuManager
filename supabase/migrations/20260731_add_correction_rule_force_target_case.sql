ALTER TABLE correction_rules
    ADD COLUMN IF NOT EXISTS force_target_case BOOLEAN NOT NULL DEFAULT false;

UPDATE correction_rules
SET force_target_case = true
WHERE status = 'accepted'
  AND (
      (original_text = 'st. germain' AND corrected_text = 'St-Germain')
      OR (original_text = 'ste. germaine' AND corrected_text = 'St-Germain')
      OR (original_text = 'BBQ' AND corrected_text = 'Barbecue')
      OR (original_text = 'maldon' AND corrected_text = 'Maldon')
      OR (original_text = 'marcona' AND corrected_text = 'Marcona')
      OR (original_text = 'reggiano' AND corrected_text = 'Reggiano')
  );

INSERT INTO correction_rules (
    submission_id,
    correction_id,
    original_text,
    corrected_text,
    force_target_case,
    change_type,
    rule,
    applies_to_menu_type,
    is_location_specific,
    project_name,
    restaurant_name,
    location,
    other_applicable_locations,
    reviewer_name,
    status,
    source,
    occurrences
)
SELECT
    'proposal-manual-canonical-capitalization-20260731',
    seed.correction_id,
    seed.original_text,
    seed.corrected_text,
    true,
    'capitalization',
    seed.rule,
    'all',
    false,
    NULL,
    'All Menu Manager restaurants',
    'All properties (global rule)',
    '{}',
    NULL,
    'accepted',
    'system',
    1
FROM (
    VALUES
        ('canonical-capitalization-maldon', 'maldon', 'Maldon', 'Use the canonical proper-noun capitalization: Maldon.'),
        ('canonical-capitalization-marcona', 'marcona', 'Marcona', 'Use the canonical proper-noun capitalization: Marcona.'),
        ('canonical-capitalization-reggiano', 'reggiano', 'Reggiano', 'Use the canonical proper-noun capitalization: Reggiano.')
) AS seed(correction_id, original_text, corrected_text, rule)
WHERE NOT EXISTS (
    SELECT 1
    FROM correction_rules existing
    WHERE existing.status = 'accepted'
      AND existing.original_text = seed.original_text
      AND existing.corrected_text = seed.corrected_text
);

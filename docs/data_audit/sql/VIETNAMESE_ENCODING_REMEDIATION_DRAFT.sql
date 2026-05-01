-- VIETNAMESE ENCODING REMEDIATION DRAFT
-- Purpose: Safely patch corrupted Vietnamese characters using an explicit CSV mapping table.
-- Environment: Staging

BEGIN;

-- 1. Create a temporary table for the corrections.
-- Note: You must load the data from `encoding_review_template.csv` into this table before running the updates.
CREATE TEMP TABLE temp_encoding_fixes (
    record_id UUID,
    entity_type TEXT,
    corrupted_value TEXT,
    corrected_value TEXT,
    matching_key TEXT,
    confidence TEXT,
    review_status TEXT
);

-- [INSTRUCTION] Load the CSV data into `temp_encoding_fixes` here using Supabase dashboard import or \copy
-- Example: \copy temp_encoding_fixes FROM 'data_imports/season11/encoding_review_template.csv' WITH CSV HEADER;

-- 2. Validation: Count mojibake records BEFORE execution
SELECT 'BEFORE UPDATE - People with mojibake' as metric, COUNT(*) as count 
FROM people 
WHERE full_name LIKE '%Ă%' OR full_name LIKE '%Ä%' OR full_name LIKE '%á»%' OR full_name LIKE '%Ă¢%';

-- 3. Execution: Update people.full_name
UPDATE people p
SET full_name = t.corrected_value,
    updated_at = NOW()
FROM temp_encoding_fixes t
WHERE p.id = t.record_id
  AND t.entity_type = 'people'
  AND t.review_status = 'approved'
  AND t.corrected_value IS NOT NULL
  AND t.corrected_value != '';

-- 4. Execution: Update mentor_profiles.company_current
UPDATE mentor_profiles mp
SET company_current = t.corrected_value,
    updated_at = NOW()
FROM temp_encoding_fixes t
WHERE mp.id = t.record_id
  AND t.entity_type = 'mentor_profiles_company'
  AND t.review_status = 'approved'
  AND t.corrected_value IS NOT NULL;

-- 5. Execution: Update mentee_profiles.major
UPDATE mentee_profiles mp
SET major = t.corrected_value,
    updated_at = NOW()
FROM temp_encoding_fixes t
WHERE mp.id = t.record_id
  AND t.entity_type = 'mentee_profiles_major'
  AND t.review_status = 'approved'
  AND t.corrected_value IS NOT NULL;

-- 6. Validation: Count corrected rows AFTER execution
SELECT 'AFTER UPDATE - People with mojibake' as metric, COUNT(*) as count 
FROM people 
WHERE full_name LIKE '%Ă%' OR full_name LIKE '%Ä%' OR full_name LIKE '%á»%' OR full_name LIKE '%Ă¢%';

-- 7. Validation: Sample corrected rows AFTER execution
SELECT p.id, t.corrupted_value as old_name, p.full_name as new_name, p.email_primary 
FROM people p
JOIN temp_encoding_fixes t ON p.id = t.record_id
WHERE t.entity_type = 'people' AND t.review_status = 'approved'
LIMIT 20;

-- 8. Safety Net
-- Keep ROLLBACK to dry-run the script. Change to COMMIT only when output metrics and samples are verified.
ROLLBACK;

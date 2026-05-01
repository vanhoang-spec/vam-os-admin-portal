-- VIETNAMESE ENCODING STAGING PATCH (DRAFT)
-- Purpose: Safely update Staging `people.full_name` using Production data as the source of truth.
-- Environment: STAGING ONLY (`ljfneyuvpxrmejpxsmpz`)

BEGIN;

-- 1. Create temporary table
CREATE TEMP TABLE temp_prod_people (
    id UUID,
    full_name TEXT,
    email_primary TEXT,
    phone_primary TEXT
);

-- [INSTRUCTION] Load the CSV data into `temp_prod_people` here.
-- Example: \copy temp_prod_people FROM 'data_imports/season11/encoding_prod_to_staging_patch_template.csv' WITH CSV HEADER;

-- 2. Validation: Count Corrupted Names BEFORE Patch
SELECT 'BEFORE PATCH - Mojibake Count' AS metric, COUNT(*) AS count 
FROM people 
WHERE full_name LIKE '%Ă%' OR full_name LIKE '%Ä%' OR full_name LIKE '%Æ%' OR full_name LIKE '%áº%' OR full_name LIKE '%á»%';

-- 3. Execution: Patch Staging Names using Email Primary
-- Note: Email is used as the safest stable key in case UUIDs drifted during staging rebuilds.
UPDATE people s
SET full_name = p.full_name,
    updated_at = NOW()
FROM temp_prod_people p
WHERE LOWER(TRIM(s.email_primary)) = LOWER(TRIM(p.email_primary))
  AND p.full_name IS NOT NULL
  AND p.full_name != ''
  -- Only update if the staging name looks like mojibake to avoid touching manually corrected names
  AND (s.full_name LIKE '%Ă%' OR s.full_name LIKE '%Ä%' OR s.full_name LIKE '%Æ%' OR s.full_name LIKE '%áº%' OR s.full_name LIKE '%á»%');

-- 4. Validation: Count Clean Replacements
-- This assumes updated_at was modified in this transaction.
SELECT 'ROWS PATCHED' AS metric, COUNT(*) AS count
FROM people 
WHERE updated_at >= NOW() - INTERVAL '1 minute';

-- 5. Validation: Count Corrupted Names AFTER Patch
SELECT 'AFTER PATCH - Mojibake Count' AS metric, COUNT(*) AS count 
FROM people 
WHERE full_name LIKE '%Ă%' OR full_name LIKE '%Ä%' OR full_name LIKE '%Æ%' OR full_name LIKE '%áº%' OR full_name LIKE '%á»%';

-- 6. Validation: Sample Patched Rows
SELECT s.id, s.full_name AS patched_clean_name, s.email_primary
FROM people s
JOIN temp_prod_people p ON LOWER(TRIM(s.email_primary)) = LOWER(TRIM(p.email_primary))
WHERE s.updated_at >= NOW() - INTERVAL '1 minute'
LIMIT 20;

-- 7. Safety Net: Dry-run defaults to ROLLBACK.
-- [INSTRUCTION] Verify the output metrics above. If "AFTER PATCH - Mojibake Count" drops significantly
-- and the sampled names look correct, change ROLLBACK to COMMIT and re-run.
ROLLBACK;
-- COMMIT;

-- VIETNAMESE ENCODING STAGING COMPARE (READ-ONLY)
-- Purpose: Verify matching keys between Production CSV and Staging DB.
-- Environment: STAGING ONLY (`ljfneyuvpxrmejpxsmpz`)

BEGIN;

-- 1. Create temporary table to hold production data
CREATE TEMP TABLE temp_prod_people (
    id UUID,
    full_name TEXT,
    email_primary TEXT,
    phone_primary TEXT
);

-- [INSTRUCTION] Load the CSV data into `temp_prod_people` here.
-- Example: \copy temp_prod_people FROM 'data_imports/season11/encoding_prod_to_staging_patch_template.csv' WITH CSV HEADER;

-- 2. Test UUID Preservation
-- If this count matches the total rows in temp_prod_people, UUIDs were preserved perfectly.
SELECT 'UUID Match Count' AS metric, COUNT(*) AS count
FROM people s
JOIN temp_prod_people p ON s.id = p.id;

-- 3. Test Email Matching (Fallback Key)
-- If UUIDs didn't match perfectly, check how reliable email matching is.
SELECT 'Email Match Count' AS metric, COUNT(*) AS count
FROM people s
JOIN temp_prod_people p ON LOWER(TRIM(s.email_primary)) = LOWER(TRIM(p.email_primary));

-- 4. Detect Staging Mojibake Count
SELECT 'Staging Mojibake Count' AS metric, COUNT(*) AS count 
FROM people 
WHERE full_name LIKE '%Ă%' 
   OR full_name LIKE '%Ä%' 
   OR full_name LIKE '%Æ%' 
   OR full_name LIKE '%áº%' 
   OR full_name LIKE '%á»%';

-- 5. Identify Ambiguous / Unmatched Records (by Email)
SELECT s.id, s.full_name AS staging_name, s.email_primary
FROM people s
LEFT JOIN temp_prod_people p ON LOWER(TRIM(s.email_primary)) = LOWER(TRIM(p.email_primary))
WHERE p.email_primary IS NULL
  AND (s.full_name LIKE '%Ă%' OR s.full_name LIKE '%Ä%' OR s.full_name LIKE '%Æ%' OR s.full_name LIKE '%áº%' OR s.full_name LIKE '%á»%')
LIMIT 50;

-- Read-only script, no changes persisted.
ROLLBACK;

-- VIETNAMESE ENCODING PROD EXPORT (READ-ONLY)
-- Purpose: Safely extract clean UTF-8 `people` records from Production.
-- Environment: PRODUCTION ONLY (`qkkroesfiazsejkzflcd`)

SELECT 
    id, 
    full_name, 
    email_primary, 
    phone_primary 
FROM people 
WHERE full_name IS NOT NULL 
  AND full_name != '';

-- Instructions:
-- 1. Run this query in the Production Supabase SQL Editor.
-- 2. Export the result as a CSV file.
-- 3. Save the file locally as `data_imports/season11/encoding_prod_to_staging_patch_template.csv`.
-- 4. Do NOT modify the CSV manually.

-- VIETNAMESE ENCODING DIAGNOSTIC (READ-ONLY)
-- Purpose: Quantify and sample Vietnamese mojibake/encoding corruption in the database.
-- Safe to run on Staging and Production. Does not modify data.

-- 1. PEOPLE TABLE: COUNT AFFECTED
SELECT 
    'people.full_name' AS entity_type,
    COUNT(*) AS corrupted_count 
FROM people 
WHERE full_name LIKE '%Ă%' 
   OR full_name LIKE '%Ä%' 
   OR full_name LIKE '%á»%' 
   OR full_name LIKE '%Ă¢%';

-- 1b. PEOPLE TABLE: SAMPLE AFFECTED
SELECT 
    id AS record_id, 
    'people' AS entity_type,
    full_name AS corrupted_value,
    email_primary AS matching_key
FROM people 
WHERE full_name LIKE '%Ă%' 
   OR full_name LIKE '%Ä%' 
   OR full_name LIKE '%á»%' 
   OR full_name LIKE '%Ă¢%'
LIMIT 50;

-- 2. MENTOR PROFILES: COUNT AFFECTED
SELECT 
    'mentor_profiles (company or title)' AS entity_type,
    COUNT(*) AS corrupted_count 
FROM mentor_profiles mp
JOIN people p ON mp.person_id = p.id
WHERE mp.company_current LIKE '%Ă%' OR mp.company_current LIKE '%Ä%'
   OR mp.title_current LIKE '%Ă%' OR mp.title_current LIKE '%Ä%'
   OR p.full_name LIKE '%Ă%' OR p.full_name LIKE '%Ä%';

-- 2b. MENTOR PROFILES: SAMPLE AFFECTED COMPANY
SELECT 
    mp.id AS record_id,
    'mentor_profiles_company' AS entity_type,
    mp.company_current AS corrupted_value,
    p.email_primary AS matching_key
FROM mentor_profiles mp
JOIN people p ON mp.person_id = p.id
WHERE mp.company_current LIKE '%Ă%' OR mp.company_current LIKE '%Ä%'
LIMIT 50;

-- 3. MENTEE PROFILES: COUNT AFFECTED
SELECT 
    'mentee_profiles (major)' AS entity_type,
    COUNT(*) AS corrupted_count 
FROM mentee_profiles mp
JOIN people p ON mp.person_id = p.id
WHERE mp.major LIKE '%Ă%' OR mp.major LIKE '%Ä%'
   OR p.full_name LIKE '%Ă%' OR p.full_name LIKE '%Ä%';

-- 3b. MENTEE PROFILES: SAMPLE AFFECTED MAJOR
SELECT 
    mp.id AS record_id,
    'mentee_profiles_major' AS entity_type,
    mp.major AS corrupted_value,
    p.email_primary AS matching_key
FROM mentee_profiles mp
JOIN people p ON mp.person_id = p.id
WHERE mp.major LIKE '%Ă%' OR mp.major LIKE '%Ä%'
LIMIT 50;

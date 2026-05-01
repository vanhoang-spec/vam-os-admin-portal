# Vietnamese Encoding Remediation Plan

## Problem Description
Vietnamese names and string fields in the staging database are currently displaying corrupted characters (mojibake). 

**Examples of affected names:**
* `HoĂ ng BĂch Thá»§y`
* `Nguyá»…n ÄĂ¬nh TuĂ¢n`
* `Äá»— KhĂ¡nh Linh`

## Likely Root Cause
This is a classic character encoding mismatch. It occurs when UTF-8 encoded data is exported, decoded, or re-imported using a legacy encoding standard (such as Windows-1252 or ISO-8859-1). As a result, multi-byte Vietnamese characters are incorrectly parsed into separate, nonsensical characters.

## Read-Only SQL Diagnostics
To accurately gauge the scope of the corruption without modifying any data, the following read-only queries should be run against the staging and production databases.

### 1. Identify Affected People (Names & Emails)
```sql
SELECT 
    id, 
    full_name, 
    email_primary 
FROM people 
WHERE full_name LIKE '%Ă%' 
   OR full_name LIKE '%Ä%' 
   OR full_name LIKE '%á»%' 
   OR full_name LIKE '%Ă¢%';
```

### 2. Identify Affected Mentor Profiles
```sql
SELECT 
    p.full_name,
    mp.company_current, 
    mp.title_current 
FROM mentor_profiles mp
JOIN people p ON mp.person_id = p.id
WHERE mp.company_current LIKE '%Ă%' OR mp.company_current LIKE '%Ä%'
   OR mp.title_current LIKE '%Ă%' OR mp.title_current LIKE '%Ä%'
   OR p.full_name LIKE '%Ă%' OR p.full_name LIKE '%Ä%';
```

### 3. Identify Affected Mentee Profiles
```sql
SELECT 
    p.full_name,
    mp.major 
FROM mentee_profiles mp
JOIN people p ON mp.person_id = p.id
WHERE mp.major LIKE '%Ă%' OR mp.major LIKE '%Ä%'
   OR p.full_name LIKE '%Ă%' OR p.full_name LIKE '%Ä%';
```

## Safe Remediation Options

⚠️ **CRITICAL: Avoid blind mass string replacement (e.g., using `REPLACE()` in SQL). Mojibake character sets can overlap and cause irreversible data corruption if applied blindly.**

### Option 1: Regenerate and Upsert (Preferred)
The safest and most reliable method is to fix the issue at the source.
1. Generate a clean, explicitly UTF-8 encoded CSV export from the master source of truth (e.g., Google Sheets, Excel).
2. Validate the CSV in a text editor to ensure the Vietnamese characters render correctly.
3. Write a safe SQL upsert script (or use a secure import tool) to patch the corrupted fields (`full_name`, `company_current`, `title_current`, `major`) by matching against the primary key or `email_primary`.

### Option 2: Mapping CSV Replacement (Alternative)
If a clean source export is unavailable:
1. Export the affected IDs and corrupted strings.
2. Build a mapping CSV containing: `person_id`, `corrupted_value`, `corrected_value`.
3. Manually review and correct the `corrected_value` column.
4. Run a targeted SQL update script that strictly updates rows based on the explicit `person_id` and `corrected_value` mapping.

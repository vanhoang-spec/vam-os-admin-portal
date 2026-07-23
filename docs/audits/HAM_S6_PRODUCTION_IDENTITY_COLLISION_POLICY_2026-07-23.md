# HAM-S6 Production Import — Identity Collision Policy
## 2026-07-23

This document defines the exact behavior for every identity resolution case
in the HAM-S6 production foundation import.

---

## Mandatory rules (non-negotiable)

1. **No name-only automatic merge.** A person in the HAM source CSV who matches an
   existing `people` row by name only (no email, no phone confirmation) must NEVER be
   automatically linked. The row is logged to the skip/audit table and excluded.

2. **No ambiguous automatic merge.** A source person who matches more than one existing
   `people` row by any key must NEVER be automatically linked. The row is logged and
   excluded.

3. **No overwrite of existing person identity fields.** An existing `people` row that is
   reused for a HAM person must NOT have its `full_name`, `email_primary`, `phone_primary`,
   or `gender` updated. Only new rows are inserted; existing rows are read, not modified.

4. **No conversion of UEH profiles into HAM profiles.** A person who has an existing
   `mentor_profiles` or `mentee_profiles` linked to a UEHM season must NOT have those
   profiles modified or replaced. HAM-S6 adds a new profile row (if no HAM-S6-B1 profile
   exists) or skips if one already exists — it never touches UEHM-linked rows.

5. **Shared people may receive separate program/season participation only.** A person
   appearing in both UEH and HAM receives separate season membership rows, separate
   profile rows (scoped to their respective batches), and separate match rows (scoped to
   their respective seasons). No cross-program data is merged.

6. **Ambiguous records fail closed.** Any row that cannot be definitively resolved to
   either a single existing person or a definitive new person is excluded, logged, and
   skipped. Partial data is never written for ambiguous rows.

7. **All reused people must be reported in aggregate and auditable.** Every existing
   person linked to a HAM-S6 source row must be counted in the post-import aggregate and
   logged in the identity map with the link reason.

8. **No silent conflict resolution.** Every skip, every ambiguous match, and every
   existing-person link must be recorded in an auditable log row. No row is silently
   discarded.

---

## Case-by-case policy

### Case 1: Exact legacy identifier match

**Definition:** Source person's normalized email matches exactly one existing `people.email_primary` (normalized).

**Action:** REUSE existing person. Link the source row to the existing `people.id`. Do NOT insert a new `people` row. Do NOT modify the existing row. Log the link with method = `email_match` and reason = `existing_email_in_production`.

**Production note:** The staging import linked 2 people by email/phone match, using staging-only UUIDs from the dry-run CSV. In production, the identity resolution must query the PRODUCTION `people` table directly — the staging dry-run UUIDs must not be reused.

---

### Case 2: Exact normalized email match

Same as Case 1. Email match is the primary and most reliable resolution method.

---

### Case 3: Existing person in another program

**Definition:** Source person's email matches an existing `people` row that already has mentor or mentee profiles linked to a UEHM or other non-HAM season.

**Action:** REUSE existing person. Link the source row to the existing `people.id`. Create a HAM-S6 mentor_profile or mentee_profile for that person (scoped to the HAM-S6-B1 batch), subject to the no-existing-profile guard. Do NOT modify the existing person's UEHM-linked profiles.

---

### Case 4: Same person participating in HAM and UEH

This is a sub-case of Case 3. The person has existing UEHM profiles and will also receive HAM-S6 profiles.

**Action:**
- REUSE existing `people` row
- CREATE new `mentor_profiles` or `mentee_profiles` linked to HAM-S6-B1 (if not already present)
- CREATE new HAM-S6 match row (if not already present)
- Do NOT touch existing UEHM profiles, UEHM matches, or UEHM memberships
- Log in identity map and post-import aggregate

---

### Case 5: Duplicate source identity (same person appears twice in source CSV)

`duplicate_email_values_in_source: 0` — no email duplicates found in source data.

**Action if encountered:** Log both rows to skip table with reason = `duplicate_source_identity`. Import only the first occurrence (lowest source_row). Do not create two person rows for the same email.

---

### Case 6: Ambiguous name-only match

**Definition:** Source person has no email or phone, or email/phone matching found zero results, and a name-key search returns exactly one existing person but with no confirming identifier.

**Action:** SKIP. Log to skip table with reason = `unsafe_name_only_match`. Do NOT link. Do NOT create new person. This row will NOT be imported automatically and requires manual owner review.

**In staging:** 4 rows were skipped for this reason. The same 4 rows will be skipped in production unless the owner separately resolves them.

---

### Case 7: Conflicting email/legacy ID (email matches one person, phone matches a different person)

**Action:** SKIP both. Log with reason = `conflicting_identifier_match`. Do NOT auto-resolve. Escalate to owner.

---

### Case 8: Missing email

**Definition:** Source person has no email_primary value.

**Action (current staging behavior):** No email-based deduplication guard applies. The production module MUST add an explicit check:
- If phone matches an existing person uniquely → REUSE (log as `phone_match`)
- If phone matches multiple → SKIP (log as `ambiguous_phone_match`)
- If no phone match → CREATE new person (with null email_primary)
- On rerun: a person with null email has NO deduplication guard in the staging script — the production module must add one (e.g., check by normalized `full_name + role` or add a source_row marker to `data_quality_flags` to detect reruns).

---

### Case 9: Missing legacy ID

Not applicable. HAM source data uses email as the primary identity key, not a legacy numeric ID.

---

### Case 10: Mentor and mentee dual role

**Definition:** The same person appears once as a mentor and once as a mentee in the source CSV (the 1 duplicate name found in identity resolution).

**Action:** Treat as two separate source rows. If email is the same, they share one `people` row but receive:
- One `mentor_profiles` row (linked to HAM-S6-B1)
- One `mentee_profiles` row (linked to HAM-S6-B1)
- Match rows for both roles

If the emails differ, treat as two different people.

---

### Case 11: Existing profile of same role for the resolved person

**Definition:** Source person resolves to an existing `people.id`, and that person already has a `mentor_profiles` row linked to `HAM-S6-B1`.

**Action (from ham_s6_03):** SKIP profile creation. The `NOT EXISTS (... mp.person_id = r.person_id ...)` guard prevents duplicate profile creation. This guard is global (not scoped to HAM-S6-B1), meaning if the person has ANY mentor_profile anywhere, no new one is created.

**Production review point:** The global guard could suppress a legitimate new HAM-S6-B1 profile for a UEHM mentor. The production module should check whether an existing profile is linked to HAM-S6-B1 specifically (not globally), to correctly create a HAM-S6-B1 profile even if a UEHM profile exists.

---

### Case 12: Existing profile of opposite role for the resolved person

**Definition:** Source person resolves to an existing `people.id`, and that person has a `mentee_profiles` row, but the source row adds a `mentor_profiles` for this person (or vice versa).

**Action:** CREATE the new profile. Profiles for opposite roles are independent. A person can have both mentor and mentee profiles.

---

## Skip log

Every skipped row must produce a record in the audit/skip table with:
- `import_step`: which step skipped it (people / profiles / matches)
- `source_row`: integer row number from source CSV
- `issue_reason`: one of the reason codes above
- `sanitized_payload`: jsonb with only non-PII fields (source_row, source_file, source_sheet, boolean flags, counts — no names, emails, phones)

---

## Post-import reporting requirements

After the import, the owner must review:
- Total people created (new rows)
- Total people reused (existing-person links)
- Total people skipped (manual review)
- Total mentor profiles created
- Total mentee profiles created
- Total active matches created
- Total skipped matches

Any reused people count must be reconcilable against the identity map log.

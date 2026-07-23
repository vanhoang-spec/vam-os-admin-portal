# HAM-S6 Production Import — Field Mapping
## 2026-07-23

Every source field from `ham_people_clean.csv` and `ham_matches_clean.csv` mapped
to its canonical production destination. Each field is classified by destination type.

**Classification legend:**
- `CANONICAL` — maps directly to a column that exists in production
- `DERIVED` — value is computed or composed from source; stored in a canonical column
- `RELATIONAL` — stored as a FK resolved at runtime; source value is the lookup key
- `OPTIONAL` — exists in production schema but may be null; populated from source
- `SOURCE-ONLY` — preserved in `data_quality_flags` or `bio_short` provenance note only
- `UNSUPPORTED` — column absent from production schema; import does not write this field

---

## People source fields (`ham_people_clean.csv`)

| Source field | Source column | Classification | Production destination | Notes |
|---|---|---|---|---|
| Row number | `row_num` | SOURCE-ONLY | `people.data_quality_flags` | `source_row=<n>` in provenance note |
| Source file | `source_file` | SOURCE-ONLY | `people.source_sheets`, `people.data_quality_flags` | `HAM_S6 \| <file> \| <sheet>` in source_sheets; `source_row=<n>` in flags |
| Source sheet | `source_sheet` | SOURCE-ONLY | `people.source_sheets`, `people.data_quality_flags` | Same as above |
| Import readiness | `import_ready` | SOURCE-ONLY | — | Used as filter (`= 'TRUE'`); not stored |
| Role | `role` / `ham_role` | RELATIONAL | `person_season_memberships.role` | `'mentor'` or `'mentee'`; resolved via `lower(ham_role)` in module 04 |
| Full name | `full_name` | CANONICAL | `people.full_name` | Stored as-is from source |
| Email | `email` / `email_norm` | CANONICAL | `people.email_primary` | Lowercased, trimmed; used for identity resolution |
| Phone | `phone` / `phone_norm` | CANONICAL | `people.phone_primary` | Digits only (non-digit stripped); optional |
| Gender | `gender` | CANONICAL | `people.gender` | `nullif(gender, '')` — null if blank |
| School | `school` | SOURCE-ONLY | `people.data_quality_flags` | `school=<val>` in provenance note; also used for `mentee_profiles.school_raw` and `university` |
| Company | `company` | SOURCE-ONLY | `people.data_quality_flags` | `company=<val>` in provenance note; also used for `mentor_profiles.company_current` and `current_company` |
| Title | `title` | SOURCE-ONLY | `people.data_quality_flags` | `title=<val>` in provenance note; also used for `mentor_profiles.title_current` and `current_title` |
| Expertise | `expertise` | SOURCE-ONLY | `people.data_quality_flags` | `expertise=<val>` in provenance note; also used for `mentor_profiles.function_area` and `mentee_profiles.target_function` / `career_interest` |
| Field | `field` | SOURCE-ONLY | `people.data_quality_flags` | `field=<val>` in provenance note; also used for `mentor_profiles.industry` and `mentee_profiles.target_industry` |
| LinkedIn URL | `linkedin` | SOURCE-ONLY | `people.data_quality_flags` | `linkedin=<url>` in provenance note. **`mentor_profiles.linkedin_url` is absent from production schema — field is not written to mentor_profiles** |
| VAM profile link | `vam_profile_link` | SOURCE-ONLY | `people.data_quality_flags` | `vam_profile_link=<url>` in provenance note; also used for `mentor_profiles.bio_url` |

---

## Mentor profile fields (written by module 04)

| Destination column | Source | Classification | Notes |
|---|---|---|---|
| `mentor_profiles.person_id` | `_ham_prod_identity_map.person_id` | RELATIONAL | UUID resolved by module 03 identity map |
| `mentor_profiles.mentor_code` | Computed | DERIVED | `'HAM-S6-MENTOR-NNN'` via `row_number()` |
| `mentor_profiles.bio_url` | `vam_profile_link` | OPTIONAL | `nullif(r.vam_profile_link, '')` |
| `mentor_profiles.company_current` | `company` | OPTIONAL | `nullif(r.company, '')` |
| `mentor_profiles.title_current` | `title` | OPTIONAL | `nullif(r.title, '')` |
| `mentor_profiles.current_company` | `company` | OPTIONAL | Same as `company_current` |
| `mentor_profiles.current_title` | `title` | OPTIONAL | Same as `title_current` |
| `mentor_profiles.industry` | `field` | OPTIONAL | `nullif(r.field, '')` |
| `mentor_profiles.function_area` | `expertise` | OPTIONAL | `nullif(r.expertise, '')` |
| `mentor_profiles.first_vam_season` | Hardcoded | DERIVED | `'HAM-S6'` — literal string code |
| `mentor_profiles.bio_short` | Computed | DERIVED | Provenance note with `source_row`, `field`, `expertise` |
| ~~`mentor_profiles.linkedin_url`~~ | ~~`linkedin`~~ | **UNSUPPORTED** | **Column absent from production schema. LinkedIn URL preserved in `people.data_quality_flags` only.** |
| `mentor_profiles.intake_batch_id` | `_ham_prod_context.intake_batch_id` | RELATIONAL | UUID for HAM-S6-B1 resolved at runtime |

---

## Mentee profile fields (written by module 04)

| Destination column | Source | Classification | Notes |
|---|---|---|---|
| `mentee_profiles.person_id` | `_ham_prod_identity_map.person_id` | RELATIONAL | UUID resolved by module 03 identity map |
| ~~`mentee_profiles.status`~~ | ~~hardcoded `'active'`~~ | **UNSUPPORTED** | **Column absent from production schema. Lifecycle status is in `person_season_memberships.status`.** |
| `mentee_profiles.mentee_code` | Computed | DERIVED | `'HAM-S6-MENTEE-NNN'` via `row_number()` |
| `mentee_profiles.school_raw` | `school` | OPTIONAL | `nullif(r.school, '')` |
| `mentee_profiles.university` | `school` | OPTIONAL | Same as `school_raw` |
| `mentee_profiles.career_interest` | `field` or `expertise` | OPTIONAL | `nullif(coalesce(field, expertise), '')` |
| `mentee_profiles.target_industry` | `field` | OPTIONAL | `nullif(r.field, '')` |
| `mentee_profiles.target_function` | `expertise` | OPTIONAL | `nullif(r.expertise, '')` |
| `mentee_profiles.mentee_status` | Hardcoded | CANONICAL | `'active'` — profile-level status; this column exists in production |
| `mentee_profiles.intake_batch_id` | `_ham_prod_context.intake_batch_id` | RELATIONAL | UUID for HAM-S6-B1 resolved at runtime |

---

## Season membership fields (written by module 04)

| Destination column | Source | Classification | Notes |
|---|---|---|---|
| `person_season_memberships.person_id` | `_ham_prod_identity_map.person_id` | RELATIONAL | UUID from identity map |
| `person_season_memberships.program_id` | `_ham_prod_context.program_id` | RELATIONAL | UUID for HAM program resolved at runtime |
| `person_season_memberships.season_id` | `_ham_prod_context.season_id` | RELATIONAL | UUID for HAM-S6 resolved at runtime |
| `person_season_memberships.role` | `_ham_prod_identity_map.ham_role` | CANONICAL | `lower(ham_role)` = `'mentor'` or `'mentee'` |
| `person_season_memberships.status` | Hardcoded | CANONICAL | `'active'` |

---

## Match fields (`ham_matches_clean.csv`, written by module 05)

| Destination column | Source | Classification | Notes |
|---|---|---|---|
| `matches.mentor_id` | `_ham_prod_match_ready.mentor_person_id` | RELATIONAL | Resolved from identity map by mentor email |
| `matches.mentee_id` | `_ham_prod_match_ready.mentee_person_id` | RELATIONAL | Resolved from identity map by mentee email |
| ~~`matches.season_code`~~ | ~~hardcoded `'HAM-S6'`~~ | **UNSUPPORTED** | **Column absent from production schema. Season is linked via `season_id` FK.** |
| `matches.season_id` | `_ham_prod_context.season_id` | RELATIONAL | UUID for HAM-S6; canonical season link |
| `matches.status` | Hardcoded | CANONICAL | `'active'` |
| `matches.mentor_person_id` | `_ham_prod_match_ready.mentor_person_id` | RELATIONAL | Denormalized person UUID for mentor |
| `matches.mentee_person_id` | `_ham_prod_match_ready.mentee_person_id` | RELATIONAL | Denormalized person UUID for mentee |
| `matches.match_type` | Hardcoded | CANONICAL | `'primary'` |
| `matches.match_source_raw` | Hardcoded | DERIVED | `'HAM_S6 production import'` |
| `matches.match_confidence` | Hardcoded | DERIVED | `1.0` |
| `matches.notes` | Computed | DERIVED | Provenance note with `source_file`, `source_sheet`, `source_row`, `direction` |
| `matches.match_reason` | `direction` | OPTIONAL | `nullif(direction, '')` |
| `matches.primary_match` | Hardcoded | CANONICAL | `true` |

---

## Fields not imported (intentionally excluded)

| Field | Reason |
|---|---|
| `people.role` | Column absent from production — role tracked via `person_season_memberships.role` |
| `mentor_profiles.linkedin_url` | Column absent from production — URL preserved in `data_quality_flags` |
| `mentee_profiles.status` | Column absent from production — lifecycle tracked via `person_season_memberships.status` |
| `matches.season_code` | Column absent from production — season linked via `season_id` FK |
| Auth user identities | Out of scope for foundation import — separate Gate H authorization required |
| `admin_users` rows | Out of scope for foundation import |
| `admin_scope_access` rows | Out of scope for foundation import |
| `mentoring_recaps` | Not part of foundation import scope |
| `events` | Not part of foundation import scope |

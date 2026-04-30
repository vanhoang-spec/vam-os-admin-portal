# Season 11 Reference Export Diagnostic

Generated: 2026-04-30

## Executive Finding

The March 2026 offline mapper was rerun with `--reference-source=production`, but mapping still returned **0.00% success**:

| Metric | Count |
| --- | ---: |
| Total March source rows | 286 |
| Mapped rows | 0 |
| Mapped with warnings rows | 0 |
| Missing mentor rows | 286 |
| Missing mentee rows | 286 |
| Ready for import rows | 0 |

The selected production reference exports do **not** appear to contain real Season 11 reference data. They still look like validation/test fixture exports, so the March import remains blocked.

This diagnostic is documentation-only. No Supabase writes, import execution, dashboard RPC changes, deploys, commits, pushes, or sensitive reference export edits were performed.

## Evidence

The regenerated mapping report identifies `production` as the reference source:

```powershell
node .\scripts\map-season11-march-offline.mjs --reference-source=production
```

Reference inputs loaded:

| Production export | Rows loaded |
| --- | ---: |
| `people_production.csv` | 50 |
| `mentee_profiles_production.csv` | 33 |
| `mentor_profiles_production.csv` | 17 |
| `matches_uehm_s11_production.csv` | 30 |
| `mentoring_recaps_march_2026_production.csv` | 23 |

Non-sensitive quality checks from the mapping report:

| Check | Count |
| --- | ---: |
| Unique source mentee code keys | 220 |
| Reference profile code keys | 33 |
| Source-to-profile code matches | 0 |
| Unique source mentor name keys | 184 |
| Reference people name keys | 50 |
| Source-to-people mentor name matches | 0 |
| Synthetic-looking people names | 50 |
| Synthetic/test email rows | 50 |
| Synthetic-looking mentee codes | 33 |
| Synthetic-looking mentor codes | 17 |

Additional local file comparison found that several `reference_exports_production` files are byte-identical to the staging fixture exports:

| File pair | Same content |
| --- | --- |
| `mentee_profiles_staging.csv` / `mentee_profiles_production.csv` | Yes |
| `mentor_profiles_staging.csv` / `mentor_profiles_production.csv` | Yes |
| `matches_uehm_s11_staging.csv` / `matches_uehm_s11_production.csv` | Yes |
| `mentoring_recaps_march_2026_staging.csv` / `mentoring_recaps_march_2026_production.csv` | Yes |

The local exports show validation/test signals such as staging/validation identity labels, test email domains, and validation code prefixes. Real March source mentee identifiers use `UEH*`-style codes, but the loaded reference profile code set has no overlap.

## Why Mapping Cannot Proceed

The mapper depends on real identity overlap:

- Mentees must resolve from source `mentee_identifier_mssv` / `mentee_identifier_edit` to `mentee_profiles.mssv`, `mentee_profiles.mentee_code`, or equivalent real student-code field.
- Mentors must resolve from source `mentor_identifier_name` to `people.full_name` or email.
- Match IDs must resolve from mapped `mentor_person_id + mentee_person_id` against UEHM-S11 matches.

With the current production export files:

- zero source mentee codes match profile code keys;
- zero source mentor names match people names;
- all rows remain without usable `mentor_person_id` and `mentee_person_id`;
- no match IDs or duplicate checks can be meaningfully resolved.

Changing import logic would not fix this. The blocker is the reference data content.

## Supabase Production Checks To Run

Run these checks in the Supabase production SQL editor or another approved read-only production connection. Do not paste sensitive result rows into Git-tracked files.

### Verify Project Ref

Confirm you are connected to the intended production project before exporting:

```sql
select current_database() as database_name, current_schema() as schema_name;
```

Also verify the project ref in the Supabase dashboard URL and compare it against the known production project ref from the team's credential vault.

### Sample People

Use this only as a screen check. Do not commit the output.

```sql
select
  id,
  full_name,
  role,
  email_primary,
  created_at
from public.people
order by created_at desc
limit 20;
```

Expected: real people names/emails from the Season 11 dataset, not validation/test identities.

### Counts For People, Profiles, Matches

```sql
select 'people' as table_name, count(*) as row_count from public.people
union all
select 'mentee_profiles', count(*) from public.mentee_profiles
union all
select 'mentor_profiles', count(*) from public.mentor_profiles
union all
select 'matches', count(*) from public.matches
union all
select 'mentoring_recaps', count(*) from public.mentoring_recaps
order by table_name;
```

Expected: production-scale counts, not tiny validation fixture counts such as 50 people, 33 mentee profiles, 17 mentor profiles, and 30 matches.

### Season Counts

```sql
select
  s.code,
  count(distinct m.id) as match_count,
  count(distinct m.mentor_person_id) as mentor_count,
  count(distinct m.mentee_person_id) as mentee_count
from public.seasons s
left join public.matches m on m.season_id = s.id
group by s.code
order by s.code;
```

Expected: `UEHM-S11` should appear with real operational scale.

### UEHM-S11 Match Count

```sql
select
  s.code,
  count(*) as match_count,
  count(distinct m.mentor_person_id) as mentor_count,
  count(distinct m.mentee_person_id) as mentee_count
from public.matches m
join public.seasons s on s.id = m.season_id
where s.code = 'UEHM-S11'
group by s.code;
```

Expected: hundreds-scale Season 11 match/participant data, not validation-pair fixtures.

### Spot Check UEHM-S11 Match Identities

Use for visual confirmation only. Do not commit output.

```sql
select
  m.id as match_id,
  mentor.full_name as mentor_name,
  mentor.email_primary as mentor_email,
  mentee.full_name as mentee_name,
  mp.mentee_code,
  mp.mssv,
  m.status
from public.matches m
join public.seasons s on s.id = m.season_id
left join public.people mentor on mentor.id = m.mentor_person_id
left join public.people mentee on mentee.id = m.mentee_person_id
left join public.mentee_profiles mp on mp.person_id = m.mentee_person_id
where s.code = 'UEHM-S11'
order by mentor.full_name nulls last, mentee.full_name nulls last
limit 25;
```

Expected: real mentor names and `UEH*`-style mentee identifiers that can overlap with `season11_march_source_review.csv`.

## Minimum Expected Real-Data Signals

Before rerunning the mapper, the reference exports should show these signals:

- Real names and emails, not `Staging Mentee`, `Validation Mentor`, `@vam.test`, or `@ops-validation.vam.test`.
- Mentee identifiers that overlap the March source, especially `UEHEF*`, `UEHEM*`, or `UEHSF*` values in `mssv`, `mentee_code`, or the real student-code field.
- UEHM-S11 matches connecting real `mentor_person_id` and `mentee_person_id`.
- Season 11 scale roughly in the hundreds of people/profiles/matches, not the current small validation fixture counts.
- Existing March recap exports, if any, should be from real March 2026 recaps, not `ops_validation` fixtures.

## Go / No-Go

**March import: No-Go.**

The ready-for-import CSV currently has 0 import-ready rows. Executing an import from this mapped output would either import nothing useful or require unsafe manual overrides.

**Dashboard RPC rewrite: blocked.**

The dashboard closed-month rewrite should remain blocked until the March import and/or closed KPI rows are valid and reviewed. Rewriting dashboard RPCs before a trustworthy March closed-month dataset exists risks formalizing bad or empty operational data.

## Next Steps

1. Obtain real production read-only exports, or seed staging with real Season 11 people, profiles, and matches from an approved source.
2. Keep those exports under an ignored local folder such as `data_imports/season11/reference_exports_production/`.
3. Confirm the exports show real-data signals and have source identifier overlap before mapping.
4. Rerun the mapper only after real reference exports are available:

```powershell
node .\scripts\map-season11-march-offline.mjs --reference-source=production
```

5. Review `docs/data_audit/SEASON11_MARCH_MAPPING_RESULT_REPORT.md` and `data_imports/season11/season11_march_ready_for_import.csv`.
6. Proceed toward import planning only after mapped rows, warnings, duplicate candidates, missing matches, and placeholder URLs are explicitly reviewed and approved.

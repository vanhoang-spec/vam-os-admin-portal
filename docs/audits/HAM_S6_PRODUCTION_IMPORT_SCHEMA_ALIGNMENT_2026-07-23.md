# HAM-S6 Production Import — Schema Alignment
## 2026-07-23

This document proves the canonical production representation for each column
that was absent from production but referenced by the original import modules.
It records the import action taken for each gap.

**Preflight decision that triggered this work:**
`3. HAM-S6 PREFLIGHT BLOCKED BY SCHEMA` — 4 columns absent from production;
all 4 were referenced in INSERT column lists in modules 03, 04, and 05.

**Resolution path chosen by owner:**
Path B — adapt import modules to canonical production schema.
Do not add legacy columns merely to make old import SQL run.

---

## Canonical column mapping

| Legacy column | Table | Legacy purpose | Canonical production representation | Import action | Evidence |
|---|---|---|---|---|---|
| `people.role` | `people` | Denormalized person role label (`mentor`/`mentee`) | `person_season_memberships.role` — check-constrained text field; one row per `(person_id, season_id, role)` | Remove `role` from `people` INSERT; module 04 already inserts `person_season_memberships` rows with `role = lower(ham_role)` for each imported person | Migration 052 creates `person_season_memberships` with `role check(role in ('mentor','mentee',...))` |
| `mentor_profiles.linkedin_url` | `mentor_profiles` | Optional LinkedIn profile URL for mentor | No canonical equivalent column. URL is preserved in `people.data_quality_flags` as `linkedin=<url>` in the provenance note written by module 03 | Remove `linkedin_url` from `mentor_profiles` INSERT; the value is already preserved in `people.data_quality_flags` | Migration 043 adds `source_application_id` and `intake_batch_id` to `mentor_profiles`; no `linkedin_url` column is added; the production schema does not include this column |
| `mentee_profiles.status` | `mentee_profiles` | Lifecycle status field (e.g. `active`) | `person_season_memberships.status` — check-constrained text field with lifecycle values (`active`, `paused`, `withdrawn`, `completed`, etc.) | Remove `status` from `mentee_profiles` INSERT; lifecycle status is recorded in `person_season_memberships` by module 04. Note: `mentee_profiles.mentee_status` is also absent from production (confirmed by V2 preflight — see Final status-field resolution section) | Migration 052 creates `person_season_memberships` with `status check(status in ('invited','active','paused','withdrawn','completed','graduated','opted_out','cancelled'))` |
| `matches.season_code` | `matches` | Denormalized season code string (`HAM-S6`) | `matches.season_id` (UUID FK to `seasons`) — already present and populated by module 05 via cross join with `_ham_prod_context` | Remove `season_code` from `matches` INSERT; season identity is already captured by `season_id` (resolved from `seasons.code = 'HAM-S6'` in `_ham_prod_context`) | Migration 046a defines the matches table schema as used in production; `season_code` is absent; `season_id uuid references public.seasons(id)` is the canonical link |

---

## Additional correctness fix (beyond the 4 reported columns)

During alignment, module 04's `person_season_memberships` INSERT was found to omit
`program_id`, which is declared `NOT NULL` in the table definition (migration 052). This
omission would cause the INSERT to fail at execution. The fix adds `program_id` to the
INSERT column list, resolving it from `_ham_prod_context.program_id`.

This is not a schema-gap issue (the column exists in production) — it is a pre-existing
correctness bug in the original module. It is fixed as part of this alignment.

---

## Canonical write path after alignment

After alignment, the import produces these rows:

| Table | Rows created | Role column | Notes |
|---|---|---|---|
| `public.people` | 104–108 new people | No `role` column — role is not in `people` | `data_quality_flags` preserves all source metadata including `linkedin=<url>` |
| `public.mentor_profiles` | 45–52 mentor profiles | — | No `linkedin_url`; `intake_batch_id` links to HAM-S6-B1 |
| `public.mentee_profiles` | 55–60 mentee profiles | — | No `status`; no `mentee_status` (both absent from production — see Final status-field resolution below); lifecycle status in `person_season_memberships` |
| `public.matches` | 45–52 matches | — | No `season_code`; season linked via `season_id` FK |
| `public.person_season_memberships` | 104–108 memberships | `role = 'mentor'` or `'mentee'` | `program_id` from `_ham_prod_context`; `status = 'active'` |

---

## Proof of canonical representations

### `person_season_memberships.role` for `people.role`

Migration 052 defines:
```sql
create table if not exists public.person_season_memberships (
  ...
  role text not null,
  ...
  constraint person_season_memberships_role_check
    check (role in (
      'mentee', 'mentor', 'supporter', 'reviewer',
      'interviewer', 'coreteam', 'advisor', 'alumni_mentee', 'guest'
    )),
  ...
);
```

Module 04 already inserts into this table:
```sql
insert into public.person_season_memberships (person_id, program_id, season_id, role, status)
select
  m.person_id,
  (select program_id from _ham_prod_context),
  (select season_id from _ham_prod_context),
  lower(m.ham_role),   -- 'mentor' or 'mentee'
  'active'
from _ham_prod_identity_map m
where m.person_id is not null
on conflict (person_id, season_id, role) do nothing;
```

The `ham_role` field flows through `_ham_prod_ready` → `_ham_prod_identity_map` → module 04.

### `linkedin_url` preservation via `data_quality_flags`

Module 03 already captures the linkedin URL in the provenance note written to `data_quality_flags`:
```sql
'linkedin=' || coalesce(c.linkedin, ''),
```

This field is present in `public.people` (confirmed by preflight Gate 6) and survives
even if the module is re-run (rerun protection blocks duplicate people creation).

### `person_season_memberships.status` for `mentee_profiles.status` and `mentee_profiles.mentee_status`

The same membership INSERT above writes `status = 'active'` for each HAM-S6 person.
Neither `mentee_profiles.status` nor `mentee_profiles.mentee_status` exists in production
(confirmed by preflight V2 execution). The canonical lifecycle status is exclusively
`person_season_memberships.status`, which is already populated by module 04.

### `matches.season_id` for `matches.season_code`

Module 05 already populates `season_id` via:
```sql
cross join _ham_prod_context ctx
```
where `_ham_prod_context` resolves:
```sql
select p.id as program_id, s.id as season_id, ib.id as intake_batch_id
from public.programs p
join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
where p.code = 'HAM'
```

The `season_id` UUID is the canonical FK. No denormalized string code is needed.

---

## Final status-field resolution (preflight V2 finding — 2026-07-23)

The V2 preflight execution (2026-07-23T03:23:06.076Z) revealed one additional absent column:

| Legacy field | Table | Production status | Canonical representation | Final action |
|---|---|---|---|---|
| `mentee_profiles.mentee_status` | `mentee_profiles` | **ABSENT from production** (confirmed by V2 preflight Gate 6) | `person_season_memberships.status = 'active'` | Remove from module 04 `mentee_profiles` INSERT |

**Evidence:** Migration 025 added `mentee_status` via `add column if not exists`, but the V2
preflight probe, running directly against the production database
(`qkkroesfiazsejkzflcd`, 2026-07-23T03:23:06.076Z), returned:
```
"mentee_profiles.mentee_status": false
```

The authoritative source is the live production probe result, not the migration file.

**Status fields on mentee_profiles in production:**
- `mentee_profiles.status` — ABSENT (removed in prior alignment pass)
- `mentee_profiles.mentee_status` — ABSENT (confirmed by V2 preflight)

No status field exists on `mentee_profiles` in production. Mentee lifecycle status
is exclusively tracked in `person_season_memberships.status`, which is:
- Confirmed PRESENT in production (preflight V2 Gate 6 pass)
- Already written by module 04's `person_season_memberships` INSERT with `status = 'active'`
- Check-constrained to `('invited','active','paused','withdrawn','completed','graduated','opted_out','cancelled')`

**Information loss: NONE.** Lifecycle status is already captured in the canonical location.

**Preflight version after this fix:** V3 (`HAM_S6_PRODUCTION_IMPORT_PREFLIGHT_V3`)
- `mentee_profiles.mentee_status` removed from required-column checks
- All 32 remaining canonical columns are confirmed PRESENT in production

---

## Updated canonical write path after final alignment

| Table | Rows created | Status tracking | Notes |
|---|---|---|---|
| `public.people` | 104–108 new people | No status column | `data_quality_flags` preserves all source metadata |
| `public.mentor_profiles` | 45–52 mentor profiles | No status column | `intake_batch_id` links to HAM-S6-B1 |
| `public.mentee_profiles` | 55–60 mentee profiles | No status column | Neither `status` nor `mentee_status` exists in production |
| `public.matches` | 45–52 matches | `status = 'active'` (canonical enum) | Season linked via `season_id` FK |
| `public.person_season_memberships` | 104–108 memberships | `status = 'active'` (canonical lifecycle) | `program_id`, `season_id`, `role` all present and written |

---

## Safety constraints (unchanged)

- Do not execute SQL
- Do not connect to production or staging
- Do not mutate any database
- Do not run migrations
- Do not import data
- Do not create accounts
- Do not run migration 061
- Do not deploy
- Do not merge automatically

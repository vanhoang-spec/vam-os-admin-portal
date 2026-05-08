# HAM Season 6 Staging Foundation Import Result

Status: staging foundation import completed; no production write; no recap/event import.

Date: 2026-05-07

## Scope And Safety

This report reconciles the HAM-S6 staging foundation import after:

- `ham_s6_02_import_people.sql` succeeded.
- `ham_s6_03_import_profiles_matches.sql` succeeded after the seed context fix.
- Verification was run on staging.

No raw names, emails, phones, or social URLs are included in this report.

## Imported Foundation Objects

| Object | Result |
|---|---:|
| HAM program | present |
| HAM-S6 season | present |
| HAM-S6-B1 intake batch | present |
| Identity map rows | 108 |
| New people created | 106 |
| Existing people linked | 2 |
| Mentor profiles linked to HAM-S6-B1 | 48 |
| Mentee profiles linked to HAM-S6-B1 | 58 |
| HAM-S6 matches imported | 52 |
| Duplicate mentor/mentee match pairs | 0 |
| HAM-S6 recaps imported | 0 |
| HAM-S6 events imported | 0 |
| HAM-S6 event participations imported | 0 |

## Skip Summary

| Step | Reason | Count |
|---|---|---:|
| people | `manual_review_identity` | 4 |
| matches | `unresolved_mentor` | 7 |
| matches | `unresolved_mentee` | 1 |

## 52 vs 56 Match Reconciliation

Original dry-run expected 56 imported matches from 60 source match rows, assuming 4 rows would be skipped because of unsafe identity candidates.

Actual result:

- 60 match source rows were import-ready.
- 8 match source rows were skipped.
- 52 match rows were imported.

The 8 skipped match rows break down as follows:

| Category | Count | Side | Explanation |
|---|---:|---|---|
| Manual-review identity | 3 | mentor | Mentor identity was intentionally excluded from the identity map. |
| Manual-review identity | 1 | mentee | Mentee identity was intentionally excluded from the identity map. |
| No matching people source | 2 | mentor | Match source mentor string had no resolved HAM people-source identity and no mentor email fallback. |
| SQL name-key mismatch | 2 | mentor | A mentor identity existed in the imported identity set under stronger local normalization, but script 03's SQL name-key join did not match the match-source mentor string; the match source had no mentor email fallback. |

The extra 4 skips beyond the expected 4 are therefore all mentor-side resolution misses:

- 2 rows: no matching people-source identity.
- 2 rows: SQL name-key/source spelling mismatch.

They were not caused by duplicate match pairs, missing source rows, profile creation failure, or recap/event import behavior.

## Redacted Skipped Match Rows

Only source row numbers and redacted IDs are shown.

| Source row | Redacted ID | Skip reason | Mentor-side diagnosis | Mentee-side diagnosis |
|---:|---|---|---|---|
| 9 | `4cf397ea70aa54d6f8d662887e00e294` | `unresolved_mentor` | no matching people source | resolved |
| 13 | `eaa1556825f3b5f1244cbac7f7a18fd5` | `unresolved_mentee` | resolved | manual-review identity |
| 14 | `c761ae9b79a9f724f052b6b60af3bd31` | `unresolved_mentor` | manual-review identity | resolved |
| 15 | `aba6c361bffb726c5a28a93e209744bd` | `unresolved_mentor` | SQL name-key mismatch | resolved |
| 25 | `ab2d9f777a1fed00af06afb4619c8c9c` | `unresolved_mentor` | manual-review identity | resolved |
| 39 | `b72f1a6df2a4acc8837c607754310977` | `unresolved_mentor` | manual-review identity | resolved |
| 41 | `40b272c04819a1312c8db7fede2672e5` | `unresolved_mentor` | no matching people source | resolved |
| 61 | `7f36363dd5a8bc60a6f0b22abd1dc9ca` | `unresolved_mentor` | SQL name-key mismatch | resolved |

All skipped match source rows had mentee email present. All unresolved mentor rows lacked mentor email fallback, so script 03 relied on name-key matching for the mentor side.

## Consistency Checks

HAM-S6 imported matches are internally consistent:

- Total matches: 52.
- Missing mentor or mentee person side: 0.
- Missing season: 0.
- Non-active match status: 0.
- Duplicate mentor/mentee pairs: 0.

Profiles are linked to HAM-S6-B1 by `intake_batch_id`:

- Mentor profiles: 48.
- Mentee profiles: 58.

No later-phase data was imported:

- Recaps: 0.
- Events: 0.
- Event participations: 0.

## Conclusion

The staging foundation import is acceptable as a conservative import.

Rollback is not recommended at this point because:

- Imported rows are internally consistent.
- Skipped rows are isolated in `staging_ham_s6_import_skips`.
- The extra skips are safe false negatives, not unsafe false positives.
- No recaps/events were imported.

Proceed to staging browser QA before any attempt to resolve the remaining 8 skipped match rows.

## Recommended Next Steps

1. Run staging browser QA for program-scoped access:
   - super_admin sees HAM.
   - UEHM-only scoped user cannot see HAM.
   - HAM-scoped user sees HAM.
   - multi-scope user sees UEHM + HAM.
2. Review the 8 skipped match source rows manually in the private CSV/helper tables.
3. For the 2 SQL name-key mismatch rows, consider a script 03 normalization patch or explicit redacted identity override table before rerunning any match import.
4. For the 2 no-matching-people-source rows and 4 manual-review rows, resolve identity manually before any future import.
5. Do not import recaps/events until foundation QA passes and target modeling is approved.

## Read-Only Validation SQL

Use on staging only. These queries do not print raw PII.

```sql
select 'identity_map_by_action' as section, action as key, count(*)::int as count
from public.staging_ham_s6_people_identity_map
group by action
union all
select 'skips_by_step_reason', import_step || ':' || issue_reason, count(*)::int
from public.staging_ham_s6_import_skips
group by import_step, issue_reason
union all
select 'ham_s6_matches', 'total', count(*)::int
from public.matches m
join public.seasons s on s.id = m.season_id
where s.code = 'HAM-S6'
union all
select 'ham_s6_duplicate_pairs', 'total', count(*)::int
from (
  select m.mentor_person_id, m.mentee_person_id, count(*)
  from public.matches m
  join public.seasons s on s.id = m.season_id
  where s.code = 'HAM-S6'
  group by 1, 2
  having count(*) > 1
) d
union all
select 'ham_s6_recaps', 'total', count(*)::int
from public.mentoring_recaps mr
join public.seasons s on s.id = mr.season_id
where s.code = 'HAM-S6'
union all
select 'ham_s6_events', 'total', count(*)::int
from public.events e
join public.seasons s on s.id = e.season_id
where s.code = 'HAM-S6'
union all
select 'ham_s6_event_participations', 'total', count(*)::int
from public.event_participations ep
join public.seasons s on s.id = ep.season_id
where s.code = 'HAM-S6'
order by section, key;
```

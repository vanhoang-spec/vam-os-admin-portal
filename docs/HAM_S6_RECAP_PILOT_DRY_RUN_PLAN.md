# HAM-S6 Strict Recap Pilot Dry-Run Plan

## Status

- Environment: staging only.
- Project ref: `ljfneyuvpxrmejpxsmpz`.
- Foundation import: completed.
- Access isolation QA: passed.
- Active HAM-S6 matches available: 52.
- Existing HAM-S6 staging recaps/events/event participations: 0.
- Event/group activity import: out of scope and must wait.

This is a dry-run readiness package. No import was executed, no database rows were changed, and no RLS settings were changed.

## Scope

Prepare a strict pilot import path for the safest HAM-S6 one-on-one recap rows only.

The pilot excludes group/event activities, unresolved identities, unresolved matches, duplicate-risk rows, unknown/manual-review recap types, and rows requiring human interpretation.

## Files Inspected

- `data_imports/ham/ham_recaps_clean.csv`
- `data_imports/ham/scripts/ham_audit_clean.py`
- `data_imports/ham/scripts/ham_s6_03_import_profiles_matches.sql`
- `data_imports/ham/scripts/ham_s6_verify_foundation.sql`
- Staging helper table: `public.staging_ham_s6_people_identity_map`
- Staging skip table: `public.staging_ham_s6_import_skips`
- Staging `public.matches` rows for `HAM-S6`
- Staging `public.mentoring_recaps`, `public.events`, and `public.event_participations` aggregate counts only

## Inclusion Rules

A recap row is included in the strict pilot only when all of these are true:

- Source row is import-ready.
- Source row is not issue-flagged.
- Activity type is `1on1_primary` or `1on1_cross`.
- Mentor identity resolves to exactly one HAM-S6 mapped person.
- Mentee identity resolves to exactly one HAM-S6 mapped person.
- The resolved mentor/mentee pair links to an existing imported active HAM-S6 match.
- Row is not duplicate-risk by source link or date/person/activity signature.
- Meeting/activity date is valid.
- Source link is present.
- Row does not require human interpretation.

## Exclusion Rules

A recap row is excluded when any of these apply:

- Source row is not import-ready or is issue-flagged.
- Mentor or mentee identity is unresolved.
- Identity is in manual-review territory.
- Resolved pair does not link to an imported HAM-S6 match.
- Row depends on one of the unresolved skipped HAM-S6 matches.
- Row is duplicate-risk.
- Activity type is `unknown_manual_review`.
- Row requires human interpretation.
- Date/source fields are insufficient.

## Dry-Run Counts

| Metric | Count |
| --- | ---: |
| Total HAM recap rows | 121 |
| Source import-ready rows | 73 |
| Source issue-flagged rows | 48 |
| Rows with resolved mentor/mentee identities | 38 |
| Rows linked to imported HAM-S6 match | 35 |
| Strict pilot candidates | 29 |
| Excluded rows | 92 |
| Duplicate-risk rows | 10 |
| Date/source issue rows | 0 |

## Excluded Rows By Primary Reason

| Primary reason | Count |
| --- | ---: |
| Source not import-ready or source issue-flagged | 48 |
| Unresolved or manual-review identity | 35 |
| Duplicate-risk row | 6 |
| Resolved identities but no imported HAM-S6 match link | 3 |

Some rows have more than one risk. The table above uses a single primary reason per excluded row.

## Risk Notes

| Risk | Level | Dry-run handling |
| --- | --- | --- |
| Identity ambiguity or missing identity | High | Excluded from pilot. |
| Missing imported HAM-S6 match link | High | Excluded from pilot. |
| Duplicate-risk rows | Medium | Excluded from pilot. |
| Unknown/manual-review recap type | Medium | Excluded from pilot. |
| Date/source readiness | Low | No date/source issue found in the strict set. |
| Event/group activity semantics | High | Not included in this package. |

## Draft SQL Package

Draft file:

- `data_imports/ham/scripts/ham_s6_04_import_strict_recap_pilot_DRAFT.sql`

The SQL is **DRAFT ONLY / DO NOT RUN** until explicitly approved. It is designed to:

- Guard to HAM-S6 staging context.
- Use existing imported HAM-S6 `match_id` only.
- Avoid embedding participant names, emails, phones, social/profile links, or raw notes.
- Preserve source row references in sanitized `admin_notes`.
- Insert only strict pilot rows.
- Log excluded rows to a sanitized staging audit table.
- Be idempotent where possible by checking existing recap rows before insert.

## Recommendation

Proceed with a staging-only strict recap pilot after human approval of the draft package.

Do not import HAM event/group activities yet. Do not broaden the recap import until skipped matches/manual identities are reconciled or explicitly excluded in an approved decision record.

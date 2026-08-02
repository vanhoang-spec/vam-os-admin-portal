# Migration 062 V3 / 063 — Owner Decisions and Evidence Record

Date: 2026-08-02
Branch: `migration-062-v3-membership-lifecycle`
Status: patch authored, **not applied**. Migrations 062 and 063 remain blocked and unapplied.

## Provenance

This patch branch was created from commit `611ff7228f3dedeffef7459630211a797ba1b5e6`
(shared history with `artifact0-claude-workspace-handoff` @ `193054faedc5b91ae4eefaa3540b7b244309f9f5`).

The starting point for migration 062 was imported byte-for-byte, hash-verified,
from an owner-authorized review snapshot repository
(`vam_os_protected_sql_review_snapshot`, commit `48a8ca9d3c3b7cca9ea08fa617de6618b739212a`),
itself sourced from the original project worktree's dirty, uncommitted working
copy at the time of review. See the provenance-baseline commit
(`chore(db): import owner-reviewed migration 062 snapshot`) for the exact four
file hashes.

## Staging evidence authority

Live staging schema evidence (SQL Editor capture):

- File: `VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_SQL_EDITOR_2026-08-02.json`
- SHA-256: `6431159cdd9c3eab22378911072f4fab38d7c1e7f26c0772f1dbb11486b355d1`
- `captureMethod=supabase_sql_editor`, `transactionReadOnly=on`, `capturedAt=2026-08-02T05:30:05Z`

This evidence is the basis for every "live staging shows..." claim in the
migration/preflight/rollback/post-apply-verify comments and in the confirmed
defects list below. It was not re-captured or re-verified while authoring
this patch — no database or network access occurred during patch authorship.

## Confirmed defects this patch resolves

- **CONFLICT-01** — admin_scope_access arbiter targeted a nonexistent plain
  `UNIQUE(user_id,program_id,season_id)` constraint; live arbiter is a
  partial + expression index including `role`.
- **CONFLICT-02** — intake_batches→seasons FK guard required no `ON DELETE`
  clause; live FK (and migration 036) carry `ON DELETE RESTRICT`.
- **CONFLICT-03** — membership lifecycle guard required one combined
  role+status constraint; live schema has two independent constraints.
- **CONFLICT-06** (found during protected-SQL review) — admin_users(email)
  arbiter guard required `contype='u'`; the live arbiter is a
  `PRIMARY KEY`-backed index (`contype='p'`).
- **CONFLICT-07** (found during protected-SQL review) — admin_users
  lifecycle guard required `invited`/`suspended` vocabulary that does not
  exist on the live `admin_users_status_check`.
- **CONFLICT-08** (found during protected-SQL review) — the staff-import
  function wrote `admin_users.status='invited'`, which the live CHECK
  constraint (`active`/`inactive` only) would reject on every write.
- Audit vocabulary gap — `import_participant_membership` was written but not
  permitted by the live (`NOT VALID`, still-enforced-for-new-rows)
  `admin_audit_log_action_type_check`.
- RLS/grants — `intake_batches` and `person_season_membership_log` were
  never addressed by the reviewed draft at all (RLS stayed disabled, broad
  anon/authenticated grants stayed in place); `admin_users` already carries
  anon grants in live staging, contradicting what preflight assumed as a
  precondition.
- Two additional defects found only while authoring this patch: the
  reviewed rollback never dropped `account_auth_operations` or
  `account_person_auth_links` (created but orphaned on rollback), and it
  never captured or restored grant state at all (only RLS enable/force
  booleans), so "restore prior grants exactly" was not previously possible.

## Locked owner decisions (as given, verbatim intent)

- **DEC-01** — explicit program + season scope only for the initial pilot;
  no NULL/empty-string/magic-text/global/program-wide sentinel scope.
  Global access is via the `super_admin` role only.
- **DEC-02** — active-scope logical identity is
  `user_id + program_id + season_id + role`; role is mandatory in every
  uniqueness/conflict-arbiter/idempotency path. Multi-role per program/season
  is allowed.
- **DEC-03** — never reactivate an inactive `admin_scope_access` row; a
  matching active row is an idempotent no-op, a matching inactive-only row
  causes a new active row to be inserted, and the inactive row is preserved
  as history.
- **DEC-04** — `admin_users.status` stays `active`/`inactive` only;
  invitation/provisioning state belongs to `account_auth_operations` /
  `account_auth_reconciliation` / the auth provider, not `admin_users`. New
  staff rows stay `inactive` until auth linking and explicit activation.
- **DEC-05** — `admin_scope_access.program_id`/`season_id` remain TEXT
  storing canonical UUID strings for this pilot (no type/nullability change
  in 062); every write RPC validates program/season existence and
  season-belongs-to-program before writing. A future, separately reviewed
  migration may convert to UUID + FKs after a data audit.
- **DEC-06** — membership lifecycle operates on the existing
  person+season+role row; pause/withdraw/opt-out/cancel/reactivate map to
  `paused`/`withdrawn`/`opted_out`/`cancelled`/`active`; every transition
  writes a complete `person_season_membership_log` row.
- **DEC-07** — add role creates a new active-status membership row and
  preserves all other active roles; remove role never deletes, it
  transitions that one role's row to `cancelled`.
- **DEC-08** — no hard deletion of an active or historically active member,
  ever, including during rollback.
- **DEC-09** — before staging pilot, RLS is enabled and grants hardened on
  `intake_batches`, `person_season_memberships`, and
  `person_season_membership_log`: no anon privileges, no direct
  authenticated mutation, writes only through SECURITY DEFINER RPCs, minimum
  scope-aware SELECT only.
- **DEC-10** — `admin_audit_log_action_type_check` vocabulary expanded to
  add `import_participant_membership`, `link_person_auth`,
  `reconcile_person_auth`, `create_membership`, `add_membership_role`,
  `remove_membership_role`, `pause_membership`, `withdraw_membership`,
  `opt_out_membership`, `cancel_membership`, `reactivate_membership`,
  alongside the preserved legacy values.
- **DEC-11** — migration 062 V3 owns account-admin/auth-operation
  foundation, CSV preview/import/outcomes, corrected guards/arbiter, the
  audit vocabulary expansion, and RLS/grant hardening for its own write
  paths; migration 063 is a separate review package for the membership
  lifecycle operations (pause/withdraw/opt-out/cancel/reactivate/add-role/
  remove-role), depending on 062 V3 already being applied. Neither is
  applied by this patch-authorship task.

## One deliberate deviation from a literal reading of the owner decisions

DEC-09 names `intake_batches`, `person_season_memberships`, and
`person_season_membership_log` specifically. Migration 062 V3 additionally
revokes stale anon/authenticated grants on `admin_users`, `admin_scope_access`,
`admin_audit_log`, and `people` — the other four tables migration 062
enables RLS on. This extension exists because the protected-SQL review found
live staging evidence that `admin_users` already carries broad anon grants,
directly contradicting what the reviewed draft's preflight assumed as an
already-true precondition. Rather than leave that precondition permanently
unmeetable, migration 062 V3 revokes and re-grants correctly on all seven
tables it touches, with prior-state capture so rollback can restore exactly
what was there before. Flagging this explicitly: it is consistent with
DEC-09's stated intent (no unsafe direct anon/authenticated access) but goes
beyond in table, so it should be reviewed against actual intent.

## Independent-review remediation (DEC-R1/R2/R3, 2026-08-02)

An independent static review of this branch (HEAD `5de0f502348afc08ed10f6df7a565a9baea1a952`
at review time) returned PASS with three required-before-apply findings, all
now remediated on top of that HEAD:

- **Finding A / DEC-R1 (scope status mutation contract, MEDIUM)** —
  `vam062_admin_mutation_atomic`'s `upsert`, `update` (no `scope_id`), and
  `link_auth` branches previously hardcoded new `admin_scope_access` rows to
  `'active'` while silently discarding any caller-supplied `scope_status`;
  the explicit-`scope_id` branch of `update` still honored it, making the
  function internally inconsistent and capable of setting arbitrary status
  values through a path other than the dedicated deactivate/remove
  operation. Fixed: all four paths now share one contract — a supplied
  `scope_status` must be exactly `'active'` or omitted, or the call fails
  before any mutation; the explicit-`scope_id` branch can now only retarget
  `role` on an already-`active` row (`WHERE ... AND status='active'` added
  to its `UPDATE`), never reactivate an inactive row or set any other
  status. The `status`/`remove` operation is unchanged — it remains the one
  dedicated mechanism for deactivation/reactivation/removal, per DEC-R1 §5.
- **Finding B / DEC-R2 (concurrent admin-scope idempotency, MEDIUM)** — the
  existence-check-then-insert pattern in `vam062_upsert_staff_account_atomic`
  (and the equivalent inline logic previously duplicated across
  `vam062_admin_mutation_atomic`'s three creation branches) was not race-safe
  under concurrent calls for the same identity. Fixed: a new shared helper,
  `vam062_upsert_scope_atomic(user_id, program_id, season_id, scope_role,
  target_status)`, acquires a transaction-scoped advisory lock keyed on
  exactly `user_id + program_id + season_id + role` (DEC-R2's specified
  identity, never including status) before repeating the existence check,
  then inserts-or-no-ops for either target status (`'active'` for the
  admin-console paths, `'inactive'` for staff import). All four prior call
  sites now route through this one helper.
- **Finding C / DEC-R3 (concurrent add-role idempotency, LOW)** —
  `vam063_add_membership_role`'s existence-check-then-insert could surface a
  raw `unique_violation` to the caller under concurrent duplicate requests
  (though the live `UNIQUE(person_id,season_id,role)` constraint already
  prevented any actual duplicate row). Fixed: an advisory lock keyed on
  exactly `person_id + season_id + role` is acquired before the existence
  check is repeated, so a concurrent duplicate call now observes the first
  call's committed row and returns a controlled `'noop'` result instead of
  hitting the `INSERT` at all. The live unique constraint is untouched and
  remains the final integrity gate.

**Adjacent check-then-insert pattern review (Task 5 of the remediation
request):** every other function in 062 and 063 was checked for the same
race class. `vam062_import_participant_membership_atomic` performs a
pre-check `SELECT` for business-logic branching (skip/cross-program checks)
but its actual mutation uses `ON CONFLICT (person_id,season_id,role)`
against a real, always-enforced, non-partial unique constraint — safe by
construction, no change needed. `vam062_record_reconciliation` uses
`ON CONFLICT (batch_id,row_number)` against `account_import_outcomes`'s real
unique constraint — safe. `vam062_begin_auth_operation` and
`vam062_create_account_preview` already used the identical
`pg_advisory_xact_lock` pattern the two new fixes now match — safe, no
change needed. `vam063_transition_membership_atomic` takes `FOR UPDATE` on
the specific membership row before its idempotency check — safe, no change
needed. One function, `vam062_record_auth_reconciliation`, performs a plain
`INSERT` keyed on a caller-supplied `operation_id` primary key with no lock
of its own; in normal usage it is always preceded by
`vam062_begin_auth_operation`, which does take the identity-scoped advisory
lock. This was **not** remediated — it is not one of the three named
findings, changing it was outside this remediation's authorized scope, and
it is disclosed here rather than silently left unmentioned.

Net effect on the manifest: migration 062 gains one new internal function
(`vam062_upsert_scope_atomic`), so the tracked function count goes from 10
to 11 and the total `account_rls_package_manifest` row count goes from 25 to
26 — reflected in the migration, rollback, and post-apply-verification
files and their tests. No table, RLS state, grant scope, admin_users
vocabulary, or audit vocabulary changed as part of this remediation.

## Not resolved by this patch

- Whether the `admin_scope_access` NULL-scope design premise referenced in
  earlier project discussion was ever formally "locked" outside this
  decision set — DEC-01 supersedes and resolves this directly (explicit
  scope only, no sentinel), so it no longer requires separate resolution.
- `admin_scope_access`'s TEXT/UUID type mismatch and absent FKs to
  `programs`/`seasons` — deliberately deferred per DEC-05 to a future,
  separately reviewed migration after a data audit.
- Real auth-provider reconciliation logic (email normalization, duplicate
  detection) — lives in application code outside SQL and outside this
  patch's scope; the `account_auth_operations`/`account_auth_reconciliation`
  tables and `vam062_begin_auth_operation`/`vam062_record_auth_operation_stage`
  functions are bookkeeping scaffolding for that logic, not the logic itself.

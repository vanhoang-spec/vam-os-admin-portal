# VAM OS Bulk CSV User Import Design
## 2026-07-29

Design only. No implementation in this task.

---

## Overview

A two-stage CSV workflow for bulk account provisioning. Stage 1 validates and
previews with no mutations. Stage 2 confirms and executes. Each stage is a
separate server action invocation.

Maximum batch size: **100 rows.**

---

## CSV Template

### Administrator-Facing Column Definition

```
full_name,email,temporary_password,role,program_code,season_code
```

`intake_batch_code` is appended only when the canonical model requires it for
the assigned role (e.g., when creating mentor_profiles or mentee_profiles —
not required for admin_users-only creation).

**No UUIDs in the normal template.** Codes only (`program_code`, `season_code`,
`intake_batch_code`). UUIDs are resolved server-side.

### Column Definitions

| Column | Required | Normalization | Validation |
|---|---|---|---|
| `full_name` | Yes | `trim()` | Non-empty after trim |
| `email` | Yes | `trim().toLowerCase()` | Valid email format; dedup within file |
| `temporary_password` | Yes for new Auth users; blank for existing | None stored | Length ≥ 8, at least 1 uppercase, 1 digit, 1 special char; display "Đạt yêu cầu" / "Không đạt yêu cầu" only |
| `role` | Yes | `trim().toLowerCase()` | Must be in canonical `ADMIN_ROLES` allowlist; caller cannot assign role above their own |
| `program_code` | No | `trim().toUpperCase()` | Must exist in `public.programs` if provided |
| `season_code` | No | `trim().toUpperCase()` | Must exist in `public.seasons` linked to `program_code` if provided |
| `intake_batch_code` | Conditional | `trim().toUpperCase()` | Required only when needed; must link to `season_code` |

---

## Stage 1: Parse, Validate, Preview (No Mutations)

### Input Processing

1. Receive file upload via server action.
2. Compute SHA-256 hash of raw file bytes. Store hash server-side (session or
   server-side cache). Return hash to client for inclusion in Stage 2 confirmation.
3. Detect and strip BOM (UTF-8 BOM: `EF BB BF`).
4. Normalize line endings: `\r\n` → `\n`.
5. Parse CSV (RFC 4180). Reject if required headers are missing.
6. Reject if row count > 100 (after header).

### Per-Row Validation

For each row:

1. Normalize `email`: `trim().toLowerCase()`.
2. Validate `email` format.
3. Check for duplicate emails within the file.
4. Validate `role` against `ADMIN_ROLES` allowlist server-side.
5. Validate `program_code` exists in DB (if provided).
6. Validate `season_code` exists in DB and links to `program_code` (if provided).
7. Validate `intake_batch_code` if provided.
8. Check `temporary_password` strength (boolean only — no plaintext in preview).
9. Query Auth state: does `auth.users` row exist for this email?
10. Query `admin_users` state: does an `admin_users` row exist for this email?
11. Query `admin_scope_access`: what program/season access already exists?
12. Query `person_season_memberships`: does this person already have the target membership?

### Preview Output

Returned to the administrator — no mutations performed.

For each row, output:

| Field | Description |
|---|---|
| `row_number` | 1-indexed source row |
| `email` | Normalized email (no plaintext password — not even hashed) |
| `full_name` | As provided |
| `role` | Validated role |
| `program_code`, `season_code` | As provided |
| `auth_state` | `exists` / `not_found` / `invited_pending` |
| `admin_state` | `active` / `invited` / `suspended` / `inactive` / `not_found` |
| `membership_state` | `active` / `invited` / other / `not_found` |
| `proposed_action` | One of the action types below |
| `conflicts` | List of conflict descriptions (empty array if none) |
| `password_policy` | `"Đạt yêu cầu"` / `"Không đạt yêu cầu"` — NEVER anything else |
| `validation_errors` | List of blocking errors; must be empty before Stage 2 |

**Password display rule — strictly enforced:**
- Show only `"Đạt yêu cầu"` or `"Không đạt yêu cầu"`.
- Never show: plaintext password, masked password (e.g., `*****`), password length,
  strength score, character composition, or any fragment.

### Proposed Action Types

| Action | Condition |
|---|---|
| `create_auth_invite_and_admin_user` | No Auth user; no admin_users row |
| `link_existing_auth_to_new_admin_user` | Auth user exists; no admin_users row |
| `update_existing_admin_user` | Auth user exists; admin_users row exists with different role/status |
| `grant_scope_to_existing_admin_user` | Auth user exists; admin_users row exists; new scope to add |
| `no_change` | All values already match; idempotent |
| `conflict_block` | Conflicts present; requires manual resolution before proceeding |

### Formula-Injection Protection

Before returning any preview to the browser, sanitize all string values:

- Values beginning with `=`, `+`, `-`, `@`, `\t`, `\r` must be prefixed with `'` (apostrophe)
  in any CSV export.
- In the preview table HTML, render values as text content, never as innerHTML.

---

## Stage 2: Confirm and Execute

### Pre-Execution Revalidation

1. Receive: original file (or re-computed hash), confirmed hash from Stage 1,
   administrator confirmation flag.
2. Recompute SHA-256 hash of the re-uploaded file (or the cached file).
3. **Hash must match Stage 1 hash exactly.** If hashes differ: abort with
   "File có thể đã thay đổi — xác nhận thất bại." Force re-upload.
4. Re-run all Stage 1 validations. If any row that was `valid` in Stage 1 is now
   invalid (e.g., a program code was deleted between Stage 1 and Stage 2): abort
   the entire batch.
5. Re-authorize caller (`requireSuperAdmin()` or `requireAdmin()` as appropriate).

### Mutation Sequence (per row, in order)

```
For each valid row (not conflict_block, not no_change):
  1. Normalize email
  2. Auth step: invite or link existing
     - If auth_state = 'not_found': auth.admin.inviteUserByEmail()
       Record new_auth_user_id for rollback
     - If auth_state = 'exists': use existing auth_user_id
  3. Admin user step: create or update admin_users row
     INSERT ... ON CONFLICT (email) DO UPDATE SET role=..., status=..., updated_at=now()
     Where role is validated server-side
  4. Scope grant step (if program/season provided):
     INSERT admin_scope_access ... ON CONFLICT DO NOTHING
  5. Membership step (if role requires it):
     INSERT person_season_memberships ... ON CONFLICT DO NOTHING
  6. Write audit log entry
```

**Idempotent behavior:** Re-running the same import with the same data produces
no changes on rows with `action = no_change`. `ON CONFLICT DO NOTHING` prevents
duplicate scope grants and memberships.

**Partial failure:**

- If an Auth user was created in step 2 for a row but step 3 fails: delete the
  newly created Auth user via `auth.admin.deleteUser(new_auth_user_id)`.
- If step 3 succeeds but step 4 fails: surface the error for that row; the
  admin_users row is preserved; scope must be granted manually.
- Remaining rows continue unless a fatal error (DB connection loss) is encountered.
- No row's failure rolls back previously successful rows.

### Result Export (Sanitized CSV)

After Stage 2, offer a downloadable result CSV:

```
row_number,email,full_name,role,program_code,season_code,action_taken,result,error
```

**Formula-injection-safe:** Prefix any cell beginning with `=`, `+`, `-`, `@` with `'`.
**No passwords** in the export — not even the word "password" in a data column.
**No Auth user IDs** in the export.

---

## Conflict Scenarios and Behavior

| Scenario | Stage 1 behavior | Stage 2 behavior |
|---|---|---|
| New Auth user, no admin_users row | `proposed_action: create_auth_invite_and_admin_user` | Create both |
| Existing Auth user, no admin_users row | `proposed_action: link_existing_auth_to_new_admin_user` | Create admin_users only; preserve existing Auth password |
| Existing active admin_users row, same role | `proposed_action: no_change` (if scope also matches) | Skip row; idempotent |
| Existing active admin_users row, different role | Show conflict; flag for review | Block — manual resolution required; do not auto-downgrade |
| Existing suspended admin_users row | `proposed_action: update_existing_admin_user` if caller intends to restore | Only if status change is included in input |
| Program Admin trying to assign `super_admin` | `validation_errors: ["caller không có quyền gán super_admin"]` | Block |
| Program Admin trying to assign scope outside their program | `validation_errors: ["chương trình nằm ngoài phạm vi quyền của bạn"]` | Block |
| Duplicate email in source file | `validation_errors: ["email trùng lặp trong file: row N"]` for second occurrence | Block entire file until resolved |
| Missing required header | File-level error — reject entire upload | N/A |
| Row count > 100 | File-level error | Block |
| Formula injection candidate in preview | Sanitize in preview display and export | — |
| Weak temporary password | `password_policy: "Không đạt yêu cầu"` | Block row (password must pass policy before Stage 2) |
| Rollback after partial Auth creation | Auth user deleted if and only if it was created in this batch run | Preserved if pre-existing |

---

## Batch Size Limit Rationale

100-row limit reflects:
- `auth.admin.listUsers()` pagination cost (up to 20 pages × 1000 users per email lookup).
- Risk surface of a single bulk operation.
- Manual verification burden per administrator.

For larger imports, use the CLI CSV pipeline (Python scripts) after owner authorization.

---

*Design only. No implementation in this task. No database connections used.*

#!/usr/bin/env node
// VAM OS — UAT fixture teardown for STAGING ONLY.
//
// Tears down the six stable Auth/admin accounts and the synthetic person and
// membership of exactly ONE VAM_UAT_RUN_ID. Another run's person is a different
// email in a different marker namespace value, so it is invisible here and is
// never mutated.
//
// Cleanup is conditional, because the schema decides what is removable:
//
//   * person_season_membership_log is append-only (triggers
//     person_season_membership_log_no_update / _no_delete block UPDATE and
//     DELETE) and holds ON DELETE RESTRICT foreign keys to both the membership
//     and the person. Once UAT exercises a lifecycle transition through the
//     app, that membership and person become permanently undeletable.
//   * admin_audit_log holds foreign keys to admin_users on both
//     actor_admin_user_id and target_admin_user_id with no ON DELETE action, so
//     once a fixture account performs or receives an audited action its
//     admin_users row is pinned.
//
// So this script hard-deletes what is still detached, and retires the rest. It
// never attempts to bypass a trigger or drop a constraint, and it never deletes
// or updates an audit/log row.
//
// Retiring an admin row also clears auth_user_id, and the Auth user is deleted
// only once nothing points at its UUID any more — neither a retained admin row
// nor a surviving scope row.
//
// Usage:
//   VAM_UAT_RUN_ID=20260805-01 node scripts/cleanup-uat-fixtures.mjs
//   VAM_UAT_RUN_ID=20260805-01 node scripts/cleanup-uat-fixtures.mjs --apply
//   node scripts/cleanup-uat-fixtures.mjs --run-id=20260805-01

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  ACCOUNTS,
  ACCOUNT_TAG,
  FixtureOwnershipError,
  STAGING_HOSTNAME,
  assertRunId,
  assertStagingHost,
  classifyPersonRunMarker,
  countRows,
  email,
  findAuthUserByEmail,
  isExactAdminNotesMarker,
  isExactAuthFixtureMarker,
  loadEnvLocal,
  parseApplyMode,
  personIdentityForRun,
  resolveFixtureScope,
  resolveRunId
} from "./uat-fixture-common.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function runCleanup(db, applyMode, logger = console, options = {}) {
  // Validated before anything touches the network.
  const person = personIdentityForRun(options.runId);
  const failures = [];

  function act(verb, detail) {
    logger.log(`  ${applyMode ? "[write]" : "[would]"} ${verb}: ${detail}`);
  }
  function keep(detail) {
    logger.log(`  [keep] ${detail}`);
  }
  function fail(detail) {
    logger.error(`  [fail] ${detail}`);
    failures.push(detail);
  }

  let scope = null;
  try {
    scope = await resolveFixtureScope(db);
    logger.log(`Scope resolved`);
  } catch (error) {
    fail(`scope resolution failed (${error.message}); scope and membership teardown skipped`);
  }

  async function cleanupPerson() {
    logger.log(`\nSynthetic person for run ${person.runId} <${person.email_primary}>`);

    const { data: row, error } = await db
      .from("people")
      .select("id,data_quality_flags,full_name")
      .eq("email_primary", person.email_primary)
      .maybeSingle();
    if (error) throw new Error(`people read failed: ${error.message}`);
    if (!row?.id) {
      logger.log("  [absent] no people row for this run");
      return;
    }

    if (classifyPersonRunMarker(row.data_quality_flags, person) === "none") {
      throw new FixtureOwnershipError(
        `people row ${row.id} data_quality_flags does not exactly equal a run ${person.runId} marker. Aborting mutation.`
      );
    }
    if (row.full_name !== person.full_name) {
      throw new FixtureOwnershipError(`people row ${row.id} full_name does not exact-match. Aborting mutation.`);
    }
    const personId = String(row.id);

    if (!scope) {
      keep(`people row ${personId} and its memberships not evaluated — fixture scope unresolved`);
      return;
    }

    const { data: memberships, error: membershipError } = await db
      .from("person_season_memberships")
      .select("id,status,role,season_id")
      .eq("person_id", personId);
    if (membershipError) throw new Error(`membership read failed: ${membershipError.message}`);

    const owned = [];
    for (const membership of memberships ?? []) {
      const isFixtureMembership =
        String(membership.season_id) === scope.seasonId && membership.role === person.membershipRole;
      if (isFixtureMembership) owned.push(membership);
      else keep(`membership ${membership.id} (season=${membership.season_id}, role=${membership.role}) is not the fixture membership — left untouched`);
    }

    let pinned = false;
    for (const membership of owned) {
      const logCount = await countRows(db, "person_season_membership_log", "membership_id", membership.id);
      if (logCount > 0) {
        pinned = true;
        keep(`membership ${membership.id} has ${logCount} append-only log row(s) — ON DELETE RESTRICT, cannot be removed`);
        if (membership.status === "cancelled") {
          keep(`membership ${membership.id} already retained (cancelled)`);
        } else if (applyMode) {
          const { data, error: updateError } = await db
            .from("person_season_memberships")
            .update({ status: "cancelled" })
            .eq("id", membership.id)
            .select("id");
          if (updateError) fail(`membership ${membership.id} retire failed: ${updateError.message}`);
          else if ((data ?? []).length !== 1) fail(`membership ${membership.id} retire affected ${(data ?? []).length} row(s), expected 1`);
          else act("retire membership", `${membership.id} → cancelled`);
        } else {
          act("retire membership", `${membership.id} → cancelled`);
        }
      } else if (applyMode) {
        const { error: deleteError } = await db.from("person_season_memberships").delete().eq("id", membership.id);
        if (deleteError) fail(`membership ${membership.id} delete failed: ${deleteError.message}`);
        else act("delete membership", membership.id);
      } else {
        act("delete membership", `${membership.id} (no log rows — detached)`);
      }
    }

    const personLogCount = await countRows(db, "person_season_membership_log", "person_id", personId);
    if (personLogCount > 0 || pinned) {
      keep(`people row ${personId} retained — ${personLogCount} log row(s) reference it`);
      if (row.data_quality_flags === person.retainedMarker) {
        keep(`people row ${personId} already carries the run ${person.runId} retained marker`);
      } else if (applyMode) {
        const { data, error: flagError } = await db
          .from("people")
          .update({ data_quality_flags: person.retainedMarker })
          .eq("id", personId)
          .select("id");
        if (flagError) fail(`people row ${personId} retained-marker update failed: ${flagError.message}`);
        else if ((data ?? []).length !== 1) fail(`people row ${personId} retained-marker update affected ${(data ?? []).length} row(s), expected 1`);
        else act("flag person", `${personId} → retained (run ${person.runId})`);
      } else {
        act("flag person", `${personId} → retained (run ${person.runId})`);
      }
      return;
    }

    if (applyMode) {
      const { error: deleteError } = await db.from("people").delete().eq("id", personId);
      if (deleteError) fail(`people row ${personId} delete failed: ${deleteError.message}`);
      else act("delete person", personId);
    } else {
      act("delete person", `${personId} (no log rows — detached)`);
    }
  }

  async function cleanupAccount(account) {
    const address = email(account.slug);
    logger.log(`\n<${address}>`);

    const authUser = await findAuthUserByEmail(db, address);
    if (authUser && !isExactAuthFixtureMarker(authUser.user_metadata?.vam_uat_fixture)) {
      throw new FixtureOwnershipError(
        `auth.users ${authUser.id} for ${address} user_metadata.vam_uat_fixture does not exactly equal the account tag. Aborting mutation.`
      );
    }

    const { data: adminUser, error: adminError } = await db
      .from("admin_users")
      .select("id,status,auth_user_id,notes,role")
      .eq("email", address)
      .maybeSingle();
    if (adminError) throw new Error(`admin_users read failed: ${adminError.message}`);

    // Auth deletion is gated on nothing still referencing this UUID.
    let authDeletable = true;

    if (adminUser?.id) {
      if (!isExactAdminNotesMarker(adminUser.notes)) {
        throw new FixtureOwnershipError(
          `admin_users row ${adminUser.id} notes does not exactly equal the fixture marker. Aborting mutation.`
        );
      }
      if (account.adminRole && adminUser.role !== account.adminRole) {
        throw new FixtureOwnershipError(
          `admin_users row ${adminUser.id} role=${adminUser.role} does not match fixture role ${account.adminRole}. Aborting mutation.`
        );
      }
      if (authUser && adminUser.auth_user_id && String(adminUser.auth_user_id) !== String(authUser.id)) {
        throw new FixtureOwnershipError(
          `admin_users row ${adminUser.id} auth_user_id does not match auth.users ${authUser.id}. Aborting mutation.`
        );
      }

      const actorCount = await countRows(db, "admin_audit_log", "actor_admin_user_id", adminUser.id);
      const targetCount = await countRows(db, "admin_audit_log", "target_admin_user_id", adminUser.id);
      const auditCount = actorCount + targetCount;

      if (auditCount > 0) {
        keep(`admin_users ${adminUser.id} pinned by ${auditCount} admin_audit_log row(s) — ON DELETE RESTRICT`);
        const alreadyRetained = adminUser.status === "inactive" && (adminUser.auth_user_id ?? null) === null;
        if (alreadyRetained) {
          keep(`admin_users ${adminUser.id} already retained (inactive, auth link cleared)`);
        } else if (applyMode) {
          const { data, error } = await db
            .from("admin_users")
            .update({ status: "inactive", auth_user_id: null })
            .eq("id", adminUser.id)
            .select("id");
          const affected = (data ?? []).length;
          if (error || affected !== 1) {
            authDeletable = false;
            fail(
              `admin_users ${adminUser.id} could not be retired with its auth link cleared (${error ? error.message : `${affected} row(s) affected`}); auth.users retained to avoid a dangling link`
            );
          } else {
            act("retire admin_users", `${adminUser.id} → status=inactive, auth_user_id=null`);
          }
        } else {
          act("retire admin_users", `${adminUser.id} → status=inactive, auth_user_id=null`);
        }
      } else if (applyMode) {
        const { data, error } = await db.from("admin_users").delete().eq("id", adminUser.id).select("id");
        const affected = (data ?? []).length;
        if (error || affected !== 1) {
          authDeletable = false;
          fail(
            `admin_users ${adminUser.id} delete affected ${affected} row(s) (${error ? error.message : "no error"}); auth.users retained to avoid a dangling link`
          );
        } else {
          act("delete admin_users", adminUser.id);
        }
      } else {
        act("delete admin_users", `${adminUser.id} (no audit rows — detached)`);
      }
    } else {
      logger.log("  [absent] no admin_users row");
    }

    const scopeOwnerId = authUser
      ? String(authUser.id)
      : adminUser?.auth_user_id
        ? String(adminUser.auth_user_id)
        : null;

    if (!scopeOwnerId) {
      logger.log("  [absent] no admin_scope_access owner to resolve");
    } else if (!scope) {
      keep(`admin_scope_access for ${address} not evaluated — fixture scope unresolved`);
      authDeletable = false;
    } else {
      const { data: scopes, error: scopeError } = await db
        .from("admin_scope_access")
        .select("id,user_id,program_id,season_id,role,status")
        .eq("user_id", scopeOwnerId);
      if (scopeError) throw new Error(`admin_scope_access read failed: ${scopeError.message}`);

      const rows = scopes ?? [];
      const expected = rows.filter(
        (row) =>
          String(row.program_id) === scope.programId &&
          String(row.season_id) === scope.seasonId &&
          row.role === account.scopeRole
      );
      // admin_scope_access.user_id has no foreign key to auth.users, so any row
      // left behind here would become a dangling reference the moment the Auth
      // user is deleted. Whenever one survives, the Auth user is retained too.
      for (const row of rows) {
        if (expected.includes(row)) continue;
        authDeletable = false;
        keep(
          `unexpected admin_scope_access ${row.id} (program=${row.program_id}, season=${row.season_id}, role=${row.role}) is not the fixture scope — left untouched`
        );
      }

      if (expected.length === 0) {
        logger.log("  [absent] no fixture admin_scope_access row");
      } else if (expected.length > 1) {
        authDeletable = false;
        fail(`admin_scope_access for ${address} matched ${expected.length} fixture rows; ambiguous, nothing deleted`);
      } else if (applyMode) {
        const target = expected[0];
        const { data, error } = await db.from("admin_scope_access").delete().eq("id", target.id).select("id");
        const affected = (data ?? []).length;
        if (error || affected !== 1) {
          authDeletable = false;
          fail(`admin_scope_access ${target.id} delete affected ${affected} row(s) (${error ? error.message : "no error"})`);
        } else {
          act("delete admin_scope_access", target.id);
        }
      } else {
        act("delete admin_scope_access", `${expected[0].id} (exact fixture scope)`);
      }
    }

    if (!authUser) {
      logger.log("  [absent] no auth.users row");
      return;
    }
    if (!authDeletable) {
      keep(`auth.users ${authUser.id} retained — database teardown did not complete safely`);
      return;
    }
    if (applyMode) {
      const { error } = await db.auth.admin.deleteUser(authUser.id);
      if (error) fail(`auth.users ${authUser.id} delete failed: ${error.message}`);
      else act("delete auth.users", authUser.id);
    } else {
      act("delete auth.users", authUser.id);
    }
  }

  try {
    await cleanupPerson();
  } catch (error) {
    if (error instanceof FixtureOwnershipError) throw error;
    fail(`${person.email_primary}: ${error.message}`);
  }

  for (const account of ACCOUNTS) {
    try {
      await cleanupAccount(account);
    } catch (error) {
      // Ownership violations are fatal. Operational failures must not stop the
      // teardown of the remaining, independent accounts.
      if (error instanceof FixtureOwnershipError) throw error;
      fail(`${email(account.slug)}: ${error.message}`);
    }
  }

  logger.log("\nTeardown complete.");
  logger.log("Rows reported as [keep] are retained by schema design, not by script failure.");
  if (!applyMode) logger.log("Re-run with --apply to execute.");

  if (failures.length > 0) {
    throw new Error(`Teardown completed with ${failures.length} failure(s).`);
  }
}

// --- CLI execution ---------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  loadEnvLocal(readFileSync, existsSync, resolve(ROOT, ".env.local"));

  const applyMode = parseApplyMode(process.argv);
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  function abort(message) {
    console.error(`\nSAFETY ABORT: ${message}\n`);
    process.exit(1);
  }

  let runId;
  try {
    runId = assertRunId(resolveRunId(process.argv, process.env));
  } catch (error) {
    abort(error.message);
  }

  if (!SUPABASE_URL) abort("NEXT_PUBLIC_SUPABASE_URL is not set.");
  try {
    assertStagingHost(SUPABASE_URL);
  } catch (error) {
    abort(error.message);
  }
  if (!SERVICE_ROLE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is not set.");
  if (SERVICE_ROLE_KEY === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    abort("SUPABASE_SERVICE_ROLE_KEY is identical to the anon key. Refusing to continue.");
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log(`VAM OS UAT fixture teardown — target staging host ${STAGING_HOSTNAME}`);
  console.log(`Stable account tag ${ACCOUNT_TAG} — lifecycle run id ${runId}`);
  console.log(applyMode ? "MODE: APPLY (writes will be performed)" : "MODE: DRY RUN (no writes; pass --apply to execute)");

  runCleanup(db, applyMode, console, { runId }).catch((error) => {
    console.error(`\nFAILED: ${error.message}`);
    process.exit(1);
  });
}

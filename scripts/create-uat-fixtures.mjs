#!/usr/bin/env node
// VAM OS — UAT fixture provisioning for STAGING ONLY.
//
// Creates the six-account UAT matrix plus one synthetic person and membership.
// Account definitions, ownership markers and the staging guard live in
// ./uat-fixture-common.mjs and are shared with the teardown script.
//
// Two invariants drive the design:
//
//   * A row that already existed is never deleted, never overwritten and never
//     re-marked. The only exception is a *retained* fixture admin row (status
//     inactive, auth_user_id null, exact marker) left behind by a previous
//     teardown, which may be relinked to a freshly created Auth user. That
//     relink is tracked and reverted on rollback.
//   * A write is only considered successful once its returned identity has been
//     validated. A success response with no id triggers an exact re-query so the
//     row can still be compensated, and aborts the run either way.
//
// Usage:
//   node scripts/create-uat-fixtures.mjs            # dry run, no writes
//   node scripts/create-uat-fixtures.mjs --apply    # perform writes

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  ACCOUNTS,
  ACTIVE_MARKER,
  ADMIN_NOTES_MARKER,
  FIXTURE_TAG,
  PERSON,
  RETAINED_MARKER,
  STAGING_HOSTNAME,
  assertStagingHost,
  classifyFixtureMarker,
  countRows,
  email,
  findAuthUserByEmail,
  isExactAdminNotesMarker,
  isExactAuthFixtureMarker,
  loadEnvLocal,
  parseApplyMode,
  resolveFixtureScope,
  scopeStatusFor
} from "./uat-fixture-common.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export { ACCOUNTS, PERSON, email };

export async function runFixtures(db, applyMode, fixturePassword, logger = console) {
  const actions = [];
  const createdItems = {
    authUsers: [],
    adminUsers: [],
    scopes: [],
    people: [],
    memberships: [],
    relinkedAdmins: []
  };

  function record(kind, detail) {
    actions.push({ kind, detail });
    logger.log(`  ${applyMode ? "[write]" : "[would]"} ${kind}: ${detail}`);
  }
  function skip(detail) {
    logger.log(`  [exists] ${detail}`);
  }

  // --- Write-response validation ------------------------------------------

  /**
   * Re-query a row by its exact unique fixture identity after an insert
   * returned a success response with no id. Returns the recovered id, or null
   * when the row provably does not exist. Throws when the answer is ambiguous.
   */
  async function recoverInsertedId(label, table, filters) {
    let query = db.from(table).select("id");
    for (const [column, value] of filters) query = query.eq(column, value);
    const { data, error } = await query;
    if (error) {
      throw new Error(
        `${label}: write returned a malformed success response and the recovery lookup failed (${error.message}). Possible unresolved write; aborting.`
      );
    }
    const rows = data ?? [];
    if (rows.length === 1) return String(rows[0].id);
    if (rows.length === 0) return null;
    throw new Error(
      `${label}: write returned a malformed success response and the recovery lookup matched ${rows.length} rows. Ambiguous, unresolved write state; aborting.`
    );
  }

  /**
   * Insert and only treat the write as done once an id is confirmed. On a
   * malformed success response the row is recovered by exact identity so
   * rollback can still remove it, then the run aborts.
   */
  async function insertTracked(label, table, payload, recoveryFilters, tracker) {
    const { data, error } = await db.from(table).insert(payload).select("id").maybeSingle();
    if (error) throw new Error(`${label}: insert failed (${error.message}).`);

    const id = data?.id ? String(data.id) : null;
    if (id) {
      tracker.push(id);
      return id;
    }

    const recovered = await recoverInsertedId(label, table, recoveryFilters);
    if (recovered) {
      tracker.push(recovered);
      throw new Error(
        `${label}: write returned a malformed success response; recovered row ${recovered} by exact identity and queued it for compensation. Aborting.`
      );
    }
    throw new Error(
      `${label}: write returned a malformed success response and no matching row exists. Unresolved write state; aborting.`
    );
  }

  async function createAuthUserTracked(address) {
    const { data, error } = await db.auth.admin.createUser({
      email: address,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { vam_uat_fixture: FIXTURE_TAG }
    });
    if (error) throw new Error(`auth.users ${address}: createUser failed (${error.message}).`);

    const created = data?.user?.id ? data.user : null;
    if (created) {
      createdItems.authUsers.push(String(created.id));
      return created;
    }

    let recovered = null;
    try {
      recovered = await findAuthUserByEmail(db, address);
    } catch (lookupError) {
      throw new Error(
        `auth.users ${address}: createUser returned a malformed success response and the recovery lookup failed (${lookupError.message}). Possible unresolved Auth write; aborting.`
      );
    }

    if (recovered?.id && isExactAuthFixtureMarker(recovered.user_metadata?.vam_uat_fixture)) {
      createdItems.authUsers.push(String(recovered.id));
      throw new Error(
        `auth.users ${address}: createUser returned a malformed success response; recovered ${recovered.id} by exact email and fixture metadata, queued for compensation. Aborting.`
      );
    }
    throw new Error(
      `auth.users ${address}: createUser returned a malformed success response and the created user could not be identified. Possible unresolved Auth write; aborting.`
    );
  }

  // --- Rollback ------------------------------------------------------------

  async function rollback() {
    if (!applyMode) return;
    logger.log("\n[ROLLBACK] Initiating transaction-like compensation for this run...");
    let failedRollbacks = 0;

    /** Resolve pin state, or report it as unresolved and keep the row. */
    async function pinCount(kind, id, table, column) {
      try {
        return await countRows(db, table, column, id);
      } catch (error) {
        logger.error(
          `  [rollback-fail] ${kind} ${id}: pin state unresolved (${error.message}); retaining row rather than deleting blind`
        );
        failedRollbacks += 1;
        return null;
      }
    }

    for (const id of createdItems.memberships) {
      const logCount = await pinCount("membership", id, "person_season_membership_log", "membership_id");
      if (logCount === null) continue;
      if (logCount > 0) {
        logger.log(`  [rollback-skip] membership ${id} has log rows, soft-retiring instead`);
        const { error } = await db.from("person_season_memberships").update({ status: "cancelled" }).eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to soft-retire membership ${id}`); failedRollbacks += 1; }
        else logger.log(`  [rollback-ok] soft-retired membership ${id}`);
      } else {
        const { error } = await db.from("person_season_memberships").delete().eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to delete membership ${id}`); failedRollbacks += 1; }
        else logger.log(`  [rollback-ok] deleted membership ${id}`);
      }
    }

    for (const id of createdItems.people) {
      const logCount = await pinCount("person", id, "person_season_membership_log", "person_id");
      if (logCount === null) continue;
      if (logCount > 0) {
        logger.log(`  [rollback-skip] person ${id} has log rows, soft-retiring instead`);
        const { error } = await db.from("people").update({ data_quality_flags: RETAINED_MARKER }).eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to soft-retire person ${id}`); failedRollbacks += 1; }
        else logger.log(`  [rollback-ok] soft-retired person ${id}`);
      } else {
        const { error } = await db.from("people").delete().eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to delete person ${id}`); failedRollbacks += 1; }
        else logger.log(`  [rollback-ok] deleted person ${id}`);
      }
    }

    for (const id of createdItems.scopes) {
      const { error } = await db.from("admin_scope_access").delete().eq("id", id);
      if (error) { logger.error(`  [rollback-fail] failed to delete scope ${id}`); failedRollbacks += 1; }
      else logger.log(`  [rollback-ok] deleted scope ${id}`);
    }

    for (const id of createdItems.adminUsers) {
      const actorCount = await pinCount("admin_users", id, "admin_audit_log", "actor_admin_user_id");
      if (actorCount === null) continue;
      const targetCount = await pinCount("admin_users", id, "admin_audit_log", "target_admin_user_id");
      if (targetCount === null) continue;

      if (actorCount + targetCount > 0) {
        logger.log(`  [rollback-skip] admin_users ${id} pinned by audit log, retiring and clearing auth link instead`);
        const { error } = await db.from("admin_users").update({ status: "inactive", auth_user_id: null }).eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to retire admin_users ${id}`); failedRollbacks += 1; }
        else logger.log(`  [rollback-ok] retired admin_users ${id} (auth link cleared)`);
      } else {
        const { error } = await db.from("admin_users").delete().eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to delete admin_users ${id}`); failedRollbacks += 1; }
        else logger.log(`  [rollback-ok] deleted admin_users ${id}`);
      }
    }

    // Pre-existing retained rows are reverted, never deleted.
    for (const id of createdItems.relinkedAdmins) {
      const { error } = await db.from("admin_users").update({ status: "inactive", auth_user_id: null }).eq("id", id);
      if (error) { logger.error(`  [rollback-fail] failed to revert relink of admin_users ${id}`); failedRollbacks += 1; }
      else logger.log(`  [rollback-ok] reverted relink of pre-existing admin_users ${id}`);
    }

    // Auth deletion runs last: every row referencing these UUIDs is gone or unlinked.
    for (const id of createdItems.authUsers) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) { logger.error(`  [rollback-fail] failed to delete auth.users ${id}`); failedRollbacks += 1; }
      else logger.log(`  [rollback-ok] deleted auth.users ${id}`);
    }

    if (failedRollbacks > 0) {
      logger.error(`\n[ROLLBACK] Completed with ${failedRollbacks} failure(s).`);
    } else {
      logger.log(`\n[ROLLBACK] Completed successfully.`);
    }
  }

  // --- Provisioning --------------------------------------------------------

  async function relinkRetainedAdmin(rowId, newAuthUserId, expectedStatus) {
    if (!newAuthUserId) {
      throw new Error(`admin_users ${rowId}: cannot relink retained fixture row without a resolved Auth user. Aborting.`);
    }
    const { data, error } = await db
      .from("admin_users")
      .update({ auth_user_id: newAuthUserId, status: expectedStatus })
      .eq("id", rowId)
      .is("auth_user_id", null)
      .select("id");
    if (error) throw new Error(`admin_users ${rowId}: relink failed (${error.message}).`);
    const affected = (data ?? []).length;
    if (affected !== 1) {
      throw new Error(
        `admin_users ${rowId}: relink affected ${affected} row(s), expected exactly 1. The row was not in the expected retained state; aborting.`
      );
    }
    createdItems.relinkedAdmins.push(String(rowId));
    record("admin_users", `relinked retained fixture row ${rowId} → status=${expectedStatus}`);
  }

  async function provisionAccount(account, scope) {
    const address = email(account.slug);
    logger.log(`\n${account.fullName} <${address}>`);

    let authUser = await findAuthUserByEmail(db, address);
    if (authUser) {
      if (!isExactAuthFixtureMarker(authUser.user_metadata?.vam_uat_fixture)) {
        throw new Error(
          `auth.users ${address} exists but its user_metadata.vam_uat_fixture does not exactly equal the fixture tag. Aborting to prevent adoption.`
        );
      }
      skip(`auth.users row already present`);
    } else if (applyMode) {
      authUser = await createAuthUserTracked(address);
      record("auth.users", `created confirmed user`);
    } else {
      record("auth.users", `create confirmed user`);
    }

    if (!account.adminRole) {
      logger.log("  [by design] no admin_users row, no admin_scope_access row");
      return;
    }

    const authUserId = authUser?.id ? String(authUser.id) : null;

    const { data: existingAdmin, error: adminReadError } = await db
      .from("admin_users")
      .select("id,role,status,auth_user_id,notes")
      .eq("email", address)
      .maybeSingle();
    if (adminReadError) throw new Error(`admin_users read failed or ambiguity detected: ${adminReadError.message}`);

    if (existingAdmin?.id) {
      // Ownership first: an unmarked row is never touched, relinked or adopted.
      if (!isExactAdminNotesMarker(existingAdmin.notes)) {
        throw new Error(
          `admin_users row exists for ${address} but notes does not exactly equal the fixture marker. Aborting to prevent adoption.`
        );
      }
      if (existingAdmin.role !== account.adminRole) {
        throw new Error(
          `admin_users row exists for ${address} with role=${existingAdmin.role}, expected ${account.adminRole}. Aborting to prevent silent overwrite.`
        );
      }

      const existingLink = existingAdmin.auth_user_id ?? null;
      const isRetained = existingAdmin.status === "inactive" && existingLink === null;

      if (isRetained) {
        if (applyMode) {
          await relinkRetainedAdmin(existingAdmin.id, authUserId, account.status);
        } else {
          record("admin_users", `relink retained fixture row ${existingAdmin.id} → status=${account.status}`);
        }
      } else if (!authUserId && !applyMode) {
        skip(`admin_users row present (dry run: auth link not evaluated until the Auth user exists)`);
      } else if (existingAdmin.status === account.status && existingLink === authUserId) {
        skip(`admin_users row present`);
      } else {
        throw new Error(
          `admin_users row exists for ${address} but status/auth_user_id does not exact-match expected and it is not a retained fixture row. Aborting to prevent silent overwrite.`
        );
      }
    } else if (applyMode) {
      await insertTracked(
        `admin_users ${address}`,
        "admin_users",
        {
          auth_user_id: authUserId,
          email: address,
          full_name: account.fullName,
          role: account.adminRole,
          status: account.status,
          notes: ADMIN_NOTES_MARKER
        },
        [["email", address], ["notes", ADMIN_NOTES_MARKER]],
        createdItems.adminUsers
      );
      record("admin_users", `created (role=${account.adminRole}, status=${account.status})`);
    } else {
      record("admin_users", `insert role=${account.adminRole} status=${account.status}`);
    }

    if (!authUserId) return;

    const scopeStatus = scopeStatusFor(account);
    const { data: existingScope, error: scopeReadError } = await db
      .from("admin_scope_access")
      .select("id,role,status")
      .eq("user_id", authUserId)
      .eq("program_id", scope.programId)
      .eq("season_id", scope.seasonId)
      .maybeSingle();
    if (scopeReadError) throw new Error(`admin_scope_access read failed or ambiguity detected: ${scopeReadError.message}`);

    if (existingScope?.id) {
      if (existingScope.role !== account.scopeRole || existingScope.status !== scopeStatus) {
        throw new Error(
          `admin_scope_access exists for ${address} but role/status does not exact-match expected. Aborting to prevent silent overwrite.`
        );
      }
      skip(`admin_scope_access row present`);
    } else if (applyMode) {
      await insertTracked(
        `admin_scope_access ${address}`,
        "admin_scope_access",
        {
          user_id: authUserId,
          program_id: scope.programId,
          season_id: scope.seasonId,
          role: account.scopeRole,
          status: scopeStatus
        },
        [
          ["user_id", authUserId],
          ["program_id", scope.programId],
          ["season_id", scope.seasonId],
          ["role", account.scopeRole]
        ],
        createdItems.scopes
      );
      record("admin_scope_access", `created (role=${account.scopeRole}, status=${scopeStatus})`);
    } else {
      record("admin_scope_access", `insert role=${account.scopeRole} status=${scopeStatus}`);
    }
  }

  async function provisionPerson(scope) {
    logger.log(`\n${PERSON.full_name} <${PERSON.email_primary}>`);

    const { data: existingPerson, error: personReadError } = await db
      .from("people")
      .select("id,data_quality_flags,full_name")
      .eq("email_primary", PERSON.email_primary)
      .maybeSingle();
    if (personReadError) throw new Error(`people read failed or ambiguity detected: ${personReadError.message}`);

    let personId = existingPerson?.id ? String(existingPerson.id) : null;
    if (personId) {
      const marker = classifyFixtureMarker(existingPerson.data_quality_flags);
      if (marker === "none") {
        throw new Error(
          `people row exists for ${PERSON.email_primary} but data_quality_flags does not exactly equal a fixture marker. Aborting to prevent adoption.`
        );
      }
      if (existingPerson.full_name !== PERSON.full_name) {
        throw new Error(`people row exists for ${PERSON.email_primary} but full_name does not exact-match. Aborting.`);
      }
      if (marker === "retained") {
        throw new Error(
          `people row ${personId} is a retained, log-pinned fixture person from a previous UAT cycle and cannot be re-provisioned without a lifecycle status transition. Bump FIXTURE_TAG to provision a fresh person. Aborting.`
        );
      }
      skip(`people row present`);
    } else if (applyMode) {
      personId = await insertTracked(
        `people ${PERSON.email_primary}`,
        "people",
        {
          full_name: PERSON.full_name,
          email_primary: PERSON.email_primary,
          source_sheets: "admin_manual_input",
          data_quality_flags: ACTIVE_MARKER
        },
        [["email_primary", PERSON.email_primary], ["data_quality_flags", ACTIVE_MARKER]],
        createdItems.people
      );
      record("people", `created`);
    } else {
      record("people", "insert synthetic UAT person");
    }

    if (!personId) return;

    const { data: existingMembership, error: membershipReadError } = await db
      .from("person_season_memberships")
      .select("id,status,role")
      .eq("person_id", personId)
      .eq("season_id", scope.seasonId)
      .maybeSingle();
    if (membershipReadError) throw new Error(`membership read failed or ambiguity detected: ${membershipReadError.message}`);

    if (existingMembership?.id) {
      if (existingMembership.role !== PERSON.membershipRole || existingMembership.status !== PERSON.membershipStatus) {
        throw new Error(
          `person_season_memberships exists for person ${personId} but role/status does not exact-match expected. Aborting to prevent silent overwrite.`
        );
      }
      skip(`person_season_memberships row present`);
    } else if (applyMode) {
      await insertTracked(
        `person_season_memberships ${personId}`,
        "person_season_memberships",
        {
          person_id: personId,
          program_id: scope.programId,
          season_id: scope.seasonId,
          intake_batch_id: scope.batchId,
          role: PERSON.membershipRole,
          status: PERSON.membershipStatus,
          source: "manual",
          notes: ADMIN_NOTES_MARKER
        },
        [
          ["person_id", personId],
          ["season_id", scope.seasonId],
          ["role", PERSON.membershipRole]
        ],
        createdItems.memberships
      );
      record("person_season_memberships", `created`);
    } else {
      record("person_season_memberships", `insert role=${PERSON.membershipRole}`);
    }
  }

  try {
    const scope = await resolveFixtureScope(db);
    logger.log(`Scope resolved`);

    for (const account of ACCOUNTS) {
      await provisionAccount(account, scope);
    }
    await provisionPerson(scope);

    logger.log(`\n${applyMode ? "Applied" : "Planned"} ${actions.length} write(s).`);
  } catch (err) {
    logger.error(`\nFAILED: ${err.message}`);
    await rollback();
    throw err;
  }
}

// --- CLI execution ---------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  loadEnvLocal(readFileSync, existsSync, resolve(ROOT, ".env.local"));

  const applyMode = parseApplyMode(process.argv);
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const FIXTURE_PASSWORD = process.env.VAM_UAT_FIXTURE_PASSWORD ?? "";

  function abort(message) {
    console.error(`\nSAFETY ABORT: ${message}\n`);
    process.exit(1);
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
  if (!FIXTURE_PASSWORD || FIXTURE_PASSWORD.length < 12) {
    abort("VAM_UAT_FIXTURE_PASSWORD must be set and at least 12 characters.");
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log(`VAM OS UAT fixtures — target staging host ${STAGING_HOSTNAME}`);
  console.log(applyMode ? "MODE: APPLY (writes will be performed)" : "MODE: DRY RUN (no writes; pass --apply to execute)");

  runFixtures(db, applyMode, FIXTURE_PASSWORD, console).catch(() => {
    process.exit(1);
  });
}

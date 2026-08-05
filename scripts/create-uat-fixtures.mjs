#!/usr/bin/env node
// VAM OS — UAT fixture provisioning for STAGING ONLY.
//
// Provisions the six stable Auth/admin accounts plus one per-run synthetic
// person and membership. Identity, ownership markers and the staging guard live
// in ./uat-fixture-common.mjs and are shared with the teardown script.
//
// The six accounts are stable across runs and are reused, not accumulated. The
// person and membership belong to exactly one VAM_UAT_RUN_ID, so a run whose
// person gets log-pinned by lifecycle UAT never blocks the next run.
//
// Invariants:
//
//   * A row that already existed is never deleted, never overwritten and never
//     re-marked. The one exception is a *retained* fixture admin row (status
//     inactive, auth_user_id null, exact marker) left behind by a previous
//     teardown, which may be relinked to a freshly created Auth user. That
//     relink is tracked and reverted on rollback, never deleted.
//   * A write counts as successful only once its returned identity is
//     validated. A success response with no id triggers an exact re-query so the
//     row can still be compensated, and aborts the run either way.
//   * An Auth user is deleted during rollback only when nothing still points at
//     its UUID. Any admin row that could not be removed or unlinked, and any
//     scope row that could not be deleted, retains its Auth user instead.
//
// Usage:
//   VAM_UAT_RUN_ID=20260805-01 node scripts/create-uat-fixtures.mjs
//   VAM_UAT_RUN_ID=20260805-01 node scripts/create-uat-fixtures.mjs --apply
//   node scripts/create-uat-fixtures.mjs --run-id=20260805-01

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  ACCOUNTS,
  ACCOUNT_NOTES_MARKER,
  ACCOUNT_TAG,
  LOOKUP_PASS_LINE,
  PLAN_PASS_LINE,
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
  resolveRunId,
  schemaPreflightLine,
  scopeStatusFor
} from "./uat-fixture-common.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export { ACCOUNTS, email };

export async function runFixtures(db, applyMode, fixturePassword, logger = console, options = {}) {
  // Validated before anything touches the network.
  const person = personIdentityForRun(options.runId);
  const schemaPreflightVerified = options.schemaPreflightVerified === true;

  const actions = [];
  const createdItems = {
    authUsers: [],
    adminUsers: [],
    relinkedAdmins: [],
    scopes: [],
    people: [],
    memberships: []
  };

  // Per-Auth-UUID rollback gate. An Auth user is only deletable while nothing
  // that references its UUID has been left behind.
  const authBlockers = new Map();
  function blockAuthDeletion(authUserId, reason) {
    if (!authUserId) return;
    const key = String(authUserId);
    const reasons = authBlockers.get(key) ?? [];
    reasons.push(reason);
    authBlockers.set(key, reasons);
  }

  function record(kind, detail) {
    actions.push({ kind, detail });
    logger.log(`  ${applyMode ? "[write]" : "[would]"} ${kind}: ${detail}`);
  }
  function skip(detail) {
    logger.log(`  [exists] ${detail}`);
  }

  // --- Write-response validation ------------------------------------------

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

  async function insertTracked(label, table, payload, recoveryFilters, onTracked) {
    const { data, error } = await db.from(table).insert(payload).select("id").maybeSingle();
    if (error) throw new Error(`${label}: insert failed (${error.message}).`);

    const id = data?.id ? String(data.id) : null;
    if (id) {
      onTracked(id);
      return id;
    }

    const recovered = await recoverInsertedId(label, table, recoveryFilters);
    if (recovered) {
      onTracked(recovered);
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
      user_metadata: { vam_uat_fixture: ACCOUNT_TAG }
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
        const { error } = await db.from("people").update({ data_quality_flags: person.retainedMarker }).eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to soft-retire person ${id}`); failedRollbacks += 1; }
        else logger.log(`  [rollback-ok] soft-retired person ${id}`);
      } else {
        const { error } = await db.from("people").delete().eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to delete person ${id}`); failedRollbacks += 1; }
        else logger.log(`  [rollback-ok] deleted person ${id}`);
      }
    }

    // admin_scope_access.user_id has no FK to auth.users, so a surviving scope
    // row would become a dangling reference if its Auth user were deleted.
    for (const scope of createdItems.scopes) {
      const { error } = await db.from("admin_scope_access").delete().eq("id", scope.id);
      if (error) {
        logger.error(`  [rollback-fail] failed to delete scope ${scope.id}`);
        blockAuthDeletion(scope.authUserId, `admin_scope_access ${scope.id} could not be deleted`);
        failedRollbacks += 1;
      } else {
        logger.log(`  [rollback-ok] deleted scope ${scope.id}`);
      }
    }

    for (const admin of createdItems.adminUsers) {
      const actorCount = await pinCount("admin_users", admin.id, "admin_audit_log", "actor_admin_user_id");
      if (actorCount === null) {
        blockAuthDeletion(admin.authUserId, `admin_users ${admin.id} audit pin state unresolved`);
        continue;
      }
      const targetCount = await pinCount("admin_users", admin.id, "admin_audit_log", "target_admin_user_id");
      if (targetCount === null) {
        blockAuthDeletion(admin.authUserId, `admin_users ${admin.id} audit pin state unresolved`);
        continue;
      }

      if (actorCount + targetCount > 0) {
        logger.log(`  [rollback-skip] admin_users ${admin.id} pinned by audit log, retiring and clearing auth link instead`);
        const { data, error } = await db
          .from("admin_users")
          .update({ status: "inactive", auth_user_id: null })
          .eq("id", admin.id)
          .select("id");
        const affected = (data ?? []).length;
        if (error || affected !== 1) {
          logger.error(
            `  [rollback-fail] failed to clear auth link on admin_users ${admin.id} (${error ? error.message : `${affected} row(s) affected`})`
          );
          blockAuthDeletion(admin.authUserId, `admin_users ${admin.id} still holds its auth_user_id`);
          failedRollbacks += 1;
        } else {
          logger.log(`  [rollback-ok] retired admin_users ${admin.id} (auth link cleared)`);
        }
      } else {
        const { data, error } = await db.from("admin_users").delete().eq("id", admin.id).select("id");
        const affected = (data ?? []).length;
        if (error || affected !== 1) {
          logger.error(
            `  [rollback-fail] failed to delete admin_users ${admin.id} (${error ? error.message : `${affected} row(s) affected`})`
          );
          blockAuthDeletion(admin.authUserId, `admin_users ${admin.id} could not be deleted`);
          failedRollbacks += 1;
        } else {
          logger.log(`  [rollback-ok] deleted admin_users ${admin.id}`);
        }
      }
    }

    // Pre-existing retained rows are reverted, never deleted.
    for (const admin of createdItems.relinkedAdmins) {
      const { data, error } = await db
        .from("admin_users")
        .update({ status: "inactive", auth_user_id: null })
        .eq("id", admin.id)
        .select("id");
      const affected = (data ?? []).length;
      if (error || affected !== 1) {
        logger.error(
          `  [rollback-fail] failed to revert relink of admin_users ${admin.id} (${error ? error.message : `${affected} row(s) affected`})`
        );
        blockAuthDeletion(admin.authUserId, `admin_users ${admin.id} still holds its relinked auth_user_id`);
        failedRollbacks += 1;
      } else {
        logger.log(`  [rollback-ok] reverted relink of pre-existing admin_users ${admin.id}`);
      }
    }

    // Auth deletion runs last, and only for UUIDs nothing points at any more.
    for (const id of createdItems.authUsers) {
      const reasons = authBlockers.get(String(id));
      if (reasons?.length) {
        logger.error(`  [keep] auth.users ${id} retained — ${reasons.join("; ")}`);
        failedRollbacks += 1;
        continue;
      }
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) { logger.error(`  [rollback-fail] failed to delete auth.users ${id}`); failedRollbacks += 1; }
      else logger.log(`  [rollback-ok] deleted auth.users ${id}`);
    }

    const retained = createdItems.authUsers.filter((id) => authBlockers.get(String(id))?.length);
    if (retained.length > 0) {
      logger.error(`[ROLLBACK] Retained auth.users requiring manual review: ${retained.join(", ")}`);
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
    createdItems.relinkedAdmins.push({ id: String(rowId), authUserId: String(newAuthUserId) });
    record("admin_users", `relinked retained fixture row ${rowId} → status=${expectedStatus}`);
  }

  async function provisionAccount(account, scope) {
    const address = email(account.slug);
    logger.log(`\n${account.fullName} <${address}>`);

    let authUser = await findAuthUserByEmail(db, address);
    if (authUser) {
      if (!isExactAuthFixtureMarker(authUser.user_metadata?.vam_uat_fixture)) {
        throw new Error(
          `auth.users ${address} exists but its user_metadata.vam_uat_fixture does not exactly equal the account tag. Aborting to prevent adoption.`
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
          notes: ACCOUNT_NOTES_MARKER
        },
        [["email", address], ["notes", ACCOUNT_NOTES_MARKER]],
        (id) => createdItems.adminUsers.push({ id, authUserId })
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
        (id) => createdItems.scopes.push({ id, authUserId })
      );
      record("admin_scope_access", `created (role=${account.scopeRole}, status=${scopeStatus})`);
    } else {
      record("admin_scope_access", `insert role=${account.scopeRole} status=${scopeStatus}`);
    }
  }

  async function provisionPerson(scope) {
    logger.log(`\n${person.full_name} <${person.email_primary}>`);

    const { data: existingPerson, error: personReadError } = await db
      .from("people")
      .select("id,data_quality_flags,full_name")
      .eq("email_primary", person.email_primary)
      .maybeSingle();
    if (personReadError) throw new Error(`people read failed or ambiguity detected: ${personReadError.message}`);

    let personId = existingPerson?.id ? String(existingPerson.id) : null;
    if (personId) {
      const marker = classifyPersonRunMarker(existingPerson.data_quality_flags, person);
      if (marker === "none") {
        throw new Error(
          `people row exists for ${person.email_primary} but data_quality_flags does not exactly equal a run ${person.runId} marker. Aborting to prevent adoption.`
        );
      }
      if (existingPerson.full_name !== person.full_name) {
        throw new Error(`people row exists for ${person.email_primary} but full_name does not exact-match. Aborting.`);
      }
      if (marker === "retained") {
        throw new Error(
          `people row ${personId} is the retained, log-pinned person of UAT run ${person.runId}. That run has already completed its lifecycle and its identity cannot be reused. Start a new run with a fresh VAM_UAT_RUN_ID. Aborting.`
        );
      }
      skip(`people row present`);
    } else if (applyMode) {
      personId = await insertTracked(
        `people ${person.email_primary}`,
        "people",
        {
          full_name: person.full_name,
          email_primary: person.email_primary,
          source_sheets: "admin_manual_input",
          data_quality_flags: person.activeMarker
        },
        [["email_primary", person.email_primary], ["data_quality_flags", person.activeMarker]],
        (id) => createdItems.people.push(id)
      );
      record("people", `created`);
    } else {
      record("people", `insert synthetic UAT person for run ${person.runId}`);
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
      if (existingMembership.role !== person.membershipRole || existingMembership.status !== person.membershipStatus) {
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
          role: person.membershipRole,
          status: person.membershipStatus,
          source: "manual",
          notes: ACCOUNT_NOTES_MARKER
        },
        [
          ["person_id", personId],
          ["season_id", scope.seasonId],
          ["role", person.membershipRole]
        ],
        (id) => createdItems.memberships.push(id)
      );
      record("person_season_memberships", `created`);
    } else {
      record("person_season_memberships", `insert role=${person.membershipRole}`);
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

    if (!applyMode) {
      // A REST dry-run proves the plan and the live lookups. It cannot prove
      // live column types, constraints or FK delete behaviour, so it must never
      // report schema compatibility on its own.
      logger.log(`\n${PLAN_PASS_LINE}`);
      logger.log(LOOKUP_PASS_LINE);
      logger.log(schemaPreflightLine(schemaPreflightVerified));
    }
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

  // Run id is validated before any client is constructed.
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
  if (!FIXTURE_PASSWORD || FIXTURE_PASSWORD.length < 12) {
    abort("VAM_UAT_FIXTURE_PASSWORD must be set and at least 12 characters.");
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log(`VAM OS UAT fixtures — target staging host ${STAGING_HOSTNAME}`);
  console.log(`Stable account tag ${ACCOUNT_TAG} — lifecycle run id ${runId}`);
  console.log(applyMode ? "MODE: APPLY (writes will be performed)" : "MODE: DRY RUN (no writes; pass --apply to execute)");

  runFixtures(db, applyMode, FIXTURE_PASSWORD, console, {
    runId,
    schemaPreflightVerified: process.env.VAM_UAT_SCHEMA_PREFLIGHT === "verified"
  }).catch(() => {
    process.exit(1);
  });
}

#!/usr/bin/env node
// VAM OS — UAT fixture provisioning for STAGING ONLY.
//
// Creates the six-account UAT matrix plus one synthetic person and membership.
//
// Usage:
//   node scripts/create-uat-fixtures.mjs            # dry run, no writes
//   node scripts/create-uat-fixtures.mjs --apply    # perform writes

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_PROJECT_REF = "ljfneyuvpxrmejpxsmpz";
const FIXTURE_TAG = "20260805";
const SEASON_CODE = "UEHM-S12";
const BATCH_CODE = "UEHM-S12-B1";

export const email = (slug) => `uat.${slug}+${FIXTURE_TAG}@example.com`;

export const ACCOUNTS = [
  { slug: "admin", fullName: "UAT Active Admin", adminRole: "admin", status: "active", scopeRole: "full_access" },
  { slug: "reviewer", fullName: "UAT Active Reviewer", adminRole: "reviewer", status: "active", scopeRole: "review" },
  { slug: "support", fullName: "UAT Active Support", adminRole: "support_team", status: "active", scopeRole: "operations" },
  { slug: "viewer", fullName: "UAT Active Viewer", adminRole: "viewer", status: "active", scopeRole: "read" },
  { slug: "nonadmin", fullName: "UAT Auth Non-admin", adminRole: null, status: null, scopeRole: null },
  { slug: "status", fullName: "UAT Status Test", adminRole: "admin", status: "invited", scopeRole: "read" }
];

export const PERSON = {
  full_name: `VAM-UAT-${FIXTURE_TAG} Person`,
  email_primary: email("person"),
  membershipRole: "mentor"
};

export async function runFixtures(db, applyMode, fixturePassword, logger = console) {
  const actions = [];
  const createdItems = {
    authUsers: [],
    adminUsers: [],
    scopes: [],
    people: [],
    memberships: []
  };

  function record(kind, detail) {
    actions.push({ kind, detail });
    logger.log(`  ${applyMode ? "[write]" : "[would]"} ${kind}: ${detail}`);
  }
  function skip(detail) {
    logger.log(`  [exists] ${detail}`);
  }

  async function findAuthUserByEmail(target) {
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`listUsers failed`);
      const hit = (data?.users ?? []).find((u) => String(u.email ?? "").toLowerCase() === target.toLowerCase());
      if (hit) return hit;
      if ((data?.users?.length ?? 0) < 200) return null;
    }
    return null;
  }

  async function countRows(table, column, value) {
    const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, value);
    if (error) return 0;
    return count ?? 0;
  }

  async function rollback() {
    if (!applyMode) return;
    logger.log("\n[ROLLBACK] Initiating transaction-like compensation for this run...");
    let failedRollbacks = 0;

    for (const id of createdItems.memberships) {
      const logCount = await countRows("person_season_membership_log", "membership_id", id);
      if (logCount > 0) {
        logger.log(`  [rollback-skip] membership ${id} has log rows, soft-retiring instead`);
        const { error } = await db.from("person_season_memberships").update({ status: "cancelled", notes: "rollback soft-retire" }).eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to soft-retire membership ${id}`); failedRollbacks++; }
      } else {
        const { error } = await db.from("person_season_memberships").delete().eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to delete membership ${id}`); failedRollbacks++; }
        else logger.log(`  [rollback-ok] deleted membership ${id}`);
      }
    }

    for (const id of createdItems.people) {
      const logCount = await countRows("person_season_membership_log", "person_id", id);
      if (logCount > 0) {
        logger.log(`  [rollback-skip] person ${id} has log rows, leaving retained`);
      } else {
        const { error } = await db.from("people").delete().eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to delete person ${id}`); failedRollbacks++; }
        else logger.log(`  [rollback-ok] deleted person ${id}`);
      }
    }

    for (const id of createdItems.scopes) {
      const { error } = await db.from("admin_scope_access").delete().eq("id", id);
      if (error) { logger.error(`  [rollback-fail] failed to delete scope ${id}`); failedRollbacks++; }
      else logger.log(`  [rollback-ok] deleted scope ${id}`);
    }

    for (const id of createdItems.adminUsers) {
      const actorCount = await countRows("admin_audit_log", "actor_admin_user_id", id);
      const targetCount = await countRows("admin_audit_log", "target_admin_user_id", id);
      if (actorCount + targetCount > 0) {
        logger.log(`  [rollback-skip] admin_users ${id} pinned by audit log, soft-retiring instead`);
        const { error } = await db.from("admin_users").update({ status: "inactive" }).eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to soft-retire admin_users ${id}`); failedRollbacks++; }
      } else {
        const { error } = await db.from("admin_users").delete().eq("id", id);
        if (error) { logger.error(`  [rollback-fail] failed to delete admin_users ${id}`); failedRollbacks++; }
        else logger.log(`  [rollback-ok] deleted admin_users ${id}`);
      }
    }

    for (const id of createdItems.authUsers) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) { logger.error(`  [rollback-fail] failed to delete auth.users ${id}`); failedRollbacks++; }
      else logger.log(`  [rollback-ok] deleted auth.users ${id}`);
    }

    if (failedRollbacks > 0) {
      logger.error(`\n[ROLLBACK] Completed with ${failedRollbacks} failure(s).`);
    } else {
      logger.log(`\n[ROLLBACK] Completed successfully.`);
    }
  }

  async function resolveScope() {
    const { data: season, error: seasonError } = await db.from("seasons").select("id,code,program_id").eq("code", SEASON_CODE).maybeSingle();
    if (seasonError) throw new Error("Could not read seasons");
    if (!season?.id) throw new Error(`Season ${SEASON_CODE} does not exist`);

    const { data: program, error: programError } = await db.from("programs").select("id,code,is_active").eq("id", season.program_id).maybeSingle();
    if (programError) throw new Error("Could not read programs");
    if (!program?.id) throw new Error("Season references missing program");
    if (program.is_active !== true) throw new Error(`Program ${program.code} is not active`);

    const { data: batch } = await db.from("intake_batches").select("id,code,season_id").eq("code", BATCH_CODE).maybeSingle();
    if (batch?.id && String(batch.season_id) !== String(season.id)) throw new Error(`Batch ${BATCH_CODE} mismatch`);

    return { programId: String(program.id), programCode: program.code, seasonId: String(season.id), batchId: batch?.id ? String(batch.id) : null };
  }

  async function provisionAccount(account, scope) {
    const address = email(account.slug);
    logger.log(`\n${account.fullName} <${address}>`);

    let authUser = await findAuthUserByEmail(address);
    if (authUser) {
      if (authUser.user_metadata?.vam_uat_fixture !== FIXTURE_TAG) {
        throw new Error(`Auth user ${address} exists but lacks correct UAT fixture metadata. Aborting to prevent adoption.`);
      }
      skip(`auth.users row already present`);
    } else if (applyMode) {
      const { data, error } = await db.auth.admin.createUser({
        email: address,
        password: fixturePassword,
        email_confirm: true,
        user_metadata: { vam_uat_fixture: FIXTURE_TAG }
      });
      if (error) throw new Error(`createUser failed: ${error.message}`);
      authUser = data.user;
      createdItems.authUsers.push(authUser.id);
      record("auth.users", `created`);
    } else {
      record("auth.users", `create confirmed user`);
    }

    if (!account.adminRole) {
      logger.log("  [by design] no admin_users row");
      return;
    }

    const authUserId = authUser?.id ?? null;

    const { data: existingAdmin, error: adminReadError } = await db.from("admin_users").select("id,role,status,auth_user_id,notes").eq("email", address).maybeSingle();
    if (adminReadError) throw new Error(`admin_users read failed`);

    if (existingAdmin?.id) {
      if (existingAdmin.role !== account.adminRole || existingAdmin.status !== account.status || existingAdmin.auth_user_id !== authUserId) {
        throw new Error(`admin_users row exists for ${address} but role/status/auth_user_id does not exact-match expected. Aborting to prevent silent overwrite.`);
      }
      skip(`admin_users row present`);
    } else if (applyMode) {
      const { data, error } = await db.from("admin_users").insert({
        auth_user_id: authUserId,
        email: address,
        full_name: account.fullName,
        role: account.adminRole,
        status: account.status,
        notes: `VAM UAT fixture ${FIXTURE_TAG}`
      }).select("id").maybeSingle();
      if (error) throw new Error(`admin_users insert failed`);
      createdItems.adminUsers.push(data.id);
      record("admin_users", `created (role=${account.adminRole})`);
    } else {
      record("admin_users", `insert role=${account.adminRole}`);
    }

    if (!authUserId) return;

    const { data: existingScope, error: scopeReadError } = await db.from("admin_scope_access").select("id,role,status").eq("user_id", authUserId).eq("program_id", scope.programId).eq("season_id", scope.seasonId).maybeSingle();
    if (scopeReadError) throw new Error(`admin_scope_access read failed`);

    const scopeStatus = account.status === "active" ? "active" : "inactive";
    if (existingScope?.id) {
      if (existingScope.role !== account.scopeRole || existingScope.status !== scopeStatus) {
        throw new Error(`admin_scope_access exists for ${address} but role/status does not exact-match. Aborting.`);
      }
      skip(`admin_scope_access row present`);
    } else if (applyMode) {
      const { data, error } = await db.from("admin_scope_access").insert({
        user_id: authUserId,
        program_id: scope.programId,
        season_id: scope.seasonId,
        role: account.scopeRole,
        status: scopeStatus
      }).select("id").maybeSingle();
      if (error) throw new Error(`admin_scope_access insert failed`);
      createdItems.scopes.push(data.id);
      record("admin_scope_access", `created`);
    } else {
      record("admin_scope_access", `insert role=${account.scopeRole}`);
    }
  }

  async function provisionPerson(scope) {
    logger.log(`\n${PERSON.full_name} <${PERSON.email_primary}>`);

    const { data: existingPerson, error: personReadError } = await db.from("people").select("id,data_quality_flags").ilike("email_primary", PERSON.email_primary).maybeSingle();
    if (personReadError) throw new Error(`people read failed`);

    let personId = existingPerson?.id ? String(existingPerson.id) : null;
    if (personId) {
      if (!existingPerson.data_quality_flags?.includes(FIXTURE_TAG)) {
        throw new Error(`people row exists for ${PERSON.email_primary} but lacks correct UAT fixture marker. Aborting.`);
      }
      skip(`people row present`);
    } else if (applyMode) {
      const { data, error } = await db.from("people").insert({
        full_name: PERSON.full_name,
        email_primary: PERSON.email_primary,
        source_sheets: "admin_manual_input",
        data_quality_flags: `vam_uat_fixture:${FIXTURE_TAG}`
      }).select("id").maybeSingle();
      if (error) throw new Error(`people insert failed`);
      personId = String(data.id);
      createdItems.people.push(personId);
      record("people", `created`);
    } else {
      record("people", "insert synthetic UAT person");
    }

    if (!personId) return;

    const { data: existingMembership, error: membershipReadError } = await db.from("person_season_memberships").select("id,status,role").eq("person_id", personId).eq("season_id", scope.seasonId).maybeSingle();
    if (membershipReadError) throw new Error(`membership read failed`);

    if (existingMembership?.id) {
      if (existingMembership.role !== PERSON.membershipRole || existingMembership.status !== "active") {
        throw new Error(`membership exists but role/status does not exact-match. Aborting.`);
      }
      skip(`person_season_memberships row present`);
    } else if (applyMode) {
      const { data, error } = await db.from("person_season_memberships").insert({
        person_id: personId,
        program_id: scope.programId,
        season_id: scope.seasonId,
        intake_batch_id: scope.batchId,
        role: PERSON.membershipRole,
        status: "active",
        source: "manual",
        notes: `VAM UAT fixture ${FIXTURE_TAG}`
      }).select("id").maybeSingle();
      if (error) throw new Error(`membership insert failed`);
      createdItems.memberships.push(data.id);
      record("person_season_memberships", `created`);
    } else {
      record("person_season_memberships", `insert role=${PERSON.membershipRole}`);
    }
  }

  try {
    const scope = await resolveScope();
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

// Check if running directly via node
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  function loadEnvLocal() {
    const path = resolve(ROOT, ".env.local");
    if (!existsSync(path)) return;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }

  loadEnvLocal();

  const applyMode = process.argv.includes("--apply");
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const FIXTURE_PASSWORD = process.env.VAM_UAT_FIXTURE_PASSWORD ?? "";

  function abort(message) {
    console.error(`\nSAFETY ABORT: ${message}\n`);
    process.exit(1);
  }

  if (!SUPABASE_URL) abort("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!SUPABASE_URL.includes(STAGING_PROJECT_REF)) {
    abort(`Environment does not point at VAM OS staging (${STAGING_PROJECT_REF}). No writes attempted.`);
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

  console.log(`VAM OS UAT fixtures — target staging ref ${STAGING_PROJECT_REF}`);
  console.log(applyMode ? "MODE: APPLY (writes will be performed)" : "MODE: DRY RUN (no writes; pass --apply to execute)");

  runFixtures(db, applyMode, FIXTURE_PASSWORD, console).catch(() => {
    process.exit(1);
  });
}

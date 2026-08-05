#!/usr/bin/env node
// VAM OS — UAT fixture teardown for STAGING ONLY.
//
// Cleanup is conditional, because the schema decides what is removable:
//
//   * person_season_membership_log is append-only (trigger
//     prevent_person_season_membership_log_mutation blocks UPDATE and DELETE)
//     and holds ON DELETE RESTRICT foreign keys to both the membership and the
//     person. Once UAT exercises a lifecycle transition through the app, that
//     membership and person become permanently undeletable.
//   * admin_audit_log holds ON DELETE RESTRICT to admin_users on both
//     actor_admin_user_id and target_admin_user_id. Once a fixture account
//     performs or receives an audited action, its admin_users row is pinned.
//
// So this script hard-deletes what is still detached, and soft-retires the
// rest. It never attempts to bypass a trigger or drop a constraint.
//
// Usage:
//   node scripts/cleanup-uat-fixtures.mjs            # dry run, no writes
//   node scripts/cleanup-uat-fixtures.mjs --apply    # perform teardown

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_PROJECT_REF = "ljfneyuvpxrmejpxsmpz";
const FIXTURE_TAG = "20260805";
const APPLY = process.argv.includes("--apply");

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function abort(message) {
  console.error(`\nSAFETY ABORT: ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) abort("NEXT_PUBLIC_SUPABASE_URL is not set.");
if (!SUPABASE_URL.includes(STAGING_PROJECT_REF)) {
  abort(`Environment does not point at VAM OS staging (${STAGING_PROJECT_REF}). No writes attempted.`);
}
if (!SERVICE_ROLE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is not set.");

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const SLUGS = ["admin", "reviewer", "support", "viewer", "nonadmin", "status"];
const email = (slug) => `uat.${slug}+${FIXTURE_TAG}@example.com`;
const PERSON_EMAIL = email("person");

function act(verb, detail) {
  console.log(`  ${APPLY ? "[write]" : "[would]"} ${verb}: ${detail}`);
}
function note(detail) {
  console.log(`  [keep] ${detail}`);
}

async function findAuthUserByEmail(target) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = (data?.users ?? []).find((u) => String(u.email ?? "").toLowerCase() === target.toLowerCase());
    if (hit) return hit;
    if ((data?.users?.length ?? 0) < 200) return null;
  }
  return null;
}

async function countRows(table, column, value) {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

async function cleanupPerson() {
  console.log(`\nSynthetic person <${PERSON_EMAIL}>`);
  const { data: person, error } = await db.from("people").select("id").ilike("email_primary", PERSON_EMAIL).maybeSingle();
  if (error) throw new Error(`people read failed: ${error.message}`);
  if (!person?.id) {
    console.log("  [absent] no people row");
    return;
  }
  const personId = String(person.id);

  const { data: memberships, error: membershipError } = await db
    .from("person_season_memberships")
    .select("id,status")
    .eq("person_id", personId);
  if (membershipError) throw new Error(`membership read failed: ${membershipError.message}`);

  let pinned = false;
  for (const membership of memberships ?? []) {
    const logCount = await countRows("person_season_membership_log", "membership_id", membership.id);
    if (logCount > 0) {
      pinned = true;
      note(`membership ${membership.id} has ${logCount} append-only log row(s) — ON DELETE RESTRICT, cannot be removed`);
      if (APPLY && membership.status !== "cancelled") {
        const { error: updateError } = await db
          .from("person_season_memberships")
          .update({ status: "cancelled", notes: `VAM UAT fixture ${FIXTURE_TAG} — retained, log-pinned`, updated_at: new Date().toISOString() })
          .eq("id", membership.id);
        if (updateError) throw new Error(`membership soft-retire failed: ${updateError.message}`);
        act("soft-retire membership", `${membership.id} → cancelled`);
      } else if (!APPLY) {
        act("soft-retire membership", `${membership.id} → cancelled`);
      }
    } else if (APPLY) {
      const { error: deleteError } = await db.from("person_season_memberships").delete().eq("id", membership.id);
      if (deleteError) throw new Error(`membership delete failed: ${deleteError.message}`);
      act("delete membership", membership.id);
    } else {
      act("delete membership", `${membership.id} (no log rows — detached)`);
    }
  }

  const personLogCount = await countRows("person_season_membership_log", "person_id", personId);
  if (personLogCount > 0 || pinned) {
    note(`people row ${personId} retained — ${personLogCount} log row(s) reference it`);
    if (APPLY) {
      const { error: flagError } = await db
        .from("people")
        .update({ data_quality_flags: `vam_uat_fixture:${FIXTURE_TAG}:retained` })
        .eq("id", personId);
      if (flagError) throw new Error(`people flag failed: ${flagError.message}`);
      act("flag person", `${personId} → retained`);
    }
    return;
  }

  if (APPLY) {
    const { error: deleteError } = await db.from("people").delete().eq("id", personId);
    if (deleteError) throw new Error(`people delete failed: ${deleteError.message}`);
    act("delete person", personId);
  } else {
    act("delete person", `${personId} (no log rows — detached)`);
  }
}

async function cleanupAccount(slug) {
  const address = email(slug);
  console.log(`\n<${address}>`);

  const { data: adminUser, error: adminError } = await db
    .from("admin_users")
    .select("id,status,auth_user_id")
    .eq("email", address)
    .maybeSingle();
  if (adminError) throw new Error(`admin_users read failed: ${adminError.message}`);

  let authUserId = adminUser?.auth_user_id ? String(adminUser.auth_user_id) : null;

  if (adminUser?.id) {
    const actorCount = await countRows("admin_audit_log", "actor_admin_user_id", adminUser.id);
    const targetCount = await countRows("admin_audit_log", "target_admin_user_id", adminUser.id);
    const auditCount = actorCount + targetCount;

    if (auditCount > 0) {
      note(`admin_users ${adminUser.id} pinned by ${auditCount} admin_audit_log row(s) — ON DELETE RESTRICT`);
      if (APPLY && adminUser.status !== "inactive") {
        const { error } = await db
          .from("admin_users")
          .update({ status: "inactive", updated_at: new Date().toISOString() })
          .eq("id", adminUser.id);
        if (error) throw new Error(`admin_users soft-retire failed: ${error.message}`);
        act("soft-retire admin_users", `${adminUser.id} → inactive`);
      } else if (!APPLY) {
        act("soft-retire admin_users", `${adminUser.id} → inactive`);
      }
    } else if (APPLY) {
      const { error } = await db.from("admin_users").delete().eq("id", adminUser.id);
      if (error) throw new Error(`admin_users delete failed: ${error.message}`);
      act("delete admin_users", adminUser.id);
    } else {
      act("delete admin_users", `${adminUser.id} (no audit rows — detached)`);
    }
  } else {
    console.log("  [absent] no admin_users row");
  }

  const authUser = await findAuthUserByEmail(address);
  if (authUser) authUserId = authUser.id;

  if (authUserId) {
    const { data: scopes, error: scopeError } = await db.from("admin_scope_access").select("id").eq("user_id", authUserId);
    if (scopeError) throw new Error(`admin_scope_access read failed: ${scopeError.message}`);
    if ((scopes ?? []).length === 0) {
      console.log("  [absent] no admin_scope_access rows");
    } else if (APPLY) {
      const { error } = await db.from("admin_scope_access").delete().eq("user_id", authUserId);
      if (error) throw new Error(`admin_scope_access delete failed: ${error.message}`);
      act("delete admin_scope_access", `${scopes.length} row(s)`);
    } else {
      act("delete admin_scope_access", `${scopes.length} row(s)`);
    }
  }

  if (!authUser) {
    console.log("  [absent] no auth.users row");
    return;
  }
  if (APPLY) {
    const { error } = await db.auth.admin.deleteUser(authUser.id);
    if (error) throw new Error(`auth deleteUser failed: ${error.message}`);
    act("delete auth.users", authUser.id);
  } else {
    act("delete auth.users", authUser.id);
  }
}

async function main() {
  console.log(`VAM OS UAT fixture teardown — target staging ref ${STAGING_PROJECT_REF}`);
  console.log(APPLY ? "MODE: APPLY (writes will be performed)" : "MODE: DRY RUN (no writes; pass --apply to execute)");

  await cleanupPerson();
  for (const slug of SLUGS) {
    await cleanupAccount(slug);
  }

  console.log("\nTeardown complete.");
  console.log("Rows reported as [keep] are retained by schema design, not by script failure.");
  if (!APPLY) console.log("Re-run with --apply to execute.");
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});

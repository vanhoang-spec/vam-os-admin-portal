/**
 * Disposable PostgreSQL harness for the S12 recruitment RPCs.
 *
 * WHY IT EXISTS
 *   Every concurrency and lifecycle claim in the withdrawn-quarantine and
 *   direct-invite candidates was, until now, asserted by reading the migration
 *   text. Substring assertions cannot catch a semantic error that preserves the
 *   strings. This runs the real function bodies.
 *
 * WHAT IT TOUCHES
 *   A cluster it creates itself, in a temporary directory, on a free port, with
 *   trust auth on localhost only, and destroys on exit. It reads no environment
 *   variable naming a database, and cannot reach Production or Staging: the
 *   connection string is constructed here and points at the temp cluster.
 *
 * HOW TO RUN
 *   node scripts/pg-harness/run.mjs
 *   Set PG_BIN if the PostgreSQL binaries are not on PATH.
 *   Exits 0 when every case passes, 1 otherwise. Skips with exit 0 and a clear
 *   message when no local PostgreSQL is available.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const ROOT = process.cwd();
const HARNESS = join(ROOT, "scripts", "pg-harness");

const CANDIDATE_BIN_DIRS = [
  process.env.PG_BIN,
  "C:/Program Files/PostgreSQL/17/bin",
  "C:/Program Files/PostgreSQL/16/bin",
  "/usr/lib/postgresql/16/bin",
  "/usr/lib/postgresql/15/bin",
  "/usr/local/opt/postgresql/bin"
].filter(Boolean);

function resolveBinDir() {
  for (const dir of CANDIDATE_BIN_DIRS) {
    const initdb = join(dir, process.platform === "win32" ? "initdb.exe" : "initdb");
    if (existsSync(initdb)) return dir;
  }
  const probe = spawnSync("initdb", ["--version"], { encoding: "utf8" });
  return probe.status === 0 ? "" : null;
}

function bin(dir, name) {
  if (!dir) return name;
  return join(dir, process.platform === "win32" ? `${name}.exe` : name);
}

function run(cmd, args, options = {}) {
  // A bounded timeout, because a Windows initdb that decides to prompt will
  // otherwise hang the whole suite with no output at all.
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    ...options
  });
  if (result.error) {
    throw new Error(`${cmd} ${args.join(" ")} failed to run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}\n${result.stderr ?? ""}`
    );
  }
  return result.stdout ?? "";
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}\n        ${error.message.split("\n")[0]}`);
  }
}

function expectEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const binDir = resolveBinDir();
  if (binDir === null) {
    console.log("SKIP: no local PostgreSQL binaries found (set PG_BIN to enable).");
    console.log("PG_HARNESS=SKIPPED");
    process.exit(0);
  }

  let Client;
  try {
    ({ Client } = require("pg"));
  } catch {
    console.log("SKIP: the `pg` package is not installed.");
    console.log("PG_HARNESS=SKIPPED");
    process.exit(0);
  }

  const port = 5400 + Math.floor(Math.random() * 500);
  // A short, ASCII, space-free path. The system temp directory on Windows
  // resolves to an 8.3 short name containing `~`, which initdb does not handle
  // reliably — it hangs rather than reporting anything.
  const dataRoot = process.env.PG_HARNESS_DIR || (process.platform === "win32" ? "C:/tmp" : tmpdir());
  mkdirSync(dataRoot, { recursive: true });
  const dataDir = mkdtempSync(join(dataRoot, "vam-pg-")).split("\\").join("/");
  let server = null;
  let serverExited = null;
  let stopped = false;
  let removed = false;

  /**
   * Shuts the cluster down and removes the directory THIS RUN created.
   *
   * It removes `dataDir` and nothing else — never a glob over the parent — so a
   * directory left by an earlier run, or by anything else, is not this run's to
   * delete. Everything is awaited: a Windows file handle outlives the process
   * that held it by a few hundred milliseconds, so removing immediately after
   * kill() is what left directories behind before.
   */
  async function cleanup() {
    // 1. Ask the server to stop, then 2. wait for the process to actually go.
    if (server && !server.killed) {
      try {
        // `fast` shutdown: disconnect clients and exit, without the checkpoint
        // wait a `smart` shutdown would sit through.
        run(bin(binDir, "pg_ctl"), ["-D", dataDir, "-m", "fast", "stop"], { timeout: 30_000 });
      } catch {
        try {
          server.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    if (serverExited) {
      await Promise.race([
        serverExited,
        new Promise((resolve) => setTimeout(resolve, 30_000))
      ]);
    }
    stopped = !server || server.exitCode !== null || server.killed;

    // 3. Drop our references so nothing of ours still holds a handle.
    if (server) {
      server.stderr?.removeAllListeners();
      server.removeAllListeners();
      server.unref?.();
    }

    // 4/5. Remove, retrying briefly while Windows releases file handles.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* retried below */
      }
      if (!existsSync(dataDir)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // 6. Verify.
    removed = !existsSync(dataDir);
    console.log("");
    console.log(`TEMP_DIR_CREATED=${dataDir}`);
    console.log(`POSTGRES_STOPPED=${stopped ? "YES" : "NO"}`);
    console.log(`TEMP_DIR_REMOVED=${removed ? "YES" : "NO"}`);
  }

  try {
    console.log(`Creating disposable cluster in ${dataDir} on port ${port}…`);
    run(bin(binDir, "initdb"), ["-D", dataDir, "-U", "harness", "-A", "trust", "--no-sync"]);

    // Started directly rather than through pg_ctl: on Windows pg_ctl keeps its
    // stdio pipes open after the server is up, so a synchronous `-w` wait never
    // returns. Bound to 127.0.0.1 only.
    console.log("Starting server…");
    // Resolved when the server process has genuinely exited, so cleanup can
    // wait for it rather than assuming kill() is synchronous.
    server = spawn(
      bin(binDir, "postgres"),
      ["-D", dataDir, "-p", String(port), "-h", "127.0.0.1", "-c", "fsync=off", "-c", "full_page_writes=off"],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let serverStderr = "";
    server.stderr.on("data", (chunk) => {
      serverStderr += String(chunk);
    });
    serverExited = new Promise((resolve) => {
      server.on("exit", () => {
        server.killed = true;
        resolve();
      });
    });

    const connection = {
      host: "127.0.0.1",
      port,
      user: "harness",
      database: "postgres"
    };

    // Poll until the server accepts connections.
    const deadline = Date.now() + 60_000;
    let client = null;
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(`server did not accept connections within 60s
${serverStderr}`);
      }
      const probe = new Client(connection);
      try {
        await probe.connect();
        client = probe;
        break;
      } catch {
        await probe.end().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }

    // Every function under test guards on `current_user = 'service_role'`, so
    // the harness must genuinely BE that role rather than simulate it. A
    // superuser role keeps a disposable cluster free of grant plumbing that has
    // nothing to do with the behaviour being tested.
    await client.query("create role service_role superuser login");

    console.log("Loading synthetic schema…");
    await client.query(readFileSync(join(HARNESS, "schema.sql"), "utf8"));

    console.log("Loading migrations in filename order…");
    const migrations = [
      "supabase/migrations/20260903180000_p0_restore_recruitment_review_rpcs.sql",
      "supabase/migrations/20260905140900_s12_withdrawn_application_quarantine_restore.sql",
      "supabase/migrations/20260906090000_s12_direct_interview_invite.sql"
    ];
    for (const relative of migrations) {
      const sql = readFileSync(join(ROOT, relative), "utf8");
      const blocks = extractFunctions(sql).filter((block) => !isOverridden(block));
      if (!blocks.length) throw new Error(`no function bodies found in ${relative}`);
      for (const block of blocks) {
        try {
          await client.query(block);
        } catch (error) {
          const name = block.slice(0, 120).replace(/\s+/g, " ");
          throw new Error(`loading ${relative} :: ${name}
${error.message}`);
        }
      }
      console.log(`  loaded ${blocks.length} function(s) from ${relative.split("/").pop()}`);
    }

    console.log("Applying harness authorization overrides…");
    for (const block of extractFunctions(readFileSync(join(HARNESS, "overrides.sql"), "utf8"))) {
      await client.query(block);
    }

    await client.end();
    // Test connections run AS service_role.
    await runCases(Client, { ...connection, user: "service_role" });
  } finally {
    // finally-style, so the directory goes after success, after an assertion
    // failure, and after a thrown exception alike.
    await cleanup();
  }

  // 7. A run that cannot clean up after itself is a failed run.
  if (!removed) {
    console.log("PG_HARNESS=FAIL");
    console.error(`cleanup failed: ${dataDir} still exists`);
    process.exit(1);
  }

  console.log("");
  console.log(`PG_HARNESS_PASSED=${passed}`);
  console.log(`PG_HARNESS_FAILED=${failures.length}`);
  console.log(`PG_HARNESS=${failures.length ? "FAIL" : "PASS"}`);
  if (failures.length) {
    for (const failure of failures) {
      console.log(`\n--- ${failure.name} ---\n${failure.error.stack ?? failure.error.message}`);
    }
    process.exit(1);
  }
}

/**
 * Extracts every `CREATE [OR REPLACE] FUNCTION ... $tag$ ... $tag$;` block.
 *
 * The harness loads FUNCTIONS ONLY. Tables, indexes, policies, grants and the
 * catalog post-condition blocks belong to a Supabase project and are provided
 * instead by schema.sql, which declares exactly the columns these functions
 * read. Every function body is taken verbatim, character for character — that
 * is the whole point of running against a real server rather than grepping the
 * file.
 */
/**
 * Functions the harness replaces wholesale in overrides.sql.
 *
 * They resolve Supabase-specific authorization state (admin_scope_access, the
 * PostgREST role) that a disposable cluster cannot reproduce, and NONE of them
 * is changed by the candidates under test. Skipping them at load time avoids
 * dragging the whole scope schema into the fixture just to satisfy a body that
 * is about to be replaced anyway.
 */
const OVERRIDDEN_FUNCTIONS = [
  "vam063_trusted_api_role",
  "vam084_operator_for_season",
  "vam084_participant_for_stage",
  "vam084_recruitment_eligible_admins",
  "vam084_list_recruitment_participants",
  "vam084_grant_recruitment_participation",
  "vam084_revoke_recruitment_participation",
  "vam071_renewal_identity_lock",
  "vam071_accepted_renewal_exists"
];

function isOverridden(block) {
  const name = block.match(/function\s+public\.([a-z0-9_]+)/i)?.[1];
  return Boolean(name && OVERRIDDEN_FUNCTIONS.includes(name));
}

function extractFunctions(sql) {
  // The repository uses exactly two dollar-quote tags for function bodies.
  // Matching each explicitly avoids a backreference and keeps the pattern
  // readable; an unknown tag fails loudly as "no function bodies found"
  // rather than silently loading a truncated body.
  const patterns = [
    /create\s+(?:or\s+replace\s+)?function[\s\S]*?\$fn\$[\s\S]*?\$fn\$\s*;/gi,
    /create\s+(?:or\s+replace\s+)?function[\s\S]*?\$function\$[\s\S]*?\$function\$\s*;/gi
  ];
  const blocks = [];
  for (const pattern of patterns) {
    for (const match of sql.match(pattern) ?? []) blocks.push(match);
  }
  // Restore source order so a function exists before anything that calls it.
  return blocks.sort((a, b) => sql.indexOf(a) - sql.indexOf(b));
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const IDS = {
  program: "10000000-0000-4000-8000-000000000001",
  season: "20000000-0000-4000-8000-000000000012",
  otherSeason: "20000000-0000-4000-8000-000000000013",
  batch: "30000000-0000-4000-8000-000000000001",
  coreTeam: "40000000-0000-4000-8000-0000000000c1",
  reviewerA: "40000000-0000-4000-8000-0000000000a1",
  reviewerB: "40000000-0000-4000-8000-0000000000b1"
};

async function seed(client) {
  await client.query("truncate application_decisions, recruitment_assignment_events, application_reviews, applications restart identity cascade");
  await client.query("delete from recruitment_stage_requirements");
  await client.query("delete from seasons cascade");
  await client.query("delete from programs cascade");
  await client.query("delete from admin_users");

  await client.query("insert into programs (id, code) values ($1,'UEHM')", [IDS.program]);
  await client.query("insert into seasons (id, program_id, code) values ($1,$2,'UEHM-S12'), ($3,$2,'UEHM-S13')", [
    IDS.season,
    IDS.program,
    IDS.otherSeason
  ]);
  await client.query("insert into intake_batches (id, season_id, code) values ($1,$2,'B1')", [IDS.batch, IDS.season]);
  await client.query(
    "insert into admin_users (id, email, full_name, role, status) values ($1,'ops@test','Ops','core_team','active'), ($2,'a@test','A','reviewer','active'), ($3,'b@test','B','reviewer','active')",
    [IDS.coreTeam, IDS.reviewerA, IDS.reviewerB]
  );
  await client.query(
    "insert into recruitment_stage_requirements (season_id, review_stage, minimum_submitted_reviews) values ($1,'profile_screening',1), ($1,'interview',1)",
    [IDS.season]
  );
}

async function newApplication(client, status, role = "mentor") {
  const { rows } = await client.query(
    "insert into applications (season_id, intake_batch_id, role_applied, status) values ($1,$2,$3,$4) returning id",
    [IDS.season, IDS.batch, role, status]
  );
  return rows[0].id;
}

async function addReview(client, applicationId, { status, reviewer, round = "profile_screening", submittedAt = null }) {
  const { rows } = await client.query(
    `insert into application_reviews
       (application_id, reviewer_admin_user_id, review_round, status, submitted_at, recommendation)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [applicationId, reviewer, round, status, submittedAt, status === "submitted" ? "pass_to_interview" : null]
  );
  return rows[0].id;
}

async function decide(client, applicationId, newStatus, expected, actor = IDS.coreTeam) {
  const { rows } = await client.query(
    "select * from vam084_apply_application_decisions($1::uuid[], $2, $3, $4, $5::jsonb)",
    [[applicationId], newStatus, actor, "harness", JSON.stringify({ [applicationId]: expected })]
  );
  return rows[0];
}

async function statusOf(client, applicationId) {
  const { rows } = await client.query("select status from applications where id = $1", [applicationId]);
  return rows[0].status;
}

async function runCases(Client, connection) {
  const client = new Client(connection);
  await client.connect();
  await seed(client);

  console.log("\nDirect interview invite — the review gate:");

  await check("1. zero submitted profile reviews -> blocked", async () => {
    const app = await newApplication(client, "screening_completed");
    const row = await decide(client, app, "invited_to_interview", "screening_completed");
    expectEqual([row.applied, row.reason], [false, "profile_review_minimum_not_met"], "outcome");
    expectEqual(await statusOf(client, app), "screening_completed", "status unchanged");
  });

  await check("2. assigned-only review -> blocked", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "assigned", reviewer: IDS.reviewerA });
    const row = await decide(client, app, "invited_to_interview", "screening_completed");
    expectEqual([row.applied, row.reason], [false, "profile_review_minimum_not_met"], "outcome");
  });

  await check("3. in_progress review -> blocked", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "in_progress", reviewer: IDS.reviewerA });
    const row = await decide(client, app, "invited_to_interview", "screening_completed");
    expectEqual([row.applied, row.reason], [false, "profile_review_minimum_not_met"], "outcome");
  });

  await check("4. cancelled review -> blocked", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "cancelled", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    const row = await decide(client, app, "invited_to_interview", "screening_completed");
    expectEqual([row.applied, row.reason], [false, "profile_review_minimum_not_met"], "outcome");
  });

  await check("5. minimum met -> direct invite succeeds", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    const row = await decide(client, app, "invited_to_interview", "screening_completed");
    expectEqual([row.applied, row.reason], [true, "applied"], "outcome");
    expectEqual(await statusOf(client, app), "invited_to_interview", "final status");
  });

  await check("6. needs_admin_review -> direct invite succeeds", async () => {
    const app = await newApplication(client, "needs_admin_review");
    await addReview(client, app, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    const row = await decide(client, app, "invited_to_interview", "needs_admin_review");
    expectEqual([row.applied, row.reason], [true, "applied"], "outcome");
    expectEqual(await statusOf(client, app), "invited_to_interview", "final status");
  });

  await check("7. profile needs_more_review without a newer review -> blocked", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    await decide(client, app, "needs_more_review", "screening_completed");
    const row = await decide(client, app, "invited_to_interview", "needs_more_review");
    expectEqual([row.applied, row.reason], [false, "additional_review_not_submitted"], "outcome");
    expectEqual(await statusOf(client, app), "needs_more_review", "status unchanged");
  });

  await check("8. profile needs_more_review with a newer submitted review -> succeeds", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    await decide(client, app, "needs_more_review", "screening_completed");
    await addReview(client, app, {
      status: "submitted",
      reviewer: IDS.reviewerB,
      submittedAt: new Date(Date.now() + 60_000).toISOString()
    });
    const row = await decide(client, app, "invited_to_interview", "needs_more_review");
    expectEqual([row.applied, row.reason], [true, "applied"], "outcome");
    expectEqual(await statusOf(client, app), "invited_to_interview", "final status");
  });

  await check("9. interview-stage needs_more_review -> screening invite refused", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    await addReview(client, app, {
      status: "submitted",
      reviewer: IDS.reviewerB,
      round: "interview",
      submittedAt: "2026-09-02T00:00:00Z"
    });
    await client.query("update applications set status = 'needs_more_review' where id = $1", [app]);
    await client.query(
      "insert into application_decisions (application_id, decided_by, decision, previous_status, new_status) values ($1,$2,'needs_more_review','interview_completed','needs_more_review')",
      [app, IDS.coreTeam]
    );
    const row = await decide(client, app, "invited_to_interview", "needs_more_review");
    expectEqual([row.applied, row.reason], [false, "additional_review_not_submitted"], "outcome");
  });

  await check("10. stale expected status -> blocked", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    const row = await decide(client, app, "invited_to_interview", "ready_for_screening");
    expectEqual([row.applied, row.reason], [false, "stale_status"], "outcome");
    expectEqual(await statusOf(client, app), "screening_completed", "status unchanged");
  });

  await check("11. actor without season scope -> blocked", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    await client.query("select set_config('vam.denied_season', $1, false)", [IDS.season]);
    const row = await decide(client, app, "invited_to_interview", "screening_completed");
    await client.query("select set_config('vam.denied_season', '', false)");
    expectEqual([row.applied, row.reason], [false, "scope_denied"], "outcome");
    expectEqual(await statusOf(client, app), "screening_completed", "status unchanged");
  });

  await check("12. one command -> exactly one decision row, truthful statuses", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    await decide(client, app, "invited_to_interview", "screening_completed");
    const { rows } = await client.query(
      "select previous_status, new_status from application_decisions where application_id = $1",
      [app]
    );
    expectEqual(rows.length, 1, "decision row count");
    expectEqual(
      [rows[0].previous_status, rows[0].new_status],
      ["screening_completed", "invited_to_interview"],
      "decision statuses"
    );
  });

  await check("13. mixed bulk -> correct per-row applied/blocked", async () => {
    const ok = await newApplication(client, "screening_completed");
    await addReview(client, ok, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    const stale = await newApplication(client, "screening_completed");
    await addReview(client, stale, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    const noReview = await newApplication(client, "screening_completed");

    const { rows } = await client.query(
      "select application_id, applied, reason from vam084_apply_application_decisions($1::uuid[], $2, $3, $4, $5::jsonb) order by application_id",
      [
        [ok, stale, noReview],
        "invited_to_interview",
        IDS.coreTeam,
        "harness bulk",
        JSON.stringify({
          [ok]: "screening_completed",
          [stale]: "ready_for_screening",
          [noReview]: "screening_completed"
        })
      ]
    );
    const byId = new Map(rows.map((r) => [r.application_id, r]));
    expectEqual(byId.get(ok).applied, true, "eligible row applied");
    expectEqual(byId.get(stale).reason, "stale_status", "stale row reason");
    expectEqual(byId.get(noReview).reason, "profile_review_minimum_not_met", "no-review row reason");
    expectEqual(await statusOf(client, stale), "screening_completed", "stale row unchanged");
    expectEqual(await statusOf(client, noReview), "screening_completed", "no-review row unchanged");
  });

  await check("14/15. invite creates no interview assignment and no schedule", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "submitted", reviewer: IDS.reviewerA, submittedAt: "2026-09-01T00:00:00Z" });
    await decide(client, app, "invited_to_interview", "screening_completed");
    const reviews = await client.query(
      "select count(*)::int as n from application_reviews where application_id = $1 and review_round = 'interview'",
      [app]
    );
    expectEqual(reviews.rows[0].n, 0, "interview reviews created");
    const batches = await client.query("select count(*)::int as n from review_assignment_batches");
    expectEqual(batches.rows[0].n, 0, "assignment batches created");
    expectEqual(await statusOf(client, app), "invited_to_interview", "no scheduling transition");
  });

  await check("16. legacy invited record with zero reviews keeps its interview workflow", async () => {
    const app = await newApplication(client, "invited_to_interview");
    // No profile reviews at all — one of the 31 grandfathered records.
    const gate = await client.query(
      "select * from vam084_application_decision_eligibility($1, 'interview_scheduled')",
      [app]
    );
    expectEqual([gate.rows[0].eligible, gate.rows[0].reason], [true, "eligible"], "interview_scheduled gate");
    const row = await decide(client, app, "interview_scheduled", "invited_to_interview");
    expectEqual(row.applied, true, "scheduled");
    expectEqual(await statusOf(client, app), "interview_scheduled", "final status");
  });

  console.log("\nWithdrawn quarantine, after the direct-invite migration:");

  await check("17. corrective cancel on a withdrawn parent succeeds and keeps it withdrawn", async () => {
    const app = await newApplication(client, "screening_assigned");
    const review = await addReview(client, app, { status: "assigned", reviewer: IDS.reviewerA });
    await client.query("update applications set status = 'withdrawn' where id = $1", [app]);

    await client.query("select vam084_change_review_assignment($1, $2, $3, null)", [
      review,
      IDS.coreTeam,
      "harness corrective cancel"
    ]);

    const after = await client.query("select status from application_reviews where id = $1", [review]);
    expectEqual(after.rows[0].status, "cancelled", "review cancelled");
    expectEqual(await statusOf(client, app), "withdrawn", "parent still withdrawn");
    const events = await client.query(
      "select event_type from recruitment_assignment_events where application_id = $1",
      [app]
    );
    expectEqual(events.rows.map((r) => r.event_type), ["cancelled"], "assignment event persisted");
  });

  await check("18a. withdrawal cancels active reviews and preserves submitted ones", async () => {
    const app = await newApplication(client, "screening_completed");
    const open = await addReview(client, app, { status: "in_progress", reviewer: IDS.reviewerB });
    const done = await addReview(client, app, {
      status: "submitted",
      reviewer: IDS.reviewerA,
      submittedAt: "2026-09-01T00:00:00Z"
    });
    const row = await decide(client, app, "withdrawn", "screening_completed");
    expectEqual(row.applied, true, "withdrawal applied");

    const openAfter = await client.query("select status from application_reviews where id = $1", [open]);
    const doneAfter = await client.query(
      "select status, submitted_at from application_reviews where id = $1",
      [done]
    );
    expectEqual(openAfter.rows[0].status, "cancelled", "active review cancelled");
    expectEqual(doneAfter.rows[0].status, "submitted", "submitted review preserved");
    if (!doneAfter.rows[0].submitted_at) throw new Error("submitted_at was cleared");
  });

  await check("18b. withdrawal is one transaction: reviews, status and audit together", async () => {
    const app = await newApplication(client, "screening_completed");
    await addReview(client, app, { status: "assigned", reviewer: IDS.reviewerA });
    await decide(client, app, "withdrawn", "screening_completed");
    const events = await client.query(
      "select count(*)::int as n from recruitment_assignment_events where application_id = $1",
      [app]
    );
    const decisions = await client.query(
      "select count(*)::int as n from application_decisions where application_id = $1 and new_status = 'withdrawn'",
      [app]
    );
    expectEqual(events.rows[0].n, 1, "cancellation event");
    expectEqual(decisions.rows[0].n, 1, "decision audit row");
  });

  await check("19. stale submit on a withdrawn parent is refused", async () => {
    const app = await newApplication(client, "screening_assigned");
    const review = await addReview(client, app, { status: "in_progress", reviewer: IDS.reviewerA });
    await client.query("update applications set status = 'withdrawn' where id = $1", [app]);
    let refused = false;
    try {
      await client.query(
        "select vam084_submit_application_review($1,$2,4,4,4,4,4,'pass_to_interview','note')",
        [review, IDS.reviewerA]
      );
    } catch (error) {
      refused = /APPLICATION_WITHDRAWN/.test(error.message);
    }
    if (!refused) throw new Error("submit was not refused on a withdrawn application");
    const after = await client.query("select status from application_reviews where id = $1", [review]);
    expectEqual(after.rows[0].status, "in_progress", "review unchanged");
  });

  await client.end();

  // -------------------------------------------------------------------------
  // Real concurrency: two connections, two transactions, one row lock.
  // -------------------------------------------------------------------------
  console.log("\nReal concurrency (two live transactions):");

  await check("20. assign vs withdraw: withdraw-first makes the assign refuse", async () => {
    const setup = new Client(connection);
    await setup.connect();
    const app = await newApplication(setup, "screening_assigned");
    await setup.end();

    const a = new Client(connection);
    const b = new Client(connection);
    await a.connect();
    await b.connect();
    try {
      await a.query("begin");
      // A withdraws, holding the application row lock.
      await a.query("select * from vam084_apply_application_decisions($1::uuid[], 'withdrawn', $2, 'race', $3::jsonb)", [
        [app],
        IDS.coreTeam,
        JSON.stringify({ [app]: "screening_assigned" })
      ]);

      // B tries to assign. It must block on the row lock, then refuse.
      await b.query("begin");
      const assign = b.query("select vam095_assign_application_review($1,$2,'profile_screening',null,$3)", [
        app,
        IDS.reviewerA,
        IDS.coreTeam
      ]);

      // Give B a moment to actually reach the lock before A commits.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await a.query("commit");

      let refused = false;
      try {
        await assign;
      } catch (error) {
        refused = /APPLICATION_WITHDRAWN/.test(error.message);
      }
      await b.query("rollback").catch(() => {});
      if (!refused) throw new Error("the assignment was not refused after a concurrent withdrawal");

      const verify = new Client(connection);
      await verify.connect();
      const reviews = await verify.query(
        "select count(*)::int as n from application_reviews where application_id = $1 and status <> 'cancelled'",
        [app]
      );
      expectEqual(reviews.rows[0].n, 0, "no live review survived the race");
      await verify.end();
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });

  await check("21. submit vs withdraw: submit-first is preserved by the withdrawal", async () => {
    const setup = new Client(connection);
    await setup.connect();
    const app = await newApplication(setup, "screening_assigned");
    const review = await addReview(setup, app, { status: "in_progress", reviewer: IDS.reviewerA });
    await setup.end();

    const a = new Client(connection);
    const b = new Client(connection);
    await a.connect();
    await b.connect();
    try {
      await a.query("begin");
      await a.query(
        "select vam084_submit_application_review($1,$2,4,4,4,4,4,'pass_to_interview','race note')",
        [review, IDS.reviewerA]
      );

      await b.query("begin");
      const withdraw = b.query(
        "select * from vam084_apply_application_decisions($1::uuid[], 'withdrawn', $2, 'race', $3::jsonb)",
        [[app], IDS.coreTeam, JSON.stringify({ [app]: "screening_completed" })]
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      await a.query("commit");
      await withdraw;
      await b.query("commit");

      const verify = new Client(connection);
      await verify.connect();
      const after = await verify.query("select status, submitted_at from application_reviews where id = $1", [review]);
      expectEqual(after.rows[0].status, "submitted", "submitted review survived the withdrawal");
      if (!after.rows[0].submitted_at) throw new Error("submitted_at was cleared by the race");
      expectEqual(await statusOf(verify, app), "withdrawn", "application withdrawn");
      await verify.end();
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });
}

main().catch((error) => {
  console.error(error);
  console.log("PG_HARNESS=FAIL");
  process.exit(1);
});

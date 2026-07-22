import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.substring(0, index).trim();
    let val = line.substring(index + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}

loadLocalEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

try {
  const parsedUrl = new URL(SUPABASE_URL);
  console.log(`🔌 Target Supabase Host: ${parsedUrl.hostname}`);
} catch (e) {
  console.error("❌ ERROR: Invalid SUPABASE_URL format.");
  process.exit(1);
}

const args = process.argv.slice(2);
const isPrintPlan = args.includes("--print-plan");
const confirmSeed = args.includes("--confirm-demo-seed");
const confirmCleanup = args.includes("--cleanup-demo-s12");
const isDryRun = args.length === 0 || args.includes("--dry-run") || (!confirmSeed && !confirmCleanup);
const confirmStagingAuthorization = args.includes("--confirm-staging-authorization");
const STAGING_PROJECT_REF = "ljfneyuvpxrmejpxsmpz";
const PRODUCTION_PROJECT_REF = "qkkroesfiazsejkzflcd";

// Find --target-project-ref <ref>
const targetRefIndex = args.indexOf("--target-project-ref");
const targetProjectRef = targetRefIndex > -1 ? args[targetRefIndex + 1] : null;

if (confirmSeed && confirmCleanup) {
  console.error("❌ ERROR: Cannot run both --confirm-demo-seed and --cleanup-demo-s12 simultaneously.");
  process.exit(1);
}

if (!isDryRun && !isPrintPlan) {
  if (!targetProjectRef) {
    console.error("❌ ERROR: Write modes require --target-project-ref <expected-ref> for safety.");
    process.exit(1);
  }
  const hostRef = parsedUrl.hostname.split(".")[0];
  if (hostRef === PRODUCTION_PROJECT_REF) {
    console.error("❌ ERROR: Production project is permanently forbidden for this demo seed.");
    process.exit(1);
  }
  if (hostRef !== STAGING_PROJECT_REF || targetProjectRef !== STAGING_PROJECT_REF) {
    console.error("❌ ERROR: Demo seed write modes are restricted to the confirmed staging project ref.");
    process.exit(1);
  }
  if (targetProjectRef !== hostRef) {
    console.error(`❌ ERROR: --target-project-ref '${targetProjectRef}' does not match target host '${hostRef}'.`);
    process.exit(1);
  }
  if (!confirmStagingAuthorization) {
    console.error("❌ ERROR: Write mode requires --confirm-staging-authorization after separate owner authorization.");
    process.exit(1);
  }
}

if (args.includes("--help")) {
  console.log(`
Usage: node scripts/seed_demo_s12_data.mjs [options]

Options:
  --help               Show this help message
  --dry-run            (Default) Run in dry-run mode, printing what would happen without writing
  --print-plan         Print the planned dataset before executing
  --target-project-ref <ref>  Required for any write mode. Must match the Supabase URL's project ref.
  --confirm-staging-authorization  Required for write mode after separate owner authorization
  --confirm-demo-seed  Execute the seeding (includes cleanup first)
  --cleanup-demo-s12   Execute ONLY the cleanup of DEMO-S12 data
`);
  process.exit(0);
}

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- DEMO DATA DEFINITIONS ---

const SEASON_CODE = "DEMO-S12";
const BATCH_CODE = "DEMO-S12-B1";

const seasonData = {
  code: SEASON_CODE,
  name: "Demo Season 12",
  status: "active",
};

const batchData = {
  code: BATCH_CODE,
  name: "Batch 1 (Demo)",
  is_active: true,
};

const generateMentors = () => Array.from({ length: 5 }, (_, i) => ({
  person: { full_name: `Demo Mentor ${String.fromCharCode(65 + i)}`, email_primary: `demo.mentor.${i + 1}@example.com`, phone_primary: `090000010${i}` },
  profile: { mentor_code: `DM-M-${i + 1}`, industry: "Technology", function_area: "Engineering", years_experience_min: 5, status: "active" },
}));

const generateMentees = () => Array.from({ length: 10 }, (_, i) => ({
  person: { full_name: `Demo Mentee ${String.fromCharCode(65 + i)}`, email_primary: `demo.mentee.${i + 1}@example.com`, phone_primary: `090000020${i}` },
  profile: { mentee_code: `DM-E-${i + 1}`, school_raw: "Demo University", major: "Computer Science", mssv: `3120100${i}`, status: "active" },
}));

const mentors = generateMentors();
const mentees = generateMentees();

const eventData = {
  event_name: "Season 12 Demo Kickoff Orientation",
  event_type: "orientation",
  status: "active",
  capacity_limit_enabled: true,
  capacity_limit: 8,
  registration_required: true,
  allow_walk_in: true,
  checkin_mode: "registration_required",
  fee_required: true,
  fee_amount: 150000,
  fee_currency: "VND",
  payment_instruction: "Momo 090xxxxxxx",
  payment_proof_required: true
};

function printPlan() {
  console.log("=== DEMO-S12 SEED PLAN ===");
  console.log(`- Season: ${SEASON_CODE}`);
  console.log(`- Intake Batch: ${BATCH_CODE}`);
  console.log(`- Mentors: ${mentors.length} (demo.mentor.*@example.com)`);
  console.log(`- Mentees: ${mentees.length} (demo.mentee.*@example.com)`);
  console.log(`- Applications: 3 Mentor, 6 Mentee`);
  console.log(`- Matches: 2 pairs`);
  console.log(`- Events: 1 ("${eventData.event_name}")`);
  console.log(`- Registrations: 5 confirmed, 2 waitlisted, 1 payment pending`);
  console.log(`- Check-ins: 3 attendees`);
  console.log("==========================\n");
}

if (isPrintPlan || isDryRun) {
  printPlan();
  if (isDryRun) {
    console.log("ℹ️ Dry-run mode. Use --confirm-demo-seed to execute writes.");
    process.exit(0);
  }
}

async function cleanup() {
  console.log(`🗑️  Cleaning up existing ${SEASON_CODE} data...`);

  if (isDryRun) {
    console.log("[DRY-RUN] Would delete event_registrations, events, matches, applications, mentor_profiles, mentee_profiles, people, intake_batches, seasons where season_id relates to DEMO-S12.");
    return;
  }

  // 1. Get Season ID
  const { data: season } = await client.from("seasons").select("id").eq("code", SEASON_CODE).single();
  if (!season) {
    console.log("  No existing season found to clean up.");
    return;
  }

  // Find people linked to this season's applications or created with demo domain
  const { data: people } = await client.from("people").select("id").eq("source_sheets", "DEMO_SEED");
  const personIds = people?.map(p => p.id) || [];

  // Delete cascade order
  const { data: events } = await client.from("events").select("id").eq("season_id", season.id);
  if (events?.length) {
    const eventIds = events.map(e => e.id);
    await client.from("event_participations").delete().in("event_id", eventIds);
    await client.from("event_registrations").delete().in("event_id", eventIds);
    await client.from("events").delete().in("id", eventIds);
  }

  await client.from("matches").delete().eq("season_id", season.id);
  await client.from("applications").delete().eq("season_id", season.id);

  if (personIds.length) {
    await client.from("mentor_profiles").delete().in("person_id", personIds);
    await client.from("mentee_profiles").delete().in("person_id", personIds);
    await client.from("people").delete().in("id", personIds);
  }

  await client.from("intake_batches").delete().eq("season_id", season.id);
  await client.from("seasons").delete().eq("id", season.id);

  console.log("  Cleanup complete.");
}

async function seed() {
  console.log(`🌱 Seeding ${SEASON_CODE} data...`);

  let seasonId, batchId;

  // 1. Season
  const { data: s, error: sErr } = await client.from("seasons").insert(seasonData).select("id").single();
  if (sErr) throw sErr;
  seasonId = s.id;

  // 2. Batch
  const { data: b, error: bErr } = await client.from("intake_batches").insert({ ...batchData, season_id: seasonId }).select("id").single();
  if (bErr) throw bErr;
  batchId = b.id;

  // 3. People & Profiles
  const mentorIds = [];
  for (const m of mentors) {
    const { data: p } = await client.from("people").insert({ ...m.person, source_sheets: "DEMO_SEED" }).select("id").single();
    const { data: prof } = await intakeProfile(p.id, m.profile, "mentor");
    mentorIds.push({ personId: p.id, profileId: prof.id });
  }

  const menteeIds = [];
  for (const m of mentees) {
    const { data: p } = await client.from("people").insert({ ...m.person, source_sheets: "DEMO_SEED" }).select("id").single();
    const { data: prof } = await intakeProfile(p.id, m.profile, "mentee");
    menteeIds.push({ personId: p.id, profileId: prof.id });
  }

  // Helper inserts
  async function intakeProfile(personId, profileData, role) {
    const table = role === "mentor" ? "mentor_profiles" : "mentee_profiles";
    return await client.from(table).insert({ ...profileData, person_id: personId, intake_batch_id: batchId }).select("id").single();
  }

  // 4. Applications
  await createApp(mentorIds[0].personId, "mentor", "submitted");
  await createApp(mentorIds[1].personId, "mentor", "under_review");
  await createApp(mentorIds[2].personId, "mentor", "approved");

  await createApp(menteeIds[0].personId, "mentee", "submitted");
  await createApp(menteeIds[1].personId, "mentee", "submitted");
  await createApp(menteeIds[2].personId, "mentee", "approved");
  await createApp(menteeIds[3].personId, "mentee", "approved");
  await createApp(menteeIds[4].personId, "mentee", "approved");
  await createApp(menteeIds[5].personId, "mentee", "rejected");

  async function createApp(personId, role, status) {
    await client.from("applications").insert({
      person_id: personId, season_id: seasonId, intake_batch_id: batchId, role_applied: role, status, source: "DEMO"
    });
  }

  // 5. Matches (2 active pairs)
  await client.from("matches").insert([
    { season_id: seasonId, mentor_person_id: mentorIds[2].personId, mentee_person_id: menteeIds[2].personId, status: "active", match_type: "1:1", match_source: "DEMO" },
    { season_id: seasonId, mentor_person_id: mentorIds[3].personId, mentee_person_id: menteeIds[3].personId, status: "active", match_type: "1:1", match_source: "DEMO" }
  ]);

  // 6. Events
  const { data: evt } = await client.from("events").insert({ ...eventData, season_id: seasonId, intake_batch_id: batchId }).select("id").single();

  // 7. Event Registrations (5 confirmed, 2 waitlisted, 1 payment pending)
  const regs = [
    { person: menteeIds[0], status: "confirmed", pay: "confirmed", attendance: "checked_in" },
    { person: menteeIds[1], status: "confirmed", pay: "confirmed", attendance: "checked_in" },
    { person: menteeIds[2], status: "confirmed", pay: "confirmed", attendance: "checked_in" },
    { person: menteeIds[3], status: "confirmed", pay: "confirmed", attendance: "pending" },
    { person: mentorIds[0], status: "confirmed", pay: "confirmed", attendance: "pending" },
    { person: menteeIds[4], status: "waitlisted", pay: "pending", attendance: "pending" },
    { person: menteeIds[5], status: "waitlisted", pay: "pending", attendance: "pending" },
    { person: mentorIds[1], status: "pending_review", pay: "submitted", attendance: "pending" }
  ];

  for (const r of regs) {
    const personResponse = await client.from("people").select("*").eq("id", r.person.personId).single();
    const pData = personResponse.data;

    await client.from("event_registrations").insert({
      event_id: evt.id, linked_person_id: pData.id, full_name: pData.full_name, email: pData.email_primary, phone: pData.phone_primary,
      registration_status: r.status, payment_status: r.pay, attendance_status: r.attendance, registration_source: "DEMO",
      checked_in_at: r.attendance === "checked_in" ? new Date().toISOString() : null,
      payment_confirmed_at: r.pay === "confirmed" ? new Date().toISOString() : null
    });
  }

  console.log("  Seed complete.");
  console.log("\n=== FINAL SUMMARY ===");
  console.log(`- Inserted Season: 1`);
  console.log(`- Inserted Batches: 1`);
  console.log(`- Inserted People: 15`);
  console.log(`- Inserted Applications: 9`);
  console.log(`- Inserted Matches: 2`);
  console.log(`- Inserted Events: 1`);
  console.log(`- Inserted Registrations: 8`);
  console.log("=====================\n");
}

async function run() {
  try {
    if (confirmCleanup || confirmSeed) {
      await cleanup();
    }
    if (confirmSeed) {
      await seed();
    }
    process.exit(0);
  } catch (err) {
    console.error("❌ ERROR during execution:");
    console.error(err);
    process.exit(1);
  }
}

run();

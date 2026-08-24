import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { generateS12MenteePayload } from "./benchmark-lib.mjs";

// Mock next/headers just in case it is imported, avoiding runtime errors
import "node:module";
import { Module } from "node:module";
const originalRequire = Module.prototype.require;
Module.prototype.require = function(path) {
  if (path === "next/headers") return { cookies: () => ({ get: () => undefined }) };
  return originalRequire.apply(this, arguments);
};

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

const PRODUCTION_PROJECT_REF = "qkkroesfiazsejkzflcd";
if (SUPABASE_URL.includes(PRODUCTION_PROJECT_REF)) {
  console.error("❌ ERROR: Production project is permanently forbidden for this benchmark seed.");
  process.exit(1);
}

const args = process.argv.slice(2);
const isPrintPlan = args.includes("--print-plan");
const confirmSeed = args.includes("--confirm");
const isDryRun = !confirmSeed;
const isMeasureOnly = args.includes("--measure-only");

const SEASON_CODE = "BENCH-S12";

if (isDryRun && !isMeasureOnly) {
  console.log("=== BENCH-S12 SEED PLAN ===");
  console.log(`- Season: ${SEASON_CODE}`);
  console.log(`- Mentees: 1500`);
  console.log(`- Mentors: 200`);
  console.log("==========================\n");
  console.log("ℹ️ Dry-run mode. Use --confirm to execute writes, or --measure-only to run the benchmark.");
  process.exit(0);
}

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function cleanup() {
  console.log(`🗑️  Cleaning up existing ${SEASON_CODE} data...`);
  const { data: season } = await client.from("seasons").select("id").eq("code", SEASON_CODE).single();
  if (!season) {
    console.log("  No existing season found to clean up.");
    return;
  }
  
  const { data: apps } = await client.from("applications").select("id").eq("season_id", season.id);
  if (apps?.length) {
      await client.from("applications").delete().eq("season_id", season.id);
  }
  await client.from("seasons").delete().eq("id", season.id);
  console.log("  Cleanup complete.");
}

async function seed() {
  console.log(`🌱 Seeding ${SEASON_CODE} data...`);
  
  const { data: s, error: sErr } = await client.from("seasons").insert({
    code: SEASON_CODE,
    name: "Benchmark Season 12",
    status: "active"
  }).select("id").single();
  
  if (sErr) throw sErr;
  const seasonId = s.id;

  const menteeApps = [];
  for (let i = 0; i < 1500; i++) {
    menteeApps.push({
      season_id: seasonId,
      role_applied: "mentee",
      status: "submitted",
      source: "BENCHMARK",
      raw_payload: generateS12MenteePayload(i)
    });
  }
  
  const mentorApps = [];
  for (let i = 0; i < 200; i++) {
    mentorApps.push({
      season_id: seasonId,
      role_applied: "mentor",
      status: "submitted",
      source: "BENCHMARK",
      raw_payload: { name: `Mentor_${i}`, email_primary: `mentor_${i}@example.com` }
    });
  }
  
  async function insertChunks(table, records, chunkSize=500) {
      for (let i=0; i<records.length; i+=chunkSize) {
          const chunk = records.slice(i, i+chunkSize);
          const {error} = await client.from(table).insert(chunk);
          if (error) throw error;
      }
  }
  
  await insertChunks("applications", menteeApps);
  await insertChunks("applications", mentorApps);
  console.log("  Seed complete.");
  return seasonId;
}

// ---- INTERCEPTION UTILS ----
let fetchStats = { queryCount: 0, rowsFetched: { applications: 0, people: 0, seasons: 0, intake_batches: 0, mentee_profiles: 0, mentor_profiles: 0, matches: 0 }, totalBytes: 0 };
const originalFetch = global.fetch;

function resetStats() {
    fetchStats = { queryCount: 0, rowsFetched: { applications: 0, people: 0, seasons: 0, intake_batches: 0, mentee_profiles: 0, mentor_profiles: 0, matches: 0 }, totalBytes: 0 };
}

global.fetch = async (...args) => {
    const url = args[0].toString();
    if (url.includes("rest/v1/")) {
        fetchStats.queryCount++;
    }
    const res = await originalFetch(...args);
    
    // We must clone the response to read it without consuming the stream for the client
    const clone = res.clone();
    
    if (url.includes("rest/v1/")) {
        try {
            const text = await clone.text();
            fetchStats.totalBytes += Buffer.byteLength(text, 'utf8');
            const data = JSON.parse(text);
            
            const urlObj = new URL(url);
            const tablePath = urlObj.pathname.split("rest/v1/")[1];
            const table = tablePath ? tablePath.split("?")[0] : "unknown";
            
            let rows = 0;
            if (Array.isArray(data)) {
                rows = data.length;
            } else if (data && typeof data === 'object') {
                rows = 1;
            }
            if (fetchStats.rowsFetched[table] !== undefined) {
                fetchStats.rowsFetched[table] += rows;
            } else {
                fetchStats.rowsFetched[table] = rows;
            }
        } catch (e) {
            // ignore
        }
    }
    
    return res;
};

// --- RUN BENCHMARK ---
async function measure(seasonId) {
    console.log(`⏱️ Measuring data layer performance...`);
    
    // Dynamically import lib/data.ts
    // In tsx, this works natively.
    const dataLib = await import("../lib/data.js");
    
    // We mock the scope filter to only include BENCH-S12
    const scope = { allowedSeasonIds: [seasonId], activeBatchIds: [], allowedProgramIds: [], error: null, hasSuperAdminScope: false, limitToScope: true };
    
    let listP50 = 0, detailP50 = 0;
    const listRuns = [];
    const detailRuns = [];
    let listStats = null;
    let detailStats = null;
    
    let firstAppId = null;

    // 1. Benchmark List Data Fetch (ApplicationsPage)
    for(let i=0; i<10; i++) {
        resetStats();
        const start = performance.now();
        
        const [applications, people, seasons, intakeBatchesRes] = await Promise.all([
            dataLib.getApplications(scope),
            dataLib.getPeople(scope),
            dataLib.getSeasons(scope),
            dataLib.getIntakeBatches(scope)
        ]);
        
        const end = performance.now();
        listRuns.push(end - start);
        if (i===0) listStats = { ...fetchStats, rowsFetched: { ...fetchStats.rowsFetched } };
        
        if (applications.data && applications.data.length > 0) {
            firstAppId = applications.data[0].id;
        }
    }
    
    listRuns.sort((a,b) => a-b);
    listP50 = listRuns[Math.floor(listRuns.length / 2)];
    
    // 2. Benchmark Detail Data Fetch (ApplicationDetailPage)
    if (!firstAppId) throw new Error("No application found for detail benchmark");

    for(let i=0; i<10; i++) {
        resetStats();
        const start = performance.now();
        
        // Exact same loaders as app/applications/[id]/page.tsx
        const [application, people, seasons, mentees, mentors, matches, answers, reviewsResult, reviewersResult, decisionsResult] =
            await Promise.all([
              dataLib.getApplication(firstAppId, scope),
              dataLib.getPeople(scope),
              dataLib.getSeasons(scope),
              dataLib.getMenteeProfiles(scope),
              dataLib.getMentorProfiles(scope),
              dataLib.getMatches(scope),
              dataLib.getAnswersForApplication(firstAppId),
              dataLib.getApplicationReviewsForApplication(firstAppId, scope),
              dataLib.getActiveAdminUsers(),
              dataLib.getApplicationDecisions(firstAppId, scope)
            ]);
            
        const end = performance.now();
        detailRuns.push(end - start);
        if (i===0) detailStats = { ...fetchStats, rowsFetched: { ...fetchStats.rowsFetched } };
    }
    
    detailRuns.sort((a,b) => a-b);
    detailP50 = detailRuns[Math.floor(detailRuns.length / 2)];

    const result = {
        timestamp: new Date().toISOString(),
        listPage: {
            p50_ms: listP50,
            queryCount: listStats.queryCount,
            rowsFetched: listStats.rowsFetched,
            payloadBytes: listStats.totalBytes
        },
        detailPage: {
            p50_ms: detailP50,
            queryCount: detailStats.queryCount,
            rowsFetched: detailStats.rowsFetched,
            payloadBytes: detailStats.totalBytes
        }
    };
    
    mkdirSync("docs/benchmarks", { recursive: true });
    writeFileSync(`docs/benchmarks/M3_BASELINE_${Date.now()}.json`, JSON.stringify(result, null, 2));
    console.log("Benchmark saved to docs/benchmarks/");
    console.log(result);
}

async function run() {
  try {
    let seasonId = null;
    if (confirmSeed) {
      await cleanup();
      seasonId = await seed();
    }
    if (isMeasureOnly) {
        if (!seasonId) {
            const { data: season } = await client.from("seasons").select("id").eq("code", SEASON_CODE).single();
            seasonId = season?.id;
        }
        if (!seasonId) throw new Error("No seeded season found. Run with --confirm first.");
        await measure(seasonId);
    }
    process.exit(0);
  } catch (err) {
    console.error("❌ ERROR during execution:");
    console.error(err);
    process.exit(1);
  }
}

run();

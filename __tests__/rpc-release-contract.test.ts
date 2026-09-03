/**
 * Release contract guard.
 *
 * Detects the exact failure that took Production down after e197e8c:
 * application code newly requires a database RPC that the declared Production
 * contract does not provide.
 *
 * Entirely static — it reads the repository, never the network, and needs no
 * Production credentials in ordinary CI.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DECLARED_RPCS,
  INDIRECT_RPC_CALL_SITES,
  KNOWN_MISSING_PREEXISTING_RPCS,
  PENDING_PRODUCTION_MIGRATION_RPCS,
  PRODUCTION_PROVIDED_RPCS,
  STAGING_VERIFIED_RPCS
} from "@/lib/production-rpc-contract";

const SOURCE_ROOTS = ["lib", "app", "components"];
const SOURCE_EXT = /\.(ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXT.test(entry)) {
      out.push(full.split("\\").join("/"));
    }
  }
  return out;
}

const SOURCE_FILES = SOURCE_ROOTS.flatMap((root) => walk(root))
  .concat(["middleware.ts"])
  .filter((f) => !f.includes("__tests__"));

/** `.rpc("name"` — tolerates whitespace and newlines between `(` and the literal. */
const DIRECT_CALL = /\.rpc\(\s*["']([a-z0-9_]+)["']/g;
/** `.rpc(identifier` — a name the scanner cannot read statically. */
const INDIRECT_CALL = /\.rpc\(\s*([A-Za-z_$][\w$]*)\s*[[(,]/g;

type Found = { rpc: string; file: string };

const directCalls: Found[] = [];
const indirectFiles = new Set<string>();

for (const file of SOURCE_FILES) {
  const src = readFileSync(file, "utf8");
  if (!src.includes(".rpc(")) continue;
  let m: RegExpExecArray | null;
  DIRECT_CALL.lastIndex = 0;
  while ((m = DIRECT_CALL.exec(src))) directCalls.push({ rpc: m[1], file });
  INDIRECT_CALL.lastIndex = 0;
  if (INDIRECT_CALL.exec(src)) indirectFiles.add(file);
}

const declaredIndirectFiles = new Set(INDIRECT_RPC_CALL_SITES.map((s) => s.file));
const requiredRpcs = new Set(
  directCalls.map((c) => c.rpc).concat(INDIRECT_RPC_CALL_SITES.flatMap((s) => s.rpcs))
);

describe("Production RPC release contract", () => {
  it("finds the application's RPC call sites at all (guard is not silently empty)", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    expect(directCalls.length).toBeGreaterThan(20);
    expect(requiredRpcs.size).toBeGreaterThan(20);
  });

  it("declares every RPC the application calls", () => {
    const declared = new Set(DECLARED_RPCS);
    const undeclared = Array.from(requiredRpcs).filter((rpc) => !declared.has(rpc)).sort();
    expect(
      undeclared,
      undeclared.length
        ? `Undeclared RPC(s): ${undeclared.join(", ")}.\n` +
          "Application code requires a database function the declared Production contract does not " +
          "provide. This is what broke Production after e197e8c. Either ship a migration that creates " +
          "it and add it to PENDING_PRODUCTION_MIGRATION_RPCS, or, if Production already has it, add " +
          "it to PRODUCTION_PROVIDED_RPCS with read-only catalog evidence."
        : ""
    ).toEqual([]);
  });

  it("keeps every RPC in exactly one bucket", () => {
    const counts = new Map<string, number>();
    for (const rpc of DECLARED_RPCS) counts.set(rpc, (counts.get(rpc) ?? 0) + 1);
    expect(Array.from(counts.entries()).filter(([, n]) => n > 1).map(([r]) => r)).toEqual([]);
  });

  it("backs every pending RPC with a real migration file, so the list cannot become a wish list", () => {
    const migrations = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join("supabase/migrations", f), "utf8"))
      .join("\n");
    const unbacked = PENDING_PRODUCTION_MIGRATION_RPCS.filter(
      (rpc) => !new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}\\b`, "i").test(migrations)
    );
    expect(unbacked, `Declared pending but no migration defines them: ${unbacked.join(", ")}`).toEqual([]);
  });

  it("covers the M084/M090 family that this incident introduced", () => {
    const family = Array.from(requiredRpcs).filter((rpc) => /^vam09[0-9]_|^vam084_/.test(rpc));
    expect(family.length).toBeGreaterThanOrEqual(11);
    // Accounted for as provided (once the corrective migration is applied) or
    // as pending (before it is). What must never happen is the family being
    // absent from the contract, or parked in the pre-existing-gap bucket.
    const accountedFor = new Set(
      PRODUCTION_PROVIDED_RPCS.concat(PENDING_PRODUCTION_MIGRATION_RPCS)
    );
    expect(family.filter((rpc) => !accountedFor.has(rpc))).toEqual([]);
  });

  it("requires every indirect .rpc() call site to enumerate its names", () => {
    const undeclaredSites = Array.from(indirectFiles).filter((f) => !declaredIndirectFiles.has(f)).sort();
    expect(
      undeclaredSites,
      undeclaredSites.length
        ? `Indirect .rpc() call site(s) not declared in INDIRECT_RPC_CALL_SITES: ${undeclaredSites.join(", ")}. ` +
          "The scanner cannot read a variable RPC name, so the names must be enumerated explicitly."
        : ""
    ).toEqual([]);
  });

  it("verifies each declared indirect name really appears in its file", () => {
    for (const site of INDIRECT_RPC_CALL_SITES) {
      const src = readFileSync(site.file, "utf8");
      for (const rpc of site.rpcs) {
        expect(src, `${site.file} should contain "${rpc}"`).toContain(`"${rpc}"`);
      }
    }
  });

  it("does not let a pre-existing-gap acknowledgement absorb a new dependency", () => {
    // Every acknowledged pre-existing gap must be reachable from code (otherwise
    // it is stale), and none may belong to the family this incident introduced.
    const stale = KNOWN_MISSING_PREEXISTING_RPCS.filter((rpc) => !requiredRpcs.has(rpc));
    expect(stale, `Acknowledged as missing but no longer called: ${stale.join(", ")}`).toEqual([]);
    expect(KNOWN_MISSING_PREEXISTING_RPCS.filter((rpc) => /^vam084_|^vam090_/.test(rpc))).toEqual([]);
  });

  it("keeps the provided list honest about what the incident proved absent", () => {
    const provided = new Set(PRODUCTION_PROVIDED_RPCS);
    for (const rpc of PENDING_PRODUCTION_MIGRATION_RPCS.concat(KNOWN_MISSING_PREEXISTING_RPCS)) {
      expect(provided.has(rpc), `${rpc} is known absent from Production but listed as provided`).toBe(false);
    }
  });
});

/**
 * M092 Bulk Official Approval ships in application code while Production does
 * not yet have its migration. That is the precise shape of the e197e8c
 * incident, so the classification is asserted explicitly rather than left to
 * the generic bucket rules above.
 */
describe("M092 is classified Production-pending, not Production-present", () => {
  const M092 = "vam092_bulk_official_approve_applications";
  const M093 = "vam093_returning_mentor_collision";

  it("is genuinely required by application code (not a stale declaration)", () => {
    expect(requiredRpcs.has(M092)).toBe(true);
    const callers = directCalls.filter((c) => c.rpc === M092).map((c) => c.file);
    expect(callers).toContain("lib/bulk-official-approval.ts");
  });

  it("is declared pending, and is NOT claimed as provided by Production", () => {
    expect(PENDING_PRODUCTION_MIGRATION_RPCS).toContain(M092);
    expect(
      PRODUCTION_PROVIDED_RPCS,
      "M092 has not been applied to Production (qkkroesfiazsejkzflcd); listing it as provided would repeat the e197e8c failure"
    ).not.toContain(M092);
  });

  it("is not laundered through the pre-existing-gap bucket", () => {
    // M092 is a NEW dependency introduced by this release, not pre-existing
    // breakage, so the acknowledgement bucket must not absorb it.
    expect(KNOWN_MISSING_PREEXISTING_RPCS).not.toContain(M092);
  });

  it("is backed by the migration that actually defines it", () => {
    const sql = readFileSync(
      "supabase/migrations/20260831120000_s12_m092_bulk_official_approval.sql",
      "utf8"
    );
    expect(sql.toLowerCase()).toContain(`create or replace function public.${M092}(`);
  });

  it("records Staging presence without ever implying Production presence", () => {
    expect(STAGING_VERIFIED_RPCS).toContain(M092);
    // The whole point: Staging-verified is not a Production claim.
    for (const rpc of STAGING_VERIFIED_RPCS) {
      expect(
        PRODUCTION_PROVIDED_RPCS,
        `${rpc} is Staging-verified only; it must not appear as Production-provided`
      ).not.toContain(rpc);
    }
  });

  it("treats M093 as a SQL/transitive dependency, not a direct application RPC", () => {
    // Application code never calls vam093 directly — it runs inside vam092 —
    // so it must not be declared as an application RPC dependency.
    expect(requiredRpcs.has(M093)).toBe(false);
    expect(DECLARED_RPCS).not.toContain(M093);
    // But it must still exist in version control, or Staging's real vam092
    // contract could not be reproduced on Production later.
    const sql = readFileSync(
      "supabase/migrations/20260901090000_s12_m093_pre_uat_hardening.sql",
      "utf8"
    );
    expect(sql.toLowerCase()).toContain(`create or replace function public.${M093}(`);
  });
});

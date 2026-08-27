import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE = "VAM_OS_M083_S12_M1_IDENTITY_PREVIEW_REMEDIATION_20260827";
const read = (name: string) => fs.readFileSync(path.join(PACKAGE, name), "utf8");

describe("S12-M1 M083 migration package", () => {
  it("contains the complete reviewable package and no retired bare M072", () => {
    expect(fs.readdirSync(PACKAGE).sort()).toEqual([
      "README.md",
      "SHA256SUMS.txt",
      "apply.sql",
      "preflight.sql",
      "rollback.sql",
      "verifier.sql"
    ]);
    expect(fs.existsSync("supabase_migrations/072_s12_m1_canonical_email_uniqueness.sql")).toBe(false);
  });

  it("keeps preflight independently read-only and covers every required risk", () => {
    const sql = read("preflight.sql");
    expect(sql).toContain("set transaction read only");
    expect(sql).toContain("lock_timeout");
    expect(sql).toContain("statement_timeout");
    expect(sql).not.toMatch(/^\s*(insert|update|delete|create|alter|drop|truncate)\b/im);
    for (const marker of [
      "duplicate_canonical_people_email",
      "duplicate_season_role_canonical_application_email",
      "duplicate_season_role_application_person",
      "duplicate_person_season_role_membership",
      "duplicate_canonical_mentor_code",
      "null_people_emails",
      "blank_people_emails",
      "untrimmed_people_emails",
      "mixed_case_people_emails",
      "people_emails_with_ilike_metacharacters",
      "INDEX_NAME_COLLISION",
      "indexdef",
      "vam063_trusted_api_role",
      "person_season_memberships_person_season_role_key"
    ]) expect(sql).toContain(marker);
  });

  it("uses bounded, separately auditable apply domains and explicit unique arbiters", () => {
    const sql = read("apply.sql");
    expect(sql.match(/^begin;$/gm)).toHaveLength(2);
    expect(sql.match(/^commit;$/gm)).toHaveLength(2);
    expect(sql.match(/set local lock_timeout/g)).toHaveLength(2);
    expect(sql.match(/set local statement_timeout/g)).toHaveLength(2);
    expect(sql).not.toMatch(/create unique index if not exists/i);
    for (const index of [
      "people_canonical_email_key",
      "applications_season_role_canonical_email_key",
      "applications_season_role_person_key",
      "mentor_profiles_canonical_mentor_code_key"
    ]) expect(sql).toContain(`create unique index ${index}`);
  });

  it("uses the authoritative trusted resolver and exposes RPC execution without table access", () => {
    const apply = read("apply.sql");
    const verifier = read("verifier.sql");
    expect(apply.match(/select r\.api_role into v_api_role from public\.vam063_trusted_api_role\(\) r;/g)).toHaveLength(2);
    expect(apply).not.toContain("current_setting('request.jwt.claim.role'");
    expect(apply).toMatch(/revoke all on table public\.legacy_mentor_import_previews\s+from public, anon, authenticated, service_role/);
    expect(apply).toMatch(/grant execute on function[\s\S]+to service_role;/);
    expect(verifier).toContain("TRUSTED_CONTEXT_SOURCE");
    expect(verifier).toContain("DIRECT_TABLE_GRANT");
    expect(verifier).toContain("RPC_GRANT_CONTRACT");
    expect(verifier).toContain("request.jwt.claim.role");
  });

  it("has explicit reverse-order recovery and finalized checksums", () => {
    const rollback = read("rollback.sql");
    expect(rollback.indexOf("drop function public.vam083_consume")).toBeLessThan(
      rollback.indexOf("drop index public.mentor_profiles_canonical_mentor_code_key")
    );
    expect(rollback).toContain("lock_timeout");
    expect(rollback).toContain("statement_timeout");
    const sums = read("SHA256SUMS.txt").trim().split(/\r?\n/);
    expect(sums).toHaveLength(5);
    const crypto = require("node:crypto");
    for (const line of sums) {
      const match = line.match(/^([0-9a-f]{64})\s+([^\s]+)$/);
      expect(match).not.toBeNull();
      if (!match) continue;
      const [, hash, filename] = match;
      const buffer = fs.readFileSync(path.join(PACKAGE, filename));
      const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
      expect(actualHash).toBe(hash);
    }
  });
});

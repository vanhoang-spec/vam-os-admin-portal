import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
import { parseLegacyMentorCsv, type LegacyMentorRow } from "@/lib/legacy-mentor-import";
import { resolveLegacyMentorCandidate } from "@/lib/legacy-mentor-service";
import { postgresIlikeMatches } from "./support/fake-postgrest";

function csv(...rows: string[]) {
  return `full_name,email,phone,legacy_mentor_code,prior_season,notes\n${rows.join("\n")}\n`;
}

function fakeClient(seed: { people?: any[]; profiles?: any[]; personInsertRace?: any } = {}) {
  const tables: Record<string, any[]> = {
    people: [...(seed.people ?? [])],
    mentor_profiles: [...(seed.profiles ?? [])],
    admin_audit_log: []
  };
  const touched: string[] = [];
  let id = 10;
  let personInsertRaceInjected = false;
  function from(table: string) {
    touched.push(table);
    let filters: Array<[string, unknown, "eq" | "ilike"]> = [];
    let mutation: { kind: "insert" | "update"; payload: any } | null = null;
    const chain: any = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.push([key, value, "eq"]); return chain; },
      ilike: (key: string, value: unknown) => { filters.push([key, value, "ilike"]); return chain; },
      limit: () => chain,
      insert: (payload: any) => {
        mutation = { kind: "insert", payload };
        if (table === "admin_audit_log") execute();
        return chain;
      },
      update: (payload: any) => { mutation = { kind: "update", payload }; return chain; },
      maybeSingle: async () => {
        if (
          table === "people" &&
          mutation?.kind === "insert" &&
          seed.personInsertRace &&
          !personInsertRaceInjected
        ) {
          personInsertRaceInjected = true;
          tables.people.push(seed.personInsertRace);
          mutation = null;
          return { data: null, error: { code: "23505", message: "canonical email winner" } };
        }
        const result = execute();
        return { data: result[0] ?? null, error: result.length > 1 ? { code: "PGRST116" } : null };
      },
      then: (resolve: any) => resolve({ data: execute(), error: null })
    };
    function matches(row: any) {
      return filters.every(([key, value, op]) => op === "eq"
        ? row[key] === value
        : postgresIlikeMatches(row[key], value));
    }
    function execute(): any[] {
      if (mutation?.kind === "insert") {
        const payload = { id: `id-${id++}`, ...mutation.payload };
        tables[table] ??= [];
        tables[table].push(payload);
        mutation = null;
        return [payload];
      }
      if (mutation?.kind === "update") {
        const selected = (tables[table] ?? []).filter(matches);
        selected.forEach((row) => Object.assign(row, mutation!.payload));
        mutation = null;
        return selected;
      }
      return (tables[table] ?? []).filter(matches);
    }
    return chain;
  }
  return { client: { from } as any, tables, touched };
}

function row(overrides: Partial<LegacyMentorRow> = {}): LegacyMentorRow {
  return {
    rowNumber: 2,
    fullName: "Legacy Mentor",
    email: "mentor@example.com",
    phone: "0901234567",
    legacyMentorCode: "VM-S9-001",
    priorSeason: "S9",
    notes: "Core Team source",
    status: "NEW_PERSON",
    reason: "",
    personId: null,
    profileId: null,
    canApply: true,
    ...overrides
  };
}

describe("S12-M1 legacy CSV preview", () => {
  it("classifies new, existing, duplicate/case-variant, invalid, and conflict rows", () => {
    const reference = {
      people: [
        { id: "p1", fullName: "Existing", email: "existing@example.com" },
        { id: "p2", fullName: "Conflict A", email: "conflict@example.com" },
        { id: "p3", fullName: "Conflict B", email: "CONFLICT@example.com" }
      ],
      profiles: [{ id: "mp1", personId: "p1", mentorCode: "OLD-1" }]
    };
    const result = parseLegacyMentorCsv(csv(
      "New Mentor,new@example.com,,,,",
      "Existing,EXISTING@example.com,,OLD-1,S10,",
      "Again, new@example.com ,,,S8,",
      "Invalid,not-an-email,,,,",
      "Conflict,conflict@example.com,,,,"
    ), reference);
    expect(result.rows.map((item) => item.status)).toEqual([
      "NEW_PERSON",
      "EXISTING_PERSON",
      "DUPLICATE_IN_FILE",
      "INVALID_EMAIL",
      "CONFLICT_REQUIRES_REVIEW"
    ]);
    expect(result.ok).toBe(false);
  });

  it("is a pure preview parser with no mutation dependency", () => {
    const before = { people: [], profiles: [] };
    const result = parseLegacyMentorCsv(csv("Mentor,mentor@example.com,,,,"), before);
    expect(result.ok).toBe(true);
    expect(before).toEqual({ people: [], profiles: [] });
  });

  it("blocks duplicate legacy mentor codes within one file", () => {
    const result = parseLegacyMentorCsv(csv(
      "First,first@example.com,,VM-DUP,,",
      "Second,second@example.com,, vm-dup ,,"
    ), { people: [], profiles: [] });
    expect(result.rows.map((item) => item.status)).toEqual([
      "CONFLICT_REQUIRES_REVIEW",
      "CONFLICT_REQUIRES_REVIEW"
    ]);
    expect(result.rows.every((item) => item.canApply === false)).toBe(true);
  });

  it("blocks a legacy mentor code already owned by another person", () => {
    const result = parseLegacyMentorCsv(csv(
      "Existing,existing@example.com,,VM-OWNED,,"
    ), {
      people: [{ id: "p-existing", fullName: "Existing", email: "existing@example.com" }],
      profiles: [{ id: "mp-other", personId: "p-other", mentorCode: "vm-owned" }]
    });
    expect(result.rows[0]).toMatchObject({
      status: "CONFLICT_REQUIRES_REVIEW",
      canApply: false
    });
  });

  it("uses an encrypted, actor-bound, one-use preview store with no web grants", () => {
    const store = fs.readFileSync("lib/legacy-mentor-preview-store.ts", "utf8");
    const migration = fs.readFileSync("VAM_OS_M083_S12_M1_IDENTITY_PREVIEW_REMEDIATION_20260827/apply.sql", "utf8");
    expect(store).toContain('createCipheriv("aes-256-gcm"');
    expect(store).toContain('randomBytes(32).toString("base64url")');
    expect(store).toContain("p_actor_admin_user_id: actorId");
    expect(store).toContain('client.rpc("vam083_consume_legacy_mentor_preview"');
    expect(store).toContain("VAM083:");
    expect(migration).toContain("delete from public.legacy_mentor_import_previews");
    expect(migration).toContain("enable row level security");
    expect(migration).toMatch(/revoke all on table public\.legacy_mentor_import_previews\s+from public, anon, authenticated, service_role/);
    expect(migration).toContain("array['core_team','admin','super_admin']");
    expect(migration).toContain("public.vam063_trusted_api_role()");
    expect(migration).not.toContain("current_setting('request.jwt.claim.role'");
  });
});

describe("S12-M1 shared legacy identity resolver", () => {
  it("creates only person/profile/audit and is idempotent on the second import", async () => {
    const fake = fakeClient();
    const first = await resolveLegacyMentorCandidate(fake.client, row(), "legacy_coreteam_import", { id: "admin-1" }, "sha");
    const second = await resolveLegacyMentorCandidate(fake.client, row({ email: " Mentor@Example.com " }), "legacy_coreteam_import", { id: "admin-1" }, "sha");
    expect(first).toMatchObject({ ok: true, outcome: "CREATED" });
    expect(second).toMatchObject({ ok: true, outcome: "REUSED", personId: first.personId, profileId: first.profileId });
    expect(fake.tables.people).toHaveLength(1);
    expect(fake.tables.mentor_profiles).toHaveLength(1);
    expect(fake.touched).not.toContain("person_season_memberships");
    expect(fake.touched).not.toContain("applications");
    expect(fake.tables.people[0].data_quality_flags.match(/legacy_candidate:/g)).toHaveLength(1);
  });

  it("reuses an existing person and the manual path calls the same resolver", async () => {
    const fake = fakeClient({ people: [{ id: "p1", full_name: "Known", email_primary: "KNOWN@example.com", phone_primary: null, source_sheets: "old", data_quality_flags: null }] });
    const result = await resolveLegacyMentorCandidate(fake.client, row({ email: " known@example.com " }), "legacy_manual_entry", { id: "admin-1" });
    expect(result).toMatchObject({ ok: true, outcome: "CREATED", personId: "p1" });
    expect(fake.tables.people).toHaveLength(1);
    expect(fake.tables.mentor_profiles).toHaveLength(1);
    const source = fs.readFileSync("lib/legacy-mentor-service.ts", "utf8");
    expect(source).toContain('resolveLegacyMentorCandidate(client, row, "legacy_manual_entry"');
    expect(source).not.toContain('.from("person_season_memberships")');
    expect(source).not.toContain("vam063_add_membership_role");
  });

  it("fails closed when the mentor code belongs to another person", async () => {
    const fake = fakeClient({
      people: [{ id: "p1", full_name: "Known", email_primary: "known@example.com", phone_primary: null, source_sheets: null, data_quality_flags: null }],
      profiles: [{ id: "mp-other", person_id: "p2", mentor_code: "VM-S9-001" }]
    });
    const result = await resolveLegacyMentorCandidate(
      fake.client,
      row({ email: "known@example.com" }),
      "legacy_coreteam_import",
      { id: "admin-1" }
    );
    expect(result).toMatchObject({ ok: false, outcome: "CONFLICT", reason: "mentor_code_owned_by_another_person" });
    expect(fake.tables.mentor_profiles).toHaveLength(1);
  });

  it("re-reads and reuses the exact canonical person after a 23505 insert race", async () => {
    const fake = fakeClient({
      personInsertRace: {
        id: "race-winner",
        full_name: "Concurrent Mentor",
        email_primary: "MENTOR@example.com",
        phone_primary: null,
        source_sheets: null,
        data_quality_flags: null
      }
    });
    const result = await resolveLegacyMentorCandidate(
      fake.client,
      row(),
      "legacy_coreteam_import",
      { id: "admin-1" },
      "sha"
    );
    expect(result).toMatchObject({ ok: true, outcome: "CREATED", personId: "race-winner" });
    expect(fake.tables.people).toHaveLength(1);
    expect(fake.tables.mentor_profiles).toHaveLength(1);
    expect(fake.tables.people[0].data_quality_flags).toContain("legacy_candidate:");
  });
});

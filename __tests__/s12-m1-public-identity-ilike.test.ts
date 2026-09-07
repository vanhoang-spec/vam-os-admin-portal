import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/apply-gate", () => ({
  evaluateApplyGate: vi.fn(async () => ({ status: "open", state: "open" }))
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ sameAsAnonKey: false }))
}));

import { submitPilotApplication } from "@/lib/applications-create";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { postgresIlikeMatches } from "./support/fake-postgrest";

type Seed = { people?: any[]; applications?: any[] };

function identityClient(seed: Seed = {}) {
  const tables: Record<string, any[]> = {
    seasons: [{ id: "season-12", code: "UEHM-S12" }],
    intake_batches: [{ id: "batch-1", season_id: "season-12", code: "UEHM-S12-B1" }],
    people: [...(seed.people ?? [])],
    applications: [...(seed.applications ?? [])]
  };
  const ilikePatterns: Array<{ table: string; column: string; pattern: string }> = [];
  let insertedApplication: any = null;

  function read(table: string) {
    const filters: Array<(row: any) => boolean> = [];
    let max = Number.POSITIVE_INFINITY;
    const run = () => ({ data: (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))).slice(0, max), error: null });
    const chain: any = {
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return chain;
      },
      ilike(column: string, pattern: unknown) {
        const text = String(pattern ?? "");
        ilikePatterns.push({ table, column, pattern: text });
        filters.push((row) => postgresIlikeMatches(row[column], text));
        return chain;
      },
      limit(value: number) {
        max = value;
        return chain;
      },
      order(column: string) {
        return chain;
      },
      async maybeSingle() {
        const result = run();
        return { data: result.data[0] ?? null, error: result.data.length > 1 ? { code: "PGRST116" } : null };
      },
      then(resolve: any, reject?: any) {
        return Promise.resolve(run()).then(resolve, reject);
      }
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        select: () => read(table),
        insert(payload: any) {
          if (table !== "applications") throw new Error(`Unexpected insert: ${table}`);
          insertedApplication = { id: "application-new", ...payload };
          tables.applications.push(insertedApplication);
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { id: insertedApplication.id }, error: null })
            })
          };
        }
      };
    }
  };
  return { client, ilikePatterns, get insertedApplication() { return insertedApplication; } };
}

function input(emailPrimary: string) {
  return {
    role: "mentor" as const,
    seasonCode: "UEHM-S12",
    intakeBatchCode: "UEHM-S12-B1",
    fullName: "Public Applicant",
    emailPrimary,
    phonePrimary: "0900000000",
    consentDataStorage: true,
    rawPayload: {}
  };
}

describe("S12-M1 public canonical identity lookup", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["_victim-local-part@example.com", "avictim-local-part@example.com", "%\\_victim-local-part@example.com%"],
    ["%@example.com", "victim@example.com", "%\\%@example.com%"],
    ["%@%.%", "victim@example.com", "%\\%@\\%.\\%%"],
    ["*@example.com", "victim@example.com", "%\\*@example.com%"]
  ])("does not treat applicant input %s as an ILIKE pattern", async (attacker, victim, escaped) => {
    const fake = identityClient({
      people: [{ id: "victim-person", email_primary: victim }],
      applications: [{ id: "victim-application", season_id: "season-12", role_applied: "mentor", email_primary: victim }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await submitPilotApplication(input(attacker));

    expect(result).toEqual({ ok: true, applicationId: "application-new" });
    expect(fake.insertedApplication.person_id).toBeNull();
    // In the two-stage lookup, exact runs first, finds nothing, then fallback runs
    expect(fake.ilikePatterns).toEqual([
      { table: "applications", column: "email_primary", pattern: escaped.slice(1, -1) }, // Exact
      { table: "applications", column: "email_primary", pattern: escaped }, // Fallback
      { table: "people", column: "email_primary", pattern: escaped.slice(1, -1) }, // Exact
      { table: "people", column: "email_primary", pattern: escaped }, // Fallback
      // The phone candidate window is a `%`-between-digits SUBSEQUENCE pattern
      // since the P1-A 3-key guard: `normalisePhone` deletes whitespace, so a
      // stored " 0900 000 000 " is the SAME phone and a `%900000000%` window
      // silently hid it. Each character still goes through `escapeIlikePattern`,
      // so applicant phone input cannot become ILIKE syntax either.
      { table: "applications", column: "phone_primary", pattern: "%9%0%0%0%0%0%0%0%0%" }
    ]);
  });

  it.each([
    ["Victim@Example.COM", "victim@example.com"],
    ["  victim@example.com  ", "  Victim@Example.com "]
  ])(
    "links the exact canonical person for %s",
    async (email, storedEmail) => {
      const fake = identityClient({ people: [{ id: "victim-person", email_primary: storedEmail }] });
      vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

      await expect(submitPilotApplication(input(email))).resolves.toEqual({
        ok: true,
        applicationId: "application-new"
      });
      expect(fake.insertedApplication).toMatchObject({
        person_id: "victim-person",
        email_primary: "victim@example.com"
      });
    }
  );

  it("does not fetch/match thuha@gmail.com or ngocha@gmail.com as identity candidates in the normal path", async () => {
    // Both stored records contain "ha@gmail.com" as a substring.
    const fake = identityClient({
      people: [
        { id: "person-1", email_primary: "thuha@gmail.com" },
        { id: "person-2", email_primary: "ngocha@gmail.com" }
      ]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    await expect(submitPilotApplication(input("ha@gmail.com"))).resolves.toEqual({
      ok: true,
      applicationId: "application-new"
    });
    // Should NOT link to any of them
    expect(fake.insertedApplication.person_id).toBeNull();
  });

  it("still rejects an exact canonical application duplicate", async () => {
    const fake = identityClient({
      applications: [{ id: "existing", season_id: "season-12", role_applied: "mentor", email_primary: "Victim@Example.com" }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    await expect(submitPilotApplication(input(" victim@example.COM "))).resolves.toMatchObject({
      ok: false,
      code: "duplicate"
    });
    expect(fake.insertedApplication).toBeNull();
  });

  it("fails closed if duplicate lookup returns more than 25 candidates", async () => {
    const applications = Array.from({ length: 26 }).map((_, i) => ({
      id: `app-${i}`, season_id: "season-12", role_applied: "mentor", email_primary: `victim@example.com`
    }));
    const fake = identityClient({ applications });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    await expect(submitPilotApplication(input("victim@example.com"))).resolves.toMatchObject({
      ok: false,
      code: "db"
    });
    expect(fake.insertedApplication).toBeNull();
  });

  it("fails closed if person lookup returns more than 25 candidates", async () => {
    const people = Array.from({ length: 26 }).map((_, i) => ({
      id: `person-${i}`, email_primary: `victim@example.com`
    }));
    const fake = identityClient({ people });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    await expect(submitPilotApplication(input("victim@example.com"))).resolves.toMatchObject({
      ok: false,
      code: "db"
    });
    expect(fake.insertedApplication).toBeNull();
  });
});

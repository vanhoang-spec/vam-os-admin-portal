/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => null) }));
vi.mock("@/lib/program-scope", () => ({
  canOperateSeason: vi.fn(async () => true),
  canReadAnyScope: vi.fn(() => true),
  getAdminScopeContext: vi.fn(async () => ({ adminUser: null, authUserId: null, globalRole: null, isSuperAdmin: true, programScopes: [] })),
  getScopeFilter: vi.fn(async () => undefined),
  getScopeLevelForSeason: vi.fn(async () => "full_access")
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/app/actions/membership-lifecycle", () => ({
  initialMembershipLifecycleState: { ok: false, message: "" },
  transitionMembershipAction: vi.fn(),
  addMembershipRoleAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormState: (action: unknown, initial: unknown) => [initial, action] };
});

import { MembershipLifecycleControls } from "@/app/people/[id]/membership-lifecycle-controls";
import { getPersonSeasonMemberships } from "@/lib/lifecycle-crm";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const PERSON = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_A = "22222222-2222-4222-8222-2222222222aa";
const MEMBERSHIP_B = "22222222-2222-4222-8222-2222222222bb";
const BATCH_A = "33333333-3333-4333-8333-3333333333aa";
const BATCH_B = "33333333-3333-4333-8333-3333333333bb";
const BATCH_UNRELATED = "33333333-3333-4333-8333-3333333333cc";
const PROGRAM = "44444444-4444-4444-8444-444444444444";
const SEASON = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };

function membershipRow(id: string, intakeBatchId: string | null): Row {
  return {
    id,
    person_id: PERSON,
    program_id: PROGRAM,
    season_id: SEASON,
    intake_batch_id: intakeBatchId,
    role: "mentee",
    status: "active",
    source: "manual",
    start_date: null,
    end_date: null,
    notes: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z"
  };
}

type Trace = { tables: string[]; selects: string[]; batchIdFilters: string[][] };

function stubClient(results: Record<string, Result>) {
  const trace: Trace = { tables: [], selects: [], batchIdFilters: [] };
  const from = vi.fn((table: string) => {
    trace.tables.push(table);
    const result = results[table] ?? { data: [], error: null };
    const builder: Record<string, unknown> = {
      select: vi.fn((columns: string) => {
        trace.selects.push(`${table}:${columns}`);
        return builder;
      }),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      in: vi.fn((column: string, values: string[]) => {
        if (table === "intake_batches" && column === "id") trace.batchIdFilters.push(values);
        return builder;
      }),
      then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject)
    };
    return builder;
  });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ from } as never);
  return trace;
}

function membershipView(id: string, intakeBatchCode: string | null) {
  return { id, role: "mentee", status: "active", intakeBatchCode, programLabel: "UEHM", seasonLabel: "S12" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("membership intake batch resolution (server loader)", () => {
  it("resolves the code of the batch the membership actually references", async () => {
    stubClient({
      person_season_memberships: { data: [membershipRow(MEMBERSHIP_A, BATCH_A)], error: null },
      intake_batches: { data: [{ id: BATCH_A, code: "SYNTH-BATCH-A" }], error: null }
    });
    const result = await getPersonSeasonMemberships(PERSON);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].intake_batch_id).toBe(BATCH_A);
    expect(result.data[0].intake_batch_code).toBe("SYNTH-BATCH-A");
  });

  it("maps two memberships to their own two distinct batch codes", async () => {
    stubClient({
      person_season_memberships: { data: [membershipRow(MEMBERSHIP_A, BATCH_A), membershipRow(MEMBERSHIP_B, BATCH_B)], error: null },
      intake_batches: {
        data: [
          { id: BATCH_B, code: "SYNTH-BATCH-B" },
          { id: BATCH_A, code: "SYNTH-BATCH-A" }
        ],
        error: null
      }
    });
    const result = await getPersonSeasonMemberships(PERSON);
    const byId = new Map(result.data.map((row) => [row.id, row.intake_batch_code]));
    expect(byId.get(MEMBERSHIP_A)).toBe("SYNTH-BATCH-A");
    expect(byId.get(MEMBERSHIP_B)).toBe("SYNTH-BATCH-B");
  });

  it("leaves memberships without a batch at null and never queries intake_batches for them", async () => {
    const trace = stubClient({
      person_season_memberships: { data: [membershipRow(MEMBERSHIP_A, null)], error: null }
    });
    const result = await getPersonSeasonMemberships(PERSON);
    expect(result.error).toBeNull();
    expect(result.data[0].intake_batch_code).toBeNull();
    expect(trace.tables).not.toContain("intake_batches");
  });

  it("never borrows another row's code when a referenced batch does not resolve", async () => {
    stubClient({
      person_season_memberships: { data: [membershipRow(MEMBERSHIP_A, BATCH_A), membershipRow(MEMBERSHIP_B, BATCH_B)], error: null },
      intake_batches: {
        data: [
          { id: BATCH_B, code: "SYNTH-BATCH-B" },
          { id: BATCH_UNRELATED, code: "SYNTH-BATCH-UNRELATED" }
        ],
        error: null
      }
    });
    const result = await getPersonSeasonMemberships(PERSON);
    const byId = new Map(result.data.map((row) => [row.id, row.intake_batch_code]));
    expect(result.data).toHaveLength(2);
    expect(byId.get(MEMBERSHIP_A)).toBeNull();
    expect(byId.get(MEMBERSHIP_B)).toBe("SYNTH-BATCH-B");
  });

  it("treats a blank batch code as unavailable instead of an empty-string identity", async () => {
    stubClient({
      person_season_memberships: { data: [membershipRow(MEMBERSHIP_A, BATCH_A)], error: null },
      intake_batches: { data: [{ id: BATCH_A, code: "   " }], error: null }
    });
    const result = await getPersonSeasonMemberships(PERSON);
    expect(result.data[0].intake_batch_code).toBeNull();
  });

  it("fails closed with the loader error pattern when the batch read fails", async () => {
    stubClient({
      person_season_memberships: { data: [membershipRow(MEMBERSHIP_A, BATCH_A)], error: null },
      intake_batches: { data: null, error: { message: "permission denied for table intake_batches" } }
    });
    const result = await getPersonSeasonMemberships(PERSON);
    expect(result.data).toEqual([]);
    expect(result.error).toContain("intake_batches");
  });

  it("reads only the two required tables, by exact deduplicated ids, without widening the query", async () => {
    const trace = stubClient({
      person_season_memberships: {
        data: [membershipRow(MEMBERSHIP_A, BATCH_A), membershipRow(MEMBERSHIP_B, BATCH_A)],
        error: null
      },
      intake_batches: { data: [{ id: BATCH_A, code: "SYNTH-BATCH-A" }], error: null }
    });
    await getPersonSeasonMemberships(PERSON);
    expect(trace.tables).toEqual(["person_season_memberships", "intake_batches"]);
    expect(trace.batchIdFilters).toEqual([[BATCH_A]]);
    expect(trace.selects).toContain("intake_batches:id,code");
  });

  it("keeps the existing membership query shape (person filter and ordering) unchanged", () => {
    const source = readFileSync("lib/lifecycle-crm.ts", "utf8");
    expect(source).toContain('.eq("person_id", personId)');
    expect(source).toContain('.order("start_date", { ascending: false, nullsFirst: false })');
    expect(source).toContain('.order("created_at", { ascending: false })');
  });
});

describe("membership intake batch DOM contract", () => {
  it("puts the batch identity on the exact membership container that owns it", () => {
    const { container } = render(
      <MembershipLifecycleControls
        personId={PERSON}
        enabled
        memberships={[membershipView(MEMBERSHIP_A, "SYNTH-BATCH-A"), membershipView(MEMBERSHIP_B, "SYNTH-BATCH-B")]}
        programs={[{ id: PROGRAM, label: "UEHM" }]}
        seasons={[{ id: SEASON, label: "S12" }]}
      />
    );
    const sectionA = container.querySelector(`[data-vam-membership-id="${MEMBERSHIP_A}"]`);
    const sectionB = container.querySelector(`[data-vam-membership-id="${MEMBERSHIP_B}"]`);
    expect(sectionA?.tagName).toBe("SECTION");
    expect(sectionA?.getAttribute("data-vam-intake-batch")).toBe("SYNTH-BATCH-A");
    expect(sectionB?.getAttribute("data-vam-intake-batch")).toBe("SYNTH-BATCH-B");
    expect(container.querySelectorAll("[data-vam-intake-batch]")).toHaveLength(2);
    expect(sectionA?.querySelector(`[data-vam-membership-id="${MEMBERSHIP_B}"]`)).toBeNull();
  });

  it("never places the identity on a shared ancestor of several memberships", () => {
    const { container } = render(
      <MembershipLifecycleControls
        personId={PERSON}
        enabled
        memberships={[membershipView(MEMBERSHIP_A, "SYNTH-BATCH-A"), membershipView(MEMBERSHIP_B, "SYNTH-BATCH-B")]}
        programs={[{ id: PROGRAM, label: "UEHM" }]}
        seasons={[{ id: SEASON, label: "S12" }]}
      />
    );
    for (const marked of Array.from(container.querySelectorAll("[data-vam-intake-batch]"))) {
      expect(marked.querySelectorAll("[data-vam-membership-id]")).toHaveLength(0);
      expect(marked.getAttribute("data-vam-membership-id")).toBeTruthy();
    }
  });

  it("omits the attribute entirely for a membership with no batch, and still renders it", () => {
    const { container } = render(
      <MembershipLifecycleControls
        personId={PERSON}
        enabled
        memberships={[membershipView(MEMBERSHIP_A, null), membershipView(MEMBERSHIP_B, "SYNTH-BATCH-B")]}
        programs={[{ id: PROGRAM, label: "UEHM" }]}
        seasons={[{ id: SEASON, label: "S12" }]}
      />
    );
    const sectionA = container.querySelector(`[data-vam-membership-id="${MEMBERSHIP_A}"]`);
    expect(sectionA).not.toBeNull();
    expect(sectionA?.hasAttribute("data-vam-intake-batch")).toBe(false);
    expect(container.innerHTML).not.toContain('data-vam-intake-batch=""');
    expect(container.innerHTML).not.toContain('data-vam-intake-batch="null"');
    expect(container.innerHTML).not.toContain('data-vam-intake-batch="undefined"');
  });

  it("renders every membership container when no membership has a batch at all", () => {
    const { container } = render(
      <MembershipLifecycleControls
        personId={PERSON}
        enabled
        memberships={[membershipView(MEMBERSHIP_A, null), membershipView(MEMBERSHIP_B, null)]}
        programs={[{ id: PROGRAM, label: "UEHM" }]}
        seasons={[{ id: SEASON, label: "S12" }]}
      />
    );
    expect(container.querySelectorAll("[data-vam-membership-id]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-vam-intake-batch]")).toHaveLength(0);
  });

  it("escapes the code instead of injecting markup", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const { container } = render(
      <MembershipLifecycleControls
        personId={PERSON}
        enabled
        memberships={[membershipView(MEMBERSHIP_A, hostile)]}
        programs={[{ id: PROGRAM, label: "UEHM" }]}
        seasons={[{ id: SEASON, label: "S12" }]}
      />
    );
    const section = container.querySelector(`[data-vam-membership-id="${MEMBERSHIP_A}"]`);
    expect(section?.getAttribute("data-vam-intake-batch")).toBe(hostile);
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps lifecycle transition controls scoped inside their own membership container", () => {
    const { container } = render(
      <MembershipLifecycleControls
        personId={PERSON}
        enabled
        memberships={[membershipView(MEMBERSHIP_A, "SYNTH-BATCH-A"), membershipView(MEMBERSHIP_B, null)]}
        programs={[{ id: PROGRAM, label: "UEHM" }]}
        seasons={[{ id: SEASON, label: "S12" }]}
      />
    );
    const sectionA = container.querySelector(`[data-vam-membership-id="${MEMBERSHIP_A}"]`) as HTMLElement;
    const membershipInputs = Array.from(sectionA.querySelectorAll('input[name="membership_id"]')) as HTMLInputElement[];
    expect(membershipInputs.length).toBeGreaterThan(0);
    for (const input of membershipInputs) expect(input.value).toBe(MEMBERSHIP_A);
    expect(sectionA.querySelectorAll("button").length).toBe(membershipInputs.length);
  });

  it("still hides every membership container and control when operations permission is absent", () => {
    const { container } = render(
      <MembershipLifecycleControls
        personId={PERSON}
        enabled={false}
        memberships={[membershipView(MEMBERSHIP_A, "SYNTH-BATCH-A")]}
        programs={[{ id: PROGRAM, label: "UEHM" }]}
        seasons={[{ id: SEASON, label: "S12" }]}
      />
    );
    expect(container.querySelectorAll("[data-vam-membership-id]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-vam-intake-batch]")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.textContent).toContain("operations");
  });
});

describe("intake batch identity carries no UAT fixture constants", () => {
  it("keeps the resolved value server-derived and free of hardcoded fixture identifiers", () => {
    for (const file of ["lib/lifecycle-crm.ts", "app/people/[id]/page.tsx", "app/people/[id]/membership-lifecycle-controls.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/UEHM-S12-B1/);
      expect(source).not.toMatch(/uat[-_.]?fixture/i);
      expect(source).not.toMatch(/@redsquarevietnam\.com/i);
    }
    const page = readFileSync("app/people/[id]/page.tsx", "utf8");
    expect(page).toContain("intakeBatchCode: row.intake_batch_code");
  });

  it("does not reach into HAM or hardcoded season tables to resolve the batch", () => {
    const source = readFileSync("lib/lifecycle-crm.ts", "utf8");
    expect(source).not.toMatch(/\bham\b/i);
    expect(source).not.toMatch(/S11|season_11/i);
    expect(source.match(/\.from\("intake_batches"\)/g)).toHaveLength(1);
  });
});

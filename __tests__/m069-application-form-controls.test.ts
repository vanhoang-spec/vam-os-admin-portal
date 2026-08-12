import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn()
}));

import {
  isApplicantRole,
  isApplicationFormState,
  readApplicationFormControls,
  readApplicationFormState,
  S12_BINDING
} from "../lib/application-form-controls";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SEASON_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BATCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type ControlRow = Record<string, unknown>;

function controlRow(role: "mentor" | "mentee", state: string, overrides: ControlRow = {}) {
  return {
    applicant_role: role,
    state,
    program_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    season_id: SEASON_ID,
    intake_batch_id: BATCH_ID,
    updated_at: "2026-08-12T03:00:00.000Z",
    admin_users: { full_name: "Owner", email: "owner@example.com" },
    ...overrides
  };
}

/**
 * Builds a Supabase mock over the three reads the module performs:
 * seasons -> intake_batches -> application_form_controls.
 */
function mockClient(options: {
  season?: ControlRow | null;
  seasonError?: unknown;
  batch?: ControlRow | null;
  batchError?: unknown;
  rows?: ControlRow[];
  rowsError?: unknown;
} = {}) {
  const {
    season = {
      id: SEASON_ID,
      code: "UEHM-S12",
      program_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      programs: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", code: "UEHM" }
    },
    batch = { id: BATCH_ID, code: "UEHM-S12-B1", season_id: SEASON_ID },
    rows = [controlRow("mentor", "closed"), controlRow("mentee", "closed")]
  } = options;

  const from = vi.fn((table: string) => {
    if (table === "seasons") {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({
        data: options.seasonError ? null : season,
        error: options.seasonError ?? null
      }));
      return chain;
    }
    if (table === "intake_batches") {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({
        data: options.batchError ? null : batch,
        error: options.batchError ?? null
      }));
      return chain;
    }
    if (table === "application_form_controls") {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(async () => ({
        data: options.rowsError ? null : rows,
        error: options.rowsError ?? null
      }));
      return chain;
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { client: { from }, from };
}

function useClient(options: Parameters<typeof mockClient>[0] = {}) {
  const built = mockClient(options);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(built.client as never);
  return built;
}

describe("M069 — the fixed Season 12 binding", () => {
  it("is exactly UEHM / UEHM-S12 / UEHM-S12-B1", () => {
    expect(S12_BINDING).toEqual({
      programCode: "UEHM",
      seasonCode: "UEHM-S12",
      intakeBatchCode: "UEHM-S12-B1"
    });
  });

  it("never names a Season 11 code", () => {
    expect(JSON.stringify(S12_BINDING)).not.toContain("S11");
  });
});

describe("M069 — type guards", () => {
  it.each(["mentor", "mentee"])("accepts role %s", (role) => {
    expect(isApplicantRole(role)).toBe(true);
  });

  it.each(["admin", "reviewer", "", null, undefined, 0, {}])(
    "rejects non-role %s",
    (value) => {
      expect(isApplicantRole(value)).toBe(false);
    }
  );

  it.each(["closed", "pilot", "open"])("accepts state %s", (state) => {
    expect(isApplicationFormState(state)).toBe(true);
  });

  it.each(["OPEN", "enabled", "true", "", null, undefined, 1])(
    "rejects non-state %s",
    (value) => {
      expect(isApplicationFormState(value)).toBe(false);
    }
  );
});

describe("M069 — readApplicationFormControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns both roles CLOSED for a freshly migrated database", async () => {
    useClient();
    const result = await readApplicationFormControls();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.mentor.state).toBe("closed");
    expect(result.controls.mentee.state).toBe("closed");
    expect(result.controls.mentor.intakeBatchCode).toBe("UEHM-S12-B1");
    expect(result.controls.mentee.seasonCode).toBe("UEHM-S12");
  });

  it("surfaces mentor OPEN with mentee still CLOSED", async () => {
    useClient({ rows: [controlRow("mentor", "open"), controlRow("mentee", "closed")] });
    const result = await readApplicationFormControls();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.mentor.state).toBe("open");
    expect(result.controls.mentee.state).toBe("closed");
  });

  it("surfaces mentee PILOT with mentor still CLOSED", async () => {
    useClient({ rows: [controlRow("mentor", "closed"), controlRow("mentee", "pilot")] });
    const result = await readApplicationFormControls();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.mentor.state).toBe("closed");
    expect(result.controls.mentee.state).toBe("pilot");
  });

  it("surfaces both OPEN", async () => {
    useClient({ rows: [controlRow("mentor", "open"), controlRow("mentee", "open")] });
    const result = await readApplicationFormControls();
    if (!result.ok) throw new Error("expected ok");
    expect([result.controls.mentor.state, result.controls.mentee.state]).toEqual(["open", "open"]);
  });

  it("reports who changed it and when", async () => {
    useClient();
    const result = await readApplicationFormControls();
    if (!result.ok) throw new Error("expected ok");
    expect(result.controls.mentor.updatedByName).toBe("Owner");
    expect(result.controls.mentor.updatedByEmail).toBe("owner@example.com");
    expect(result.controls.mentor.updatedAt).toBe("2026-08-12T03:00:00.000Z");
  });

  // ── Fail-closed behaviour ─────────────────────────────────────────────────
  it.each([
    ["no service-role client", () => vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as never), "control_client_unavailable"],
    ["a season read error", () => useClient({ seasonError: { message: "boom" } }), "control_season_unreadable"],
    ["a missing season", () => useClient({ season: null }), "control_season_missing"],
    ["a batch read error", () => useClient({ batchError: { message: "boom" } }), "control_batch_unreadable"],
    ["a missing intake batch", () => useClient({ batch: null }), "control_batch_missing"],
    ["an unreadable control table", () => useClient({ rowsError: { message: "boom" } }), "control_rows_unreadable"],
    ["no control rows at all", () => useClient({ rows: [] }), "control_rows_missing"],
    ["only a mentor row", () => useClient({ rows: [controlRow("mentor", "open")] }), "control_rows_missing"]
  ])("fails closed on %s", async (_label, arrange, expectedReason) => {
    arrange();
    const result = await readApplicationFormControls();
    expect(result).toEqual({ ok: false, reason: expectedReason });
  });

  it("rejects a control row whose program is not UEHM", async () => {
    useClient({
      season: {
        id: SEASON_ID,
        code: "UEHM-S12",
        program_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        programs: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", code: "OTHER" }
      }
    });
    await expect(readApplicationFormControls()).resolves.toEqual({
      ok: false,
      reason: "control_program_binding_invalid"
    });
  });

  it("ignores a row whose stored season disagrees with the catalog", async () => {
    // A tampered or mis-seeded row pointing at another season must not be
    // able to speak for UEHM-S12 — this is what stops a Season 11 control
    // row from opening the Season 12 form.
    useClient({
      rows: [
        controlRow("mentor", "open", { season_id: "99999999-9999-4999-8999-999999999999" }),
        controlRow("mentee", "closed")
      ]
    });
    await expect(readApplicationFormControls()).resolves.toEqual({
      ok: false,
      reason: "control_rows_missing"
    });
  });

  it("ignores a row whose stored intake batch disagrees with the catalog", async () => {
    useClient({
      rows: [
        controlRow("mentor", "open", { intake_batch_id: "99999999-9999-4999-8999-999999999999" }),
        controlRow("mentee", "closed")
      ]
    });
    await expect(readApplicationFormControls()).resolves.toEqual({
      ok: false,
      reason: "control_rows_missing"
    });
  });

  it.each(["OPEN", "enabled", "true", "", "opened", null])(
    "coerces the malformed state %s to closed rather than trusting it",
    async (bad) => {
      useClient({ rows: [controlRow("mentor", bad as string), controlRow("mentee", "closed")] });
      const result = await readApplicationFormControls();
      if (!result.ok) throw new Error("expected ok");
      expect(result.controls.mentor.state).toBe("closed");
    }
  );

  it("skips a row with an unrecognised applicant_role", async () => {
    useClient({
      rows: [
        controlRow("mentor", "closed"),
        controlRow("mentee", "closed"),
        controlRow("coordinator" as never, "open")
      ]
    });
    const result = await readApplicationFormControls();
    if (!result.ok) throw new Error("expected ok");
    expect(Object.keys(result.controls).sort()).toEqual(["mentee", "mentor"]);
  });
});

describe("M069 — readApplicationFormState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the stored state with no reason on success", async () => {
    useClient({ rows: [controlRow("mentor", "pilot"), controlRow("mentee", "closed")] });
    await expect(readApplicationFormState("mentor")).resolves.toEqual({
      state: "pilot",
      reason: null
    });
  });

  it("returns closed WITH a reason on any lookup failure", async () => {
    useClient({ rowsError: { message: "boom" } });
    await expect(readApplicationFormState("mentor")).resolves.toEqual({
      state: "closed",
      reason: "control_rows_unreadable"
    });
  });
});

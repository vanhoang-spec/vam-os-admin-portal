import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const from = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(() => ({ from }))
}));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({
    adminUser: { role: "super_admin" },
    authUserId: "safe-auth-reference",
    globalRole: "super_admin",
    isSuperAdmin: true,
    programScopes: []
  }))
}));

import { loadProgramContextCatalog, resolveAuthorizedProgramContext } from "@/lib/program-context";
import { ProgramContextError, resolveCanonicalContext } from "@/lib/program-context-core";

const programs = [
  { id: "program-uehm", code: "UEHM", name: "UEH Mentoring", is_active: true },
  { id: "program-ham", code: "HAM", name: "Hanoi Alumni Mentoring", is_active: true }
];
const stagingSeasons = [
  { id: "season-uehm-s12", code: "UEHM-S12", name: "UEHM Season 12", program_id: "program-uehm" },
  { id: "season-ham-s6", code: "HAM-S6", name: "HAM Season 6", program_id: "program-ham" }
];

function useCatalogRows(seasonError: unknown = null, seasons = stagingSeasons) {
  from.mockImplementation((table: string) => ({
    select: vi.fn(async (columns: string) => {
      if (table === "programs") return { data: programs, error: null };
      if (table === "seasons") return { data: seasonError ? null : seasons, error: seasonError };
      if (table === "intake_batches") return { data: [], error: null };
      throw new Error("Unexpected table " + table + ":" + columns);
    })
  }));
}

describe("staging season catalog runtime contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCatalogRows();
  });

  it("loads the real staging season row shape without requesting a status column", async () => {
    const catalog = await loadProgramContextCatalog();
    const seasonSelect = from.mock.results
      .map((result) => result.value?.select)
      .find((select) => select?.mock?.calls?.some((call: unknown[]) => String(call[0]).includes("program_id")));
    expect(seasonSelect).toHaveBeenCalledWith("id,code,name,program_id");
    expect(seasonSelect).not.toHaveBeenCalledWith(expect.stringContaining("status"));
    expect(catalog.seasons).toEqual([
      { id: "season-uehm-s12", code: "UEHM-S12", name: "UEHM Season 12", programId: "program-uehm" },
      { id: "season-ham-s6", code: "HAM-S6", name: "HAM Season 6", programId: "program-ham" }
    ]);
  });

  it("resolves UEHM and UEHM-S12 from authoritative values with no legacy fallback", async () => {
    const context = await resolveAuthorizedProgramContext({ programCode: "UEHM", seasonCode: "UEHM-S12" });
    expect(context).toMatchObject({
      selectedProgramId: "program-uehm",
      selectedProgramCode: "UEHM",
      selectedSeasonId: "season-uehm-s12",
      selectedSeasonCode: "UEHM-S12"
    });
    expect(JSON.stringify(context)).not.toContain("VAM");
    expect(JSON.stringify(context)).not.toContain("UEHM-S11");
  });

  it("continues rejecting a cross-program season pairing", async () => {
    await expect(resolveAuthorizedProgramContext({ programCode: "HAM", seasonCode: "UEHM-S12" }))
      .rejects.toMatchObject({ code: "invalid_scope" });
  });

  it("excludes incomplete season relationships and returns an explicit safe warning", async () => {
    useCatalogRows(null, [...stagingSeasons, { id: "orphan", code: "ORPHAN-S1", name: "Orphan", program_id: null as unknown as string }]);
    const catalog = await loadProgramContextCatalog();
    expect(catalog.seasons.map((season) => season.code)).toEqual(["UEHM-S12", "HAM-S6"]);
    expect(catalog.warnings).toEqual(["Một số season thiếu liên kết program hợp lệ và đã bị loại khỏi bộ chọn."]);
  });

  it("fails closed with a safe ProgramContextError for a genuine catalog query error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useCatalogRows({ code: "PGRST_SAFE", message: "internal database detail" });
    await expect(loadProgramContextCatalog()).rejects.toMatchObject({
      name: "ProgramContextError",
      code: "forbidden",
      message: "Không thể xác minh phạm vi truy cập lúc này."
    });
    try {
      await loadProgramContextCatalog();
    } catch (error) {
      expect(error).toBeInstanceOf(ProgramContextError);
      expect(String((error as Error).message)).not.toContain("internal database detail");
    }
    errorSpy.mockRestore();
  });

  it("keeps the pure resolver independent of any season lifecycle field", () => {
    const catalog = {
      programs: programs.map((row) => ({ id: row.id, code: row.code, name: row.name, isActive: row.is_active })),
      seasons: stagingSeasons.map((row) => ({ id: row.id, code: row.code, name: row.name, programId: row.program_id })),
      intakeBatches: []
    };
    expect(resolveCanonicalContext(
      { authenticated: true, isSuperAdmin: true, grants: [] },
      catalog,
      { programCode: "UEHM", seasonCode: "UEHM-S12" }
    ).selectedSeasonId).toBe("season-uehm-s12");
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VAM00025 — nút "Xuất Excel hồ sơ Mentor/Mentee" trên /mentors, /mentees.
 * Nút chỉ hiện cho nhóm tải được (hẹp hơn nhóm xem trang); đường tải kiểm lại ở máy chủ (participant-export-route.test).
 */

const mocks = vi.hoisted(() => ({ canOperate: true as boolean | "throw" }));
vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/program-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/program-scope")>()),
  canOperateSeason: async () => {
    if (mocks.canOperate === "throw") throw new Error("scope unavailable");
    return mocks.canOperate;
  }
}));

import { canShowParticipantExport } from "@/lib/participant-export";
import { canExportParticipantProfiles } from "@/lib/permissions";
import { canBrowseParticipants } from "@/lib/read-access";
import type { AdminScopeContext } from "@/lib/program-scope";

const ctx = (scopeError: string | null = null) =>
  ({ adminUser: null, authUserId: null, globalRole: null, isSuperAdmin: false, programScopes: [], scopeError }) as unknown as AdminScopeContext;
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

beforeEach(() => {
  mocks.canOperate = true;
});

describe("quyền tải hẹp hơn quyền xem", () => {
  it("Super admin, Admin, Core team tải được; Support team xem được trang nhưng không tải", () => {
    for (const role of ["super_admin", "admin", "core_team"]) expect(canExportParticipantProfiles(role), role).toBe(true);
    for (const role of ["support_team", "mentor", "mentee", "reviewer", "viewer", "", null, undefined]) {
      expect(canExportParticipantProfiles(role as string | null), String(role)).toBe(false);
    }
    expect(canBrowseParticipants("support_team")).toBe(true);
  });

  it("nút cần CẢ vai trò lẫn quyền vận hành mùa; lỗi phạm vi thì ẩn", async () => {
    expect(await canShowParticipantExport("admin", ctx(), "s")).toBe(true);
    expect(await canShowParticipantExport("support_team", ctx(), "s")).toBe(false);
    mocks.canOperate = false;
    expect(await canShowParticipantExport("admin", ctx(), "s")).toBe(false);
    mocks.canOperate = "throw";
    expect(await canShowParticipantExport("admin", ctx(), "s")).toBe(false);
    mocks.canOperate = true;
    expect(await canShowParticipantExport("admin", ctx("unreadable"), "s")).toBe(false);
  });
});

describe("hai nút riêng trên hai trang", () => {
  for (const [file, role, label] of [
    ["app/mentors/page.tsx", "mentor", "Xuất Excel hồ sơ Mentor"],
    ["app/mentees/page.tsx", "mentee", "Xuất Excel hồ sơ Mentee"]
  ] as const) {
    it(`${file}: nút "${label}" nằm trong nhánh allowExport, tải đúng vai trò và đúng mùa trang đang hiện`, () => {
      const code = source(file);
      expect(code).toContain("const allowExport = await canShowParticipantExport(routeUser.role, scopeContext, seasonContext.selectedSeasonId);");
      const block = /\{allowExport \? \(([\s\S]*?)\) : null\}/.exec(code)?.[1] ?? "";
      expect(block).toContain(label);
      expect(block).toContain(`participantExportHref("${role}", seasonContext.selectedSeasonCode)`);
      // Nút của trang này không mang vai trò của trang kia.
      expect(block).not.toContain(`participantExportHref("${role === "mentor" ? "mentee" : "mentor"}"`);
    });
  }
});

/**
 * Ai dùng được Công cụ AI — và nav, trang, action, route xuất Word nói cùng một
 * câu trả lời.
 *
 * Quyết định của chủ chương trình ngày 14/09/2026: super_admin, admin, core_team,
 * support_team dùng được; báo cáo Ban điều hành chỉ super_admin và admin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import { allNavHrefs, buildNavGroups } from "@/lib/nav-model";
import { canRunAiExecutiveReport, canUseAiTools, canViewAiStatus } from "@/lib/permissions";

const ROOT = join(__dirname, "..");
const ROLES = ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"] as const;

const user = (role: (typeof ROLES)[number]) =>
  ({ id: "u", email: "u@vam.org", full_name: "U", role, status: "active", auth_user_id: null }) as CurrentAdminUser;

const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

describe("vai trò", () => {
  it("bốn vai trò dùng được công cụ; reviewer, viewer và người không vai trò thì không", () => {
    expect(ROLES.filter((role) => canUseAiTools(role))).toEqual(["super_admin", "admin", "core_team", "support_team"]);
    for (const empty of ["", null, undefined]) expect(canUseAiTools(empty)).toBe(false);
  });

  it("báo cáo Ban điều hành và trang trạng thái chỉ super_admin, admin", () => {
    expect(ROLES.filter((role) => canRunAiExecutiveReport(role))).toEqual(["super_admin", "admin"]);
    expect(ROLES.filter((role) => canViewAiStatus(role))).toEqual(["super_admin", "admin"]);
    for (const empty of ["", null, undefined]) {
      expect(canRunAiExecutiveReport(empty)).toBe(false);
      expect(canViewAiStatus(empty)).toBe(false);
    }
  });
});

describe("nav chỉ chào đúng người trang cho vào", () => {
  it.each([...ROLES])("%s", (role) => {
    const groups = buildNavGroups(user(role));
    expect(allNavHrefs(groups).includes("/ai")).toBe(canUseAiTools(role));
    if (canUseAiTools(role)) {
      // Nằm trong nhóm Vận hành, không thành nhóm riêng (trần 9 nhóm của sidebar).
      const holders = groups.filter((group) => (group.items ?? []).some((item) => item.href === "/ai"));
      expect(holders.map((group) => group.key)).toEqual(["operations"]);
    }
  });

  it("chưa đăng nhập thì không có mục này", () => {
    expect(allNavHrefs(buildNavGroups(null))).not.toContain("/ai");
  });
});

describe("trang, action và route tự gác cửa", () => {
  it("trang /ai chặn theo đúng predicate của nav, và chỉ dựng thẻ báo cáo khi được phép", () => {
    const page = read("app", "ai", "page.tsx");
    expect(page).toMatch(/if \(!adminUser\?\.id\) redirect\("\/login"\)/);
    expect(page).toMatch(/if \(!canUseAiTools\(adminUser\.role\)\) redirect\("\/"\)/);
    expect(page).toMatch(/const canReport = canRunAiExecutiveReport\(adminUser\.role\)/);
    expect(page).toMatch(/canReport \? await resolveReportSeason\(\) : null/);
  });

  it("trang trạng thái chặn theo canViewAiStatus", () => {
    expect(read("app", "ai", "status", "page.tsx")).toMatch(/if \(!canViewAiStatus\(adminUser\.role\)\) redirect\(/);
  });

  it("MỌI action xuất ra đều kiểm quyền ở câu lệnh đầu tiên", () => {
    const actions = read("app", "actions", "ai-tools.ts");
    const exported = actions.match(/export async function \w+/g) ?? [];
    const guarded = actions.match(/export async function \w+\([^)]*\): Promise<AiState> \{\s*const actor = await authorize\(\);\s*if \(!actor\.ok\) return actor\.state;/g) ?? [];
    expect(exported.length).toBe(6);
    expect(guarded.length).toBe(exported.length);
  });

  it("authorize kiểm vai trò rồi mới kiểm khoá API, và lỗi đọc phiên không thành quyền", () => {
    const actions = read("app", "actions", "ai-tools.ts");
    const body = actions.slice(actions.indexOf("async function authorize"), actions.indexOf("function toFailure"));
    expect(body.indexOf("canUseAiTools(")).toBeGreaterThan(body.indexOf("getCurrentAdminUser()"));
    expect(body.indexOf("isAiConfigured()")).toBeGreaterThan(body.indexOf("canUseAiTools("));
    expect(body).toMatch(/catch \(error\)[\s\S]*SESSION_CHECK_FAILED/);
  });

  it("báo cáo kiểm canRunAiExecutiveReport và canReadSeason TRƯỚC khi đọc số liệu", () => {
    const actions = read("app", "actions", "ai-tools.ts");
    const body = actions.slice(actions.indexOf("export async function generateExecutiveReport"), actions.indexOf("export async function askIndustryTrend"));
    const roleAt = body.indexOf("canRunAiExecutiveReport(actor.role)");
    const seasonAt = body.indexOf("canReadSeason(");
    const loadAt = body.indexOf("loadExecutiveReportInput(");
    expect(roleAt).toBeGreaterThan(-1);
    expect(seasonAt).toBeGreaterThan(roleAt);
    expect(loadAt).toBeGreaterThan(seasonAt);
  });

  it("route xuất Word kiểm quyền trước khi đọc thân yêu cầu", () => {
    const route = read("app", "api", "ai-doc", "docx", "route.ts");
    const roleAt = route.indexOf("canUseAiTools(adminUser.role)");
    expect(roleAt).toBeGreaterThan(-1);
    expect(route.indexOf("request.formData()")).toBeGreaterThan(roleAt);
  });
});

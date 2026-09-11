/**
 * Ai được mời mentor/mentee lập tài khoản — và nav, trang, hàm mời nói cùng
 * một câu trả lời.
 *
 * support_team có mặt theo quyết định của chủ chương trình ngày 11/09/2026.
 * Việc mở cho họ KHÔNG được kéo theo quyền gửi thư hàng loạt tự soạn.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import { allNavHrefs, buildNavGroups } from "@/lib/nav-model";
import {
  canApproveEmailTemplate,
  canInviteParticipants,
  canSendBulkEmail,
  canViewOutboundEmails
} from "@/lib/permissions";

const ROOT = join(__dirname, "..");
const ROLES = ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"] as const;

const user = (role: (typeof ROLES)[number]) =>
  ({ id: "u", email: "u@vam.org", full_name: "U", role, status: "active", auth_user_id: null }) as CurrentAdminUser;

describe("vai trò", () => {
  it("bốn vai trò được mời; reviewer, viewer và người không vai trò thì không", () => {
    expect(ROLES.filter((role) => canInviteParticipants(role))).toEqual(["super_admin", "admin", "core_team", "support_team"]);
    for (const empty of ["", null, undefined]) expect(canInviteParticipants(empty)).toBe(false);
  });

  it("mở cho support_team KHÔNG mở quyền gửi thư tự soạn", () => {
    expect(canSendBulkEmail("support_team")).toBe(false);
    expect(canApproveEmailTemplate("support_team")).toBe(false);
    expect(canViewOutboundEmails("support_team")).toBe(false);
  });
});

describe("nav chỉ chào đúng người trang cho vào", () => {
  it.each([...ROLES])("%s", (role) => {
    const hrefs = allNavHrefs(buildNavGroups(user(role)));
    expect(hrefs.includes("/participant-accounts")).toBe(canInviteParticipants(role));
  });

  it("chưa đăng nhập thì không có mục này", () => {
    expect(allNavHrefs(buildNavGroups(null))).not.toContain("/participant-accounts");
  });
});

describe("trang và hàm mời tự gác cửa", () => {
  const page = readFileSync(join(ROOT, "app", "participant-accounts", "page.tsx"), "utf8");
  const invites = readFileSync(join(ROOT, "lib", "participant-invites.ts"), "utf8");

  it("trang chặn theo đúng predicate của nav", () => {
    expect(page).toMatch(/if \(!canInviteParticipants\(adminUser\.role\)\) redirect\(/);
  });

  it("trang kiểm quyền vận hành mùa TRƯỚC khi đọc danh sách", () => {
    const gateAt = page.indexOf("await authorizeParticipantInvites(");
    const rosterAt = page.indexOf("await loadLoginInviteRoster(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(rosterAt).toBeGreaterThan(gateAt);
  });

  it("hàm mời không còn đi qua thư của Supabase, không còn cổng cũ", () => {
    const code = invites.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("inviteUserByEmail");
    expect(code).not.toContain("canEditRecaps");
    expect(code).toMatch(/canOperateSeason\(/);
  });
});

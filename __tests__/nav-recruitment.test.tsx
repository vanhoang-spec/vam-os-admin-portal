// @vitest-environment jsdom
/**
 * Menu “Tuyển Mentor/Mentee” (BTC 06/10/2026). Nhóm “Ứng tuyển” cũ mở thêm từng
 * mục một nên rối; giờ ba tầng theo quy trình mỗi mùa:
 *
 *   Danh sách nhân sự tuyển sinh (chung, đứng đầu) · ▸ Tuyển Mentor · ▸ Tuyển Mentee · Ghép cặp
 *
 * Trang dùng chung cho cả hai vai trò được tách thành hai mục, mỗi mục mở sẵn bộ lọc
 * ?role_applied=. Ai thấy trang nào thì không đổi — kiểm ở nav-model.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import {
  MENTEE_RECRUITMENT_LABEL,
  MENTOR_RECRUITMENT_LABEL,
  RECRUITMENT_NAV_LABEL,
  activeNavHref,
  allNavLinks,
  buildNavGroups,
  isNavSubGroup,
  navModuleFor,
  type NavGroupDef
} from "@/lib/nav-model";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })
}));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/components/season-selector", () => ({ SeasonSelector: () => null }));

import { AppShell } from "@/components/app-shell";

const user = (role: CurrentAdminUser["role"]) =>
  ({ id: "u1", email: "u@example.test", full_name: null, role, status: "active", auth_user_id: null }) as CurrentAdminUser;

function recruitment(role: CurrentAdminUser["role"]): NavGroupDef | undefined {
  return buildNavGroups(user(role)).find((g) => g.key === "applications");
}

/** Cây menu gọn để so: link → nhãn; nhánh → [nhãn, nhãn các mục]. */
function shape(group: NavGroupDef | undefined) {
  return (group?.items ?? []).map((entry) => (isNavSubGroup(entry) ? [entry.label, entry.items.map((i) => i.label)] : entry.label));
}

afterEach(cleanup);

describe("cấu trúc theo vai trò", () => {
  // Thứ tự do BTC đọc từng mục (07/10/2026).
  it("Ban điều hành (admin): nhân sự chung ở đầu, hai nhánh theo thứ tự BTC chốt, Ghép cặp ở cuối", () => {
    const group = recruitment("admin");
    expect(group?.label).toBe(RECRUITMENT_NAV_LABEL);
    expect(shape(group)).toEqual([
      "Danh sách nhân sự tuyển sinh",
      [MENTOR_RECRUITMENT_LABEL, [
        "Báo cáo", "Hồ sơ mentor", "Gia hạn mentor S12", "Duyệt Mentor S12", "Giao hồ sơ mentor", "Đánh giá mentor",
        "Lịch phỏng vấn", "Thư xác nhận lịch PV cho mentor", "Phỏng vấn mentor", "Tiến độ phỏng vấn mentor",
        "Kết quả phỏng vấn Mentor S12"
      ]],
      [MENTEE_RECRUITMENT_LABEL, [
        "Báo cáo", "Hồ sơ mentee", "Giao hồ sơ mentee", "Đánh giá mentee",
        "Phiếu chấm & hướng dẫn mentee", "Tiến độ phỏng vấn mentee", "Ca phỏng vấn mentee",
        "Phỏng vấn mentee trực tiếp", "Duyệt Mentee S12", "Điểm cộng theo ngày nộp"
      ]],
      "Ghép cặp"
    ]);
  });

  it("“Phỏng vấn mentee trực tiếp” có mục con cho từng đợt (?dot= ngày đầu đợt)", () => {
    const mentee = (recruitment("support_team")?.items ?? []).find((e) => isNavSubGroup(e) && e.key === "mentee");
    const live = mentee && isNavSubGroup(mentee) ? mentee.items.find((i) => i.href === "/interviews/mentee-offline") : undefined;
    expect(live?.children).toEqual([
      { href: "/interviews/mentee-offline?dot=2026-10-03", label: "Đợt 1 · 03–04/10" },
      { href: "/interviews/mentee-offline?dot=2026-10-10", label: "Đợt 2 · 10–11/10" }
    ]);
  });

  it("“Báo cáo” của nhánh Mentee là trang báo cáo phỏng vấn theo đợt", () => {
    const mentee = (recruitment("core_team")?.items ?? []).find((e) => isNavSubGroup(e) && e.key === "mentee");
    const report = mentee && isNavSubGroup(mentee) ? mentee.items[0] : undefined;
    expect(report).toEqual({ href: "/interviews/bao-cao-mentee", label: "Báo cáo" });
  });

  it("“Báo cáo” của nhánh Mentor là trang báo cáo tuyển mentor, đứng đầu nhánh (BTC 08/10/2026)", () => {
    for (const role of ["support_team", "core_team", "admin", "super_admin"] as const) {
      const mentor = (recruitment(role)?.items ?? []).find((e) => isNavSubGroup(e) && e.key === "mentor");
      const report = mentor && isNavSubGroup(mentor) ? mentor.items[0] : undefined;
      expect(report).toEqual({ href: "/interviews/bao-cao-mentor", label: "Báo cáo" });
    }
  });

  it("mục dùng chung mở đúng bộ lọc vai trò của nhánh chứa nó", () => {
    const group = recruitment("super_admin")!;
    for (const entry of group.items ?? []) {
      if (!isNavSubGroup(entry)) continue;
      const role = entry.key;
      for (const item of entry.items) {
        if (!item.href.includes("role_applied=")) continue;
        expect(item.href).toMatch(new RegExp(`role_applied=${role}$`));
      }
    }
    expect(allNavLinks([group])).toEqual(expect.arrayContaining([
      "/applications?role_applied=mentor", "/applications?role_applied=mentee",
      "/reviews?role_applied=mentor", "/reviews?role_applied=mentee",
      "/reviews/assign-bulk?role_applied=mentor", "/reviews/assign-bulk?role_applied=mentee",
      "/interviews?role_applied=mentor"
    ]));
  });

  it("Ghép cặp không còn là mục riêng ở menu chính; Gia hạn mentor rời khỏi Quản trị", () => {
    const groups = buildNavGroups(user("super_admin"));
    expect(groups.find((g) => g.key === "matches")).toBeUndefined();
    const admin = groups.find((g) => g.key === "admin");
    expect(allNavLinks(admin ? [admin] : [])).not.toContain("/admin/renewals");
    expect(allNavLinks(groups).filter((h) => h === "/matches" || h === "/admin/renewals")).toHaveLength(2);
  });

  it("mentor phỏng vấn (reviewer): chỉ việc của mình, không nhân sự, không Ghép cặp", () => {
    expect(shape(recruitment("reviewer"))).toEqual([
      [MENTOR_RECRUITMENT_LABEL, ["Đánh giá mentor", "Lịch phỏng vấn", "Phỏng vấn mentor", "Kết quả phỏng vấn Mentor S12"]],
      [MENTEE_RECRUITMENT_LABEL, ["Đánh giá mentee", "Phỏng vấn mentee trực tiếp"]]
    ]);
  });

  it("support_team: không Đánh giá, không Phỏng vấn chung, không danh sách duyệt — như trước", () => {
    expect(shape(recruitment("support_team"))).toEqual([
      "Danh sách nhân sự tuyển sinh",
      [MENTOR_RECRUITMENT_LABEL, ["Báo cáo", "Hồ sơ mentor", "Giao hồ sơ mentor", "Tiến độ phỏng vấn mentor", "Kết quả phỏng vấn Mentor S12"]],
      [MENTEE_RECRUITMENT_LABEL, [
        "Báo cáo", "Hồ sơ mentee", "Giao hồ sơ mentee",
        "Tiến độ phỏng vấn mentee", "Ca phỏng vấn mentee", "Phỏng vấn mentee trực tiếp", "Điểm cộng theo ngày nộp"
      ]],
      "Ghép cặp"
    ]);
  });

  it("viewer và người chưa đăng nhập: không có nhóm này", () => {
    expect(recruitment("viewer")).toBeUndefined();
    expect(buildNavGroups(null).find((g) => g.key === "applications")).toBeUndefined();
  });
});

describe("mục đang mở: một mục, mục cụ thể nhất", () => {
  const groups = buildNavGroups(user("super_admin"));
  const active = (pathname: string, search = "") => activeNavHref(groups, pathname, search);

  it("danh sách duyệt không kéo theo mục Hồ sơ cùng tiền tố", () => {
    expect(active("/applications/mentor-review")).toBe("/applications/mentor-review");
  });

  it("cùng trang, khác bộ lọc: đúng mục của vai trò; không bộ lọc thì không mục nào", () => {
    expect(active("/reviews", "role_applied=mentee")).toBe("/reviews?role_applied=mentee");
    expect(active("/reviews", "?role_applied=mentor&page=2")).toBe("/reviews?role_applied=mentor");
    expect(active("/reviews")).toBeNull();
    expect(active("/applications", "role_applied=mentor")).toBe("/applications?role_applied=mentor");
  });

  it("trang con dài hơn thắng trang cha", () => {
    // Mục cha đứng TRƯỚC mục con trong cùng nhóm — mục khớp đầu tiên không được thắng.
    expect(active("/admin/users")).toBe("/admin/users");
    expect(active("/operations/mail")).toBe("/operations/mail");
    expect(active("/admin/renewals")).toBe("/admin/renewals");
    expect(active("/admin")).toBe("/admin");
    expect(active("/admin/seasons-forms/bonus-points")).toBe("/admin/seasons-forms/bonus-points");
    expect(active("/interviews/lich", "x=1")).toBe("/interviews/lich");
    expect(active("/reviews/assign-bulk", "intake_batch_id=b1&role_applied=mentee")).toBe("/reviews/assign-bulk?role_applied=mentee");
  });

  it("mục con theo đợt sáng khi URL có đúng ?dot=; không có thì mục cha sáng", () => {
    expect(active("/interviews/mentee-offline", "dot=2026-10-10")).toBe("/interviews/mentee-offline?dot=2026-10-10");
    expect(active("/interviews/mentee-offline", "dot=2026-10-03&application=x")).toBe("/interviews/mentee-offline?dot=2026-10-03");
    expect(active("/interviews/mentee-offline")).toBe("/interviews/mentee-offline");
    expect(navModuleFor(groups, "/interviews/mentee-offline?dot=2026-10-10")?.label).toBe(MENTEE_RECRUITMENT_LABEL);
  });

  it("hộp Hướng dẫn liệt kê trang của đúng nhánh", () => {
    expect(navModuleFor(groups, "/reviews?role_applied=mentee")?.label).toBe(MENTEE_RECRUITMENT_LABEL);
    expect(navModuleFor(groups, "/reviews/reviewer-pool")?.label).toBe(RECRUITMENT_NAV_LABEL);
    expect(navModuleFor(groups, "/operations/mail")?.label).toBe("Vận hành");
  });
});

describe("thanh menu vẽ ba tầng", () => {
  beforeEach(() => {
    nav.pathname = "/";
    nav.search = "";
  });

  function renderAt(pathname: string, search: string, role: CurrentAdminUser["role"] = "core_team") {
    nav.pathname = pathname;
    nav.search = search;
    render(<AppShell adminUser={user(role)}><p>nội dung</p></AppShell>);
    return within(screen.getByRole("navigation", { name: "Điều hướng chính" }));
  }

  it("ở Đánh giá mentee: mở nhóm và nhánh Mentee, đóng nhánh Mentor, đúng một mục sáng", () => {
    const sidebar = renderAt("/reviews", "role_applied=mentee");
    expect(sidebar.getByRole("button", { name: RECRUITMENT_NAV_LABEL }).getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.getByRole("button", { name: MENTEE_RECRUITMENT_LABEL }).getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.getByRole("button", { name: MENTOR_RECRUITMENT_LABEL }).getAttribute("aria-expanded")).toBe("false");
    const current = sidebar.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Đánh giá mentee", "/reviews?role_applied=mentee"]]);
    expect(sidebar.queryByRole("link", { name: "Hồ sơ mentor" })).toBeNull();
    expect(sidebar.getByRole("link", { name: "Ghép cặp" })).toBeTruthy();
  });

  it("bấm nhánh Tuyển Mentor thì mở ra các trang mentor", () => {
    const sidebar = renderAt("/reviews", "role_applied=mentee");
    fireEvent.click(sidebar.getByRole("button", { name: MENTOR_RECRUITMENT_LABEL }));
    expect(sidebar.getByRole("link", { name: "Hồ sơ mentor" }).getAttribute("href")).toBe("/applications?role_applied=mentor");
    expect(sidebar.getByRole("link", { name: "Gia hạn mentor S12" }).getAttribute("href")).toBe("/admin/renewals");
  });

  it("ở Duyệt Mentor S12: chỉ mục đó sáng, không sáng thêm Hồ sơ mentor", () => {
    const sidebar = renderAt("/applications/mentor-review", "");
    const current = sidebar.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Duyệt Mentor S12"]);
  });

  it("ở Đợt 2 của Phỏng vấn mentee trực tiếp: nhánh Mentee mở, đúng mục con sáng", () => {
    const sidebar = renderAt("/interviews/mentee-offline", "dot=2026-10-10", "support_team");
    expect(sidebar.getByRole("button", { name: MENTEE_RECRUITMENT_LABEL }).getAttribute("aria-expanded")).toBe("true");
    const current = sidebar.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Đợt 2 · 10–11/10", "/interviews/mentee-offline?dot=2026-10-10"]]);
    expect(sidebar.getByRole("link", { name: "Đợt 1 · 03–04/10" })).toBeTruthy();
  });

  it("menu chính không còn “Ứng tuyển”", () => {
    const sidebar = renderAt("/", "");
    expect(sidebar.queryByRole("button", { name: "Ứng tuyển" })).toBeNull();
    expect(sidebar.getByRole("button", { name: RECRUITMENT_NAV_LABEL })).toBeTruthy();
  });
});

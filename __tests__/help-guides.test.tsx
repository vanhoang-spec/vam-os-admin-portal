// @vitest-environment jsdom
/**
 * "Hướng dẫn sử dụng" theo từng trang (biểu tượng cuốn sách cạnh menu chính).
 *
 * Ca quan trọng nhất là ca đầu: MỌI trang trên menu (mọi vai trò) phải có hướng
 * dẫn RIÊNG — thêm trang mới mà quên viết hướng dẫn thì test này đỏ. Đó là cách
 * "hướng dẫn luôn cập nhật tính năng mới nhất" được giữ, không dựa vào trí nhớ.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => <a href={href} {...rest}>{children as never}</a> }));

import { HelpGuideButton } from "@/components/help-guide-button";
import { HELP_GUIDES } from "@/lib/help-guides";
import { helpGuideFor } from "@/lib/help-guides-core";
import { buildNavGroups, navItemsOf, navPath } from "@/lib/nav-model";
import type { CurrentAdminUser } from "@/lib/auth-constants";

const ROLES = ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"] as const;
const user = (role: (typeof ROLES)[number]) => ({ id: "u", email: "u@example.test", role, status: "active" }) as unknown as CurrentAdminUser;
const navHrefs = () => {
  const all = new Set<string>();
  for (const role of ROLES) {
    for (const g of buildNavGroups(user(role))) {
      if (g.href) all.add(g.href);
      for (const i of navItemsOf(g)) all.add(navPath(i.href));
    }
  }
  return Array.from(all).sort();
};

afterEach(cleanup);

describe("1. mọi trang trên menu có hướng dẫn riêng, đủ nội dung", () => {
  it("không trang nào trên menu (mọi vai trò) thiếu hướng dẫn RIÊNG", () => {
    const missing = navHrefs().filter((href) => !HELP_GUIDES[href]);
    expect(missing).toEqual([]);
  });
  it.each(Object.entries(HELP_GUIDES))("%s: có tên, mô tả, ≥ 2 bước, ngày cập nhật DD/MM/YYYY", (_key, g) => {
    expect(g.title.trim()).not.toBe("");
    expect(g.summary.trim().length).toBeGreaterThan(10);
    expect(g.steps.length).toBeGreaterThanOrEqual(2);
    for (const s of [...g.steps, ...(g.notes ?? [])]) expect(s.trim()).not.toBe("");
    expect(g.updated).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe("2. chọn hướng dẫn theo đường dẫn", () => {
  const guides = { "/": g("Tổng quan"), "/interviews": g("PV"), "/interviews/mentee-offline": g("PV trực tiếp") };
  function g(title: string) { return { title, summary: "x".repeat(20), steps: ["a", "b"], updated: "02/10/2026" }; }
  it("khoá dài nhất bao được đường dẫn thắng; trang con dùng hướng dẫn trang cha gần nhất", () => {
    expect(helpGuideFor("/interviews/mentee-offline", guides)?.guide.title).toBe("PV trực tiếp");
    expect(helpGuideFor("/interviews/mentee-offline/huong-dan", guides)?.guide.title).toBe("PV trực tiếp");
    expect(helpGuideFor("/interviews/lich", guides)?.guide.title).toBe("PV");
    expect(helpGuideFor("/interviews/mentee-offline?x=1", guides)?.guide.title).toBe("PV trực tiếp");
  });
  it("khớp theo đoạn đường dẫn, không theo tiền tố chữ; “/” chỉ khớp trang chủ", () => {
    expect(helpGuideFor("/interviewsx", guides)).toBeNull();
    expect(helpGuideFor("/", guides)?.guide.title).toBe("Tổng quan");
    expect(helpGuideFor("/people", guides)).toBeNull();
  });
});

describe("3. biểu tượng cuốn sách", () => {
  const groups = [
    { key: "applications", label: "Ứng tuyển", items: [{ href: "/interviews/mentee-offline", label: "Phỏng vấn mentee trực tiếp" }, { href: "/interviews/ca-mentee", label: "Ca phỏng vấn mentee" }] },
    { key: "matches", label: "Ghép cặp", href: "/matches" }
  ];
  it("rê chuột thấy “Hướng dẫn sử dụng”; bấm mở đúng hướng dẫn của trang + các trang trong module", () => {
    render(<HelpGuideButton pathname="/interviews/mentee-offline" navGroups={groups} />);
    const button = screen.getByRole("button", { name: "Hướng dẫn sử dụng" });
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe("Hướng dẫn sử dụng");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Hướng dẫn sử dụng" });
    expect(dialog.textContent).toContain(HELP_GUIDES["/interviews/mentee-offline"].title);
    expect(dialog.textContent).toContain(HELP_GUIDES["/interviews/mentee-offline"].steps[0]);
    const moduleNav = screen.getByRole("navigation", { name: "Các trang trong module Ứng tuyển" });
    const links = Array.from(moduleNav.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/interviews/mentee-offline", "/interviews/ca-mentee"]);
    expect(links[0].getAttribute("aria-current")).toBe("page");
    expect(links[1].getAttribute("aria-current")).toBeNull();
  });
  it("Esc và nút đóng đều đóng bảng hướng dẫn", () => {
    render(<HelpGuideButton pathname="/interviews/mentee-offline" navGroups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "Hướng dẫn sử dụng" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hướng dẫn sử dụng" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng hướng dẫn" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("trang chưa có hướng dẫn: nói rõ, không hiện hướng dẫn của trang khác", () => {
    render(<HelpGuideButton pathname="/khong-co-trang-nay" navGroups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "Hướng dẫn sử dụng" }));
    expect(screen.getByRole("dialog").textContent).toContain("Trang này chưa có hướng dẫn riêng");
  });
});

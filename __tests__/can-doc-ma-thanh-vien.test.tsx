// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanDocMaThanhVien } from "@/components/can-doc-ma-thanh-vien";
import { canBrowseParticipants } from "@/lib/read-access";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T03:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("thẻ mã thành viên mới", () => {
  it("hiện khi chưa đọc, bấm Đã đọc thì ẩn và không hiện lại", () => {
    const first = render(<CanDocMaThanhVien />);
    fireEvent.click(screen.getByRole("button", { name: "Đã đọc" }));
    expect(screen.queryByRole("heading")).toBeNull();
    first.unmount();
    render(<CanDocMaThanhVien />);
    expect(screen.queryByRole("heading")).toBeNull();
  });
  it("hiện đúng tiêu đề", () => {
    render(<CanDocMaThanhVien />);
    expect(screen.getByRole("heading").textContent).toContain("mã thành viên UEH mới đã sẵn sàng");
  });
  it("hết 30/11 giờ Việt Nam thì tự ẩn", () => {
    vi.setSystemTime(new Date("2026-11-30T17:00:01Z"));
    render(<CanDocMaThanhVien />);
    expect(screen.queryByRole("heading")).toBeNull();
  });
  it("có ở Công việc của tôi và Tổng quan, vì Support team không vào Công việc của tôi", () => {
    expect(source("app/my-work/page.tsx")).toContain("<CanDocMaThanhVien />");
    expect(source("app/page.tsx")).toContain("<CanDocMaThanhVien />");
  });
});

describe("thẻ mã thành viên mới không hiện cho vai không xem được danh sách Mentor (VAM00036)", () => {
  it("thẻ dẫn tới /mentors, trang đó chỉ mở cho vai canBrowseParticipants", () => {
    expect(source("components/can-doc-ma-thanh-vien.tsx")).toContain('href="/mentors"');
    expect(source("app/mentors/page.tsx")).toMatch(/!canBrowseParticipants\(routeUser\.role\)\) redirect\("\/"\)/);
  });
  it("viewer và reviewer không xem được danh sách người tham gia, support_team trở lên thì xem được", () => {
    expect(canBrowseParticipants("viewer")).toBe(false);
    expect(canBrowseParticipants("reviewer")).toBe(false);
    for (const role of ["support_team", "core_team", "admin", "super_admin"] as const) {
      expect(canBrowseParticipants(role)).toBe(true);
    }
  });
  it("Tổng quan: nhánh viewer/reviewer không có thẻ, nhánh đầy đủ vẫn có đúng một thẻ", () => {
    const page = source("app/page.tsx");
    const tach = page.indexOf('scopeContext.globalRole === "viewer" || scopeContext.globalRole === "reviewer"');
    expect(tach).toBeGreaterThan(-1);
    const nhanhHanChe = page.slice(tach, page.indexOf("getDashboardData(scope)", tach));
    expect(nhanhHanChe).toContain("<CanDocBaoLoi />");
    expect(nhanhHanChe).not.toContain("<CanDocMaThanhVien />");
    expect(page.split("<CanDocMaThanhVien />").length - 1).toBe(1);
    expect(page.slice(page.indexOf("getDashboardData(scope)"))).toContain("<CanDocMaThanhVien />");
  });
  it("Công việc của tôi: reviewer vào được trang nhưng thẻ chỉ hiện khi canBrowseParticipants", () => {
    const page = source("app/my-work/page.tsx");
    expect(page).toContain("{canBrowseParticipants(adminUser.role) ? <CanDocMaThanhVien /> : null}");
    expect(page.split("<CanDocMaThanhVien />").length - 1).toBe(1);
  });
});

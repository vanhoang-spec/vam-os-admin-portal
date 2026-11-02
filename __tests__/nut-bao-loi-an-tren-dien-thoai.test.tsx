// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/people",
  canXem: { traLoi: [] as unknown[], canBoSung: [] as unknown[] },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/app/actions/bao-loi", () => ({
  baoLoiCanXemAction: async () => state.canXem,
  daXemTraLoiAction: async () => undefined,
}));
vi.mock("@/components/bao-loi/form-bao-loi", () => ({ FormBaoLoi: () => null }));

import { NutBaoLoi } from "@/components/bao-loi/nut-bao-loi";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");
const tokens = (element: Element) => (element.getAttribute("class") ?? "").split(/[ ]+/).filter(Boolean);

beforeEach(() => {
  state.pathname = "/people";
  state.canXem = { traLoi: [], canBoSung: [] };
});
afterEach(cleanup);

describe("nút Báo lỗi chỉ hiện trên màn hình máy tính", () => {
  it("ẩn mặc định (điện thoại) và chỉ mở hiển thị từ lg trở lên", () => {
    render(<NutBaoLoi />);
    const nut = screen.getByRole("button", { name: /Báo lỗi/ });
    const lop = tokens(nut);
    expect(lop).toContain("hidden");
    expect(lop).toContain("lg:inline-flex");
    // Một lớp hiển thị không kèm tiền tố sẽ làm nút hiện lại trên điện thoại.
    for (const hienMacDinh of ["inline-flex", "flex", "block", "inline-block", "inline"]) {
      expect(lop).not.toContain(hienMacDinh);
    }
  });

  it("vẫn đặt cạnh thanh bên trên máy tính và không in ra giấy", () => {
    render(<NutBaoLoi />);
    const lop = tokens(screen.getByRole("button", { name: /Báo lỗi/ }));
    expect(lop).toContain("lg:left-[19.5rem]");
    expect(lop).toContain("print:hidden");
  });

  it("ở trang /bao-loi không có nút", () => {
    state.pathname = "/bao-loi";
    render(<NutBaoLoi />);
    expect(screen.queryByRole("button", { name: /Báo lỗi/ })).toBeNull();
  });

  it("pop-up người ta đang chờ vẫn hiện, không bị lớp ẩn của nút che", async () => {
    state.canXem = {
      traLoi: [],
      canBoSung: [{ id: "bl-1", ma: "VAM00099", tieuDe: "Tiêu đề thử", cauHoi: "Bạn bấm vào đâu?" }],
    };
    render(<NutBaoLoi />);
    const hop = await screen.findByRole("dialog", {}, { timeout: 4000 });
    expect(hop.textContent).toContain("VAM00099");
    expect(tokens(hop)).not.toContain("hidden");
    expect(screen.getByRole("button", { name: "Trả lời ngay" })).toBeTruthy();
  }, 8000);

  it("khung trang không còn chừa chỗ dưới cho nút đã ẩn (pb-20 chỉ cần khi nút hiện trên điện thoại)", () => {
    const nut = source("components/bao-loi/nut-bao-loi.tsx");
    const shell = source("components/app-shell.tsx");
    const lopCuaNut = (/className="([^"]*fixed bottom-3[^"]*)"/.exec(nut)?.[1] ?? "").split(" ");
    const nutAnTrenDienThoai = lopCuaNut.includes("hidden") && lopCuaNut.includes("lg:inline-flex");
    expect(nutAnTrenDienThoai).toBe(true);
    expect(shell).not.toMatch(/<main id="main-content"[^>]*\bpb-20\b/);
  });

  it("hướng dẫn nói rõ điện thoại dùng link /bao-loi", () => {
    expect(source("lib/help-guides.ts")).toContain("trên điện thoại (nút này được ẩn) mở link os.alumni-mentoring.edu.vn/bao-loi");
    expect(source("components/bao-loi/can-doc-bao-loi.tsx")).toContain("trên điện thoại");
  });
});

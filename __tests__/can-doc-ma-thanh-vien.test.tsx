// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanDocMaThanhVien } from "@/components/can-doc-ma-thanh-vien";

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
    expect(source("app/page.tsx").split("<CanDocMaThanhVien />").length - 1).toBe(2);
  });
});

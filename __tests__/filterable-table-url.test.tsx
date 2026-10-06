// @vitest-environment jsdom
/**
 * Menu mở cùng một trang với bộ lọc khác nhau: “Hồ sơ mentor” và “Hồ sơ mentee” đều
 * là /applications, khác ?role_applied= (BTC 06/10/2026). Chuyển giữa hai mục không
 * dựng lại bảng — bộ lọc phải theo URL mới, không thì bấm “Hồ sơ mentee” vẫn thấy
 * danh sách mentor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const url = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(url.search) }));

import { FilterableTable } from "@/components/filterable-table";

const ROWS = [
  { id: "1", name: "An Mentor", role_applied: "mentor" },
  { id: "2", name: "Bình Mentee", role_applied: "mentee" }
];

function table() {
  return (
    <FilterableTable
      rows={ROWS}
      columns={[{ key: "name", label: "Tên" }]}
      searchPlaceholder="Tìm"
      searchKeys={["name"]}
      filters={[{ key: "role_applied", label: "Vai trò ứng tuyển", valueKey: "role_applied" }]}
    />
  );
}

const names = () => ["An Mentor", "Bình Mentee"].filter((n) => screen.queryByText(n));

afterEach(() => {
  cleanup();
  url.search = "";
});

describe("bộ lọc của bảng theo URL", () => {
  it("mở với ?role_applied=mentor thì chỉ thấy mentor", () => {
    url.search = "role_applied=mentor";
    render(table());
    expect(names()).toEqual(["An Mentor"]);
  });

  it("chuyển sang ?role_applied=mentee mà bảng không dựng lại: bộ lọc theo URL mới", () => {
    url.search = "role_applied=mentor";
    const view = render(table());
    url.search = "role_applied=mentee";
    view.rerender(table());
    expect(names()).toEqual(["Bình Mentee"]);
  });

  it("bộ lọc người dùng tự chọn không bị URL ghi đè khi URL không đổi", () => {
    url.search = "role_applied=mentor";
    const view = render(table());
    // Ô lọc duy nhất của bảng (dòng đầu là “Vai trò ứng tuyển: Tất cả”).
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    view.rerender(table());
    expect(names()).toEqual(["An Mentor", "Bình Mentee"]);
  });
});

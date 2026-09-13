/** @vitest-environment jsdom */
/**
 * Nút "Thử lại" của trang lỗi phải TẢI LẠI trang, không chỉ vẽ lại.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO
 * ---------------------------------------------------------------------------
 * Lỗi hay gặp nhất ở trang này là tab mở từ trước một lần deploy: nút bấm trên
 * tab cũ không còn khớp với máy chủ mới. `reset()` vẽ lại bằng đúng bộ mã cũ nên
 * bấm bao nhiêu lần cũng rơi lại vào đây. 13/09/2026 một cú bấm trên
 * `/admin/users` ra trang lỗi mà không hề tới được máy chủ — log Supabase không
 * có yêu cầu nào — đúng dấu hiệu của trường hợp này.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/hard-reload", () => ({ hardReload: vi.fn() }));

import RootError from "@/app/error";
import { hardReload } from "@/lib/hard-reload";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(hardReload).mockClear();
});

describe("trang lỗi", () => {
  it("Thử lại tải lại hẳn trang, không gọi reset()", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();

    render(<RootError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(hardReload).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("chưa bấm thì chưa tải lại — trang lỗi không tự nhảy", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<RootError error={new Error("boom")} reset={vi.fn()} />);

    expect(hardReload).not.toHaveBeenCalled();
  });
});

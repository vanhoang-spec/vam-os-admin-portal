// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/forms",
  search: "",
  canXem: { traLoi: [] as unknown[], canBoSung: [] as unknown[] },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/app/actions/bao-loi", () => ({
  baoLoiCanXemAction: async () => state.canXem,
  daXemTraLoiAction: async () => undefined,
}));
vi.mock("@/components/bao-loi/form-bao-loi", () => ({
  FormBaoLoi: ({ trang, dong }: { trang: string; dong: () => void }) => (
    <div data-testid="hop-bao-loi" data-trang={trang}>
      <button type="button" onClick={dong}>
        Đóng hộp
      </button>
    </div>
  ),
}));

import { NutBaoLoi } from "@/components/bao-loi/nut-bao-loi";
import { NutBaoLoiTrenThanh } from "@/components/bao-loi/nut-bao-loi-tren-thanh";
import { MO_FORM_BAO_LOI } from "@/lib/bao-loi-su-kien";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");
const tokens = (element: Element) => (element.getAttribute("class") ?? "").split(/[ ]+/).filter(Boolean);

beforeEach(() => {
  state.pathname = "/forms";
  state.search = "";
  state.canXem = { traLoi: [], canBoSung: [] };
});
afterEach(cleanup);

describe("nút Báo lỗi trên thanh trên cùng, cạnh nút Hướng dẫn sử dụng (VAM00013)", () => {
  it("không nổi đè lên nội dung: không fixed, ẩn trên điện thoại và hiện từ sm", () => {
    render(<NutBaoLoiTrenThanh />);
    const lop = tokens(screen.getByRole("button", { name: /Báo lỗi/ }));
    expect(lop).toContain("hidden");
    expect(lop).toContain("sm:inline-flex");
    for (const khongDuoc of ["fixed", "absolute", "bottom-3", "inline-flex", "flex", "block"]) {
      expect(lop).not.toContain(khongDuoc);
    }
    expect(lop).toContain("print:hidden");
  });

  it("bấm thì bắn sự kiện mở hộp báo lỗi", () => {
    const nghe = vi.fn();
    window.addEventListener(MO_FORM_BAO_LOI, nghe);
    render(<NutBaoLoiTrenThanh />);
    fireEvent.click(screen.getByRole("button", { name: /Báo lỗi/ }));
    window.removeEventListener(MO_FORM_BAO_LOI, nghe);
    expect(nghe).toHaveBeenCalledTimes(1);
  });

  it("ở trang /bao-loi không có nút", () => {
    state.pathname = "/bao-loi";
    render(<NutBaoLoiTrenThanh />);
    expect(screen.queryByRole("button", { name: /Báo lỗi/ })).toBeNull();
  });
});

describe("hộp báo lỗi ở cuối AppShell", () => {
  it("không còn nút nổi góc dưới trái", () => {
    render(<NutBaoLoi />);
    expect(screen.queryByRole("button", { name: /Báo lỗi/ })).toBeNull();
    expect(source("components/bao-loi/nut-bao-loi.tsx")).not.toContain("fixed bottom-3");
  });

  it("nhận sự kiện từ nút và mở hộp với ĐÚNG trang đang xem, kèm tham số trên địa chỉ", () => {
    state.search = "tab=mau&q=1";
    render(<NutBaoLoi />);
    expect(screen.queryByTestId("hop-bao-loi")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event(MO_FORM_BAO_LOI));
    });
    expect(screen.getByTestId("hop-bao-loi").getAttribute("data-trang")).toBe("/forms?tab=mau&q=1");
  });

  it("đổi trang rồi bấm lại thì ghi trang mới, không giữ trang cũ", () => {
    const { rerender } = render(<NutBaoLoi />);
    act(() => {
      window.dispatchEvent(new Event(MO_FORM_BAO_LOI));
    });
    expect(screen.getByTestId("hop-bao-loi").getAttribute("data-trang")).toBe("/forms");
    fireEvent.click(screen.getByRole("button", { name: "Đóng hộp" }));
    expect(screen.queryByTestId("hop-bao-loi")).toBeNull();

    state.pathname = "/people";
    rerender(<NutBaoLoi />);
    act(() => {
      window.dispatchEvent(new Event(MO_FORM_BAO_LOI));
    });
    expect(screen.getByTestId("hop-bao-loi").getAttribute("data-trang")).toBe("/people");
  });

  it("gỡ nghe sự kiện khi rời trang: không mở hộp ở thành phần đã gỡ", () => {
    const { unmount } = render(<NutBaoLoi />);
    unmount();
    act(() => {
      window.dispatchEvent(new Event(MO_FORM_BAO_LOI));
    });
    expect(screen.queryByTestId("hop-bao-loi")).toBeNull();
  });

  it("pop-up người ta đang chờ vẫn hiện ở mọi cỡ màn hình", async () => {
    state.canXem = {
      traLoi: [],
      canBoSung: [{ id: "bl-1", ma: "VAM00099", tieuDe: "Tiêu đề thử", cauHoi: "Bạn bấm vào đâu?" }],
    };
    render(<NutBaoLoi />);
    const hop = await screen.findByRole("dialog", {}, { timeout: 4000 });
    expect(hop.textContent).toContain("VAM00099");
    expect(tokens(hop)).not.toContain("hidden");
  }, 8000);
});

describe("chỗ đặt trong AppShell", () => {
  const shell = source("components/app-shell.tsx");

  it("nút nằm ngay sau nút Hướng dẫn sử dụng, trong thanh trên cùng", () => {
    const huongDan = shell.indexOf("<HelpGuideButton");
    const nut = shell.indexOf("<NutBaoLoiTrenThanh />");
    const dongThanh = shell.indexOf("</header>");
    expect(huongDan).toBeGreaterThan(0);
    expect(nut).toBeGreaterThan(huongDan);
    expect(nut).toBeLessThan(dongThanh);
    // Không có phần tử nào xen giữa hai nút ngoài chú thích.
    const giua = shell.slice(shell.indexOf("/>", huongDan) + 2, nut).replace(/\{\/\*[^]*?\*\/\}/g, "").trim();
    expect(giua).toBe("");
  });

  it("hộp báo lỗi nằm NGOÀI thanh trên cùng, vì thanh có backdrop-blur làm khung chứa của phần tử fixed", () => {
    expect(shell).toMatch(/<header[^>]*backdrop-blur/);
    expect(shell.indexOf("<NutBaoLoi />")).toBeGreaterThan(shell.indexOf("</header>"));
  });

  it("khung trang không chừa chỗ đáy cho nút nổi cũ", () => {
    expect(shell).not.toMatch(/<main id="main-content"[^>]*\bpb-20\b/);
  });

  it("hướng dẫn và thẻ Cần đọc chỉ đúng chỗ mới của nút", () => {
    const huongDan = source("lib/help-guides.ts");
    expect(huongDan).toContain("ở thanh trên cùng, cạnh nút Hướng dẫn sử dụng");
    expect(huongDan).not.toContain("ở góc dưới bên trái");
    const canDoc = source("components/bao-loi/can-doc-bao-loi.tsx");
    expect(canDoc).toContain("thanh trên cùng, cạnh nút Hướng dẫn sử dụng");
    expect(canDoc).not.toContain("góc dưới bên trái");
  });
});

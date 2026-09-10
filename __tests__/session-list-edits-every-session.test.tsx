/** @vitest-environment jsdom */
/**
 * Sửa được giờ của MỌI buổi, kể cả buổi đầu.
 *
 * ---------------------------------------------------------------------------
 * CHUYỆN ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * Người vận hành mở màn hình chuỗi ra để dời giờ buổi 1, và không tìm thấy chỗ
 * nào làm được. Trên màn hình chỉ có đúng một ô ngày giờ — ô "Bắt đầu buổi mới"
 * của phần thêm buổi — nên kết luận rất tự nhiên là chỉ sửa được buổi sau.
 *
 * Về lý thì mỗi buổi là một dòng sự kiện riêng và mở trang của nó ra là sửa
 * được. Nhưng một khả năng không có chỗ nào chỉ ra thì không tồn tại đối với
 * người dùng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/events", () => ({
  addEventSessionAction: vi.fn(),
  removeEventSessionAction: vi.fn(),
  updateEventSessionTimeAction: vi.fn()
}));

const mockUseFormStatus = vi.fn();
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Mỗi form giữ trạng thái riêng, nên bản giả trả về đúng trạng thái ban
    // đầu và chính hàm được truyền vào — không gộp chung các form lại.
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => mockUseFormStatus()
  };
});

import { AddSessionPanel } from "@/app/events/[id]/add-session-panel";
import type { SeriesSession } from "@/lib/events";

const EVENT = "00000000-0000-4000-8000-0000000000aa";

function session(overrides: Partial<SeriesSession> = {}): SeriesSession {
  return {
    id: "s1",
    seriesIndex: 1,
    startsAt: "2026-09-20T00:00:00.000Z",
    endsAt: "2026-09-20T06:00:00.000Z",
    status: "scheduled",
    registrationCount: 0,
    isCurrent: false,
    ...overrides
  };
}

const SESSIONS: SeriesSession[] = [
  session({ id: EVENT, seriesIndex: 1, isCurrent: true }),
  session({
    id: "s2",
    seriesIndex: 2,
    startsAt: "2026-09-27T00:00:00.000Z",
    endsAt: "2026-09-27T06:00:00.000Z"
  })
];

function panel(sessions: SeriesSession[] = SESSIONS) {
  return render(
    <AddSessionPanel
      eventId={EVENT}
      startsAt="2026-09-20T00:00:00.000Z"
      endsAt="2026-09-20T06:00:00.000Z"
      seriesIndex={1}
      seriesTotal={2}
      sessions={sessions}
    />
  );
}

beforeEach(() => {
  mockUseFormStatus.mockReturnValue({ pending: false });
});
afterEach(cleanup);

describe("mỗi buổi đều có đường sửa giờ", () => {
  it("BUỔI ĐANG XEM cũng có nút sửa giờ", () => {
    // Đây là ca tái hiện lỗi: buổi đầu là buổi đang mở, và trước đây nó là
    // buổi duy nhất KHÔNG có đường nào để sửa giờ ngay tại chỗ.
    panel();

    const rows = screen.getAllByRole("listitem");
    const current = rows.find((row) => within(row).queryByText("đang xem"));
    expect(current, "không tìm thấy dòng của buổi đang xem").toBeTruthy();
    expect(within(current!).getByRole("button", { name: "Sửa giờ" })).toBeTruthy();
  });

  it("mọi buổi trong chuỗi đều có nút sửa giờ", () => {
    panel();
    expect(screen.getAllByRole("button", { name: "Sửa giờ" })).toHaveLength(2);
  });

  it("buổi đã có người đăng ký vẫn sửa được giờ — dời lịch là chuyện có thật", () => {
    panel([
      session({ id: EVENT, seriesIndex: 1, isCurrent: true, registrationCount: 12 }),
      session({ id: "s2", seriesIndex: 2 })
    ]);

    const rows = screen.getAllByRole("listitem");
    const busy = rows.find((row) => within(row).queryByText(/12 người đã đăng ký/));
    expect(busy).toBeTruthy();
    // Không xoá được, nhưng vẫn dời được giờ.
    expect(within(busy!).queryByRole("button", { name: /Xoá buổi/ })).toBeNull();
    expect(within(busy!).getByRole("button", { name: "Sửa giờ" })).toBeTruthy();
  });
});

describe("ô sửa giờ", () => {
  it("đóng sẵn, mở ra khi bấm", () => {
    panel();
    // Đóng sẵn: hai ô ngày giờ duy nhất lúc đầu là của phần "Thêm buổi".
    expect(screen.queryByLabelText(/Buổi 1 bắt đầu — ngày/)).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Sửa giờ" })[0]);
    expect(screen.getByLabelText(/Buổi 1 bắt đầu — ngày/)).toBeTruthy();
  });

  it("mở ra với đúng giờ hiện tại của buổi đó, theo giờ Việt Nam", () => {
    panel();
    fireEvent.click(screen.getAllByRole("button", { name: "Sửa giờ" })[0]);

    // 00:00Z ngày 20/09 là 07:00 giờ Việt Nam.
    expect(screen.getByLabelText(/Buổi 1 bắt đầu — ngày/)).toHaveProperty("value", "20/09/2026");
    expect(screen.getByLabelText(/Buổi 1 bắt đầu — giờ/)).toHaveProperty("value", "07:00");
    expect(screen.getByLabelText(/Buổi 1 kết thúc — giờ/)).toHaveProperty("value", "13:00");
  });

  it("gửi kèm id của CHÍNH buổi đó, không phải buổi đang mở", () => {
    panel();
    // Mở ô của buổi 2 — buổi không phải buổi đang xem.
    fireEvent.click(screen.getAllByRole("button", { name: "Sửa giờ" })[1]);

    // Phải soi đúng FORM SỬA GIỜ. Dòng nào cũng có sẵn một form xoá mang cùng
    // id, nên một phép tìm chung cả trang sẽ xanh kể cả khi form sửa giờ đang
    // gửi nhầm id — và gửi nhầm id nghĩa là sửa giờ của buổi khác.
    const editForm = Array.from(document.querySelectorAll("form")).find(
      (form) =>
        form.querySelector('input[name="starts_at"]') &&
        form.querySelector('input[name="session_id"]')
    );
    expect(editForm, "không tìm thấy form sửa giờ").toBeTruthy();
    expect(editForm!.querySelector('input[name="session_id"]')).toHaveProperty("value", "s2");
  });

  it("bấm lần nữa thì đóng lại", () => {
    panel();
    const toggle = screen.getAllByRole("button", { name: "Sửa giờ" })[0];
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/Buổi 1 bắt đầu — ngày/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Thôi" }));
    expect(screen.queryByLabelText(/Buổi 1 bắt đầu — ngày/)).toBeNull();
  });

  it("mở một buổi không mở luôn buổi còn lại", () => {
    panel();
    fireEvent.click(screen.getAllByRole("button", { name: "Sửa giờ" })[0]);

    expect(screen.getByLabelText(/Buổi 1 bắt đầu — ngày/)).toBeTruthy();
    expect(screen.queryByLabelText(/Buổi 2 bắt đầu — ngày/)).toBeNull();
  });
});

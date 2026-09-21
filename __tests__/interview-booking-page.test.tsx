/** @vitest-environment jsdom */
/**
 * __tests__/interview-booking-page.test.tsx
 *
 * Form đặt lịch công khai (client) + các khẳng định tĩnh giữ trang đứng vững:
 * React 18 dùng useFormState của react-dom (useActionState qua được cả bốn
 * cổng rồi mới vỡ trắng trang), và URL mang mã riêng nên middleware phải phát
 * no-store cho nhãn interview_booking.
 */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./../app/dat-lich/[token]/actions", () => ({
  bookInterviewSlotAction: vi.fn(async () => ({})),
  cancelInterviewBookingAction: vi.fn(async () => ({}))
}));

// Trạng thái form điều khiển được theo từng ca test.
const formStateHolder: { value: { status: string; message: string; slotLabel: string | null } } = {
  value: { status: "idle", message: "", slotLabel: null }
};

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [formStateHolder.value, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});

import { BookingForm, CancelBookingForm } from "@/app/dat-lich/[token]/booking-form";

const DAYS = [
  {
    dateKey: "2026-09-24",
    label: "Thứ Năm 24/09/2026",
    hours: [
      { startsAtIso: "2026-09-24T02:00:00.000Z", hour: 9, openCount: 2 },
      { startsAtIso: "2026-09-24T03:00:00.000Z", hour: 10, openCount: 1 }
    ]
  },
  {
    dateKey: "2026-09-26",
    label: "Thứ Bảy 26/09/2026",
    hours: [{ startsAtIso: "2026-09-26T08:00:00.000Z", hour: 15, openCount: 3 }]
  }
];

afterEach(cleanup);

beforeEach(() => {
  formStateHolder.value = { status: "idle", message: "", slotLabel: null };
});

describe("1. lưới chọn giờ", () => {
  it("vẽ đủ ngày, giờ và số chỗ trống từng khung", () => {
    render(<BookingForm token="ma-rieng" days={DAYS} />);
    expect(screen.getByText("Thứ Năm 24/09/2026")).toBeTruthy();
    expect(screen.getByText("Thứ Bảy 26/09/2026")).toBeTruthy();
    expect(screen.getByText("· còn 2")).toBeTruthy();
    expect(screen.getByText("· còn 3")).toBeTruthy();
  });

  it("chưa chọn giờ thì nút Giữ chỗ bị khoá; chọn rồi thì mở và ô ẩn mang đúng giờ", () => {
    const { container } = render(<BookingForm token="ma-rieng" days={DAYS} />);
    const submit = screen.getByRole("button", { name: "Giữ chỗ khung giờ đã chọn" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /15:00/ }));
    expect(submit.disabled).toBe(false);
    const hidden = container.querySelector('input[name="slotStartsAt"]') as HTMLInputElement;
    expect(hidden.value).toBe("2026-09-26T08:00:00.000Z");
    // Mã riêng đi kèm trong ô ẩn — action không đọc được từ URL.
    const token = container.querySelector('input[name="token"]') as HTMLInputElement;
    expect(token.value).toBe("ma-rieng");
  });

  it("trượt slot: câu 'vừa có người giữ trước' hiện ngay cạnh lưới, form vẫn còn để chọn lại", () => {
    formStateHolder.value = {
      status: "error",
      message: "Khung giờ này vừa có người giữ trước — anh/chị chọn giờ khác nhé.",
      slotLabel: null
    };
    render(<BookingForm token="ma-rieng" days={DAYS} />);
    expect(screen.getByRole("alert").textContent).toContain("vừa có người giữ trước");
    expect(screen.getByRole("button", { name: "Giữ chỗ khung giờ đã chọn" })).toBeTruthy();
  });

  it("giữ chỗ xong: thẻ xanh thay chỗ lưới, mang nhãn buổi hẹn", () => {
    formStateHolder.value = {
      status: "success",
      message: "Đã giữ chỗ.",
      slotLabel: "Thứ Bảy 26/09/2026, 15:00–16:00 (giờ Việt Nam)"
    };
    render(<BookingForm token="ma-rieng" days={DAYS} />);
    expect(screen.getByText("Đã giữ chỗ thành công")).toBeTruthy();
    expect(screen.getByText("Thứ Bảy 26/09/2026, 15:00–16:00 (giờ Việt Nam)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Giữ chỗ khung giờ đã chọn" })).toBeNull();
  });
});

describe("2. form huỷ của mentor", () => {
  it("có nút huỷ; lỗi (ví dụ trong 24 giờ) hiện thành cảnh báo", () => {
    formStateHolder.value = {
      status: "error",
      message: "Buổi hẹn còn dưới 24 giờ nên không tự huỷ được nữa",
      slotLabel: null
    };
    render(<CancelBookingForm token="ma-rieng" />);
    expect(screen.getByRole("button", { name: "Huỷ lịch hẹn này" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("dưới 24 giờ");
  });
});

describe("3. khẳng định tĩnh trên mã nguồn", () => {
  it("form dùng useFormState của react-dom — không phải useActionState của react", () => {
    const source = readFileSync("app/dat-lich/[token]/booking-form.tsx", "utf8");
    expect(source).toContain('from "react-dom"');
    expect(source).toContain("useFormState");
    expect(source).not.toContain("useActionState");
  });

  it("trang server tự đọc lại theo nhịp LiveRefresh và luôn render động", () => {
    const source = readFileSync("app/dat-lich/[token]/page.tsx", "utf8");
    expect(source).toContain("LiveRefresh");
    expect(source).toContain('dynamic = "force-dynamic"');
  });

  it("middleware phát no-store cho nhãn interview_booking — URL mang mã riêng của một người", () => {
    const source = readFileSync("middleware.ts", "utf8");
    const guard = source.indexOf('publicRoute === "interview_booking"');
    expect(guard).toBeGreaterThan(-1);
    // Nhãn phải nằm trong đúng câu điều kiện phát Cache-Control no-store.
    const window = source.slice(Math.max(0, guard - 300), guard + 500);
    expect(window).toContain("no-store");
  });
});

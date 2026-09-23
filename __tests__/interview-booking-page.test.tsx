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
  cancelInterviewBookingAction: vi.fn(async () => ({})),
  saveMentorAvailabilityAction: vi.fn(async () => ({}))
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
import { MentorAvailabilityForm } from "@/app/dat-lich/[token]/mentor-availability-form";

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

// ─────────────────────────────────────────────────────────────────────────────
// Chiều ngược: mentor tự khai giờ mình rảnh
// ─────────────────────────────────────────────────────────────────────────────

const AVAIL_DAYS = [
  {
    dateKey: "2026-09-24",
    label: "Thứ Năm 24/09/2026",
    slots: [
      { startsAtIso: "2026-09-24T00:00:00.000Z", hour: 7, isPast: true },
      { startsAtIso: "2026-09-24T02:00:00.000Z", hour: 9, isPast: false },
      { startsAtIso: "2026-09-24T03:00:00.000Z", hour: 10, isPast: false }
    ]
  },
  {
    // Ngày mà mọi giờ đều đã trôi qua — không được hiện ra làm dài trang.
    dateKey: "2026-09-25",
    label: "Thứ Sáu 25/09/2026",
    slots: [{ startsAtIso: "2026-09-25T00:00:00.000Z", hour: 7, isPast: true }]
  }
];

describe("4. lưới mentor tự khai giờ rảnh", () => {
  function hidden(container: HTMLElement) {
    return {
      add: JSON.parse((container.querySelector('input[name="add"]') as HTMLInputElement).value) as string[],
      remove: JSON.parse((container.querySelector('input[name="remove"]') as HTMLInputElement).value) as string[]
    };
  }

  /** Bản sao mới tinh của cùng dữ liệu — đúng thứ router.refresh() trả về. */
  const freshDays = () => AVAIL_DAYS.map((day) => ({ ...day, slots: day.slots.map((slot) => ({ ...slot })) }));

  it("chỉ hiện ngày còn giờ chưa trôi qua, và giờ đã qua không có nút để bấm", () => {
    render(<MentorAvailabilityForm token="tok" days={AVAIL_DAYS} mine={[]} />);
    expect(screen.getByText("Thứ Năm 24/09/2026")).toBeTruthy();
    expect(screen.queryByText("Thứ Sáu 25/09/2026")).toBeNull();
    expect(screen.queryByLabelText("Thứ Năm 24/09/2026 07:00")).toBeNull();
  });

  it("phần chênh nằm trong ô ẩn: tick giờ mới → add, bỏ giờ đã khai → remove", () => {
    const { container } = render(
      <MentorAvailabilityForm token="tok" days={AVAIL_DAYS} mine={["2026-09-24T02:00:00.000Z"]} />
    );
    expect(hidden(container)).toEqual({ add: [], remove: [] });

    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 10:00"));
    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 09:00"));
    expect(hidden(container)).toEqual({
      add: ["2026-09-24T03:00:00.000Z"],
      remove: ["2026-09-24T02:00:00.000Z"]
    });
  });

  it("trang tự làm mới không được xoá ô vừa tick — cùng lỗi đã sửa ở lưới interviewer", () => {
    const { container, rerender } = render(<MentorAvailabilityForm token="tok" days={AVAIL_DAYS} mine={[]} />);
    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 10:00"));
    rerender(<MentorAvailabilityForm token="tok" days={freshDays()} mine={[]} />);
    expect(hidden(container).add).toEqual(["2026-09-24T03:00:00.000Z"]);
  });

  it("nút lưu nói rõ đây là khai giờ rảnh, không phải giữ chỗ", () => {
    render(<MentorAvailabilityForm token="tok" days={AVAIL_DAYS} mine={[]} />);
    expect(screen.getByRole("button", { name: "Lưu giờ tôi rảnh" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Giữ chỗ/ })).toBeNull();
  });
});

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

  it("bề mặt mentor gọi đúng tên việc: trao đổi với core team, không phải phỏng vấn", () => {
    // Chủ dự án chốt 23/09/2026. Thư gửi mentor đã đổi chữ; trang họ bấm vào
    // TỪ CHÍNH LÁ THƯ ĐÓ phải nói cùng một thứ tiếng, nếu không người đọc
    // tưởng đây là hai việc khác nhau. Quét nguồn chứ không render: một chuỗi
    // nằm trong nhánh hiếm (đã có lịch, hết hạn huỷ) vẫn phải đúng.
    for (const file of [
      "app/dat-lich/[token]/page.tsx",
      "app/dat-lich/[token]/booking-form.tsx",
      "app/dat-lich/[token]/mentor-availability-form.tsx"
    ]) {
      expect(readFileSync(file, "utf8"), `${file} còn chữ "phỏng vấn"`).not.toContain("hỏng vấn");
    }

    // Hai câu máy chủ trả về cho chính trang này — nằm chung file với các câu
    // gửi interviewer, nên ghim từng câu thay vì quét cả file.
    const lib = readFileSync("lib/interview-schedule.ts", "utf8");
    expect(lib).toContain("Anh/chị đã có một lịch trao đổi đang hiệu lực");
    expect(lib).toContain("Buổi trao đổi này đã có kết quả nên không huỷ được");
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

describe("4. mentor chọn một giờ rảnh", () => {
  const H09 = "2026-09-24T02:00:00.000Z";
  const H10 = "2026-09-24T03:00:00.000Z";

  function picked(container: HTMLElement) {
    return (container.querySelector('input[name="slotStartsAt"]') as HTMLInputElement).value;
  }

  /** Bản sao mới tinh của cùng dữ liệu — đúng thứ router.refresh() trả về. */
  const freshDays = () => AVAIL_DAYS.map((day) => ({ ...day, slots: day.slots.map((slot) => ({ ...slot })) }));

  it("chỉ hiện ngày còn giờ chưa trôi qua, và giờ đã qua không có nút để bấm", () => {
    render(<MentorAvailabilityForm token="tok" days={AVAIL_DAYS} chosen={null} />);
    expect(screen.getByText("Thứ Năm 24/09/2026")).toBeTruthy();
    expect(screen.queryByText("Thứ Sáu 25/09/2026")).toBeNull();
    expect(screen.queryByLabelText("Thứ Năm 24/09/2026 07:00")).toBeNull();
  });

  it("chọn ô khác là THAY chứ không cộng thêm — một lần chỉ một giờ", () => {
    const { container } = render(<MentorAvailabilityForm token="tok" days={AVAIL_DAYS} chosen={null} />);
    expect(picked(container)).toBe("");

    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 09:00"));
    expect(picked(container)).toBe(H09);

    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 10:00"));
    expect(picked(container)).toBe(H10);
    // Ô cũ phải thôi được nhấn — nếu cả hai cùng nhấn thì màn hình đang hứa
    // một thứ mà database không cho.
    expect(screen.getByLabelText("Thứ Năm 24/09/2026 09:00").getAttribute("aria-pressed")).toBe("false");
  });

  it("bấm lại đúng ô đang chọn là bỏ chọn", () => {
    const { container } = render(<MentorAvailabilityForm token="tok" days={AVAIL_DAYS} chosen={null} />);
    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 09:00"));
    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 09:00"));
    expect(picked(container)).toBe("");
    expect(screen.getByRole("button", { name: "Bỏ giờ đã chọn" })).toBeTruthy();
  });

  it("đang chờ một giờ thì trang nói rõ, và nút chuyển thành đổi giờ", () => {
    render(<MentorAvailabilityForm token="tok" days={AVAIL_DAYS} chosen={H09} />);
    expect(screen.getByText(/đang chờ được ghép vào/)).toBeTruthy();
    // Chưa đổi gì thì không có gì để lưu.
    expect((screen.getByRole("button", { name: "Chọn giờ này" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 10:00"));
    expect((screen.getByRole("button", { name: "Đổi sang giờ này" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("trang tự làm mới không được xoá ô vừa chọn — cùng lỗi đã sửa ở lưới interviewer", () => {
    const { container, rerender } = render(
      <MentorAvailabilityForm token="tok" days={AVAIL_DAYS} chosen={null} />
    );
    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 10:00"));
    rerender(<MentorAvailabilityForm token="tok" days={freshDays()} chosen={null} />);
    expect(picked(container)).toBe(H10);
  });

  it("chữ trên màn hình không được nghe như đã giữ chỗ", () => {
    render(<MentorAvailabilityForm token="tok" days={AVAIL_DAYS} chosen={null} />);
    expect(screen.getByText(/Mỗi lần chỉ chọn được một khung giờ/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Giữ chỗ/ })).toBeNull();
  });
});

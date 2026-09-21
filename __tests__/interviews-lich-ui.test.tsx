/** @vitest-environment jsdom */
/**
 * __tests__/interviews-lich-ui.test.tsx
 *
 * Hai mảnh client của trang Lịch phỏng vấn: lưới giờ rảnh của interviewer
 * (tick/gỡ, ô đã đặt bị khoá, ô quá khứ mờ, phần chênh add/remove nằm trong ô
 * ẩn) và bảng điều hành ban tổ chức (vòng tự gửi chạy ngay khi mở tab, huỷ
 * lịch phải qua hộp thoại xác nhận).
 */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const availabilityState: { value: { status: string; message: string; blockedRemovals: string[] } } = {
  value: { status: "idle", message: "", blockedRemovals: [] }
};

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [availabilityState.value, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});
vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ refresh: vi.fn() })) }));
vi.mock("@/app/actions/interview-schedule", () => ({
  saveInterviewerAvailabilityAction: vi.fn(async () => ({})),
  runInterviewDispatchAction: vi.fn(async () => ({
    ok: true,
    message: "Đã gửi 0 thư.",
    sent: 0,
    failed: 0,
    remaining: 0,
    stopped429: false
  })),
  cancelBookingByBtcAction: vi.fn(async () => ({ ok: true, message: "Đã huỷ." }))
}));

import { AvailabilityGrid } from "@/app/interviews/lich/availability-grid";
import { BtcPanel } from "@/app/interviews/lich/btc-panel";
import { cancelBookingByBtcAction, runInterviewDispatchAction } from "@/app/actions/interview-schedule";

const DAYS = [
  {
    dateKey: "2026-09-24",
    label: "Thứ Năm 24/09/2026",
    slots: [
      { startsAtIso: "2026-09-24T00:00:00.000Z", hour: 7, isPast: true, mine: null, candidateName: null },
      { startsAtIso: "2026-09-24T02:00:00.000Z", hour: 9, isPast: false, mine: "open" as const, candidateName: null },
      {
        startsAtIso: "2026-09-24T03:00:00.000Z",
        hour: 10,
        isPast: false,
        mine: "booked" as const,
        candidateName: "Nguyễn Văn A"
      },
      { startsAtIso: "2026-09-24T04:00:00.000Z", hour: 11, isPast: false, mine: null, candidateName: null }
    ]
  }
];

const STATS = { total: 2, done: 0, bookedUpcoming: 1, open: 1, expired: 0 };

const OVERVIEW = {
  openFutureHours: 5,
  mentors: { eligibleTotal: 90, notBooked: 80, bookedUpcoming: 9, bookedPast: 1 },
  invitesDueNow: 12,
  perInterviewer: [
    {
      adminUserId: "iv-1",
      name: "Chị Core Team",
      phone: "0912345678",
      stats: { total: 4, done: 1, bookedUpcoming: 1, open: 2, expired: 0 }
    }
  ],
  upcomingBookings: [
    {
      bookingId: "b1",
      slotStartsAtIso: "2026-09-26T08:00:00.000Z",
      slotLabel: "Thứ Bảy 26/09/2026, 15:00–16:00 (giờ Việt Nam)",
      candidateName: "Nguyễn Văn A",
      candidateEmail: "a@example.com",
      interviewerName: "Chị Core Team"
    }
  ]
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  availabilityState.value = { status: "idle", message: "", blockedRemovals: [] };
});

describe("1. lưới giờ rảnh", () => {
  function hiddenValues(container: HTMLElement) {
    return {
      add: JSON.parse((container.querySelector('input[name="add"]') as HTMLInputElement).value) as string[],
      remove: JSON.parse((container.querySelector('input[name="remove"]') as HTMLInputElement).value) as string[]
    };
  }

  it("ô quá khứ bị khoá, ô đã đặt thành huy hiệu mang tên mentor", () => {
    const { container } = render(<AvailabilityGrid days={DAYS} phone="" needsPhone stats={STATS} />);
    const past = screen.getByLabelText("Thứ Năm 24/09/2026 07:00") as HTMLInputElement;
    expect(past.disabled).toBe(true);
    // Ô 10:00 không còn là checkbox — nó là huy hiệu "Đặt" mang tên trong title.
    expect(screen.queryByLabelText("Thứ Năm 24/09/2026 10:00")).toBeNull();
    expect(screen.getByTitle(/Nguyễn Văn A/)).toBeTruthy();
    // SĐT bắt buộc lần đầu được nói rõ ngay trên nhãn.
    expect(screen.getByText(/bắt buộc trước lần lưu đầu/)).toBeTruthy();
  });

  it("phần chênh add/remove nằm trong ô ẩn: tick giờ mới → add, bỏ giờ đang open → remove", () => {
    const { container } = render(<AvailabilityGrid days={DAYS} phone="0912345678" needsPhone={false} stats={STATS} />);
    expect(hiddenValues(container)).toEqual({ add: [], remove: [] });

    // Tick 11:00 (chưa đăng) và bỏ 09:00 (đang open).
    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 11:00"));
    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 09:00"));
    expect(hiddenValues(container)).toEqual({
      add: ["2026-09-24T04:00:00.000Z"],
      remove: ["2026-09-24T02:00:00.000Z"]
    });
  });

  it("nút 'cả ngày' tick mọi ô còn thao tác được, chừa ô quá khứ và ô đã đặt", () => {
    const { container } = render(<AvailabilityGrid days={DAYS} phone="0912345678" needsPhone={false} stats={STATS} />);
    fireEvent.click(screen.getByRole("button", { name: "cả ngày" }));
    const { add } = hiddenValues(container);
    // 09:00 đã open từ trước nên không nằm trong add; chỉ 11:00 là mới.
    expect(add).toEqual(["2026-09-24T04:00:00.000Z"]);
    expect((screen.getByLabelText("Thứ Năm 24/09/2026 07:00") as HTMLInputElement).checked).toBe(false);
  });

  it("dải thống kê đọc đúng các con số của spec", () => {
    render(<AvailabilityGrid days={DAYS} phone="0912345678" needsPhone={false} stats={STATS} />);
    const strip = screen.getByText(/Đã đăng ký/).textContent ?? "";
    expect(strip).toContain("2 giờ");
    expect(strip).toContain("Đã phỏng vấn xong");
  });
});

describe("2. bảng điều hành ban tổ chức", () => {
  it("vòng tự gửi chạy ngay khi mở tab — không chờ ai bấm", async () => {
    render(<BtcPanel overview={OVERVIEW} />);
    // Effect mount gọi tick() ngay lượt đầu.
    await vi.waitFor(() => expect(runInterviewDispatchAction).toHaveBeenCalled());
  });

  it("tile và nút gửi mang đúng con số realtime", async () => {
    render(<BtcPanel overview={OVERVIEW} />);
    expect(screen.getByText("Giờ còn trống đến hết 05/10").previousSibling?.textContent).toBe("5");
    expect(screen.getByText("Chưa đặt lịch").previousSibling?.textContent).toBe("80");
    // Nhịp tự gửi lúc mở tab đổi nhãn nút thành "Đang gửi..." trong chốc lát —
    // chờ nó xong rồi mới đọc nhãn thật.
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /Gửi thư mời\/nhắc ngay \(12 đến hạn\)/ })).toBeTruthy()
    );
  });

  it("huỷ lịch phải qua hộp thoại; bấm Cancel thì không gọi action", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<BtcPanel overview={OVERVIEW} />);
    // Chờ nhịp tự gửi lúc mở tab xong — trong lúc busy, nút Huỷ bị khoá có chủ ý.
    await vi.waitFor(() =>
      expect((screen.getByRole("button", { name: "Huỷ lịch" }) as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(screen.getByRole("button", { name: "Huỷ lịch" }));
    expect(promptSpy).toHaveBeenCalled();
    expect(cancelBookingByBtcAction).not.toHaveBeenCalled();

    promptSpy.mockReturnValue("Interviewer bận");
    fireEvent.click(screen.getByRole("button", { name: "Huỷ lịch" }));
    await vi.waitFor(() =>
      expect(cancelBookingByBtcAction).toHaveBeenCalledWith({ bookingId: "b1", note: "Interviewer bận" })
    );
    promptSpy.mockRestore();
  });
});

describe("3. khẳng định tĩnh trên mã nguồn", () => {
  it("lưới dùng useFormState của react-dom", () => {
    const source = readFileSync("app/interviews/lich/availability-grid.tsx", "utf8");
    expect(source).toContain('from "react-dom"');
    expect(source).toContain("useFormState");
    expect(source).not.toContain("useActionState");
  });

  it("trang gate bằng canSelfClaimInterview, phần ban tổ chức bằng canAssignReview", () => {
    const source = readFileSync("app/interviews/lich/page.tsx", "utf8");
    expect(source).toContain("canSelfClaimInterview(adminUser.role)");
    expect(source).toContain("canAssignReview(adminUser.role)");
    expect(source).toContain('redirect("/login")');
  });
});

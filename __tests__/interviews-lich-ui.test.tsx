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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  cancelBookingByBtcAction: vi.fn(async () => ({ ok: true, message: "Đã huỷ." })),
  matchMentorAtHourAction: vi.fn(async () => ({ status: "idle", message: "" }))
}));

import { AvailabilityGrid } from "@/app/interviews/lich/availability-grid";
import { BtcPanel } from "@/app/interviews/lich/btc-panel";
import { WaitingPanel } from "@/app/interviews/lich/waiting-panel";
import { cancelBookingByBtcAction, runInterviewDispatchAction } from "@/app/actions/interview-schedule";

const DAYS = [
  {
    dateKey: "2026-09-24",
    label: "Thứ Năm 24/09/2026",
    slots: [
      { startsAtIso: "2026-09-24T00:00:00.000Z", hour: 7, isPast: true, mine: null, candidateName: null, reviewId: null },
      {
        startsAtIso: "2026-09-24T02:00:00.000Z",
        hour: 9,
        isPast: false,
        mine: "open" as const,
        candidateName: null,
        reviewId: null
      },
      {
        startsAtIso: "2026-09-24T03:00:00.000Z",
        hour: 10,
        isPast: false,
        mine: "booked" as const,
        candidateName: "Nguyễn Văn A",
        reviewId: "rv-1"
      },
      { startsAtIso: "2026-09-24T04:00:00.000Z", hour: 11, isPast: false, mine: null, candidateName: null, reviewId: null }
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
      candidatePhone: "0901111222",
      applicationId: "app-a",
      reviewId: "rv-a",
      applicationAnswers: [
        { label: "Vì sao anh/chị muốn làm mentor?", value: "Muốn trả ơn trường.\nVà chia sẻ kinh nghiệm." },
        { label: "Lĩnh vực chuyên môn", value: "Tài chính" }
      ],
      interviewerName: "Chị Core Team",
      interviewerEmail: "ct@example.com",
      interviewerPhone: "0912345678"
    },
    {
      bookingId: "b2",
      slotStartsAtIso: "2026-09-26T09:00:00.000Z",
      slotLabel: "Thứ Bảy 26/09/2026, 16:00–17:00 (giờ Việt Nam)",
      candidateName: "Trần Văn C",
      candidateEmail: "c@example.com",
      candidatePhone: null,
      applicationId: "app-c",
      reviewId: null,
      applicationAnswers: [],
      interviewerName: "Anh Phỏng Vấn",
      interviewerEmail: null,
      interviewerPhone: null
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

  it("ô đã đặt có phiếu phỏng vấn: huy hiệu là link mở thẳng /reviews/<id> ở tab mới", () => {
    render(<AvailabilityGrid days={DAYS} phone="" needsPhone stats={STATS} />);
    const badge = screen.getByTitle(/Nguyễn Văn A/) as HTMLAnchorElement;
    expect(badge.tagName).toBe("A");
    expect(badge.getAttribute("href")).toBe("/reviews/rv-1");
    expect(badge.getAttribute("target")).toBe("_blank");
    expect(badge.getAttribute("rel")).toContain("noopener");
    expect(badge.textContent).toContain("Đặt");
  });

  it("ô đã đặt mà chưa có phiếu phỏng vấn (trường hợp phòng thủ): vẫn là huy hiệu tĩnh, không phải link", () => {
    const daysWithoutReview = DAYS.map((day) => ({
      ...day,
      slots: day.slots.map((slot) => (slot.mine === "booked" ? { ...slot, reviewId: null } : slot))
    }));
    render(<AvailabilityGrid days={daysWithoutReview} phone="" needsPhone stats={STATS} />);
    const badge = screen.getByTitle(/Nguyễn Văn A/);
    expect(badge.tagName).toBe("SPAN");
    expect(badge.hasAttribute("href")).toBe(false);
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

  /** Bản sao mới tinh của cùng dữ liệu — đúng thứ router.refresh() trả về mỗi 15 giây. */
  function freshDays() {
    return DAYS.map((day) => ({ ...day, slots: day.slots.map((slot) => ({ ...slot })) }));
  }

  it("trang tự làm mới không được xoá ô vừa tick mà chưa kịp Lưu", () => {
    // 23/09/2026: interviewer báo tick xong một lúc thì ô trước đó mất sạch.
    // <LiveRefresh /> gọi router.refresh() mỗi 15 giây, và props `days` trả về
    // là mảng MỚI dù dữ liệu y hệt — lưới phải nhận ra là không có gì đổi.
    const { container, rerender } = render(
      <AvailabilityGrid days={DAYS} phone="0912345678" needsPhone={false} stats={STATS} />
    );
    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 11:00"));
    expect(hiddenValues(container).add).toEqual(["2026-09-24T04:00:00.000Z"]);

    rerender(<AvailabilityGrid days={freshDays()} phone="0912345678" needsPhone={false} stats={STATS} />);

    expect((screen.getByLabelText("Thứ Năm 24/09/2026 11:00") as HTMLInputElement).checked).toBe(true);
    expect(hiddenValues(container).add).toEqual(["2026-09-24T04:00:00.000Z"]);
  });

  it("máy chủ đổi thật: giờ vừa bị mentor giữ thành ô khoá, phần đang tick dở vẫn còn", () => {
    const { container, rerender } = render(
      <AvailabilityGrid days={DAYS} phone="0912345678" needsPhone={false} stats={STATS} />
    );
    fireEvent.click(screen.getByLabelText("Thứ Năm 24/09/2026 11:00"));

    // 09:00 đang trống bị một mentor giữ mất ngay giữa lúc người này còn đang tick.
    const days = freshDays().map((day) => ({
      ...day,
      slots: day.slots.map((slot) =>
        slot.hour === 9 ? { ...slot, mine: "booked" as const, candidateName: "Trần Thị B", reviewId: "rv-2" } : slot
      )
    }));
    rerender(<AvailabilityGrid days={days} phone="0912345678" needsPhone={false} stats={STATS} />);

    // Máy chủ thắng ở ô không sửa được nữa...
    expect(screen.queryByLabelText("Thứ Năm 24/09/2026 09:00")).toBeNull();
    expect(screen.getByTitle(/Trần Thị B/)).toBeTruthy();
    // ...nhưng không cuốn theo phần người dùng đang làm dở ở ô khác.
    expect((screen.getByLabelText("Thứ Năm 24/09/2026 11:00") as HTMLInputElement).checked).toBe(true);
    expect(hiddenValues(container)).toEqual({ add: ["2026-09-24T04:00:00.000Z"], remove: [] });
  });
});

describe("2b. bấm vào buổi hẹn thấy đủ hai người (BTC 04/10/2026)", () => {
  it("ứng viên: email, SĐT gọi được, mở hồ sơ, mở phiếu; người phỏng vấn: email, SĐT", () => {
    render(<BtcPanel overview={OVERVIEW} />);
    const [first] = screen.getAllByTestId("upcoming-booking");
    const candidate = within(first).getByTestId("booking-candidate");
    expect(candidate.textContent).toContain("Nguyễn Văn A");
    expect(within(candidate).getByRole("link", { name: "0901111222" }).getAttribute("href")).toBe("tel:0901111222");
    expect(within(candidate).getByRole("link", { name: "Mở hồ sơ ứng tuyển" }).getAttribute("href")).toBe("/applications/app-a");
    expect(within(candidate).getByRole("link", { name: "Mở phiếu phỏng vấn" }).getAttribute("href")).toBe("/reviews/rv-a");
    const interviewer = within(first).getByTestId("booking-interviewer");
    expect(interviewer.textContent).toContain("Chị Core Team");
    expect(within(interviewer).getByRole("link", { name: "ct@example.com" }).getAttribute("href")).toBe("mailto:ct@example.com");
    expect(within(interviewer).getByRole("link", { name: "0912345678" }).getAttribute("href")).toBe("tel:0912345678");
  });

  it("'Xem application' mở câu trả lời ngay trong thẻ ứng viên, đúng nhãn câu hỏi, giữ xuống dòng", () => {
    render(<BtcPanel overview={OVERVIEW} />);
    const [first, second] = screen.getAllByTestId("upcoming-booking");
    const app = within(within(first).getByTestId("booking-candidate")).getByTestId("booking-application");
    expect(app.querySelector("summary")?.textContent).toBe("Xem application (2 câu trả lời)");
    const pairs = Array.from(app.querySelectorAll("dl > div")).map((d) => [d.querySelector("dt")?.textContent, d.querySelector("dd")?.textContent]);
    expect(pairs).toEqual([
      ["Vì sao anh/chị muốn làm mentor?", "Muốn trả ơn trường.\nVà chia sẻ kinh nghiệm."],
      ["Lĩnh vực chuyên môn", "Tài chính"]
    ]);
    // Người phỏng vấn không có application; buổi không có câu trả lời thì không hứa nút.
    expect(within(first).getByTestId("booking-interviewer").querySelector('[data-testid="booking-application"]')).toBeNull();
    expect(within(second).queryByTestId("booking-application")).toBeNull();
  });

  it("thiếu SĐT thì ghi 'chưa có'; chưa có phiếu thì không hứa link phiếu", () => {
    render(<BtcPanel overview={OVERVIEW} />);
    const second = screen.getAllByTestId("upcoming-booking")[1];
    const candidate = within(second).getByTestId("booking-candidate");
    expect(candidate.textContent).toContain("SĐT: chưa có");
    expect(within(candidate).queryByRole("link", { name: "Mở phiếu phỏng vấn" })).toBeNull();
    expect(within(candidate).getByRole("link", { name: "Mở hồ sơ ứng tuyển" }).getAttribute("href")).toBe("/applications/app-c");
    expect(within(second).getByTestId("booking-interviewer").textContent).toContain("SĐT: chưa có");
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
    expect(screen.getByText("Giờ còn trống đến hết 11/10").previousSibling?.textContent).toBe("5");
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
      expect((screen.getAllByRole("button", { name: "Huỷ lịch" })[0] as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Huỷ lịch" })[0]);
    expect(promptSpy).toHaveBeenCalled();
    expect(cancelBookingByBtcAction).not.toHaveBeenCalled();

    promptSpy.mockReturnValue("Interviewer bận");
    fireEvent.click(screen.getAllByRole("button", { name: "Huỷ lịch" })[0]);
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

// ─────────────────────────────────────────────────────────────────────────────
// Chiều ngược: bảng mentor đang chờ được ghép
// ─────────────────────────────────────────────────────────────────────────────

const WAITING = [
  {
    dateKey: "2026-09-26",
    label: "Thứ Bảy 26/09/2026",
    hours: [
      { startsAtIso: "2026-09-26T08:00:00.000Z", hour: 15, waitingCount: 18 },
      { startsAtIso: "2026-09-26T13:00:00.000Z", hour: 20, waitingCount: 2 }
    ]
  }
];

describe("3. bảng mentor đang chờ", () => {
  it("hiện số người chờ từng khung giờ và tổng số mentor", () => {
    render(<WaitingPanel waiting={WAITING} waitingTotal={19} />);
    expect(screen.getByText(/19 mentor/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /15h · 18 chờ/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /20h · 2 chờ/ })).toBeTruthy();
  });

  it("nút mang khung giờ chứ không mang tên ai — database chọn người khai sớm nhất", () => {
    render(<WaitingPanel waiting={WAITING} waitingTotal={19} />);
    const button = screen.getByRole("button", { name: /15h · 18 chờ/ }) as HTMLButtonElement;
    expect(button.name).toBe("slotStartsAt");
    expect(button.value).toBe("2026-09-26T08:00:00.000Z");
  });

  it("ghép phải qua hộp thoại xác nhận — bấm là chốt và thư đi ngay", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<WaitingPanel waiting={WAITING} waitingTotal={19} />);
    fireEvent.submit(screen.getByRole("button", { name: /15h · 18 chờ/ }).closest("form") as HTMLFormElement);
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("chưa ai khai giờ thì nói rõ, không hiện một bảng rỗng", () => {
    render(<WaitingPanel waiting={[]} waitingTotal={0} />);
    expect(screen.getByText(/Chưa có mentor nào tự khai giờ rảnh/)).toBeTruthy();
  });
});

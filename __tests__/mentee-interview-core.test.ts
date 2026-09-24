/**
 * __tests__/mentee-interview-core.test.ts
 *
 * Phần thuần của vòng phỏng vấn mentee: 12 ca offline ngày 3–4/10/2026.
 *
 * ---------------------------------------------------------------------------
 * CA QUAN TRỌNG NHẤT Ở ĐÂY
 * ---------------------------------------------------------------------------
 * `seat_limit` để NULL vì ban tổ chức chưa chốt số ghế, và NULL phải nghĩa là
 * ĐÓNG chứ không phải vô hạn. Nếu một ngày nào đó ai đó "sửa cho tiện" thành
 * vô hạn, một ô cấu hình bị quên sẽ để 500 ứng viên dồn vào một ca và không có
 * lỗi nào hiện ra cho tới sáng ngày phỏng vấn. Describe 1 canh đúng chỗ đó.
 *
 * Vitest chạy TZ=UTC đúng như Vercel, nên mọi mốc ở đây là instant UTC và các
 * nhãn giờ phải ra giờ Việt Nam.
 */
import { describe, expect, it } from "vitest";
import {
  buildSessionDays,
  bookingClosesAt,
  hasBookableSession,
  sessionDayLabel,
  sessionFullLabel,
  sessionState,
  sessionTimeLabel,
  totalRemaining,
  vietnamDateKeyOf,
  type SessionRow
} from "@/lib/mentee-interview-core";

/** 03/10/2026 08:00 giờ Việt Nam = 01:00Z. */
const CA_1: SessionRow = {
  id: "ca-1",
  startsAtIso: "2026-10-03T01:00:00.000Z",
  endsAtIso: "2026-10-03T02:00:00.000Z",
  seatLimit: null,
  venue: null,
  bookingClosesAtIso: "2026-09-28T16:59:59.000Z",
  status: "open"
};
/** 04/10/2026 16:00 giờ Việt Nam = 09:00Z. */
const CA_12: SessionRow = { ...CA_1, id: "ca-12", startsAtIso: "2026-10-04T09:00:00.000Z", endsAtIso: "2026-10-04T10:00:00.000Z" };

const TRUOC_HAN = "2026-09-26T03:00:00.000Z";
const SAU_HAN = "2026-09-29T03:00:00.000Z";

describe("1. ghế chưa cấu hình là ĐÓNG, không phải vô hạn", () => {
  it("seat_limit null → not_configured, dù chưa ai giữ chỗ", () => {
    expect(sessionState(CA_1, 0, TRUOC_HAN)).toBe("not_configured");
  });

  it("ca chưa cấu hình KHÔNG đếm vào chỗ còn lại của đợt", () => {
    const days = buildSessionDays([CA_1, CA_12], new Map(), TRUOC_HAN);
    expect(totalRemaining(days)).toBe(0);
    expect(hasBookableSession(days)).toBe(false);
  });

  /**
   * `remaining` phải là null chứ không phải 0. Hiện "còn 0 chỗ" cho một ca chưa
   * cấu hình là nói dối theo hướng ngược lại — người đọc tưởng ca đó đã kín và
   * thôi không quay lại nữa.
   */
  it("chỗ còn lại là null, KHÔNG phải 0", () => {
    const [day] = buildSessionDays([CA_1], new Map(), TRUOC_HAN);
    expect(day.sessions[0].remaining).toBeNull();
    expect(day.sessions[0].note).toBe("Chưa mở");
  });

  it("điền số ghế vào thì ca mở ra ngay", () => {
    const daCauHinh = { ...CA_1, seatLimit: 30 };
    expect(sessionState(daCauHinh, 0, TRUOC_HAN)).toBe("open");
    const [day] = buildSessionDays([daCauHinh], new Map(), TRUOC_HAN);
    expect(day.sessions[0].remaining).toBe(30);
    expect(day.sessions[0].note).toBeNull();
  });
});

describe("2. trạng thái ca, theo đúng thứ tự sự thật", () => {
  const ca = { ...CA_1, seatLimit: 2 };

  it("đủ người thì kín chỗ", () => {
    expect(sessionState(ca, 2, TRUOC_HAN)).toBe("full");
    expect(sessionState(ca, 3, TRUOC_HAN)).toBe("full");
    expect(sessionState(ca, 1, TRUOC_HAN)).toBe("open");
  });

  it("quá hạn đăng ký thì đóng, dù ca còn chỗ", () => {
    expect(sessionState(ca, 0, SAU_HAN)).toBe("deadline_passed");
  });

  it("ca bị ban tổ chức đóng tay thì đóng, dù còn chỗ và còn hạn", () => {
    expect(sessionState({ ...ca, status: "closed" }, 0, TRUOC_HAN)).toBe("closed");
  });

  /**
   * Thứ tự kiểm là thứ tự sự thật, không phải thứ tự tiện tay. Một ca đã diễn
   * ra phải nói "đã qua" chứ không nói "hết hạn đăng ký" — người đọc cần biết
   * mình lỡ buổi, không phải lỡ cái nút.
   */
  it("ca đã qua giờ thì nói 'đã qua', đứng trước mọi lý do khác", () => {
    const sauCa = "2026-10-03T05:00:00.000Z";
    expect(sessionState(ca, 0, sauCa)).toBe("past");
    expect(sessionState({ ...ca, status: "closed" }, 9, sauCa)).toBe("past");
  });
});

describe("3. nhãn giờ ra đúng giờ Việt Nam", () => {
  it("08:00 giờ Việt Nam dù database chạy UTC", () => {
    expect(sessionTimeLabel(CA_1.startsAtIso, CA_1.endsAtIso)).toBe("08:00 – 09:00");
  });

  it("ngày và thứ đúng", () => {
    expect(sessionDayLabel(CA_1.startsAtIso)).toBe("Thứ Bảy 03/10/2026");
    expect(sessionDayLabel(CA_12.startsAtIso)).toBe("Chủ nhật 04/10/2026");
  });

  it("nhãn đầy đủ cho thư", () => {
    expect(sessionFullLabel(CA_12.startsAtIso, CA_12.endsAtIso)).toBe(
      "Chủ nhật 04/10/2026, 16:00 – 17:00 (giờ Việt Nam)"
    );
  });

  it("gom ngày theo giờ Việt Nam, không theo UTC", () => {
    // 04/10 00:30 giờ Việt Nam là 03/10 17:30 UTC — gom theo UTC sẽ xếp nhầm ngày.
    expect(vietnamDateKeyOf("2026-10-03T17:30:00.000Z")).toBe("2026-10-04");
    expect(vietnamDateKeyOf(CA_1.startsAtIso)).toBe("2026-10-03");
  });
});

describe("4. gom ca thành ngày", () => {
  it("hai ngày, đúng thứ tự, mỗi ngày đúng nhãn của nó", () => {
    const days = buildSessionDays([CA_12, CA_1], new Map(), TRUOC_HAN);
    expect(days).toHaveLength(2);
    expect(days[0].dateKey).toBe("2026-10-03");
    expect(days[0].label).toBe("Thứ Bảy 03/10/2026");
    expect(days[1].dateKey).toBe("2026-10-04");
  });

  it("đếm chỗ đã giữ theo từng ca, không trộn lẫn", () => {
    const rows = [
      { ...CA_1, seatLimit: 10 },
      { ...CA_12, seatLimit: 10 }
    ];
    const days = buildSessionDays(rows, new Map([["ca-1", 4]]), TRUOC_HAN);
    expect(days[0].sessions[0].taken).toBe(4);
    expect(days[0].sessions[0].remaining).toBe(6);
    expect(days[1].sessions[0].taken).toBe(0);
    expect(days[1].sessions[0].remaining).toBe(10);
    expect(totalRemaining(days)).toBe(16);
  });

  it("giữ quá số ghế thì chỗ còn lại là 0, không phải số âm", () => {
    const days = buildSessionDays([{ ...CA_1, seatLimit: 3 }], new Map([["ca-1", 5]]), TRUOC_HAN);
    expect(days[0].sessions[0].remaining).toBe(0);
    expect(days[0].sessions[0].state).toBe("full");
  });
});

describe("5. hạn đăng ký đọc từ dữ liệu, không từ hằng trong mã", () => {
  /**
   * Hạn nằm ở cột `booking_closes_at` để ban tổ chức gia hạn được bằng một câu
   * update thay vì sửa mã rồi deploy. Nếu tầng này ghim một hằng riêng thì hai
   * nơi sẽ nói hai hạn khác nhau ngay lần gia hạn đầu tiên.
   */
  it("lấy mốc muộn nhất trong các ca", () => {
    const rows = [CA_1, { ...CA_12, bookingClosesAtIso: "2026-09-30T16:59:59.000Z" }];
    expect(bookingClosesAt(rows)).toBe("2026-09-30T16:59:59.000Z");
  });

  it("không có ca nào thì không có hạn", () => {
    expect(bookingClosesAt([])).toBeNull();
  });
});

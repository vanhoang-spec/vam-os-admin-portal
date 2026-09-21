/**
 * __tests__/interview-schedule-core.test.ts
 *
 * Phần thuần của bộ lịch phỏng vấn. Vitest đặt TZ=UTC đúng như Vercel, nên
 * các ca ở đây khẳng định thẳng những instant UTC: 07:00 giờ Việt Nam ngày
 * 22/09 PHẢI là 2026-09-22T00:00:00.000Z — hàm nào dựng giờ bằng đồng hồ máy
 * sẽ đỏ ngay tại đây thay vì chỉ sai trên production.
 */
import { describe, expect, it } from "vitest";
import {
  BOOKING_ELIGIBLE_STATUSES,
  bookingUrl,
  buildSlotGrid,
  canMentorCancel,
  classifyMentor,
  computeInterviewerStats,
  countOpenSlotsByHour,
  dayLabel,
  inviteSendDue,
  isBookingEligibleApplication,
  isValidSlotInstant,
  slotInstant,
  slotRangeLabel,
  windowDateKeys
} from "@/lib/interview-schedule-core";

describe("1. lưới giờ và múi giờ", () => {
  it("07:00 giờ Việt Nam là 00:00 UTC cùng ngày", () => {
    expect(slotInstant("2026-09-22", 7)).toBe("2026-09-22T00:00:00.000Z");
  });

  it("21:00 giờ Việt Nam là 14:00 UTC", () => {
    expect(slotInstant("2026-10-05", 21)).toBe("2026-10-05T14:00:00.000Z");
  });

  it("đợt có đúng 14 ngày, từ 22/09 đến 05/10", () => {
    const keys = windowDateKeys();
    expect(keys).toHaveLength(14);
    expect(keys[0]).toBe("2026-09-22");
    expect(keys[13]).toBe("2026-10-05");
    // Biên tháng 9→10 không được nuốt ngày nào.
    expect(keys).toContain("2026-09-30");
    expect(keys).toContain("2026-10-01");
  });

  it("lưới 14 ngày × 15 giờ, giờ đầu 07:00 giờ cuối 21:00", () => {
    const grid = buildSlotGrid("2026-09-21T00:00:00.000Z");
    expect(grid).toHaveLength(14);
    for (const day of grid) {
      expect(day.slots).toHaveLength(15);
      expect(day.slots[0].hour).toBe(7);
      expect(day.slots[14].hour).toBe(21);
    }
  });

  it("slot ĐÃ BẮT ĐẦU là quá khứ — đúng tại mốc, không lệch một giây", () => {
    // now = 08:00 VN ngày 22/09 → slot 07:00 đã bắt đầu (quá khứ), 09:00 chưa.
    const grid = buildSlotGrid("2026-09-22T01:00:00.000Z");
    const day = grid[0];
    expect(day.slots[0].isPast).toBe(true); // 07:00 VN
    expect(day.slots[1].isPast).toBe(true); // 08:00 VN — vừa điểm giờ, coi là bắt đầu rồi
    expect(day.slots[2].isPast).toBe(false); // 09:00 VN
  });

  it("nhãn ngày mang thứ trong tuần tiếng Việt", () => {
    // 22/09/2026 là thứ Ba.
    expect(dayLabel("2026-09-22")).toBe("Thứ Ba 22/09/2026");
  });

  it("nhãn khung giờ đọc được trong thư", () => {
    expect(slotRangeLabel("2026-09-22T08:00:00.000Z")).toBe(
      "Thứ Ba 22/09/2026, 15:00–16:00 (giờ Việt Nam)"
    );
  });
});

describe("2. kiểm một instant có phải ô lưới hợp lệ", () => {
  const now = "2026-09-22T01:00:00.000Z"; // 08:00 VN 22/09

  it("nhận ô hợp lệ ở tương lai", () => {
    const result = isValidSlotInstant("2026-09-22T08:00:00.000Z", now); // 15:00 VN
    expect(result).toEqual({ ok: true, startsAtIso: "2026-09-22T08:00:00.000Z" });
  });

  it("từ chối 06:00 và 22:00 giờ Việt Nam", () => {
    // 06:00 VN 23/09 = 23:00Z 22/09.
    expect(isValidSlotInstant("2026-09-22T23:00:00.000Z", now)).toEqual({ ok: false, code: "bad_hour" });
    // 22:00 VN 22/09 = 15:00Z.
    expect(isValidSlotInstant("2026-09-22T15:00:00.000Z", now)).toEqual({ ok: false, code: "bad_hour" });
  });

  it("từ chối giờ lẻ phút", () => {
    expect(isValidSlotInstant("2026-09-22T08:30:00.000Z", now)).toEqual({ ok: false, code: "bad_hour" });
  });

  it("từ chối ngoài đợt — 21/09 và 06/10", () => {
    expect(isValidSlotInstant("2026-09-21T08:00:00.000Z", now)).toEqual({ ok: false, code: "outside_window" });
    expect(isValidSlotInstant("2026-10-06T08:00:00.000Z", now)).toEqual({ ok: false, code: "outside_window" });
  });

  it("từ chối slot đã bắt đầu", () => {
    expect(isValidSlotInstant("2026-09-22T00:00:00.000Z", now)).toEqual({ ok: false, code: "in_past" });
  });

  it("từ chối chuỗi rác", () => {
    expect(isValidSlotInstant("hom-qua", now)).toEqual({ ok: false, code: "invalid" });
  });
});

describe("3. luật đối tượng đặt lịch", () => {
  const mentorApp = { status: "submitted", role_applied: "mentor", source: "vam_os_form" };

  it("đủ 9 trạng thái được đặt", () => {
    expect(BOOKING_ELIGIBLE_STATUSES.size).toBe(9);
    for (const status of Array.from(BOOKING_ELIGIBLE_STATUSES)) {
      expect(isBookingEligibleApplication({ ...mentorApp, status }, [], null)).toBe(true);
    }
  });

  it("interview_in_progress và needs_more_review đứng ngoài", () => {
    expect(isBookingEligibleApplication({ ...mentorApp, status: "interview_in_progress" }, [], null)).toBe(false);
    expect(isBookingEligibleApplication({ ...mentorApp, status: "needs_more_review" }, [], null)).toBe(false);
  });

  it("mentee và đơn tái tục không đặt lịch phỏng vấn", () => {
    expect(isBookingEligibleApplication({ ...mentorApp, role_applied: "mentee" }, [], null)).toBe(false);
    expect(isBookingEligibleApplication({ ...mentorApp, source: "s12_mentor_renewal" }, [], null)).toBe(false);
  });

  it("đã có phiếu phỏng vấn sống của người khác thì thôi", () => {
    expect(isBookingEligibleApplication(mentorApp, ["review-cua-nguoi-khac"], null)).toBe(false);
  });

  it("phiếu của chính lịch đang hiệu lực KHÔNG tính là người khác phụ trách", () => {
    expect(isBookingEligibleApplication(mentorApp, ["review-cua-booking"], "review-cua-booking")).toBe(true);
    // Nhưng thêm một phiếu lạ nữa thì vẫn từ chối.
    expect(
      isBookingEligibleApplication(mentorApp, ["review-cua-booking", "review-la"], "review-cua-booking")
    ).toBe(false);
  });
});

describe("4. nhịp gửi thư mời và nhắc", () => {
  const DAY = 24 * 60 * 60_000;
  const t0 = Date.parse("2026-09-22T02:00:00.000Z");

  it("chưa gửi lần nào thì đến lượt ngay — lượt 1, không CC", () => {
    expect(inviteSendDue({ send_count: 0, last_sent_at: null }, t0)).toEqual({
      due: true,
      sendNumber: 1,
      isReminder: false,
      ccBtc: false
    });
  });

  it("mới 2 ngày thì chưa nhắc; đủ 3 ngày thì nhắc", () => {
    const sentAt = new Date(t0).toISOString();
    expect(inviteSendDue({ send_count: 1, last_sent_at: sentAt }, t0 + 2 * DAY).due).toBe(false);
    expect(inviteSendDue({ send_count: 1, last_sent_at: sentAt }, t0 + 3 * DAY).due).toBe(true);
  });

  it("chỉ lượt gửi thứ 4 (nhắc lần 3) mới CC ban tổ chức", () => {
    const sentAt = new Date(t0).toISOString();
    expect(inviteSendDue({ send_count: 2, last_sent_at: sentAt }, t0 + 3 * DAY).ccBtc).toBe(false);
    const fourth = inviteSendDue({ send_count: 3, last_sent_at: sentAt }, t0 + 3 * DAY);
    expect(fourth.due).toBe(true);
    expect(fourth.sendNumber).toBe(4);
    expect(fourth.ccBtc).toBe(true);
  });

  it("đủ 4 lượt rồi thì im — dù bao lâu trôi qua", () => {
    const sentAt = new Date(t0).toISOString();
    expect(inviteSendDue({ send_count: 4, last_sent_at: sentAt }, t0 + 30 * DAY).due).toBe(false);
  });
});

describe("5. các phép đếm", () => {
  const now = "2026-09-25T05:00:00.000Z"; // 12:00 VN 25/09

  it("thống kê của interviewer: tổng, đã xong theo lịch, sắp tới, trống, trôi qua", () => {
    const stats = computeInterviewerStats(
      [
        { slot_starts_at: "2026-09-23T02:00:00.000Z", status: "booked" }, // 09:00 VN 23/09 — đã xong
        { slot_starts_at: "2026-09-26T02:00:00.000Z", status: "booked" }, // sắp tới
        { slot_starts_at: "2026-09-26T03:00:00.000Z", status: "open" }, // còn trống
        { slot_starts_at: "2026-09-24T02:00:00.000Z", status: "open" }, // trống nhưng đã trôi qua
        { slot_starts_at: "2026-09-26T04:00:00.000Z", status: "removed" } // đã gỡ — không đếm
      ],
      now
    );
    expect(stats).toEqual({ total: 4, done: 1, bookedUpcoming: 1, open: 1, expired: 1 });
  });

  it("buổi đang diễn ra chưa tính là đã xong", () => {
    // Slot 12:00 VN hôm nay, now đúng 12:00 → end 13:00 > now.
    const stats = computeInterviewerStats(
      [{ slot_starts_at: "2026-09-25T05:00:00.000Z", status: "booked" }],
      now
    );
    expect(stats.done).toBe(0);
    expect(stats.bookedUpcoming).toBe(1);
  });

  it("hai interviewer cùng rảnh một khung giờ thì khung đó còn 2 chỗ", () => {
    const counts = countOpenSlotsByHour([
      { slot_starts_at: "2026-09-26T08:00:00.000Z" },
      { slot_starts_at: "2026-09-26T08:00:00.000Z" },
      { slot_starts_at: "2026-09-26T09:00:00.000Z" }
    ]);
    expect(counts.get("2026-09-26T08:00:00.000Z")).toBe(2);
    expect(counts.get("2026-09-26T09:00:00.000Z")).toBe(1);
  });

  it("xếp nhóm mentor theo lịch hẹn, không theo trạng thái đơn", () => {
    expect(classifyMentor(null, now)).toBe("not_booked");
    expect(classifyMentor({ slot_starts_at: "2026-09-23T02:00:00.000Z" }, now)).toBe("booked_past");
    expect(classifyMentor({ slot_starts_at: "2026-09-26T02:00:00.000Z" }, now)).toBe("booked_upcoming");
  });
});

describe("6. mốc 24 giờ và link", () => {
  it("đúng 24 giờ trước buổi hẹn thì KHÔNG tự huỷ được nữa", () => {
    const slot = "2026-09-26T08:00:00.000Z";
    expect(canMentorCancel(slot, "2026-09-25T08:00:00.000Z")).toBe(false);
    expect(canMentorCancel(slot, "2026-09-25T07:59:00.000Z")).toBe(true);
  });

  it("giờ rác thì fail-closed", () => {
    expect(canMentorCancel("khong-phai-gio", "2026-09-25T08:00:00.000Z")).toBe(false);
  });

  it("link đặt lịch không nhân đôi dấu gạch chéo", () => {
    expect(bookingUrl("https://os.alumni-mentoring.edu.vn/", "ma-rieng")).toBe(
      "https://os.alumni-mentoring.edu.vn/dat-lich/ma-rieng"
    );
    expect(bookingUrl("https://os.alumni-mentoring.edu.vn", "ma-rieng")).toBe(
      "https://os.alumni-mentoring.edu.vn/dat-lich/ma-rieng"
    );
  });
});

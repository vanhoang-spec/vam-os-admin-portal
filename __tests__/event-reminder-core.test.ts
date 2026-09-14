/**
 * Phần thuần của "Gửi remind": ai nhận, khi nào bị chặn, ngày nhập lại có khớp.
 *
 * Màn hình và máy chủ gọi đúng các hàm này, nên một lỗi ở đây là lỗi ở cả hai
 * phía cùng lúc — và là chỗ duy nhất phải khoá.
 */
import { describe, expect, it } from "vitest";
import {
  REMINDER_CHUNK,
  REMINDER_CONFIRM_QUESTION,
  REMINDER_DATE_INVALID,
  REMINDER_DATE_MISMATCH,
  checkReminderDate,
  countReminderStates,
  describeReminderCounts,
  eventVietnamDate,
  isReminderRecipient,
  reminderBlockReason,
  reminderMaxRounds,
  reminderRemaining,
  shouldContinueReminder
} from "@/lib/event-reminder-core";

const NOW = Date.parse("2026-09-14T03:00:00.000Z");
const FUTURE = "2026-09-20T01:00:00.000Z"; // 08:00 ngày 20/09/2026 giờ Việt Nam

describe("1. câu xác nhận", () => {
  it("đúng nguyên văn chủ chương trình yêu cầu", () => {
    expect(REMINDER_CONFIRM_QUESTION).toBe(
      "Hệ thống sẽ gửi email đến toàn bộ người đăng ký tham dự Event/buổi này với đầy đủ thông tin cập nhật mới nhất đến thời điểm hiện tại. Bạn xác nhận đồng ý tiến hành?"
    );
  });
});

describe("2. ai nhận thư nhắc", () => {
  const base = { email: "a@example.com", attendance_status: "pending" };

  it.each(["registered", "confirmed", "pending_review"])("đang giữ chỗ (%s): nhận", (status) => {
    expect(isReminderRecipient({ ...base, registration_status: status })).toBe(true);
  });

  it.each(["waitlisted", "rejected", "cancelled", "", "unknown"])("không giữ chỗ (%s): không nhận", (status) => {
    expect(isReminderRecipient({ ...base, registration_status: status })).toBe(false);
  });

  it("đã check-in: không nhận — họ đã ở hội trường", () => {
    expect(isReminderRecipient({ ...base, registration_status: "confirmed", attendance_status: "checked_in" })).toBe(false);
  });

  it("thiếu email: không nhận", () => {
    expect(isReminderRecipient({ registration_status: "registered", email: "  " })).toBe(false);
  });
});

describe("3. ngày nhập lại", () => {
  it("đúng ngày Việt Nam của buổi: khớp", () => {
    expect(checkReminderDate("20/09/2026", FUTURE)).toEqual({ ok: true, isoDate: "2026-09-20" });
  });

  it("so theo NGÀY VIỆT NAM, không theo ngày UTC", () => {
    // 06:30 sáng 20/09 giờ Việt Nam là 23:30 UTC ngày 19/09.
    const earlyMorning = "2026-09-19T23:30:00.000Z";
    expect(eventVietnamDate(earlyMorning)).toBe("2026-09-20");
    expect(checkReminderDate("20/09/2026", earlyMorning).ok).toBe(true);
    expect(checkReminderDate("19/09/2026", earlyMorning)).toEqual({ ok: false, message: REMINDER_DATE_MISMATCH });
  });

  it("ngày khác: không khớp, và câu báo không đọc ra ngày đúng", () => {
    const result = checkReminderDate("27/09/2026", FUTURE);
    expect(result).toEqual({ ok: false, message: REMINDER_DATE_MISMATCH });
    expect(REMINDER_DATE_MISMATCH).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it.each(["", "20/9/2026", "2026-09-20", "31/02/2026", "abc"])("sai định dạng hoặc ngày không có thật (%j): báo định dạng", (typed) => {
    expect(checkReminderDate(typed, FUTURE)).toEqual({ ok: false, message: REMINDER_DATE_INVALID });
  });

  it("buổi chưa có giờ: không khớp ngày nào", () => {
    expect(checkReminderDate("20/09/2026", null).ok).toBe(false);
  });
});

describe("4. khi nào bị chặn", () => {
  const event = { status: "active", starts_at: FUTURE, event_format: "offline", online_join_url: null };

  it("buổi bình thường sắp diễn ra: không chặn", () => {
    expect(reminderBlockReason(event, NOW)).toBeNull();
  });

  it("không có buổi", () => {
    expect(reminderBlockReason(null, NOW)).toContain("Không tìm thấy");
  });

  it("buổi đã huỷ", () => {
    expect(reminderBlockReason({ ...event, status: "cancelled" }, NOW)).toContain("đã huỷ");
  });

  it("chưa có giờ bắt đầu", () => {
    expect(reminderBlockReason({ ...event, starts_at: null }, NOW)).toContain("chưa có giờ");
  });

  it("đã bắt đầu — kể cả đúng giây bắt đầu", () => {
    expect(reminderBlockReason({ ...event, starts_at: new Date(NOW).toISOString() }, NOW)).toContain("đã bắt đầu");
    expect(reminderBlockReason({ ...event, starts_at: "2026-09-01T01:00:00.000Z" }, NOW)).toContain("đã bắt đầu");
  });

  it.each(["online", "hybrid"])("buổi %s thiếu link họp: chặn", (format) => {
    expect(reminderBlockReason({ ...event, event_format: format }, NOW)).toContain("chưa có link họp");
  });

  it("buổi trực tuyến có link họp: không chặn", () => {
    expect(reminderBlockReason({ ...event, event_format: "online", online_join_url: "https://meet.google.com/x" }, NOW)).toBeNull();
  });
});

describe("5. tiến độ", () => {
  it("đếm theo trạng thái, bỏ qua giá trị lạ", () => {
    const counts = countReminderStates([
      { status: "sent" },
      { status: "sent" },
      { status: "failed" },
      { status: "queued" },
      { status: "sending" },
      { status: "skipped" },
      { status: "weird" }
    ]);
    expect(counts).toEqual({ queued: 1, sending: 1, sent: 2, failed: 1, skipped: 1 });
    expect(reminderRemaining(counts)).toBe(2);
  });

  it("chỉ nói những con số khác 0", () => {
    expect(describeReminderCounts({ queued: 0, sending: 0, sent: 5, failed: 0, skipped: 0 })).toBe("Đã gửi 5/5");
    expect(describeReminderCounts({ queued: 3, sending: 0, sent: 5, failed: 1, skipped: 2 })).toBe(
      "Đã gửi 5/11 · lỗi 1 · bỏ qua 2 · còn 3"
    );
  });

  it("vòng tự động dừng khi một lần gọi không gửi được thư nào", () => {
    const chunk = { sent: 0, failed: 10, skipped: 0, released: 0 };
    expect(shouldContinueReminder({ ok: true, message: "", done: false, chunk })).toBe(false);
    expect(shouldContinueReminder({ ok: true, message: "", done: false, chunk: { ...chunk, sent: 1 } })).toBe(true);
    expect(shouldContinueReminder({ ok: true, message: "", done: false, chunk: { ...chunk, skipped: 2, failed: 0 } })).toBe(true);
    expect(shouldContinueReminder({ ok: true, message: "", done: true, chunk: { ...chunk, sent: 3 } })).toBe(false);
    expect(shouldContinueReminder({ ok: false, message: "x" })).toBe(false);
    expect(shouldContinueReminder({ ok: true, message: "", done: false })).toBe(false);
  });

  it("trần số lần gọi đủ cho cả danh sách, có dư", () => {
    expect(reminderMaxRounds(0)).toBe(5);
    expect(reminderMaxRounds(REMINDER_CHUNK * 21)).toBe(26);
    expect(reminderMaxRounds(Number.NaN)).toBe(5);
  });
});

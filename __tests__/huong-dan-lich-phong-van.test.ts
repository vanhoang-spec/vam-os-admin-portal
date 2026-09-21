/**
 * Hướng dẫn một trang "Lịch phỏng vấn mentor 1:1" — không được nói sai màn hình.
 *
 * Người đọc tin hướng dẫn và đi tìm đúng chữ trên màn hình. Mỗi câu hướng dẫn
 * trích — tên menu, nhãn nút, lời báo — phải có thật trong mã nguồn, và mỗi
 * con số hướng dẫn khẳng định (nhịp nhắc 3 ngày, mốc 24 giờ, khung 07:00–22:00,
 * đợt 22/09–05/10) phải khớp hằng số thật. Đổi một nhãn hay một hằng mà quên
 * sửa hướng dẫn thì test này đỏ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BTC_EMAIL,
  CC_BTC_ON_SEND_NUMBER,
  HOTLINE_ZALO,
  INTERVIEW_BOOKING_PATH_PREFIX,
  INTERVIEW_WINDOW,
  MAX_SENDS,
  MENTOR_CANCEL_CUTOFF_MS,
  REMINDER_INTERVAL_MS,
  SLOT_FIRST_HOUR,
  SLOT_LAST_HOUR,
  windowDateKeys
} from "@/lib/interview-schedule-core";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const html = read("docs/huong-dan/HUONG_DAN_LICH_PHONG_VAN.html");
/** The guide as a reader sees it: tags gone, whitespace collapsed. */
const guideText = html.replace(/<style[\s\S]*?<\/style>/i, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const GRID = "app/interviews/lich/availability-grid.tsx";
const PANEL = "app/interviews/lich/btc-panel.tsx";
const BOOKING = "app/dat-lich/[token]/booking-form.tsx";

// [câu hướng dẫn trích, file nguồn, chuỗi phải có trong file nguồn]
const QUOTED: Array<[string, string, string]> = [
  ["Lịch phỏng vấn", "lib/nav-model.ts", 'label: "Lịch phỏng vấn"'],
  ["Đánh giá", "lib/nav-model.ts", 'label: "Đánh giá"'],
  ["Danh sách nhân sự tuyển sinh", "lib/nav-model.ts", '"Danh sách nhân sự tuyển sinh"'],
  // Nhãn nút dựng bằng `Cấp ${rightLabel}` trên trang nhân sự tuyển sinh.
  ["Cấp quyền phỏng vấn", "app/reviews/reviewer-pool/reviewer-pool-client.tsx", '"quyền phỏng vấn"'],
  ["Lưu giờ rảnh", GRID, "Lưu giờ rảnh"],
  ["cả ngày", GRID, "cả ngày"],
  ["Đã đăng ký", GRID, "Đã đăng ký"],
  ["Gửi thư mời/nhắc ngay", PANEL, "Gửi thư mời/nhắc ngay"],
  ["Huỷ lịch", PANEL, "Huỷ lịch"],
  ["Lịch hẹn sắp diễn ra", PANEL, "Lịch hẹn sắp diễn ra"],
  ["Giữ chỗ", BOOKING, "Giữ chỗ khung giờ đã chọn"],
  ["còn N chỗ", BOOKING, "· còn"],
  ["Sẵn sàng ra quyết định cuối", "lib/ui-labels.ts", '"Sẵn sàng ra quyết định cuối"'],
  ["Hồ sơ hiện không ở bước đặt lịch", "lib/interview-schedule.ts", "hiện không ở bước đặt lịch"],
  ["Nhật ký gửi", "app/operations/mail/mail-tabs.tsx", 'label: "Nhật ký gửi"']
];

describe("mỗi câu hướng dẫn trích đều có thật trên màn hình", () => {
  for (const [quote, file, needle] of QUOTED) {
    it(`"${quote}"`, () => {
      expect(guideText).toContain(quote);
      expect(read(file), `${file} không còn "${needle}"`).toContain(needle);
    });
  }
});

describe("mỗi con số hướng dẫn khẳng định đều khớp hằng số thật", () => {
  it("đợt 22/09 – 05/10/2026, đúng 14 ngày", () => {
    expect(guideText).toContain("22/09 – 05/10/2026");
    expect(INTERVIEW_WINDOW.firstDateKey).toBe("2026-09-22");
    expect(INTERVIEW_WINDOW.lastDateKey).toBe("2026-10-05");
    expect(guideText).toContain("14 ngày × 15 giờ");
    expect(windowDateKeys()).toHaveLength(14);
    expect(SLOT_LAST_HOUR - SLOT_FIRST_HOUR + 1).toBe(15);
  });

  it("khung 07:00–22:00, mỗi buổi tròn 60 phút", () => {
    expect(guideText).toContain("07:00–22:00");
    expect(guideText).toContain("60 phút");
    expect(SLOT_FIRST_HOUR).toBe(7);
    // Slot cuối bắt đầu 21:00 và kéo dài 60 phút — tức kết thúc 22:00 như hướng dẫn nói.
    expect(SLOT_LAST_HOUR).toBe(21);
  });

  it("nhắc sau mỗi 3 ngày, tối đa 3 lần, lần thứ ba CC hộp thư ban tổ chức", () => {
    expect(guideText).toContain("3 ngày");
    expect(guideText).toContain("tối đa 3 lần");
    expect(REMINDER_INTERVAL_MS).toBe(3 * 24 * 60 * 60_000);
    // 1 thư mời + 3 thư nhắc; lượt gửi thứ tư (nhắc lần 3) là lượt CC.
    expect(MAX_SENDS).toBe(4);
    expect(CC_BTC_ON_SEND_NUMBER).toBe(4);
    expect(guideText).toContain(BTC_EMAIL);
  });

  it("mentor tự đổi lịch khi còn hơn 24 giờ", () => {
    expect(guideText).toContain("hơn 24 giờ");
    expect(MENTOR_CANCEL_CUTOFF_MS).toBe(24 * 60 * 60_000);
  });

  it("hotline Zalo và đường dẫn đặt lịch đúng như hệ thống dùng", () => {
    expect(guideText).toContain(HOTLINE_ZALO);
    expect(guideText).toContain(`${INTERVIEW_BOOKING_PATH_PREFIX}/`);
  });

  it("trang đặt lịch tự cập nhật mỗi 15 giây; vòng tự gửi thư mỗi 20 giây", () => {
    expect(guideText).toContain("15 giây");
    expect(read("app/events/[id]/live-refresh.tsx")).toContain("INTERVAL_MS = 15_000");
    expect(guideText).toContain("20 giây");
    expect(read(PANEL)).toContain("AUTO_TICK_MS = 20_000");
  });
});

describe("những điều hướng dẫn khẳng định về cách hệ thống chạy", () => {
  it("thư chỉ tự đi khi có tab đang mở — vì cron chưa bật CRON_SECRET", () => {
    // Chủ dự án chốt 22/09/2026: không thêm CRON_SECRET. Ngày nào bật cron
    // thật thì câu cảnh báo vàng này phải viết lại — test nhắc đúng chỗ đó.
    expect(guideText).toContain("Thư chỉ tự đi khi có tab đang mở");
    expect(read("app/api/cron/interview-emails/route.ts")).toContain("CRON_SECRET chưa được cấu hình");
  });

  it("phiếu phỏng vấn được giao sẵn cho interviewer của slot — hàm giữ chỗ tự tạo phiếu", () => {
    expect(guideText).toContain("phiếu đã được giao sẵn");
    const migration = read("supabase/migrations/20260922100000_interview_slot_booking.sql");
    expect(migration).toContain("insert into public.application_reviews");
  });

  it("một ứng viên chỉ giữ được một lịch — ai bấm trước được trước", () => {
    expect(guideText).toContain("giữ trước được trước");
    const migration = read("supabase/migrations/20260922100000_interview_slot_booking.sql");
    expect(migration).toContain("interview_bookings_active_app_uidx");
    expect(migration).toContain("for update skip locked");
  });
});

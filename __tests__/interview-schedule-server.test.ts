/**
 * __tests__/interview-schedule-server.test.ts
 *
 * Tầng máy chủ của bộ lịch phỏng vấn, chạy trên bản giả database (xem
 * support/interview-fake-db.ts). Các ca đắt nhất là các ca tranh chấp: gỡ
 * giờ đúng lúc mentor vừa đặt, hai tab cùng bấm gửi thư, Brevo chạm trần
 * ngày — những thứ chỉ lộ ra trên production nếu không dựng lại được ở đây.
 *
 * Đồng hồ được ghim vào 12:00 giờ Việt Nam ngày 23/09/2026 (giữa đợt phỏng
 * vấn) để bộ test không thành bom hẹn giờ khi đợt 22/09–05/10 trôi qua.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.example.org") }));
vi.mock("@/lib/events", () => ({
  isValidUuid: (value: unknown) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""))
}));
vi.mock("@/lib/email", () => ({
  sendInterviewSlotInvite: vi.fn(async () => ({ ok: true, skipped: false })),
  sendInterviewSchedule: vi.fn(async () => ({ ok: true, skipped: false })),
  sendInterviewInvite: vi.fn(async () => ({ ok: true, skipped: false })),
  sendInterviewSlotCancelled: vi.fn(async () => ({ ok: true, skipped: false }))
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendInterviewInvite, sendInterviewSchedule, sendInterviewSlotInvite } from "@/lib/email";
import {
  getBookingPageData,
  getBtcOverview,
  getMyInterviewerSchedule,
  matchMentorAtHour,
  runInterviewInviteDispatch,
  saveInterviewerSlots,
  saveMentorAvailability
} from "@/lib/interview-schedule";
import { FakeDb, clientFor } from "./support/interview-fake-db";

// ── Hằng mẫu (đều đúng khuôn uuid vì mã thật kiểm isValidUuid) ───────────────

const SEASON = "00000000-0000-4000-b000-000000000001";
const ADMIN_CT = "00000000-0000-4000-d000-000000000001";
const ADMIN_RV = "00000000-0000-4000-d000-000000000002";
const APP_A = "00000000-0000-4000-a000-000000000001";
const APP_B = "00000000-0000-4000-a000-000000000002";
const TOKEN_A = "00000000-0000-4000-c000-000000000001";

// Đồng hồ ghim: 12:00 giờ Việt Nam ngày 23/09/2026.
const NOW = "2026-09-23T05:00:00.000Z";
// Các ô lưới tương lai so với NOW.
const H_24_09 = "2026-09-24T02:00:00.000Z"; // 09:00 VN 24/09
const H_24_10 = "2026-09-24T03:00:00.000Z"; // 10:00 VN 24/09
const H_26_15 = "2026-09-26T08:00:00.000Z"; // 15:00 VN 26/09
const H_TODAY_17 = "2026-09-23T10:00:00.000Z"; // 17:00 VN hôm nay — còn dưới 24h

const DAY_MS = 24 * 60 * 60_000;

let db: FakeDb;
let rpc: Mock;

function coreTeamActor() {
  (getCurrentAdminUser as Mock).mockResolvedValue({
    id: ADMIN_CT,
    email: "core@example.com",
    full_name: "Chị Core Team",
    role: "core_team",
    status: "active",
    auth_user_id: "auth-1"
  });
}

function reviewerActor() {
  (getCurrentAdminUser as Mock).mockResolvedValue({
    id: ADMIN_RV,
    email: "reviewer@example.com",
    full_name: "Anh Reviewer",
    role: "reviewer",
    status: "active",
    auth_user_id: "auth-2"
  });
}

function seedBase() {
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12" }];
  db.tables.admin_users = [
    { id: ADMIN_CT, full_name: "Chị Core Team", email: "core@example.com" },
    { id: ADMIN_RV, full_name: "Anh Reviewer", email: "reviewer@example.com" }
  ];
  db.tables.applications = [
    {
      id: APP_A,
      season_id: SEASON,
      role_applied: "mentor",
      source: "vam_os_form",
      status: "submitted",
      full_name: "Nguyễn Văn A",
      email_primary: "a@example.com",
      phone_primary: "0900000001"
    },
    {
      id: APP_B,
      season_id: SEASON,
      role_applied: "mentor",
      source: "vam_os_form",
      status: "screening_in_progress",
      full_name: "Trần Thị B",
      email_primary: "b@example.com",
      phone_primary: "0900000002"
    }
  ];
}

function seedProfile() {
  db.tables.interviewer_profiles = [{ id: "p1", admin_user_id: ADMIN_CT, phone: "0912345678" }];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  db = new FakeDb();
  rpc = vi.fn(async () => ({ data: true, error: null }));
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(clientFor(db, rpc));
  seedBase();
  coreTeamActor();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("1. cổng quyền interviewer", () => {
  it("reviewer chưa được cấp vai trò interviewer thì bị chặn — và phép hỏi đi qua database", async () => {
    reviewerActor();
    rpc.mockResolvedValue({ data: false, error: null });
    const result = await getMyInterviewerSchedule();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("người phỏng vấn");
    expect(rpc).toHaveBeenCalledWith("vam084_participant_for_stage", {
      p_admin_user_id: ADMIN_RV,
      p_season_id: SEASON,
      p_review_stage: "interview"
    });
  });

  it("reviewer đã được cấp thì vào được lưới", async () => {
    reviewerActor();
    rpc.mockResolvedValue({ data: true, error: null });
    const result = await getMyInterviewerSchedule();
    expect(result.ok).toBe(true);
  });

  it("core team vào thẳng, không cần hỏi database", async () => {
    const result = await getMyInterviewerSchedule();
    expect(result.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.days).toHaveLength(14);
      expect(result.needsPhone).toBe(true);
    }
  });
});

describe("2. lưu giờ rảnh", () => {
  it("lần đầu chưa có số điện thoại thì từ chối, không ghi slot nào", async () => {
    const result = await saveInterviewerSlots({ phone: "", add: [H_24_09], remove: [] });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("số điện thoại");
    expect(db.rows("interview_slots")).toHaveLength(0);
  });

  it("số điện thoại sai khuôn 10 chữ số thì từ chối", async () => {
    const result = await saveInterviewerSlots({ phone: "12345", add: [H_24_09], remove: [] });
    expect(result.ok).toBe(false);
    expect(db.rows("interview_slots")).toHaveLength(0);
  });

  it("lưu hợp lệ: ghi hồ sơ SĐT và các ô open", async () => {
    const result = await saveInterviewerSlots({ phone: "0912345678", add: [H_24_09, H_24_10], remove: [] });
    expect(result.ok).toBe(true);
    expect(db.rows("interviewer_profiles")).toHaveLength(1);
    const slots = db.rows("interview_slots");
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.status === "open" && slot.admin_user_id === ADMIN_CT)).toBe(true);
  });

  it("giờ ngoài đợt hoặc đã qua thì từ chối cả gói", async () => {
    seedProfile();
    const past = await saveInterviewerSlots({ phone: "", add: ["2026-09-22T02:00:00.000Z"], remove: [] });
    expect(past.ok).toBe(false);
    const outside = await saveInterviewerSlots({ phone: "", add: ["2026-10-06T02:00:00.000Z"], remove: [] });
    expect(outside.ok).toBe(false);
    expect(db.rows("interview_slots")).toHaveLength(0);
  });

  it("đăng lại giờ đã gỡ: MỘT dòng duy nhất quay về open, xếp lại cuối hàng FIFO", async () => {
    seedProfile();
    db.tables.interview_slots = [
      {
        id: "s1",
        season_id: SEASON,
        admin_user_id: ADMIN_CT,
        slot_starts_at: H_24_09,
        status: "removed",
        booked_application_id: null,
        available_since: "2026-09-20T00:00:00.000Z",
        removed_at: "2026-09-21T00:00:00.000Z"
      }
    ];
    const result = await saveInterviewerSlots({ phone: "", add: [H_24_09], remove: [] });
    expect(result.ok).toBe(true);
    const slots = db.rows("interview_slots");
    expect(slots).toHaveLength(1);
    expect(slots[0].status).toBe("open");
    // Rút lời rồi đăng lại thì xếp cuối hàng: available_since phải được đặt mới.
    expect(slots[0].available_since).toBe(NOW);
    expect(slots[0].removed_at).toBeNull();
  });

  it("RACE gỡ-vs-đặt: ô vừa được mentor giữ thì không gỡ được, và phải nói rõ", async () => {
    seedProfile();
    db.tables.interview_slots = [
      {
        id: "s1",
        season_id: SEASON,
        admin_user_id: ADMIN_CT,
        slot_starts_at: H_24_09,
        status: "booked",
        booked_application_id: APP_A,
        available_since: "2026-09-20T00:00:00.000Z",
        removed_at: null
      }
    ];
    const result = await saveInterviewerSlots({ phone: "", add: [], remove: [H_24_09] });
    expect(result.ok).toBe(true);
    expect(result.blockedRemovals).toEqual([H_24_09]);
    expect(result.message).toContain("không gỡ được");
    expect(db.rows("interview_slots")[0].status).toBe("booked");
  });

  it("đăng thêm giờ trùng ô đang booked cũng không đè được buổi hẹn", async () => {
    seedProfile();
    db.tables.interview_slots = [
      {
        id: "s1",
        season_id: SEASON,
        admin_user_id: ADMIN_CT,
        slot_starts_at: H_24_09,
        status: "booked",
        booked_application_id: APP_A,
        available_since: "2026-09-20T00:00:00.000Z",
        removed_at: null
      }
    ];
    const result = await saveInterviewerSlots({ phone: "", add: [H_24_09], remove: [] });
    expect(result.ok).toBe(true);
    const slots = db.rows("interview_slots");
    expect(slots).toHaveLength(1);
    expect(slots[0].status).toBe("booked");
  });
});

describe("3. trang đặt lịch công khai", () => {
  function seedInvite() {
    db.tables.interview_slot_invites = [{ id: "i1", application_id: APP_A, token: TOKEN_A, send_count: 0, first_sent_at: null, last_sent_at: null, claimed_at: null, last_error: null }];
  }

  it("mã sai khuôn hoặc không tồn tại → thẻ đường dẫn hỏng", async () => {
    expect((await getBookingPageData("khong-phai-uuid")).state).toBe("invalid");
    expect((await getBookingPageData(TOKEN_A)).state).toBe("invalid");
  });

  it("đủ điều kiện: đếm đúng số chỗ trống từng khung giờ — 2 người rảnh 15:00 là còn 2 chỗ", async () => {
    seedInvite();
    db.tables.interview_slots = [
      { id: "s1", season_id: SEASON, admin_user_id: ADMIN_CT, slot_starts_at: H_26_15, status: "open", available_since: "x", booked_application_id: null },
      { id: "s2", season_id: SEASON, admin_user_id: ADMIN_RV, slot_starts_at: H_26_15, status: "open", available_since: "y", booked_application_id: null },
      { id: "s3", season_id: SEASON, admin_user_id: ADMIN_CT, slot_starts_at: H_24_10, status: "open", available_since: "z", booked_application_id: null },
      // Ô đã bị giữ và ô đã gỡ không được đếm.
      { id: "s4", season_id: SEASON, admin_user_id: ADMIN_RV, slot_starts_at: H_24_09, status: "booked", available_since: "t", booked_application_id: APP_B },
      { id: "s5", season_id: SEASON, admin_user_id: ADMIN_RV, slot_starts_at: H_24_10, status: "removed", available_since: "u", booked_application_id: null }
    ];
    const page = await getBookingPageData(TOKEN_A);
    expect(page.state).toBe("eligible");
    if (page.ok && page.state === "eligible") {
      expect(page.totalOpen).toBe(3);
      const hours = page.days.flatMap((day) => day.hours);
      expect(hours.find((hour) => hour.startsAtIso === H_26_15)?.openCount).toBe(2);
      expect(hours.find((hour) => hour.startsAtIso === H_24_10)?.openCount).toBe(1);
      expect(hours.find((hour) => hour.startsAtIso === H_24_09)).toBeUndefined();
    }
  });

  it("đã có lịch: còn hơn 24 giờ thì tự huỷ được", async () => {
    seedInvite();
    db.tables.interview_bookings = [
      { id: "b1", application_id: APP_A, slot_id: "s1", interviewer_admin_user_id: ADMIN_CT, review_id: "r1", slot_starts_at: H_26_15, status: "booked", previous_application_status: "submitted" }
    ];
    seedProfile();
    const page = await getBookingPageData(TOKEN_A);
    expect(page.state).toBe("booked");
    if (page.ok && page.state === "booked") {
      expect(page.booking.canCancel).toBe(true);
      expect(page.booking.interviewerName).toBe("Chị Core Team");
      expect(page.booking.interviewerPhone).toBe("0912345678");
    }
  });

  it("đã có lịch trong vòng 24 giờ tới: chỉ còn đường hotline", async () => {
    seedInvite();
    db.tables.interview_bookings = [
      { id: "b1", application_id: APP_A, slot_id: "s1", interviewer_admin_user_id: ADMIN_CT, review_id: "r1", slot_starts_at: H_TODAY_17, status: "booked", previous_application_status: "submitted" }
    ];
    const page = await getBookingPageData(TOKEN_A);
    expect(page.state).toBe("booked");
    if (page.ok && page.state === "booked") expect(page.booking.canCancel).toBe(false);
  });

  it("đơn đã có phiếu phỏng vấn của người khác → không cho đặt", async () => {
    seedInvite();
    db.tables.application_reviews = [
      { id: "r-la", application_id: APP_A, review_round: "interview", status: "assigned" }
    ];
    const page = await getBookingPageData(TOKEN_A);
    expect(page.state).toBe("ineligible");
  });
});

describe("4. bộ gửi thư mời/nhắc", () => {
  function seedOpenSlot() {
    db.tables.interview_slots = [
      { id: "s1", season_id: SEASON, admin_user_id: ADMIN_CT, slot_starts_at: H_26_15, status: "open", available_since: "x", booked_application_id: null }
    ];
  }

  it("chưa có giờ trống nào thì không gửi gì và không cấp mã", async () => {
    const result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(0);
    expect(sendInterviewSlotInvite).not.toHaveBeenCalled();
    expect(db.rows("interview_slot_invites")).toHaveLength(0);
  });

  it("có giờ trống: cấp mã và gửi thư mời đầu cho mọi mentor chưa đặt", async () => {
    seedOpenSlot();
    const result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(2);
    expect(sendInterviewSlotInvite).toHaveBeenCalledTimes(2);
    const call = (sendInterviewSlotInvite as Mock).mock.calls[0][0];
    expect(call.reminderNumber).toBe(0);
    expect(call.ccBtc).toBe(false);
    const invites = db.rows("interview_slot_invites");
    expect(invites).toHaveLength(2);
    expect(invites.every((row) => row.send_count === 1 && row.last_sent_at === NOW && row.claimed_at === null)).toBe(true);
  });

  it("nhịp 3 ngày: mới 2 ngày thì im, đủ 3 ngày thì nhắc lần 1", async () => {
    seedOpenSlot();
    db.tables.applications = db.tables.applications.filter((row) => row.id === APP_A);
    db.tables.interview_slot_invites = [
      { id: "i1", application_id: APP_A, token: TOKEN_A, send_count: 1, first_sent_at: NOW, last_sent_at: new Date(Date.parse(NOW) - 2 * DAY_MS).toISOString(), claimed_at: null, last_error: null }
    ];
    let result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.sent).toBe(0);
    expect(sendInterviewSlotInvite).not.toHaveBeenCalled();

    db.rows("interview_slot_invites")[0].last_sent_at = new Date(Date.parse(NOW) - 3 * DAY_MS).toISOString();
    result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.sent).toBe(1);
    const call = (sendInterviewSlotInvite as Mock).mock.calls[0][0];
    expect(call.reminderNumber).toBe(1);
    expect(call.ccBtc).toBe(false);
  });

  it("lượt gửi thứ tư (nhắc lần 3) CC ban tổ chức, và sau đó im hẳn", async () => {
    seedOpenSlot();
    db.tables.applications = db.tables.applications.filter((row) => row.id === APP_A);
    db.tables.interview_slot_invites = [
      { id: "i1", application_id: APP_A, token: TOKEN_A, send_count: 3, first_sent_at: NOW, last_sent_at: new Date(Date.parse(NOW) - 3 * DAY_MS).toISOString(), claimed_at: null, last_error: null }
    ];
    let result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.sent).toBe(1);
    expect((sendInterviewSlotInvite as Mock).mock.calls[0][0].ccBtc).toBe(true);
    expect(db.rows("interview_slot_invites")[0].send_count).toBe(4);

    (sendInterviewSlotInvite as Mock).mockClear();
    db.rows("interview_slot_invites")[0].last_sent_at = new Date(Date.parse(NOW) - 30 * DAY_MS).toISOString();
    result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.sent).toBe(0);
    expect(sendInterviewSlotInvite).not.toHaveBeenCalled();
  });

  it("HAI TAB cùng bấm: tập gửi rời nhau, không ai nhận hai thư", async () => {
    seedOpenSlot();
    const [first, second] = await Promise.all([
      runInterviewInviteDispatch({ source: "manual" }),
      runInterviewInviteDispatch({ source: "manual" })
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Hai mentor — đúng hai lá thư giữa cả hai tab cộng lại.
    expect(first.sent + second.sent).toBe(2);
    expect(sendInterviewSlotInvite).toHaveBeenCalledTimes(2);
    const invites = db.rows("interview_slot_invites");
    expect(invites.every((row) => row.send_count === 1)).toBe(true);
  });

  it("Brevo chạm trần ngày (429): dừng vòng, nhả claim, không đốt lượt của ai", async () => {
    seedOpenSlot();
    (sendInterviewSlotInvite as Mock).mockResolvedValue({ ok: false, skipped: false, providerStatus: 429, reason: "Brevo HTTP 429" });
    const result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.stopped429).toBe(true);
    expect(sendInterviewSlotInvite).toHaveBeenCalledTimes(1);
    const invites = db.rows("interview_slot_invites");
    expect(invites.every((row) => row.claimed_at === null)).toBe(true);
    expect(invites.every((row) => row.send_count === 0)).toBe(true);
  });

  it("thư bị cổng môi trường chặn thì KHÔNG đốt lượt — chuỗi mời-nhắc còn nguyên cho production", async () => {
    seedOpenSlot();
    (sendInterviewSlotInvite as Mock).mockResolvedValue({ ok: true, skipped: true, reason: "Gate off" });
    const result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.sent).toBe(0);
    const invites = db.rows("interview_slot_invites");
    expect(invites.every((row) => row.send_count === 0 && row.claimed_at === null)).toBe(true);
  });

  it("mentor đã đặt lịch thì không nhận thêm thư nào", async () => {
    seedOpenSlot();
    db.tables.applications = db.tables.applications.filter((row) => row.id === APP_A);
    db.tables.application_reviews = [
      { id: "r1", application_id: APP_A, review_round: "interview", status: "assigned" }
    ];
    db.tables.interview_bookings = [
      { id: "b1", application_id: APP_A, slot_id: "s9", interviewer_admin_user_id: ADMIN_CT, review_id: "r1", slot_starts_at: H_26_15, status: "booked", previous_application_status: "submitted" }
    ];
    const result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.sent).toBe(0);
    expect(sendInterviewSlotInvite).not.toHaveBeenCalled();
  });

  it("claim mồ côi quá 10 phút được thu hồi và gửi tiếp", async () => {
    seedOpenSlot();
    db.tables.applications = db.tables.applications.filter((row) => row.id === APP_A);
    db.tables.interview_slot_invites = [
      { id: "i1", application_id: APP_A, token: TOKEN_A, send_count: 0, first_sent_at: null, last_sent_at: null, claimed_at: new Date(Date.parse(NOW) - 11 * 60_000).toISOString(), last_error: null }
    ];
    const result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.sent).toBe(1);
  });

  it("support_team không kích được bộ gửi", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ADMIN_CT, email: "s@x", full_name: "S", role: "support_team", status: "active", auth_user_id: "a" });
    const result = await runInterviewInviteDispatch({ source: "manual" });
    expect(result.ok).toBe(false);
    expect(sendInterviewSlotInvite).not.toHaveBeenCalled();
  });
});

describe("5. tổng quan ban tổ chức", () => {
  it("đếm giờ trống tương lai và chia mentor theo lịch hẹn", async () => {
    db.tables.interview_slots = [
      { id: "s1", season_id: SEASON, admin_user_id: ADMIN_CT, slot_starts_at: H_26_15, status: "open", available_since: "x", booked_application_id: null },
      { id: "s2", season_id: SEASON, admin_user_id: ADMIN_CT, slot_starts_at: "2026-09-22T02:00:00.000Z", status: "open", available_since: "x", booked_application_id: null },
      { id: "s3", season_id: SEASON, admin_user_id: ADMIN_CT, slot_starts_at: H_24_09, status: "booked", available_since: "x", booked_application_id: APP_A }
    ];
    db.tables.application_reviews = [
      { id: "r1", application_id: APP_A, review_round: "interview", status: "assigned" }
    ];
    db.tables.interview_bookings = [
      { id: "b1", application_id: APP_A, slot_id: "s3", interviewer_admin_user_id: ADMIN_CT, review_id: "r1", slot_starts_at: H_24_09, status: "booked", previous_application_status: "submitted" }
    ];
    const overview = await getBtcOverview();
    expect(overview.ok).toBe(true);
    if (overview.ok) {
      // s1 tương lai còn trống; s2 đã trôi qua không tính.
      expect(overview.openFutureHours).toBe(1);
      expect(overview.mentors.eligibleTotal).toBe(2);
      expect(overview.mentors.notBooked).toBe(1);
      expect(overview.mentors.bookedUpcoming).toBe(1);
      expect(overview.upcomingBookings).toHaveLength(1);
      expect(overview.upcomingBookings[0].candidateName).toBe("Nguyễn Văn A");
      expect(overview.upcomingBookings[0].interviewerName).toBe("Chị Core Team");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Chiều ngược: mentor khai giờ rảnh, interviewer ghép
// ─────────────────────────────────────────────────────────────────────────────

function seedInvite(applicationId = APP_A, token = TOKEN_A) {
  db.tables.interview_slot_invites = [
    { id: "inv-1", application_id: applicationId, token, send_count: 1, claimed_at: null }
  ];
}

describe("7. mentor chọn một giờ rảnh", () => {
  /** Các lời ngỏ đang mở của một đơn — đúng thứ interviewer sẽ nhìn thấy. */
  function openHours(applicationId = APP_A) {
    return db
      .rows("interview_mentor_availability")
      .filter((row) => row.application_id === applicationId && row.status === "open")
      .map((row) => row.slot_starts_at);
  }

  it("ghi đúng mùa của đơn và để trạng thái mở — chưa phải là lịch hẹn", async () => {
    seedInvite();
    const result = await saveMentorAvailability({ token: TOKEN_A, slotStartsAt: H_24_09 });
    expect(result.ok).toBe(true);
    const rows = db.rows("interview_mentor_availability");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("open");
    expect(rows[0].season_id).toBe(SEASON);
    expect(rows[0].application_id).toBe(APP_A);
    // Không được đẻ ra dòng giữ chỗ nào — đây chỉ là lời ngỏ.
    expect(db.rows("interview_bookings")).toHaveLength(0);
  });

  it("chọn giờ khác thì giờ cũ tự bỏ — một mentor chỉ giữ MỘT lời ngỏ", async () => {
    // Luật do chủ dự án chốt 23/09/2026, và database canh bằng chỉ số bộ phận
    // trên (application_id) where status='open'. Ca này giữ tầng ứng dụng không
    // bao giờ cố ghi dòng thứ hai để rồi vấp 23505 trước mặt người dùng.
    seedInvite();
    await saveMentorAvailability({ token: TOKEN_A, slotStartsAt: H_24_09 });
    await saveMentorAvailability({ token: TOKEN_A, slotStartsAt: H_26_15 });

    expect(openHours()).toEqual([H_26_15]);
    const old = db.rows("interview_mentor_availability").find((row) => row.slot_starts_at === H_24_09);
    expect(old?.status).toBe("removed");
  });

  it("gửi chuỗi rỗng là thôi không chờ nữa", async () => {
    seedInvite();
    await saveMentorAvailability({ token: TOKEN_A, slotStartsAt: H_24_09 });
    const result = await saveMentorAvailability({ token: TOKEN_A, slotStartsAt: "" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Đã bỏ giờ");
    expect(openHours()).toEqual([]);
  });

  it("chọn lại đúng giờ từng được ghép rồi huỷ thì mở lại được, và cắt liên kết buổi hẹn cũ", async () => {
    seedInvite();
    db.tables.interview_mentor_availability = [
      {
        id: "av-1",
        application_id: APP_A,
        season_id: SEASON,
        slot_starts_at: H_24_09,
        status: "matched",
        matched_booking_id: "bk-cu"
      }
    ];
    const result = await saveMentorAvailability({ token: TOKEN_A, slotStartsAt: H_24_09 });
    expect(result.ok).toBe(true);
    const row = db.rows("interview_mentor_availability").find((item) => item.id === "av-1");
    expect(row?.status).toBe("open");
    // Ràng buộc của database: chỉ dòng 'matched' mới được trỏ về một buổi hẹn.
    expect(row?.matched_booking_id).toBeNull();
  });

  it("người đã có lịch thì không khai được nữa", async () => {
    seedInvite();
    db.tables.interview_bookings = [
      { id: "bk-1", application_id: APP_A, slot_id: "s1", status: "booked", slot_starts_at: H_24_10 }
    ];
    const result = await saveMentorAvailability({ token: TOKEN_A, slotStartsAt: H_24_09 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã có một lịch trao đổi");
    expect(db.rows("interview_mentor_availability")).toHaveLength(0);
  });

  it("đường dẫn lạ thì không ghi gì cả", async () => {
    seedInvite();
    const result = await saveMentorAvailability({
      token: "00000000-0000-4000-c000-000000009999",
      slotStartsAt: H_24_09
    });
    expect(result.ok).toBe(false);
    expect(db.rows("interview_mentor_availability")).toHaveLength(0);
  });
});

describe("8. interviewer nhìn thấy ai đang chờ", () => {
  it("đếm theo khung giờ, và người đã có lịch không còn là nhu cầu", async () => {
    seedProfile();
    const APP_C = "00000000-0000-4000-a000-000000000003";
    db.tables.applications.push({
      id: APP_C,
      season_id: SEASON,
      role_applied: "mentor",
      source: "vam_os_form",
      status: "submitted",
      full_name: "Lê Văn C",
      email_primary: "c@example.com",
      phone_primary: "0900000003"
    });
    // Mỗi người đúng MỘT lời ngỏ — luật một-giờ-một-người.
    db.tables.interview_mentor_availability = [
      { id: "av-1", application_id: APP_A, season_id: SEASON, slot_starts_at: H_26_15, status: "open" },
      { id: "av-2", application_id: APP_B, season_id: SEASON, slot_starts_at: H_26_15, status: "open" },
      { id: "av-3", application_id: APP_C, season_id: SEASON, slot_starts_at: H_24_09, status: "open" }
    ];
    // APP_A đã tự giữ chỗ qua link riêng — giờ họ khai không được đếm nữa.
    db.tables.interview_bookings = [
      { id: "bk-1", application_id: APP_A, slot_id: "s1", status: "booked", slot_starts_at: H_24_10 }
    ];

    const schedule = await getMyInterviewerSchedule();
    expect(schedule.ok).toBe(true);
    if (schedule.ok) {
      // Còn hai người chờ: APP_B ở 15:00 26/09, APP_C ở 09:00 24/09.
      expect(schedule.waitingTotal).toBe(2);
      const hours = schedule.waiting.flatMap((day) => day.hours);
      expect(hours).toEqual([
        { startsAtIso: H_24_09, hour: 9, waitingCount: 1 },
        { startsAtIso: H_26_15, hour: 15, waitingCount: 1 }
      ]);
    }
  });
});

describe("9. interviewer bấm ghép", () => {
  it("mã lỗi của database được dịch thành câu người đọc hiểu", async () => {
    seedProfile();
    rpc.mockResolvedValue({ data: { ok: false, code: "no_mentor_waiting" }, error: null });
    const result = await matchMentorAtHour({ slotStartsAt: H_26_15 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("vừa hết người chờ");
  });

  it("ghép xong gửi đúng ba lá thư: interviewer, mentor, ban tổ chức", async () => {
    seedProfile();
    seedInvite();
    rpc.mockResolvedValue({
      data: {
        ok: true,
        booking_id: "bk-9",
        review_id: "rv-9",
        slot_starts_at: H_26_15,
        previous_status: "submitted",
        interviewer: {
          admin_user_id: ADMIN_CT,
          full_name: "Chị Core Team",
          email: "core@example.com",
          phone: "0912345678"
        },
        candidate: {
          application_id: APP_A,
          full_name: "Nguyễn Văn A",
          email: "a@example.com",
          phone: "0900000001"
        }
      },
      error: null
    });

    const result = await matchMentorAtHour({ slotStartsAt: H_26_15 });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Nguyễn Văn A");

    expect(rpc).toHaveBeenCalledWith("vam099_match_mentor_at_hour", {
      p_actor: ADMIN_CT,
      p_slot_starts_at: H_26_15
    });
    // Hai lá qua sendInterviewSchedule (interviewer + ban tổ chức), một lá qua
    // sendInterviewInvite (mentor, kèm đường tự đổi lịch).
    expect((sendInterviewSchedule as Mock).mock.calls.map((call) => call[0].toEmail)).toEqual([
      "core@example.com",
      "hello@alumni-mentoring.edu.vn"
    ]);
    expect((sendInterviewInvite as Mock).mock.calls).toHaveLength(1);
    expect((sendInterviewInvite as Mock).mock.calls[0][0].toEmail).toBe("a@example.com");
    expect((sendInterviewInvite as Mock).mock.calls[0][0].bookingToken).toBe(TOKEN_A);
  });

  it("giờ đã trôi qua thì chặn ngay ở tầng ứng dụng, không phiền database", async () => {
    seedProfile();
    const result = await matchMentorAtHour({ slotStartsAt: "2026-09-22T02:00:00.000Z" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalledWith("vam099_match_mentor_at_hour", expect.anything());
  });
});

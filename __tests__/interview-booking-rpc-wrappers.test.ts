/**
 * __tests__/interview-booking-rpc-wrappers.test.ts
 *
 * Lớp vỏ TypeScript quanh ba hàm vam098: dịch mã lỗi jsonb thành câu tiếng
 * Việt, gửi đúng bộ thư sau khi database đã chốt, và không bao giờ để một lá
 * thư hỏng làm mentor tưởng mình chưa có lịch. Bản thân phép giữ chỗ nguyên
 * tử nằm trong SQL — được khẳng định ở interview-slot-booking-migration.
 */
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

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
import {
  sendInterviewInvite,
  sendInterviewSchedule,
  sendInterviewSlotCancelled
} from "@/lib/email";
import {
  bookInterviewSlot,
  cancelInterviewBookingByBtc,
  cancelInterviewBookingByMentor
} from "@/lib/interview-schedule";
import { BTC_EMAIL } from "@/lib/interview-schedule-core";
import { FakeDb, clientFor } from "./support/interview-fake-db";

const SEASON = "00000000-0000-4000-b000-000000000001";
const TOKEN = "00000000-0000-4000-c000-000000000001";
const APP_A = "00000000-0000-4000-a000-000000000001";
const BOOKING = "00000000-0000-4000-e000-000000000001";
const NOW = "2026-09-23T05:00:00.000Z";
const SLOT = "2026-09-26T08:00:00.000Z"; // 15:00 VN 26/09 — trong đợt, tương lai

const RPC_OK_PAYLOAD = {
  ok: true,
  booking_id: BOOKING,
  review_id: "00000000-0000-4000-f000-000000000001",
  slot_starts_at: SLOT,
  previous_status: "submitted",
  interviewer: {
    admin_user_id: "00000000-0000-4000-d000-000000000001",
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
};

let db: FakeDb;
let rpc: Mock;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  db = new FakeDb();
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12" }];
  db.tables.interview_slot_invites = [
    { id: "i1", application_id: APP_A, token: TOKEN, send_count: 1, first_sent_at: NOW, last_sent_at: NOW, claimed_at: null, last_error: null }
  ];
  rpc = vi.fn(async () => ({ data: RPC_OK_PAYLOAD, error: null }));
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(clientFor(db, rpc));
  (getCurrentAdminUser as Mock).mockResolvedValue({
    id: "00000000-0000-4000-d000-000000000009",
    email: "admin@example.com",
    full_name: "Chị Admin",
    role: "admin",
    status: "active",
    auth_user_id: "auth-9"
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("1. giữ chỗ", () => {
  it("thành công: gọi đúng RPC và gửi ĐÚNG BA lá thư — interviewer, mentor, ban tổ chức", async () => {
    const result = await bookInterviewSlot({ token: TOKEN, slotStartsAt: SLOT });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("vam098_book_interview_slot", {
      p_token: TOKEN,
      p_slot_starts_at: SLOT
    });

    // Interviewer + bản BTC đi qua cùng một hàm dựng.
    expect(sendInterviewSchedule).toHaveBeenCalledTimes(2);
    const scheduleCalls = (sendInterviewSchedule as Mock).mock.calls.map((call) => call[0]);
    expect(scheduleCalls[0].toEmail).toBe("core@example.com");
    expect(scheduleCalls[0].candidatePhone).toBe("0900000001");
    // Mang review_id của phiếu vừa tạo, để sendInterviewSchedule dựng được
    // đường link mở THẲNG hồ sơ ứng viên trong thân thư — không phải /reviews.
    expect(scheduleCalls[0].reviewId).toBe(RPC_OK_PAYLOAD.review_id);
    expect(scheduleCalls[1].toEmail).toBe(BTC_EMAIL);

    expect(sendInterviewInvite).toHaveBeenCalledTimes(1);
    const inviteCall = (sendInterviewInvite as Mock).mock.calls[0][0];
    expect(inviteCall.toEmail).toBe("a@example.com");
    expect(inviteCall.interviewerPhone).toBe("0912345678");
    expect(inviteCall.bookingToken).toBe(TOKEN);
  });

  it("slot_full → câu mời chọn giờ khác, không phải lỗi hệ thống", async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: "slot_full" }, error: null });
    const result = await bookInterviewSlot({ token: TOKEN, slotStartsAt: SLOT });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("vừa có người giữ trước");
    expect(sendInterviewSchedule).not.toHaveBeenCalled();
  });

  it("already_booked và application_not_eligible có câu riêng", async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: "already_booked" }, error: null });
    expect((await bookInterviewSlot({ token: TOKEN, slotStartsAt: SLOT })).message).toContain("đang hiệu lực");
    rpc.mockResolvedValue({ data: { ok: false, code: "application_not_eligible" }, error: null });
    expect((await bookInterviewSlot({ token: TOKEN, slotStartsAt: SLOT })).message).toContain("không ở bước đặt lịch");
  });

  it("giờ không phải ô lưới thì từ chối TRƯỚC khi gọi database", async () => {
    const result = await bookInterviewSlot({ token: TOKEN, slotStartsAt: "2026-09-26T08:30:00.000Z" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("thư hỏng không làm hỏng việc giữ chỗ", async () => {
    (sendInterviewSchedule as Mock).mockRejectedValue(new Error("Brevo chết"));
    const result = await bookInterviewSlot({ token: TOKEN, slotStartsAt: SLOT });
    expect(result.ok).toBe(true);
  });
});

describe("2. mentor tự huỷ", () => {
  it("thành công: hai lá thư báo huỷ, bản mentor mang mã đặt lại, bản interviewer thì không", async () => {
    rpc.mockResolvedValue({ data: { ...RPC_OK_PAYLOAD, restored_status: "submitted" }, error: null });
    const result = await cancelInterviewBookingByMentor({ token: TOKEN });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("vam098_cancel_interview_booking_mentor", { p_token: TOKEN });

    expect(sendInterviewSlotCancelled).toHaveBeenCalledTimes(2);
    const calls = (sendInterviewSlotCancelled as Mock).mock.calls.map((call) => call[0]);
    const toCandidate = calls.find((call) => call.audience === "candidate");
    const toInterviewer = calls.find((call) => call.audience === "interviewer");
    expect(toCandidate?.bookingToken).toBe(TOKEN);
    expect(toInterviewer?.bookingToken).toBeUndefined();
  });

  it("inside_24h → chỉ đường hotline, không phải lỗi", async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: "inside_24h" }, error: null });
    const result = await cancelInterviewBookingByMentor({ token: TOKEN });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("0919144638");
    expect(sendInterviewSlotCancelled).not.toHaveBeenCalled();
  });

  it("already_completed → nói rõ kết quả đã có", async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: "already_completed" }, error: null });
    expect((await cancelInterviewBookingByMentor({ token: TOKEN })).message).toContain("đã có kết quả");
  });
});

describe("3. ban tổ chức huỷ", () => {
  it("gọi RPC với đúng người thao tác và ghi chú", async () => {
    rpc.mockResolvedValue({ data: { ...RPC_OK_PAYLOAD, restored_status: "submitted" }, error: null });
    const result = await cancelInterviewBookingByBtc({ bookingId: BOOKING, note: "Interviewer bận đột xuất" });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("vam098_cancel_interview_booking_btc", {
      p_booking_id: BOOKING,
      p_actor: "00000000-0000-4000-d000-000000000009",
      p_note: "Interviewer bận đột xuất"
    });
    expect(sendInterviewSlotCancelled).toHaveBeenCalledTimes(2);
  });

  it("vai trò không đủ thì dừng TRƯỚC khi chạm database", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({
      id: "00000000-0000-4000-d000-000000000008",
      email: "support@example.com",
      full_name: "Bạn Support",
      role: "support_team",
      status: "active",
      auth_user_id: "auth-8"
    });
    const result = await cancelInterviewBookingByBtc({ bookingId: BOOKING });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("mã lịch hẹn không phải uuid thì từ chối, không gọi RPC", async () => {
    const result = await cancelInterviewBookingByBtc({ bookingId: "b1-khong-uuid" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

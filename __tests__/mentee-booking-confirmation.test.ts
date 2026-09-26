/**
 * __tests__/mentee-booking-confirmation.test.ts
 *
 * Thư xác nhận sau khi mentee giữ chỗ hoặc đổi ca.
 *
 * ---------------------------------------------------------------------------
 * ĐIỀU CANH CHÍNH: THƯ HỎNG KHÔNG LÀM HỎNG VIỆC GIỮ CHỖ
 * ---------------------------------------------------------------------------
 * Chỗ đã giữ trong database rồi thì là đã giữ. Báo "đặt ca thất bại" chỉ vì nhà
 * cung cấp thư không trả lời sẽ khiến người dùng bấm lại — và lần bấm thứ hai
 * bị từ chối vì họ ĐÃ có chỗ, trông y như hệ thống hỏng. Với gói 300 thư/ngày,
 * chuyện thư xác nhận chạm trần là có thật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseServiceRoleClient: vi.fn(),
  sendMenteeSessionConfirmed: vi.fn(),
  getPublicOrigin: vi.fn(),
  rpc: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: mocks.getSupabaseServiceRoleClient }));
vi.mock("@/lib/email", () => ({ sendMenteeSessionConfirmed: mocks.sendMenteeSessionConfirmed }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: mocks.getPublicOrigin }));

import { bookMenteeSession, changeMenteeSession } from "@/lib/mentee-interview";
import { MENTEE_VENUE_PENDING_LABEL } from "@/lib/mentee-interview-core";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

function okPayload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    starts_at: "2026-10-03T01:00:00.000Z",
    ends_at: "2026-10-03T01:30:00.000Z",
    venue: "Phòng B2-208",
    candidate: { application_id: "app-1", full_name: "Nguyễn Văn A", email: "a@example.test", phone: null },
    ...over
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSupabaseServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: okPayload(), error: null });
  mocks.sendMenteeSessionConfirmed.mockResolvedValue({ ok: true, skipped: false });
  mocks.getPublicOrigin.mockResolvedValue("https://os.alumni-mentoring.edu.vn");
});

describe("1. giữ chỗ thành công thì gửi thư xác nhận", () => {
  it("thư mang đúng người, đúng ca, đúng địa điểm, đúng mã link", async () => {
    const result = await bookMenteeSession({ token: TOKEN, sessionId: SESSION });

    expect(result.ok).toBe(true);
    expect(mocks.sendMenteeSessionConfirmed).toHaveBeenCalledTimes(1);
    const sent = mocks.sendMenteeSessionConfirmed.mock.calls[0][0];
    expect(sent.toEmail).toBe("a@example.test");
    expect(sent.candidateName).toBe("Nguyễn Văn A");
    expect(sent.applicationId).toBe("app-1");
    expect(sent.bookingToken).toBe(TOKEN);
    expect(sent.venueLabel).toBe("Phòng B2-208");
    // 01:00Z = 08:00 giờ Việt Nam; ca 30 phút.
    expect(sent.sessionLabel).toContain("03/10/2026");
    expect(sent.sessionLabel).toContain("08:00 – 08:30");
  });

  it("ca chưa có địa điểm → câu hẹn báo sau, không để trống", async () => {
    mocks.rpc.mockResolvedValue({ data: okPayload({ venue: null }), error: null });

    await bookMenteeSession({ token: TOKEN, sessionId: SESSION });

    expect(mocks.sendMenteeSessionConfirmed.mock.calls[0][0].venueLabel).toBe(MENTEE_VENUE_PENDING_LABEL);
  });

  it("đổi ca thành công cũng gửi thư xác nhận — cho ca MỚI", async () => {
    mocks.rpc.mockResolvedValue({
      data: okPayload({ starts_at: "2026-10-04T07:30:00.000Z", ends_at: "2026-10-04T08:00:00.000Z" }),
      error: null
    });

    const result = await changeMenteeSession({ token: TOKEN, sessionId: SESSION });

    expect(result.ok).toBe(true);
    expect(mocks.sendMenteeSessionConfirmed).toHaveBeenCalledTimes(1);
    expect(mocks.sendMenteeSessionConfirmed.mock.calls[0][0].sessionLabel).toContain("14:30 – 15:00");
  });
});

describe("2. giữ chỗ KHÔNG thành thì không có thư nào", () => {
  it("ca kín → không gửi", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code: "session_full" }, error: null });

    const result = await bookMenteeSession({ token: TOKEN, sessionId: SESSION });

    expect(result.ok).toBe(false);
    expect(mocks.sendMenteeSessionConfirmed).not.toHaveBeenCalled();
  });

  it("lỗi database → không gửi", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await bookMenteeSession({ token: TOKEN, sessionId: SESSION });

    expect(mocks.sendMenteeSessionConfirmed).not.toHaveBeenCalled();
  });

  it("đổi ca bị từ chối → không gửi, ca cũ vẫn nguyên", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code: "session_full" }, error: null });

    const result = await changeMenteeSession({ token: TOKEN, sessionId: SESSION });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Ca cũ của bạn vẫn còn nguyên");
    expect(mocks.sendMenteeSessionConfirmed).not.toHaveBeenCalled();
  });
});

describe("3. thư hỏng KHÔNG làm hỏng việc giữ chỗ", () => {
  it("hàm gửi thư ném lỗi → giữ chỗ vẫn báo thành công", async () => {
    mocks.sendMenteeSessionConfirmed.mockRejectedValue(new Error("Brevo treo"));

    const result = await bookMenteeSession({ token: TOKEN, sessionId: SESSION });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Đã ghi nhận ca phỏng vấn của bạn.");
  });

  it("chạm trần thư (429) → giữ chỗ vẫn báo thành công", async () => {
    mocks.sendMenteeSessionConfirmed.mockResolvedValue({ ok: false, skipped: false, providerStatus: 429 });

    const result = await bookMenteeSession({ token: TOKEN, sessionId: SESSION });

    expect(result.ok).toBe(true);
  });

  it("hồ sơ không có email → không gửi, và giữ chỗ vẫn thành công", async () => {
    mocks.rpc.mockResolvedValue({
      data: okPayload({ candidate: { application_id: "app-1", full_name: "A", email: null } }),
      error: null
    });

    const result = await bookMenteeSession({ token: TOKEN, sessionId: SESSION });

    expect(result.ok).toBe(true);
    expect(mocks.sendMenteeSessionConfirmed).not.toHaveBeenCalled();
  });
});

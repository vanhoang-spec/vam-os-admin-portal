/**
 * __tests__/interview-schedule-email-sender.test.ts
 *
 * `sendInterviewSchedule` thật — không phải bản giả. Ba file test khác đụng
 * tới cái tên này đều mock nguyên `@/lib/email`
 * (interview-booking-rpc-wrappers, interview-schedule-server) hoặc gọi thẳng
 * `buildInterviewScheduleEmail` mà bỏ qua hàm gửi
 * (interview-slot-invite-email) — nên phần TÍNH đường dẫn bên trong
 * `sendInterviewSchedule` (reviewId/applicationId → applicationLink) chưa
 * từng chạy qua path thật một lần nào. Đây là chỗ soi nó.
 *
 * Khuôn mượn từ email-delivery.test.ts: bật gửi thật, giả `fetch`, đọc thẳng
 * phần thân đã POST lên Brevo — đó là bản cuối cùng người phỏng vấn nhận
 * được, không phải bản trung gian.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendInterviewSchedule } from "@/lib/email";

function brevoAccepted() {
  return { ok: true, status: 201, json: async () => ({ messageId: "<msg-1@brevo>" }) };
}

const logged: Record<string, unknown>[] = [];

function makeClient() {
  // Cố ý KHÔNG có .select — đọc bản sửa tay trong email_automation_overrides
  // sẽ ném lỗi và readOverrides() bắt lại, resolveAutomationEmail rơi về
  // bản mặc định (built). Đây là hành vi thật khi chưa có ai sửa lá thư này,
  // và cũng là hành vi thật khi đọc lỗi — cả hai đều phải rơi về builder.
  const chain: Record<string, unknown> = {
    insert: (row: Record<string, unknown>) => {
      logged.push(row);
      return Promise.resolve({ error: null });
    }
  };
  return { from: vi.fn(() => chain) } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

const TOUCHED_ENV = [
  "VAM_OS_EMAIL_ENABLED",
  "VERCEL_ENV",
  "VAM_OS_EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "VAM_OS_EMAIL_FROM",
  "VAM_OS_EMAIL_REPLY_TO",
  "VAM_OS_PUBLIC_BASE_URL"
];
const ORIGINAL_ENV = new Map<string, string | undefined>();
let fetchMock: Mock;

beforeEach(() => {
  vi.resetAllMocks();
  // readOverrides() cố ý ném lỗi vì bản giả không có .select — đúng đường rơi
  // về builder mặc định (xem ghi chú makeClient), nhưng in ồn ra console.
  vi.spyOn(console, "error").mockImplementation(() => {});
  logged.length = 0;
  for (const key of TOUCHED_ENV) ORIGINAL_ENV.set(key, process.env[key]);
  process.env.VAM_OS_EMAIL_ENABLED = "true";
  process.env.VERCEL_ENV = "production";
  process.env.VAM_OS_EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.VAM_OS_EMAIL_FROM = "Ban tổ chức VAM <no-reply@vam.test>";
  process.env.VAM_OS_PUBLIC_BASE_URL = "https://os.alumni-mentoring.edu.vn";
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient());
  fetchMock = vi.fn().mockResolvedValue(brevoAccepted());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const key of TOUCHED_ENV) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

function requestBody() {
  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  return JSON.parse(init.body) as { textContent: string; htmlContent: string; subject: string };
}

const BASE_INPUT = {
  toEmail: "interviewer@example.com",
  interviewerName: "Trần Thị B",
  seasonLabel: "UEH Mentoring Mùa 12",
  slotLabel: "Thứ Năm 24/09/2026, 19:30–20:30 (giờ Việt Nam)",
  candidateName: "Nguyễn Văn A",
  candidateEmail: "a@example.com",
  candidatePhone: "0900000001"
};

describe("bản gửi interviewer: mở THẲNG hồ sơ, không phải danh sách", () => {
  it("có review_id: link trỏ /reviews/<id> ở cả text lẫn html, KHÔNG phải /reviews trơn", async () => {
    const result = await sendInterviewSchedule({ ...BASE_INPUT, reviewId: "rv-abc-123" });

    expect(result).toMatchObject({ ok: true, skipped: false });
    const body = requestBody();
    expect(body.textContent).toContain("https://os.alumni-mentoring.edu.vn/reviews/rv-abc-123");
    expect(body.htmlContent).toContain('href="https://os.alumni-mentoring.edu.vn/reviews/rv-abc-123"');
    // Không lẫn một link /reviews KHÔNG có id ở đâu đó trong thư.
    expect(body.textContent).not.toMatch(/reviews(?!\/rv-abc-123)/);
  });

  it("không có review_id (bản CC ban tổ chức), có applicationId: link trỏ /applications/<id>", async () => {
    const result = await sendInterviewSchedule({
      ...BASE_INPUT,
      toEmail: "hello@alumni-mentoring.edu.vn",
      applicationId: "app-xyz-789"
    });

    expect(result.ok).toBe(true);
    const body = requestBody();
    expect(body.textContent).toContain("https://os.alumni-mentoring.edu.vn/applications/app-xyz-789");
    expect(body.htmlContent).toContain('href="https://os.alumni-mentoring.edu.vn/applications/app-xyz-789"');
  });

  it("review_id thắng applicationId khi cả hai cùng có mặt", async () => {
    await sendInterviewSchedule({ ...BASE_INPUT, reviewId: "rv-1", applicationId: "app-1" });

    const body = requestBody();
    expect(body.textContent).toContain("/reviews/rv-1");
    expect(body.textContent).not.toContain("/applications/app-1");
  });

  it("không có review_id lẫn applicationId (phòng thủ): rơi về /reviews — vẫn gửi được, không vỡ", async () => {
    const result = await sendInterviewSchedule(BASE_INPUT);

    expect(result.ok).toBe(true);
    const body = requestBody();
    expect(body.textContent).toContain("https://os.alumni-mentoring.edu.vn/reviews\n");
  });

  it("thiếu VAM_OS_PUBLIC_BASE_URL: không gửi, không ném lỗi", async () => {
    delete process.env.VAM_OS_PUBLIC_BASE_URL;
    const result = await sendInterviewSchedule({ ...BASE_INPUT, reviewId: "rv-1" });

    expect(result).toEqual({ ok: false, skipped: false, reason: "Chưa cấu hình VAM_OS_PUBLIC_BASE_URL." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sổ thư vẫn ghi đúng loại và người nhận", async () => {
    await sendInterviewSchedule({ ...BASE_INPUT, reviewId: "rv-1" });
    expect(logged[0]).toMatchObject({
      kind: "interview_scheduled",
      to_email: "interviewer@example.com",
      status: "sent"
    });
  });
});

/**
 * __tests__/interview-slot-invite-email.test.ts
 *
 * Các lá thư của bộ lịch phỏng vấn: thư mời/nhắc chọn giờ, thư xác nhận hai
 * bên, thư báo huỷ, và đoạn nối thêm trong thư xác nhận đơn mentor.
 *
 * Phần "lên dây" quan trọng nhất là CC: trường cc mới thêm vào EmailMessage
 * phải đi tới ĐÚNG khuôn payload của từng nhà cung cấp (Brevo muốn mảng
 * {email}, Resend muốn mảng chuỗi). Một bản vá làm rơi cc sẽ khiến thư nhắc
 * lần 3 lặng lẽ không tới hộp thư ban tổ chức — không lỗi nào hiện ra.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  buildApplicationConfirmationEmail,
  buildInterviewInviteEmail,
  buildInterviewScheduleEmail,
  buildInterviewSlotCancelledEmail,
  buildInterviewSlotInviteEmail
} from "@/lib/email-core";
import { sendInterviewSlotInvite } from "@/lib/email";
import { BTC_EMAIL } from "@/lib/interview-schedule-core";

const ORIGIN = "https://os.alumni-mentoring.edu.vn";
const HOTLINE = "0919144638";

// ── Builders (thuần) ─────────────────────────────────────────────────────────

describe("1. thư mời và thư nhắc chọn giờ", () => {
  const base = {
    candidateName: "Nguyễn Văn A",
    seasonLabel: "UEH Mentoring Mùa 12",
    bookingUrl: `${ORIGIN}/dat-lich/ma-rieng`,
    windowEndLabel: "05/10/2026",
    hotlineZalo: HOTLINE
  };

  it("thư mời đầu không mang chữ 'Nhắc'", () => {
    const mail = buildInterviewSlotInviteEmail({ ...base, reminderNumber: 0 });
    expect(mail.subject).toContain("Mời chọn giờ trao đổi với core team");
    expect(mail.subject).not.toContain("Nhắc");
    expect(mail.text).toContain(base.bookingUrl);
    expect(mail.text).toContain("05/10/2026");
    expect(mail.text).toContain(HOTLINE);
    expect(mail.html).toContain("Chọn giờ trao đổi");
  });

  it("gọi đúng tên việc: trao đổi với core team, không phải phỏng vấn", () => {
    // Chủ dự án chốt 23/09/2026: với mentor — những người tình nguyện — chữ
    // "phỏng vấn" nghe như đi xin việc. Thư gửi HỌ phải nói "trao đổi với core
    // team"; bản gửi người phỏng vấn và ban tổ chức giữ chữ nội bộ.
    for (const reminderNumber of [0, 2]) {
      const mail = buildInterviewSlotInviteEmail({ ...base, reminderNumber });
      expect(mail.subject).not.toContain("phỏng vấn");
      expect(mail.text).not.toContain("phỏng vấn");
      expect(mail.html).not.toContain("phỏng vấn");
      expect(mail.text).toContain("trao đổi");
    }
  });

  it("mang câu nhắc đường dây hỗ trợ trong lúc hệ thống còn hoàn thiện", () => {
    // Câu này sống chung với đợt hoàn thiện. Ngày gỡ nó ra thì ca test này đỏ
    // — đúng chỗ cần nhìn lại, thay vì lặng lẽ biến mất khỏi bốn lá thư.
    const mail = buildInterviewSlotInviteEmail({ ...base, reminderNumber: 0 });
    expect(mail.text).toContain("0777885674");
    expect(mail.text).toContain("Bảo Châu");
    expect(mail.text).toContain("trong quá trình hoàn thiện");
    expect(mail.html).toContain("0777885674");
  });

  it("thư nhắc nói thẳng đây là lần thứ mấy", () => {
    const mail = buildInterviewSlotInviteEmail({ ...base, reminderNumber: 2 });
    expect(mail.subject).toContain("Nhắc lần 2");
    expect(mail.text).toContain("nhắc lần 2");
    expect(mail.text).toContain(base.bookingUrl);
  });
});

describe("2. thư xác nhận buổi hẹn — đủ liên hệ hai bên và hotline", () => {
  it("bản gửi mentor: interviewer + link tự đổi lịch + luật 24 giờ", () => {
    const mail = buildInterviewInviteEmail({
      candidateName: "Nguyễn Văn A",
      seasonLabel: "UEH Mentoring Mùa 12",
      slotLabel: "Thứ Năm 24/09/2026, 19:30–20:30 (giờ Việt Nam)",
      interviewerName: "Trần Thị B",
      interviewerEmail: "b@example.com",
      interviewerPhone: "0900000001",
      manageUrl: `${ORIGIN}/dat-lich/ma-rieng`,
      hotlineZalo: HOTLINE
    });
    expect(mail.text).toContain("Trần Thị B");
    expect(mail.text).toContain("b@example.com");
    expect(mail.text).toContain("0900000001");
    expect(mail.text).toContain("24 giờ");
    expect(mail.text).toContain(`${ORIGIN}/dat-lich/ma-rieng`);
    expect(mail.text).toContain(HOTLINE);
  });

  it("bản gửi interviewer: liên hệ của mentor + đường vào chấm kết quả", () => {
    const mail = buildInterviewScheduleEmail({
      interviewerName: "Trần Thị B",
      seasonLabel: "UEH Mentoring Mùa 12",
      slotLabel: "Thứ Năm 24/09/2026, 19:30–20:30 (giờ Việt Nam)",
      candidateName: "Nguyễn Văn A",
      candidateEmail: "a@example.com",
      candidatePhone: "0900000002",
      reviewsUrl: `${ORIGIN}/reviews`,
      hotlineZalo: HOTLINE
    });
    expect(mail.subject).toContain("Nguyễn Văn A");
    expect(mail.text).toContain("a@example.com");
    expect(mail.text).toContain("0900000002");
    expect(mail.text).toContain(`${ORIGIN}/reviews`);
    expect(mail.text).toContain(HOTLINE);
  });
});

describe("3. thư báo huỷ", () => {
  const base = {
    recipientName: "Nguyễn Văn A",
    otherPartyName: "Trần Thị B",
    slotLabel: "Thứ Năm 24/09/2026, 19:30–20:30 (giờ Việt Nam)",
    cancelledByLabel: "ban tổ chức huỷ",
    hotlineZalo: HOTLINE
  };

  it("bản gửi mentor mang link đặt lại", () => {
    const mail = buildInterviewSlotCancelledEmail({
      ...base,
      audience: "candidate",
      rebookUrl: `${ORIGIN}/dat-lich/ma-rieng`
    });
    expect(mail.text).toContain("đã được huỷ");
    expect(mail.text).toContain(`${ORIGIN}/dat-lich/ma-rieng`);
  });

  it("bản gửi interviewer KHÔNG bao giờ mang link đặt lịch của mentor", () => {
    // Link là mã riêng của mentor; lọt sang thư interviewer là lộ mã.
    const mail = buildInterviewSlotCancelledEmail({
      ...base,
      audience: "interviewer",
      rebookUrl: `${ORIGIN}/dat-lich/ma-rieng`
    });
    expect(mail.text).not.toContain("/dat-lich/");
    expect(mail.text).toContain("mở lại");
  });
});

describe("4. thư xác nhận đơn mentor mang thêm nút chọn giờ", () => {
  const base = { applicantName: "Nguyễn Văn A", seasonLabel: "UEH Mentoring Mùa 12" };

  it("mentor + bookingUrl: cả text lẫn html đều có đường dẫn", () => {
    const mail = buildApplicationConfirmationEmail({
      ...base,
      role: "mentor",
      bookingUrl: `${ORIGIN}/dat-lich/ma-rieng`
    });
    expect(mail.text).toContain(`${ORIGIN}/dat-lich/ma-rieng`);
    expect(mail.html).toContain("Chọn giờ trao đổi");
    // Thư đầu tiên mentor nhận cũng phải mang đường dây hỗ trợ.
    expect(mail.text).toContain("0777885674");
  });

  it("mentee truyền bookingUrl vào cũng KHÔNG thấy link — fail-closed", () => {
    const mail = buildApplicationConfirmationEmail({
      ...base,
      role: "mentee",
      bookingUrl: `${ORIGIN}/dat-lich/ma-rieng`
    });
    expect(mail.text).not.toContain("/dat-lich/");
    expect(mail.html).not.toContain("/dat-lich/");
  });

  it("mentor không có bookingUrl: thư giữ nguyên lời cũ, không nút", () => {
    const mail = buildApplicationConfirmationEmail({ ...base, role: "mentor" });
    expect(mail.text).toContain("mời phỏng vấn qua email");
    expect(mail.text).not.toContain("/dat-lich/");
  });
});

// ── Wire: CC tới đúng khuôn payload từng nhà cung cấp ────────────────────────

const logged: { payloads: Record<string, unknown>[] } = { payloads: [] };

function makeClient() {
  const chain: Record<string, unknown> = {};
  chain.insert = (payload: Record<string, unknown>) => {
    logged.payloads.push(payload);
    return Promise.resolve({ data: null, error: null });
  };
  return { from: vi.fn(() => chain) } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

const TOUCHED_ENV = [
  "VAM_OS_EMAIL_ENABLED",
  "VERCEL_ENV",
  "VAM_OS_EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "RESEND_API_KEY",
  "VAM_OS_EMAIL_FROM",
  "VAM_OS_EMAIL_REPLY_TO",
  "VAM_OS_PUBLIC_BASE_URL"
];
const ORIGINAL_ENV = new Map<string, string | undefined>();

let fetchMock: Mock;

function enableSending(provider: "brevo" | "resend") {
  process.env.VAM_OS_EMAIL_ENABLED = "true";
  process.env.VERCEL_ENV = "production";
  process.env.VAM_OS_EMAIL_PROVIDER = provider;
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.VAM_OS_EMAIL_FROM = "Ban tổ chức VAM <no-reply@vam.test>";
  process.env.VAM_OS_EMAIL_REPLY_TO = "btc@vam.test";
  delete process.env.VAM_OS_PUBLIC_BASE_URL; // ép dùng requestOrigin cho dễ đoán
}

function requestBody(mock: Mock): Record<string, any> {
  const [, init] = mock.mock.calls[0] as [string, { body: string }];
  return JSON.parse(init.body) as Record<string, any>;
}

describe("5. CC tới hộp thư ban tổ chức ở lượt nhắc thứ ba", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    logged.payloads = [];
    for (const key of TOUCHED_ENV) ORIGINAL_ENV.set(key, process.env[key]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient());
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "x", id: "x" }) });
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

  const INPUT = {
    toEmail: "mentor@example.test",
    candidateName: "Nguyễn Văn A",
    seasonLabel: "UEH Mentoring Mùa 12",
    bookingToken: "ma-rieng",
    reminderNumber: 3,
    windowEndLabel: "05/10/2026",
    applicationId: "00000000-0000-4000-8000-000000000001",
    requestOrigin: ORIGIN
  };

  it("Brevo: cc là mảng {email}", async () => {
    enableSending("brevo");
    const result = await sendInterviewSlotInvite({ ...INPUT, ccBtc: true });
    expect(result.ok).toBe(true);
    const body = requestBody(fetchMock);
    expect(body.cc).toEqual([{ email: BTC_EMAIL }]);
    // Link dựng từ base của app + mã, không nhận URL từ ngoài.
    expect(String(body.htmlContent)).toContain(`${ORIGIN}/dat-lich/ma-rieng`);
  });

  it("Resend: cc là mảng chuỗi", async () => {
    enableSending("resend");
    const result = await sendInterviewSlotInvite({ ...INPUT, ccBtc: true });
    expect(result.ok).toBe(true);
    const body = requestBody(fetchMock);
    expect(body.cc).toEqual([BTC_EMAIL]);
  });

  it("không bật ccBtc thì payload KHÔNG có khoá cc", async () => {
    enableSending("brevo");
    await sendInterviewSlotInvite({ ...INPUT, reminderNumber: 1, ccBtc: false });
    const body = requestBody(fetchMock);
    expect("cc" in body).toBe(false);
  });

  it("sổ thư ghi loại interview_slot_invite gắn với đơn", async () => {
    enableSending("brevo");
    await sendInterviewSlotInvite({ ...INPUT, ccBtc: true });
    expect(logged.payloads[0]).toMatchObject({
      kind: "interview_slot_invite",
      to_email: "mentor@example.test",
      status: "sent",
      related_table: "applications",
      related_id: INPUT.applicationId
    });
  });
});

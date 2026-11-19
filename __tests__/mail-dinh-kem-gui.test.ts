/**
 * VAM00037 — thứ thật sự đi tới nhà cung cấp khi thư mang tệp tải lên, và thư không tệp giữ nguyên.
 *
 * Gọi đúng sendTemplatedEmail của lib/email.ts, `fetch` là bản giả: không lá thư nào rời máy.
 * Tệp tải lên đi bằng URL ký sẵn (Brevo `attachment[].url`, Resend `attachments[].path`) — máy chủ
 * không đọc byte của tệp.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";

const ATTACHMENTS = [
  { filename: "Hướng dẫn.pdf", url: "https://kho.test/sign/mail-dinh-kem/a/huong-dan.pdf?token=t1", contentType: "application/pdf" },
  { filename: "Lịch.ics", url: "https://kho.test/sign/mail-dinh-kem/b/lich.ics?token=t2", contentType: "text/calendar" }
];

const MESSAGE = {
  kind: "general_announcement" as const,
  toEmail: "nguoi-nhan@example.test",
  subject: "Thông báo",
  body: "Chào bạn,\n\nMời bạn xem tệp đính kèm.",
  batchId: "00000000-0000-4000-8000-0000000000b1"
};

const ENV = ["VAM_OS_EMAIL_ENABLED", "VERCEL_ENV", "VAM_OS_EMAIL_PROVIDER", "BREVO_API_KEY", "RESEND_API_KEY", "VAM_OS_EMAIL_FROM"];
const saved = new Map<string, string | undefined>();
let fetchMock: Mock;

function enable(provider: "brevo" | "resend") {
  process.env.VAM_OS_EMAIL_ENABLED = "true";
  process.env.VERCEL_ENV = "production";
  process.env.VAM_OS_EMAIL_PROVIDER = provider;
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.VAM_OS_EMAIL_FROM = "Ban tổ chức VAM <no-reply@vam.test>";
}

function body(call = 0): Record<string, any> {
  const [, init] = fetchMock.mock.calls[call] as [string, { body: string }];
  return JSON.parse(init.body);
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of ENV) saved.set(key, process.env[key]);
  const chain = { insert: () => Promise.resolve({ data: null, error: null }) };
  (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn(() => chain) });
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "m1", id: "r1" }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const key of ENV) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe("Brevo", () => {
  it("mang từng tệp bằng URL ký sẵn, đúng tên người nhận thấy, đúng thứ tự", async () => {
    enable("brevo");
    const result = await sendTemplatedEmail({ ...MESSAGE, attachments: ATTACHMENTS });
    expect(result.ok).toBe(true);
    expect(body().attachment).toEqual([
      { name: "Hướng dẫn.pdf", url: ATTACHMENTS[0].url },
      { name: "Lịch.ics", url: ATTACHMENTS[1].url }
    ]);
    // Không nhét byte vào thân yêu cầu.
    expect(JSON.stringify(body().attachment)).not.toContain("content");
  });

  it("thư không đính kèm không có khoá attachment — y như trước", async () => {
    enable("brevo");
    await sendTemplatedEmail(MESSAGE);
    expect(body()).not.toHaveProperty("attachment");
    await sendTemplatedEmail({ ...MESSAGE, attachments: [] });
    expect(body(1)).not.toHaveProperty("attachment");
  });

  it("tệp base64 cũ (ảnh vé, timeline) vẫn đi bằng content", async () => {
    enable("brevo");
    await sendTemplatedEmail({ ...MESSAGE, attachments: [{ filename: "ve.png", contentBase64: "QUJD" }] });
    expect(body().attachment).toEqual([{ name: "ve.png", content: "QUJD" }]);
  });
});

describe("Resend", () => {
  it("mang tệp bằng `path`, kèm loại tệp", async () => {
    enable("resend");
    await sendTemplatedEmail({ ...MESSAGE, attachments: ATTACHMENTS });
    expect(body().attachments).toEqual([
      { filename: "Hướng dẫn.pdf", path: ATTACHMENTS[0].url, content_type: "application/pdf" },
      { filename: "Lịch.ics", path: ATTACHMENTS[1].url, content_type: "text/calendar" }
    ]);
  });

  it("thư không đính kèm không có khoá attachments", async () => {
    enable("resend");
    await sendTemplatedEmail(MESSAGE);
    expect(body()).not.toHaveProperty("attachments");
  });
});

describe("cổng gửi vẫn chặn như cũ", () => {
  it("môi trường không phải production: không gọi nhà cung cấp, kể cả thư kèm tệp", async () => {
    enable("brevo");
    process.env.VERCEL_ENV = "preview";
    const result = await sendTemplatedEmail({ ...MESSAGE, attachments: ATTACHMENTS });
    expect(result.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

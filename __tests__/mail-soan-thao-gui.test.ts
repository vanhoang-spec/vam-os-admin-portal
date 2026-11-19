/**
 * VAM00038 — thư thiết kế tới nhà cung cấp ra sao, và thư chữ thuần giữ nguyên từng byte.
 *
 * Gọi đúng sendTemplatedEmail của lib/email.ts, `fetch` là bản giả: không lá thư nào rời máy.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import { textToHtmlEmail } from "@/lib/email-core";

const MESSAGE = {
  kind: "general_announcement" as const,
  toEmail: "nguoi-nhan@example.test",
  subject: "Thông báo",
  body: "Chào bạn,\n\nThư có ảnh.",
  batchId: "00000000-0000-4000-8000-0000000000b1"
};

const ENV = ["VAM_OS_EMAIL_ENABLED", "VERCEL_ENV", "VAM_OS_EMAIL_PROVIDER", "BREVO_API_KEY", "VAM_OS_EMAIL_FROM"];
const saved = new Map<string, string | undefined>();
let fetchMock: Mock;

function payload(call = 0): Record<string, any> {
  const [, init] = fetchMock.mock.calls[call] as [string, { body: string }];
  return JSON.parse(init.body);
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of ENV) saved.set(key, process.env[key]);
  process.env.VAM_OS_EMAIL_ENABLED = "true";
  process.env.VERCEL_ENV = "production";
  process.env.VAM_OS_EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.VAM_OS_EMAIL_FROM = "Ban tổ chức VAM <no-reply@vam.test>";
  const chain = { insert: () => Promise.resolve({ data: null, error: null }) };
  (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn(() => chain) });
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "m1" }) });
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

describe("sendTemplatedEmail với thân thư thiết kế", () => {
  it("phần HTML dựng từ HTML thiết kế (khung 600px, ảnh), phần chữ vẫn là body", async () => {
    const html =
      '<p>Chào <strong>Nguyễn Văn A</strong></p><div style="text-align:center"><img src="https://kho.test/a.png" width="300" alt=""></div>';
    const result = await sendTemplatedEmail({ ...MESSAGE, html });
    expect(result.ok).toBe(true);
    const sent = payload();
    expect(sent.textContent).toBe(MESSAGE.body);
    expect(sent.htmlContent).toContain("max-width:600px");
    expect(sent.htmlContent).toContain("<strong>Nguyễn Văn A</strong>");
    expect(sent.htmlContent).toContain('src="https://kho.test/a.png"');
    expect(sent.htmlContent).not.toBe(textToHtmlEmail(MESSAGE.body));
  });

  it("lọc lần cuối trước khi gửi: HTML bẩn không tới nhà cung cấp", async () => {
    await sendTemplatedEmail({ ...MESSAGE, html: '<p onclick="x()">a</p><script>alert(1)</script><img src="javascript:x">' });
    const sent = payload();
    expect(sent.htmlContent).not.toMatch(/onclick|<script|javascript:/);
  });

  it("thư chữ thuần (không html, html rỗng, html null) đi y như trước", async () => {
    await sendTemplatedEmail(MESSAGE);
    await sendTemplatedEmail({ ...MESSAGE, html: "" });
    await sendTemplatedEmail({ ...MESSAGE, html: null });
    for (const call of [0, 1, 2]) {
      expect(payload(call).htmlContent).toBe(textToHtmlEmail(MESSAGE.body));
      expect(payload(call).textContent).toBe(MESSAGE.body);
    }
  });
});

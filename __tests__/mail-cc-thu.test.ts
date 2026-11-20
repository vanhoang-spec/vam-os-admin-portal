/**
 * Thư nhắc "Mentee chưa có recap": CC của từng thư tới nhà cung cấp (Brevo, Resend) ra sao.
 *
 * Gọi đúng sendTemplatedEmail của lib/email.ts, `fetch` là bản giả: không lá thư nào rời máy.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";

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

describe("sendTemplatedEmail mang CC của riêng thư", () => {
  it("Brevo: CC đã chuẩn hoá, bỏ trùng, bỏ địa chỉ hỏng và địa chỉ trùng người nhận", async () => {
    const result = await sendTemplatedEmail({
      ...MESSAGE,
      cc: ["Mentor@Example.test", "mentor@example.test", "khong-phai-email", "Nguoi-Nhan@example.test"]
    });
    expect(result.ok).toBe(true);
    expect(payload().cc).toEqual([{ email: "mentor@example.test" }]);
    expect(payload().to).toEqual([{ email: MESSAGE.toEmail }]);
  });

  it("Resend: CC là mảng địa chỉ", async () => {
    process.env.VAM_OS_EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    try {
      await sendTemplatedEmail({ ...MESSAGE, cc: ["mentor@example.test"] });
      expect(payload().cc).toEqual(["mentor@example.test"]);
    } finally {
      delete process.env.RESEND_API_KEY;
    }
  });

  it("không có CC (thiếu, rỗng, chỉ toàn địa chỉ hỏng): thư đi y như trước, không có khoá cc", async () => {
    await sendTemplatedEmail(MESSAGE);
    await sendTemplatedEmail({ ...MESSAGE, cc: [] });
    await sendTemplatedEmail({ ...MESSAGE, cc: ["x", MESSAGE.toEmail] });
    for (const call of [0, 1, 2]) expect(payload(call)).not.toHaveProperty("cc");
  });
});

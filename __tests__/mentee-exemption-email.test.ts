/**
 * Mentee đặc cách (Support team) — lá thư mời xác nhận và cánh cửa của trang xác nhận.
 *
 * Lá thư là thứ duy nhất của tính năng này rời khỏi hệ thống, và link trong đó là thứ duy
 * nhất biến một người thành mentee của mùa. Nên phải soi: thư nói đúng việc (đặc cách,
 * không phỏng vấn), mang đúng link của đúng người, thư thử không mang link thật nào, sổ thư
 * ghi đúng loại; và trang đích mở được khi chưa đăng nhập nhưng không nằm lại trong cache
 * hay lộ mã qua Referer.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendMenteeExemptionConfirm } from "@/lib/email";
import { AUTOMATION_SLOTS } from "@/lib/email-automation-core";
import { buildMenteeExemptionConfirmEmail } from "@/lib/email-core";
import { outboundEmailKindLabel } from "@/lib/outbound-emails-core";
import { middleware } from "@/middleware";

const ORIGIN = "https://os.alumni-mentoring.edu.vn";
const HOTLINE = "0919144638";
const TOKEN = "aaaaaaaa-0000-4000-8000-000000000001";
const EXEMPTION = "eeeeeeee-0000-4000-8000-000000000001";

describe("1. nội dung thư", () => {
  const base = { recipientName: "Trần Mỹ Anh", seasonLabel: "UEH Mentoring Mùa 12", confirmUrl: `${ORIGIN}/xac-nhan-mentee/${TOKEN}`, hotlineZalo: HOTLINE };

  it("nói đúng việc: Support team được đặc cách làm mentee, không qua phỏng vấn, chỉ cần bấm xác nhận", () => {
    const mail = buildMenteeExemptionConfirmEmail(base);
    expect(mail.subject).toBe("[UEH Mentoring] Mời bạn xác nhận tham gia Mentee — UEH Mentoring Mùa 12");
    expect(mail.text).toContain("Chào Trần Mỹ Anh,");
    expect(mail.text).toContain("vai trò Support team");
    expect(mail.text).toContain("đặc cách");
    expect(mail.text).toContain("mà không cần qua vòng phỏng vấn");
    expect(mail.text).toContain('bấm "Xác nhận tham gia"');
    expect(mail.text).toContain(HOTLINE);
  });

  it("mang đúng đường dẫn riêng ở cả bản chữ lẫn bản HTML (nút và dòng dự phòng)", () => {
    const mail = buildMenteeExemptionConfirmEmail(base);
    expect(mail.text.split(base.confirmUrl).length - 1).toBe(1);
    expect(mail.html).toContain(`href="${base.confirmUrl}"`);
    // Dòng dự phòng cho hộp thư không bấm được nút.
    expect(mail.html.split(base.confirmUrl).length - 1).toBe(2);
    expect(mail.html).toContain("Mở trang xác nhận");
  });

  it("xưng 'bạn' với sinh viên, không dùng 'anh/chị' của thư gửi mentor", () => {
    const mail = buildMenteeExemptionConfirmEmail(base);
    expect(mail.text).not.toContain("anh/chị");
    expect(mail.html).not.toContain("anh/chị");
  });

  it("không đặt hạn và không doạ: không bấm cũng không sao, chỉ cần báo ban tổ chức", () => {
    const mail = buildMenteeExemptionConfirmEmail(base);
    expect(mail.text).toContain("bạn không cần bấm xác nhận");
    expect(mail.text).not.toMatch(/hạn chót|trước ngày|hết hạn/i);
  });

  it("tên người nhận được thoát ký tự trong HTML; thiếu tên thì chào 'bạn'", () => {
    const mail = buildMenteeExemptionConfirmEmail({ ...base, recipientName: 'An <script>alert(1)</script> & "B"' });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(buildMenteeExemptionConfirmEmail({ ...base, recipientName: "   " }).text).toContain("Chào bạn,");
  });

  it("đường dẫn cũng được thoát ký tự khi đặt vào href", () => {
    const mail = buildMenteeExemptionConfirmEmail({ ...base, confirmUrl: `${ORIGIN}/xac-nhan-mentee/x"onmouseover="alert(1)` });
    expect(mail.html).not.toContain('"onmouseover="');
  });

  it("thư có tên trong sổ thư và có ô sửa câu chữ, trong đó đường dẫn là ô bắt buộc", () => {
    expect(outboundEmailKindLabel("mentee_exemption_confirm")).toBe("Mời Support team xác nhận mentee (đặc cách)");
    const slot = AUTOMATION_SLOTS.find((s) => s.id === "mentee_exemption_confirm");
    expect(slot?.kind).toBe("mentee_exemption_confirm");
    expect(slot?.placeholders.find((p) => p.key === "link_xac_nhan")?.required).toBe(true);
    expect(slot?.placeholders.map((p) => p.key)).toEqual(["ten_nguoi_nhan", "mua", "link_xac_nhan", "zalo_ho_tro"]);
  });
});

// ── Gửi thật qua nhà cung cấp (giả lập fetch) ────────────────────────────────

const logged: { payloads: Record<string, unknown>[] } = { payloads: [] };
function makeClient() {
  const chain: Record<string, unknown> = {};
  chain.insert = (payload: Record<string, unknown>) => {
    logged.payloads.push(payload);
    return Promise.resolve({ data: null, error: null });
  };
  return { from: vi.fn(() => chain) } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

const TOUCHED_ENV = ["VAM_OS_EMAIL_ENABLED", "VERCEL_ENV", "VAM_OS_EMAIL_PROVIDER", "BREVO_API_KEY", "RESEND_API_KEY", "VAM_OS_EMAIL_FROM", "VAM_OS_EMAIL_REPLY_TO", "VAM_OS_PUBLIC_BASE_URL"];
const ORIGINAL_ENV = new Map<string, string | undefined>();
let fetchMock: Mock;

function requestBody(): Record<string, any> {
  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  return JSON.parse(init.body) as Record<string, any>;
}

describe("2. gửi thư", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    logged.payloads = [];
    for (const key of TOUCHED_ENV) ORIGINAL_ENV.set(key, process.env[key]);
    process.env.VAM_OS_EMAIL_ENABLED = "true";
    process.env.VERCEL_ENV = "production";
    process.env.VAM_OS_EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    process.env.BREVO_API_KEY = "xkeysib-test";
    process.env.VAM_OS_EMAIL_FROM = "Ban tổ chức VAM <no-reply@vam.test>";
    process.env.VAM_OS_EMAIL_REPLY_TO = "btc@vam.test";
    delete process.env.VAM_OS_PUBLIC_BASE_URL; // ép dùng requestOrigin cho dễ đoán
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

  const INPUT = { toEmail: "sv@example.test", recipientName: "Trần Mỹ Anh", seasonLabel: "UEH Mentoring Mùa 12", token: TOKEN, exemptionId: EXEMPTION, requestOrigin: ORIGIN };

  it("thư thật: gửi tới đúng người, link dựng từ địa chỉ của hệ thống + mã của người đó", async () => {
    const result = await sendMenteeExemptionConfirm(INPUT);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = requestBody();
    expect(JSON.stringify(body.to)).toContain("sv@example.test");
    expect(String(body.html)).toContain(`${ORIGIN}/xac-nhan-mentee/${TOKEN}`);
    expect(String(body.text)).toContain(`${ORIGIN}/xac-nhan-mentee/${TOKEN}`);
    expect(String(body.subject)).toContain("xác nhận tham gia Mentee");
  });

  it("sổ thư ghi đúng loại, gắn với đúng dòng đặc cách", async () => {
    await sendMenteeExemptionConfirm(INPUT);
    expect(logged.payloads[0]).toMatchObject({
      kind: "mentee_exemption_confirm", to_email: "sv@example.test", status: "sent", related_table: "mentee_exemptions", related_id: EXEMPTION
    });
  });

  it("thư thử (không có mã): không mang đường dẫn thật nào, không gắn với dòng nào", async () => {
    const result = await sendMenteeExemptionConfirm({ ...INPUT, toEmail: "btc@example.test", token: null, exemptionId: null });
    expect(result.ok).toBe(true);
    const body = requestBody();
    expect(String(body.html)).not.toContain("/xac-nhan-mentee/");
    expect(String(body.text)).not.toContain("/xac-nhan-mentee/");
    expect(String(body.text)).toContain("chỉ có trong thư thật");
    expect(logged.payloads[0]).toMatchObject({ kind: "mentee_exemption_confirm", to_email: "btc@example.test" });
    expect(logged.payloads[0].related_id ?? null).toBeNull();
  });

  it("không biết địa chỉ công khai của hệ thống thì KHÔNG gửi thư thật — thà không gửi còn hơn gửi link hỏng", async () => {
    const result = await sendMenteeExemptionConfirm({ ...INPUT, requestOrigin: null });
    expect(result).toMatchObject({ ok: false, skipped: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged.payloads).toEqual([]);
  });
});

describe("3. cánh cửa của trang xác nhận", () => {
  const request = (path: string) => new NextRequest(`https://os.test${path}`);

  it("mở được khi chưa đăng nhập: không bị đưa về trang đăng nhập, và mang nhãn trang công khai", async () => {
    const response = await middleware(request(`/xac-nhan-mentee/${TOKEN}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-vam-public-route")).toBe("mentee_exemption_confirm");
  });

  it("URL mang mã riêng: không lưu cache, không lộ mã qua Referer", async () => {
    const response = await middleware(request(`/xac-nhan-mentee/${TOKEN}`));
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("chỉ đúng tiền tố đó là công khai: đường trông giống vẫn đòi đăng nhập", async () => {
    for (const path of ["/xac-nhan-mentee", "/xac-nhan-menteeX/abc", "/applications/mentee-dac-cach"]) {
      const response = await middleware(request(path));
      expect(response.headers.get("x-middleware-request-x-vam-public-route"), path).toBeNull();
    }
  });

  it("layout nhận nhãn này làm khung trần (không vẽ menu ban tổ chức quanh trang)", () => {
    expect(readFileSync("app/layout.tsx", "utf8")).toContain('publicRoute === "mentee_exemption_confirm"');
  });
});

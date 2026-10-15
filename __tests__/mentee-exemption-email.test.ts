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
import { buildMenteeExemptionConfirmEmail, markAsTestEmail, TEST_EMAIL_NOTICE, TEST_EMAIL_SUBJECT_PREFIX } from "@/lib/email-core";
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

describe("1b. markAsTestEmail (phần thuần)", () => {
  const PLACEHOLDER = "(đường dẫn riêng của từng người — chỉ có trong thư thật)";
  const base = { recipientName: "Trần Mỹ Anh", seasonLabel: "UEH Mentoring Mùa 12", confirmUrl: PLACEHOLDER, hotlineZalo: HOTLINE };

  it("thêm tiền tố vào tiêu đề, khung báo vào đầu thư, và gỡ đúng href mang câu giữ chỗ", () => {
    const real = buildMenteeExemptionConfirmEmail(base);
    expect(real.html).toContain(`href="${PLACEHOLDER}"`);
    const test = markAsTestEmail(real, PLACEHOLDER);
    expect(test.subject).toBe(`${TEST_EMAIL_SUBJECT_PREFIX}${real.subject}`);
    expect(test.text.startsWith("[THƯ THỬ] ")).toBe(true);
    expect(test.text.endsWith(real.text)).toBe(true);
    expect(test.html.startsWith("<p ")).toBe(true);
    expect(test.html).toContain(TEST_EMAIL_NOTICE);
    expect(test.html).not.toContain(`href="${PLACEHOLDER}"`);
    // Phần còn lại của thư không đổi: chỉ mất thuộc tính href.
    expect(test.html.replace(/^<p .*?<\/p>/, "")).toBe(real.html.split(`href="${PLACEHOLDER}"`).join(""));
  });

  it("chỉ gỡ href mang ĐÚNG câu giữ chỗ — href khác của thư giữ nguyên", () => {
    const html = `<a href="${PLACEHOLDER}">Nút</a><a href="https://os.test/khac">Khác</a>`;
    const test = markAsTestEmail({ subject: "S", text: "T", html }, PLACEHOLDER);
    expect(test.html).toContain('href="https://os.test/khac"');
    expect(test.html).not.toContain(`href="${PLACEHOLDER}"`);
  });

  it("không thêm tiền tố hai lần nếu tiêu đề đã có", () => {
    const test = markAsTestEmail({ subject: `${TEST_EMAIL_SUBJECT_PREFIX}S`, text: "T", html: "<p>H</p>" }, PLACEHOLDER);
    expect(test.subject).toBe(`${TEST_EMAIL_SUBJECT_PREFIX}S`);
  });

  it("không đổi các trường khác của thư (người nhận, tệp đính kèm…)", () => {
    const original = { to: "a@b.test", subject: "S", text: "T", html: "H", extra: 7 };
    const test = markAsTestEmail(original, PLACEHOLDER);
    expect(test.to).toBe("a@b.test");
    expect(test.extra).toBe(7);
    expect(original.subject).toBe("S");
    expect(original.html).toBe("H");
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

  // 13/10/2026: BTC bấm nút trong thư thử, ra trang "Thông báo chuyển hướng — url không hợp lệ" của
  // trình duyệt, tưởng link thật hỏng. Thư thử phải tự nói nó là thư thử, và nút không được trông như link.
  it("thư thử ghi rõ là thư thử và nút KHÔNG còn là đường dẫn bấm được", async () => {
    await sendMenteeExemptionConfirm({ ...INPUT, toEmail: "btc@example.test", token: null, exemptionId: null });
    const body = requestBody();
    expect(String(body.subject)).toMatch(/^\[THƯ THỬ\] \[UEH Mentoring\] Mời bạn xác nhận tham gia Mentee/);
    expect(String(body.text)).toContain("[THƯ THỬ] Đây là thư GỬI THỬ");
    expect(String(body.html)).toContain("THƯ THỬ.");
    expect(String(body.html)).toContain("trong thư thử này nút không bấm được");
    // Nút vẫn hiện (để xem thư trông thế nào) nhưng không còn href nào mang câu giữ chỗ.
    expect(String(body.html)).toContain("Mở trang xác nhận");
    expect(String(body.html)).not.toContain("href=\"(đường dẫn riêng");
    expect(String(body.html)).not.toMatch(/href="\(/);
    // Chữ nằm trong thân thư (không phải trong href) thì còn — để người thử thấy câu giữ chỗ.
    expect(String(body.text)).toContain("(đường dẫn riêng của từng người — chỉ có trong thư thật)");
  });

  it("thư THẬT không bị đụng: không có dấu hiệu thư thử và nút mang đúng href", async () => {
    await sendMenteeExemptionConfirm(INPUT);
    const body = requestBody();
    expect(String(body.subject)).not.toContain("THƯ THỬ");
    expect(String(body.text)).not.toContain("THƯ THỬ");
    expect(String(body.html)).not.toContain("THƯ THỬ");
    expect(String(body.html)).toContain(`href="${ORIGIN}/xac-nhan-mentee/${TOKEN}"`);
    expect(String(body.subject)).toBe("[UEH Mentoring] Mời bạn xác nhận tham gia Mentee — UEH Mentoring Mùa 12");
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
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
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

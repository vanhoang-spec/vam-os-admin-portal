/**
 * Thư mời mentor chọn mentee — Vòng 2 (BTC 14/10/2026).
 *
 * Thư gửi TRƯỚC giờ mở để mọi mentor bắt đầu cùng lúc, nên thư phải nói giờ mở; thư mang nhãn cụm
 * khi nhóm được gộp; thư thử của BTC phải tự nói là thư thử và không để lại nút trỏ vào câu giữ chỗ
 * (13/10: BTC bấm nút thư thử của thư đặc cách, ra trang lỗi của trình duyệt, tưởng link thật hỏng).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendMatchingRound2Invite } from "@/lib/email";
import { AUTOMATION_SLOTS } from "@/lib/email-automation-core";
import { buildMatchingRound2InviteEmail } from "@/lib/email-core";
import { round2WaveNote } from "@/lib/matching-round2-dispatch-core";
import { EMAIL_SAMPLES } from "@/lib/email-samples";

const ORIGIN = "https://os.alumni-mentoring.edu.vn";
const TOKEN = "aaaaaaaa-0000-4000-8000-000000000002";
const LINK_ID = "11111111-0000-4000-8000-000000000002";
const OPENS = "15/10/2026 11:00 (giờ Việt Nam)";
const CLOSES = "17/10/2026 11:00 (giờ Việt Nam)";
const GROUP = "3. Tài chính - Đầu tư (chung danh sách với 1. Ngân hàng - Bảo hiểm, 2. Kế toán - Kiểm toán)";

describe("1. nội dung thư", () => {
  const base = {
    mentorName: "Nguyễn Văn A",
    seasonLabel: "UEH Mentoring Mùa 12",
    groupLabel: GROUP,
    slotsLabel: "2",
    pickUrl: `${ORIGIN}/chon-mentee/${TOKEN}`,
    opensLabel: OPENS,
    deadlineLabel: CLOSES,
    waveNote: "Ban tổ chức mời anh/chị chọn mentee ở Vòng 2.",
    hotlineZalo: "0919144638"
  };

  it("nói giờ mở và hạn chọn, ở cả bản chữ lẫn bản HTML", () => {
    const mail = buildMatchingRound2InviteEmail(base);
    expect(mail.text).toContain(`Thời gian chọn: từ ${OPENS} đến ${CLOSES}.`);
    expect(mail.text).toContain('Trước giờ mở, đường dẫn báo "chưa mở"');
    expect(mail.html).toContain(`Thời gian chọn: từ <strong>${OPENS}</strong> đến <strong>${CLOSES}</strong>.`);
  });

  it("mang nhãn cụm và đúng đường dẫn riêng (một lần ở bản chữ, nút + dòng dự phòng ở HTML)", () => {
    const mail = buildMatchingRound2InviteEmail(base);
    expect(mail.text).toContain(`Nhóm ngành của anh/chị: ${GROUP}.`);
    expect(mail.text.split(base.pickUrl).length - 1).toBe(1);
    expect(mail.html).toContain(`href="${base.pickUrl}"`);
    expect(mail.html.split(base.pickUrl).length - 1).toBe(2);
  });

  it("câu mở đầu thật của cả hai đợt ra nguyên câu, không bị cắt (14/10/2026: bị cắt ở 120 ký tự)", () => {
    for (const wave of [1, 2]) {
      const note = round2WaveNote(wave);
      expect(note.length).toBeGreaterThan(120);
      const mail = buildMatchingRound2InviteEmail({ ...base, waveNote: note });
      expect(mail.text).toContain(`\n${note}\n`);
      expect(mail.html).toContain(`<p>${note}</p>`);
      expect(mail.text).not.toContain("...");
      expect(mail.html).not.toContain("...");
    }
  });

  it("câu mở đầu vẫn gộp xuống dòng thành một dòng, và trống thì không in gì", () => {
    const mail = buildMatchingRound2InviteEmail({ ...base, waveNote: " Dòng một\r\ndòng hai\t " });
    expect(mail.html).toContain("<p>Dòng một dòng hai</p>");
    expect(buildMatchingRound2InviteEmail({ ...base, waveNote: "   " }).html).toContain("</strong>,</p><p></p>");
  });

  it("thư mẫu ở trang Mẫu thư theo lịch BTC chốt (10:00 15/10 → 23:59 18/10) và đúng câu mở đầu đợt 1", () => {
    const sample = EMAIL_SAMPLES.find((s) => s.kind === "matching_round2_invite");
    expect(sample?.body?.text).toContain("Thời gian chọn: từ 15/10/2026 10:00 (giờ Việt Nam) đến 18/10/2026 23:59 (giờ Việt Nam).");
    expect(sample?.body?.text).toContain(round2WaveNote(1));
  });

  it("mẫu thư BTC sửa được có chỗ điền giờ mở", () => {
    const slot = AUTOMATION_SLOTS.find((s) => s.id === "matching_round2_invite");
    expect(slot?.placeholders.map((p) => p.key)).toContain("gio_mo");
  });
});

// ── Gửi qua nhà cung cấp (giả lập fetch) ─────────────────────────────────────────

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
const body = () => JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, any>;

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
    delete process.env.VAM_OS_PUBLIC_BASE_URL;
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient());
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: "x", messageId: "x" }) });
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
    mentorName: "Nguyễn Văn A",
    seasonLabel: "UEH Mentoring Mùa 12",
    groupLabel: GROUP,
    slots: 2,
    opensLabel: OPENS,
    deadlineLabel: CLOSES,
    waveNote: "Ban tổ chức mời anh/chị chọn mentee ở Vòng 2.",
    token: TOKEN,
    linkId: LINK_ID,
    requestOrigin: ORIGIN
  };

  it("thư thật: đúng người, đúng link riêng, có giờ mở, không có dấu thư thử; sổ thư gắn đúng link", async () => {
    const result = await sendMatchingRound2Invite(INPUT);
    expect(result.ok).toBe(true);
    const b = body();
    expect(JSON.stringify(b.to)).toContain("mentor@example.test");
    expect(String(b.html)).toContain(`href="${ORIGIN}/chon-mentee/${TOKEN}"`);
    expect(String(b.text)).toContain(`Thời gian chọn: từ ${OPENS} đến ${CLOSES}.`);
    expect(String(b.subject)).toBe("[UEH Mentoring] Mời anh/chị chọn mentee — UEH Mentoring Mùa 12");
    expect(String(b.text)).not.toContain("THƯ THỬ");
    expect(logged.payloads[0]).toMatchObject({ kind: "matching_round2_invite", to_email: "mentor@example.test", related_table: "matching_round2_links", related_id: LINK_ID });
  });

  it("thư thật mang nguyên câu mở đầu của đợt 1 (đường gửi thật, không chỉ hàm dựng)", async () => {
    const result = await sendMatchingRound2Invite({ ...INPUT, waveNote: round2WaveNote(1) });
    expect(result.ok).toBe(true);
    expect(String(body().text)).toContain(round2WaveNote(1));
    expect(String(body().html)).toContain(round2WaveNote(1));
  });

  it("thư thử: ghi rõ là thư thử, không mang đường dẫn thật, nút không còn trỏ vào câu giữ chỗ", async () => {
    const result = await sendMatchingRound2Invite({ ...INPUT, toEmail: "btc@example.test", token: null, linkId: null });
    expect(result.ok).toBe(true);
    const b = body();
    expect(String(b.subject)).toMatch(/^\[THƯ THỬ\] \[UEH Mentoring\] Mời anh\/chị chọn mentee/);
    expect(String(b.text)).toContain("[THƯ THỬ] Đây là thư GỬI THỬ");
    expect(String(b.html)).toContain("THƯ THỬ.");
    expect(String(b.html)).not.toContain("/chon-mentee/");
    expect(String(b.text)).not.toContain("/chon-mentee/");
    expect(String(b.html)).not.toMatch(/href="\(/);
    expect(String(b.html)).toContain("Chọn mentee");
    expect(String(b.text)).toContain("(đường dẫn riêng của từng mentor — chỉ có trong thư thật)");
    expect(logged.payloads[0].related_id ?? null).toBeNull();
  });
});

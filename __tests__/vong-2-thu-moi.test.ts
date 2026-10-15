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
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { ROUND2_GUIDE_PDF_PATH, ROUND2_GUIDE_PDF_SOURCE, round2GuidePdfUrl } from "@/lib/matching-round2-link-core";
import { VONG2_TIMELINE_JPEG_BASE64 } from "@/lib/email-assets/vong-2-timeline";
import { middleware } from "@/middleware";
import { GET as guidePdfRoute } from "@/app/chon-mentee/huong-dan-vong-2.pdf/route";

const ORIGIN = "https://os.alumni-mentoring.edu.vn";
const TOKEN = "aaaaaaaa-0000-4000-8000-000000000002";
const LINK_ID = "11111111-0000-4000-8000-000000000002";
const OPENS = "15/10/2026 11:00 (giờ Việt Nam)";
const CLOSES = "17/10/2026 11:00 (giờ Việt Nam)";
const GROUP = "3. Tài chính - Đầu tư (chung danh sách với 1. Ngân hàng - Bảo hiểm, 2. Kế toán - Kiểm toán)";
const VIDEO_HOST = "youtu";
const CID = "timeline-ueh-mentoring-mua-12";
const PDF = `${ORIGIN}/chon-mentee/huong-dan-vong-2.pdf`;

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

  it("link file PDF hướng dẫn: đứng riêng một dòng ở bản chữ (không dính dấu chấm), bấm được ở HTML, sau giờ chọn; không còn link video (BTC 15/10/2026)", () => {
    const mail = buildMatchingRound2InviteEmail({ ...base, guidePdfUrl: PDF });
    expect(mail.text).toContain(`\nHướng dẫn từng bước cho mentor (file PDF):\n${PDF}\n`);
    expect(mail.html).toContain(`<p>Hướng dẫn từng bước cho mentor: <a href="${PDF}">mở file PDF hướng dẫn</a>.</p>`);
    for (const body of [mail.text, mail.html]) {
      expect(body.indexOf("Thời gian chọn")).toBeLessThan(body.indexOf("Hướng dẫn từng bước"));
      expect(body.indexOf("Hướng dẫn từng bước")).toBeLessThan(body.indexOf("Sau khi chọn"));
      expect(body).not.toContain(VIDEO_HOST);
      expect(body.toLowerCase()).not.toContain("video");
    }
    const none = buildMatchingRound2InviteEmail(base);
    expect(none.text).not.toContain("Hướng dẫn từng bước");
    expect(none.html).not.toContain("Hướng dẫn từng bước");
  });

  it("hình timeline Mùa 12 (BTC 15/10/2026): nhúng bằng cid ngay sau đoạn giờ chọn, trước link hướng dẫn; không có cid thì không in hình", () => {
    const mail = buildMatchingRound2InviteEmail({ ...base, guidePdfUrl: PDF, timelineImageCid: CID });
    const img = `<img src="cid:${CID}"`;
    expect(mail.html.split(img).length - 1).toBe(1);
    expect(mail.html).toContain('alt="UEH Mentoring Mùa 12 — Timeline Matching Mentor – Mentee và hoạt động sắp tới"');
    expect(mail.html.indexOf("Thời gian chọn")).toBeLessThan(mail.html.indexOf(img));
    expect(mail.html.indexOf(img)).toBeLessThan(mail.html.indexOf("Hướng dẫn từng bước"));
    expect(mail.text).toContain("Timeline matching Mentor – Mentee và hoạt động sắp tới của Mùa 12: xem hình trong thư.");
    // Hàm dựng không tự đính ảnh (giữ file thuần) — nơi gửi đính, xem phần 2.
    expect(mail.attachments).toBeUndefined();
    const none = buildMatchingRound2InviteEmail(base);
    expect(none.html).not.toContain("<img");
    expect(none.text).not.toContain("Timeline");
  });

  it("hình timeline là JPEG thật, nhỏ hơn 400 KB", () => {
    const bytes = Buffer.from(VONG2_TIMELINE_JPEG_BASE64, "base64");
    expect(bytes.subarray(0, 3).toString("hex")).toBe("ffd8ff");
    expect(bytes.subarray(-2).toString("hex")).toBe("ffd9");
    expect(bytes.length).toBeGreaterThan(50 * 1024);
    expect(bytes.length).toBeLessThan(400 * 1024);
  });

  it("đường file PDF trong thư trỏ đúng route trả file; route trả đúng file PDF trong kho mã", async () => {
    expect(ROUND2_GUIDE_PDF_PATH).toBe("/chon-mentee/huong-dan-vong-2.pdf");
    expect(round2GuidePdfUrl(`${ORIGIN}/`)).toBe(PDF);
    // Route nằm đúng ở đường thư trỏ tới (thư mục app/ = đường dẫn).
    const routeFile = `app${ROUND2_GUIDE_PDF_PATH}/route.ts`;
    expect(readFileSync(routeFile, "utf8")).toContain('export const dynamic = "force-static"');
    const source = readFileSync(ROUND2_GUIDE_PDF_SOURCE);
    expect(source.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(source.length).toBeLessThan(8 * 1024 * 1024);
    const response = await guidePdfRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await response.arrayBuffer()).equals(source)).toBe(true);
  });

  it("mẫu thư BTC sửa được có chỗ điền link PDF, không còn chỗ điền video; thư mẫu mang link PDF, không có video", () => {
    const slot = AUTOMATION_SLOTS.find((s) => s.id === "matching_round2_invite");
    const keys = slot?.placeholders.map((p) => p.key) ?? [];
    expect(keys).toContain("link_file_huong_dan");
    expect(keys).not.toContain("link_video_huong_dan");
    const sample = EMAIL_SAMPLES.find((s) => s.kind === "matching_round2_invite");
    expect(sample?.body?.text).toContain(`Hướng dẫn từng bước cho mentor (file PDF):\n${PDF}`);
    expect(sample?.body?.text).not.toContain(VIDEO_HOST);
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
    // Link PDF dựng từ đúng địa chỉ trang đang chạy; không còn link video (BTC 15/10/2026).
    expect(String(b.text)).toContain(`Hướng dẫn từng bước cho mentor (file PDF):\n${PDF}`);
    expect(String(b.html)).toContain(`href="${PDF}"`);
    expect(String(b.html)).not.toContain(VIDEO_HOST);
    expect(String(b.text)).not.toContain(VIDEO_HOST);
    expect(logged.payloads[0]).toMatchObject({ kind: "matching_round2_invite", to_email: "mentor@example.test", related_table: "matching_round2_links", related_id: LINK_ID });
  });

  it("hình timeline đi kèm thư thật qua Resend: đúng một tệp JPEG mang content_id khớp cid trong thân thư", async () => {
    const result = await sendMatchingRound2Invite(INPUT);
    expect(result.ok).toBe(true);
    const b = body();
    expect(String(b.html)).toContain(`<img src="cid:${CID}"`);
    expect(b.attachments).toEqual([
      { filename: "timeline-ueh-mentoring-mua-12.jpg", content: VONG2_TIMELINE_JPEG_BASE64, content_id: CID, content_type: "image/jpeg" }
    ]);
  });

  it("qua Brevo (đường lui): hình đi thành tệp đính kèm thường — Brevo không nhận content_id", async () => {
    process.env.VAM_OS_EMAIL_PROVIDER = "brevo";
    const result = await sendMatchingRound2Invite(INPUT);
    expect(result.ok).toBe(true);
    expect(body().attachment).toEqual([{ name: "timeline-ueh-mentoring-mua-12.jpg", content: VONG2_TIMELINE_JPEG_BASE64 }]);
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
    // Không mã riêng nào rời hệ thống (đường file PDF hướng dẫn dưới /chon-mentee/ thì được).
    for (const body of [String(b.html), String(b.text)]) {
      expect(body).not.toMatch(/\/chon-mentee\/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(body.split("/chon-mentee/").length - 1).toBe(body.split(ROUND2_GUIDE_PDF_PATH).length - 1);
    }
    expect(String(b.html)).not.toMatch(/href="\(/);
    expect(String(b.html)).toContain("Chọn mentee");
    expect(String(b.text)).toContain("(đường dẫn riêng của từng mentor — chỉ có trong thư thật)");
    expect(logged.payloads[0].related_id ?? null).toBeNull();
    // Hướng dẫn là link công khai, giống nhau cho mọi mentor: thư thử vẫn bấm được để BTC xem trước.
    expect(String(b.html)).toContain(`href="${PDF}"`);
    // Thư thử cũng mang hình timeline để BTC xem đúng lá thư mentor nhận.
    expect(String(b.html)).toContain(`<img src="cid:${CID}"`);
    expect((b.attachments as Array<{ content_id?: string }>).map((a) => a.content_id)).toEqual([CID]);
  });
});

describe("3. file PDF hướng dẫn mở được khi chưa đăng nhập", () => {
  const request = (path: string) => new NextRequest(`https://os.test${path}`);

  it("đường file PDF không bị đưa về trang đăng nhập của ban tổ chức", async () => {
    const response = await middleware(request(ROUND2_GUIDE_PDF_PATH));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("đối chứng: cùng tên file đặt ngoài /chon-mentee/ thì bị đòi đăng nhập", async () => {
    const response = await middleware(request("/huong-dan-vong-2.pdf"));
    expect(response.headers.get("location")).toContain("/login");
  });
});

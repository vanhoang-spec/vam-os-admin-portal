/**
 * Vòng 2 — thư NHẮC mentor chưa chọn mentee (BTC 16/10/2026), phần thuần.
 *
 *   - ai được nhắc: còn chỗ, đã nhận thư mời (link đã gửi), link chưa thu hồi, CHƯA có cặp Vòng 2 nào
 *     (cặp Vòng 1 không tính), chưa được nhắc gần đây;
 *   - chỉ nhắc khi vòng đang mở;
 *   - nội dung: giọng thân mật, thúc đẩy hành động chứ không ra lệnh; mang đúng đường dẫn đã gửi, hạn,
 *     hướng dẫn; gỡ trở ngại (đổi 15 hồ sơ khác, bỏ chọn 30 phút); chữ BTC không thoát được HTML.
 */
import { describe, expect, it } from "vitest";
import { buildMatchingRound2ReminderEmail } from "@/lib/email-core";
import { EMAIL_SAMPLES } from "@/lib/email-samples";
import { outboundEmailKindLabel } from "@/lib/outbound-emails-core";
import { ROUND2_REMINDER_COOLDOWN_MS, isRound2ReminderRecipient, round2ReminderBlocked } from "@/lib/matching-round2-dispatch-core";
import type { Round2Row } from "@/lib/matching-round2-core";

const row = (over: Partial<Round2Row> & { email?: string | null } = {}): Round2Row => {
  const { email, ...rest } = over;
  return {
    person: { role: "mentor", personId: "p1", applicationId: "a1", name: "Mentor An", email: email === undefined ? "an@example.test" : email, eligible: true, details: [] },
    assignment: null,
    proposal: {} as any,
    group: 4,
    activeMatches: [],
    partnerNames: [],
    receivesList: true,
    slots: 2,
    ...rest
  } as Round2Row;
};
const match = (round: number | null) => ({ id: `m${round}`, mentorPersonId: "p1", menteePersonId: "x", status: "active", round, matchedAt: null, createdAt: null, endedAt: null, endReason: null });
const link = { id: "L1", token: "tok", revoked_at: null, last_sent_wave: 1 };
const none = new Set<string>();

describe("1. ai được nhắc", () => {
  it("mentor còn chỗ, đã nhận thư mời, chưa chọn ai: được nhắc", () => {
    expect(isRound2ReminderRecipient(row(), link, none)).toBe(true);
  });

  it("cặp Vòng 1 không tính là đã chọn ở Vòng 2: mentor đã nhận một bạn ở Vòng 1 mà còn chỗ vẫn được nhắc", () => {
    expect(isRound2ReminderRecipient(row({ activeMatches: [match(1)], slots: 1 }), link, none)).toBe(true);
  });

  it("đã có cặp Vòng 2 (kể cả còn chỗ thứ hai): KHÔNG nhắc — người đó đang tham gia", () => {
    expect(isRound2ReminderRecipient(row({ activeMatches: [match(2)], slots: 1 }), link, none)).toBe(false);
    expect(isRound2ReminderRecipient(row({ activeMatches: [match(1), match(2)], slots: 0, receivesList: false }), link, none)).toBe(false);
  });

  it.each([
    ["hết chỗ / không nhận danh sách", row({ receivesList: false, slots: 0 }), link],
    ["không phải mentor", row({ person: { ...row().person, role: "mentee" } }), link],
    ["không có email", row({ email: null }), link],
    ["chưa có link", row(), undefined],
    ["link đã thu hồi", row(), { ...link, revoked_at: "2026-10-15T00:00:00Z" }],
    ["link chưa có mã", row(), { ...link, token: "" }],
    ["chưa nhận thư mời (đợt 0): thuộc nút gửi mời, không phải nhắc", row(), { ...link, last_sent_wave: 0 }],
    ["đợt gửi không đọc được", row(), { ...link, last_sent_wave: null }]
  ])("không nhắc: %s", (_name, r, l) => {
    expect(isRound2ReminderRecipient(r as Round2Row, l as any, none)).toBe(false);
  });

  it("đã được nhắc gần đây (theo mã link) thì không nhắc lại; người khác không bị ảnh hưởng", () => {
    expect(isRound2ReminderRecipient(row(), link, new Set(["L1"]))).toBe(false);
    expect(isRound2ReminderRecipient(row(), link, new Set(["L2"]))).toBe(true);
  });

  it("cửa sổ chống nhắc trùng là 18 giờ: bấm lại cùng buổi không gửi trùng, nhưng sáng hôm sau nhắc tiếp được", () => {
    expect(ROUND2_REMINDER_COOLDOWN_MS).toBe(18 * 3_600_000);
  });
});

describe("2. chỉ nhắc khi vòng đang mở", () => {
  const now = Date.parse("2026-10-17T05:00:00Z");
  it("chưa mở, đã đóng, chưa đặt giờ: chặn; đang mở: cho", () => {
    expect(round2ReminderBlocked({ opensAt: "2026-10-17T06:00:00Z", closesAt: null }, now)).toContain("chưa mở");
    expect(round2ReminderBlocked({ opensAt: "2026-10-15T03:00:00Z", closesAt: "2026-10-17T05:00:00Z" }, now)).toContain("đã đóng");
    expect(round2ReminderBlocked(null, now)).toContain("chưa mở");
    expect(round2ReminderBlocked({ opensAt: "2026-10-15T03:00:00Z", closesAt: "2026-10-18T16:59:00Z" }, now)).toBeNull();
  });
});

describe("3. nội dung thư nhắc — thân mật, thúc đẩy hành động, không ra lệnh", () => {
  const base = {
    mentorName: "Nguyễn Văn An",
    seasonLabel: "UEH Mentoring Mùa 12",
    slotsLabel: "2",
    waitingMentees: 41,
    pickUrl: "https://os.alumni-mentoring.edu.vn/chon-mentee/6f1c0000-0000-4000-8000-000000000001",
    deadlineLabel: "18/10/2026 23:59 (giờ Việt Nam)",
    hotlineZalo: "0919144638",
    guidePdfUrl: "https://os.alumni-mentoring.edu.vn/chon-mentee/huong-dan-vong-2.pdf"
  };
  const mail = buildMatchingRound2ReminderEmail(base);

  it("mang đúng đường dẫn riêng đã gửi, hạn đóng, hướng dẫn PDF, Zalo hỗ trợ — cả bản chữ lẫn bản HTML", () => {
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain(base.pickUrl);
      expect(body).toContain("18/10/2026 23:59");
      expect(body).toContain(base.guidePdfUrl);
      expect(body).toContain("0919144638");
    }
    expect(mail.text).toContain("Chào Nguyễn Văn An,");
    expect(mail.subject).toBe("[UEH Mentoring] Nhắc nhẹ: các bạn mentee đang chờ Anh/Chị — UEH Mentoring Mùa 12");
    // Bản chữ: đường dẫn đứng riêng một dòng (không dính dấu câu cuối, trình đọc thư không cắt nhầm).
    expect(mail.text.split("\n")).toContain(base.pickUrl);
  });

  it("nói điều bạn mentee đang chờ, con số thật, số chỗ còn nhận; viết hoa Anh/Chị đầu câu", () => {
    expect(mail.text).toContain("Nhóm ngành của Anh/Chị hiện còn 41 bạn chưa có mentor.");
    expect(mail.text).toContain("Anh/Chị còn nhận được 2 mentee.");
    expect(mail.text).toContain("Cảm ơn Anh/Chị đã đồng hành cùng UEH Mentoring Mùa 12.");
    expect(mail.text).not.toMatch(/(^|[.!?]\s)anh\/chị/);
  });

  it("gỡ trở ngại: đổi 15 hồ sơ khác, bỏ chọn trong 30 phút, và chừa lối ra nếu chưa tiện", () => {
    expect(mail.text).toContain('"Đổi 15 hồ sơ khác"');
    expect(mail.text).toContain("bỏ chọn được trong 30 phút");
    expect(mail.text).toContain("chưa tiện, cũng không sao");
  });

  it("KHÔNG ra lệnh: không có “vui lòng”, “yêu cầu”, “bắt buộc”, “phải”, “ngay lập tức”, “gấp”, chữ in hoa dồn dập hay dấu chấm than nối nhau", () => {
    const words = mail.text.replace(base.pickUrl, "").replace(base.guidePdfUrl, "");
    for (const banned of [/vui lòng/i, /yêu cầu/i, /bắt buộc/i, /\bphải\b/i, /ngay lập tức/i, /\bgấp\b/i, /khẩn/i, /!!/, /\b[A-ZÀ-Ỵ]{5,}\b/]) {
      expect(words, String(banned)).not.toMatch(banned);
    }
    // Có đúng một lời mời hành động chính: nút/đường dẫn "Xem hồ sơ và chọn mentee".
    expect(mail.html).toContain("Xem hồ sơ và chọn mentee");
  });

  it("không biết số bạn đang chờ (trống, 0, âm, không phải số): bỏ câu đó chứ không nói “còn 0 bạn”", () => {
    for (const waitingMentees of [null, undefined, 0, -3, Number.NaN]) {
      const m = buildMatchingRound2ReminderEmail({ ...base, waitingMentees });
      expect(m.text, String(waitingMentees)).not.toContain("chưa có mentor.");
      expect(m.text).not.toMatch(/còn -?\d+ bạn|NaN/);
    }
  });

  it("thiếu hướng dẫn / số chỗ / hạn: bỏ đúng dòng đó, thư vẫn đọc trọn", () => {
    const m = buildMatchingRound2ReminderEmail({ ...base, guidePdfUrl: "", slotsLabel: "", deadlineLabel: "" });
    expect(m.text).not.toContain("file PDF");
    expect(m.text).not.toContain("còn nhận được");
    expect(m.text).not.toContain("Vòng 2 mở đến");
    expect(m.html).not.toContain("mở file PDF hướng dẫn");
    expect(m.text).toContain(base.pickUrl);
  });

  it("mọi chỗ chèn chữ vào thư (tên, mùa, số chỗ, hạn, đường dẫn, link hướng dẫn) bị thoát HTML; tên trống thì chào “Anh/Chị”", () => {
    const evil = buildMatchingRound2ReminderEmail({
      ...base,
      mentorName: "<img src=x onerror=alert(1)>",
      seasonLabel: "<b>Mùa X</b>",
      slotsLabel: "<u>2</u>",
      deadlineLabel: "<i>hôm nay</i>",
      pickUrl: 'https://x.test/"><script>alert(1)</script>',
      guidePdfUrl: 'https://x.test/h.pdf"><svg onload=alert(2)>'
    });
    for (const raw of ["<img src=x", "<b>Mùa", "<u>2", "<i>hôm nay", "<script", "<svg onload"]) expect(evil.html, raw).not.toContain(raw);
    expect(evil.html).toContain("&lt;img");
    expect(evil.html).toContain("&lt;b&gt;Mùa X");
    expect(buildMatchingRound2ReminderEmail({ ...base, mentorName: "  " }).text).toContain("Chào Anh/Chị,");
  });

  it("có mẫu trong thư viện Mẫu thư và nhãn trong nhật ký thư", () => {
    const sample = EMAIL_SAMPLES.find((s) => s.kind === "matching_round2_reminder");
    expect(sample?.body?.subject).toContain("Nhắc nhẹ");
    expect(sample?.body?.html).toContain("/chon-mentee/ma-vi-du");
    expect(outboundEmailKindLabel("matching_round2_reminder")).toBe("Nhắc mentor chọn mentee (Vòng 2)");
  });
});

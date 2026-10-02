/**
 * Thư xác nhận lịch phỏng vấn cho mentor — phần thuần.
 *
 * Sheet giả dưới đây chép đúng HÌNH DẠNG sheet đăng ký thật (02/10/2026): ô tiêu
 * đề gộp có xuống dòng, cột 4/10 đứng TRƯỚC cột 3/10, cột đợt 2 xen giữa. Đọc
 * theo vị trí cột thì mentor đăng ký sáng 3/10 nhận lịch sáng 4/10 — đúng loại
 * lỗi qua được mọi cổng và chỉ lộ ra khi mentor tới nhầm cơ sở.
 */
import { describe, expect, it } from "vitest";
import {
  buildInterviewBlocks,
  nameKey,
  parseSignupSheet,
  phoneKey,
  planRecipients,
  renderConfirmation,
  roundAnchor,
  sheetCsvUrl,
  splitVenue,
  type SessionInput
} from "@/lib/mentor-interview-confirmation-core";
import { textToHtmlEmail } from "@/lib/email-core";

const VENUE_H = "Phòng H101, H104, H201 — Cơ sở H, 1A Hoàng Diệu, Phường Phú Nhuận, Thành phố Hồ Chí Minh. Bản đồ: https://maps.app.goo.gl/hhhh";
const VENUE_H_PM = "Phòng H001, H101, H104 — Cơ sở H, 1A Hoàng Diệu, Phường Phú Nhuận, Thành phố Hồ Chí Minh. Bản đồ: https://maps.app.goo.gl/hhhh";
const VENUE_B = "Phòng B1-503, B1-504 — Cơ sở B, 279 Nguyễn Tri Phương, Phường Diên Hồng, Thành phố Hồ Chí Minh. Bản đồ: https://maps.app.goo.gl/bbbb";

// 03/10 08:00 VN = 01:00Z. Hai ca mỗi buổi đủ để kiểm "giờ của buổi = ca đầu → ca cuối".
const SESSIONS: SessionInput[] = [
  { id: "s3a1", startsAtIso: "2026-10-03T01:00:00.000Z", endsAtIso: "2026-10-03T01:30:00.000Z", venue: VENUE_H },
  { id: "s3a2", startsAtIso: "2026-10-03T04:00:00.000Z", endsAtIso: "2026-10-03T04:30:00.000Z", venue: VENUE_H },
  { id: "s3p1", startsAtIso: "2026-10-03T06:30:00.000Z", endsAtIso: "2026-10-03T07:00:00.000Z", venue: VENUE_H_PM },
  { id: "s3p2", startsAtIso: "2026-10-03T09:30:00.000Z", endsAtIso: "2026-10-03T10:00:00.000Z", venue: VENUE_H_PM },
  { id: "s4a1", startsAtIso: "2026-10-04T01:00:00.000Z", endsAtIso: "2026-10-04T01:30:00.000Z", venue: VENUE_B },
  { id: "s4p1", startsAtIso: "2026-10-04T06:30:00.000Z", endsAtIso: "2026-10-04T07:00:00.000Z", venue: VENUE_B }
];
const NOW = "2026-10-02T03:00:00.000Z";
const BLOCKS = buildInterviewBlocks(SESSIONS, NOW);

const q = (cells: string[]) => cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
const HEADER = q([
  "TUYỂN MENTEE MÙA 12 Thời gian phỏng vấn: Đợt 1: 3-4/10\nDANH SÁCH MENTOR STT ",
  "Họ và tên ",
  "Email\nLưu ý: Email dùng lúc điền đơn trên hệ thống VAM OS ",
  "Số điện thoại ",
  "Thời gian phỏng vấn anh chị có thể hỗ trợ Đợt 1 Sáng 4/10",
  "Chiều 4/10",
  "Sáng 3/10",
  "Chiều 3/10",
  "Đợt 2 Sáng 10/10",
  "Chiều 10/10",
  "Note (giờ đến, giờ về) "
]);
const row = (stt: string, name: string, email: string, phone: string, s4: boolean, c4: boolean, s3: boolean, c3: boolean, note = "") =>
  q([stt, name, email, phone, String(s4).toUpperCase(), String(c4).toUpperCase(), String(s3).toUpperCase(), String(c3).toUpperCase(), "TRUE", "FALSE", note]);
const CSV = [
  HEADER,
  row("1", "Trần Văn A", "a@example.test", "0901 111 111", false, false, true, false),
  row("2", "Lê Thị B", "B@Example.test", "0902222222", true, false, false, true, "Sáng 9h-11h30"),
  row("3", "Nguyễn Viết Tuấn", "khac@example.test", "093 8883938", false, false, true, true),
  row("4", "Chỉ Đợt Hai", "dot2@example.test", "0904444444", false, false, false, false),
  row("5", "", "khong-phai-email", "", true, true, true, true),
  row("6", "Lê Thị B", "b@example.test", "0902222222", false, true, false, false)
].join("\n");

describe("1. link sheet → địa chỉ đọc CSV", () => {
  it("dựng đúng địa chỉ xuất CSV, giữ gid của trang tính", () => {
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1xei5xJX45v-5rn3-mHuEpG5nYzuk-tIN61v8UpRG29Y/edit?gid=1947266161#gid=1947266161"))
      .toBe("https://docs.google.com/spreadsheets/d/1xei5xJX45v-5rn3-mHuEpG5nYzuk-tIN61v8UpRG29Y/gviz/tq?tqx=out:csv&gid=1947266161");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1xei5xJX45v-5rn3-mHuEpG5nYzuk/edit")).toMatch(/gid=0$/);
  });
  it.each([
    "http://docs.google.com/spreadsheets/d/1xei5xJX45v-5rn3-mHuEpG5nYzuk/edit",
    "https://docs.google.com.evil.test/spreadsheets/d/1xei5xJX45v-5rn3-mHuEpG5nYzuk/edit",
    "https://evil.test/?u=https://docs.google.com/spreadsheets/d/1xei5xJX45v-5rn3-mHuEpG5nYzuk",
    "https://docs.google.com/document/d/1xei5xJX45v-5rn3-mHuEpG5nYzuk/edit",
    "javascript:alert(1)",
    "",
    null
  ])("từ chối %s", (link) => {
    expect(sheetCsvUrl(link)).toBeNull();
  });
});

describe("2. buổi phỏng vấn đọc từ ca", () => {
  it("gom ca thành buổi: nhãn, giờ ca đầu → ca cuối, phòng, cơ sở, bản đồ", () => {
    expect(BLOCKS.map((b) => b.key)).toEqual(["2026-10-03:sang", "2026-10-03:chieu", "2026-10-04:sang", "2026-10-04:chieu"]);
    const [sang3, chieu3] = BLOCKS;
    expect(sang3).toMatchObject({
      headerLabel: "Sáng 3/10",
      label: "Thứ Bảy 03/10/2026 — buổi sáng",
      timeLabel: "08:00 – 11:30",
      rooms: "H101, H104, H201",
      place: "Cơ sở H, 1A Hoàng Diệu, Phường Phú Nhuận, Thành phố Hồ Chí Minh",
      mapUrl: "https://maps.app.goo.gl/hhhh",
      firstSessionId: "s3a1"
    });
    expect(chieu3).toMatchObject({ headerLabel: "Chiều 3/10", timeLabel: "13:30 – 17:00", rooms: "H001, H101, H104" });
    expect(BLOCKS[2].label).toBe("Chủ nhật 04/10/2026 — buổi sáng");
  });
  it("ca đã kết thúc rơi khỏi danh sách; mốc đợt là ca sớm nhất còn lại", () => {
    const later = buildInterviewBlocks(SESSIONS, "2026-10-03T12:00:00.000Z");
    expect(later.map((b) => b.key)).toEqual(["2026-10-04:sang", "2026-10-04:chieu"]);
    expect(roundAnchor(BLOCKS)).toEqual({ sessionId: "s3a1", startsAtIso: "2026-10-03T01:00:00.000Z" });
    expect(roundAnchor([])).toBeNull();
  });
  it("địa điểm không đúng dạng thì giữ nguyên chuỗi ở ô cơ sở", () => {
    expect(splitVenue("Hội trường A")).toEqual({ rooms: "", place: "Hội trường A", mapUrl: "" });
    expect(splitVenue(null)).toEqual({ rooms: "", place: "", mapUrl: "" });
  });
});

describe("3. đọc sheet theo tiêu đề cột", () => {
  it("cột 4/10 đứng trước 3/10 vẫn ra đúng buổi; email chữ hoa gộp với chữ thường; dòng không phải email bị bỏ", () => {
    const parsed = parseSignupSheet(CSV, BLOCKS);
    if (!parsed.ok) throw new Error(parsed.message);
    const by = new Map(parsed.rows.map((r) => [r.email, r]));
    expect(by.get("a@example.test")?.blockKeys).toEqual(["2026-10-03:sang"]);
    // Dòng 2 (sáng 4 + chiều 3) và dòng 6 (chiều 4) là cùng một người: gộp, không gửi hai thư.
    expect(by.get("b@example.test")?.blockKeys.sort()).toEqual(["2026-10-03:chieu", "2026-10-04:chieu", "2026-10-04:sang"]);
    expect(by.get("b@example.test")?.note).toBe("Sáng 9h-11h30");
    expect(parsed.duplicates).toEqual(["b@example.test"]);
    expect(by.get("dot2@example.test")?.blockKeys).toEqual([]);
    expect(by.has("khong-phai-email")).toBe(false);
    expect(parsed.rows).toHaveLength(4);
  });
  it("thiếu cột của một buổi đang có ca: từ chối cả sheet", () => {
    const noChieu3 = CSV.replace('"Chiều 3/10"', '"Chiều 30/10"');
    const parsed = parseSignupSheet(noChieu3, BLOCKS);
    expect(parsed).toEqual({ ok: false, message: "Sheet không có cột cho buổi: Chiều 3/10." });
  });
  it("không có hàng tiêu đề: từ chối", () => {
    expect(parseSignupSheet("a,b\n1,2", BLOCKS).ok).toBe(false);
  });
});

describe("4. ai nhận thư, gửi tới đâu", () => {
  const parsed = parseSignupSheet(CSV, BLOCKS);
  if (!parsed.ok) throw new Error(parsed.message);
  const participants = [
    { email: "a@example.test", fullName: "Trần Văn A", phone: "0901111111" },
    { email: "b@example.test", fullName: "Lê Thị B", phone: "0902222222" },
    { email: "nvt@example.test", fullName: "Nguyễn Viết Tuấn", phone: "0938883938" }
  ];
  it("khớp email → sẵn sàng; đã nhận thư đợt này → không gửi lại; không đăng ký buổi nào → không gửi", () => {
    const plan = planRecipients(parsed.rows, participants, new Set(["b@example.test"]));
    const by = new Map(plan.map((r) => [r.email, r]));
    expect(by.get("a@example.test")).toMatchObject({ status: "ready", loginEmail: "a@example.test", matchedBy: "email" });
    expect(by.get("b@example.test")?.status).toBe("already_sent");
    expect(by.get("dot2@example.test")?.status).toBe("no_blocks");
  });
  it("email sheet khác email tài khoản: khớp khi SĐT trùng đúng một tài khoản VÀ tên trùng", () => {
    const plan = planRecipients(parsed.rows, participants, new Set());
    expect(plan.find((r) => r.email === "khac@example.test")).toMatchObject({
      status: "ready", loginEmail: "nvt@example.test", matchedBy: "phone_and_name"
    });
  });
  it("SĐT trùng nhưng tên khác, hoặc SĐT trùng hai tài khoản: KHÔNG khớp", () => {
    const otherName = participants.map((p) => (p.email === "nvt@example.test" ? { ...p, fullName: "Người Khác" } : p));
    expect(planRecipients(parsed.rows, otherName, new Set()).find((r) => r.email === "khac@example.test")?.status).toBe("no_access");
    const twoPhones = [...participants, { email: "x@example.test", fullName: "Nguyễn Viết Tuấn", phone: "938883938" }];
    expect(planRecipients(parsed.rows, twoPhones, new Set()).find((r) => r.email === "khac@example.test")?.status).toBe("no_access");
  });
  it("không có quyền phỏng vấn → không gửi", () => {
    const plan = planRecipients(parsed.rows, [], new Set());
    expect(plan.filter((r) => r.status === "ready")).toHaveLength(0);
  });
  it("khoá SĐT và tên", () => {
    expect(phoneKey("093 9067841")).toBe(phoneKey("0939067841"));
    expect(phoneKey("915767858")).toBe("915767858");
    expect(phoneKey("12")).toBe("");
    expect(nameKey("  Nguyễn  Viết TUẤN ")).toBe("nguyen viet tuan");
    expect(nameKey("Đồng Lê Quỳnh Hương")).toBe("dong le quynh huong");
  });
});

describe("5. nội dung thư", () => {
  const blocksOf = (keys: string[]) => BLOCKS.filter((b) => keys.includes(b.key));
  const mail = renderConfirmation({
    name: "Trần Văn A",
    loginEmail: "a@example.test",
    matchedBy: "email",
    note: "",
    blocks: blocksOf(["2026-10-03:sang", "2026-10-04:chieu"]),
    origin: "https://os.alumni-mentoring.edu.vn/"
  });
  it("đúng tiêu đề mẫu BTC và đủ 5 mục theo thứ tự", () => {
    expect(mail.subject).toBe("UEH MENTORING | THƯ XÁC NHẬN ĐĂNG KÝ LỊCH PHỎNG VẤN MENTEE MÙA 12");
    const order = ["Kính gửi Anh/Chị Mentor Trần Văn A,", "1. Thời gian", "2. Địa điểm", "3. Tài khoản chấm", "4. Bảng tiêu chí", "5. Group Zalo", "Trân trọng,"];
    const idx = order.map((s) => mail.body.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it("chỉ các buổi của chính mentor, kèm giờ, phòng, cơ sở, bản đồ", () => {
    expect(mail.body).toContain("- Thứ Bảy 03/10/2026 — buổi sáng: 08:00 – 11:30");
    expect(mail.body).toContain("- Chủ nhật 04/10/2026 — buổi chiều: 13:30 – 14:00");
    expect(mail.body).not.toContain("Chủ nhật 04/10/2026 — buổi sáng");
    expect(mail.body).not.toContain("Thứ Bảy 03/10/2026 — buổi chiều");
    expect(mail.body).toContain("- Phòng: H101, H104, H201");
    expect(mail.body).toContain("- Cơ sở: Cơ sở B, 279 Nguyễn Tri Phương, Phường Diên Hồng, Thành phố Hồ Chí Minh");
    expect(mail.body).toContain("- Link maps: https://maps.app.goo.gl/bbbb");
    expect(mail.body).toContain("có mặt trước 15 phút");
  });
  it("tài khoản, link đăng nhập (không lặp dấu /), Zalo, hotline", () => {
    expect(mail.body).toContain("- Tài khoản: a@example.test");
    expect(mail.body).toContain("https://os.alumni-mentoring.edu.vn/login");
    expect(mail.body).not.toContain("edu.vn//");
    expect(mail.body).toContain("Đặt lại mật khẩu");
    expect(mail.body).toContain("https://zalo.me/g/vk1tvjxrvycq3rnk8k3s");
    expect(mail.body).toContain("Hotline: Mỹ Anh (0394983679), Hoàng Vy (0936359670)");
    expect(mail.body).not.toContain("khác email điền trong form");
  });
  it("ghi chú giờ đến/về và lưu ý khớp theo SĐT chỉ hiện khi có", () => {
    const withNote = renderConfirmation({
      name: "Nguyễn Viết Tuấn", loginEmail: "nvt@example.test", matchedBy: "phone_and_name", note: "Sáng 9h-11h30",
      blocks: blocksOf(["2026-10-03:sang"]), origin: "https://os.alumni-mentoring.edu.vn"
    });
    expect(withNote.body).toContain("- Ghi chú Anh/Chị đã đăng ký: Sáng 9h-11h30");
    expect(withNote.body).toContain("khác email điền trong form đăng ký phỏng vấn");
    expect(mail.body).not.toContain("Ghi chú Anh/Chị đã đăng ký");
  });
  it("tên do người đăng ký tự gõ không chèn được thẻ HTML vào thư", () => {
    const evil = renderConfirmation({
      name: "<script>alert(1)</script>", loginEmail: "a@example.test", matchedBy: "email", note: "<img src=x onerror=1>",
      blocks: blocksOf(["2026-10-03:sang"]), origin: "https://os.alumni-mentoring.edu.vn"
    });
    const html = textToHtmlEmail(evil.body);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});

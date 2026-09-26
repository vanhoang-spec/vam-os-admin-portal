/**
 * Hướng dẫn "Phỏng vấn mentee giai đoạn 1" — không được nói sai màn hình, và
 * không được in một lá thư khác với lá thư mentee thật sự nhận.
 *
 * ---------------------------------------------------------------------------
 * CA QUAN TRỌNG NHẤT: MỤC 3
 * ---------------------------------------------------------------------------
 * Trang 2 in nguyên văn hai lá thư. Người đọc hướng dẫn là người sẽ trả lời
 * mentee gọi hỏi "thư nói gì" — nếu hướng dẫn in bản cũ, họ trả lời theo bản
 * cũ. Mục 3 gọi CHÍNH hàm dựng thư với đúng dữ liệu ví dụ trong hướng dẫn và
 * đòi từng dòng của nó có mặt. Ai sửa câu chữ trong lib/email-core.ts mà quên
 * dựng lại hướng dẫn thì bài này đỏ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildMenteeSessionConfirmedEmail, buildMenteeSessionInviteEmail } from "@/lib/email-core";
import { AUTOMATION_SLOTS } from "@/lib/email-automation-core";
import {
  DAILY_EMAIL_LIMIT,
  DISPATCH_MAX_PER_RUN,
  DISPATCH_RESERVE
} from "@/lib/mentee-invite-dispatch-core";
import { HOTLINE_ZALO, MENTEE_VENUE_PENDING_LABEL } from "@/lib/mentee-interview-core";
import { canAssignReview, canDecideAnyApplicationResult } from "@/lib/permissions";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const html = read("docs/huong-dan/HUONG_DAN_PHONG_VAN_MENTEE_GIAI_DOAN_1.html");
/** Hướng dẫn như người đọc thấy: bỏ style, bỏ thẻ, đổi thực thể, gộp khoảng trắng. */
const guideText = html
  .replace(/<style[\s\S]*?<\/style>/i, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

const NAV = "lib/nav-model.ts";
const APPS = "app/applications/page.tsx";
const BULK_PAGE = "app/applications/bulk-invite-interview/page.tsx";
const BULK_CORE = "lib/bulk-invite-interview.ts";
const PANEL = "app/interviews/ca-mentee/session-config-client.tsx";
const DISPATCH = "lib/mentee-invite-dispatch.ts";
const CORE = "lib/mentee-interview-core.ts";
const EDITOR = "app/operations/mail/samples/automation-editor.tsx";
const TABS = "app/operations/mail/mail-tabs.tsx";

// [câu hướng dẫn trích, file nguồn, chuỗi phải có trong file nguồn]
const QUOTED: Array<[string, string, string]> = [
  // Đường đi
  ["Ca phỏng vấn mentee", NAV, '"Ca phỏng vấn mentee"'],
  ["Ứng tuyển (Tất cả)", NAV, '"Ứng tuyển (Tất cả)"'],
  ["Mời phỏng vấn hàng loạt", APPS, "Mời phỏng vấn hàng loạt"],
  ["Nhật ký gửi", TABS, '"Nhật ký gửi"'],
  // Bước 1
  ["Áp địa điểm cho mọi ca", PANEL, "Áp địa điểm cho mọi ca"],
  // Bước 2
  ["Đề xuất của người chấm", BULK_PAGE, "Đề xuất của người chấm"],
  ["Mời vào vòng phỏng vấn", BULK_CORE, '"Mời vào vòng phỏng vấn"'],
  // Bước 3
  ["Tôi đã kiểm tra", PANEL, "Tôi đã kiểm tra"],
  ["Gửi thư mời chọn ca", PANEL, "Gửi thư mời chọn ca"],
  ["Chờ thư mời", PANEL, "Chờ thư mời"],
  ["Thư đã gửi 24 giờ qua", PANEL, "Thư đã gửi 24 giờ qua"],
  // Dòng báo khi nút khoá
  ["Chưa có ca nào đặt được", DISPATCH, "Chưa có ca nào đặt được"],
  ["Đã chạm phần hạn mức của thư mời", DISPATCH, "Đã chạm phần hạn mức của thư mời"],
  ["Không còn ai chờ thư mời", PANEL, "Không còn ai chờ thư mời"],
  // Trạng thái ca mentee thấy
  ["Chưa mở", CORE, '"Chưa mở"'],
  ["Đã kín chỗ", CORE, '"Đã kín chỗ"'],
  ["Hết hạn đăng ký", CORE, '"Hết hạn đăng ký"'],
  // Sửa thư
  ["Xem trước bản đang lưu", EDITOR, "Xem trước bản đang lưu"]
];

describe("1. mọi chữ trích trong hướng dẫn đều có thật trên màn hình", () => {
  it.each(QUOTED)("“%s”", (quoted, sourceFile, needle) => {
    expect(guideText).toContain(quoted);
    expect(read(sourceFile)).toContain(needle);
  });

  it("tên hai lá thư trùng đúng tên trong tab Thư tự động", () => {
    const titles = AUTOMATION_SLOTS.filter((slot) => slot.kind.startsWith("mentee_session_")).map(
      (slot) => slot.title
    );
    expect(titles).toHaveLength(2);
    for (const title of titles) expect(guideText, title).toContain(title);
  });
});

describe("2. các con số khớp mã nguồn và migration", () => {
  const migration = read("supabase/migrations/20260926100000_giai_doan_1_pv_mentee.sql");

  it("hạn mức thư, phần chừa lại và số thư mỗi lần bấm", () => {
    expect(guideText).toContain(`${DAILY_EMAIL_LIMIT} thư mỗi 24 giờ`);
    expect(guideText).toContain(`chừa ${DISPATCH_RESERVE} thư`);
    expect(guideText).toContain(`tối đa ${DISPATCH_MAX_PER_RUN} thư`);
  });

  it("24 ca, 25 ghế, 600 chỗ, hạn 30/09 23:59 — đúng như migration đã dán", () => {
    expect(migration).toContain("v_total <> 24");
    expect(migration).toContain("+ interval '30 minutes',\n       25,");
    expect(migration).toContain("'2026-09-30 23:59:59+07:00'::timestamptz");
    expect(guideText).toContain("24 ca");
    expect(guideText).toContain("25 ghế");
    expect(guideText).toContain(`${24 * 25} chỗ`);
    expect(guideText).toContain("23:59 ngày 30/09");
  });

  it("câu thay cho địa điểm chưa điền đúng như hệ thống điền", () => {
    expect(guideText).toContain(MENTEE_VENUE_PENDING_LABEL);
  });
});

describe("3. hai lá thư in ra khớp từng dòng với hàm dựng thư thật", () => {
  // Đúng dữ liệu ví dụ đang in trong hướng dẫn.
  const invite = buildMenteeSessionInviteEmail({
    candidateName: "Nguyễn Văn A",
    seasonLabel: "UEH Mentoring Mùa 12",
    interviewDaysLabel: "Thứ Bảy 03/10/2026 và Chủ nhật 04/10/2026",
    bookingUrl: "https://os.alumni-mentoring.edu.vn/dat-ca/ma-rieng-cua-tung-ban",
    deadlineLabel: "23:59 ngày 30/09/2026",
    hotlineZalo: HOTLINE_ZALO
  });
  const confirmed = buildMenteeSessionConfirmedEmail({
    candidateName: "Nguyễn Văn A",
    sessionLabel: "Thứ Bảy 03/10/2026, 08:00 – 08:30 (giờ Việt Nam)",
    venueLabel: MENTEE_VENUE_PENDING_LABEL,
    manageUrl: "https://os.alumni-mentoring.edu.vn/dat-ca/ma-rieng-cua-tung-ban",
    hotlineZalo: HOTLINE_ZALO
  });

  const lines = (text: string) => text.split("\n").map(collapse).filter(Boolean);

  it("thư mời: tiêu đề và từng dòng thân thư", () => {
    expect(guideText).toContain(collapse(invite.subject));
    for (const line of lines(invite.text)) expect(guideText, line).toContain(line);
  });

  it("thư xác nhận: tiêu đề và từng dòng thân thư", () => {
    expect(guideText).toContain(collapse(confirmed.subject));
    for (const line of lines(confirmed.text)) expect(guideText, line).toContain(line);
  });

  it("nói rõ nội dung đang gửi thật có thể đã được sửa khác bản mặc định", () => {
    expect(guideText).toContain("Nội dung đang gửi thật có thể khác bản mặc định này");
  });
});

describe("4. ai làm được bước nào — khớp cổng quyền thật", () => {
  /**
   * Soi đúng ô "ai làm" của TỪNG bước. Tìm chung cả trang thì "Core team · Admin"
   * khớp luôn vào "Core team · Admin · Support team" của bước 2, và hướng dẫn
   * ghi nhầm Support team vào bước 3 vẫn xanh — người Support team sẽ đi tìm
   * một nút mà họ không bao giờ thấy.
   */
  const whoOfStep = (title: string) => {
    const match = html.match(
      new RegExp(`<b class="t">${title}</b>\\s*<span class="who">([^<]+)</span>`)
    );
    return match?.[1].trim();
  };

  it("bước 1 và 3 nằm sau cổng canAssignReview — Core team, Admin, KHÔNG có Support team", () => {
    expect(read("lib/mentee-session-admin.ts")).toContain("if (!canAssignReview(admin.role))");
    expect(canAssignReview("core_team")).toBe(true);
    expect(canAssignReview("admin")).toBe(true);
    expect(canAssignReview("support_team")).toBe(false);
    expect(whoOfStep("Điền địa điểm")).toBe("Core team · Admin");
    expect(whoOfStep("Gửi thư mời chọn ca")).toBe("Core team · Admin");
  });

  it("bước 2 nằm sau cổng canDecideAnyApplicationResult — Support team làm được", () => {
    expect(read(BULK_PAGE)).toContain("if (!canDecideAnyApplicationResult(actor.role))");
    expect(canDecideAnyApplicationResult("support_team")).toBe(true);
    expect(whoOfStep("Mời đúng những bạn được đề xuất")).toBe("Core team · Admin · Support team");
  });
});

describe("5. những điều hướng dẫn không được quên", () => {
  /**
   * Bỏ bộ lọc đề xuất là mời cả những bạn bị đề xuất không phù hợp — và thư mời
   * đã gửi thì không rút lại được.
   */
  it("dặn đừng bỏ bộ lọc đề xuất, và thư đã gửi không rút lại được", () => {
    expect(guideText).toContain("Đừng bỏ bộ lọc đề xuất");
    expect(guideText).toContain("không rút lại được");
  });

  it("nói rõ mentee không tự huỷ được, và đổi ca không làm mất chỗ", () => {
    expect(guideText).toContain("không tự huỷ được");
    expect(guideText).toContain("Chỗ cũ chỉ được nhả khi ca mới còn chỗ");
  });

  it("nói rõ những ai chưa nằm trong giai đoạn 1", () => {
    expect(guideText).toContain("giai đoạn 2, 10 & 11/10");
    expect(guideText).toContain("danh sách chờ");
    expect(guideText).toContain("cần core team xem thêm");
  });

  it("không mang dữ liệu cá nhân thật — chỉ địa chỉ gửi thư và hotline chính thức", () => {
    const emails = guideText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
    for (const email of emails) expect(email).toBe("hello@alumni-mentoring.edu.vn");
    const phones = guideText.match(/0\d{9}/g) ?? [];
    for (const phone of phones) expect(phone).toBe(HOTLINE_ZALO);
  });
});

describe("6. đúng HAI trang khi in", () => {
  it("bản PDF có đúng hai trang: quy trình và hai lá thư", () => {
    const pdf = readFileSync(join(ROOT, "docs/huong-dan/HUONG_DAN_PHONG_VAN_MENTEE_GIAI_DOAN_1.pdf"), "latin1");
    const pages = pdf.match(/\/Type\s*\/Page[^s]/g);
    expect(pages, "không đọc được số trang trong PDF — dựng lại bằng Chrome headless").not.toBeNull();
    expect(pages).toHaveLength(2);
  });
});

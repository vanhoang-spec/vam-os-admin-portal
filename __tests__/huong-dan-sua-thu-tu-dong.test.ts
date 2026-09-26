/**
 * Hướng dẫn một trang "Sửa nội dung thư tự động" — không được nói sai màn hình.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO TÀI LIỆU NÀY CẦN BỊ CANH CHẶT HƠN CÁC TÀI LIỆU KHÁC
 * ---------------------------------------------------------------------------
 * Người đọc nó xong sẽ đi sửa câu chữ của những lá thư gửi tự động cho hàng
 * trăm người, và KHÔNG có bước ai duyệt sau đó. Một hướng dẫn nói sai ở đây
 * không tốn của họ một cú bấm — nó tốn một lá thư đã nằm trong hộp thư người
 * khác, và thư đã gửi thì không rút lại được.
 *
 * Nên mọi chữ trích và mọi con số phải có thật trong mã nguồn đang chạy. Đổi
 * một nhãn nút hay một lời báo lỗi mà quên sửa hướng dẫn thì test này đỏ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AUTOMATION_GROUPS, AUTOMATION_SLOTS } from "@/lib/email-automation-core";
import { MAX_BODY_LENGTH, MAX_SUBJECT_LENGTH } from "@/lib/email-templates-core";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const html = read("docs/huong-dan/HUONG_DAN_SUA_THU_TU_DONG.html");
/** Hướng dẫn như người đọc thấy: bỏ style, bỏ thẻ, gộp khoảng trắng. */
const guideText = html
  .replace(/<style[\s\S]*?<\/style>/i, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

const CORE = "lib/email-automation-core.ts";
const SERVER = "lib/email-automation.ts";
const EDITOR = "app/operations/mail/samples/automation-editor.tsx";
const PAGE = "app/operations/mail/samples/page.tsx";

// [câu hướng dẫn trích, file nguồn, chuỗi phải có trong file nguồn]
const QUOTED: Array<[string, string, string]> = [
  // Nhãn nút trên màn hình.
  ["Xem và sửa", EDITOR, '"Xem và sửa"'],
  ["Trả về bản mặc định", EDITOR, 'label="Trả về bản mặc định"'],
  ["Ban tổ chức đã sửa", EDITOR, '"Ban tổ chức đã sửa"'],
  ["Bản mặc định", EDITOR, '"Bản mặc định"'],
  ["Xem trước bản đang lưu (dữ liệu ví dụ)", EDITOR, "Xem trước bản đang lưu (dữ liệu ví dụ)"],
  ["Lịch sử sửa", EDITOR, "Lịch sử sửa"],

  // Lời báo khi thành công.
  [
    "Đã lưu. Thư gửi từ bây giờ dùng nội dung này.",
    SERVER,
    "Đã lưu. Thư gửi từ bây giờ dùng nội dung này."
  ],
  ["Đã trả về bản mặc định của hệ thống.", SERVER, "Đã trả về bản mặc định của hệ thống."],

  // Lời báo khi bị từ chối — phần người đọc tra cứu nhiều nhất.
  ["Thư bắt buộc phải còn", CORE, "Thư bắt buộc phải còn"],
  ["Thư đang dùng ô không có dữ liệu:", CORE, "Thư đang dùng ô không có dữ liệu:"],
  [
    "Thư chỉ nhận văn bản thuần, không nhận thẻ HTML",
    CORE,
    "Thư chỉ nhận văn bản thuần, không nhận thẻ HTML"
  ],
  ["Vui lòng nhập tiêu đề thư.", CORE, "Vui lòng nhập tiêu đề thư."],

  // Đường đi trên nav.
  ["Thư tự động", PAGE, "Thư tự động"],
  ["Mẫu thư", PAGE, "Mẫu thư"],
  ["Nhật ký gửi", "app/operations/mail/mail-tabs.tsx", "Nhật ký gửi"]
];

describe("1. mọi chữ trích trong hướng dẫn đều có thật trên màn hình", () => {
  it.each(QUOTED)("“%s”", (quoted, sourceFile, needle) => {
    expect(guideText).toContain(quoted);
    expect(read(sourceFile)).toContain(needle);
  });
});

describe("2. các con số khớp mã nguồn", () => {
  it("số lá thư sửa được", () => {
    expect(AUTOMATION_SLOTS).toHaveLength(19);
    expect(guideText).toContain(`${AUTOMATION_SLOTS.length} lá`);
  });

  it("trần độ dài tiêu đề và nội dung", () => {
    expect(MAX_SUBJECT_LENGTH).toBe(200);
    expect(MAX_BODY_LENGTH).toBe(8_000);
    expect(guideText).toContain(`${MAX_SUBJECT_LENGTH} ký tự`);
    // Tài liệu viết cho người đọc nên dùng dấu chấm phân nhóm nghìn.
    expect(guideText).toContain("8.000 ký tự");
  });

  it("ba nhóm thư gọi đúng tên như trên màn hình", () => {
    expect(AUTOMATION_GROUPS).toHaveLength(3);
    for (const group of AUTOMATION_GROUPS) {
      expect(guideText, group).toContain(group);
    }
  });
});

describe("3. những điều tài liệu không được quên", () => {
  /**
   * Đây là khác biệt nguy hiểm nhất so với tab "Mẫu thư", nơi có người duyệt
   * trước khi gửi. Người quen tay với Mẫu thư sẽ mặc định là ở đây cũng vậy, và
   * sẽ bấm Lưu để "xem thử" — trong khi lá thư tiếp theo đã dùng nội dung đó.
   */
  it("nói rõ lưu là có hiệu lực NGAY, không có bước duyệt", () => {
    expect(guideText).toContain("không có bước ai duyệt");
    expect(guideText).toContain("không rút lại được");
  });

  /**
   * Ô điền là thứ duy nhất trong tài liệu mà hiểu sai sẽ hỏng dữ liệu thật:
   * xoá một ô bắt buộc thì bị chặn, nhưng viết sẵn tên người vào thư thì KHÔNG
   * bị chặn — và mọi người nhận sẽ thấy tên của cùng một người.
   */
  it("giải thích ô điền, và cảnh báo đừng viết sẵn tên người", () => {
    expect(guideText).toContain("ten_nguoi_nhan");
    expect(guideText).toContain("Đừng viết sẵn tên người vào thư");
  });

  it("nói rõ ô bắt buộc bị xoá thì KHÔNG lưu được", () => {
    expect(guideText).toContain("Bắt buộc");
    expect(guideText).toContain("từ chối lưu");
  });

  it("nói rõ dòng chứa ô không có dữ liệu thì biến mất cả dòng", () => {
    expect(guideText).toContain("cả dòng chứa ô ấy không xuất hiện");
  });

  it("nói rõ sửa nhầm vẫn quay lại được, và lịch sử giữ bản cũ", () => {
    expect(guideText).toContain("Sửa nhầm thì làm gì");
    expect(guideText).toContain("nội dung trước đó");
  });

  /**
   * Bốn lá thư sự kiện vẫn hiện trên cùng màn hình nhưng chỉ để đọc. Không nói
   * ra thì người trực support sẽ ngồi tìm nút "Xem và sửa" ở một lá không có nó
   * và tưởng màn hình hỏng.
   */
  it("nói rõ thư sự kiện chưa sửa được từ đây, và chúng nằm ở đâu", () => {
    expect(guideText).toContain("chưa sửa được từ đây");
    expect(guideText).toContain("cuối trang");
  });

  it("nói rõ sổ thư không lưu nội dung từng lá", () => {
    expect(guideText).toContain("không lưu");
    expect(guideText).toContain("thân thư");
  });

  it("nói rõ ai làm được và ai không", () => {
    for (const role of ["Core team", "Support team", "Admin"]) {
      expect(guideText, role).toContain(role);
    }
    expect(guideText).toContain("Reviewer");
    expect(guideText).toContain("không mở được trang này");
  });

  it("không mang dữ liệu cá nhân của người thật", () => {
    expect(guideText).not.toMatch(/[\w.+-]+@(?!example\.com)[\w-]+\.[\w.]+/);
    expect(guideText).not.toMatch(/0\d{9}/);
  });
});

describe("4. vẫn đúng MỘT trang khi in", () => {
  it("bản PDF có đúng một trang", () => {
    const pdf = readFileSync(join(ROOT, "docs/huong-dan/HUONG_DAN_SUA_THU_TU_DONG.pdf"), "latin1");
    const pages = pdf.match(/\/Type\s*\/Page[^s]/g);
    expect(pages, "không đọc được số trang trong PDF — dựng lại bằng Chrome headless").not.toBeNull();
    expect(pages).toHaveLength(1);
  });
});

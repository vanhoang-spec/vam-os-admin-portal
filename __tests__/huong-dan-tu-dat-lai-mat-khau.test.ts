/**
 * Hướng dẫn một trang "Quên mật khẩu? Tự đặt lại" — không được nói sai màn hình.
 *
 * Người đọc là người ĐANG không vào được hệ thống: họ không đối chiếu được
 * hướng dẫn với màn hình vì màn hình họ cần đang khoá. Một nhãn nút sai ở đây
 * tốn của họ một vòng nhắn tin cho ban tổ chức — đúng thứ tính năng này sinh ra
 * để xoá bỏ.
 *
 * Mọi chữ trích và mọi con số trong tài liệu phải có thật trong mã nguồn đang
 * chạy. Đổi một nhãn mà quên sửa hướng dẫn thì test này đỏ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, PASSWORD_LINK_PATH } from "@/lib/password-link-core";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const html = read("docs/huong-dan/HUONG_DAN_TU_DAT_LAI_MAT_KHAU.html");
/** Hướng dẫn như người đọc thấy: bỏ style, bỏ thẻ, gộp khoảng trắng. */
const guideText = html
  .replace(/<style[\s\S]*?<\/style>/i, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

const LOGIN_FORM = "app/login/login-form.tsx";
const LOGIN_PAGE = "app/login/page.tsx";
const RESET_PAGE = "app/reset-password/page.tsx";
const LINK_CORE = "lib/password-link-core.ts";

// [câu hướng dẫn trích, file nguồn, chuỗi phải có trong file nguồn]
const QUOTED: Array<[string, string, string]> = [
  ["Đặt lại mật khẩu", LOGIN_FORM, '"Đặt lại mật khẩu"'],
  ["Gửi liên kết đăng nhập qua email", LOGIN_FORM, '"Gửi liên kết đăng nhập qua email"'],
  ["Chưa đặt mật khẩu, hoặc không nhớ mật khẩu?", LOGIN_FORM, "Chưa đặt mật khẩu, hoặc không nhớ mật khẩu?"],
  [
    "Nếu email này có tài khoản, chúng tôi đã gửi một liên kết đặt lại mật khẩu.",
    LOGIN_FORM,
    "Nếu email này có tài khoản, chúng tôi đã gửi một liên kết đặt lại"
  ],
  ["Nhập mật khẩu mới cho tài khoản VAM OS của bạn.", RESET_PAGE, "Nhập mật khẩu mới cho tài khoản VAM OS của bạn."],
  ["Mật khẩu đã được cập nhật!", RESET_PAGE, "Mật khẩu đã được cập nhật!"],
  ["Quay lại đăng nhập", RESET_PAGE, "Quay lại đăng nhập"],
  ["Link không hợp lệ", RESET_PAGE, "Link không hợp lệ"],
  ["Mật khẩu phải có ít nhất 8 ký tự.", LINK_CORE, "Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự."],
  ["Mật khẩu nhập lại không khớp.", LINK_CORE, '"Mật khẩu nhập lại không khớp."'],
  ["Chưa có tài khoản?", LOGIN_PAGE, "Chưa có tài khoản?"]
];

describe("1. mọi chữ trích trong hướng dẫn đều có thật trên màn hình", () => {
  it.each(QUOTED)("“%s”", (quoted, sourceFile, needle) => {
    expect(guideText).toContain(quoted);
    expect(read(sourceFile)).toContain(needle);
  });
});

describe("2. các con số và đường dẫn khớp mã nguồn", () => {
  it("độ dài mật khẩu tối thiểu", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(guideText).toContain(`${MIN_PASSWORD_LENGTH} ký tự`);
  });

  it("đường dẫn trang đăng nhập và trang đặt lại mật khẩu", () => {
    expect(PASSWORD_LINK_PATH).toBe("/reset-password");
    expect(guideText).toContain("os.alumni-mentoring.edu.vn/login");
  });
});

describe("3. những điều tài liệu không được quên", () => {
  /**
   * Hai nút đứng cạnh nhau và chỉ khác nhau ở HẬU QUẢ, không ở hình dáng. Người
   * bấm nhầm "gửi liên kết đăng nhập" sẽ vào được, tưởng đã xong, rồi lần sau
   * lại kẹt y hệt — và lần đó họ sẽ nhắn ban tổ chức.
   */
  it("phân biệt rõ hai nút, kèm hậu quả của mỗi nút", () => {
    expect(guideText).toContain("Hai nút, đừng nhầm");
    expect(guideText).toContain("một lần");
    expect(guideText).toContain("lần sau vẫn phải xin link tiếp");
  });

  /**
   * Câu trả lời trung tính là chủ ý chống dò danh bạ, nhưng nó cũng có nghĩa là
   * gõ sai địa chỉ trông y hệt như gửi thành công. Không nói ra thì người dùng
   * ngồi đợi một lá thư không tồn tại.
   */
  it("giải thích vì sao gõ sai email trông giống hệt gửi thành công", () => {
    expect(guideText).toContain("kể cả khi địa chỉ đó không có tài khoản");
    expect(guideText).toContain("địa chỉ gõ chưa đúng");
  });

  it("nói rõ ai dùng được, và ai thì đặt lại mật khẩu không giúp được", () => {
    for (const audience of ["ban tổ chức", "core team", "support team", "người phỏng vấn"]) {
      expect(guideText).toContain(audience);
    }
    expect(guideText).toContain("Chưa có tài khoản");
  });

  it("nhắc xem mục Spam — thư xác thực hay rơi vào đó", () => {
    expect(guideText).toContain("Spam");
  });

  it("không mang dữ liệu cá nhân của người thật", () => {
    expect(guideText).not.toMatch(/[\w.+-]+@(?!example\.com)[\w-]+\.[\w.]+/);
    expect(guideText).not.toMatch(/0\d{9}/);
  });
});

describe("4. vẫn đúng MỘT trang khi in", () => {
  it("bản PDF có đúng một trang", () => {
    const pdf = readFileSync(join(ROOT, "docs/huong-dan/HUONG_DAN_TU_DAT_LAI_MAT_KHAU.pdf"), "latin1");
    const pages = pdf.match(/\/Type\s*\/Page[^s]/g);
    expect(pages, "không đọc được số trang trong PDF — dựng lại bằng Chrome headless").not.toBeNull();
    expect(pages).toHaveLength(1);
  });
});

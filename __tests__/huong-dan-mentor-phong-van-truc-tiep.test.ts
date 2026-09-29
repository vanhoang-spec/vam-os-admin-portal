/**
 * Hướng dẫn cho Core Team, dựng 30/09/2026: mentor vào hệ thống và phỏng vấn
 * mentee 03–04/10, cộng phần "cần chốt" cho anh Hoàng về khoảng trống cấp quyền.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAILY_EMAIL_LIMIT, DISPATCH_RESERVE } from "@/lib/mentee-invite-dispatch-core";
import { OFFLINE_SCORES, OFFLINE_OUTCOMES } from "@/lib/mentee-offline-core";

const root = join(__dirname, "..");
const html = readFileSync(join(root, "docs/huong-dan/HUONG_DAN_MENTOR_PHONG_VAN_TRUC_TIEP.html"), "utf8");
const text = html
  .replace(/<style[\s\S]*?<\/style>/i, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

describe("Mentor phỏng vấn mentee trực tiếp 03–04/10 — hướng dẫn Core Team", () => {
  it("5 tiêu chí và tổng điểm khớp đúng hằng số nguồn (lib/mentee-offline-core.ts)", () => {
    for (const [, label] of OFFLINE_SCORES) {
      expect(text).toContain(label);
    }
    expect(text).toContain("25 điểm");
    for (const label of Object.values(OFFLINE_OUTCOMES)) {
      expect(text).toContain(label);
    }
  });

  it("nêu đúng con số sẵn sàng thật trên production 30/09/2026", () => {
    expect(text).toContain("267");
    expect(text).toContain("67 / 267");
    expect(text).toContain("5 / 267");
  });

  it("nêu đúng đường dẫn và nhãn nút thật của luồng cấp quyền", () => {
    expect(text).toContain("/reviews/reviewer-pool");
    expect(text).toContain("Cấp quyền phỏng vấn");
    expect(text).toContain("Danh sách nhân sự tuyển sinh");
    expect(text).toContain("Không có nút cấp hàng loạt");
    expect(text).toContain("/interviews/assign");
    expect(text).toContain("Chia hồ sơ Phỏng vấn");
  });

  it("nêu đúng đường dẫn và nhãn thật của luồng đăng nhập lần đầu", () => {
    expect(text).toContain("/login");
    expect(text).toContain("Đặt lại mật khẩu");
    expect(text).toContain("Gửi liên kết đăng nhập qua email");
    expect(text).toContain("KHÔNG tạo tài khoản mới");
  });

  it("nêu đúng đường dẫn và nhãn thật của màn hình phỏng vấn trực tiếp", () => {
    expect(text).toContain("Phỏng vấn mentee trực tiếp");
    expect(text).toContain("Chỉ ứng viên được phân cho tôi");
    expect(text).toContain("Application đã nộp");
    expect(text).toContain("Nhận làm mentee của tôi");
    expect(text).toContain("Sửa kết quả / lựa chọn mentee");
    expect(text).toContain("Xác nhận kết quả");
    expect(text).toContain("không tự gửi email báo đậu/rớt");
  });

  it("cảnh báo trần thư khớp đúng hằng số nguồn, không thổi phồng cũng không giấu bớt", () => {
    expect(text).toContain(`${DAILY_EMAIL_LIMIT} thư/24 giờ`);
    expect(text).toContain(`chừa ${DISPATCH_RESERVE}/24h`);
    expect(text).toContain(`${DAILY_EMAIL_LIMIT - DISPATCH_RESERVE}/24h`);
  });

  it("câu hỏi gợi ý (tài liệu Mùa 11, BTC gửi 30/09) xếp đúng theo 5 tiêu chí đang chạy, không đổi thang điểm", () => {
    expect(text).toContain("Câu hỏi gợi ý theo tiêu chí");
    expect(text).toContain("tài liệu chấm Mùa 11");
    expect(text).toContain("KHÔNG đổi cách chấm");
    expect(text).toContain("vẫn 5 tiêu chí/25 điểm");
    expect(text).not.toContain("rubric chi tiết đã có sẵn");
    // Hai tiêu chí chưa có câu hỏi gợi ý riêng — không được âm thầm bỏ qua.
    expect(text).toContain("Mức độ phù hợp");
    expect(text).toContain("chưa có câu hỏi riêng");
  });

  it("nêu rõ khoảng trống phân loại G/C/E/F chưa có chỗ ghi trong hệ thống", () => {
    expect(text).toContain("G/C/E/F");
    expect(text).toContain("KHÔNG có ô nào để mentor ghi phân loại này");
    expect(text).toContain("lib/mentee-offline-core.ts");
  });

  it("danh sách mentor 03–04/10 dẫn đúng nguồn Google Sheet đã nhận, và nói rõ còn Đợt 2 chưa khớp", () => {
    expect(text).toContain("ĐĂNG KÝ CHẤM VÒNG ĐƠN + PHỎNG VẤN");
    expect(text).toContain("dùng lúc điền đơn trên hệ thống VAM OS");
    expect(text).toContain("Đợt 2 (10–11/10)");
  });

  it("phần B tách rõ khỏi nội dung gửi mentor", () => {
    expect(text).toContain("Phần B · Nội bộ — không gửi cho mentor");
    expect(text).toContain("Những câu cần anh Hoàng chốt");
  });

  it("PDF đủ ba trang", () => {
    const pdf = readFileSync(join(root, "docs/huong-dan/HUONG_DAN_MENTOR_PHONG_VAN_TRUC_TIEP.pdf"), "latin1");
    expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(3);
  });
});

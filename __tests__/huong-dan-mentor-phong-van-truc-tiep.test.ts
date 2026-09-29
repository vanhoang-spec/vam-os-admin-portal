/**
 * Hướng dẫn cho Core Team, dựng 30/09/2026: mentor vào hệ thống và phỏng vấn
 * mentee 03–04/10. Chỉ nội dung dành cho mentor (đăng nhập, chấm điểm) — anh
 * Hoàng xử lý riêng phần cấp quyền/danh sách nội bộ, không thuộc tài liệu này.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

  it("không còn phần B nội bộ về cấp quyền — anh Hoàng xử lý riêng", () => {
    expect(text).not.toContain("Phần B");
    expect(text).not.toContain("Những câu cần anh Hoàng chốt");
    expect(text).not.toContain("Rủi ro gấp nhất");
    expect(text).not.toContain("/reviews/reviewer-pool");
  });

  it("nhắc gửi thông báo đúng lúc — mentor đã được cấp quyền, không đề cập chi tiết luồng cấp quyền", () => {
    expect(text).toContain("Chỉ gửi thông báo này SAU KHI mentor đã được cấp quyền phỏng vấn");
  });

  it("PDF đủ hai trang", () => {
    const pdf = readFileSync(join(root, "docs/huong-dan/HUONG_DAN_MENTOR_PHONG_VAN_TRUC_TIEP.pdf"), "latin1");
    expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(2);
  });
});

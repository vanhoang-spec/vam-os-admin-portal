/**
 * Hướng dẫn nhanh 1 TRANG A4, dựng 01/10/2026: anh Hoàng yêu cầu một bản rút
 * gọn gửi kèm email confirm cho mentor phỏng vấn 03–04/10 — CHỈ phần cơ bản
 * nhất, không mang hết nội dung của HUONG_DAN_MENTOR_PHONG_VAN_TRUC_TIEP.html
 * (bản 4 trang, đầy đủ khung điểm/câu hỏi gợi ý/quy trình Support-BTC).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFLINE_SCORES } from "@/lib/mentee-offline-core";
import { HOTLINE_ZALO } from "@/lib/mentee-interview-core";

const root = join(__dirname, "..");
const html = readFileSync(join(root, "docs/huong-dan/HUONG_DAN_NHANH_MENTOR_PHONG_VAN.html"), "utf8");
const text = html
  .replace(/<style[\s\S]*?<\/style>/i, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

describe("Hướng dẫn nhanh 1 trang — Mentor phỏng vấn mentee trực tiếp 03–04/10", () => {
  it("nêu đúng đường dẫn và nhãn thật của luồng đăng nhập", () => {
    expect(text).toContain("os.alumni-mentoring.edu.vn/login");
    expect(text).toContain("Đặt lại mật khẩu");
    expect(text).toContain("Phỏng vấn → Phỏng vấn mentee trực tiếp");
  });

  it("5 tiêu chí khớp đúng hằng số nguồn (lib/mentee-offline-core.ts)", () => {
    for (const [, label] of OFFLINE_SCORES) {
      expect(text).toContain(label);
    }
  });

  it("nêu đúng nhãn luồng tìm mentee và chốt kết quả", () => {
    expect(text).toContain("Chỉ ứng viên được phân cho tôi");
    expect(text).toContain("Application đã nộp");
    expect(text).toContain("Đạt làm mentee");
    expect(text).toContain("Không chọn làm mentee");
    expect(text).toContain("Cần BTC xem xét thêm");
    expect(text).toContain("Nhận làm mentee của tôi");
    expect(text).toContain("Xác nhận kết quả");
  });

  it("có số liên hệ hỗ trợ thật (lib/mentee-interview-core.ts)", () => {
    expect(text).toContain(HOTLINE_ZALO);
  });

  it("CHỈ phần cơ bản — không mang theo nội dung chuyên sâu của bản 4 trang", () => {
    expect(text).not.toContain("Thang điểm gợi ý");
    expect(text).not.toContain("Câu hỏi gợi ý theo tiêu chí");
    expect(text).not.toContain("Phân công phỏng vấn");
    expect(text).not.toContain("Support/BTC trực bàn");
    expect(text).not.toContain("Mùa 11");
  });

  it("PDF đúng một trang A4 duy nhất", () => {
    const pdf = readFileSync(join(root, "docs/huong-dan/HUONG_DAN_NHANH_MENTOR_PHONG_VAN.pdf"), "latin1");
    expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);
  });
});

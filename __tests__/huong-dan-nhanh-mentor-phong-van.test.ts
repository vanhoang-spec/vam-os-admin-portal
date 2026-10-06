/**
 * Hướng dẫn nhanh 1 TRANG A4, dựng 01/10/2026: anh Hoàng yêu cầu một bản rút
 * gọn gửi kèm email confirm cho mentor phỏng vấn 03–04/10 — CHỈ phần cơ bản
 * nhất, không mang hết nội dung của HUONG_DAN_MENTOR_PHONG_VAN_TRUC_TIEP.html
 * (bản 4 trang, đầy đủ khung điểm/câu hỏi gợi ý/quy trình Support-BTC).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFLINE_OUTCOMES, PROFILE_SCREENING_SCORES } from "@/lib/mentee-offline-core";
import { HOTLINE_ZALO } from "@/lib/mentee-interview-core";
import { TAKE_CHOICES } from "@/lib/mentee-interview-rubric-core";
import { S12_INTERVIEW_CRITERIA } from "@/lib/mentee-interview-rubric-s12";

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
    // Menu Tuyển Mentor/Mentee (06/10/2026) — đường dẫn ba tầng.
    expect(text).toContain("Tuyển Mentor/Mentee → Tuyển Mentee → Phỏng vấn mentee trực tiếp");
    expect(text).not.toContain("Phỏng vấn → Phỏng vấn mentee trực tiếp");
  });

  it("4 tiêu chí + trọng số khớp đúng phiếu Mùa 12 (lib/mentee-interview-rubric-s12.ts)", () => {
    expect(S12_INTERVIEW_CRITERIA).toHaveLength(4);
    for (const c of S12_INTERVIEW_CRITERIA) {
      expect(text).toContain(`${c.label} ${c.weight}%`);
    }
    expect(text).toContain("KHÔNG cộng tổng, không có điểm sàn");
  });

  it("không còn 5 tiêu chí cũ (giờ chỉ là tiêu chí vòng hồ sơ) và ô tick nhận mentee đã bỏ", () => {
    // "Mức độ phù hợp" (nhãn cũ vòng hồ sơ) nằm gọn trong nhãn mới "Mức độ phù hợp về kỳ vọng
    // của Mentee" (02/10/2026) — bỏ đúng cụm nhãn mới rồi mới soát, không nới phép kiểm.
    const withoutNewLabel = text.split("Mức độ phù hợp về kỳ vọng của Mentee").join(" ");
    for (const [, label] of PROFILE_SCREENING_SCORES) {
      expect(withoutNewLabel).not.toContain(label);
    }
    expect(text).not.toContain("Nhận làm mentee của tôi");
  });

  it("nêu đúng nhãn luồng tìm mentee, mục A/B/C và chốt kết quả", () => {
    expect(text).toContain("Chỉ ứng viên được phân cho tôi");
    expect(text).toContain("Application đã nộp");
    for (const label of Object.values(OFFLINE_OUTCOMES)) expect(text).toContain(label);
    for (const label of Object.values(TAKE_CHOICES)) expect(text).toContain(label);
    expect(text).toContain("Lý do chọn / không chọn");
    expect(text).toContain("Nhu cầu phát triển chính");
    expect(text).toContain("Chân dung Mentor phù hợp");
    expect(text).toContain("Hướng dẫn phỏng vấn mùa này");
    expect(text).toContain("Mức độ phù hợp về kỳ vọng của Mentee");
    expect(text).toContain("Concern / Note");
    expect(text).toContain("tối đa 2 hồ sơ");
    expect(text).toContain("mục C khoá lại");
    expect(text).not.toContain("Mức độ alignment");
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
  it("chỉ chỗ hướng dẫn sử dụng ngay trên màn hình (biểu tượng cuốn sách)", () => {
    expect(text).toContain("biểu tượng cuốn sách");
  });
});

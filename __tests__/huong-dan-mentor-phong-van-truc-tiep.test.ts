/**
 * Hướng dẫn cho Core Team, dựng 30/09/2026: mentor vào hệ thống và phỏng vấn
 * mentee 03–04/10. Trang 1–3 dành cho mentor (đăng nhập, khung điểm, chấm
 * điểm) — anh Hoàng xử lý riêng phần cấp quyền/danh sách nội bộ, không thuộc
 * tài liệu này. Trang 4 (thêm 30/09) là quy trình check-in → phân công cho
 * Support/BTC.
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

  it("câu hỏi gợi ý (tài liệu chấm Mùa 11) chỉ mượn câu hỏi, KHÔNG mượn thang điểm 3 tiêu chí/10 điểm của Mùa 11", () => {
    expect(text).toContain("Câu hỏi gợi ý theo tiêu chí");
    expect(text).toContain("tài liệu chấm Mùa 11");
    expect(text).toContain("KHÔNG mượn thang điểm 3 tiêu chí/10 điểm của Mùa 11");
    expect(text).toContain("Mùa 12 giữ nguyên 5 tiêu chí/25 điểm");
    expect(text).not.toContain("rubric chi tiết đã có sẵn");
  });

  it("có thang điểm gợi ý 1/3/5 riêng cho từng tiêu chí Mùa 12 — không còn để trống khoảng trống rubric", () => {
    expect(text).toContain("Thang điểm gợi ý theo tiêu chí");
    // Cả 5 tiêu chí đều phải có mô tả — không được âm thầm bỏ sót tiêu chí nào.
    for (const [, label] of OFFLINE_SCORES) {
      expect(text.split(label).length - 1).toBeGreaterThanOrEqual(2); // xuất hiện ở bảng nhãn VÀ bảng thang điểm
    }
    expect(text).toContain("Mong muốn về mentor/ngành lệch hẳn so với mảng mentor hiện có");
  });

  it("đã bỏ hẳn phân loại nhóm mentee G/C/E/F — anh Hoàng chốt không dùng cho Mùa 12", () => {
    expect(text).not.toContain("G/C/E/F");
    expect(text).not.toContain("General/Career/Elite/Focus");
    expect(text).not.toContain("phân loại nhóm mentee");
  });

  it("không còn phần B nội bộ về cấp quyền — anh Hoàng xử lý riêng", () => {
    expect(text).not.toContain("Những câu cần anh Hoàng chốt");
    expect(text).not.toContain("Rủi ro gấp nhất");
    expect(text).not.toContain("/reviews/reviewer-pool");
  });

  it("nhắc gửi thông báo đúng lúc — mentor đã được cấp quyền, không đề cập chi tiết luồng cấp quyền", () => {
    expect(text).toContain("Chỉ gửi thông báo này SAU KHI mentor đã được cấp quyền phỏng vấn");
  });

  it("nêu chính xác hai nhãn câu trả lời chuẩn bị, đúng RAW_PAYLOAD_LABELS (lib/application-export.ts)", () => {
    expect(text).toContain("Mong muốn về Mentor đồng hành");
    expect(text).toContain("Lý do muốn có Mentor đồng hành");
    expect(text).toContain("nằm CHUNG danh sách này");
  });

  it("quy trình check-in → phân công nêu rõ vai trò Support/BTC và đúng đường dẫn/nhãn nút thật (app/interviews/mentee-offline/workflow.tsx)", () => {
    expect(text).toContain("Phân công phỏng vấn");
    expect(text).toContain("Support/BTC trực bàn");
    expect(text).toContain("/interviews/mentee-offline");
    expect(text).toContain("Xác nhận check-in");
    expect(text).toContain("Lưu phân bàn");
    expect(text).toContain("Lý do đổi phân công");
    expect(text).toContain("BẮT BUỘC phải điền");
  });

  it("quét QR tự động check-in ngay (01/10) — chỉ đường tìm tay mới còn hộp thoại xác nhận", () => {
    expect(text).toContain("tự động check-in");
    expect(text).toContain("Không quét được thì tìm tay");
    expect(text).toContain("lúc đó vẫn cần bấm xác nhận");
  });

  it("có bước mentor tới xác nhận danh tính và được hỗ trợ đăng nhập, trước cả bước check-in mentee", () => {
    expect(text).toContain("Trước tiên — Mentor tới, xác nhận và hỗ trợ đăng nhập");
    expect(text).toContain("Hỏi tên và số điện thoại mentor");
    expect(text).toContain("Ghi tên mentor vào sổ/note riêng của Support");
    const idxMentorArrival = text.indexOf("Trước tiên — Mentor tới");
    const idxCheckinMentee = text.indexOf("Bước A — Check-in mentee");
    expect(idxMentorArrival).toBeGreaterThan(-1);
    expect(idxCheckinMentee).toBeGreaterThan(idxMentorArrival);
  });

  it("nói đúng sự thật: ô \"Người phỏng vấn\" liệt kê TOÀN BỘ interviewer của mùa, không lọc theo ai đang có mặt", () => {
    // Đây là bản sửa lại — trước đó tài liệu ghi nhầm là "danh sách người đang có mặt",
    // trong khi RPC nguồn (vam084_list_recruitment_participants) không lọc theo hiện diện.
    expect(text).toContain("TOÀN BỘ interviewer đủ điều kiện của mùa");
    expect(text).not.toContain("danh sách người đang có mặt, không phải toàn bộ interviewer");
  });

  it("PDF đủ bốn trang", () => {
    const pdf = readFileSync(join(root, "docs/huong-dan/HUONG_DAN_MENTOR_PHONG_VAN_TRUC_TIEP.pdf"), "latin1");
    expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(4);
  });
});

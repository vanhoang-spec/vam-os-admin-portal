/**
 * Hướng dẫn cho Core Team, dựng 30/09/2026: mentor vào hệ thống và phỏng vấn
 * mentee 03–04/10. Trang 1–3 dành cho mentor (đăng nhập, phiếu chấm Mùa 12, chấm
 * điểm) — anh Hoàng xử lý riêng phần cấp quyền/danh sách nội bộ, không thuộc
 * tài liệu này. Trang 4 (thêm 30/09) là quy trình check-in → phân công cho
 * Support/BTC.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFLINE_OUTCOMES, PROFILE_SCREENING_SCORES } from "@/lib/mentee-offline-core";
import { EXPECTATION_ALIGNMENTS, TAKE_CHOICES } from "@/lib/mentee-interview-rubric-core";
import { S12_INTERVIEW_CRITERIA, S12_INTERVIEW_GUIDANCE } from "@/lib/mentee-interview-rubric-s12";

const root = join(__dirname, "..");
const html = readFileSync(join(root, "docs/huong-dan/HUONG_DAN_MENTOR_PHONG_VAN_TRUC_TIEP.html"), "utf8");
const text = html
  .replace(/<style[\s\S]*?<\/style>/i, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

describe("Mentor phỏng vấn mentee trực tiếp 03–04/10 — hướng dẫn Core Team", () => {
  // Trang 1–3 dựng lại 02/10 theo phiếu Mùa 12 (VAM_Mentee_Evaluation_Season12_Final.xlsx +
  // Handbook S12). Đối chiếu với bản seed TS — chính bản test Postgres khoá bằng với seed SQL —
  // nên tài liệu, form chấm và database không thể lệch nhau một chữ mà không có test đỏ.
  it("phiếu Mùa 12: đủ 4 tiêu chí, trọng số, câu hỏi cốt lõi và mô tả 1/3/5 nguyên văn", () => {
    expect(S12_INTERVIEW_CRITERIA).toHaveLength(4);
    for (const c of S12_INTERVIEW_CRITERIA) {
      expect(text).toContain(`${c.label} · ${c.weight}%`);
      expect(text).toContain(c.question!);
      for (const level of ["1", "3", "5"] as const) {
        expect(text).toContain(c.descriptors![level]!);
      }
    }
  });

  it("câu hỏi phỏng vấn gợi ý của cả 4 tiêu chí, nguyên văn Handbook mục 6", () => {
    for (const c of S12_INTERVIEW_CRITERIA) {
      expect(c.interview_questions!.length).toBeGreaterThan(0);
      for (const q of c.interview_questions!) expect(text).toContain(q);
    }
  });

  it("kim chỉ nam, lưu ý điểm số và nhắc mentor đúng phiếu; không cộng tổng, không điểm sàn", () => {
    expect(text).toContain(S12_INTERVIEW_GUIDANCE.reminder!);
    expect(text).toContain("Kim chỉ nam: " + S12_INTERVIEW_GUIDANCE.motto);
    // Lưu ý điểm số nguyên văn phiếu phiên bản 2 (thuần Việt, 02/10/2026).
    expect(text).toContain(S12_INTERVIEW_GUIDANCE.note!);
    expect(text).toContain("không hiện tổng điểm");
  });

  it("bảng mục A/B/C ở trang 2 mang đúng nhãn lựa chọn của form chấm", () => {
    // Soi riêng bảng A/B/C: các nhãn này cũng xuất hiện ở trang 1 (Bước 3, "Chỗ mentor hay hỏi"),
    // tìm chung cả tài liệu thì bảng trang 2 viết sai nhãn vẫn xanh.
    const start = text.indexOf("Sau 4 tiêu chí — mục A, B, C");
    const end = text.indexOf("Nhắc Mentor (cuối phiếu)");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const table = text.slice(start, end);
    for (const label of Object.values(OFFLINE_OUTCOMES)) expect(table).toContain(label);
    for (const label of Object.values(EXPECTATION_ALIGNMENTS)) expect(table).toContain(label);
    for (const label of Object.values(TAKE_CHOICES)) expect(table).toContain(label);
    for (const label of ["A. Quyết định chọn mentee", "B. Sự phù hợp về kỳ vọng của Mentee", "Lý do chọn / không chọn",
      "Nhu cầu phát triển chính", "Mức độ phù hợp về kỳ vọng của Mentee", "Ô bắt buộc \"Concern / Note\"", "Chân dung Mentor phù hợp"]) {
      expect(table).toContain(label);
    }
    expect(table).toContain("tạo cặp ghép ngay");
    // Luật 02/10/2026: tối đa 2 hồ sơ "Có – nhận" mỗi mentor; Không chọn thì khoá mục C.
    expect(table).toContain("tối đa 2 hồ sơ");
    expect(table).toContain("mục C khoá lại");
    expect(text).not.toContain("Expectation alignment");
    expect(text).not.toContain("Mức độ alignment");
    expect(text).toContain("Evidence / Note");
  });

  it("đã bỏ hẳn khung 5 tiêu chí/25 điểm cũ và câu hỏi mượn từ Mùa 11", () => {
    // "Mức độ phù hợp" (nhãn cũ vòng hồ sơ) nằm gọn trong nhãn mới "Mức độ phù hợp về kỳ vọng
    // của Mentee" (02/10/2026) — bỏ đúng cụm nhãn mới rồi mới soát, không nới phép kiểm.
    const withoutNewLabel = text.split("Mức độ phù hợp về kỳ vọng của Mentee").join(" ");
    for (const [, label] of PROFILE_SCREENING_SCORES) expect(withoutNewLabel).not.toContain(label);
    expect(text).not.toContain("25 điểm");
    expect(text).not.toContain("Mùa 11");
    expect(text).not.toContain("Nhận làm mentee của tôi");
    expect(text).not.toContain("Thang điểm gợi ý theo tiêu chí");
  });

  it("chỉ đúng chỗ đọc Handbook và chỗ BTC cập nhật phiếu mỗi mùa (nhãn thật trên menu/nút)", () => {
    expect(text).toContain("Hướng dẫn phỏng vấn mùa này");
    expect(text).toContain("Phỏng vấn → Phiếu chấm & hướng dẫn mentee");
    expect(text).toContain("lần cài đặt gần nhất");
    expect(text).toContain("Điểm đã chấm giữ nguyên nội dung phiếu lúc chấm");
    expect(text).toContain("điểm quy đổi tham khảo");
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
    expect(text).toContain("Sửa kết quả / lựa chọn mentee");
    expect(text).toContain("Xác nhận kết quả");
    expect(text).toContain("không tự gửi email báo đậu/rớt");
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

  it("đánh dấu phỏng vấn ONLINE (01/10) — chỉ Support/BTC, ứng viên không thấy và không tự chọn", () => {
    expect(text).toContain("Phỏng vấn ONLINE");
    expect(text).toContain("Chỉ Support/BTC thấy và đánh dấu được");
    expect(text).toContain("ứng viên không thấy ô này và không tự chọn được");
  });

  it("huỷ lịch đăng ký (01/10) — chỉ Support/BTC, bắt buộc lý do, chỉ còn trước check-in", () => {
    expect(text).toContain("Huỷ lịch đăng ký");
    expect(text).toContain("Chỉ Support/BTC (không phải ứng viên) huỷ được");
    expect(text).toContain("chỉ hiện khi mentee CHƯA check-in");
    expect(text).toContain("bắt buộc điền");
  });
});

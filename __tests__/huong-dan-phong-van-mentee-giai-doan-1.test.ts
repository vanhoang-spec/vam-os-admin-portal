/**
 * Hướng dẫn phản ánh quyết định chốt 29/09: gửi thư mời NGAY, chưa có địa chỉ.
 * Đây là lần cập nhật thứ hai sau bản gốc 27/09 (chờ địa chỉ trước khi gửi) —
 * bài test cũ kiểm đúng bản đó, và bản đó đã lỗi thời khi quyết định đổi.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAILY_EMAIL_LIMIT, DISPATCH_MAX_PER_RUN, DISPATCH_RESERVE } from "@/lib/mentee-invite-dispatch-core";
import { HOTLINE_ZALO } from "@/lib/mentee-interview-core";

const root = join(__dirname, "..");
const html = readFileSync(join(root, "docs/huong-dan/HUONG_DAN_PHONG_VAN_MENTEE_GIAI_DOAN_1.html"), "utf8");
const text = html
  .replace(/<style[\s\S]*?<\/style>/i, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

describe("Kế hoạch chốt 29/09 — gửi thư mời ngay, địa điểm bổ sung sau", () => {
  it("gửi ngay hôm nay, cố ý không có địa chỉ — không còn placeholder chờ điền", () => {
    expect(text).toContain("Gửi thư mời NGAY HÔM NAY");
    expect(text).toContain("Địa chỉ dự kiến có khoảng 01/10");
    expect(text).not.toContain("Địa chỉ đầy đủ được chốt");
    expect(text).not.toContain("[Địa chỉ");
    expect(text).not.toContain("[chờ điền]");
  });

  it("mentee mở lại đúng link để xem địa điểm khi có, không có thư xác nhận riêng", () => {
    expect(text).toContain("Mentee tự thấy địa chỉ khi mở lại đúng link trong thư mời");
    expect(text).toContain("Không có thư xác nhận thứ hai");
    expect(text).toContain("Không gửi thêm email xác nhận");
  });

  it("gửi là thao tác CÓ NGƯỜI bấm nút, không phải hệ thống tự gửi đồng loạt", () => {
    expect(text).toContain("Gửi thư mời chọn ca");
    expect(text).toContain("bấm lại nhiều lần");
    expect(text).not.toContain("chủ chương trình sẽ giao lệnh cho hệ thống gửi đồng loạt");
    expect(text).not.toContain("Support không cần vào CRM để bấm gửi email");
  });

  it("không hứa vượt hạn mức email hiện có, và số liệu khớp hằng số nguồn", () => {
    expect(text).toContain(`${DAILY_EMAIL_LIMIT} thư/24 giờ`);
    expect(text).toContain(`chừa ${DISPATCH_RESERVE} thư`);
    expect(text).toContain(`${DAILY_EMAIL_LIMIT - DISPATCH_RESERVE} thư/24 giờ`);
    expect(text).toContain(`tối đa ${DISPATCH_MAX_PER_RUN} thư`);
  });

  it("đã bỏ hẳn trạng thái kế hoạch/chưa triển khai của bản 27/09", () => {
    expect(text).not.toContain("chưa triển khai production");
    expect(text).not.toContain("chưa đặt lịch tự gửi");
    expect(text).not.toContain("Bản dự kiến — chưa gửi");
  });

  it("28 ca, ghế khác nhau theo ngày, và hạn đăng ký", () => {
    expect(text).toContain("28 ca");
    expect(text).toContain("14 ca mỗi ngày");
    expect(text).toContain("18 / 28");
    expect(text).toContain("3 phòng × 6 mentor = 18 mentee/ca");
    expect(text).toContain("6 phòng × 5 mentor = 28 mentee/ca");
    expect(text).toContain("08:00 – 11:30");
    expect(text).toContain("13:30 – 17:00");
    expect(text).toContain("23:59 ngày 30/09/2026");
    expect(text).toContain("hết ghế của ca đó thì khoá lại, không chọn được nữa");
    // Bản cũ đồng nhất cả hai ngày — không được sót lại con số đó.
    expect(text).not.toContain("25 mentor cùng lúc");
    expect(text).not.toContain("24 ca");
    expect(text).not.toContain("600 chỗ");
  });

  it("phòng/bàn theo đúng ngày ở bước check-in, không còn 1–5 đồng nhất", () => {
    expect(text).toContain("ĐÚNG THEO NGÀY");
    expect(text).toContain("1 – 3");
    expect(text).toContain("1 – 6");
    expect(text).toContain("1 – 5");
    expect(text).not.toContain("phòng 1–5, bàn 1–5");
  });

  it("QR ngay tại trang; kết quả gửi đợt riêng", () => {
    expect(text).toContain("xác nhận và QR hiện ngay trên trang");
    expect(text).toContain("chưa gửi email đậu/rớt");
  });

  it("giữ hướng dẫn check-in SĐT, phân bàn, chấm, nhận và sửa kết quả", () => {
    for (const phrase of [
      "số điện thoại",
      "Lưu phân bàn",
      "5 tiêu chí hiện tại",
      "Nhận làm mentee của tôi",
      "Sửa kết quả / lựa chọn mentee",
      "hoàn suất"
    ]) {
      expect(text).toContain(phrase);
    }
    expect(text).toContain(HOTLINE_ZALO);
  });

  it("thư mời trang 2 khớp nguyên văn hàm đang gửi thật (lib/email-core.ts)", () => {
    for (const line of [
      "Chúc mừng bạn đã qua vòng hồ sơ Mùa 12. Ban tổ chức mời bạn tham",
      "Hạn chọn ca: 23:59 ngày 30/09/2026. Sau hạn này mà chưa chọn ca,",
      "Địa điểm cụ thể có thể chưa hiện ngay lúc bạn chọn ca",
      "Bạn mong muốn được đồng hành cùng một Mentor như thế nào?",
      "Điều gì khiến bạn mong muốn có một Mentor đồng hành trong"
    ]) {
      expect(text).toContain(line);
    }
  });

  it("PDF vẫn đủ hai trang", () => {
    const pdf = readFileSync(join(root, "docs/huong-dan/HUONG_DAN_PHONG_VAN_MENTEE_GIAI_DOAN_1.pdf"), "latin1");
    expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(2);
  });
});

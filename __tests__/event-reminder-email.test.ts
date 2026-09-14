/**
 * Lời thư nhắc lịch.
 *
 * Thư này là lá người ta mở vào sáng hôm sự kiện, nên nó phải tự đủ — và nói
 * đúng về điểm danh: sự kiện dùng QR mà người này chưa có vé thì không được nói
 * "sự kiện không dùng mã QR".
 */
import { describe, expect, it } from "vitest";
import { buildEventReminderEmail } from "@/lib/email-core";

const base = {
  recipientName: "Nguyễn Văn A",
  eventName: "Mentor Orientation",
  whenLabel: "20/09/2026 08:00 – 11:30",
  placeLabel: "Phòng B1-502 — 279 Nguyễn Tri Phương",
  mapUrl: "https://www.google.com/maps/search/?api=1&query=279",
  joinUrl: null,
  qrCheckin: true,
  ticketUrl: "https://os.example.org/ve/A7K2M9PQRS",
  ticketCode: "A7K2M9PQRS",
  shortCode: "K7M2",
  qrPngBase64: "iVBORw0KGgo="
};

describe("1. nội dung chính", () => {
  it("tiêu đề nói rõ đây là thư nhắc, tên buổi và giờ", () => {
    expect(buildEventReminderEmail(base).subject).toBe("Nhắc lịch: Mentor Orientation — 20/09/2026 08:00 – 11:30");
  });

  it("mang đủ giờ, địa điểm, bản đồ, và nói đây là thông tin mới nhất", () => {
    const { text, html } = buildEventReminderEmail(base);
    expect(text).toContain("THỜI GIAN: 20/09/2026 08:00 – 11:30");
    expect(text).toContain("Địa điểm: Phòng B1-502 — 279 Nguyễn Tri Phương");
    expect(text).toContain("Xem trên bản đồ: https://www.google.com/maps/search/?api=1&query=279");
    expect(text).toContain("thông tin mới nhất");
    expect(html).toContain("Xem trên bản đồ");
  });

  it("buổi trực tuyến mang link họp", () => {
    const { text, html } = buildEventReminderEmail({
      ...base,
      placeLabel: null,
      mapUrl: null,
      joinUrl: "https://meet.google.com/abc-defg-hij"
    });
    expect(text).toContain("Đường dẫn tham gia: https://meet.google.com/abc-defg-hij");
    expect(html).toContain("https://meet.google.com/abc-defg-hij");
  });

  it("không phải thư báo đổi lịch: không có giờ mới / giờ cũ", () => {
    const { text } = buildEventReminderEmail(base);
    expect(text).not.toContain("THỜI GIAN MỚI");
    expect(text).not.toContain("Thời gian cũ");
  });

  it("mô tả của sự kiện được escape, xuống dòng giữ nguyên", () => {
    const { text, html } = buildEventReminderEmail({ ...base, description: "Mang laptop\n<b>đúng giờ</b>" });
    expect(text).toContain("NỘI DUNG");
    expect(text).toContain("Mang laptop\n<b>đúng giờ</b>");
    expect(html).toContain("Mang laptop<br />&lt;b&gt;đúng giờ&lt;/b&gt;");
    expect(html).not.toContain("<b>đúng giờ</b>");
  });

  it("tên người nhận được escape trong HTML", () => {
    const { html } = buildEventReminderEmail({ ...base, recipientName: "<script>x</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("đang chờ duyệt thì nói rõ", () => {
    expect(buildEventReminderEmail({ ...base, pendingApproval: true }).text).toContain("đang chờ ban tổ chức xác nhận");
    expect(buildEventReminderEmail(base).text).not.toContain("đang chờ ban tổ chức xác nhận");
  });
});

describe("2. vé và điểm danh", () => {
  it("có vé: đính kèm ảnh QR, có link vé và mã dự phòng", () => {
    const message = buildEventReminderEmail(base);
    expect(message.text).toContain("VÉ THAM DỰ");
    expect(message.text).toContain("https://os.example.org/ve/A7K2M9PQRS");
    expect(message.text).toContain("MÃ DỰ PHÒNG: K7M2");
    expect(message.attachments).toEqual([{ filename: "ve-A7K2M9PQRS.png", contentBase64: "iVBORw0KGgo=" }]);
  });

  it("sự kiện dùng QR mà người này chưa có vé: KHÔNG nói sự kiện không dùng QR", () => {
    const message = buildEventReminderEmail({ ...base, ticketUrl: null, ticketCode: null, shortCode: null, qrPngBase64: null });
    expect(message.text).toContain("ĐIỂM DANH");
    expect(message.text).toContain("báo họ tên và email");
    expect(message.text).not.toContain("không dùng mã QR");
    expect(message.attachments).toBeUndefined();
  });

  it("sự kiện không dùng QR: nói rõ, không đính ảnh kể cả khi nơi gọi lỡ truyền vào", () => {
    const message = buildEventReminderEmail({ ...base, qrCheckin: false, ticketUrl: null });
    expect(message.text).toContain("không dùng mã QR check-in");
    expect(message.text).not.toContain("VÉ THAM DỰ");
    expect(message.attachments).toBeUndefined();
  });
});

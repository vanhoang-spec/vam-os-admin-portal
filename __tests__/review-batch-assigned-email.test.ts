/**
 * Thư báo lô hồ sơ cho người chấm — nội dung.
 */
import { describe, expect, it } from "vitest";
import { buildReviewBatchAssignedEmail } from "@/lib/email-core";

const base = {
  reviewerName: "Võ Nguyễn Hoàng Mỹ",
  seasonLabel: "UEH Mentoring S12",
  assignmentCount: 10,
  reviewsUrl: "https://os.example.org/reviews"
};

describe("hạn trong thư", () => {
  it("nói hạn là HẾT NGÀY theo giờ Việt Nam, ở cả bản chữ lẫn bản HTML", () => {
    const mail = buildReviewBatchAssignedEmail({ ...base, dueLabel: "20/09/2026", roleApplied: "mentee" });

    expect(mail.text).toContain("Hạn hoàn tất: hết ngày 20/09/2026 (giờ Việt Nam).");
    expect(mail.html).toContain("hết ngày 20/09/2026");
    // "trước 20/09" đọc được thành "trước khi ngày 20 bắt đầu" — lệch đúng một ngày.
    expect(mail.text).not.toMatch(/trước 20\/09/);
    expect(mail.html).not.toMatch(/trước <strong>20\/09/);
  });

  it("hạn nằm ngay trên tiêu đề, để thấy từ hộp thư", () => {
    const mail = buildReviewBatchAssignedEmail({ ...base, dueLabel: "20/09/2026", roleApplied: "mentee" });
    expect(mail.subject).toContain("hạn 20/09/2026");
  });

  it("không hạn: không có dòng hạn, tiêu đề không nhắc hạn", () => {
    const mail = buildReviewBatchAssignedEmail({ ...base, dueLabel: null, roleApplied: "mentee" });

    expect(mail.text).not.toContain("Hạn hoàn tất");
    expect(mail.html).not.toContain("Hạn hoàn tất");
    expect(mail.subject).not.toContain("hạn");
    expect(mail.subject).toContain("UEH Mentoring S12");
  });
});

describe("vai trò của lô", () => {
  it("đơn mentor được gọi là hồ sơ mentor, không phải hồ sơ mentee", () => {
    const mail = buildReviewBatchAssignedEmail({ ...base, roleApplied: "mentor" });

    expect(mail.subject).toContain("10 hồ sơ mentor");
    expect(mail.text).toContain("10 hồ sơ mentor");
    expect(mail.html).toContain("10 hồ sơ mentor");
    for (const part of [mail.subject, mail.text, mail.html]) {
      expect(part).not.toContain("mentee");
    }
  });

  it("đơn mentee được gọi là hồ sơ mentee", () => {
    const mail = buildReviewBatchAssignedEmail({ ...base, roleApplied: "Mentee" });
    expect(mail.text).toContain("10 hồ sơ mentee");
  });

  it("vai trò không rõ: nói 'hồ sơ', không đoán", () => {
    for (const roleApplied of [null, "", "alumni"]) {
      const mail = buildReviewBatchAssignedEmail({ ...base, roleApplied });
      expect(mail.text).toContain("10 hồ sơ UEH Mentoring S12");
      expect(mail.text).not.toMatch(/hồ sơ ment/);
    }
  });
});

describe("phần còn lại của thư", () => {
  it("có đường dẫn mở danh sách chấm ở cả hai bản", () => {
    const mail = buildReviewBatchAssignedEmail({ ...base, roleApplied: "mentee" });
    expect(mail.text).toContain("https://os.example.org/reviews");
    expect(mail.html).toContain('href="https://os.example.org/reviews"');
  });

  it("tên người nhận không được chèn HTML vào thư", () => {
    const mail = buildReviewBatchAssignedEmail({ ...base, reviewerName: "<img src=x onerror=alert(1)>" });
    expect(mail.html).not.toContain("<img src=x");
  });
});

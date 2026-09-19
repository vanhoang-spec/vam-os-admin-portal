/**
 * Khảo sát cuối buổi — phần thuần: phiếu hợp lệ là gì, ai nhận thư, và lượt
 * check out được ghi vào trạm nào.
 *
 * ---------------------------------------------------------------------------
 * ĐIỀU DỄ SAI NHẤT: TRẠM CHECK OUT
 * ---------------------------------------------------------------------------
 * Sự kiện đã thiết lập lần quét Check out thì phiếu phải ghi vào ĐÚNG trạm đó.
 * Ghi vào một trạm khác thì lượt quét tay ở cửa ra và lượt nộp phiếu rơi vào hai
 * con số, và bảng đếm nói hai điều khác nhau về cùng một người.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng lib/event-survey-core.ts.
 */
import { describe, expect, it } from "vitest";

import { buildCheckinSteps, type CheckinPurpose } from "@/lib/event-checkin-steps";
import {
  MAX_ANSWER,
  MAX_NAME,
  SURVEY_AUTO_WINDOW_MS,
  checkoutStationFor,
  describeSurveyCounts,
  hasEntranceScan,
  impressionQuestion,
  isSurveyAudience,
  isSurveyRecipient,
  shouldContinueSurvey,
  sourceFromParam,
  surveyAutoSendDue,
  surveySendBlockReason,
  surveyUrl,
  trackingNotice,
  validateSurveyInput
} from "@/lib/event-survey-core";

const steps = (purposes: CheckinPurpose[]) => buildCheckinSteps(purposes);

const GOOD = {
  full_name: "Nguyễn Văn A",
  email: "a@example.com",
  phone: "0905 376 392",
  student_id: "31221020000",
  impression: "Phần chia sẻ của anh mentor.",
  question: "Khi nào có kết quả ghép cặp ạ?"
};

describe("1. phiếu hợp lệ", () => {
  it("nhận phiếu đủ ô, và chuẩn hoá email + số điện thoại để đối chiếu", () => {
    const result = validateSurveyInput({ ...GOOD, email: "  A@Example.COM " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.emailNorm).toBe("a@example.com");
    expect(result.phoneNorm).toBe("0905376392");
    expect(result.values.full_name).toBe("Nguyễn Văn A");
  });

  it("+84 và 0 là cùng một số — nếu không, người đăng ký bằng +84 sẽ không khớp", () => {
    const plus = validateSurveyInput({ ...GOOD, phone: "+84905376392" });
    const zero = validateSurveyInput({ ...GOOD, phone: "0905376392" });
    expect(plus.ok && zero.ok).toBe(true);
    if (!plus.ok || !zero.ok) return;
    expect(plus.phoneNorm).toBe(zero.phoneNorm);
  });

  it.each([
    ["full_name", { full_name: "   " }],
    ["email", { email: "khong-phai-email" }],
    ["phone", { phone: "" }],
    ["impression", { impression: "  " }]
  ])("thiếu hoặc sai ô %s thì từ chối, và nói đúng ô nào", (field, patch) => {
    const result = validateSurveyInput({ ...GOOD, ...patch });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe(field);
    expect(result.message.length).toBeGreaterThan(10);
  });

  it("câu hỏi thứ hai để trống vẫn hợp lệ — nó không bắt buộc", () => {
    const result = validateSurveyInput({ ...GOOD, question: "" });
    expect(result.ok).toBe(true);
  });

  it("cắt độ dài thay vì từ chối: người gõ dài không bị mất cả phiếu", () => {
    const result = validateSurveyInput({
      ...GOOD,
      full_name: "x".repeat(MAX_NAME + 50),
      impression: "y".repeat(MAX_ANSWER + 500)
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.full_name).toHaveLength(MAX_NAME);
    expect(result.values.impression).toHaveLength(MAX_ANSWER);
  });
});

describe("2. trạm check out", () => {
  it("dùng đúng trạm Check out mà sự kiện đã thiết lập", () => {
    expect(checkoutStationFor(steps(["entrance", "talkshow", "checkout"]))).toBe("checkout");
  });

  it("sự kiện chưa thiết lập lần Check out nào thì vẫn ghi vào 'checkout'", () => {
    expect(checkoutStationFor(steps(["entrance"]))).toBe("checkout");
  });

  it("có hai lần Check out thì lấy lần ĐẦU — lần sau là một trạm khác", () => {
    const configured = steps(["checkout", "entrance", "checkout"]);
    expect(configured.map((step) => step.station)).toContain("checkout_2");
    expect(checkoutStationFor(configured)).toBe("checkout");
  });
});

describe("3. đã check in chưa", () => {
  it("có lượt quét ở trạm Check in là đã check in", () => {
    expect(hasEntranceScan(["entrance"], steps(["entrance", "checkout"]))).toBe(true);
  });

  it("chỉ có lượt Check out thì CHƯA check in — đây là phép phân biệt cả tính năng dựa vào", () => {
    expect(hasEntranceScan(["checkout"], steps(["entrance", "checkout"]))).toBe(false);
  });

  it("sự kiện không thiết lập lần Check in nào vẫn nhận trạm 'entrance' của máy quét cũ", () => {
    expect(hasEntranceScan(["entrance"], steps(["checkout"]))).toBe(true);
  });

  it("lần Check in thứ hai cũng tính", () => {
    expect(hasEntranceScan(["entrance_2"], steps(["entrance", "entrance", "checkout"]))).toBe(true);
  });
});

describe("4. ai nhận thư khảo sát", () => {
  const row = (patch: Record<string, unknown> = {}) => ({
    registration_status: "registered",
    attendance_status: "checked_in",
    email: "a@example.com",
    ...patch
  });

  it("nhóm mặc định chỉ gồm người đã check in", () => {
    expect(isSurveyRecipient(row(), "checked_in")).toBe(true);
    expect(isSurveyRecipient(row({ attendance_status: "pending" }), "checked_in")).toBe(false);
  });

  it("nhóm rộng gồm cả người chưa check in", () => {
    expect(isSurveyRecipient(row({ attendance_status: "pending" }), "all_registered")).toBe(true);
  });

  it.each(["cancelled", "rejected"])("đăng ký %s thì không nhận thư, kể cả ở nhóm rộng", (status) => {
    expect(isSurveyRecipient(row({ registration_status: status }), "all_registered")).toBe(false);
  });

  it("người trong danh sách chờ mà đã check in thì CÓ nhận — họ đã ngồi trong buổi", () => {
    expect(isSurveyRecipient(row({ registration_status: "waitlisted" }), "checked_in")).toBe(true);
  });

  it("không có email thì không thể gửi", () => {
    expect(isSurveyRecipient(row({ email: "  " }), "checked_in")).toBe(false);
  });

  it("chỉ nhận đúng hai tên nhóm", () => {
    expect(isSurveyAudience("checked_in")).toBe(true);
    expect(isSurveyAudience("all_registered")).toBe(true);
    expect(isSurveyAudience("everyone")).toBe(false);
  });
});

describe("5. giờ tự gửi", () => {
  const at = Date.parse("2026-09-19T11:30:00.000Z");

  it("chưa tới giờ thì chưa gửi", () => {
    expect(surveyAutoSendDue("2026-09-19T11:30:00.000Z", at - 60_000)).toBe(false);
  });

  it("tới giờ thì gửi", () => {
    expect(surveyAutoSendDue("2026-09-19T11:30:00.000Z", at)).toBe(true);
  });

  it("quá 6 giờ thì thôi — mốc của buổi tuần trước không được gửi lại hôm nay", () => {
    expect(surveyAutoSendDue("2026-09-19T11:30:00.000Z", at + SURVEY_AUTO_WINDOW_MS + 1)).toBe(false);
  });

  it("chưa đặt giờ thì không bao giờ tự gửi", () => {
    expect(surveyAutoSendDue(null, at)).toBe(false);
    expect(surveyAutoSendDue("khong-phai-gio", at)).toBe(false);
  });
});

describe("6. chặn gửi", () => {
  it("buổi đã huỷ thì không gửi", () => {
    expect(surveySendBlockReason({ status: "cancelled" }, true)).toContain("đã huỷ");
  });

  it("chưa có link khảo sát thì không gửi — thư phải mang được link", () => {
    expect(surveySendBlockReason({ status: "active" }, false)).toContain("link khảo sát");
  });

  it("đủ điều kiện thì không chặn", () => {
    expect(surveySendBlockReason({ status: "active" }, true)).toBeNull();
  });
});

describe("7. đường dẫn và câu chữ", () => {
  it("link khảo sát trỏ tới /khao-sat/<token>", () => {
    expect(surveyUrl("https://os.example.org/", "abc")).toBe("https://os.example.org/khao-sat/abc");
  });

  it("link trong thư mang dấu ?tu=thu để phân biệt nguồn phiếu", () => {
    expect(surveyUrl("https://os.example.org", "abc", "email")).toBe("https://os.example.org/khao-sat/abc?tu=thu");
    expect(sourceFromParam("thu")).toBe("email");
    expect(sourceFromParam("")).toBe("qr");
    expect(sourceFromParam("gi-do")).toBe("qr");
  });

  it("câu hỏi 1 mang tên buổi", () => {
    expect(impressionQuestion("Mentee Orientation Mùa 12")).toBe(
      "Điều làm bạn ấn tượng nhất sau chương trình Mentee Orientation Mùa 12?"
    );
  });

  it("câu giải thích nói rõ dùng để đề xuất điểm rèn luyện, kèm tên buổi và ngày", () => {
    const notice = trackingNotice("Mentee Orientation", "19/09/2026");
    expect(notice).toContain("điểm rèn luyện");
    expect(notice).toContain("Mentee Orientation");
    expect(notice).toContain("19/09/2026");
  });
});

describe("8. đếm và vòng gửi", () => {
  const counts = { queued: 5, sending: 0, sent: 12, failed: 1, skipped: 2 };

  it("chỉ nói những con số khác 0", () => {
    expect(describeSurveyCounts(counts)).toBe("Đã gửi 12/20 · lỗi 1 · bỏ qua 2 · còn 5");
    expect(describeSurveyCounts({ queued: 0, sending: 0, sent: 3, failed: 0, skipped: 0 })).toBe("Đã gửi 3/3");
  });

  it("còn hàng đợi và lô vừa rồi có gửi được thì gọi tiếp", () => {
    expect(
      shouldContinueSurvey({ ok: true, message: "", counts, chunk: { sent: 10, failed: 0, skipped: 0, queued: 0 } })
    ).toBe(true);
  });

  it("cả lô đều lỗi thì DỪNG — gọi tiếp chỉ đốt nốt danh sách thành thư lỗi", () => {
    expect(
      shouldContinueSurvey({ ok: true, message: "", counts, chunk: { sent: 0, failed: 10, skipped: 0, queued: 0 } })
    ).toBe(false);
  });

  it("hết hàng đợi thì dừng", () => {
    expect(
      shouldContinueSurvey({
        ok: true,
        message: "",
        counts: { queued: 0, sending: 0, sent: 20, failed: 0, skipped: 0 },
        chunk: { sent: 10, failed: 0, skipped: 0, queued: 0 }
      })
    ).toBe(false);
  });
});

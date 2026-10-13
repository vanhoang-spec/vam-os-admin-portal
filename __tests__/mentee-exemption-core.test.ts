/**
 * Mentee đặc cách (Support team) — phần thuần: ai được gợi ý, mỗi dòng đang ở bước nào, ai
 * nhận thư ở lượt bấm tới, và câu chữ cho từng mã kết quả.
 *
 * Phần gợi ý là chỗ dễ sai nhất và sai thì thành gửi thư mời nhầm người: một người đã đi
 * đường phỏng vấn (đạt hay không) không bao giờ được gợi ý đặc cách.
 */
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_SIGNAL_LABELS,
  EXEMPTION_RESEND_AFTER_MS,
  EXEMPTION_STATE_LABELS,
  MENTEE_CONFIRM_PATH_PREFIX,
  countExemptions,
  exemptionBlockerLabel,
  exemptionConfirmMessage,
  exemptionState,
  isExemptionRecipient,
  menteeConfirmUrl,
  suggestExemptionCandidates,
  summarizeAddOutcomes
} from "@/lib/mentee-exemption-core";

const NOW = Date.parse("2026-10-11T05:00:00Z");
const row = (over: Partial<{ confirmedAt: string | null; revokedAt: string | null; sendCount: number; lastSentAt: string | null; email: string | null }> = {}) => ({
  confirmedAt: null, revokedAt: null, sendCount: 0, lastSentAt: null, email: "a@example.test", ...over
});

describe("đường dẫn xác nhận", () => {
  it("ghép từ gốc và mã, không nhân đôi dấu gạch chéo", () => {
    expect(MENTEE_CONFIRM_PATH_PREFIX).toBe("/xac-nhan-mentee");
    expect(menteeConfirmUrl("https://os.test", "abc")).toBe("https://os.test/xac-nhan-mentee/abc");
    expect(menteeConfirmUrl("https://os.test///", "abc")).toBe("https://os.test/xac-nhan-mentee/abc");
  });
});

describe("mỗi dòng đang ở bước nào", () => {
  it("chưa gửi → đã gửi → đã xác nhận; gỡ là gỡ", () => {
    expect(exemptionState(row())).toBe("not_sent");
    expect(exemptionState(row({ sendCount: 1 }))).toBe("sent");
    expect(exemptionState(row({ sendCount: 2, confirmedAt: "2026-10-11T04:00:00Z" }))).toBe("confirmed");
    expect(exemptionState(row({ sendCount: 1, revokedAt: "2026-10-11T04:00:00Z" }))).toBe("revoked");
  });

  it("đã xác nhận thắng một dấu gỡ còn sót: người đó đã là mentee", () => {
    expect(exemptionState(row({ confirmedAt: "2026-10-11T04:00:00Z", revokedAt: "2026-10-11T03:00:00Z" }))).toBe("confirmed");
  });

  it("mỗi bước có một nhãn tiếng Việt", () => {
    expect(Object.keys(EXEMPTION_STATE_LABELS).sort()).toEqual(["confirmed", "not_sent", "revoked", "sent"]);
    for (const label of Object.values(EXEMPTION_STATE_LABELS)) expect(label.trim().length).toBeGreaterThan(3);
  });

  it("đếm theo bước; người đã gỡ không tính vào 'trong danh sách'", () => {
    expect(
      countExemptions([
        row(),
        row(),
        row({ sendCount: 1 }),
        row({ sendCount: 3, confirmedAt: "2026-10-11T04:00:00Z" }),
        row({ revokedAt: "2026-10-11T04:00:00Z" })
      ])
    ).toEqual({ listed: 4, confirmed: 1, waiting: 1, notSent: 2, revoked: 1 });
    expect(countExemptions([])).toEqual({ listed: 0, confirmed: 0, waiting: 0, notSent: 0, revoked: 0 });
  });
});

describe("ai nhận thư ở lượt bấm tới", () => {
  it("người chưa từng nhận thư thì nhận", () => {
    expect(isExemptionRecipient(row(), NOW)).toBe(true);
  });

  it("người đã xác nhận, đã gỡ, hoặc không có email thì không bao giờ nhận", () => {
    expect(isExemptionRecipient(row({ confirmedAt: "2026-10-11T04:00:00Z" }), NOW)).toBe(false);
    expect(isExemptionRecipient(row({ revokedAt: "2026-10-11T04:00:00Z" }), NOW)).toBe(false);
    expect(isExemptionRecipient(row({ email: null }), NOW)).toBe(false);
    expect(isExemptionRecipient(row({ email: "   " }), NOW)).toBe(false);
    // Kể cả khi thư cũ đã đủ lâu để nhắc.
    const old = new Date(NOW - EXEMPTION_RESEND_AFTER_MS - 60_000).toISOString();
    expect(isExemptionRecipient(row({ lastSentAt: old, confirmedAt: "2026-10-11T04:00:00Z" }), NOW)).toBe(false);
    expect(isExemptionRecipient(row({ lastSentAt: old, revokedAt: "2026-10-11T04:00:00Z" }), NOW)).toBe(false);
  });

  it("vừa nhận thư thì chưa nhận lại; đủ 20 giờ thì được nhắc — đúng tại mốc", () => {
    expect(EXEMPTION_RESEND_AFTER_MS).toBe(20 * 60 * 60 * 1000);
    const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
    expect(isExemptionRecipient(row({ lastSentAt: at(60_000) }), NOW)).toBe(false);
    expect(isExemptionRecipient(row({ lastSentAt: at(EXEMPTION_RESEND_AFTER_MS - 1) }), NOW)).toBe(false);
    expect(isExemptionRecipient(row({ lastSentAt: at(EXEMPTION_RESEND_AFTER_MS) }), NOW)).toBe(true);
    expect(isExemptionRecipient(row({ lastSentAt: at(EXEMPTION_RESEND_AFTER_MS + 1) }), NOW)).toBe(true);
  });

  it("mốc gửi không đọc được thì KHÔNG gửi: thà thiếu thư nhắc còn hơn gửi trùng", () => {
    expect(isExemptionRecipient(row({ lastSentAt: "không phải ngày giờ" }), NOW)).toBe(false);
  });
});

describe("gợi ý người vào danh sách", () => {
  const people = [
    { id: "p-account", name: "Bình Tài Khoản", email: "Binh@Example.test" },
    { id: "p-manual", name: "An Gắn Tay", email: "an@example.test" },
    { id: "p-approved", name: "Cúc Duyệt Tay", email: "cuc@example.test" },
    { id: "p-passed", name: "Dũng Đạt Phỏng Vấn", email: "dung@example.test" },
    { id: "p-failed", name: "Én Trượt Phỏng Vấn", email: "en@example.test" },
    { id: "p-pending", name: "Giang Đang Chờ", email: "giang@example.test" },
    { id: "p-nobody", name: "Hà Không Liên Quan", email: "ha@example.test" }
  ];
  const base = {
    people,
    supportAccountEmails: [" binh@example.test "],
    activeMenteePersonIds: ["p-manual", "p-approved", "p-passed"],
    applications: [
      { id: "app-approved", personId: "p-approved", email: "cuc@example.test", status: "approved_as_mentee" },
      { id: "app-passed", personId: "p-passed", email: "dung@example.test", status: "approved_as_mentee" },
      // Đơn nộp qua form mới: chưa nối hồ sơ người, chỉ khớp theo email.
      { id: "app-failed", personId: null, email: "EN@example.test", status: "rejected_or_not_fit" },
      { id: "app-pending", personId: null, email: "giang@example.test", status: "interview_scheduled" }
    ],
    interviewedApplicationIds: ["app-passed", "app-failed"],
    listedPersonIds: [] as string[]
  };

  it("gom đúng ba nhóm có dấu hiệu, xếp theo tên, kèm trạng thái đơn mùa này", () => {
    expect(suggestExemptionCandidates(base)).toEqual([
      { personId: "p-manual", name: "An Gắn Tay", email: "an@example.test", signals: ["membership_without_interview"], applicationStatus: null },
      { personId: "p-account", name: "Bình Tài Khoản", email: "Binh@Example.test", signals: ["support_account"], applicationStatus: null },
      { personId: "p-approved", name: "Cúc Duyệt Tay", email: "cuc@example.test", signals: ["approved_without_interview"], applicationStatus: "approved_as_mentee" }
    ]);
  });

  it("người đã có dòng phỏng vấn — đạt hay trượt — không bao giờ được gợi ý", () => {
    const ids = suggestExemptionCandidates(base).map((c) => c.personId);
    expect(ids).not.toContain("p-passed");
    expect(ids).not.toContain("p-failed");
    // Kể cả khi người trượt phỏng vấn có tài khoản Support team.
    const withAccount = suggestExemptionCandidates({ ...base, supportAccountEmails: ["en@example.test", "dung@example.test"] });
    expect(withAccount.map((c) => c.personId)).not.toContain("p-failed");
    expect(withAccount.map((c) => c.personId)).not.toContain("p-passed");
  });

  it("đơn đang chờ mà không có dấu hiệu nào khác thì không gợi ý; có tài khoản Support team thì gợi ý kèm trạng thái đơn", () => {
    expect(suggestExemptionCandidates(base).map((c) => c.personId)).not.toContain("p-pending");
    const withAccount = suggestExemptionCandidates({ ...base, supportAccountEmails: ["giang@example.test"] });
    expect(withAccount.find((c) => c.personId === "p-pending")).toEqual({
      personId: "p-pending", name: "Giang Đang Chờ", email: "giang@example.test", signals: ["support_account"], applicationStatus: "interview_scheduled"
    });
  });

  it("người đã nằm trong danh sách thì thôi gợi ý", () => {
    expect(suggestExemptionCandidates({ ...base, listedPersonIds: ["p-manual", "p-approved"] }).map((c) => c.personId)).toEqual(["p-account"]);
  });

  it("một người có nhiều dấu hiệu thì hiện đủ, theo thứ tự cố định", () => {
    const both = suggestExemptionCandidates({ ...base, supportAccountEmails: ["cuc@example.test", "an@example.test"] });
    expect(both.find((c) => c.personId === "p-approved")?.signals).toEqual(["support_account", "approved_without_interview"]);
    expect(both.find((c) => c.personId === "p-manual")?.signals).toEqual(["support_account", "membership_without_interview"]);
  });

  it("có tư cách mentee nhưng ĐÃ có đơn chưa duyệt thì không tính là 'gắn tay chưa có đơn'", () => {
    const result = suggestExemptionCandidates({ ...base, activeMenteePersonIds: [...base.activeMenteePersonIds, "p-pending"] });
    expect(result.map((c) => c.personId)).not.toContain("p-pending");
  });

  it("người không có email không khớp nhầm với tài khoản hay đơn thiếu email", () => {
    const result = suggestExemptionCandidates({
      ...base,
      people: [{ id: "p-blank", name: "Không Email", email: null }],
      supportAccountEmails: ["", "  "],
      activeMenteePersonIds: [],
      applications: [{ id: "x", personId: null, email: null, status: "approved_as_mentee" }]
    });
    expect(result).toEqual([]);
  });

  it("mỗi dấu hiệu có một câu giải thích cho BTC", () => {
    expect(Object.keys(CANDIDATE_SIGNAL_LABELS).sort()).toEqual(["approved_without_interview", "membership_without_interview", "support_account"]);
  });
});

describe("câu chữ", () => {
  it("lý do bị chặn: mã quen có câu riêng, mã lạ có câu chung — không bao giờ lộ mã kỹ thuật", () => {
    expect(exemptionBlockerLabel("application_closed")).toBe("đơn mentee mùa này đã bị từ chối hoặc đã rút");
    expect(exemptionBlockerLabel("membership_inactive")).toContain("tư cách mentee");
    expect(exemptionBlockerLabel("no_email")).toContain("email");
    for (const code of ["ma_la", "", null, undefined]) expect(exemptionBlockerLabel(code)).toBe("cần ban tổ chức kiểm tra hồ sơ");
  });

  it("tổng kết sau khi thêm: nói rõ thêm được mấy, có sẵn mấy, ai chưa thêm được và vì sao", () => {
    const names = new Map([["a", "An"], ["b", "Bình"], ["c", "Cúc"]]);
    expect(summarizeAddOutcomes([{ personId: "a", code: "added" }, { personId: "b", code: "restored" }], names)).toEqual({
      ok: true, message: "Đã thêm 2 người vào danh sách đặc cách."
    });
    const mixed = summarizeAddOutcomes(
      [{ personId: "a", code: "added" }, { personId: "b", code: "exists" }, { personId: "c", code: "application_closed" }, { personId: "z", code: "person_not_found" }],
      names
    );
    expect(mixed.ok).toBe(true);
    expect(mixed.message).toBe(
      "Đã thêm 1 người vào danh sách đặc cách. 1 người đã có sẵn trong danh sách. 2 người chưa thêm được: Cúc — đơn mentee mùa này đã bị từ chối hoặc đã rút; (không rõ tên) — không tìm thấy hồ sơ người."
    );
  });

  it("không thêm được ai thì là lỗi, không báo thành công", () => {
    const names = new Map([["c", "Cúc"]]);
    expect(summarizeAddOutcomes([{ personId: "c", code: "membership_inactive" }], names).ok).toBe(false);
    expect(summarizeAddOutcomes([], names)).toEqual({ ok: false, message: "Không có ai được thêm." });
    // Chỉ toàn người đã có sẵn: không lỗi, và nói đúng là đã có sẵn.
    expect(summarizeAddOutcomes([{ personId: "c", code: "exists" }], names)).toEqual({ ok: true, message: "1 người đã có sẵn trong danh sách." });
  });

  it("lời báo cho người bấm xác nhận: mỗi mã một câu; cần BTC xem thì nói rõ chưa có gì bị đổi", () => {
    expect(exemptionConfirmMessage("confirmed")).toContain("ghi nhận");
    expect(exemptionConfirmMessage("already_confirmed")).toContain("đã xác nhận");
    expect(exemptionConfirmMessage("revoked")).toContain("thu hồi");
    expect(exemptionConfirmMessage("invalid_token")).toContain("Đường dẫn");
    expect(exemptionConfirmMessage("needs_btc")).toContain("chưa có gì bị thay đổi");
    expect(exemptionConfirmMessage("ma_la")).toBe("Hệ thống đang bận, bạn thử lại sau ít phút.");
    expect(exemptionConfirmMessage(undefined)).toBe("Hệ thống đang bận, bạn thử lại sau ít phút.");
  });
});

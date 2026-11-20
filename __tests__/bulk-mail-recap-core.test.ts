/**
 * Nhóm nhận thư "Mentee chưa có recap trong tháng" — phần thuần (lib/bulk-mail-recap-core.ts).
 *
 * Mỗi ca canh một cách gửi thư nhắc NHẦM người mà không ai thấy:
 *   - nhắc người đã gặp (recap cần duyệt bị bỏ qua, bài quét kể buổi tháng 10 tính sai tháng);
 *   - bỏ sót người chưa gặp (cặp ghép giữa tháng, mentee đổi cặp);
 *   - nhắc người không còn trong chương trình (cặp dropped trước cuối tháng);
 *   - CC nhầm mentor (mentor cặp cũ thay vì cặp active mới nhất);
 *   - lệch một ngày vì múi giờ (Vercel chạy UTC).
 *
 * Phân loại: PURE — không database, không gửi thư.
 */
import { describe, expect, it } from "vitest";
import {
  FACEBOOK_SCAN_SOURCE,
  countCcMentors,
  formatRecapMonth,
  isRecapMonth,
  lastDayOfMonth,
  menteesWithoutRecap,
  recapMonthChoices,
  recapPostedMonth,
  type RecapMatchRow,
  type RecapRow
} from "@/lib/bulk-mail-recap-core";
import { partitionRecipients, resolveAudienceChoice } from "@/lib/bulk-mail-core";

const NOV = "2026-11";

function match(overrides: Partial<RecapMatchRow> & { id: string; menteePersonId: string }): RecapMatchRow {
  return {
    mentorPersonId: `mentor-of-${overrides.id}`,
    status: "active",
    matchedAt: "2026-10-05T03:00:00+00:00",
    endedAt: null,
    updatedAt: "2026-10-05T03:00:00+00:00",
    ...overrides
  };
}

function recap(overrides: Partial<RecapRow> & { menteePersonId: string }): RecapRow {
  return {
    meetingDate: "2026-11-10",
    meetingMonth: "2026-11",
    status: "submitted",
    capturedBy: null,
    createdAt: "2026-11-10T05:00:00+00:00",
    ...overrides
  };
}

const ids = (rows: Array<{ menteePersonId: string }>) => rows.map((row) => row.menteePersonId);

describe("1. đã gặp / chưa gặp", () => {
  it("mentee có recap đăng trong tháng không bị nhắc; mentee chưa có thì bị nhắc, kèm mentor của cặp", () => {
    const result = menteesWithoutRecap({
      month: NOV,
      matches: [match({ id: "m1", menteePersonId: "a" }), match({ id: "m2", menteePersonId: "b", mentorPersonId: "mentor-b" })],
      recaps: [recap({ menteePersonId: "a" })]
    });
    expect(result).toEqual({
      denominator: 2,
      met: 1,
      sessions: 1,
      noRecap: [{ menteePersonId: "b", mentorPersonId: "mentor-b", matchId: "m2" }]
    });
  });

  it("recap tháng khác không tính cho tháng này", () => {
    const result = menteesWithoutRecap({
      month: NOV,
      matches: [match({ id: "m1", menteePersonId: "a" })],
      recaps: [recap({ menteePersonId: "a", meetingDate: "2026-12-02", meetingMonth: "2026-12", createdAt: "2026-12-02T01:00:00Z" })]
    });
    expect(ids(result.noRecap)).toEqual(["a"]);
  });

  it("needs_review vẫn tính là đã gặp; trạng thái khác (vd rejected) thì không", () => {
    const result = menteesWithoutRecap({
      month: NOV,
      matches: [match({ id: "m1", menteePersonId: "a" }), match({ id: "m2", menteePersonId: "b" })],
      recaps: [recap({ menteePersonId: "a", status: "needs_review" }), recap({ menteePersonId: "b", status: "rejected" })]
    });
    expect(result.met).toBe(1);
    expect(ids(result.noRecap)).toEqual(["b"]);
  });

  it("2 bài cùng một buổi (cùng mentee, cùng ngày gặp) đếm 1 buổi; khác ngày là 2 buổi", () => {
    const same = menteesWithoutRecap({
      month: NOV,
      matches: [match({ id: "m1", menteePersonId: "a" })],
      recaps: [recap({ menteePersonId: "a" }), recap({ menteePersonId: "a", status: "needs_review" })]
    });
    expect(same).toMatchObject({ met: 1, sessions: 1, noRecap: [] });

    const twoDays = menteesWithoutRecap({
      month: NOV,
      matches: [match({ id: "m1", menteePersonId: "a" })],
      recaps: [recap({ menteePersonId: "a" }), recap({ menteePersonId: "a", meetingDate: "2026-11-17" })]
    });
    expect(twoDays).toMatchObject({ met: 1, sessions: 2 });
  });
});

describe("2. mẫu số: cặp dropped, cặp ghép muộn", () => {
  it("cặp dropped trước hoặc đúng ngày cuối tháng: không vào mẫu số, không bị nhắc", () => {
    const result = menteesWithoutRecap({
      month: NOV,
      matches: [
        match({ id: "m1", menteePersonId: "a", status: "dropped", endedAt: "2026-10-20T03:00:00Z" }),
        // ended_at rỗng → dùng updated_at (40 cặp dropped của mùa 12 như vậy).
        match({ id: "m2", menteePersonId: "b", status: "dropped", endedAt: null, updatedAt: "2026-11-30T10:00:00Z" })
      ],
      recaps: []
    });
    expect(result).toMatchObject({ denominator: 0, noRecap: [] });
  });

  it("cặp dropped SAU ngày cuối tháng vẫn thuộc mẫu số của tháng đó", () => {
    const result = menteesWithoutRecap({
      month: NOV,
      matches: [match({ id: "m1", menteePersonId: "a", status: "dropped", endedAt: "2026-12-03T03:00:00Z" })],
      recaps: []
    });
    expect(ids(result.noRecap)).toEqual(["a"]);
  });

  it("cặp ghép trong tháng vẫn vào mẫu số; ghép sau ngày cuối tháng thì không", () => {
    const result = menteesWithoutRecap({
      month: NOV,
      matches: [
        match({ id: "m1", menteePersonId: "a", matchedAt: "2026-11-16T00:00:00Z" }),
        match({ id: "m2", menteePersonId: "b", matchedAt: "2026-12-01T03:00:00Z" })
      ],
      recaps: []
    });
    expect(ids(result.noRecap)).toEqual(["a"]);
  });

  it("ngày tính theo giờ Việt Nam: 30/11 17:30 UTC đã là 01/12 ở Việt Nam", () => {
    const result = menteesWithoutRecap({
      month: NOV,
      matches: [
        match({ id: "m1", menteePersonId: "a", matchedAt: "2026-11-30T17:30:00Z" }),
        match({ id: "m2", menteePersonId: "b", status: "dropped", endedAt: "2026-11-30T17:30:00Z" })
      ],
      recaps: []
    });
    // a ghép ngày 01/12 (giờ VN) → ngoài mẫu số; b dừng ngày 01/12 (giờ VN) → còn trong mẫu số.
    expect(ids(result.noRecap)).toEqual(["b"]);
  });
});

describe("3. mentee đổi cặp", () => {
  it("một người, CC mentor của cặp active mới nhất; recap với mentor cũ vẫn tính là đã gặp", () => {
    const changed = [
      match({ id: "old", menteePersonId: "a", mentorPersonId: "mentor-cu", status: "dropped", endedAt: "2026-12-15T00:00:00Z", matchedAt: "2026-10-03T00:00:00Z" }),
      match({ id: "new", menteePersonId: "a", mentorPersonId: "mentor-moi", matchedAt: "2026-11-02T00:00:00Z" })
    ];
    const notMet = menteesWithoutRecap({ month: NOV, matches: changed, recaps: [] });
    expect(notMet.denominator).toBe(1);
    expect(notMet.noRecap).toEqual([{ menteePersonId: "a", mentorPersonId: "mentor-moi", matchId: "new" }]);

    // Thứ tự database trả về không đổi kết quả.
    const reversed = menteesWithoutRecap({ month: NOV, matches: changed.slice().reverse(), recaps: [] });
    expect(reversed.noRecap).toEqual(notMet.noRecap);

    const metOld = menteesWithoutRecap({ month: NOV, matches: changed, recaps: [recap({ menteePersonId: "a" })] });
    expect(metOld).toMatchObject({ met: 1, noRecap: [] });
  });

  it("cặp cũ dropped trong tháng 10, cặp mới active: chỉ cặp mới vào mẫu số", () => {
    const result = menteesWithoutRecap({
      month: NOV,
      matches: [
        match({ id: "old", menteePersonId: "a", mentorPersonId: "mentor-cu", status: "dropped", endedAt: "2026-10-20T00:00:00Z" }),
        match({ id: "new", menteePersonId: "a", mentorPersonId: "mentor-moi", matchedAt: "2026-10-25T00:00:00Z" })
      ],
      recaps: []
    });
    expect(result.noRecap).toEqual([{ menteePersonId: "a", mentorPersonId: "mentor-moi", matchId: "new" }]);
  });

  it("cặp không ghi mentor: vẫn nhắc mentee, mentorPersonId = null", () => {
    const result = menteesWithoutRecap({ month: NOV, matches: [match({ id: "m1", menteePersonId: "a", mentorPersonId: null })], recaps: [] });
    expect(result.noRecap).toEqual([{ menteePersonId: "a", mentorPersonId: null, matchId: "m1" }]);
  });
});

describe("4. tháng của recap = tháng NGÀY ĐĂNG", () => {
  it("bài của bộ quét 19/11 kể buổi gặp 28/10 tính vào tháng 11", () => {
    const row = recap({ menteePersonId: "a", meetingDate: "2026-10-28", meetingMonth: "2026-10", capturedBy: FACEBOOK_SCAN_SOURCE, createdAt: "2026-11-19T15:17:58Z" });
    expect(recapPostedMonth(row)).toBe("2026-11");
    const result = menteesWithoutRecap({ month: NOV, matches: [match({ id: "m1", menteePersonId: "a" })], recaps: [row] });
    expect(result.noRecap).toEqual([]);
    expect(menteesWithoutRecap({ month: "2026-10", matches: [match({ id: "m1", menteePersonId: "a" })], recaps: [row] }).met).toBe(0);
  });

  it("recap nhập tay dùng tháng của ngày gặp", () => {
    expect(recapPostedMonth(recap({ menteePersonId: "a", meetingDate: "2026-10-28", meetingMonth: "2026-10" }))).toBe("2026-10");
  });

  it("có ngày đăng thì theo ngày đăng (bài đăng 01/12 kể buổi 29/11 → tháng 12)", () => {
    expect(
      recapPostedMonth(recap({ menteePersonId: "a", meetingDate: "2026-11-29", postedDate: "2026-12-01", capturedBy: FACEBOOK_SCAN_SOURCE }))
    ).toBe("2026-12");
  });

  it("dòng bộ quét tạo từ 01/12 (giờ VN) mà chưa có ngày đăng thì không bị ép về tháng 11", () => {
    const row = recap({ menteePersonId: "a", meetingDate: "2026-12-02", meetingMonth: "2026-12", capturedBy: FACEBOOK_SCAN_SOURCE, createdAt: "2026-11-30T17:30:00Z" });
    expect(recapPostedMonth(row)).toBe("2026-12");
  });
});

describe("5. tháng, ô chọn tháng, tham số form", () => {
  it("ngày cuối tháng, cả năm nhuận", () => {
    expect(lastDayOfMonth("2026-11")).toBe("2026-11-30");
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29");
    expect(formatRecapMonth("2026-11")).toBe("11/2026");
  });

  it("chỉ nhận đúng dạng YYYY-MM", () => {
    for (const ok of ["2026-11", "2027-01"]) expect(isRecapMonth(ok)).toBe(true);
    for (const bad of ["2026-13", "2026-1", "11/2026", "", null, "2026-11-01", " 2026-11"]) expect(isRecapMonth(bad)).toBe(false);
  });

  it("ô chọn tháng: mới nhất trước, không có tháng tương lai, không lùi quá tháng ghép sớm nhất", () => {
    expect(recapMonthChoices({ currentMonth: "2027-01", earliestMonth: "2026-10" })).toEqual(["2027-01", "2026-12", "2026-11", "2026-10"]);
    expect(recapMonthChoices({ currentMonth: "2026-11", earliestMonth: "2026-10", max: 1 })).toEqual(["2026-11"]);
  });

  it("form: nhóm mới phải có tháng hợp lệ; nhóm khác bỏ tháng đi kèm", () => {
    expect(resolveAudienceChoice({ audience: "mentee_no_recap_month", month: "2026-11" })).toEqual({
      ok: true,
      choice: { audience: "mentee_no_recap_month", eventId: null, coversSeries: false, month: "2026-11" }
    });
    expect(resolveAudienceChoice({ audience: "mentee_no_recap_month" }).ok).toBe(false);
    expect(resolveAudienceChoice({ audience: "mentee_no_recap_month", month: "2026-13" }).ok).toBe(false);
    const other = resolveAudienceChoice({ audience: "mentee", month: "2026-11" });
    expect(other.ok && other.choice.month).toBeFalsy();
  });
});

describe("6. CC đi cùng người nhận", () => {
  it("giữ CC đã chuẩn hoá, bỏ CC trùng chính người nhận; đếm mentor CC khác nhau", () => {
    const { sendable } = partitionRecipients([
      { personId: "a", fullName: "A", email: "a@x.org", role: "mentee", ccEmails: ["Mentor@X.org"] },
      { personId: "b", fullName: "B", email: "b@x.org", role: "mentee", ccEmails: ["mentor@x.org", "B@x.org"] },
      { personId: "c", fullName: "C", email: "c@x.org", role: "mentee", ccWarning: "mentor M chưa có email hợp lệ, thư gửi không CC" }
    ]);
    expect(sendable.map((row) => row.ccEmails)).toEqual([["mentor@x.org"], ["mentor@x.org"], undefined]);
    expect(sendable[2].ccWarning).toContain("không CC");
    expect(countCcMentors(sendable)).toBe(1);
  });
});

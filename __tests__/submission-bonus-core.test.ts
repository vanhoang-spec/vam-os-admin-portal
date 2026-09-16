/**
 * Điểm cộng theo ngày nộp — phần quyết định ai được cộng bao nhiêu.
 *
 * Canh ba thứ dễ sai nhất: ranh giới nửa đêm giờ Việt Nam (máy chủ chạy UTC), hai
 * đầu mốc tính cả ngày đó, và đơn rơi vào nhiều mốc KHÔNG được cộng dồn. Cộng thêm:
 * ô ngày gõ dở không được hiểu thành "không có mốc".
 */
import { describe, expect, it } from "vitest";
import {
  addSubmissionBonus,
  bonusPointsLabel,
  bonusRuleFromRow,
  bonusTargetKey,
  describeBonusWindow,
  parseBonusRuleInput,
  resolveSubmissionBonus,
  sortBonusRules,
  summarizeBonusCoverage,
  vietnamDateKey,
  type SubmissionBonusRule
} from "@/lib/submission-bonus-core";

const rule = (over: Partial<SubmissionBonusRule> = {}): SubmissionBonusRule => ({
  id: "r1",
  label: null,
  startsOn: null,
  endsOn: null,
  points: 3,
  ...over
});

describe("1. ngày nộp đọc theo giờ Việt Nam", () => {
  it("23:59:59 giờ Việt Nam vẫn là ngày đó; 00:00 là ngày hôm sau", () => {
    expect(process.env.TZ).toBe("UTC");
    expect(vietnamDateKey("2026-09-10T16:59:59Z")).toBe("2026-09-10");
    expect(vietnamDateKey("2026-09-10T17:00:00Z")).toBe("2026-09-11");
    expect(vietnamDateKey("2026-09-10T17:00:00+00:00")).toBe("2026-09-11");
  });

  it("giá trị rỗng hoặc không đọc được: null", () => {
    expect(vietnamDateKey(null)).toBeNull();
    expect(vietnamDateKey("")).toBeNull();
    expect(vietnamDateKey("không phải ngày")).toBeNull();
  });
});

describe("2. hai đầu mốc", () => {
  const untilTenth = [rule({ endsOn: "2026-09-10" })];

  it("'đến hết 10/09': nộp 23:59 đêm 10/09 giờ Việt Nam được cộng", () => {
    const bonus = resolveSubmissionBonus(untilTenth, "2026-09-10T16:59:00Z");
    expect(bonus).toMatchObject({ kind: "bonus", points: 3, submittedOn: "2026-09-10" });
  });

  it("'đến hết 10/09': nộp 00:30 sáng 11/09 giờ Việt Nam KHÔNG được — dù ngày UTC vẫn là 10/09", () => {
    const bonus = resolveSubmissionBonus(untilTenth, "2026-09-10T17:30:00Z");
    expect(bonus).toEqual({ kind: "none", submittedOn: "2026-09-11" });
  });

  it("'từ 11/09': tính từ 00:00 giờ Việt Nam ngày 11/09", () => {
    const fromEleventh = [rule({ startsOn: "2026-09-11" })];
    expect(resolveSubmissionBonus(fromEleventh, "2026-09-10T17:00:00Z").kind).toBe("bonus");
    expect(resolveSubmissionBonus(fromEleventh, "2026-09-10T16:59:59Z").kind).toBe("none");
  });

  it("khoảng có cả hai đầu: tính cả hai ngày biên", () => {
    const window = [rule({ startsOn: "2026-09-01", endsOn: "2026-09-10" })];
    expect(resolveSubmissionBonus(window, "2026-08-31T17:00:00Z").kind).toBe("bonus");
    expect(resolveSubmissionBonus(window, "2026-08-31T16:59:59Z").kind).toBe("none");
    expect(resolveSubmissionBonus(window, "2026-09-10T16:59:59Z").kind).toBe("bonus");
  });

  it("một mốc không có ngày nào không cộng cho ai", () => {
    expect(resolveSubmissionBonus([rule()], "2026-09-05T03:00:00Z").kind).toBe("none");
  });
});

describe("3. nhiều mốc: nhận mốc cao nhất, không cộng dồn", () => {
  const early = rule({ id: "a", endsOn: "2026-09-10", points: 5 });
  const late = rule({ id: "b", endsOn: "2026-09-15", points: 3 });

  it("nộp 09/09 rơi vào cả hai mốc: +5, không phải +8", () => {
    const bonus = resolveSubmissionBonus([late, early], "2026-09-09T03:00:00Z");
    expect(bonus).toMatchObject({ kind: "bonus", points: 5 });
    expect(bonus.kind === "bonus" && bonus.rule.id).toBe("a");
  });

  it("nộp 12/09 chỉ rơi vào mốc sau: +3", () => {
    expect(resolveSubmissionBonus([early, late], "2026-09-12T03:00:00Z")).toMatchObject({ kind: "bonus", points: 3 });
  });

  it("bằng điểm nhau: chọn theo id, không theo thứ tự đọc từ database", () => {
    const x = rule({ id: "x", endsOn: "2026-09-10", points: 4 });
    const y = rule({ id: "y", endsOn: "2026-09-15", points: 4 });
    const one = resolveSubmissionBonus([x, y], "2026-09-09T03:00:00Z");
    const two = resolveSubmissionBonus([y, x], "2026-09-09T03:00:00Z");
    expect(one.kind === "bonus" && one.rule.id).toBe("x");
    expect(two.kind === "bonus" && two.rule.id).toBe("x");
  });
});

describe("4. không đọc được mốc khác với không được cộng", () => {
  it("rules null → unknown; mảng rỗng → none", () => {
    expect(resolveSubmissionBonus(null, "2026-09-09T03:00:00Z")).toEqual({ kind: "unknown" });
    expect(resolveSubmissionBonus([], "2026-09-09T03:00:00Z")).toEqual({ kind: "none", submittedOn: "2026-09-09" });
  });

  it("nhãn: unknown là null (không in thành rỗng hay 0)", () => {
    expect(bonusPointsLabel({ kind: "unknown" })).toBeNull();
    expect(bonusPointsLabel({ kind: "none", submittedOn: null })).toBe("");
    expect(bonusPointsLabel(resolveSubmissionBonus([rule({ endsOn: "2026-09-10" })], "2026-09-01T00:00:00Z"))).toBe("+3");
  });

  it("tổng sau cộng: chưa có điểm reviewer thì chưa có tổng; unknown giữ nguyên điểm reviewer", () => {
    const bonus = resolveSubmissionBonus([rule({ endsOn: "2026-09-10" })], "2026-09-01T00:00:00Z");
    expect(addSubmissionBonus(18, bonus)).toBe(21);
    expect(addSubmissionBonus(null, bonus)).toBeNull();
    expect(addSubmissionBonus(undefined, bonus)).toBeNull();
    expect(addSubmissionBonus(18, { kind: "unknown" })).toBe(18);
    expect(addSubmissionBonus(18, { kind: "none", submittedOn: null })).toBe(18);
  });
});

describe("5. kiểm dữ liệu nhập", () => {
  const ok = { label: "Nộp sớm", startsOn: "01/09/2026", endsOn: "10/09/2026", points: "3" };

  it("hợp lệ: ngày DD/MM/YYYY thành YYYY-MM-DD, điểm thành số", () => {
    expect(parseBonusRuleInput(ok)).toEqual({
      ok: true,
      value: { label: "Nộp sớm", startsOn: "2026-09-01", endsOn: "2026-09-10", points: 3 }
    });
  });

  it("chỉ một đầu mốc là đủ; tên để trống thành null", () => {
    expect(parseBonusRuleInput({ ...ok, startsOn: "", label: "   " })).toEqual({
      ok: true,
      value: { label: null, startsOn: null, endsOn: "2026-09-10", points: 3 }
    });
  });

  it("ô ngày gõ dở KHÔNG được coi là ô trống", () => {
    const result = parseBonusRuleInput({ ...ok, endsOn: "10/09/20" });
    expect(result.ok).toBe(false);
  });

  it.each([
    ["ngày không có thật", { startsOn: "31/02/2026" }],
    ["trống cả hai đầu", { startsOn: "", endsOn: "" }],
    ["đầu sau cuối", { startsOn: "11/09/2026", endsOn: "10/09/2026" }],
    ["ngày kiểu ISO", { startsOn: "2026-09-01" }],
    ["điểm 0", { points: "0" }],
    ["điểm 101", { points: "101" }],
    ["điểm lẻ", { points: "3.5" }],
    ["điểm âm", { points: "-1" }],
    ["điểm chữ", { points: "ba" }],
    ["điểm trống", { points: "" }],
    ["tên quá dài", { label: "x".repeat(121) }]
  ])("từ chối: %s", (_name, over) => {
    expect(parseBonusRuleInput({ ...ok, ...over }).ok).toBe(false);
  });

  it("biên điểm 1 và 100 nhận được", () => {
    expect(parseBonusRuleInput({ ...ok, points: "1" }).ok).toBe(true);
    expect(parseBonusRuleInput({ ...ok, points: "100" }).ok).toBe(true);
  });
});

describe("6. lời hiển thị, thứ tự, đếm", () => {
  it("mô tả khoảng ngày", () => {
    expect(describeBonusWindow({ startsOn: "2026-09-01", endsOn: "2026-09-10" })).toBe("Nộp từ 01/09/2026 đến hết 10/09/2026");
    expect(describeBonusWindow({ startsOn: null, endsOn: "2026-09-10" })).toBe("Nộp đến hết 10/09/2026");
    expect(describeBonusWindow({ startsOn: "2026-09-11", endsOn: null })).toBe("Nộp từ 11/09/2026 trở đi");
    expect(describeBonusWindow({ startsOn: "2026-09-11", endsOn: "2026-09-11" })).toBe("Nộp trong ngày 11/09/2026");
  });

  it("sắp xếp: không có đầu đứng trước, rồi theo ngày bắt đầu", () => {
    const sorted = sortBonusRules([
      rule({ id: "c", startsOn: "2026-09-11" }),
      rule({ id: "a", endsOn: "2026-09-10" }),
      rule({ id: "b", startsOn: "2026-09-05", endsOn: "2026-09-08" })
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("đếm mỗi đơn một lần, ở mốc thắng", () => {
    const early = rule({ id: "a", endsOn: "2026-09-10", points: 5 });
    const late = rule({ id: "b", endsOn: "2026-09-15", points: 3 });
    const coverage = summarizeBonusCoverage(
      [early, late],
      ["2026-09-09T03:00:00Z", "2026-09-12T03:00:00Z", "2026-09-20T03:00:00Z", "2026-09-10T17:30:00Z"]
    );
    expect(coverage).toEqual({ total: 4, withBonus: 3, byRule: { a: 1, b: 2 } });
  });

  it("khoá gom mốc theo đợt tuyển và vai trò", () => {
    expect(bonusTargetKey(" batch-1 ", "mentee")).toBe("batch-1:mentee");
  });
});

describe("7. dòng database", () => {
  it("dòng đúng hình dạng", () => {
    expect(
      bonusRuleFromRow({ id: "r9", label: " Sớm ", starts_on: null, ends_on: "2026-09-10", points: 3 })
    ).toEqual({ id: "r9", label: "Sớm", startsOn: null, endsOn: "2026-09-10", points: 3 });
  });

  it.each([
    ["không id", { id: "", ends_on: "2026-09-10", points: 3 }],
    ["không ngày", { id: "r", points: 3 }],
    ["điểm 0", { id: "r", ends_on: "2026-09-10", points: 0 }],
    ["điểm lẻ", { id: "r", ends_on: "2026-09-10", points: 2.5 }],
    ["ngày sai dạng", { id: "r", ends_on: "10/09/2026", points: 3 }]
  ])("dòng hỏng bị bỏ: %s", (_name, row) => {
    expect(bonusRuleFromRow(row)).toBeNull();
  });
});

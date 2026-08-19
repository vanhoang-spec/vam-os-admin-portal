import { describe, expect, it } from "vitest";

import { matchesMentorQuery, mentorSearchHaystack, normalizeSearchText } from "@/lib/renewal-search";

/**
 * M075 — the searchable mentor picker.
 *
 * The console holds roughly 500 mentors and the operator finds one by typing.
 * These tests pin the three fields the brief names — full name, mentor code and
 * email — plus the two forgiveness behaviours that decide whether the box is
 * usable in practice: diacritic folding for Vietnamese names, and punctuation
 * folding so "VM-002" and "VM002" are the same query.
 */

const VM001 = {
  fullName: "Validation Mentor 01",
  mentorCode: "VM-001",
  email: "mentor01@example.com"
};
const VM002 = {
  fullName: "Validation Mentor 02",
  mentorCode: "VM-002",
  email: "mentor02@example.com"
};
const VIETNAMESE = {
  fullName: "Nguyễn Đức Thắng",
  mentorCode: "UEHM-S9-114",
  email: "thang.nguyen@example.com"
};
const NO_CODE = { fullName: "Trần Bảo Ngọc", mentorCode: null, email: null };

describe("M075 normalizeSearchText", () => {
  it("strips Vietnamese tone and vowel marks", () => {
    expect(normalizeSearchText("Nguyễn Đức Thắng")).toBe("nguyen duc thang");
  });

  it("folds d-with-stroke, which NFD does not decompose", () => {
    expect(normalizeSearchText("Đà Nẵng")).toBe("da nang");
  });

  it("folds punctuation to separators so codes compare structurally", () => {
    expect(normalizeSearchText("VM-002")).toBe("vm 002");
    expect(normalizeSearchText("mentor02@example.com")).toBe("mentor02 example com");
  });

  it("returns an empty string for non-string input rather than throwing", () => {
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
    expect(normalizeSearchText(42)).toBe("");
  });
});

describe("M075 mentorSearchHaystack", () => {
  it("covers name, code and email in one searchable string", () => {
    const hay = mentorSearchHaystack(VM002);
    expect(hay).toContain("validation mentor 02");
    expect(hay).toContain("vm 002");
    expect(hay).toContain("mentor02");
  });

  it("includes an un-separated code form so 'vm002' matches 'VM-002'", () => {
    expect(mentorSearchHaystack(VM002)).toContain("vm002");
  });

  it("tolerates a mentor with no code and no email", () => {
    expect(mentorSearchHaystack(NO_CODE)).toBe("tran bao ngoc");
  });
});

describe("M075 search by name", () => {
  it("matches a partial name, case-insensitively", () => {
    expect(matchesMentorQuery(VM001, "Validation")).toBe(true);
    expect(matchesMentorQuery(VM001, "validation")).toBe(true);
    expect(matchesMentorQuery(VM001, "VALIDATION")).toBe(true);
  });

  it("matches a mid-word fragment", () => {
    expect(matchesMentorQuery(VM001, "lidat")).toBe(true);
  });

  it("matches a Vietnamese name typed without diacritics", () => {
    expect(matchesMentorQuery(VIETNAMESE, "nguyen duc thang")).toBe(true);
    expect(matchesMentorQuery(VIETNAMESE, "duc")).toBe(true);
  });

  it("matches a Vietnamese name typed WITH diacritics", () => {
    expect(matchesMentorQuery(VIETNAMESE, "Nguyễn")).toBe(true);
  });

  it("requires every token, so a second word narrows rather than widens", () => {
    expect(matchesMentorQuery(VM001, "validation 01")).toBe(true);
    expect(matchesMentorQuery(VM001, "validation 02")).toBe(false);
  });

  it("ignores token order", () => {
    expect(matchesMentorQuery(VM001, "01 validation")).toBe(true);
  });
});

describe("M075 search by mentor code", () => {
  it("matches the exact code", () => {
    expect(matchesMentorQuery(VM002, "VM-002")).toBe(true);
  });

  it("matches the code without its separator", () => {
    expect(matchesMentorQuery(VM002, "vm002")).toBe(true);
  });

  it("matches a code fragment", () => {
    expect(matchesMentorQuery(VIETNAMESE, "S9")).toBe(true);
  });

  it("does not match a different mentor's code", () => {
    expect(matchesMentorQuery(VM002, "VM-001")).toBe(false);
  });
});

describe("M075 search by email", () => {
  it("matches a partial email including the @", () => {
    expect(matchesMentorQuery(VM002, "mentor02@")).toBe(true);
  });

  it("matches the local part alone", () => {
    expect(matchesMentorQuery(VM002, "mentor02")).toBe(true);
  });

  it("matches the domain", () => {
    expect(matchesMentorQuery(VM002, "example.com")).toBe(true);
  });

  it("does not match a different mentor's email", () => {
    expect(matchesMentorQuery(VM002, "mentor01@")).toBe(false);
  });
});

describe("M075 no-result and empty states", () => {
  it("returns false for a query that matches nothing", () => {
    expect(matchesMentorQuery(VM001, "zzz-not-a-mentor")).toBe(false);
  });

  it("filters an entire roster down to nothing when nothing matches", () => {
    const roster = [VM001, VM002, VIETNAMESE, NO_CODE];
    expect(roster.filter((m) => matchesMentorQuery(m, "khong-ton-tai"))).toHaveLength(0);
  });

  it("treats an empty or whitespace query as 'show everything'", () => {
    const roster = [VM001, VM002, VIETNAMESE, NO_CODE];
    expect(roster.filter((m) => matchesMentorQuery(m, ""))).toHaveLength(4);
    expect(roster.filter((m) => matchesMentorQuery(m, "   "))).toHaveLength(4);
  });

  it("narrows a roster to exactly one mentor for a distinguishing query", () => {
    const roster = [VM001, VM002, VIETNAMESE, NO_CODE];
    expect(roster.filter((m) => matchesMentorQuery(m, "VM-002"))).toEqual([VM002]);
    expect(roster.filter((m) => matchesMentorQuery(m, "mentor01@"))).toEqual([VM001]);
    expect(roster.filter((m) => matchesMentorQuery(m, "thang"))).toEqual([VIETNAMESE]);
  });

  it("does not throw on a mentor whose fields are all null", () => {
    expect(matchesMentorQuery({ fullName: null, mentorCode: null, email: null }, "x")).toBe(false);
  });
});

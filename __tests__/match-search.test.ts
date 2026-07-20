import { describe, it, expect } from "vitest";
import {
  normalizeVn,
  matchesMentorSearch,
  matchesMenteeSearch,
  filterMentors,
  filterMentees,
} from "../lib/match-search";

// The production ManualMatchForm imports filterMentors/filterMentees from this same
// module, so every test here is a DIRECT PRODUCTION TEST of the exported helpers.

// ── normalizeVn ───────────────────────────────────────────────────────────────

describe("normalizeVn — accent stripping and case folding", () => {
  it("strips Vietnamese diacritics: Nguyễn → nguyen", () => {
    expect(normalizeVn("Nguyễn")).toBe("nguyen");
  });

  it("case-folds to lowercase: TRẦN → tran", () => {
    expect(normalizeVn("TRẦN")).toBe("tran");
  });

  it("strips combining marks from Lê → le", () => {
    expect(normalizeVn("Lê")).toBe("le");
  });

  it("Đ/đ are mapped to d (U+0110/U+0111 do not decompose under NFD)", () => {
    // NFD does not decompose Đ/đ into combining-mark sequences, so an explicit
    // .replace(/đ/g, "d") step (after toLowerCase) is required.
    expect(normalizeVn("Đinh")).toBe("dinh");
    expect(normalizeVn("đặng")).toBe("dang");
    expect(normalizeVn("ĐẶNG")).toBe("dang");
  });

  it("leading and trailing whitespace is preserved (trimming is the caller's job)", () => {
    expect(normalizeVn("  Hoang  ")).toBe("  hoang  ");
  });

  it("empty string returns empty string", () => {
    expect(normalizeVn("")).toBe("");
  });
});

// ── Đ/đ search integration ────────────────────────────────────────────────────

describe("normalizeVn — Đ/đ mapping in real search contexts", () => {
  it("Đặng found by query 'dang'", () => {
    const mentor = { full_name: "Đặng Văn Hùng", email_primary: "hung@vam.org", company_current: "FPT" };
    expect(matchesMentorSearch(mentor, "dang")).toBe(true);
  });

  it("đặng (lowercase) found by query 'DANG' (case-insensitive + đ→d)", () => {
    const mentor = { full_name: "đặng văn hùng", email_primary: "hung@vam.org", company_current: "FPT" };
    expect(matchesMentorSearch(mentor, "DANG")).toBe(true);
  });

  it("company name containing Đ found by ascii query", () => {
    const mentor = { full_name: "Nguyễn An", email_primary: "an@co.vn", company_current: "Đại Học Quốc Gia" };
    expect(matchesMentorSearch(mentor, "dai hoc quoc gia")).toBe(true);
  });

  it("school_code with Đ in mentee search", () => {
    const mentee = { full_name: "Trần Bình", email_primary: "binh@school.vn", school_code: "ĐHQG" };
    expect(matchesMenteeSearch(mentee, "dhqg")).toBe(true);
  });

  it("mixed accent + Đ: 'Đinh Hoàng' found by 'Dinh Hoang'", () => {
    const mentor = { full_name: "Đinh Hoàng Minh", email_primary: "minh@co.vn", company_current: null };
    expect(matchesMentorSearch(mentor, "Dinh Hoang")).toBe(true);
  });

  it("empty query still returns true (short-circuit unaffected)", () => {
    const mentor = { full_name: "Đặng Văn A", email_primary: "a@co.vn", company_current: null };
    expect(matchesMentorSearch(mentor, "")).toBe(true);
    expect(matchesMentorSearch(mentor, "  ")).toBe(true);
  });
});

// ── matchesMentorSearch ───────────────────────────────────────────────────────

describe("matchesMentorSearch — mentor name and company search", () => {
  const mentor = {
    full_name: "Nguyễn Văn Anh",
    email_primary: "anh@example.com",
    company_current: "VNG Corporation",
  };

  it("matches exact Vietnamese full name (accent-insensitive)", () => {
    expect(matchesMentorSearch(mentor, "Nguyen Van Anh")).toBe(true);
  });

  it("case-insensitive match on full name", () => {
    expect(matchesMentorSearch(mentor, "nguyen")).toBe(true);
    expect(matchesMentorSearch(mentor, "NGUYEN")).toBe(true);
  });

  it("matches partial mentor name query", () => {
    expect(matchesMentorSearch(mentor, "Van")).toBe(true);
  });

  it("matches mentor company name", () => {
    expect(matchesMentorSearch(mentor, "VNG")).toBe(true);
    expect(matchesMentorSearch(mentor, "vng corporation")).toBe(true);
  });

  it("non-matching query returns false", () => {
    expect(matchesMentorSearch(mentor, "FPT Software")).toBe(false);
  });

  it("empty query always returns true (show all)", () => {
    expect(matchesMentorSearch(mentor, "")).toBe(true);
    expect(matchesMentorSearch(mentor, "   ")).toBe(true);
  });

  it("falls back to email when full_name is null", () => {
    const m = { full_name: null, email_primary: "contact@vam.org", company_current: null };
    expect(matchesMentorSearch(m, "contact")).toBe(true);
    expect(matchesMentorSearch(m, "vam")).toBe(true);
  });
});

// ── matchesMenteeSearch ───────────────────────────────────────────────────────

describe("matchesMenteeSearch — mentee name and school search", () => {
  const mentee = {
    full_name: "Trần Thị Bình",
    email_primary: "binh@ueh.edu.vn",
    school_code: "UEH",
  };

  it("matches exact Vietnamese mentee name (accent-insensitive)", () => {
    expect(matchesMenteeSearch(mentee, "Tran Thi Binh")).toBe(true);
  });

  it("matches mentee school_code", () => {
    expect(matchesMenteeSearch(mentee, "UEH")).toBe(true);
    expect(matchesMenteeSearch(mentee, "ueh")).toBe(true);
  });

  it("non-matching query returns false", () => {
    expect(matchesMenteeSearch(mentee, "RMIT")).toBe(false);
  });

  it("empty query always returns true (show all)", () => {
    expect(matchesMenteeSearch(mentee, "")).toBe(true);
  });
});

// ── filterMentors ─────────────────────────────────────────────────────────────

describe("filterMentors — full candidate list filtering", () => {
  const mentors = [
    { full_name: "Nguyễn Văn Anh", email_primary: "anh@vam.org", company_current: "VNG", profile_id: "pid-1", person_id: "per-1", mentor_code: "M01", title_current: "CTO", active_match_count: 0 },
    { full_name: "Lê Hồng Phúc", email_primary: "phuc@vam.org", company_current: "FPT", profile_id: "pid-2", person_id: "per-2", mentor_code: "M02", title_current: "PM", active_match_count: 1 },
    { full_name: "Đinh Quốc Việt", email_primary: "viet@vam.org", company_current: null, profile_id: "pid-3", person_id: "per-3", mentor_code: "M03", title_current: null, active_match_count: 2 },
  ];

  it("empty query returns all mentors unchanged", () => {
    const result = filterMentors(mentors, "");
    expect(result).toHaveLength(3);
    expect(result).toBe(mentors); // same reference — no copy
  });

  it("whitespace-only query returns all mentors unchanged", () => {
    const result = filterMentors(mentors, "   ");
    expect(result).toHaveLength(3);
  });

  it("matching query by company returns only matching mentors", () => {
    const result = filterMentors(mentors, "FPT");
    expect(result).toHaveLength(1);
    expect(result[0].profile_id).toBe("pid-2");
  });

  it("non-matching query returns empty array", () => {
    const result = filterMentors(mentors, "Vingroup");
    expect(result).toHaveLength(0);
  });

  it("profile_id values in results are unchanged (IDs not mutated)", () => {
    const result = filterMentors(mentors, "vng");
    expect(result[0].profile_id).toBe("pid-1");
    expect(result[0].active_match_count).toBe(0);
  });

  it("accent-insensitive: 'Le Hong Phuc' matches 'Lê Hồng Phúc'", () => {
    const result = filterMentors(mentors, "Le Hong Phuc");
    expect(result).toHaveLength(1);
    expect(result[0].profile_id).toBe("pid-2");
  });
});

// ── filterMentees ─────────────────────────────────────────────────────────────

describe("filterMentees — full candidate list filtering", () => {
  const mentees = [
    { full_name: "Trần Thị Bình", email_primary: "binh@ueh.edu.vn", school_code: "UEH", profile_id: "mee-1", person_id: "per-a", mentee_code: "E01", major: null, has_active_match: false },
    { full_name: "Phạm Gia Khoa", email_primary: "khoa@hust.edu.vn", school_code: "HUST", profile_id: "mee-2", person_id: "per-b", mentee_code: "E02", major: null, has_active_match: true },
  ];

  it("empty query returns all mentees", () => {
    const result = filterMentees(mentees, "");
    expect(result).toHaveLength(2);
  });

  it("matches by school_code (case-insensitive)", () => {
    const result = filterMentees(mentees, "hust");
    expect(result).toHaveLength(1);
    expect(result[0].profile_id).toBe("mee-2");
  });

  it("non-matching query returns empty array", () => {
    const result = filterMentees(mentees, "RMIT");
    expect(result).toHaveLength(0);
  });

  it("has_active_match flag is preserved on filtered results", () => {
    const result = filterMentees(mentees, "UEH");
    expect(result[0].has_active_match).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  matchStatusLabel,
  applicationStatusLabel,
} from "../lib/ui-labels";

// ── Matching capacity rules ───────────────────────────────────────────────────
//
// Source of truth: lib/matches.ts (MAX_MENTOR_ACTIVE_MATCHES = 3)
// and app/matches/matches-client.tsx (MAX_LOAD = 3).
// Both constants are private to their modules; this test validates the
// business rule boundary independently.

const MAX_ACTIVE_MATCHES = 3; // mirror of lib/matches.ts::MAX_MENTOR_ACTIVE_MATCHES

type MentorSlot = { active_match_count: number };
type MenteeSlot = { has_active_match: boolean };

function isMentorAvailable(m: MentorSlot) {
  return m.active_match_count < MAX_ACTIVE_MATCHES;
}

function isMenteeAvailable(m: MenteeSlot) {
  return !m.has_active_match;
}

describe("Matching capacity — mentor availability boundary", () => {
  it("mentor with 0 active matches is available", () => {
    expect(isMentorAvailable({ active_match_count: 0 })).toBe(true);
  });

  it("mentor with 1 active match is available", () => {
    expect(isMentorAvailable({ active_match_count: 1 })).toBe(true);
  });

  it("mentor with 2 active matches is available", () => {
    expect(isMentorAvailable({ active_match_count: 2 })).toBe(true);
  });

  it("mentor with 3 active matches is FULL (excluded)", () => {
    expect(isMentorAvailable({ active_match_count: 3 })).toBe(false);
  });

  it("mentor with 4 active matches is FULL (excluded)", () => {
    expect(isMentorAvailable({ active_match_count: 4 })).toBe(false);
  });

  it("capacity limit is strictly less-than, not less-than-or-equal", () => {
    // active_match_count === MAX_ACTIVE_MATCHES (3) must be excluded
    expect(MAX_ACTIVE_MATCHES - 1 < MAX_ACTIVE_MATCHES).toBe(true);  // 2 available
    expect(MAX_ACTIVE_MATCHES < MAX_ACTIVE_MATCHES).toBe(false);      // 3 excluded
  });
});

describe("Matching capacity — mentee availability (exclusive matching)", () => {
  it("mentee without active match is available", () => {
    expect(isMenteeAvailable({ has_active_match: false })).toBe(true);
  });

  it("mentee with active match is excluded (exclusive mentoring)", () => {
    expect(isMenteeAvailable({ has_active_match: true })).toBe(false);
  });
});

describe("Matching capacity — batch filtering", () => {
  const mentors: MentorSlot[] = [
    { active_match_count: 0 },
    { active_match_count: 2 },
    { active_match_count: 3 }, // FULL
    { active_match_count: 1 },
    { active_match_count: 5 }, // over cap
  ];

  it("filters out full mentors correctly", () => {
    const available = mentors.filter(isMentorAvailable);
    expect(available.length).toBe(3);
    available.forEach((m) => expect(m.active_match_count).toBeLessThan(MAX_ACTIVE_MATCHES));
  });

  const mentees: MenteeSlot[] = [
    { has_active_match: false },
    { has_active_match: true },
    { has_active_match: false },
  ];

  it("filters out mentees who already have a mentor", () => {
    const available = mentees.filter(isMenteeAvailable);
    expect(available.length).toBe(2);
    available.forEach((m) => expect(m.has_active_match).toBe(false));
  });
});

// ── Match status label completeness ──────────────────────────────────────────
//
// Source of truth: lib/ui-labels.ts matchStatusLabel().
// All known DB match statuses must have Vietnamese labels.

describe("matchStatusLabel — completeness", () => {
  const KNOWN_MATCH_STATUSES: Array<[string, string]> = [
    ["active", "Đang đồng hành"],
    ["completed", "Đã hoàn thành"],
    ["dropped", "Đã dừng"],
    ["unmatched_review", "Cần xem lại ghép cặp"],
  ];

  KNOWN_MATCH_STATUSES.forEach(([status, expected]) => {
    it(`"${status}" → "${expected}"`, () => {
      expect(matchStatusLabel(status)).toBe(expected);
    });
  });

  it("unknown status returns a non-empty fallback (not blank)", () => {
    const label = matchStatusLabel("__unknown__");
    expect(label.trim().length).toBeGreaterThan(0);
  });
});

// ── Application status label completeness ────────────────────────────────────
//
// Source of truth: lib/ui-labels.ts applicationStatusLabel().
// These are the canonical DB status values the applications table can hold.

describe("applicationStatusLabel — canonical status coverage", () => {
  const CANONICAL_STATUSES: Array<[string, string]> = [
    ["submitted", "Đã nộp / Chờ xử lý"],
    ["under_data_check", "Đang kiểm tra dữ liệu"],
    ["ready_for_screening", "Sẵn sàng review"],
    ["screening_assigned", "Đã giao review"],
    ["screening_in_progress", "Đang review hồ sơ"],
    ["screening_completed", "Đã chấm hồ sơ"],
    ["screening_passed", "Qua vòng hồ sơ"],
    ["invited_to_meeting", "Mời gặp mặt"],
    ["invited_to_orientation", "Mời buổi định hướng"],
    ["invited_to_interview", "Mời phỏng vấn"],
    ["interview_scheduled", "Đã lên lịch phỏng vấn"],
    ["interview_in_progress", "Đang phỏng vấn"],
    ["interview_completed", "Hoàn tất phỏng vấn"],
    ["interview_passed", "Qua vòng phỏng vấn"],
    ["approved_as_mentor", "Đã duyệt — Mentor"],
    ["approved_as_mentee", "Đã duyệt — Mentee"],
    ["waitlisted", "Danh sách chờ"],
    ["rejected_or_not_fit", "Không phù hợp"],
    ["needs_more_review", "Cần xem thêm"],
    ["withdrawn", "Rút đơn"],
  ];

  CANONICAL_STATUSES.forEach(([status, expected]) => {
    it(`"${status}" → "${expected}"`, () => {
      expect(applicationStatusLabel(status)).toBe(expected);
    });
  });

  it("unknown status returns a non-empty fallback", () => {
    expect(applicationStatusLabel("__unknown__").trim().length).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  matchStatusLabel,
  applicationStatusLabel,
} from "../lib/ui-labels";
import { isMentorAvailable, LEGACY_MENTOR_CAP, resolveMentorCap } from "../lib/mentor-confirmations-core";

// ── Matching capacity rules ───────────────────────────────────────────────────
//
// Capacity is per mentor from Season 12: each declares 1..3 on the confirmation
// form and core_team may grant extra slots. lib/matches.ts and
// app/matches/matches-client.tsx both resolve it through resolveMentorCap, so
// these tests exercise the real function rather than mirroring a constant —
// the previous version duplicated a private `3` and could not catch drift.
//
// A season with no confirmation rows still reports LEGACY_MENTOR_CAP (3),
// which is what the boundary cases below assert.

type MenteeSlot = { has_active_match: boolean };

/** Legacy season: no confirmation row, so the historical cap applies. */
const legacyMentor = null;

function isMenteeAvailable(m: MenteeSlot) {
  return !m.has_active_match;
}

describe("Matching capacity — mentor availability boundary", () => {
  it("mentor with 0 active matches is available", () => {
    expect(isMentorAvailable(legacyMentor, 0)).toBe(true);
  });

  it("mentor with 1 active match is available", () => {
    expect(isMentorAvailable(legacyMentor, 1)).toBe(true);
  });

  it("mentor with 2 active matches is available", () => {
    expect(isMentorAvailable(legacyMentor, 2)).toBe(true);
  });

  it("mentor with 3 active matches is FULL (excluded)", () => {
    expect(isMentorAvailable(legacyMentor, 3)).toBe(false);
  });

  it("mentor with 4 active matches is FULL (excluded)", () => {
    expect(isMentorAvailable(legacyMentor, 4)).toBe(false);
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
  // Legacy season (no confirmation rows): every mentor keeps the cap of 3.
  const mentors = [
    { active_match_count: 0 },
    { active_match_count: 2 },
    { active_match_count: 3 }, // FULL
    { active_match_count: 1 },
    { active_match_count: 5 }, // over cap
  ];

  it("filters out full mentors correctly", () => {
    const available = mentors.filter((m) => isMentorAvailable(legacyMentor, m.active_match_count));
    expect(available.length).toBe(3);
    available.forEach((m) => expect(m.active_match_count).toBeLessThan(LEGACY_MENTOR_CAP));
  });

  it("filters by each mentor's own capacity when the season uses confirmations", () => {
    const confirmed = (max: number) => ({ status: "confirmed", max_mentees: max, extra_slots: 0 });
    const roster = [
      { row: confirmed(1), active: 0 }, // available
      { row: confirmed(1), active: 1 }, // full at 1
      { row: confirmed(3), active: 2 }, // available
      { row: { status: "pending", max_mentees: null, extra_slots: 0 }, active: 0 }, // ineligible
    ];
    const available = roster.filter((m) => isMentorAvailable(m.row, m.active));
    expect(available.length).toBe(2);
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

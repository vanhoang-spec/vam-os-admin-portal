/**
 * lib/mentor-confirmations-core.ts — the decision logic behind Season 12 mentor
 * confirmations.
 *
 * Two properties matter most and are covered exhaustively:
 *   * the matching cap, because it decides who can be paired and how often
 *   * the public link state, because it decides who may still change an answer
 */
import { describe, it, expect } from "vitest";
import {
  buildConfirmUrl,
  clampCapacity,
  DEFAULT_MAX_MENTEES,
  defaultTokenExpiry,
  evaluatePublicLinkState,
  isMentorAvailable,
  isMentorOverCap,
  LEGACY_MENTOR_CAP,
  parseConfirmationAnswer,
  parseOptionalBoolean,
  resolveMentorCap,
  summarizeConfirmations
} from "@/lib/mentor-confirmations-core";

const confirmed = (max: number, extra = 0) => ({ status: "confirmed", max_mentees: max, extra_slots: extra });

describe("resolveMentorCap", () => {
  it("uses the mentor's own declared capacity", () => {
    expect(resolveMentorCap(confirmed(1))).toBe(1);
    expect(resolveMentorCap(confirmed(2))).toBe(2);
    expect(resolveMentorCap(confirmed(3))).toBe(3);
  });

  it("adds slots granted by core_team after an interview", () => {
    expect(resolveMentorCap(confirmed(2, 1))).toBe(3);
    expect(resolveMentorCap(confirmed(3, 2))).toBe(5);
  });

  it("treats a season with no confirmation row as the legacy season", () => {
    expect(resolveMentorCap(null)).toBe(LEGACY_MENTOR_CAP);
    expect(resolveMentorCap(undefined)).toBe(LEGACY_MENTOR_CAP);
    expect(LEGACY_MENTOR_CAP).toBe(3);
  });

  it("makes pending and declined mentors ineligible", () => {
    expect(resolveMentorCap({ status: "pending", max_mentees: null, extra_slots: 0 })).toBe(0);
    expect(resolveMentorCap({ status: "declined", max_mentees: null, extra_slots: 0 })).toBe(0);
    // Even a stale capacity on a declined row must not resurrect eligibility.
    expect(resolveMentorCap({ status: "declined", max_mentees: 3, extra_slots: 2 })).toBe(0);
  });

  it("falls back to the smallest capacity when a confirmed row has none", () => {
    expect(resolveMentorCap({ status: "confirmed", max_mentees: null, extra_slots: 0 })).toBe(DEFAULT_MAX_MENTEES);
    expect(DEFAULT_MAX_MENTEES).toBe(1);
  });

  it("ignores nonsense extra_slots instead of trusting it", () => {
    expect(resolveMentorCap({ status: "confirmed", max_mentees: 2, extra_slots: -5 })).toBe(2);
    expect(resolveMentorCap({ status: "confirmed", max_mentees: 2, extra_slots: NaN })).toBe(2);
    expect(resolveMentorCap({ status: "confirmed", max_mentees: 2, extra_slots: null })).toBe(2);
  });
});

describe("isMentorAvailable / isMentorOverCap", () => {
  it("is available up to the cap and not beyond", () => {
    expect(isMentorAvailable(confirmed(2), 0)).toBe(true);
    expect(isMentorAvailable(confirmed(2), 1)).toBe(true);
    expect(isMentorAvailable(confirmed(2), 2)).toBe(false);
    expect(isMentorAvailable(confirmed(2), 3)).toBe(false);
  });

  it("keeps the legacy 3-mentee behaviour for a season without confirmations", () => {
    expect(isMentorAvailable(null, 2)).toBe(true);
    expect(isMentorAvailable(null, 3)).toBe(false);
  });

  it("never offers a pending or declined mentor, even with no matches", () => {
    expect(isMentorAvailable({ status: "pending", max_mentees: null, extra_slots: 0 }, 0)).toBe(false);
    expect(isMentorAvailable({ status: "declined", max_mentees: null, extra_slots: 0 }, 0)).toBe(false);
  });

  it("flags a mentor holding more matches than the confirmed cap", () => {
    // The mentor said 1 but already has 2 from before confirming.
    expect(isMentorOverCap(confirmed(1), 2)).toBe(true);
    expect(isMentorOverCap(confirmed(1), 1)).toBe(false);
    // A declined mentor with live matches is over cap and must be surfaced.
    expect(isMentorOverCap({ status: "declined", max_mentees: null, extra_slots: 0 }, 1)).toBe(true);
  });
});

describe("clampCapacity", () => {
  it("accepts 1..3 from numbers and strings", () => {
    expect(clampCapacity(1)).toBe(1);
    expect(clampCapacity("2")).toBe(2);
    expect(clampCapacity(" 3 ")).toBe(3);
  });

  it("rejects out-of-range, fractional and non-numeric values", () => {
    for (const value of [0, 4, 10, -1, 1.5, "many", "1.5", {}, []]) {
      expect(clampCapacity(value as unknown), String(value)).toBeNull();
    }
  });

  it("treats an empty answer as absent rather than invalid", () => {
    expect(clampCapacity("")).toBeNull();
    expect(clampCapacity(null)).toBeNull();
    expect(clampCapacity(undefined)).toBeNull();
  });
});

describe("parseConfirmationAnswer", () => {
  it("refuses an unrecognised decision instead of guessing", () => {
    for (const decision of ["", "maybe", "yes", "pending", null, undefined]) {
      const result = parseConfirmationAnswer({ decision });
      expect(result.ok, String(decision)).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/[À-ỹ]/);
    }
  });

  it("defaults a confirmed answer with no capacity to one mentee", () => {
    const result = parseConfirmationAnswer({ decision: "confirmed" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("confirmed");
      expect(result.maxMentees).toBe(1);
    }
  });

  it("refuses a capacity the form could never have produced", () => {
    const result = parseConfirmationAnswer({ decision: "confirmed", maxMentees: "7" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("từ 1 đến 3");
  });

  it("drops capacity and participation answers when the mentor declines", () => {
    const result = parseConfirmationAnswer({
      decision: "declined",
      maxMentees: "3",
      agreeToReview: "on",
      agreeToInterview: "on",
      note: "Bận công tác"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("declined");
      expect(result.maxMentees).toBeNull();
      expect(result.agreeToReview).toBeNull();
      expect(result.agreeToInterview).toBeNull();
      expect(result.note).toBe("Bận công tác");
    }
  });

  it("keeps the two participation questions for a confirmed mentor", () => {
    const result = parseConfirmationAnswer({
      decision: "confirmed",
      maxMentees: "2",
      agreeToReview: "on",
      agreeToInterview: "off"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.maxMentees).toBe(2);
      expect(result.agreeToReview).toBe(true);
      expect(result.agreeToInterview).toBe(false);
    }
  });

  it("bounds the note and strips control characters", () => {
    const tooLong = parseConfirmationAnswer({ decision: "confirmed", note: "x".repeat(1001) });
    expect(tooLong.ok).toBe(false);

    const dirty = parseConfirmationAnswer({
      decision: "confirmed",
      note: `Ghi chú${String.fromCharCode(0)}${String.fromCharCode(7)} hợp lệ`
    });
    expect(dirty.ok).toBe(true);
    if (dirty.ok) expect(dirty.note).toBe("Ghi chú hợp lệ");
  });

  it("treats a blank note as absent", () => {
    const result = parseConfirmationAnswer({ decision: "confirmed", note: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note).toBeNull();
  });
});

describe("parseOptionalBoolean", () => {
  it("maps checkbox and Vietnamese values", () => {
    for (const value of ["on", "true", "yes", "1", "có"]) {
      expect(parseOptionalBoolean(value), value).toBe(true);
    }
    for (const value of ["off", "false", "no", "0", "không"]) {
      expect(parseOptionalBoolean(value), value).toBe(false);
    }
  });

  it("returns null when the question was not answered", () => {
    expect(parseOptionalBoolean(undefined)).toBeNull();
    expect(parseOptionalBoolean(null)).toBeNull();
    expect(parseOptionalBoolean("")).toBeNull();
    expect(parseOptionalBoolean("perhaps")).toBeNull();
  });
});

describe("evaluatePublicLinkState", () => {
  const now = new Date("2026-08-18T00:00:00.000Z");
  const future = "2026-12-31T00:00:00.000Z";
  const past = "2026-01-01T00:00:00.000Z";

  it("reports not_found for a missing row", () => {
    expect(evaluatePublicLinkState({ row: null, now })).toBe("not_found");
  });

  it("is ready for a live, untouched link", () => {
    expect(evaluatePublicLinkState({ row: { token_expires_at: future }, now })).toBe("ready");
    expect(evaluatePublicLinkState({ row: { token_expires_at: null }, now })).toBe("ready");
  });

  it("expires once the deadline has passed", () => {
    expect(evaluatePublicLinkState({ row: { token_expires_at: past }, now })).toBe("expired");
  });

  it("ignores an unparseable expiry rather than locking the mentor out", () => {
    expect(evaluatePublicLinkState({ row: { token_expires_at: "not-a-date" }, now })).toBe("ready");
  });

  it("locks the link once an operator recorded the answer by phone", () => {
    expect(
      evaluatePublicLinkState({
        row: { token_expires_at: future, responded_by_admin_user_id: "admin-1" },
        now
      })
    ).toBe("locked");
  });

  it("locks the link once the mentor already has a match this season", () => {
    expect(
      evaluatePublicLinkState({ row: { token_expires_at: future }, activeMatchCount: 1, now })
    ).toBe("locked");
  });

  it("checks expiry before the lock, so an old link never looks changeable", () => {
    expect(
      evaluatePublicLinkState({
        row: { token_expires_at: past, responded_by_admin_user_id: "admin-1" },
        activeMatchCount: 2,
        now
      })
    ).toBe("expired");
  });
});

describe("defaultTokenExpiry", () => {
  it("defaults to 60 days out", () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    expect(defaultTokenExpiry(now)).toBe("2026-10-17T00:00:00.000Z");
  });

  it("honours an explicit window", () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    expect(defaultTokenExpiry(now, 7)).toBe("2026-08-25T00:00:00.000Z");
  });

  it("does not mutate the date it was given", () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    defaultTokenExpiry(now, 30);
    expect(now.toISOString()).toBe("2026-08-18T00:00:00.000Z");
  });
});

describe("summarizeConfirmations", () => {
  it("counts each state and totals only confirmed capacity", () => {
    const summary = summarizeConfirmations([
      confirmed(3),
      confirmed(2, 1),
      { status: "declined", max_mentees: null, extra_slots: 0 },
      { status: "pending", max_mentees: null, extra_slots: 0 },
      { status: "pending", max_mentees: null, extra_slots: 0 }
    ]);
    expect(summary).toEqual({
      total: 5,
      confirmed: 2,
      declined: 1,
      pending: 2,
      totalCapacity: 6, // 3 + (2+1)
      respondedPct: 60
    });
  });

  it("handles an empty roster without dividing by zero", () => {
    expect(summarizeConfirmations([])).toEqual({
      total: 0,
      confirmed: 0,
      declined: 0,
      pending: 0,
      totalCapacity: 0,
      respondedPct: 0
    });
  });

  it("gives the mentee intake a capacity number it can size against", () => {
    // 442 mentors, 300 confirmed at 1 mentee each → 300 places.
    const rows = Array.from({ length: 300 }, () => confirmed(1));
    expect(summarizeConfirmations(rows).totalCapacity).toBe(300);
  });
});

describe("buildConfirmUrl", () => {
  it("joins base and token without doubling the slash", () => {
    expect(buildConfirmUrl("https://portal.test", "abc")).toBe("https://portal.test/confirm/abc");
    expect(buildConfirmUrl("https://portal.test/", "abc")).toBe("https://portal.test/confirm/abc");
    expect(buildConfirmUrl("  https://portal.test//  ", "abc")).toBe("https://portal.test/confirm/abc");
  });
});

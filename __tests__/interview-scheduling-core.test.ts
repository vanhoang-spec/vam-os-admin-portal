/**
 * lib/interview-scheduling-core.ts — reading the operator's input and laying
 * out interview slots.
 *
 * The case that matters most is the time zone. A `datetime-local` field posts
 * "2026-08-25T14:30" with no zone; on a server running in UTC that is 21:30 in
 * Vietnam, and the candidate is told the wrong hour. Everything below pins the
 * rule that a bare wall-clock time is Vietnamese wall-clock time.
 */
import { describe, it, expect } from "vitest";
import {
  buildSlotTimes,
  DEFAULT_SLOT_MINUTES,
  formatInterviewTimeVi,
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODES,
  MAX_INTERVIEWS_PER_RUN,
  parseScheduleInput,
  toDateTimeLocalValue,
  toVietnamInstant
} from "@/lib/interview-scheduling-core";

const NOW = new Date("2026-08-18T03:00:00.000Z"); // 10:00 in Vietnam

describe("toVietnamInstant", () => {
  it("reads a bare wall-clock time as Vietnam time, not as UTC", () => {
    // 14:30 in Vietnam is 07:30 UTC.
    expect(toVietnamInstant("2026-08-25T14:30")).toBe("2026-08-25T07:30:00.000Z");
  });

  it("accepts seconds in the wall-clock form", () => {
    expect(toVietnamInstant("2026-08-25T14:30:00")).toBe("2026-08-25T07:30:00.000Z");
  });

  it("leaves a value that already states its zone alone", () => {
    expect(toVietnamInstant("2026-08-25T07:30:00.000Z")).toBe("2026-08-25T07:30:00.000Z");
    expect(toVietnamInstant("2026-08-25T14:30:00+07:00")).toBe("2026-08-25T07:30:00.000Z");
  });

  it("returns null for something that is not a time at all", () => {
    expect(toVietnamInstant("")).toBeNull();
    expect(toVietnamInstant("chiều thứ ba")).toBeNull();
  });
});

describe("parseScheduleInput", () => {
  it("accepts a plain booking and defaults the gap between slots", () => {
    const result = parseScheduleInput({ startAt: "2026-08-25T14:30", now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.startAtIso).toBe("2026-08-25T07:30:00.000Z");
    expect(result.slotMinutes).toBe(DEFAULT_SLOT_MINUTES);
    expect(result.mode).toBeNull();
    expect(result.location).toBeNull();
  });

  it("requires a start time", () => {
    const result = parseScheduleInput({ startAt: "  ", now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("thời gian bắt đầu");
  });

  it("refuses a time far in the past — that is a typo, not a booking", () => {
    const result = parseScheduleInput({ startAt: "2025-08-25T14:30", now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("quá khứ");
  });

  it("still allows today, so a schedule can be recorded during the day", () => {
    const result = parseScheduleInput({ startAt: "2026-08-18T09:00", now: NOW });
    expect(result.ok).toBe(true);
  });

  it("accepts both interview modes and refuses anything else", () => {
    for (const mode of INTERVIEW_MODES) {
      const ok = parseScheduleInput({ startAt: "2026-08-25T14:30", mode, now: NOW });
      expect(ok.ok).toBe(true);
      if (ok.ok) expect(ok.mode).toBe(mode);
    }
    const bad = parseScheduleInput({ startAt: "2026-08-25T14:30", mode: "hybrid", now: NOW });
    expect(bad.ok).toBe(false);
  });

  it("keeps the location on one line and bounded", () => {
    const result = parseScheduleInput({
      startAt: "2026-08-25T14:30",
      location: "  P.501\nToà nhà A\t ",
      now: NOW
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.location).toBe("P.501 Toà nhà A");

    const tooLong = parseScheduleInput({
      startAt: "2026-08-25T14:30",
      location: "x".repeat(301),
      now: NOW
    });
    expect(tooLong.ok).toBe(false);
  });

  it("bounds the gap between slots, and allows zero for a panel", () => {
    const panel = parseScheduleInput({ startAt: "2026-08-25T14:30", slotMinutes: "0", now: NOW });
    expect(panel.ok).toBe(true);
    if (panel.ok) expect(panel.slotMinutes).toBe(0);

    for (const bad of ["-5", "241", "abc"]) {
      const result = parseScheduleInput({ startAt: "2026-08-25T14:30", slotMinutes: bad, now: NOW });
      expect(result.ok, bad).toBe(false);
    }
  });

  it("caps how many interviews one action may book", () => {
    expect(MAX_INTERVIEWS_PER_RUN).toBeGreaterThan(0);
    expect(MAX_INTERVIEWS_PER_RUN).toBeLessThanOrEqual(100);
  });
});

describe("buildSlotTimes", () => {
  it("gives each candidate the next slot", () => {
    const slots = buildSlotTimes("2026-08-25T07:30:00.000Z", 30, 3);
    expect(slots).toEqual([
      "2026-08-25T07:30:00.000Z",
      "2026-08-25T08:00:00.000Z",
      "2026-08-25T08:30:00.000Z"
    ]);
  });

  it("puts everybody at the same time when the gap is zero", () => {
    const slots = buildSlotTimes("2026-08-25T07:30:00.000Z", 0, 3);
    expect(new Set(slots).size).toBe(1);
  });

  it("returns nothing for an empty list or an unreadable start", () => {
    expect(buildSlotTimes("2026-08-25T07:30:00.000Z", 30, 0)).toEqual([]);
    expect(buildSlotTimes("not-a-date", 30, 3)).toEqual([]);
  });
});

describe("formatInterviewTimeVi", () => {
  it("prints the Vietnamese hour, not the UTC one", () => {
    const label = formatInterviewTimeVi("2026-08-25T07:30:00.000Z");
    expect(label).toContain("14:30");
    expect(label).toContain("25/08/2026");
  });

  it("is null-safe", () => {
    expect(formatInterviewTimeVi(null)).toBeNull();
    expect(formatInterviewTimeVi("nonsense")).toBeNull();
  });
});

describe("toDateTimeLocalValue", () => {
  it("round-trips with toVietnamInstant so editing a booking keeps its hour", () => {
    const stored = toVietnamInstant("2026-08-25T14:30");
    expect(stored).not.toBeNull();
    expect(toDateTimeLocalValue(stored)).toBe("2026-08-25T14:30");
  });

  it("handles midnight, where a 24-hour formatter can say 24", () => {
    const stored = toVietnamInstant("2026-08-25T00:00");
    expect(toDateTimeLocalValue(stored)).toBe("2026-08-25T00:00");
  });

  it("is empty for a missing value", () => {
    expect(toDateTimeLocalValue(null)).toBe("");
  });
});

describe("mode labels", () => {
  it("names both modes in Vietnamese", () => {
    expect(INTERVIEW_MODE_LABELS.online).toBe("Trực tuyến");
    expect(INTERVIEW_MODE_LABELS.offline).toBe("Trực tiếp");
  });
});

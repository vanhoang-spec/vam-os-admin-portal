/**
 * The report's arithmetic and its wording.
 *
 * The case that matters most is the totals row. "Số mentor" counts people, so
 * adding the programme columns together double-counts anybody who mentors at
 * two schools. The table still shows the sum — refusing to would be its own kind
 * of unhelpful — but it has to be flagged, because a number labelled "tổng số
 * mentor" that is quietly an upper bound is worse than no number at all.
 */
import { describe, it, expect } from "vitest";

import {
  buildTotals,
  DEFAULT_METRICS,
  emptyCell,
  formatNumber,
  METRIC_SPECS,
  metricSpec,
  normalizeMetrics,
  resolveDateRange,
  toCsv,
  withinRange,
  type MetricKey,
  type ProgramColumn,
  type ReportCell
} from "@/lib/cross-program-report-core";

const UEHM: ProgramColumn = { programId: "p1", programCode: "UEHM", programName: "UEH Mentoring" };
const BK: ProgramColumn = { programId: "p2", programCode: "BK", programName: "BK Mentoring" };

function cell(overrides: Partial<ReportCell>): ReportCell {
  return { ...emptyCell(), ...overrides };
}

describe("normalizeMetrics", () => {
  it("keeps only metrics it knows", () => {
    expect(normalizeMetrics(["mentors", "khong-co-that", "mentees"])).toEqual([
      "mentors",
      "mentees"
    ]);
  });

  it("returns them in the declared order, not the order they arrived", () => {
    expect(normalizeMetrics(["mentees", "mentors"])).toEqual(["mentors", "mentees"]);
  });

  it("falls back to a sensible default rather than an empty report", () => {
    for (const value of [[], null, undefined, ["rac"], "rac"]) {
      expect(normalizeMetrics(value), String(value)).toEqual(DEFAULT_METRICS);
    }
  });

  it("drops duplicates", () => {
    expect(normalizeMetrics(["mentors", "mentors", "mentors"])).toEqual(["mentors"]);
  });
});

describe("resolveDateRange", () => {
  it("reads both boxes", () => {
    expect(resolveDateRange({ from: "2025-09-01", to: "2026-08-31" })).toEqual({
      from: "2025-09-01",
      to: "2026-08-31",
      label: "2025-09-01 → 2026-08-31"
    });
  });

  it("treats two empty boxes as all time", () => {
    expect(resolveDateRange({})).toEqual({ from: null, to: null, label: "Toàn bộ thời gian" });
  });

  it("accepts one open end", () => {
    expect(resolveDateRange({ from: "2026-01-01" }).label).toBe("Từ 2026-01-01");
    expect(resolveDateRange({ to: "2026-01-01" }).label).toBe("Đến 2026-01-01");
  });

  it("swaps the dates when they arrive the wrong way round", () => {
    // Somebody typing the end date first is making a typing mistake, not asking
    // for an empty report.
    expect(resolveDateRange({ from: "2026-08-31", to: "2025-09-01" })).toMatchObject({
      from: "2025-09-01",
      to: "2026-08-31"
    });
  });

  it("ignores anything that is not a date", () => {
    expect(resolveDateRange({ from: "hom qua", to: "31/08/2026" })).toMatchObject({
      from: null,
      to: null
    });
  });
});

describe("withinRange", () => {
  const range = resolveDateRange({ from: "2026-01-01", to: "2026-12-31" });

  it("includes both ends", () => {
    expect(withinRange("2026-01-01", range)).toBe(true);
    expect(withinRange("2026-12-31", range)).toBe(true);
  });

  it("reads a timestamp as its date", () => {
    expect(withinRange("2026-06-15T22:30:00Z", range)).toBe(true);
  });

  it("excludes what falls outside", () => {
    expect(withinRange("2025-12-31", range)).toBe(false);
    expect(withinRange("2027-01-01", range)).toBe(false);
  });

  it("never counts a row with no date", () => {
    for (const value of [null, undefined, "", "khong-phai-ngay"]) {
      expect(withinRange(value, range), String(value)).toBe(false);
    }
  });

  it("accepts everything dated when no window was asked for", () => {
    const allTime = resolveDateRange({});
    expect(withinRange("1999-01-01", allTime)).toBe(true);
    expect(withinRange(null, allTime)).toBe(false);
  });
});

describe("buildTotals", () => {
  const byProgram: Record<string, ReportCell> = {
    p1: cell({ mentors: 212, mentoring_sessions: 1842 }),
    p2: cell({ mentors: 64, mentoring_sessions: 402 })
  };

  it("adds the columns up", () => {
    const { totals } = buildTotals(byProgram, [UEHM, BK], ["mentors", "mentoring_sessions"]);
    expect(totals?.mentors).toBe(276);
    expect(totals?.mentoring_sessions).toBe(2244);
  });

  it("produces no total for a single programme — one column plus a total reads as two", () => {
    const { totals, totalCaveats } = buildTotals(byProgram, [UEHM], ["mentors"]);
    expect(totals).toBeNull();
    expect(totalCaveats).toEqual([]);
  });

  it("flags the metrics whose total may double-count a person", () => {
    const { totalCaveats } = buildTotals(byProgram, [UEHM, BK], [
      "mentors",
      "mentees",
      "mentoring_sessions"
    ]);
    // A mentor at both schools appears in both columns.
    expect(totalCaveats).toEqual(["mentors", "mentees"]);
  });

  it("does not flag metrics that count events rather than people", () => {
    const { totalCaveats } = buildTotals(byProgram, [UEHM, BK], [
      "mentoring_sessions",
      "cross_mentoring_sessions",
      "training_events",
      "company_visits",
      "mentor_participations"
    ]);
    expect(totalCaveats).toEqual([]);
  });

  it("survives a column with no data at all", () => {
    const { totals } = buildTotals({ p1: cell({ mentors: 5 }) }, [UEHM, BK], ["mentors"]);
    expect(totals?.mentors).toBe(5);
  });
});

describe("metric definitions", () => {
  it("distinguishes counting people from counting participations", () => {
    expect(metricSpec("mentors").countsPeople).toBe(true);
    expect(metricSpec("mentor_participations").countsPeople).toBe(false);
  });

  it("explains every metric, so no number on the screen is unexplained", () => {
    for (const spec of METRIC_SPECS) {
      expect(spec.label.length, spec.key).toBeGreaterThan(0);
      expect(spec.note.length, spec.key).toBeGreaterThan(10);
    }
  });
});

describe("toCsv", () => {
  const table = {
    columns: [UEHM, BK],
    metrics: ["mentors", "mentoring_sessions"] as MetricKey[],
    byProgram: {
      p1: cell({ mentors: 212, mentoring_sessions: 1842 }),
      p2: cell({ mentors: 64, mentoring_sessions: 402 })
    },
    totals: cell({ mentors: 276, mentoring_sessions: 2244 }),
    range: resolveDateRange({ from: "2026-01-01", to: "2026-12-31" }),
    totalCaveats: ["mentors"] as MetricKey[]
  };

  it("writes the window, the header and a row per metric", () => {
    const csv = toCsv(table);
    const lines = csv.split("\r\n");

    expect(lines[0]).toContain("2026-01-01 → 2026-12-31");
    expect(lines[1]).toBe('"Chỉ số","UEH Mentoring","BK Mentoring","Tổng"');
    expect(lines[2]).toBe('"Số mentor","212","64","276"');
    expect(lines).toHaveLength(4);
  });

  it("leaves the total column out when there is only one programme", () => {
    const csv = toCsv({ ...table, columns: [UEHM], totals: null });
    expect(csv.split("\r\n")[1]).toBe('"Chỉ số","UEH Mentoring"');
  });

  it("neutralises a value Excel would run as a formula", () => {
    const csv = toCsv({
      ...table,
      columns: [{ ...UEHM, programName: "=SUM(A1:A9)" }],
      totals: null
    });
    expect(csv).toContain(`"'=SUM(A1:A9)"`);
  });

  it("escapes quotes rather than breaking the row", () => {
    const csv = toCsv({
      ...table,
      columns: [{ ...UEHM, programName: 'UEH "Mentoring"' }],
      totals: null
    });
    expect(csv).toContain('"UEH ""Mentoring"""');
  });
});

describe("formatNumber", () => {
  it("groups thousands the Vietnamese way", () => {
    expect(formatNumber(2960)).toBe("2.960");
    expect(formatNumber(0)).toBe("0");
  });

  it("never prints NaN at somebody", () => {
    expect(formatNumber(Number.NaN)).toBe("0");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

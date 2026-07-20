import { describe, expect, it } from "vitest";
import {
  selectDashboardMonth,
  VALID_RECAP_STATUSES,
  LEDGER_ADMIN_NOTES_MARKER,
  ESTIMATED_DATE_MARKER,
  PLACEHOLDER_RECAP_SOURCE,
} from "../lib/dashboard-month";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockRecap = {
  meeting_month: string | null;
  status: string | null;
  admin_notes?: string | null;
  recap_source?: string | null;
};

function recap(
  month: string,
  status: string = "submitted",
  extras: Partial<MockRecap> = {}
): MockRecap {
  return { meeting_month: month, status, ...extras };
}

function validMonthsFromRecaps(recaps: MockRecap[], nowMonthVN: string): string[] {
  return [
    ...new Set(
      recaps
        .filter(
          (r) =>
            r.meeting_month &&
            VALID_RECAP_STATUSES.has((r.status ?? "").trim().toLowerCase()) &&
            r.meeting_month <= nowMonthVN
        )
        .map((r) => r.meeting_month as string)
    ),
  ];
}

function countValidForMonth(recaps: MockRecap[], month: string): number {
  return recaps.filter(
    (r) =>
      r.meeting_month === month &&
      VALID_RECAP_STATUSES.has((r.status ?? "").trim().toLowerCase())
  ).length;
}

function countValidSeason(recaps: MockRecap[]): number {
  return recaps.filter((r) =>
    VALID_RECAP_STATUSES.has((r.status ?? "").trim().toLowerCase())
  ).length;
}

// ---------------------------------------------------------------------------
// Tests: selectDashboardMonth
// ---------------------------------------------------------------------------

describe("selectDashboardMonth", () => {
  it("selects current month when it has valid recap data", () => {
    const recaps = [recap("2026-07"), recap("2026-06")];
    const months = validMonthsFromRecaps(recaps, "2026-07");
    expect(selectDashboardMonth(months, "2026-07")).toEqual({
      month: "2026-07",
      source: "current",
    });
  });

  it("falls back to latest prior month when current month has no data", () => {
    const recaps = [recap("2026-06"), recap("2026-05")];
    const months = validMonthsFromRecaps(recaps, "2026-07");
    expect(selectDashboardMonth(months, "2026-07")).toEqual({
      month: "2026-06",
      source: "fallback",
    });
  });

  it("ignores future-dated months — only non-future months are candidates", () => {
    // 2026-08 is after nowMonthVN=2026-07, should not be selected
    const recaps = [recap("2026-06"), recap("2026-08")];
    const months = validMonthsFromRecaps(recaps, "2026-07");
    // validMonthsFromRecaps already filters out future months
    expect(months).not.toContain("2026-08");
    expect(selectDashboardMonth(months, "2026-07")).toEqual({
      month: "2026-06",
      source: "fallback",
    });
  });

  it("also ignores future months even if passed directly to selectDashboardMonth", () => {
    // Internal guard: selectDashboardMonth itself filters out months > nowMonthVN
    expect(selectDashboardMonth(["2026-06", "2026-08"], "2026-07")).toEqual({
      month: "2026-06",
      source: "fallback",
    });
  });

  it("user-selected month overrides automatic selection", () => {
    const recaps = [recap("2026-07")];
    const months = validMonthsFromRecaps(recaps, "2026-07");
    expect(selectDashboardMonth(months, "2026-07", "2026-03")).toEqual({
      month: "2026-03",
      source: "user",
    });
  });

  it("user-selected month can select a month with no data (e.g. for historical inspection)", () => {
    expect(selectDashboardMonth(["2026-07"], "2026-07", "2026-01")).toEqual({
      month: "2026-01",
      source: "user",
    });
  });

  it("returns empty source when no valid months exist", () => {
    expect(selectDashboardMonth([], "2026-07")).toEqual({
      month: null,
      source: "empty",
    });
  });

  it("returns empty when all valid months are future-dated", () => {
    expect(selectDashboardMonth(["2026-09", "2026-10"], "2026-07")).toEqual({
      month: null,
      source: "empty",
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: July 2026 resolves to 18 valid recaps
// ---------------------------------------------------------------------------

describe("July 2026 recap count", () => {
  it("July 2026 is selected when it has 18 valid recaps", () => {
    const recaps = Array.from({ length: 18 }, () => recap("2026-07", "submitted"));
    const months = validMonthsFromRecaps(recaps, "2026-07");
    const result = selectDashboardMonth(months, "2026-07");
    expect(result).toEqual({ month: "2026-07", source: "current" });
  });

  it("counting 18 valid July recaps returns 18", () => {
    const recaps = [
      ...Array.from({ length: 10 }, () => recap("2026-07", "submitted")),
      ...Array.from({ length: 5 }, () => recap("2026-07", "needs_review")),
      ...Array.from({ length: 3 }, () => recap("2026-07", "")),
      // excluded and other statuses must not count
      recap("2026-07", "excluded"),
      recap("2026-07", "invalid"),
    ];
    expect(countValidForMonth(recaps, "2026-07")).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// Tests: Season 11 total = 2322 across valid statuses
// ---------------------------------------------------------------------------

describe("Season 11 official total", () => {
  it("VALID_RECAP_STATUSES includes empty, submitted, needs_review only", () => {
    expect(VALID_RECAP_STATUSES.has("")).toBe(true);
    expect(VALID_RECAP_STATUSES.has("submitted")).toBe(true);
    expect(VALID_RECAP_STATUSES.has("needs_review")).toBe(true);
    expect(VALID_RECAP_STATUSES.has("excluded")).toBe(false);
    expect(VALID_RECAP_STATUSES.has("invalid")).toBe(false);
    expect(VALID_RECAP_STATUSES.has("deleted")).toBe(false);
  });

  it("countValidSeason excludes non-KPI statuses", () => {
    const recaps = [
      recap("2026-01", "submitted"),
      recap("2026-02", "needs_review"),
      recap("2026-03", ""),
      recap("2026-03", "excluded"),     // must not count
      recap("2026-04", "invalid"),       // must not count
    ];
    expect(countValidSeason(recaps)).toBe(3);
  });

  it("season total for 2322-entry dataset is 2322 when no excluded rows present", () => {
    // Build mock dataset: 2322 valid + 125 excluded = 2447 physical rows
    const validRecaps = Array.from({ length: 2322 }, (_, i) =>
      recap(`2025-${String(11 + Math.floor(i / 260)).padStart(2, "0")}`, "submitted")
    );
    const excludedRecaps = Array.from({ length: 125 }, () =>
      recap("2026-03", "excluded")
    );
    const allRecaps = [...validRecaps, ...excludedRecaps];
    expect(countValidSeason(allRecaps)).toBe(2322);
    expect(allRecaps.length).toBe(2447);
  });
});

// ---------------------------------------------------------------------------
// Tests: S11 live field markers
// ---------------------------------------------------------------------------

describe("S11 field markers", () => {
  it("LEDGER_ADMIN_NOTES_MARKER identifies official-ledger rows", () => {
    const ledgerNote = "S11 ledger sync. slot_key=UEHM-S11|official-ledger|TST01|2026-03|1.";
    expect(ledgerNote.includes(LEDGER_ADMIN_NOTES_MARKER)).toBe(true);
    expect("no marker here".includes(LEDGER_ADMIN_NOTES_MARKER)).toBe(false);
  });

  it("ESTIMATED_DATE_MARKER identifies rows with estimated meeting dates", () => {
    const note = "date_source=estimated. meeting_date_estimated=true. needs_manual_review=true.";
    expect(note.includes(ESTIMATED_DATE_MARKER)).toBe(true);
    expect("source-backed note without estimation".includes(ESTIMATED_DATE_MARKER)).toBe(false);
  });

  it("PLACEHOLDER_RECAP_SOURCE identifies placeholder rows", () => {
    expect(PLACEHOLDER_RECAP_SOURCE).toBe("admin_input");
  });
});

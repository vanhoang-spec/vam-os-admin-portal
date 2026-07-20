import { describe, expect, it } from "vitest";
import {
  selectDashboardMonth,
  computeS11RecapReconciliation,
  VALID_RECAP_STATUSES,
  LEDGER_ADMIN_NOTES_MARKER,
  ESTIMATED_DATE_MARKER,
  PLACEHOLDER_RECAP_SOURCE,
  SOURCE_BACKED_RECAP_SOURCE,
} from "../lib/dashboard-month";
import { OPS_RECAPS_SELECT } from "../lib/data-selects";

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

  it("SOURCE_BACKED_RECAP_SOURCE identifies google_sheet-sourced rows", () => {
    expect(SOURCE_BACKED_RECAP_SOURCE).toBe("google_sheet");
  });
});

// ---------------------------------------------------------------------------
// Data-contract regression: OPS_RECAPS_SELECT must contain required fields
// ---------------------------------------------------------------------------

describe("Data-contract: OPS_RECAPS_SELECT", () => {
  const requiredFields = ["admin_notes", "recap_source", "issue_flag", "meeting_type", "status", "meeting_month"];

  for (const field of requiredFields) {
    it(`OPS_RECAPS_SELECT contains '${field}'`, () => {
      const fields = OPS_RECAPS_SELECT.split(",").map((f) => f.trim());
      expect(fields).toContain(field);
    });
  }
});

// ---------------------------------------------------------------------------
// Tests: computeS11RecapReconciliation
// ---------------------------------------------------------------------------

describe("computeS11RecapReconciliation", () => {
  const LEDGER_NOTE = `S11 ledger sync. slot_key=${LEDGER_ADMIN_NOTES_MARKER}TST01|2026-03|1. plan_hash=abc.`;
  const ESTIMATED_NOTE = `date_source=estimated. ${ESTIMATED_DATE_MARKER} needs_manual_review=true.`;

  it("empty array returns all-zero reconciliation", () => {
    const r = computeS11RecapReconciliation([]);
    expect(r.physical).toBe(0);
    expect(r.reportCounted).toBe(0);
    expect(r.excluded).toBe(0);
    expect(r.ledgerRows).toBe(0);
    expect(r.sourceBacked).toBe(0);
    expect(r.placeholders).toBe(0);
    expect(r.estimatedDates).toBe(0);
    expect(r.monthlyCounted).toEqual({});
  });

  it("missing admin_notes does not falsely count a ledger row", () => {
    const recaps = [
      { status: "submitted", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
      { status: "submitted", admin_notes: undefined, recap_source: "google_sheet", meeting_month: "2026-03" },
    ];
    const r = computeS11RecapReconciliation(recaps);
    expect(r.ledgerRows).toBe(0);
    expect(r.estimatedDates).toBe(0);
  });

  it("LEDGER_ADMIN_NOTES_MARKER in admin_notes counts as ledger row", () => {
    const recaps = [
      { status: "submitted", admin_notes: LEDGER_NOTE, recap_source: "google_sheet", meeting_month: "2026-03" },
      { status: "submitted", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
    ];
    const r = computeS11RecapReconciliation(recaps);
    expect(r.ledgerRows).toBe(1);
  });

  it("google_sheet recap_source counts as source-backed", () => {
    const recaps = [
      { status: "submitted", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
      { status: "submitted", admin_notes: null, recap_source: "admin_input", meeting_month: "2026-03" },
    ];
    const r = computeS11RecapReconciliation(recaps);
    expect(r.sourceBacked).toBe(1);
    expect(r.placeholders).toBe(1);
  });

  it("admin_input recap_source counts as placeholder", () => {
    const recaps = [
      { status: "needs_review", admin_notes: LEDGER_NOTE, recap_source: "admin_input", meeting_month: "2026-03" },
    ];
    const r = computeS11RecapReconciliation(recaps);
    expect(r.placeholders).toBe(1);
    expect(r.sourceBacked).toBe(0);
  });

  it("ESTIMATED_DATE_MARKER in admin_notes counts as estimated date", () => {
    const recaps = [
      { status: "needs_review", admin_notes: ESTIMATED_NOTE, recap_source: "admin_input", meeting_month: "2026-07" },
      { status: "submitted", admin_notes: LEDGER_NOTE, recap_source: "google_sheet", meeting_month: "2026-07" },
    ];
    const r = computeS11RecapReconciliation(recaps);
    expect(r.estimatedDates).toBe(1);
  });

  it("excluded status does not enter reportCounted", () => {
    const recaps = [
      { status: "excluded", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
      { status: "submitted", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
    ];
    const r = computeS11RecapReconciliation(recaps);
    expect(r.reportCounted).toBe(1);
    expect(r.excluded).toBe(1);
    expect(r.physical).toBe(2);
  });

  it("all valid meeting_type values enter reportCounted when status is valid", () => {
    const recaps = [
      { status: "submitted", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-05", meeting_type: "1on1" },
      { status: "submitted", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-05", meeting_type: "workshop" },
      { status: "needs_review", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-05", meeting_type: "event" },
      { status: "", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-05", meeting_type: null },
    ];
    const r = computeS11RecapReconciliation(recaps);
    expect(r.reportCounted).toBe(4);
    expect(r.monthlyCounted["2026-05"]).toBe(4);
  });

  it("monthlyCounted aggregates reportCounted per month correctly", () => {
    const recaps = [
      { status: "submitted", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
      { status: "submitted", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
      { status: "needs_review", admin_notes: null, recap_source: "admin_input", meeting_month: "2026-07" },
      { status: "excluded", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
    ];
    const r = computeS11RecapReconciliation(recaps);
    expect(r.monthlyCounted["2026-03"]).toBe(2);
    expect(r.monthlyCounted["2026-07"]).toBe(1);
    expect(r.monthlyCounted["2026-04"]).toBeUndefined();
  });

  it("physical = reportCounted + excluded + other statuses", () => {
    const recaps = [
      { status: "submitted", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
      { status: "excluded", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
      { status: "invalid", admin_notes: null, recap_source: "google_sheet", meeting_month: "2026-03" },
    ];
    const r = computeS11RecapReconciliation(recaps);
    expect(r.physical).toBe(3);
    expect(r.reportCounted).toBe(1);
    expect(r.excluded).toBe(1);
  });
});

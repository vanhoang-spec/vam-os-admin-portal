export const OPERATIONAL_MONTH_START = "2025-10";
export const VALID_RECAP_STATUSES = new Set(["", "submitted", "needs_review"]);
export const LEDGER_ADMIN_NOTES_MARKER = "UEHM-S11|official-ledger|";
export const ESTIMATED_DATE_MARKER = "meeting_date_estimated=true.";
export const PLACEHOLDER_RECAP_SOURCE = "admin_input";
export const SOURCE_BACKED_RECAP_SOURCE = "google_sheet";

export type MonthSelectionSource = "user" | "current" | "fallback" | "empty";

export interface MonthSelection {
  month: string | null;
  source: MonthSelectionSource;
}

/**
 * Determine the dashboard's selected month using these rules:
 *  1. userMonth (from query param) overrides everything.
 *  2. Current VN month if it has valid recap data.
 *  3. Latest prior month (< nowMonthVN) with valid recap data.
 *  4. null when no valid data exists at all.
 *
 * Future-dated months in validMonthsWithData are automatically excluded.
 */
export function selectDashboardMonth(
  validMonthsWithData: string[],
  nowMonthVN: string,
  userMonth?: string | null
): MonthSelection {
  if (userMonth && /^\d{4}-\d{2}$/.test(userMonth)) {
    return { month: userMonth, source: "user" };
  }
  const nonFuture = validMonthsWithData.filter((m) => m <= nowMonthVN);
  if (nonFuture.includes(nowMonthVN)) {
    return { month: nowMonthVN, source: "current" };
  }
  const sorted = [...nonFuture].sort();
  const latest = sorted.at(-1) ?? null;
  return latest
    ? { month: latest, source: "fallback" }
    : { month: null, source: "empty" };
}

/** Current calendar month in Asia/Ho_Chi_Minh timezone, formatted as YYYY-MM. */
export function currentMonthVN(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/** Months from OPERATIONAL_MONTH_START up to and including endMonth (inclusive). */
export function operationalMonthRange(endMonth: string): string[] {
  const months: string[] = [];
  let m = OPERATIONAL_MONTH_START;
  while (m <= endMonth) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    m = next;
  }
  return months;
}

// ---------------------------------------------------------------------------
// S11 Recap Reconciliation
// ---------------------------------------------------------------------------

type RecapForReconciliation = {
  status?: string | null;
  admin_notes?: string | null;
  recap_source?: string | null;
  meeting_month?: string | null;
  meeting_type?: string | null;
};

export interface S11RecapReconciliation {
  physical: number;
  reportCounted: number;
  excluded: number;
  ledgerRows: number;
  sourceBacked: number;
  placeholders: number;
  estimatedDates: number;
  /** Count of report-counted recaps keyed by YYYY-MM. */
  monthlyCounted: Record<string, number>;
}

/**
 * Derive all S11 reconciliation KPIs from a flat recap array.
 * Safe against undefined admin_notes / recap_source: treats them as empty strings.
 * All meeting types are counted when status is valid (inclusion whitelist).
 */
export function computeS11RecapReconciliation(
  recaps: RecapForReconciliation[]
): S11RecapReconciliation {
  const monthlyCounted: Record<string, number> = {};
  let reportCounted = 0;
  let excluded = 0;
  let ledgerRows = 0;
  let sourceBacked = 0;
  let placeholders = 0;
  let estimatedDates = 0;

  for (const r of recaps) {
    const status = (r.status ?? "").trim().toLowerCase();
    const notes = r.admin_notes ?? "";
    const source = r.recap_source ?? "";

    if (VALID_RECAP_STATUSES.has(status)) {
      reportCounted++;
      if (r.meeting_month) {
        monthlyCounted[r.meeting_month] = (monthlyCounted[r.meeting_month] ?? 0) + 1;
      }
    }
    if (status === "excluded") excluded++;
    if (notes.includes(LEDGER_ADMIN_NOTES_MARKER)) ledgerRows++;
    if (source === SOURCE_BACKED_RECAP_SOURCE) sourceBacked++;
    if (source === PLACEHOLDER_RECAP_SOURCE) placeholders++;
    if (notes.includes(ESTIMATED_DATE_MARKER)) estimatedDates++;
  }

  return {
    physical: recaps.length,
    reportCounted,
    excluded,
    ledgerRows,
    sourceBacked,
    placeholders,
    estimatedDates,
    monthlyCounted,
  };
}

// ---------------------------------------------------------------------------
// Operations month resolution
// ---------------------------------------------------------------------------

export type OperationsMonthResolutionReason =
  | "requested"
  | "current_month_has_data"
  | "latest_available"
  | "current_month_empty";

export interface OperationsMonthResolution {
  resolvedMonth: string;
  resolutionReason: OperationsMonthResolutionReason;
}

/**
 * Resolve the month to display on the Operations page.
 *
 * Priority:
 *   1. requestedRaw — validated YYYY-MM, must not be in the future. If invalid or
 *      future, discarded and auto-resolution takes over.
 *   2. currentMonth (nowMonth) if it appears in availableMonths.
 *   3. Latest month ≤ nowMonth in availableMonths.
 *   4. nowMonth with "current_month_empty" when no data exists yet.
 *
 * Never returns a future month. Never silently falls back to officialClosedMonth.
 */
export function resolveOperationsMonth(
  requestedRaw: string | null | undefined,
  nowMonth: string,
  availableMonths: string[]
): OperationsMonthResolution {
  const parsed = requestedRaw
    ? (String(requestedRaw).trim().match(/^(\d{4}-(0[1-9]|1[0-2]))/)?.[1] ?? null)
    : null;
  const validRequested = parsed && parsed <= nowMonth ? parsed : null;

  if (validRequested) {
    return { resolvedMonth: validRequested, resolutionReason: "requested" };
  }

  const { month, source } = selectDashboardMonth(availableMonths, nowMonth);

  if (month) {
    return {
      resolvedMonth: month,
      resolutionReason: source === "current" ? "current_month_has_data" : "latest_available",
    };
  }

  return { resolvedMonth: nowMonth, resolutionReason: "current_month_empty" };
}

/** Whether a month string falls within the S11 operational range. */
export function isOperationalMonth(month: unknown, endMonth: string): boolean {
  const value = String(month ?? "").trim();
  return (
    /^\d{4}-\d{2}$/.test(value) &&
    value >= OPERATIONAL_MONTH_START &&
    value <= endMonth
  );
}

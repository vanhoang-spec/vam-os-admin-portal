export const OPERATIONAL_MONTH_START = "2025-10";
export const VALID_RECAP_STATUSES = new Set(["", "submitted", "needs_review"]);
export const LEDGER_ADMIN_NOTES_MARKER = "UEHM-S11|official-ledger|";
export const ESTIMATED_DATE_MARKER = "meeting_date_estimated=true.";
export const PLACEHOLDER_RECAP_SOURCE = "admin_input";

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

/** Whether a month string falls within the S11 operational range. */
export function isOperationalMonth(month: unknown, endMonth: string): boolean {
  const value = String(month ?? "").trim();
  return (
    /^\d{4}-\d{2}$/.test(value) &&
    value >= OPERATIONAL_MONTH_START &&
    value <= endMonth
  );
}

/**
 * lib/cross-program-report-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The shape of a cross-programme report: what can be counted, over what window,
 * and how the rows add up.
 *
 * Pure, because the two things most likely to be wrong here are arithmetic and
 * wording, and both are cheap to test and expensive to notice in production.
 *
 * ONE DISTINCTION RUNS THROUGH IT. "Số mentor" counts people; "lượt mentor"
 * counts participations. The same person mentoring for three seasons is one
 * mentor and three lượt. Reporting one as the other overstates or understates
 * the programme by a factor that grows every year, so the two are separate
 * metrics with separate labels rather than one number people argue about.
 */

// ── Metrics ──────────────────────────────────────────────────────────────────

export type MetricKey =
  | "mentors"
  | "mentees"
  | "mentor_participations"
  | "mentee_participations"
  | "mentoring_sessions"
  | "cross_mentoring_sessions"
  | "training_events"
  | "company_visits";

export type MetricSpec = {
  key: MetricKey;
  label: string;
  /** What the number actually counts, shown under the table. */
  note: string;
  /** True when the metric counts distinct people and therefore cannot be summed across programmes. */
  countsPeople: boolean;
};

export const METRIC_SPECS: MetricSpec[] = [
  {
    key: "mentors",
    label: "Số mentor",
    note: "Đếm người. Một mentor tham gia nhiều mùa vẫn tính là một.",
    countsPeople: true
  },
  {
    key: "mentees",
    label: "Số mentee",
    note: "Đếm người. Một mentee tham gia nhiều mùa vẫn tính là một.",
    countsPeople: true
  },
  {
    key: "mentor_participations",
    label: "Lượt mentor",
    note: "Đếm lượt theo mùa. Một mentor ba mùa là ba lượt.",
    countsPeople: false
  },
  {
    key: "mentee_participations",
    label: "Lượt mentee",
    note: "Đếm lượt theo mùa. Một mentee hai mùa là hai lượt.",
    countsPeople: false
  },
  {
    key: "mentoring_sessions",
    label: "Lượt mentoring 1-1",
    note: "Số recap buổi gặp 1-1 chính thức đã được duyệt.",
    countsPeople: false
  },
  {
    key: "cross_mentoring_sessions",
    label: "Lượt cross mentoring",
    note: "Số recap buổi cross mentoring đã được duyệt.",
    countsPeople: false
  },
  {
    key: "training_events",
    label: "Buổi training",
    note: "Số sự kiện phân loại training hoặc orientation.",
    countsPeople: false
  },
  {
    key: "company_visits",
    label: "Company visit",
    note: "Số sự kiện phân loại company tour hoặc job shadowing.",
    countsPeople: false
  }
];

export const DEFAULT_METRICS: MetricKey[] = [
  "mentors",
  "mentees",
  "mentoring_sessions",
  "cross_mentoring_sessions",
  "training_events"
];

const METRIC_KEYS = new Set<string>(METRIC_SPECS.map((spec) => spec.key));

/** Keep only metrics we know, in the order they are declared above. */
export function normalizeMetrics(values: unknown): MetricKey[] {
  const raw = Array.isArray(values) ? values : [values];
  const chosen = new Set(
    raw.map((value) => String(value ?? "").trim()).filter((value) => METRIC_KEYS.has(value))
  );
  const ordered = METRIC_SPECS.filter((spec) => chosen.has(spec.key)).map((spec) => spec.key);
  return ordered.length ? ordered : [...DEFAULT_METRICS];
}

export function metricSpec(key: MetricKey): MetricSpec {
  return METRIC_SPECS.find((spec) => spec.key === key) ?? METRIC_SPECS[0];
}

// ── The window ───────────────────────────────────────────────────────────────

export type DateRange = {
  /** Inclusive, YYYY-MM-DD. Null on both sides means all time. */
  from: string | null;
  to: string | null;
  label: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read the two date boxes.
 *
 * Swaps them when they arrive the wrong way round rather than returning an
 * empty report — somebody typing the end date first is making a typing mistake,
 * not asking for nothing.
 */
export function resolveDateRange(input: { from?: unknown; to?: unknown }): DateRange {
  let from = String(input.from ?? "").trim();
  let to = String(input.to ?? "").trim();

  if (!DATE_PATTERN.test(from)) from = "";
  if (!DATE_PATTERN.test(to)) to = "";

  if (from && to && from > to) [from, to] = [to, from];

  if (!from && !to) return { from: null, to: null, label: "Toàn bộ thời gian" };
  if (from && !to) return { from, to: null, label: `Từ ${from}` };
  if (!from && to) return { from: null, to, label: `Đến ${to}` };
  return { from, to, label: `${from} → ${to}` };
}

/** True when a date falls inside the window; a missing date is never counted. */
export function withinRange(value: unknown, range: DateRange): boolean {
  const date = String(value ?? "").slice(0, 10);
  if (!DATE_PATTERN.test(date)) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

// ── The table ────────────────────────────────────────────────────────────────

export type ProgramColumn = { programId: string; programCode: string; programName: string };

export type ReportCell = Record<MetricKey, number>;

export type ReportTable = {
  columns: ProgramColumn[];
  metrics: MetricKey[];
  /** programId → metric → value. */
  byProgram: Record<string, ReportCell>;
  /** Only present when more than one programme is selected. */
  totals: ReportCell | null;
  range: DateRange;
  /** Metrics whose total is a sum of distinct people and may double-count. */
  totalCaveats: MetricKey[];
};

export function emptyCell(): ReportCell {
  return {
    mentors: 0,
    mentees: 0,
    mentor_participations: 0,
    mentee_participations: 0,
    mentoring_sessions: 0,
    cross_mentoring_sessions: 0,
    training_events: 0,
    company_visits: 0
  };
}

/**
 * Add the programme columns up.
 *
 * The totals row is only produced for more than one programme — a "total" beside
 * a single column is noise that invites people to read it as something else.
 *
 * Person-counting metrics are summed too, but flagged: somebody who mentors at
 * both UEH and BK is one person and appears in both columns, so the total is an
 * upper bound. Saying so in a footnote is more honest than either silently
 * summing or silently blanking the cell.
 */
export function buildTotals(
  byProgram: Record<string, ReportCell>,
  columns: ProgramColumn[],
  metrics: MetricKey[]
): { totals: ReportCell | null; totalCaveats: MetricKey[] } {
  if (columns.length < 2) return { totals: null, totalCaveats: [] };

  const totals = emptyCell();
  for (const column of columns) {
    const cell = byProgram[column.programId];
    if (!cell) continue;
    for (const metric of metrics) totals[metric] += cell[metric] ?? 0;
  }

  const totalCaveats = metrics.filter((metric) => metricSpec(metric).countsPeople);
  return { totals, totalCaveats };
}

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * Excel treats a cell starting with = + - @ as a formula, so an exported value
 * could execute when the file is opened. Prefixing with an apostrophe keeps the
 * text visible and inert. Same rule the operations export already applies.
 */
function csvValue(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The table as a CSV body, rows first column being the metric label. */
export function toCsv(table: ReportTable): string {
  const header = [
    "Chỉ số",
    ...table.columns.map((column) => column.programName),
    ...(table.totals ? ["Tổng"] : [])
  ];

  const rows = table.metrics.map((metric) => [
    metricSpec(metric).label,
    ...table.columns.map((column) => table.byProgram[column.programId]?.[metric] ?? 0),
    ...(table.totals ? [table.totals[metric]] : [])
  ]);

  return [
    [`Khoảng thời gian: ${table.range.label}`],
    header,
    ...rows
  ]
    .map((line) => line.map(csvValue).join(","))
    .join("\r\n");
}

/** Vietnamese thousands separator, so 2960 reads as 2.960. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0
  );
}

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKBOOK_CANDIDATES = [
  path.resolve(process.cwd(), "TRACKING _ SEASON 11.xlsx"),
  path.resolve(process.cwd(), "..", "VAM_OS_Data_Cleaning", "Input", "TRACKING _ SEASON 11.xlsx"),
  path.resolve("C:/Users/THIS PC/Desktop/VAM 2026/VAM_OS_Data_Cleaning/Input/TRACKING _ SEASON 11.xlsx")
];

const OUTPUT_PATH = path.resolve(process.cwd(), "docs", "data_audit", "SEASON11_TRACKING_AUDIT.md");
const CLOSED_MONTHS = new Set(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
const LATEST_CLOSED_MONTH = "2026-03";
const FOLLOW_UP_MONTHS = ["2026-02", "2026-03"];
const OPEN_MONTH = "2026-04";

function workbookPath() {
  const explicit = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const candidates = explicit ? [explicit, ...WORKBOOK_CANDIDATES] : WORKBOOK_CANDIDATES;
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Workbook not found. Expected one of:\n${candidates.map((candidate) => `- ${candidate}`).join("\n")}`);
  }
  return found;
}

function decodeXml(value = "") {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(xml, name) {
  return new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1] ?? "";
}

function tagText(xml, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : "";
}

function columnIndex(cellRef) {
  const letters = /^[A-Z]+/.exec(cellRef)?.[0] ?? "";
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseMonth(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const normalized = raw.replace(",", ".").replace(/\s+/g, "");
  if (/^\d{4}-\d{1,2}$/.test(normalized)) {
    const [year, month] = normalized.split("-");
    return `${year}-${month.padStart(2, "0")}`;
  }
  const dotted = /^(\d{1,2})\.(\d{4})$/.exec(normalized);
  if (dotted) return `${dotted[2]}-${dotted[1].padStart(2, "0")}`;
  const monthOnly = /^0?(\d{1,2})$/.exec(normalized);
  if (monthOnly) {
    const month = Number(monthOnly[1]);
    const year = month >= 11 ? 2025 : 2026;
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  return raw;
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" |")} |`,
    ...rows.map((row) => `| ${row.map((value) => normalizeText(value).replace(/\|/g, "\\|") || "-").join(" | ")} |`)
  ].join("\n");
}

function extractWorkbook(xlsxPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "season11-xlsx-"));
  execFileSync("tar", ["-xf", xlsxPath, "-C", tempDir], { stdio: "ignore" });
  return tempDir;
}

function readXml(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function parseSharedStrings(root) {
  const sharedPath = path.join(root, "xl", "sharedStrings.xml");
  if (!fs.existsSync(sharedPath)) return [];
  const xml = fs.readFileSync(sharedPath, "utf8");
  return [...xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((text) => decodeXml(text[1])).join("")
  );
}

function parseSheetMap(root) {
  const workbook = readXml(root, "xl/workbook.xml");
  const rels = readXml(root, "xl/_rels/workbook.xml.rels");
  const relMap = new Map(
    [...rels.matchAll(/<Relationship[^>]*>/g)].map((match) => {
      const id = attr(match[0], "Id");
      const target = attr(match[0], "Target").replace(/^\/?xl\//, "");
      return [id, path.posix.join("xl", target)];
    })
  );
  return [...workbook.matchAll(/<sheet\s[^>]*>/g)].map((match) => {
    const sheet = match[0];
    const id = attr(sheet, "sheetId");
    const name = decodeXml(attr(sheet, "name"));
    const relId = attr(sheet, "r:id");
    return { id, name, path: relMap.get(relId) };
  });
}

function parseCell(cellXml, sharedStrings) {
  const type = attr(cellXml, "t");
  if (type === "inlineStr") return tagText(cellXml, "t");
  const raw = tagText(cellXml, "v");
  if (type === "s") return sharedStrings[Number(raw)] ?? "";
  if (type === "str") return raw;
  if (raw === "") return "";
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

function parseWorksheet(root, sheet, sharedStrings) {
  const xml = readXml(root, sheet.path);
  const rowMap = new Map();
  for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1]);
    const values = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c[^>]*r="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g)) {
      values[columnIndex(cellMatch[1])] = parseCell(cellMatch[0], sharedStrings);
    }
    rowMap.set(rowNumber, values);
  }
  return rowMap;
}

function rowValues(rows, number) {
  return rows.get(number) ?? [];
}

function nonEmptyRows(rows) {
  return [...rows.values()].filter((row) => row.some((value) => normalizeText(value) !== "")).length;
}

function overviewMetrics(rows) {
  const monthIndexes = Array.from({ length: 10 }, (_, index) => index + 1);
  return [4, 5, 6, 7, 8, 9, 10].map((rowNumber) => {
    const row = rowValues(rows, rowNumber);
    return {
      metric: row[0],
      values: monthIndexes.map((index) => [rowValues(rows, 3)[index], row[index]])
    };
  });
}

function recapKpis(rows) {
  const result = [];
  for (let rowNumber = 5; rowNumber <= 13; rowNumber += 1) {
    const row = rowValues(rows, rowNumber);
    const month = parseMonth(row[1]);
    if (!month) continue;
    result.push({
      month,
      recapCount: numeric(row[2]),
      menteeWriters: numeric(row[3]),
      totalMentees: numeric(row[4]),
      writerRate: numeric(row[5]),
      isClosed: CLOSED_MONTHS.has(month)
    });
  }
  return result;
}

function menteeTrackingMetrics(rows) {
  const header = rowValues(rows, 3);
  const monthColumns = header
    .map((value, index) => ({ index, month: parseMonth(value) }))
    .filter((item) => item.index >= 15 && item.month);
  const statusCounts = new Map();
  const monthly = new Map(monthColumns.map(({ month }) => [month, { recapCount: 0, menteeWriters: 0 }]));
  let dataRows = 0;

  for (const [rowNumber, row] of rows) {
    if (rowNumber < 4) continue;
    if (!normalizeText(row[4]) && !normalizeText(row[5])) continue;
    dataRows += 1;
    const status = normalizeText(row[0]) || "Blank";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    for (const { index, month } of monthColumns) {
      const value = numeric(row[index]);
      const entry = monthly.get(month);
      entry.recapCount += value;
      if (value > 0) entry.menteeWriters += 1;
    }
  }

  return { dataRows, statusCounts, monthly };
}

function cleaningDataMetrics(rows) {
  const monthly = new Map();
  let dataRows = 0;
  for (const [rowNumber, row] of rows) {
    if (rowNumber < 4) continue;
    const year = numeric(row[0]);
    const monthNumber = numeric(row[1]);
    if (!year || !monthNumber) continue;
    const month = `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
    if (!monthly.has(month)) monthly.set(month, { rawCount: 0, mentoring: 0, cross: 0, training: 0, companyVisit: 0 });
    const entry = monthly.get(month);
    dataRows += 1;
    entry.rawCount += 1;
    const content = normalizeText(row[4]).toLowerCase();
    const cross = normalizeText(row[10]).toLowerCase() === "x" || content.includes("#cross") || content.includes("cross mentoring") || content.includes("crossmentoring");
    const training = normalizeText(row[11]).toLowerCase() === "x" || content.includes("#training") || content.includes(" training");
    const companyVisit = normalizeText(row[12]).toLowerCase() === "x" || content.includes("company visit");
    const mentoring = normalizeText(row[9]).toLowerCase() === "x" || (!cross && !training && !companyVisit && (content.includes("#mentoring") || content.includes(" mentoring")));
    if (mentoring) entry.mentoring += 1;
    if (cross) entry.cross += 1;
    if (training) entry.training += 1;
    if (companyVisit) entry.companyVisit += 1;
  }
  return { dataRows, monthly };
}

function generateReport({ xlsxPath, sheets, parsed }) {
  const overview = overviewMetrics(parsed.get("Overview"));
  const recap = recapKpis(parsed.get("Báo cáo Recap"));
  const mentee = menteeTrackingMetrics(parsed.get("Mentee Tracking"));
  const cleaning = cleaningDataMetrics(parsed.get("Cleaning data"));
  const months = [...new Set([
    ...recap.map((row) => row.month),
    ...mentee.monthly.keys(),
    ...cleaning.monthly.keys()
  ])].sort();

  const recapByMonth = new Map(recap.map((row) => [row.month, row]));
  const differenceRows = months.map((month) => {
    const official = recapByMonth.get(month)?.recapCount ?? 0;
    const menteeCount = mentee.monthly.get(month)?.recapCount ?? 0;
    const rawCount = cleaning.monthly.get(month)?.rawCount ?? 0;
    const closedNote = month === OPEN_MONTH ? "Open month excluded from closed KPI" : CLOSED_MONTHS.has(month) ? "Closed month" : "Future/reference only";
    const discrepancy = official === menteeCount && official === rawCount ? "OK" : "Review";
    return [month, official, menteeCount, rawCount, menteeCount - official, rawCount - official, discrepancy, closedNote];
  });

  const lines = [];
  lines.push("# Season 11 Tracking Workbook Audit");
  lines.push("");
  lines.push(`Generated from: \`${xlsxPath}\``);
  lines.push("");
  lines.push("## Scope Guardrails");
  lines.push("");
  lines.push("- No Supabase schema changes.");
  lines.push("- No Supabase data changes.");
  lines.push("- No dashboard or UI changes.");
  lines.push("- No migrations, import SQL, or CSV import files generated.");
  lines.push("- Discrepancies are flagged for review only, not auto-corrected.");
  lines.push("");
  lines.push("## Closed-Month Logic");
  lines.push("");
  lines.push(`- Latest closed month: **${LATEST_CLOSED_MONTH} / March 2026**.`);
  lines.push(`- Follow-up comparison months: **${FOLLOW_UP_MONTHS.join(" and ")} / February 2026 and March 2026**.`);
  lines.push(`- **${OPEN_MONTH} / April 2026 is open and excluded** from closed-month operations KPIs.`);
  lines.push("");
  lines.push("## Workbook Sheets");
  lines.push("");
  lines.push(markdownTable(["#", "Sheet", "Non-empty rows", "Audit role"], sheets.map((sheet, index) => {
    const role =
      sheet.name === "Overview" ? "Season 10 baseline / historical comparison only" :
      sheet.name === "Báo cáo Recap" ? "Season 11 official monthly KPI benchmark" :
      sheet.name === "Mentee Tracking" ? "Mentee-by-month tracking and silent/follow-up logic" :
      sheet.name === "Cleaning data" ? "Candidate normalized raw recap event source" :
      "Reference only";
    return [index + 1, sheet.name, nonEmptyRows(parsed.get(sheet.name)), role];
  })));
  lines.push("");
  lines.push("## Season 10 Baseline From Overview");
  lines.push("");
  lines.push(markdownTable(["Metric", "T11", "T12", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "Tổng"], overview.map((metric) => [
    metric.metric,
    ...metric.values.map(([, value]) => value)
  ])));
  lines.push("");
  lines.push("## Season 11 Monthly KPI Benchmark From Báo Cáo Recap");
  lines.push("");
  lines.push(markdownTable(["Month", "Số recap", "Mentee viết recap", "Tổng số mentee", "Writer rate", "Closed KPI?"], recap.map((row) => [
    row.month,
    row.recapCount,
    row.menteeWriters,
    row.totalMentees,
    `${Math.round(row.writerRate * 1000) / 10}%`,
    row.isClosed ? "Yes" : row.month === OPEN_MONTH ? "No - open month" : "No"
  ])));
  lines.push("");
  lines.push("## Mentee Status Counts From Mentee Tracking");
  lines.push("");
  lines.push(`Data rows counted: **${mentee.dataRows}**.`);
  lines.push("");
  lines.push(markdownTable(["Status", "Count"], [...mentee.statusCounts.entries()].map(([status, count]) => [status, count])));
  lines.push("");
  lines.push("## Monthly Recap Counts Derived From Mentee Tracking");
  lines.push("");
  lines.push(markdownTable(["Month", "Recap count", "Mentees with recap"], [...mentee.monthly.entries()].map(([month, row]) => [
    month,
    row.recapCount,
    row.menteeWriters
  ])));
  lines.push("");
  lines.push("## Monthly Raw Recap/Event Counts Derived From Cleaning Data");
  lines.push("");
  lines.push(`Data rows counted: **${cleaning.dataRows}**.`);
  lines.push("");
  lines.push("Type counts use explicit `Cleaning data` flag columns when present, with hashtag/text markers as a fallback when cached formula flags are blank.");
  lines.push("");
  lines.push(markdownTable(["Month", "Raw rows", "Mentoring", "Cross mentoring", "Training", "Company visit"], [...cleaning.monthly.entries()].sort().map(([month, row]) => [
    month,
    row.rawCount,
    row.mentoring,
    row.cross,
    row.training,
    row.companyVisit
  ])));
  lines.push("");
  lines.push("## Difference Table");
  lines.push("");
  lines.push("Comparison basis: official `Báo cáo Recap` monthly `Số recap` vs derived `Mentee Tracking` recap totals vs raw `Cleaning data` row counts.");
  lines.push("");
  lines.push(markdownTable(["Month", "Báo cáo Recap", "Mentee Tracking", "Cleaning data", "Mentee diff", "Cleaning diff", "Flag", "Month status"], differenceRows));
  lines.push("");
  lines.push("## Key Findings");
  lines.push("");
  lines.push(`- March 2026 appears present in all three relevant sources: Báo cáo Recap=${recapByMonth.get("2026-03")?.recapCount ?? 0}, Mentee Tracking=${mentee.monthly.get("2026-03")?.recapCount ?? 0}, Cleaning data=${cleaning.monthly.get("2026-03")?.rawCount ?? 0}.`);
  lines.push(`- April 2026 appears in the benchmark/tracking structure, but has zero recap activity and is treated as open/excluded.`);
  lines.push("- `Báo cáo Recap` is the official Season 11 monthly KPI benchmark.");
  lines.push("- `Mentee Tracking` is useful for follow-up and silent mentee logic, but its monthly totals do not fully match the official KPI benchmark.");
  lines.push("- `Cleaning data` is a candidate normalized raw event source, but its row counts do not fully match the official KPI benchmark.");
  lines.push("");
  lines.push("## Recommended Next Step");
  lines.push("");
  lines.push("Review the discrepancy rows for closed months, especially November 2025, January 2026, February 2026, and March 2026, then decide which differences are expected due to deduplication/type rules before designing any import SQL or database changes.");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const xlsxPath = workbookPath();
  const extracted = extractWorkbook(xlsxPath);
  try {
    const sharedStrings = parseSharedStrings(extracted);
    const sheets = parseSheetMap(extracted);
    const parsed = new Map(sheets.map((sheet) => [sheet.name, parseWorksheet(extracted, sheet, sharedStrings)]));
    for (const required of ["Overview", "Báo cáo Recap", "Mentee Tracking", "Cleaning data"]) {
      if (!parsed.has(required)) throw new Error(`Required sheet missing: ${required}`);
    }
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, generateReport({ xlsxPath, sheets, parsed }), "utf8");
    console.log(`Wrote ${OUTPUT_PATH}`);
  } finally {
    fs.rmSync(extracted, { recursive: true, force: true });
  }
}

main();

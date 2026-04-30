import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKBOOK_CANDIDATES = [
  path.resolve(process.cwd(), "TRACKING _ SEASON 11.xlsx"),
  path.resolve(process.cwd(), "..", "VAM_OS_Data_Cleaning", "Input", "TRACKING _ SEASON 11.xlsx"),
  path.resolve("C:/Users/THIS PC/Desktop/VAM 2026/VAM_OS_Data_Cleaning/Input/TRACKING _ SEASON 11.xlsx")
];

const TARGET_MONTH = "2026-03";
const SOURCE_SHEET = "Cleaning data";
const OUTPUT_DIR = path.resolve(process.cwd(), "data_imports", "season11");
const CSV_PATH = path.join(OUTPUT_DIR, "season11_march_source_review.csv");
const REPORT_PATH = path.resolve(process.cwd(), "docs", "data_audit", "SEASON11_MARCH_SOURCE_PREP_REPORT.md");

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

function normalizeKey(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" |")} |`,
    ...rows.map((row) => `| ${row.map((value) => normalizeText(value).replace(/\|/g, "\\|") || "-").join(" | ")} |`)
  ].join("\n");
}

function extractWorkbook(xlsxPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "season11-march-source-"));
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
    const name = decodeXml(attr(sheet, "name"));
    const relId = attr(sheet, "r:id");
    return { name, path: relMap.get(relId) };
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

function parseDate(rawDate, yearValue, monthValue, dayValue) {
  const raw = normalizeText(rawDate);
  const matched = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (matched) {
    const [, day, month, year] = matched;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return "";
}

function extractFirstUrl(...values) {
  const text = values.map((value) => normalizeText(value)).join(" ");
  return /(https?:\/\/[^\s)]+|www\.[^\s)]+)/i.exec(text)?.[0] ?? "";
}

function classifyActivity(row, recapText) {
  const content = normalizeText(recapText).toLowerCase();
  const cross = normalizeText(row[10]).toLowerCase() === "x" || content.includes("#cross") || content.includes("cross mentoring") || content.includes("crossmentoring");
  const training = normalizeText(row[11]).toLowerCase() === "x" || content.includes("#training") || content.includes(" training");
  const companyVisit = normalizeText(row[12]).toLowerCase() === "x" || content.includes("company visit");
  const mentoring = normalizeText(row[9]).toLowerCase() === "x" || (!cross && !training && !companyVisit && (content.includes("#mentoring") || content.includes(" mentoring")));
  if (cross) return "cross_mentoring";
  if (training) return "training";
  if (companyVisit) return "company_visit";
  if (mentoring) return "mentoring";
  return "other";
}

function buildRows(rows, sourceFile) {
  const result = [];
  for (const [rowNumber, row] of rows) {
    if (rowNumber < 4) continue;
    const year = Number(row[0]);
    const month = Number(row[1]);
    if (year !== 2026 || month !== 3) continue;

    const meetingDate = parseDate(row[3], row[0], row[1], row[2]);
    const recapText = normalizeText(row[4]);
    const menteeIdentifier = normalizeText(row[5]);
    const menteeIdentifierEdit = normalizeText(row[6]);
    const mentorName = normalizeText(row[7]);
    const recapReference = normalizeText(row[8]);
    const recapUrl = extractFirstUrl(row[8], row[4]);
    const activityType = classifyActivity(row, recapText);
    const missingMentorIdentifier = !mentorName;
    const missingMenteeIdentifier = !menteeIdentifier && !menteeIdentifierEdit;
    const duplicateSignature = [
      meetingDate,
      normalizeKey(mentorName),
      normalizeKey(menteeIdentifier || menteeIdentifierEdit),
      normalizeKey(recapReference || recapUrl),
      normalizeKey(recapText)
    ].join("|");

    result.push({
      source_row_number: rowNumber,
      source_row_id: `${SOURCE_SHEET}:${rowNumber}`,
      source_sheet: SOURCE_SHEET,
      source_file: path.basename(sourceFile),
      meeting_month: TARGET_MONTH,
      meeting_date: meetingDate,
      raw_date: normalizeText(row[3]),
      mentor_identifier_name: mentorName,
      mentee_identifier_mssv: menteeIdentifier,
      mentee_identifier_edit: menteeIdentifierEdit,
      recap_url: recapUrl,
      recap_reference: recapReference,
      recap_text_excerpt: recapText.slice(0, 500),
      activity_type: activityType,
      is_mentoring: activityType === "mentoring" ? "true" : "false",
      is_cross_mentoring: activityType === "cross_mentoring" ? "true" : "false",
      is_training: activityType === "training" ? "true" : "false",
      is_company_visit: activityType === "company_visit" ? "true" : "false",
      missing_mentor_identifier: missingMentorIdentifier ? "true" : "false",
      missing_mentee_identifier: missingMenteeIdentifier ? "true" : "false",
      duplicate_signature: duplicateSignature,
      duplicate_candidate: "false",
      ready_for_mapping: !missingMentorIdentifier && !missingMenteeIdentifier && meetingDate ? "true" : "false"
    });
  }

  const signatureCounts = new Map();
  for (const row of result) {
    signatureCounts.set(row.duplicate_signature, (signatureCounts.get(row.duplicate_signature) ?? 0) + 1);
  }
  for (const row of result) {
    row.duplicate_candidate = signatureCounts.get(row.duplicate_signature) > 1 ? "true" : "false";
  }
  return result;
}

function writeCsv(rows) {
  const headers = [
    "source_row_number",
    "source_row_id",
    "source_sheet",
    "source_file",
    "meeting_month",
    "meeting_date",
    "raw_date",
    "mentor_identifier_name",
    "mentee_identifier_mssv",
    "mentee_identifier_edit",
    "recap_url",
    "recap_reference",
    "recap_text_excerpt",
    "activity_type",
    "is_mentoring",
    "is_cross_mentoring",
    "is_training",
    "is_company_visit",
    "missing_mentor_identifier",
    "missing_mentee_identifier",
    "duplicate_candidate",
    "ready_for_mapping",
    "duplicate_signature"
  ];
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  fs.writeFileSync(
    CSV_PATH,
    [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n",
    "utf8"
  );
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([name, count]) => [name, count]);
}

function generateReport({ xlsxPath, rows }) {
  const duplicateRows = rows.filter((row) => row.duplicate_candidate === "true");
  const duplicateGroups = new Set(duplicateRows.map((row) => row.duplicate_signature));
  const missingMentor = rows.filter((row) => row.missing_mentor_identifier === "true");
  const missingMentee = rows.filter((row) => row.missing_mentee_identifier === "true");
  const readyForMapping = rows.filter((row) => row.ready_for_mapping === "true");
  const recapUrlRows = rows.filter((row) => row.recap_url);
  const lines = [];

  lines.push("# Season 11 March Source Prep Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Scope Guardrails");
  lines.push("");
  lines.push("- Local workbook extraction only.");
  lines.push("- No Supabase writes.");
  lines.push("- No March import execution.");
  lines.push("- No dashboard RPC rewrite.");
  lines.push("- No deployment.");
  lines.push("");
  lines.push("## Source");
  lines.push("");
  lines.push(`- Workbook: \`${xlsxPath}\``);
  lines.push(`- Sheet: \`${SOURCE_SHEET}\``);
  lines.push(`- Target month: \`${TARGET_MONTH}\``);
  lines.push(`- Review CSV: \`${path.relative(process.cwd(), CSV_PATH).replace(/\\/g, "/")}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(markdownTable(["Metric", "Count"], [
    ["March source rows extracted", rows.length],
    ["Ready for mapping", readyForMapping.length],
    ["Rows with recap_url detected", recapUrlRows.length],
    ["Rows with recap reference text", rows.filter((row) => row.recap_reference).length],
    ["Duplicate candidate rows", duplicateRows.length],
    ["Duplicate candidate groups", duplicateGroups.size],
    ["Missing mentor identifier rows", missingMentor.length],
    ["Missing mentee identifier rows", missingMentee.length]
  ]));
  lines.push("");
  lines.push("## Activity Type Breakdown");
  lines.push("");
  lines.push(markdownTable(["Activity type", "Rows"], countBy(rows, "activity_type")));
  lines.push("");
  lines.push("## Duplicate Candidate Rule");
  lines.push("");
  lines.push("Exact duplicate candidates are flagged by normalized meeting date, mentor name, mentee identifier, recap reference/URL, and recap text. This preserves legitimate multiple recaps in the same month when the recap content/reference differs.");
  lines.push("");
  lines.push("## Mapping Notes");
  lines.push("");
  lines.push("- `mentor_identifier_name` is extracted from `Cleaning data` column `MENTOR`.");
  lines.push("- `mentee_identifier_mssv` is extracted from `Cleaning data` column `TACH MSSV`.");
  lines.push("- `mentee_identifier_edit` is extracted from `Cleaning data` column `EDIT`.");
  lines.push("- `recap_reference` is extracted from `Cleaning data` column `LINK`; many rows contain poster/reference text rather than an HTTP URL.");
  lines.push("- `recap_url` is populated only when an HTTP/HTTPS/www URL is found in the recap reference or recap text.");
  lines.push("");
  lines.push("## Human Review Checklist");
  lines.push("");
  lines.push("- Confirm whether rows without HTTP `recap_url` can use `recap_reference` or another source URL before import.");
  lines.push("- Map mentor names to `people.id` and `mentor_profiles.person_id`.");
  lines.push("- Map mentee MSSV/code/name identifiers to `people.id` and `mentee_profiles.person_id`.");
  lines.push("- Review duplicate candidate rows manually; remove exact duplicates only.");
  lines.push("- Preserve distinct multiple recap rows per mentee/month.");
  lines.push("- Confirm accepted reconciliation between `Bao cao Recap` 271, `Mentee Tracking` 275, and `Cleaning data` 286.");
  lines.push("");
  lines.push("## Readiness");
  lines.push("");
  lines.push(rows.length
    ? "The source CSV is ready for human review, not import execution."
    : "No March rows were extracted; source CSV is not ready.");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const xlsxPath = workbookPath();
  const extracted = extractWorkbook(xlsxPath);
  try {
    const sharedStrings = parseSharedStrings(extracted);
    const sheets = parseSheetMap(extracted);
    const sheet = sheets.find((candidate) => candidate.name === SOURCE_SHEET);
    if (!sheet) throw new Error(`Required sheet missing: ${SOURCE_SHEET}`);
    const parsed = parseWorksheet(extracted, sheet, sharedStrings);
    const rows = buildRows(parsed, xlsxPath);

    writeCsv(rows);
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, generateReport({ xlsxPath, rows }), "utf8");

    const duplicateCandidateCount = rows.filter((row) => row.duplicate_candidate === "true").length;
    const missingMentorCount = rows.filter((row) => row.missing_mentor_identifier === "true").length;
    const missingMenteeCount = rows.filter((row) => row.missing_mentee_identifier === "true").length;
    console.log(`Wrote ${CSV_PATH}`);
    console.log(`Wrote ${REPORT_PATH}`);
    console.log(`March source rows: ${rows.length}`);
    console.log(`Duplicate candidate rows: ${duplicateCandidateCount}`);
    console.log(`Missing mentor identifier rows: ${missingMentorCount}`);
    console.log(`Missing mentee identifier rows: ${missingMenteeCount}`);
  } finally {
    fs.rmSync(extracted, { recursive: true, force: true });
  }
}

main();

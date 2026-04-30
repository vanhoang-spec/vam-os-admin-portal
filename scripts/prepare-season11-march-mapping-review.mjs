import fs from "node:fs";
import path from "node:path";

const SOURCE_CSV = path.resolve(process.cwd(), "data_imports", "season11", "season11_march_source_review.csv");
const OUTPUT_CSV = path.resolve(process.cwd(), "data_imports", "season11", "season11_march_mapping_review.csv");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const [headers, ...dataRows] = rows;
  return dataRows
    .filter((dataRow) => dataRow.some((cell) => String(cell ?? "").trim()))
    .map((dataRow) => Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ""])));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function mappingStatus(row) {
  if (row.duplicate_candidate === "true") return "duplicate_candidate";
  if (row.missing_mentor_identifier === "true") return "missing_mentor";
  if (row.missing_mentee_identifier === "true") return "missing_mentee";
  return "needs_review";
}

function reviewNote(row, status) {
  const notes = [];
  if (status === "needs_review") notes.push("Needs Supabase SELECT-only ID mapping export.");
  if (row.missing_mentor_identifier === "true") notes.push("Missing mentor raw identifier/name.");
  if (row.missing_mentee_identifier === "true") notes.push("Missing mentee raw identifier/MSSV.");
  if (row.duplicate_candidate === "true") notes.push("Exact duplicate candidate; review before import.");
  if (!row.recap_url && row.recap_reference) notes.push("No HTTP recap_url; review whether recap_reference can be used.");
  if (!row.recap_url && !row.recap_reference) notes.push("No recap_url or recap_reference.");
  return notes.join(" ");
}

function buildRows(sourceRows) {
  return sourceRows.map((row) => {
    const status = mappingStatus(row);
    return {
      source_row_id: row.source_row_id,
      source_row_number: row.source_row_number,
      meeting_date: row.meeting_date,
      meeting_month: row.meeting_month,
      activity_type: row.activity_type,
      mentee_raw_identifier_mssv: row.mentee_identifier_mssv,
      mentee_raw_identifier_edit: row.mentee_identifier_edit,
      mentor_raw_identifier_name: row.mentor_identifier_name,
      recap_reference: row.recap_reference,
      recap_url: row.recap_url,
      source_missing_mentor_identifier: row.missing_mentor_identifier,
      source_missing_mentee_identifier: row.missing_mentee_identifier,
      source_duplicate_candidate: row.duplicate_candidate,
      proposed_mentee_person_id: "",
      proposed_mentor_person_id: "",
      proposed_match_id: "",
      mapping_status: status,
      review_note: reviewNote(row, status),
      approved_for_import: "false"
    };
  });
}

function writeCsv(rows) {
  const headers = [
    "source_row_id",
    "source_row_number",
    "meeting_date",
    "meeting_month",
    "activity_type",
    "mentee_raw_identifier_mssv",
    "mentee_raw_identifier_edit",
    "mentor_raw_identifier_name",
    "recap_reference",
    "recap_url",
    "source_missing_mentor_identifier",
    "source_missing_mentee_identifier",
    "source_duplicate_candidate",
    "proposed_mentee_person_id",
    "proposed_mentor_person_id",
    "proposed_match_id",
    "mapping_status",
    "review_note",
    "approved_for_import"
  ];
  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(
    OUTPUT_CSV,
    [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n",
    "utf8"
  );
}

function main() {
  if (!fs.existsSync(SOURCE_CSV)) {
    throw new Error(`Source CSV not found: ${SOURCE_CSV}`);
  }
  const sourceRows = parseCsv(fs.readFileSync(SOURCE_CSV, "utf8"));
  const mappingRows = buildRows(sourceRows);
  writeCsv(mappingRows);
  const counts = mappingRows.reduce((acc, row) => {
    acc[row.mapping_status] = (acc[row.mapping_status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${OUTPUT_CSV}`);
  console.log(`Rows: ${mappingRows.length}`);
  console.log(JSON.stringify(counts, null, 2));
}

main();

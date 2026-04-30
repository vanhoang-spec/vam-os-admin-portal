import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const inputPath = resolve(repoRoot, "docs/data_enrichment/mentor_enrichment_full_review.csv");
const sqlOutputPath = resolve(repoRoot, "docs/data_enrichment/mentor_enrichment_update.sql");
const previewOutputPath = resolve(repoRoot, "docs/data_enrichment/mentor_enrichment_dry_run_preview_10.csv");
const summaryOutputPath = resolve(repoRoot, "docs/data_enrichment/mentor_enrichment_import_summary.md");

const OUTPUT_COLUMNS = [
  "person_id",
  "full_name",
  "current_industry",
  "proposed_industry",
  "current_function_area",
  "proposed_function_area",
  "will_update_industry",
  "will_update_function_area"
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((csvRow) => csvRow.some((value) => value.trim() !== ""));
}

function toCsvValue(value) {
  const stringValue = String(value ?? "");
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function firstValue(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .find(Boolean) ?? "";
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

if (!existsSync(inputPath)) {
  console.error(`Missing input CSV: ${inputPath}`);
  process.exit(1);
}

const [header, ...dataRows] = parseCsv(readFileSync(inputPath, "utf8"));
const columnIndex = new Map(header.map((column, index) => [column.replace(/^\uFEFF/, "").trim(), index]));
const get = (row, column) => row[columnIndex.get(column)] ?? "";

const highRows = dataRows.filter((row) => get(row, "confidence").trim().toLowerCase() === "high");
const eligibleRows = highRows
  .map((row) => {
    const proposedIndustry = firstValue(get(row, "industry_experience_list") || get(row, "primary_industry"));
    const proposedFunction = firstValue(get(row, "function_experience_list") || get(row, "primary_function"));
    return {
      person_id: get(row, "person_id").trim(),
      full_name: get(row, "full_name").trim(),
      proposed_industry: proposedIndustry,
      proposed_function_area: proposedFunction
    };
  })
  .filter((row) => row.person_id && row.proposed_industry && row.proposed_function_area);

const skippedMissingQa = highRows.length - eligibleRows.length;

const valuesSql = eligibleRows
  .map((row) => `    (${sqlString(row.person_id)}::uuid, ${sqlString(row.full_name)}, ${sqlString(row.proposed_industry)}, ${sqlString(row.proposed_function_area)})`)
  .join(",\n");

const proposedCte = `proposed(person_id, full_name, proposed_industry, proposed_function_area) as (
  values
${valuesSql}
)`;

const dryRunSql = `with
${proposedCte}
select
  p.person_id,
  p.full_name,
  mp.industry as current_industry,
  p.proposed_industry,
  mp.function_area as current_function_area,
  p.proposed_function_area,
  (nullif(trim(coalesce(mp.industry, '')), '') is null) as will_update_industry,
  (nullif(trim(coalesce(mp.function_area, '')), '') is null) as will_update_function_area
from proposed p
join public.mentor_profiles mp on mp.person_id = p.person_id
where nullif(trim(coalesce(mp.industry, '')), '') is null
   or nullif(trim(coalesce(mp.function_area, '')), '') is null
order by p.full_name nulls last, p.person_id`;

const updateSql = `with
${proposedCte},
to_update as (
  select
    mp.person_id,
    mp.industry as old_industry,
    mp.function_area as old_function_area,
    p.proposed_industry,
    p.proposed_function_area
  from public.mentor_profiles mp
  join proposed p on p.person_id = mp.person_id
  where nullif(trim(coalesce(mp.industry, '')), '') is null
     or nullif(trim(coalesce(mp.function_area, '')), '') is null
),
updated as (
  update public.mentor_profiles mp
  set
    industry = case
      when nullif(trim(coalesce(mp.industry, '')), '') is null then tu.proposed_industry
      else mp.industry
    end,
    function_area = case
      when nullif(trim(coalesce(mp.function_area, '')), '') is null then tu.proposed_function_area
      else mp.function_area
    end
  from to_update tu
  where mp.person_id = tu.person_id
  returning
    mp.person_id,
    tu.old_industry,
    mp.industry as new_industry,
    tu.old_function_area,
    mp.function_area as new_function_area
)
select * from updated
order by person_id`;

const sql = `-- Mentor enrichment import, generated from docs/data_enrichment/mentor_enrichment_full_review.csv
-- Scope: high-confidence rows only; no overwrite of existing mentor_profiles.industry/function_area.
-- Safety: this script ends with ROLLBACK by default. Change ROLLBACK to COMMIT only after manual confirmation.
-- QA: generated candidates have non-null proposed industry and proposed function.

-- Candidate counts:
-- high-confidence rows in review CSV: ${highRows.length}
-- eligible rows with proposed industry and function: ${eligibleRows.length}
-- high-confidence rows skipped because industry/function was blank: ${skippedMissingQa}

-- DRY RUN: before/after preview of rows that would be affected.
${dryRunSql};

-- UPDATE WITH AUDIT RETURNING.
-- This transaction is intentionally rolled back by default.
begin;

${updateSql};

rollback;
-- Change the line above to COMMIT only after reviewing dry-run output and getting production write confirmation.
`;

writeFileSync(sqlOutputPath, sql, "utf8");

const previewRows = eligibleRows.slice(0, 10).map((row) => ({
  person_id: row.person_id,
  full_name: row.full_name,
  current_industry: "(checked by SQL dry run)",
  proposed_industry: row.proposed_industry,
  current_function_area: "(checked by SQL dry run)",
  proposed_function_area: row.proposed_function_area,
  will_update_industry: "(only if blank)",
  will_update_function_area: "(only if blank)"
}));

const previewCsv = [
  OUTPUT_COLUMNS.join(","),
  ...previewRows.map((row) => OUTPUT_COLUMNS.map((column) => toCsvValue(row[column])).join(","))
].join("\n");
writeFileSync(previewOutputPath, `\uFEFF${previewCsv}\n`, "utf8");

const industryCounts = new Map();
const functionCounts = new Map();
for (const row of eligibleRows) {
  industryCounts.set(row.proposed_industry, (industryCounts.get(row.proposed_industry) ?? 0) + 1);
  functionCounts.set(row.proposed_function_area, (functionCounts.get(row.proposed_function_area) ?? 0) + 1);
}

const sortedCounts = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const summary = [
  "# Mentor Enrichment Import Summary",
  "",
  "Generated from `docs/data_enrichment/mentor_enrichment_full_review.csv`.",
  "",
  "No Supabase data was updated by this generation step. No UI was modified.",
  "",
  "## Counts",
  "",
  markdownTable(
    ["metric", "count"],
    [
      ["high-confidence rows in review CSV", highRows.length],
      ["eligible rows with proposed industry and function", eligibleRows.length],
      ["high-confidence rows skipped because industry/function was blank", skippedMissingQa],
      ["maximum rows that can be affected if every target field is blank", eligibleRows.length],
      ["actual rows affected", "computed by SQL dry-run in Supabase before COMMIT"]
    ]
  ),
  "",
  "## QA Checks",
  "",
  markdownTable(
    ["check", "result"],
    [
      ["no null primary_function in eligible rows", eligibleRows.every((row) => row.proposed_function_area) ? "PASS" : "FAIL"],
      ["no null primary_industry in eligible rows", eligibleRows.every((row) => row.proposed_industry) ? "PASS" : "FAIL"],
      ["script does not overwrite existing DB values", "PASS - SQL only updates blank target fields"],
      ["production write confirmation required", "PASS - generated SQL rolls back by default"]
    ]
  ),
  "",
  "## Proposed Primary Industry Counts",
  "",
  markdownTable(["primary_industry", "count"], sortedCounts(industryCounts)),
  "",
  "## Proposed Primary Function Counts",
  "",
  markdownTable(["primary_function", "count"], sortedCounts(functionCounts)),
  "",
  "## Dry-Run Preview",
  "",
  `See \`docs/data_enrichment/mentor_enrichment_dry_run_preview_10.csv\` for 10 generated candidate rows.`,
  "",
  "Run the dry-run SELECT section in `docs/data_enrichment/mentor_enrichment_update.sql` in Supabase SQL Editor to see real current DB values and actual affected rows before any write.",
  ""
].join("\n");

writeFileSync(summaryOutputPath, summary, "utf8");

console.log(`Wrote SQL script: ${sqlOutputPath}`);
console.log(`Wrote dry-run preview: ${previewOutputPath}`);
console.log(`Wrote import summary: ${summaryOutputPath}`);
console.log(`High-confidence rows: ${highRows.length}`);
console.log(`Eligible rows: ${eligibleRows.length}`);
console.log(`Skipped by QA: ${skippedMissingQa}`);

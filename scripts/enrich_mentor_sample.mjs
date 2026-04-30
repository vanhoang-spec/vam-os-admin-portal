import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const inputPath = resolve(repoRoot, "docs/data_enrichment/production_mentor_export.csv");
const sampleOutputPath = resolve(repoRoot, "docs/data_enrichment/mentor_enrichment_sample_50.csv");
const fullOutputPath = resolve(repoRoot, "docs/data_enrichment/mentor_enrichment_full_review.csv");
const summaryPath = resolve(repoRoot, "docs/data_enrichment/mentor_enrichment_summary.md");

const OUTPUT_COLUMNS = [
  "person_id",
  "full_name",
  "email",
  "company_current",
  "title_current",
  "bio_url",
  "primary_industry",
  "industry_experience_list",
  "primary_function",
  "function_experience_list",
  "confidence",
  "reviewer_note"
];

const EXPORT_SQL = `select
  mp.person_id,
  p.full_name,
  p.email_primary as email,
  mp.company_current,
  mp.title_current,
  mp.bio_url
from public.mentor_profiles mp
left join public.people p on p.id = mp.person_id
order by p.full_name nulls last, mp.person_id;`;

function printMissingInputInstructions() {
  console.error(`Missing input CSV: ${inputPath}`);
  console.error("");
  console.error("Export it from Supabase Production SQL Editor with this query:");
  console.error("");
  console.error(EXPORT_SQL);
  console.error("");
  console.error("Download the result as CSV and save it as:");
  console.error("docs/data_enrichment/production_mentor_export.csv");
}

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

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

function hasText(value) {
  const text = normalize(value).trim();
  return Boolean(text && text !== "null" && text !== "undefined" && text !== "-");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function hasAnyWord(text, keywords) {
  return keywords.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  });
}

function inferIndustry(company, title) {
  const companyText = normalize(company);
  const text = normalize(`${company} ${title}`);
  const values = [];
  let hasClearMatch = false;

  const companyRules = [
    ["Consumer Goods", ["unilever", "nestle", "p&g", "procter", "coca-cola", "coca cola", "pepsico"]],
    ["Healthcare", ["abbott", "pharmacity", "hospital", "healthcare", "pharma", "medical", "clinic"]],
    ["Consulting", ["kpmg", "deloitte", "pwc", "ey", "bcg", "mckinsey", "bain"]],
    ["Insurance", ["generali", "aia", "prudential", "manulife", "bao viet", "dai-ichi", "dai ichi"]],
    ["Banking", ["seabank", "vietcombank", "techcombank", "bidv", "vpbank", "mb bank", "acb", "sacombank"]],
    ["Logistics & Supply Chain", ["maersk", "gemadept", "dhl"]],
    ["Advertising / Marketing Tech", ["mgid"]],
    ["Financial Services", ["hsc", "ssi", "vndirect", "chung khoan", "securities"]],
    ["Apparel / Retail", ["vf corporation", "apparel", "fashion", "garment", "textile", "cosmetics"]],
    ["E-commerce / Digital Commerce", ["onpoint", "e-commerce", "ecommerce", "digital commerce", "the gioi di dong"]],
    ["Finance", ["momo", "zalopay", "vnpay"]],
    ["Technology", ["fpt software", "vng", "tiki", "shopee", "lazada"]]
  ];

  for (const [label, keywords] of companyRules) {
    if (includesAny(companyText, keywords)) {
      values.push(label);
      hasClearMatch = true;
    }
  }

  if (hasAnyWord(text, ["banking", "bank"])) values.push("Banking");
  if (includesAny(text, ["insurance", "bao hiem"])) values.push("Insurance");
  if (hasAnyWord(text, ["finance", "financial", "fintech", "fund", "investment"])) values.push("Finance");
  if (hasAnyWord(text, ["consulting", "consultant", "consult"])) values.push("Consulting");
  if (includesAny(text, ["software", "information technology", "technology company"])) values.push("Technology");
  if (includesAny(text, ["university", "school", "education", "teacher", "lecturer", "training", "ueh", "fulbright"])) values.push("Education");
  if (includesAny(text, ["hospital", "health", "healthcare", "pharma", "medical", "clinic"])) values.push("Healthcare");
  if (includesAny(text, ["logistics", "supply chain", "warehouse", "shipping", "xuat nhap khau", "gemadept", "dhl", "maersk"])) values.push("Logistics & Supply Chain");
  if (includesAny(text, ["manufacturing", "factory", "production", "san xuat", "co khi", "vinfast", "bosch", "samsung"])) values.push("Manufacturing");
  if (includesAny(text, ["fmcg", "consumer", "unilever", "nestle", "p&g", "coca", "pepsico"])) values.push("Consumer Goods");
  if (includesAny(text, ["marketing", "media", "agency", "communications", "advertising", "creative"])) values.push("Marketing & Communications");
  if (includesAny(text, ["real estate", "property", "land", "housing", "xay dung", "construction", "dia oc"])) values.push("Real Estate");
  if (includesAny(text, ["hotel", "hospitality", "tourism", "travel", "restaurant"])) values.push("Hospitality");
  if (includesAny(text, ["startup", "founder", "venture", "vc", "accelerator"])) values.push("Venture Capital & Startups");
  if (includesAny(text, ["ngo", "nonprofit", "social impact", "undp", "unicef"])) values.push("Nonprofit & Social Impact");
  if (hasAnyWord(text, ["law", "legal", "lawyer", "attorney", "luat"])) values.push("Legal");
  if (includesAny(text, ["retail", "store", "ecommerce", "e-commerce", "thuong mai"])) values.push("Retail");
  if (includesAny(text, ["energy", "power", "solar", "renewable", "electricity"])) values.push("Energy");
  if (includesAny(text, ["telecom", "telecommunications", "viettel", "vinaphone", "mobifone"])) values.push("Telecommunications");

  return { values: uniq(values), hasClearMatch };
}

function inferFunction(title) {
  const titleText = normalize(title);
  const values = [];
  let hasClearMatch = false;

  if (hasAnyWord(titleText, ["ceo", "founder", "co-founder", "cofounder", "entrepreneur", "owner"])) {
    values.push("Entrepreneurship");
    hasClearMatch = true;
  }
  if (includesAny(titleText, ["giam doc chi nhanh"])) {
    values.push("Leadership", "Sales");
    hasClearMatch = true;
  }
  if (includesAny(titleText, ["giam doc", "pho tong giam doc", "ptgd", "director", "deputy director", "head", "vp", "vice president", "truong phong", "truong bo phan"])) {
    values.push("Leadership");
  }
  if (hasAnyWord(titleText, ["cfo", "finance", "financial", "treasury", "controller"]) || includesAny(titleText, ["fp&a", "tai chinh", "phan tich tai chinh"])) {
    values.push("Finance");
    hasClearMatch = true;
  }
  if (includesAny(titleText, ["business development"]) || hasAnyWord(titleText, ["bd"])) {
    values.push("Business Development");
    hasClearMatch = true;
  }
  if (includesAny(titleText, ["kinh doanh"])) {
    values.push("Sales", "Business Development");
    hasClearMatch = true;
  }
  if (hasAnyWord(titleText, ["marketing", "brand", "communications", "content", "pr", "advertising"]) || includesAny(titleText, ["social media", "truyen thong"])) {
    values.push("Marketing");
    hasClearMatch = true;
  }
  if (hasAnyWord(titleText, ["sales", "commercial"]) || includesAny(titleText, ["account executive"])) {
    values.push("Sales");
    hasClearMatch = true;
  }
  if (hasAnyWord(titleText, ["consultant", "consulting", "advisor"]) || includesAny(titleText, ["tu van"])) {
    values.push("Consulting");
    hasClearMatch = true;
  }
  if (includesAny(titleText, ["human resources", "c&b", "compensation", "benefits", "nhan su"]) || hasAnyWord(titleText, ["hr", "people", "talent", "recruitment", "recruiter"])) {
    values.push("Human Resources");
    hasClearMatch = true;
  }

  if (includesAny(titleText, ["product", "product owner"]) || hasAnyWord(titleText, ["po"])) values.push("Product");
  if (includesAny(titleText, ["project", "program", "scrum"]) || hasAnyWord(titleText, ["pm"])) values.push("Project Management");
  if (includesAny(titleText, ["operation", "operations", "supply chain", "logistics", "san xuat", "xuat nhap khau"]) || hasAnyWord(titleText, ["ops"])) {
    values.push("Operations");
    if (includesAny(titleText, ["san xuat", "xuat nhap khau"])) hasClearMatch = true;
  }
  if (includesAny(titleText, ["strategy", "strategic", "chief of staff", "business analyst"])) values.push("Strategy");
  if (includesAny(titleText, ["partnership", "growth"])) values.push("Business Development");
  if (includesAny(titleText, ["accounting", "audit", "auditor", "tax", "ke toan"])) values.push("Accounting");
  if (includesAny(titleText, ["investment", "investor", "portfolio", "private equity", "venture capital"])) values.push("Investment");
  if (includesAny(titleText, ["data", "analytics", "analyst", "business intelligence"]) || hasAnyWord(titleText, ["bi"])) values.push("Analytics");
  if (includesAny(titleText, ["engineer", "developer", "software", "technical", "architect"])) values.push("Engineering");
  if (includesAny(titleText, ["design", "designer"]) || hasAnyWord(titleText, ["ux", "ui"])) values.push("Design");
  if (hasAnyWord(titleText, ["legal", "lawyer", "counsel"]) || includesAny(titleText, ["luat"])) values.push("Legal");
  if (includesAny(titleText, ["teacher", "lecturer", "trainer", "coach", "teaching", "dao tao", "khai van"])) {
    values.push("Teaching & Training");
    if (includesAny(titleText, ["dao tao", "khai van"])) hasClearMatch = true;
  }
  if (includesAny(titleText, ["research", "researcher", "scientist"])) values.push("Research");
  if (includesAny(titleText, ["customer success", "customer service", "client success", "cham soc khach hang"])) values.push("Customer Success");

  const uniqueValues = uniq(values);
  if (hasText(titleText) && uniqueValues.length === 0) {
    if (includesAny(titleText, ["manager", "specialist", "executive", "officer", "chuyen vien", "npp"])) {
      uniqueValues.push("Operations");
    } else {
      uniqueValues.push("Leadership");
    }
  }

  return { values: uniqueValues, hasClearMatch };
}

function confidenceFor(industryResult, functionResult, title, company) {
  if (!hasText(title) && !hasText(company)) return "low";
  if (industryResult.hasClearMatch || functionResult.hasClearMatch) return "high";
  if (industryResult.values.length || functionResult.values.length) return "medium";
  return "medium";
}

function buildReviewerNote(industryValues, functionValues, confidence) {
  if (!industryValues.length && !functionValues.length) {
    return "No deterministic keyword match from company_current/title_current. Review bio/profile later; do not infer from URL alone.";
  }
  if (confidence === "high") {
    return "Clear deterministic keyword suggestion from company_current/title_current; human review required.";
  }
  return "Inferred deterministic suggestion from company_current/title_current; human review required.";
}

function buildRows(limit = null) {
  if (!existsSync(inputPath)) {
    printMissingInputInstructions();
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(inputPath, "utf8"));
  const [header, ...dataRows] = rows;
  const columnIndex = new Map(header.map((column, index) => [column.replace(/^\uFEFF/, "").trim(), index]));

  function get(row, column) {
    return row[columnIndex.get(column)] ?? "";
  }

  return dataRows.slice(0, limit ?? dataRows.length).map((row) => {
    const company = get(row, "company_current");
    const title = get(row, "title_current");
    const industryResult = inferIndustry(company, title);
    const functionResult = inferFunction(title);
    const industries = industryResult.values;
    const functions = functionResult.values;
    const confidence = confidenceFor(industryResult, functionResult, title, company);

    return {
      person_id: get(row, "person_id"),
      full_name: get(row, "full_name"),
      email: get(row, "email"),
      company_current: company,
      title_current: title,
      bio_url: get(row, "bio_url"),
      primary_industry: industries[0] ?? "",
      industry_experience_list: industries.join(", "),
      primary_function: functions[0] ?? "",
      function_experience_list: functions.join(", "),
      confidence,
      reviewer_note: buildReviewerNote(industries, functions, confidence)
    };
  });
}

function writeCsv(path, rows) {
  const csv = [
    OUTPUT_COLUMNS.join(","),
    ...rows.map((row) => OUTPUT_COLUMNS.map((column) => toCsvValue(row[column])).join(","))
  ].join("\n");
  writeFileSync(path, `\uFEFF${csv}\n`, "utf8");
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = String(row[key] || "Unclassified");
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function writeSummary(rows) {
  const confidenceCounts = countBy(rows, "confidence");
  const industryCounts = countBy(rows, "primary_industry");
  const functionCounts = countBy(rows, "primary_function");
  const lowRows = rows.filter((row) => row.confidence === "low");

  const summary = [
    "# Mentor Enrichment Summary",
    "",
    "Generated from `docs/data_enrichment/production_mentor_export.csv` using deterministic role-aware classification.",
    "",
    "No Supabase data was updated. No UI was modified.",
    "",
    `Total rows: ${rows.length}`,
    "",
    "## Confidence",
    "",
    markdownTable(["confidence", "count"], confidenceCounts),
    "",
    "## Primary Industry",
    "",
    markdownTable(["primary_industry", "count"], industryCounts),
    "",
    "## Primary Function",
    "",
    markdownTable(["primary_function", "count"], functionCounts),
    "",
    `## Low-Confidence Rows (${lowRows.length})`,
    "",
    lowRows.length
      ? markdownTable(
          ["person_id", "full_name", "company_current", "title_current"],
          lowRows.map((row) => [
            row.person_id,
            row.full_name,
            String(row.company_current || "").replaceAll("|", "\\|"),
            String(row.title_current || "").replaceAll("|", "\\|")
          ])
        )
      : "No low-confidence rows.",
    ""
  ].join("\n");

  writeFileSync(summaryPath, summary, "utf8");
}

const sampleRows = buildRows(50);
const fullRows = buildRows();
writeCsv(sampleOutputPath, sampleRows);
writeCsv(fullOutputPath, fullRows);
writeSummary(fullRows);

console.log(`Wrote ${sampleRows.length} rows to ${sampleOutputPath}`);
console.log(`Wrote ${fullRows.length} rows to ${fullOutputPath}`);
console.log(`Wrote summary to ${summaryPath}`);

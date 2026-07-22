import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_INPUT = "docs/audits/inputs/VAM_OS_PRODUCTION_BASELINE_GAPS_2026-07-22.json";
const DEFAULT_OUTPUT = "docs/audits/VAM_OS_PRODUCTION_BASELINE_GAPS_SANITIZED_SUMMARY_2026-07-22.json";
const EXPECTED_SECTIONS = ["enums", "public_types", "views", "view_dependencies", "sequences", "sequence_ownership", "functions", "triggers", "comments"];
const SUSPICIOUS = [
  ["email", /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i],
  ["phone", /(?:\+?84|0)(?:[ .-]?\d){8,10}/],
  ["jwt", /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/],
  ["secret_or_password", /(?:password|passwd|secret|service[_-]?role|api[_-]?key)\s*[:=]\s*[^\s,;]+/i],
  ["connection_string", /(?:postgres(?:ql)?|supabase):\/\/[^\s"']+/i],
  ["bearer_token", /bearer\s+[a-z0-9._~-]{12,}/i]
];

function collectStrings(value, path = "$", found = []) {
  if (typeof value === "string") found.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, found));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => collectStrings(item, `${path}.${key}`, found));
  return found;
}

function fail(message) {
  console.error(`Validation failed: ${message}`);
  process.exitCode = 1;
}

const inputPath = resolve(process.argv[2] || DEFAULT_INPUT);
const outputPath = resolve(process.argv[3] || DEFAULT_OUTPUT);
let raw;
try { raw = await readFile(inputPath, "utf8"); } catch { fail("input file is missing or unreadable"); }

if (raw !== undefined) {
  let data;
  try { data = JSON.parse(raw); } catch { fail("input is invalid or truncated JSON"); }
  if (data !== undefined) {
    const missingSections = EXPECTED_SECTIONS.filter((key) => !Array.isArray(data?.[key]));
    const unexpectedKeys = Object.keys(data ?? {}).filter((key) => key !== "probe_version" && !EXPECTED_SECTIONS.includes(key));
    const versionValid = data?.probe_version === "vam-os-baseline-gaps-single-result-v1";
    const strings = collectStrings(data);
    const findings = Object.fromEntries(SUSPICIOUS.map(([name, pattern]) => [name, strings.filter(({ value }) => pattern.test(value)).length]));
    const riskyFindingCount = Object.values(findings).reduce((sum, count) => sum + count, 0);
    const safe = versionValid && missingSections.length === 0 && riskyFindingCount === 0;
    const dependencySchemaCounts = Object.fromEntries(
      [...new Set((data.sequence_ownership ?? []).map((row) => String(row.table_schema)))].sort()
        .map((schema) => [schema, data.sequence_ownership.filter((row) => String(row.table_schema) === schema).length])
    );
    const sequenceMetadataConsistent = (data.sequences?.length ?? 0) > 0 || (data.sequence_ownership?.length ?? 0) === 0;
    const summary = {
      parser_mode: "offline-metadata-safety-review",
      input_bytes: Buffer.byteLength(raw, "utf8"),
      json_valid: true,
      probe_version_valid: versionValid,
      missing_sections: missingSections,
      unexpected_top_level_keys: unexpectedKeys,
      section_counts: Object.fromEntries(EXPECTED_SECTIONS.map((key) => [key, Array.isArray(data?.[key]) ? data[key].length : null])),
      truncation_detected: false,
      actual_public_sequences: data.sequences.length,
      sequence_metadata_consistent: sequenceMetadataConsistent,
      sequence_ownership_classification: sequenceMetadataConsistent ? "SCOPED_TO_ACTUAL_SEQUENCES" : "GENERAL_DEPENDENCY_ROWS_NOT_SEQUENCE_OWNERSHIP",
      dependency_schema_counts: dependencySchemaCounts,
      suspicious_pattern_counts: findings,
      safe_for_offline_analysis: safe,
      raw_file_commit_allowed: false
    };
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`Offline validation complete. Sanitized summary written. Safe: ${safe ? "YES" : "NO"}.`);
    if (!safe) process.exitCode = 2;
  }
}

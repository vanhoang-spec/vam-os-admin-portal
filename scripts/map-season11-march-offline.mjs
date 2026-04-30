import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IMPORT_DIR = path.resolve(ROOT, "data_imports", "season11");

const SOURCE_CSV = path.join(IMPORT_DIR, "season11_march_source_review.csv");
const OUTPUT_CSV = path.join(IMPORT_DIR, "season11_march_ready_for_import.csv");
const REPORT_PATH = path.resolve(ROOT, "docs", "data_audit", "SEASON11_MARCH_MAPPING_RESULT_REPORT.md");

const REFERENCE_SOURCES = {
  staging: {
    dir: path.join(IMPORT_DIR, "reference_exports"),
    files: {
      people: "people_staging.csv",
      mentees: "mentee_profiles_staging.csv",
      mentors: "mentor_profiles_staging.csv",
      matches: "matches_uehm_s11_staging.csv",
      existingRecaps: "mentoring_recaps_march_2026_staging.csv"
    }
  },
  production: {
    dir: path.join(IMPORT_DIR, "reference_exports_production"),
    files: {
      people: "people_production.csv",
      mentees: "mentee_profiles_production.csv",
      mentors: "mentor_profiles_production.csv",
      matches: "matches_uehm_s11_production.csv",
      existingRecaps: "mentoring_recaps_march_2026_production.csv"
    }
  }
};

const OUTPUT_HEADERS = [
  "source_row_id",
  "source_sheet",
  "source_file",
  "meeting_date",
  "meeting_month",
  "mentor_person_id",
  "mentee_person_id",
  "match_id",
  "recap_url",
  "recap_note",
  "meeting_type",
  "mapping_status",
  "mapping_notes",
  "approved_for_import",
  "review_note"
];

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

  const [headers = [], ...dataRows] = rows;
  return dataRows
    .filter((dataRow) => dataRow.some((cell) => clean(cell)))
    .map((dataRow) => Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ""])));
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required CSV not found: ${filePath}`);
  }
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function parseReferenceSource() {
  const sourceArg = process.argv.find((arg) => arg.startsWith("--reference-source="));
  const positionalSource = process.argv.find((arg) => ["staging", "production"].includes(arg));
  const selected = clean(sourceArg?.split("=")[1] ?? positionalSource ?? process.env.SEASON11_REFERENCE_SOURCE ?? "staging").toLowerCase();
  if (!REFERENCE_SOURCES[selected]) {
    throw new Error(`Unsupported reference source "${selected}". Use "staging" or "production".`);
  }
  return selected;
}

function referenceFiles(referenceSource) {
  const config = REFERENCE_SOURCES[referenceSource];
  return Object.fromEntries(
    Object.entries(config.files).map(([key, fileName]) => [key, path.join(config.dir, fileName)])
  );
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text.toLowerCase() === "null" ? "" : text;
}

function normalizeKey(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function extractEmail(value) {
  return clean(value).match(/[^\s<>()"]+@[^\s<>()"]+\.[^\s<>()"]+/)?.[0] ?? "";
}

function isHttpUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function finalRecapUrl(row) {
  const sourceUrl = clean(row.recap_url);
  if (isHttpUrl(sourceUrl)) return sourceUrl;

  const reference = clean(row.recap_reference);
  if (reference) {
    return `https://system.local/missing-url?ref=${encodeURIComponent(reference)}`;
  }
  return "https://system.local/missing-url";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function addIndex(map, key, value) {
  if (!key) return;
  const existing = map.get(key) ?? [];
  existing.push(value);
  map.set(key, existing);
}

function uniqueRows(rows, idField = "id") {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const id = clean(row[idField]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(row);
  }
  return result;
}

function resolveOne(candidates, notes, label, method) {
  const unique = uniqueRows(candidates);
  if (unique.length === 1) {
    notes.push(`${label} mapped by ${method}.`);
    return { id: clean(unique[0].id), ambiguous: false };
  }
  if (unique.length > 1) {
    notes.push(`${label} ${method} mapping is ambiguous (${unique.length} candidates).`);
    return { id: "", ambiguous: true };
  }
  return { id: "", ambiguous: false };
}

function buildReferences(referenceSource) {
  const files = referenceFiles(referenceSource);
  const people = readCsv(files.people);
  const mentees = readCsv(files.mentees);
  const mentors = readCsv(files.mentors);
  const matches = readCsv(files.matches);
  const existingRecaps = readCsv(files.existingRecaps);

  const peopleById = new Map(people.map((person) => [clean(person.id), person]));
  const menteeProfilePersonIds = new Set(mentees.map((profile) => clean(profile.person_id)).filter(Boolean));
  const mentorProfilePersonIds = new Set(mentors.map((profile) => clean(profile.person_id)).filter(Boolean));

  const menteeByCode = new Map();
  const menteeByEmail = new Map();
  const menteeByName = new Map();
  const mentorByEmail = new Map();
  const mentorByName = new Map();

  for (const profile of mentees) {
    const person = peopleById.get(clean(profile.person_id));
    if (!person) continue;
    const candidate = { ...person, profile_id: profile.id };
    addIndex(menteeByCode, normalizeCode(profile.mssv), candidate);
    addIndex(menteeByCode, normalizeCode(profile.mentee_code), candidate);
    addIndex(menteeByCode, normalizeCode(profile.student_code), candidate);
    addIndex(menteeByEmail, normalizeEmail(person.email_primary), candidate);
    addIndex(menteeByEmail, normalizeEmail(person.email), candidate);
    addIndex(menteeByName, normalizeKey(person.full_name), candidate);
  }

  for (const profile of mentors) {
    const person = peopleById.get(clean(profile.person_id));
    if (!person) continue;
    const candidate = { ...person, profile_id: profile.id };
    addIndex(mentorByEmail, normalizeEmail(person.email_primary), candidate);
    addIndex(mentorByEmail, normalizeEmail(person.email), candidate);
    addIndex(mentorByName, normalizeKey(person.full_name), candidate);
  }

  const matchesByPair = new Map();
  for (const match of matches) {
    const key = `${clean(match.mentor_person_id)}|${clean(match.mentee_person_id)}`;
    addIndex(matchesByPair, key, match);
  }

  const existingDuplicateKeys = new Set();
  for (const recap of existingRecaps) {
    existingDuplicateKeys.add(
      [
        clean(recap.meeting_date),
        clean(recap.mentor_person_id),
        clean(recap.mentee_person_id),
        clean(recap.recap_url)
      ].join("|")
    );
  }

  return {
    people,
    mentees,
    mentors,
    matches,
    existingRecaps,
    menteeProfilePersonIds,
    mentorProfilePersonIds,
    menteeByCode,
    menteeByEmail,
    menteeByName,
    mentorByEmail,
    mentorByName,
    matchesByPair,
    existingDuplicateKeys
  };
}

function mapMentee(row, refs, notes) {
  const rawCode = clean(row.mentee_identifier_mssv) || clean(row.mentee_identifier_edit);
  const rawEdit = clean(row.mentee_identifier_edit);

  const codeResult = resolveOne(refs.menteeByCode.get(normalizeCode(rawCode)) ?? [], notes, "Mentee", "student_code/MSSV");
  if (codeResult.id) return codeResult;
  if (codeResult.ambiguous) return codeResult;

  const emailCandidate = [rawEdit, rawCode].find(isEmail) ?? "";
  const emailResult = resolveOne(refs.menteeByEmail.get(normalizeEmail(emailCandidate)) ?? [], notes, "Mentee", "email");
  if (emailResult.id) return emailResult;
  if (emailResult.ambiguous) return emailResult;

  const nameCandidate = [rawEdit, rawCode].find((value) => clean(value) && !isEmail(value) && !normalizeCode(value).match(/^[A-Z]{2,}\d+$/)) ?? "";
  const nameResult = resolveOne(refs.menteeByName.get(normalizeKey(nameCandidate)) ?? [], notes, "Mentee", "normalized full name fallback");
  if (nameResult.id && refs.menteeProfilePersonIds.has(nameResult.id)) return nameResult;
  if (nameResult.id) {
    notes.push("Mentee people.id was found but has no mentee_profiles row.");
    return { id: "", ambiguous: false };
  }
  return nameResult;
}

function mapMentor(row, refs, notes) {
  const rawMentor = clean(row.mentor_identifier_name);
  const emailCandidate = extractEmail(rawMentor);

  const emailResult = resolveOne(refs.mentorByEmail.get(normalizeEmail(emailCandidate)) ?? [], notes, "Mentor", "email");
  if (emailResult.id) return emailResult;
  if (emailResult.ambiguous) return emailResult;

  const nameResult = resolveOne(refs.mentorByName.get(normalizeKey(rawMentor)) ?? [], notes, "Mentor", "normalized full name");
  if (nameResult.id && refs.mentorProfilePersonIds.has(nameResult.id)) return nameResult;
  if (nameResult.id) {
    notes.push("Mentor people.id was found but has no mentor_profiles row.");
    return { id: "", ambiguous: false };
  }
  return nameResult;
}

function resolveMatch(mentorPersonId, menteePersonId, refs, notes) {
  if (!mentorPersonId || !menteePersonId) return { id: "", ambiguous: false };
  const candidates = uniqueRows(refs.matchesByPair.get(`${mentorPersonId}|${menteePersonId}`) ?? []);
  if (candidates.length === 1) {
    notes.push("Match mapped by mentor_person_id + mentee_person_id.");
    return { id: clean(candidates[0].id), ambiguous: false };
  }
  if (candidates.length > 1) {
    notes.push(`Match mapping is ambiguous (${candidates.length} candidates).`);
    return { id: "", ambiguous: true };
  }
  notes.push("No UEHM-S11 match found for mapped mentor/mentee pair.");
  return { id: "", ambiguous: false };
}

function mapRow(row, refs) {
  const notes = [];
  const review = [];
  const recapUrl = finalRecapUrl(row);
  const usedPlaceholderUrl = !isHttpUrl(clean(row.recap_url));
  const mentee = mapMentee(row, refs, notes);
  const mentor = mapMentor(row, refs, notes);
  const match = resolveMatch(mentor.id, mentee.id, refs, notes);
  const duplicateKey = [clean(row.meeting_date), mentor.id, mentee.id, recapUrl].join("|");
  const duplicateExisting = Boolean(mentor.id && mentee.id && refs.existingDuplicateKeys.has(duplicateKey));

  if (usedPlaceholderUrl && clean(row.recap_reference)) {
    notes.push("Generated placeholder recap_url from recap_reference.");
  } else if (usedPlaceholderUrl) {
    notes.push("Generated generic placeholder recap_url because source URL/reference is missing.");
  }

  if (!clean(row.meeting_date)) review.push("Missing meeting_date.");
  if (!mentor.id) review.push("Resolve mentor_person_id before import.");
  if (!mentee.id) review.push("Resolve mentee_person_id before import.");
  if (mentor.id && mentee.id && !match.id) review.push("Confirm whether import may proceed without match_id.");
  if (duplicateExisting) review.push("Existing March recap candidate; do not import without duplicate review.");
  if (usedPlaceholderUrl) review.push("Placeholder URL requires human approval.");

  let mappingStatus = "mapped";
  if (mentor.ambiguous || mentee.ambiguous || match.ambiguous || !clean(row.meeting_date)) {
    mappingStatus = "needs_review";
  } else if (!mentor.id) {
    mappingStatus = "missing_mentor";
  } else if (!mentee.id) {
    mappingStatus = "missing_mentee";
  } else if (duplicateExisting) {
    mappingStatus = "duplicate_existing";
  } else if (!match.id) {
    mappingStatus = "missing_match";
  } else if (usedPlaceholderUrl) {
    mappingStatus = "mapped_with_warnings";
  }

  const approvedForImport = mappingStatus === "mapped" || mappingStatus === "mapped_with_warnings";

  return {
    source_row_id: row.source_row_id,
    source_sheet: row.source_sheet,
    source_file: row.source_file,
    meeting_date: row.meeting_date,
    meeting_month: row.meeting_month,
    mentor_person_id: mentor.id,
    mentee_person_id: mentee.id,
    match_id: match.id,
    recap_url: recapUrl,
    recap_note: clean(row.recap_text_excerpt),
    meeting_type: clean(row.activity_type) || "mentoring",
    mapping_status: mappingStatus,
    mapping_notes: notes.join(" "),
    approved_for_import: approvedForImport ? "true" : "false",
    review_note: review.join(" ")
  };
}

function countWhere(rows, predicate) {
  return rows.reduce((count, row) => count + (predicate(row) ? 1 : 0), 0);
}

function uniqueSet(values) {
  return new Set(values.map((value) => clean(value)).filter(Boolean));
}

function intersectionCount(left, right) {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function referenceQuality(sourceRows, refs) {
  const sourceMenteeCodes = uniqueSet(
    sourceRows.flatMap((row) => [normalizeCode(row.mentee_identifier_mssv), normalizeCode(row.mentee_identifier_edit)])
  );
  const profileCodes = uniqueSet(
    refs.mentees.flatMap((profile) => [normalizeCode(profile.mssv), normalizeCode(profile.mentee_code), normalizeCode(profile.student_code)])
  );
  const sourceMentorNames = uniqueSet(sourceRows.map((row) => normalizeKey(row.mentor_identifier_name)));
  const peopleNames = uniqueSet(refs.people.map((person) => normalizeKey(person.full_name)));

  return {
    sourceMenteeCodeKeys: sourceMenteeCodes.size,
    profileCodeKeys: profileCodes.size,
    sourceToProfileCodeMatches: intersectionCount(sourceMenteeCodes, profileCodes),
    sourceMentorNameKeys: sourceMentorNames.size,
    peopleNameKeys: peopleNames.size,
    sourceToPeopleMentorNameMatches: intersectionCount(sourceMentorNames, peopleNames),
    syntheticPeopleNameRows: countWhere(refs.people, (person) => /staging|validation/i.test(clean(person.full_name))),
    syntheticEmailRows: countWhere(refs.people, (person) => /@vam\.test|@ops-validation\.vam\.test/i.test(clean(person.email_primary))),
    syntheticMenteeCodeRows: countWhere(refs.mentees, (profile) => /^(SE|VE)-\d+/i.test(clean(profile.mentee_code))),
    syntheticMentorCodeRows: countWhere(refs.mentors, (profile) => /^(SM|VM)-\d+/i.test(clean(profile.mentor_code)))
  };
}

function summarize(sourceRows, outputRows, refs, referenceSource) {
  const statusCounts = outputRows.reduce((acc, row) => {
    acc[row.mapping_status] = (acc[row.mapping_status] ?? 0) + 1;
    return acc;
  }, {});

  const placeholderUrlRows = countWhere(outputRows, (row) => row.recap_url.startsWith("https://system.local/missing-url"));
  const readyForImportRows = countWhere(outputRows, (row) => row.approved_for_import === "true");
  const blockerRows = countWhere(outputRows, (row) => row.approved_for_import !== "true");
  const mappedRows = statusCounts.mapped ?? 0;
  const mappedWithWarningsRows = statusCounts.mapped_with_warnings ?? 0;
  const mappingSuccessRate = sourceRows.length ? ((mappedRows + mappedWithWarningsRows) / sourceRows.length) * 100 : 0;

  return {
    totalRows: sourceRows.length,
    mappedRows,
    mappedWithWarningsRows,
    missingMentorRows: countWhere(outputRows, (row) => row.mapping_status === "missing_mentor" || row.review_note.includes("Resolve mentor_person_id")),
    missingMenteeRows: countWhere(outputRows, (row) => row.mapping_status === "missing_mentee" || row.review_note.includes("Resolve mentee_person_id")),
    missingMatchRows: statusCounts.missing_match ?? 0,
    duplicateExistingCandidates: statusCounts.duplicate_existing ?? 0,
    needsReviewRows: statusCounts.needs_review ?? 0,
    placeholderUrlRows,
    readyForImportRows,
    blockerRows,
    mappingSuccessRate,
    referenceSource,
    referenceQuality: referenceQuality(sourceRows, refs),
    statusCounts,
    references: {
      people: refs.people.length,
      menteeProfiles: refs.mentees.length,
      mentorProfiles: refs.mentors.length,
      matches: refs.matches.length,
      existingMarchRecaps: refs.existingRecaps.length
    }
  };
}

function markdownTable(rows) {
  return [
    "| Metric | Count |",
    "| --- | ---: |",
    ...rows.map(([label, value]) => `| ${label} | ${value} |`)
  ].join("\n");
}

function writeReport(summary) {
  const blockers = [];
  if (summary.missingMentorRows) blockers.push(`${summary.missingMentorRows} rows still need mentor_person_id resolution.`);
  if (summary.missingMenteeRows) blockers.push(`${summary.missingMenteeRows} rows still need mentee_person_id resolution.`);
  if (summary.missingMatchRows) blockers.push(`${summary.missingMatchRows} mapped mentor/mentee rows have no UEHM-S11 match_id.`);
  if (summary.duplicateExistingCandidates) blockers.push(`${summary.duplicateExistingCandidates} rows match existing March recap duplicate signatures.`);
  if (summary.needsReviewRows) blockers.push(`${summary.needsReviewRows} rows are ambiguous or structurally incomplete.`);
  if (summary.placeholderUrlRows) blockers.push(`${summary.placeholderUrlRows} rows use system.local placeholder recap URLs and require approval.`);
  if (!blockers.length) blockers.push("No automated blockers detected; human approval is still required before any staging import execution.");

  const report = `# Season 11 March Mapping Result Report

Generated: 2026-04-30

## Scope

This report was generated offline from local CSV exports only. No Supabase writes, imports, dashboard RPC changes, deploys, commits, or pushes were performed.

Reference source: \`${summary.referenceSource}\`

## Reference Inputs

${markdownTable([
    ["People reference rows", summary.references.people],
    ["Mentee profile reference rows", summary.references.menteeProfiles],
    ["Mentor profile reference rows", summary.references.mentorProfiles],
    ["UEHM-S11 match reference rows", summary.references.matches],
    ["Existing March recap reference rows", summary.references.existingMarchRecaps]
  ])}

## Reference Quality Checks

${markdownTable([
    ["Unique source mentee code keys", summary.referenceQuality.sourceMenteeCodeKeys],
    ["Reference profile code keys", summary.referenceQuality.profileCodeKeys],
    ["Source-to-profile code matches", summary.referenceQuality.sourceToProfileCodeMatches],
    ["Unique source mentor name keys", summary.referenceQuality.sourceMentorNameKeys],
    ["Reference people name keys", summary.referenceQuality.peopleNameKeys],
    ["Source-to-people mentor name matches", summary.referenceQuality.sourceToPeopleMentorNameMatches],
    ["Synthetic-looking people names", summary.referenceQuality.syntheticPeopleNameRows],
    ["Synthetic/test email rows", summary.referenceQuality.syntheticEmailRows],
    ["Synthetic-looking mentee codes", summary.referenceQuality.syntheticMenteeCodeRows],
    ["Synthetic-looking mentor codes", summary.referenceQuality.syntheticMentorCodeRows]
  ])}

## Mapping Summary

${markdownTable([
    ["Total rows", summary.totalRows],
    ["Mapped rows", summary.mappedRows],
    ["Mapped with warnings rows", summary.mappedWithWarningsRows],
    ["Missing mentor rows", summary.missingMentorRows],
    ["Missing mentee rows", summary.missingMenteeRows],
    ["Missing match rows", summary.missingMatchRows],
    ["Duplicate existing candidates", summary.duplicateExistingCandidates],
    ["Needs review rows", summary.needsReviewRows],
    ["Placeholder URL rows", summary.placeholderUrlRows],
    ["Ready for import rows", summary.readyForImportRows],
    ["Blocker rows before manual staging import", summary.blockerRows]
  ])}

Mapping success rate: ${summary.mappingSuccessRate.toFixed(2)}%

## Status Counts

${markdownTable(Object.entries(summary.statusCounts).sort(([a], [b]) => a.localeCompare(b)))}

## Blockers Before Manual Staging Import

${blockers.map((blocker) => `- ${blocker}`).join("\n")}

## Human Review Requirement

Human review is required before execution. The ready-for-import CSV is an offline review artifact only; it must not be imported until Operations approves mapped IDs, placeholder URLs, duplicate handling, and any missing match decisions.
`;

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report, "utf8");
}

function writeOutputCsv(rows) {
  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(
    OUTPUT_CSV,
    [OUTPUT_HEADERS.join(","), ...rows.map((row) => OUTPUT_HEADERS.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n",
    "utf8"
  );
}

function main() {
  const referenceSource = parseReferenceSource();
  const sourceRows = readCsv(SOURCE_CSV);
  const refs = buildReferences(referenceSource);
  const outputRows = sourceRows.map((row) => mapRow(row, refs));
  const summary = summarize(sourceRows, outputRows, refs, referenceSource);

  writeOutputCsv(outputRows);
  writeReport(summary);

  console.log(`Wrote ${OUTPUT_CSV}`);
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`Reference source: ${summary.referenceSource}`);
  console.log(`Rows: ${summary.totalRows}`);
  console.log(`Mapping success rate: ${summary.mappingSuccessRate.toFixed(2)}%`);
  console.log(JSON.stringify(summary.statusCounts, null, 2));
}

main();

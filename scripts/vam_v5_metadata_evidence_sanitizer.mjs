#!/usr/bin/env node
// VAM OS V5 metadata-capture evidence sanitizer.
//
// Contract
// --------
// Args:   <templateEvidencePath> <candidateOutputPath> <captureSqlPath>
//         <approvedStagingRef> <excludedProductionRef>
// Stdin:  the complete merged stdout+stderr stream of the metadata-capture psql run.
//         Buffered fully in memory (documented, not incremental/chunked parsing --
//         acceptable given catalog-only, bounded metadata volume). Never written raw
//         to disk. Never echoed back on stdout/stderr.
// Output: exactly one candidate evidence JSON file, written first to
//         "<candidateOutputPath>.writing" then atomically renamed to
//         <candidateOutputPath> only after the file is fully serialized. No separate
//         sections file, no separate execution-log file, no other file is ever
//         created by this script.
// Exit codes:
//   0  candidate written, every validation check passed -> safe to publish.
//   1  candidate written, at least one validation check failed -> do NOT publish.
//   2  usage / template / hashing / other fatal error before stdin was consumed ->
//      no candidate file written at all.
//   3  unexpected fatal error while processing stdin -> no candidate file written.
//
// Error output never includes raw input, original suspicious values, connection
// strings, hostnames, passwords, emails, or stack traces containing captured content
// -- only static, hardcoded messages and non-secret counts/section names.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";

const [, , templatePath, candidatePath, captureSqlPath, approvedRef, excludedProdRef] = process.argv;

if (!templatePath || !candidatePath || !captureSqlPath || !approvedRef || !excludedProdRef) {
  process.stderr.write(
    "usage: sanitizer.mjs <template.json> <candidate_out.json> <capture.sql> " +
      "<approvedStagingRef> <excludedProdRef>\n"
  );
  process.exit(2);
}

let template;
try {
  template = JSON.parse(readFileSync(templatePath, "utf8"));
} catch {
  process.stderr.write("sanitizer: fatal: could not read/parse template evidence document\n");
  process.exit(2);
}

if (template.captureStatus !== "NOT_EXECUTED") {
  process.stderr.write("sanitizer: fatal: template is not in a NOT_EXECUTED baseline state\n");
  process.exit(2);
}

let captureSqlSha256;
try {
  captureSqlSha256 = createHash("sha256").update(readFileSync(captureSqlPath)).digest("hex");
} catch {
  process.stderr.write("sanitizer: fatal: could not read/hash capture SQL file\n");
  process.exit(2);
}

const EXPECTED_SECTIONS = [
  "relations",
  "columns",
  "constraints",
  "indexes",
  "relation_acl",
  "function_acl",
  "policies",
  "rls_state",
  "helper_functions",
  "prerequisite_probe",
  "session_context",
];
const EXPECTED_SECTION_SET = new Set(EXPECTED_SECTIONS);
const SECTION_MARKER = /^---SECTION:([A-Za-z0-9_]+)---$/;

// ---------------------------------------------------------------------------------
// Secret / credential / PII detection. Deliberately FIELD-scoped (never whole-line,
// never whole-object), so legitimate DDL that merely contains a word like "password",
// "secret", "role", "owner", "policy", or "security definer" as part of an identifier
// or constraint definition is never destroyed -- only a VALUE matching one of these
// shapes is replaced, and only that single field.
//
// Deliberately NOT included (documented false-negative, to avoid a worse false-positive
// on legitimate schema evidence): a bare "looks like a 64-char hex/base64 string"
// heuristic. This capture SQL's own prerequisite tables use check constraints such as
// `source_sha256 text check(source_sha256 ~ '^[0-9a-f]{64}$')` -- the REGEX LITERAL
// text itself is 64-hex-shaped and would be wrongly redacted by such a heuristic,
// destroying required schema evidence. A real opaque secret of that shape would only
// be caught here if it also matched one of the explicit prefixed/labeled patterns
// below (e.g. an AWS key, a JWT, or an explicit `token=`/`secret=` assignment).
const SECRET_PATTERNS = [
  { name: "conn_string_with_credentials", re: /[a-z][a-z0-9+.-]*:\/\/[^/\s]+:[^/\s@]+@[^/\s]+/i },
  { name: "jwt_like", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "slack_token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "stripe_key", re: /\b(sk|pk)_live_[A-Za-z0-9]{16,}\b/ },
  { name: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "bearer_token", re: /\bBearer\s+[A-Za-z0-9._-]{16,}/i },
  {
    name: "generic_secret_assignment",
    re: /\b(password|passwd|pwd|secret|api[_-]?key|token|access[_-]?key)\b\s*[:=]\s*['"]?[^\s'"]{8,}/i,
  },
  { name: "email_address", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: "cloud_hostname", re: /\b[a-z0-9-]+\.(supabase\.co|supabase\.com|amazonaws\.com)\b/i },
];

// Parses a Postgres GUC duration display value (e.g. "15s", "3s", "500ms", "0") into
// milliseconds. Returns null for anything unrecognized -- callers treat null as "not
// bounded" (fails closed), never as 0.
function parsePgDurationToMs(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d+)(ms|s|min|h|d)?$/i);
  if (!m) return null;
  const unitMs = { ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 };
  return Number(m[1]) * unitMs[(m[2] || "ms").toLowerCase()];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Fires only when the FIELD itself represents an Auth identity VALUE, not a
// column/constraint/table NAME that merely happens to be spelled e.g. "auth_user_id"
// (that case has key = "column_name", value = "auth_user_id" -- correctly not matched
// here since the key check is exact). None of the 11 defined capture sections
// currently emit such a value field, because this capture SQL never selects
// application row data -- this rule stays in place defensively for any future
// extension of the capture SQL.
const AUTH_IDENTITY_KEY_RE =
  /^(auth_user_id|user_id|owner_id|actor_admin_user_id|target_admin_user_id|created_by|changed_by)$/i;

function detectSecret(key, value) {
  if (typeof value !== "string") return null;
  if (AUTH_IDENTITY_KEY_RE.test(key) && UUID_RE.test(value)) return "auth_identity_uuid_value";
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(value)) return p.name;
  }
  return null;
}

const IDENTITY_KEYS = [
  "evidence_id",
  "schema_name",
  "rel_name",
  "table_name",
  "function_name",
  "object_name",
  "policy_name",
  "constraint_name",
  "index_name",
  "column_name",
];

function buildIdentity(row) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return null;
  const parts = [];
  for (const k of IDENTITY_KEYS) {
    if (row[k] !== undefined && row[k] !== null) parts.push(`${k}=${row[k]}`);
  }
  return parts.length ? parts.join(",") : null;
}

function redactedMarker(pattern) {
  return { manual_review_required: true, reason: "possible_secret_or_pii_pattern_detected", pattern };
}

function sanitizeValue(key, value, rowFlags) {
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(key, v, rowFlags));
  if (value !== null && typeof value === "object") {
    // Nested objects sanitize themselves (own _manual_review_required marker), but that
    // marker is local to the nested object -- it must also be propagated into the
    // enclosing row's rowFlags, or flaggedCount/noOutstandingSecretPatternMatches at the
    // top level would silently undercount a redaction that happened one level down.
    // Not reachable by the current capture SQL (no column is json/jsonb-typed today,
    // only scalars and arrays), but the capture SQL is documented as extensible, so this
    // path must not be able to gate publication incorrectly if that ever changes.
    const nested = sanitizeRow(value);
    if (nested && nested._manual_review_required) {
      for (const f of nested._flagged_fields) {
        rowFlags.push({ field: `${key}.${f.field}`, pattern: f.pattern });
      }
    }
    return nested;
  }
  const hit = detectSecret(key, value);
  if (hit) {
    rowFlags.push({ field: key, pattern: hit });
    return redactedMarker(hit);
  }
  return value;
}

function sanitizeRow(row) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
  const identity = buildIdentity(row);
  const flags = [];
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeValue(k, v, flags);
  }
  if (flags.length) {
    out._manual_review_required = true;
    out._flagged_fields = flags;
    out._object_identity = identity;
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Stream parsing. Each expected section carries a tri-state: MISSING (marker never
// seen), PENDING (marker seen, its one jsonb_agg data line not yet resolved),
// RESOLVED (a valid JSON array/null line was consumed and sanitized), or MALFORMED
// (marker seen but the following line did not parse as JSON / was not an array or
// null / the stream ended before a data line arrived). This distinguishes "present
// with zero rows" from "missing" from "malformed" -- required for publication.
const sectionState = {};
for (const s of EXPECTED_SECTIONS) sectionState[s] = "MISSING";
const sections = {};
for (const s of EXPECTED_SECTIONS) sections[s] = null;

let pendingSection = null;
let unknownSectionMarkerCount = 0;
let duplicateSectionMarkerCount = 0;
let unsectionedLineCount = 0;
let diagnosticLineCount = 0;
let flaggedCount = 0;
let parsedLineCount = 0;

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
});
process.stdin.on("error", () => {
  process.stderr.write("sanitizer: fatal: stdin read error\n");
  process.exit(3);
});

process.stdin.on("end", () => {
  try {
    const lines = buffer.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length === 0) continue;

      const marker = line.match(SECTION_MARKER);
      if (marker) {
        const name = marker[1];
        if (!EXPECTED_SECTION_SET.has(name)) {
          unknownSectionMarkerCount++;
          pendingSection = null;
          continue;
        }
        if (sectionState[name] !== "MISSING") {
          // A section marker recurring (or recurring while still pending) is never
          // silently merged or overwritten -- it is a hard validation failure.
          duplicateSectionMarkerCount++;
          pendingSection = null;
          continue;
        }
        sectionState[name] = "PENDING";
        pendingSection = name;
        continue;
      }

      if (!pendingSection) {
        // Content outside any pending section: stray psql command tags (BEGIN/SET/
        // ROLLBACK), error text, or anything else. Counted only -- text is never kept.
        unsectionedLineCount++;
        continue;
      }

      let parsed;
      let parseOk = true;
      try {
        parsed = JSON.parse(line);
      } catch {
        parseOk = false;
      }

      const name = pendingSection;
      pendingSection = null;

      if (!parseOk || !(parsed === null || Array.isArray(parsed))) {
        sectionState[name] = "MALFORMED";
        diagnosticLineCount++;
        continue;
      }

      parsedLineCount++;
      const rows = parsed === null ? [] : parsed;
      const sanitizedRows = rows.map((r) => {
        const s = sanitizeRow(r);
        if (s && s._manual_review_required) flaggedCount++;
        return s;
      });
      sections[name] = sanitizedRows;
      sectionState[name] = "RESOLVED";
    }

    if (pendingSection) {
      // Stream ended with a marker seen but its data line never arrived (e.g. a
      // truncated final line) -- malformed, never silently treated as empty.
      sectionState[pendingSection] = "MALFORMED";
    }

    const capturedAt = new Date().toISOString();
    const candidate = structuredClone(template);
    candidate.capturedAt = capturedAt;
    candidate.captureQueryArtifact = {
      ...(candidate.captureQueryArtifact || {}),
      sha256: captureSqlSha256,
      sha256Status: "COMPUTED_AT_EXECUTION_TIME",
    };
    delete candidate.expectedEvidenceSectionsPendingCapture;
    candidate.capturedEvidenceSections = sections;
    candidate.captureExecutionSummary = {
      generatedAt: capturedAt,
      sectionStates: { ...sectionState },
      sectionCounts: Object.fromEntries(
        EXPECTED_SECTIONS.map((s) => [s, Array.isArray(sections[s]) ? sections[s].length : null])
      ),
      parsedJsonLineCount: parsedLineCount,
      flaggedSecretCandidateCount: flaggedCount,
      diagnosticLineCount,
      unsectionedLineCount,
      unknownSectionMarkerCount,
      duplicateSectionMarkerCount,
      note: "No raw or redacted diagnostic/unsectioned line text is retained anywhere -- counts only.",
    };

    // ---- Pre-publication validation (embedded for the caller to re-check) ----
    const checks = {};
    checks.allExpectedSectionsResolved = EXPECTED_SECTIONS.every((s) => sectionState[s] === "RESOLVED");
    checks.allSectionsAreArrays = EXPECTED_SECTIONS.every((s) => Array.isArray(sections[s]));
    checks.noUnknownSectionMarkers = unknownSectionMarkerCount === 0;
    checks.noDuplicateSectionMarkers = duplicateSectionMarkerCount === 0;

    const sessionRows = Array.isArray(sections.session_context) ? sections.session_context : [];
    checks.exactlyOneSessionContextRow = sessionRows.length === 1;
    const sessionRow = sessionRows.length === 1 ? sessionRows[0] : null;
    checks.transactionReadOnlyConfirmedOn = !!sessionRow && sessionRow.transaction_read_only === "on";

    // Target-connection assurance is composed of TWO independent things, never conflated:
    // (A) the non-printing shell preflight (outside this script -- see the wrapper in the
    //     decision pack) that checks STAGING_DATABASE_URL's shape/ref before psql ever
    //     starts, and (B) this session's own read-only-transaction evidence, checked here.
    // Neither on its own proves "this capture hit the approved staging project" -- (A)
    // checks the env var the wrapper handed to psql; (B) checks the session psql actually
    // opened. This script only ever sees (B); it makes no claim about (A).
    const statementTimeoutMs = sessionRow ? parsePgDurationToMs(sessionRow.statement_timeout_setting) : null;
    const lockTimeoutMs = sessionRow ? parsePgDurationToMs(sessionRow.lock_timeout_setting) : null;
    checks.statementTimeoutBounded =
      statementTimeoutMs !== null && statementTimeoutMs > 0 && statementTimeoutMs <= 15000;
    checks.lockTimeoutBounded = lockTimeoutMs !== null && lockTimeoutMs > 0 && lockTimeoutMs <= 3000;
    checks.serverVersionPresent =
      !!sessionRow && typeof sessionRow.server_version === "string" && sessionRow.server_version.length > 0;
    checks.databaseNamePresent =
      !!sessionRow && typeof sessionRow.database_name === "string" && sessionRow.database_name.length > 0;

    checks.templateBeganNotExecuted = template.captureStatus === "NOT_EXECUTED";

    const candidateText = JSON.stringify(candidate);
    checks.approvedStagingRefPresent = candidateText.includes(approvedRef);
    checks.productionRefAbsent = !candidateText.includes(excludedProdRef);
    checks.noOutstandingSecretPatternMatches = flaggedCount === 0;
    checks.captureSqlHashComputed = typeof captureSqlSha256 === "string" && captureSqlSha256.length === 64;

    const allPassed = Object.values(checks).every((v) => v === true);

    // captureStatus changes exactly once, only after every check above has run.
    candidate.captureStatus = allPassed ? "EXECUTED_VALIDATED" : "EXECUTED_VALIDATION_FAILED";
    candidate.publicationValidation = { checks, allPassed };

    const tmpWrite = `${candidatePath}.writing`;
    writeFileSync(tmpWrite, JSON.stringify(candidate, null, 2));
    renameSync(tmpWrite, candidatePath);

    process.stderr.write(
      `sanitizer: sections=${EXPECTED_SECTIONS.length} flagged=${flaggedCount} ` +
        `diagnostics=${diagnosticLineCount} unsectioned=${unsectionedLineCount} ` +
        `unknownMarkers=${unknownSectionMarkerCount} dupMarkers=${duplicateSectionMarkerCount} ` +
        `allPassed=${allPassed}\n`
    );
    process.exit(allPassed ? 0 : 1);
  } catch {
    // Unexpected fatal error while processing stdin. Deliberately does not reference
    // the caught error object (no message, no stack) so no fragment of buffered input
    // can leak via an exception path. No candidate file is written in this case.
    process.stderr.write("sanitizer: fatal: unexpected processing failure\n");
    process.exit(3);
  }
});

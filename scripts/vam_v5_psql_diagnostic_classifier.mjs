#!/usr/bin/env node
// VAM OS V5 minimal-staging-diagnostic psql output classifier.
//
// Contract
// --------
// Input:  the complete combined stdout+stderr of one psql --csv run of the minimal
//         read-only diagnostic SQL, on stdin. No file input. No environment credential
//         dependency of any kind (this file never reads process.env for anything
//         connection-related; it only ever reads stdin).
// Output: exactly one line on stdout:
//           "DIAGNOSTIC_OK database=postgres transaction_read_only=on
//            server_version_present=true statement_timeout=10s lock_timeout=3s"
//         or
//           "DIAGNOSTIC_FAILED category=<enum>"
//         Every character of both output shapes is a fixed literal -- nothing here is
//         ever built from a substring of stdin. See "Output safety" below.
// Exit:   0  -- a fully valid, exact-match success row.
//         1  -- a classified diagnostic failure (including a structurally valid CSV
//               row whose values do not exactly match the required constants).
//         2  -- usage or internal classifier failure (stdin I/O error, uncaught
//               exception) -- the classifier failed to do its job, as opposed to
//               successfully classifying a psql failure.
//
// Output safety
// -------------
// Never prints raw stdin, matched lines, excerpts, hostnames, usernames, passwords,
// connection strings, emails, SQL error text, or stack traces containing input. This is
// enforced structurally, not just by convention: every reachable output statement in
// this file is a fixed string literal. The DIAGNOSTIC_OK line requires every field to
// exactly equal a fixed expected constant before it is ever printed, so by the time it
// prints, printing the constants is equivalent to printing the (already-verified-equal)
// parsed values -- this file prints the constants directly and never interpolates the
// parsed values at all, so there is no interpolation path for hostile input to reach
// even indirectly. The DIAGNOSTIC_FAILED line prints only a category name selected from
// a fixed, closed enum via regex .test() -- never the matched substring, never any
// fragment of the buffer. The sole catch block never references the caught error object
// (no message, no stack), so no fragment of buffered input can leak via an exception
// path either.

const EXPECTED_HEADER = [
  "database_name",
  "transaction_read_only",
  "server_version",
  "statement_timeout",
  "lock_timeout",
];
const ALLOWED_TAGS = new Set(["BEGIN", "SET", "ROLLBACK"]);

const REQUIRED_DATABASE = "postgres";
const REQUIRED_TRANSACTION_READ_ONLY = "on";
const REQUIRED_STATEMENT_TIMEOUT = "10s";
const REQUIRED_LOCK_TIMEOUT = "3s";

// Classification precedence is significant: more specific connection-layer categories
// are checked before the generic sql_script_error pattern, and sql_script_error itself
// additionally requires the absence of any connection-fatal marker (see
// classifyFailure()) so an unrecognized connection failure that happens to contain a
// line starting "ERROR:" is never mislabeled as a SQL-script error.
const CATEGORY_PATTERNS = [
  {
    category: "malformed_connection_uri",
    re: /invalid URI query parameter|invalid connection option|missing "=" after|invalid integer value|invalid connection-string syntax|failed to parse/i,
  },
  {
    category: "authentication_failed",
    re: /password authentication failed|role "[^"]*" does not exist|SASL authentication failed|FATAL:\s*.*[Pp]assword/i,
  },
  {
    category: "dns_resolution_failed",
    re: /could not translate host ?name|Name or service not known|Temporary failure in name resolution|nodename nor servname provided/i,
  },
  {
    category: "connection_refused",
    re: /Connection refused|Is the server running on host/i,
  },
  {
    category: "connection_timeout",
    re: /timeout expired|Connection timed out|Operation timed out/i,
  },
  {
    category: "tls_or_ssl_failure",
    re: /SSL error|SSL SYSCALL|SSL connection has been closed|certificate verify failed|server does not support SSL|SSL is not enabled on the server/i,
  },
  {
    category: "server_closed_connection",
    re: /server closed the connection unexpectedly|the connection to the server was lost|EOF detected/i,
  },
  {
    category: "pooler_or_server_unavailable",
    re: /too many clients already|remaining connection slots are reserved|no more connections allowed|max_client_conn|terminating connection due to administrator command/i,
  },
];

// Checked only after every pattern above has failed to match, and only fires if the
// buffer does NOT also contain a connection-fatal marker -- a genuine SQL-script error
// under ON_ERROR_STOP never co-occurs with a FATAL/connection-refusal message, so
// requiring their absence here is a real, not cosmetic, precision improvement.
const SQL_SCRIPT_ERROR_RE = /^ERROR:\s+\S/m;
const CONNECTION_FATAL_MARKER_RE = /FATAL:|could not connect|connection to server/i;

function classifyFailure(buffer) {
  for (const p of CATEGORY_PATTERNS) {
    if (p.re.test(buffer)) return p.category;
  }
  if (SQL_SCRIPT_ERROR_RE.test(buffer) && !CONNECTION_FATAL_MARKER_RE.test(buffer)) {
    return "sql_script_error";
  }
  return "unknown_connection_failure";
}

// Minimal RFC4180-shaped single-line CSV parser: handles quoted fields and doubled-
// quote escaping ("" inside a quoted field means a literal "). Returns an array of
// field strings, or null if the line is not parseable as a well-formed CSV line (e.g.
// an unterminated quoted field). Does not handle a field containing a literal newline
// (a quoted value spanning multiple physical lines) -- deliberately out of scope, since
// none of the five expected columns for this diagnostic can legitimately contain one.
function parseCsvLine(line) {
  const fields = [];
  const n = line.length;
  let i = 0;
  for (;;) {
    if (line[i] === '"') {
      let field = "";
      i++;
      let closed = false;
      while (i < n) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        field += line[i];
        i++;
      }
      if (!closed) return null;
      fields.push(field);
      if (i < n && line[i] === ",") {
        i++;
        continue;
      }
      if (i >= n) break;
      return null; // unexpected content immediately after a closing quote
    } else {
      const start = i;
      while (i < n && line[i] !== ",") i++;
      fields.push(line.slice(start, i));
      if (i < n && line[i] === ",") {
        i++;
        continue;
      }
      break;
    }
  }
  return fields;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Returns one of:
//   { kind: "valid_success" }                -- exact-match success row found
//   { kind: "structurally_valid_wrong_values" } -- well-formed header+row, wrong values
//   null                                      -- not recognizable as the success shape
//                                                at all (fall through to failure-text
//                                                classification against the raw buffer)
function tryParseSuccessStream(buffer) {
  const rawLines = buffer.split(/\r\n|\n/);
  let sawHeader = false;
  let dataRow = null;

  for (const rawLine of rawLines) {
    if (rawLine.trim().length === 0) continue;
    if (ALLOWED_TAGS.has(rawLine.trim())) continue;

    const fields = parseCsvLine(rawLine);
    if (fields === null) return null; // malformed CSV line anywhere -- not success

    if (!sawHeader) {
      if (arraysEqual(fields, EXPECTED_HEADER)) {
        sawHeader = true;
        continue;
      }
      return null; // first meaningful line was not the expected header
    }

    if (dataRow === null) {
      if (fields.length !== EXPECTED_HEADER.length) return null;
      dataRow = fields;
      continue;
    }

    // A header and a data row were already found; any further non-blank, non-tag
    // line is either a duplicate data row or unsectioned trailing content. Either way
    // it invalidates the success shape.
    return null;
  }

  if (!sawHeader || dataRow === null) return null;

  const [database, transactionReadOnly, serverVersion, statementTimeout, lockTimeout] =
    dataRow;

  const valuesMatch =
    database === REQUIRED_DATABASE &&
    transactionReadOnly === REQUIRED_TRANSACTION_READ_ONLY &&
    serverVersion.length > 0 &&
    statementTimeout === REQUIRED_STATEMENT_TIMEOUT &&
    lockTimeout === REQUIRED_LOCK_TIMEOUT;

  return valuesMatch
    ? { kind: "valid_success" }
    : { kind: "structurally_valid_wrong_values" };
}

function stripLeadingBom(buffer) {
  return buffer.length > 0 && buffer.charCodeAt(0) === 0xfeff ? buffer.slice(1) : buffer;
}

const SUCCESS_LINE =
  "DIAGNOSTIC_OK database=postgres transaction_read_only=on " +
  "server_version_present=true statement_timeout=10s lock_timeout=3s";

function emitFailure(category) {
  process.stdout.write(`DIAGNOSTIC_FAILED category=${category}\n`);
  process.exit(1);
}

let buffer = "";
let sawAnyData = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  sawAnyData = true;
});
process.stdin.on("error", () => {
  // Internal I/O failure of the classifier's own stdin stream -- not a classification
  // of psql's output. No fragment of any partially-buffered input is ever referenced.
  process.stdout.write("DIAGNOSTIC_FAILED category=unexpected_output\n");
  process.exit(2);
});

process.stdin.on("end", () => {
  try {
    if (!sawAnyData || buffer.trim().length === 0) {
      emitFailure("unexpected_output");
      return;
    }

    const normalized = stripLeadingBom(buffer);
    const successResult = tryParseSuccessStream(normalized);

    if (successResult && successResult.kind === "valid_success") {
      process.stdout.write(SUCCESS_LINE + "\n");
      process.exit(0);
      return;
    }

    if (successResult && successResult.kind === "structurally_valid_wrong_values") {
      // A well-formed header+single-row CSV stream was found, but at least one field
      // did not exactly match the required constant -- this is a known, structural
      // outcome, not a text pattern to search for, so it is reported directly without
      // running the failure-category patterns against the buffer.
      emitFailure("unexpected_output");
      return;
    }

    emitFailure(classifyFailure(normalized));
  } catch {
    // Deliberately does not reference the caught error object -- no message, no
    // stack, so no fragment of buffered input can leak via an exception path.
    process.stdout.write("DIAGNOSTIC_FAILED category=unexpected_output\n");
    process.exit(2);
  } finally {
    buffer = "";
  }
});

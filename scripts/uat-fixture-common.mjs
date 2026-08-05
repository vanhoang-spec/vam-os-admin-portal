// VAM OS — shared identity model for the synthetic UAT fixtures (STAGING ONLY).
//
// create-uat-fixtures.mjs, cleanup-uat-fixtures.mjs and the regression tests all
// import this module so there is exactly one deterministic definition of who the
// fixtures are. Nothing here performs I/O beyond the caller-supplied Supabase
// client, and nothing here reads credentials.
//
// Two identity kinds live here, in two separate marker namespaces:
//
//   * Stable account identity — the six Auth/admin accounts. Keyed on
//     ACCOUNT_TAG, which does NOT change between UAT runs, so accounts are
//     reused rather than accumulated. Namespace: `vam_uat_fixture`.
//   * Per-run lifecycle identity — the synthetic person and membership. Keyed on
//     a caller-supplied VAM_UAT_RUN_ID, so a run whose person got log-pinned by
//     lifecycle UAT never blocks the next run. Namespace: `vam_uat_person_run`.
//
// Status vocabulary follows migration 062 / DEC-04: admin_users.status is
// active or inactive only. 'invited' and 'suspended' are deliberately absent.

export const STAGING_PROJECT_REF = "ljfneyuvpxrmejpxsmpz";
export const STAGING_HOSTNAME = `${STAGING_PROJECT_REF}.supabase.co`;
export const SEASON_CODE = "UEHM-S12";
export const BATCH_CODE = "UEHM-S12-B1";

// --- Stable account identity -----------------------------------------------
//
// Ownership is proven by equality against these constants, never by substring
// containment: `notes` and `data_quality_flags` are operator-writable free-text
// columns, so a real row merely mentioning the tag must NOT pass verification.

export const ACCOUNT_TAG = "20260805";
export const ACCOUNT_NOTES_MARKER = `VAM UAT fixture ${ACCOUNT_TAG}`;
export const AUTH_METADATA_MARKER = ACCOUNT_TAG;

export const email = (slug) => `uat.${slug}+${ACCOUNT_TAG}@example.com`;

/** admin_users.notes must equal the canonical account marker exactly. */
export function isExactAdminNotesMarker(value) {
  return value === ACCOUNT_NOTES_MARKER;
}

/** auth.users user_metadata.vam_uat_fixture must equal the account tag exactly. */
export function isExactAuthFixtureMarker(value) {
  return value === AUTH_METADATA_MARKER;
}

// --- Per-run lifecycle identity ---------------------------------------------

export const PERSON_MARKER_NAMESPACE = "vam_uat_person_run";
export const RUN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RUN_ID_MIN_LENGTH = 3;
export const RUN_ID_MAX_LENGTH = 32;

/**
 * Validate VAM_UAT_RUN_ID before anything touches the network.
 *
 * The value is interpolated into an email local-part and into marker strings
 * compared by equality, so the accepted alphabet is deliberately narrow:
 * lowercase alphanumerics separated by single hyphens. That excludes whitespace,
 * quotes, wildcards (% _), path separators and unicode look-alikes.
 */
export function assertRunId(rawRunId) {
  if (rawRunId === undefined || rawRunId === null || String(rawRunId).trim() === "") {
    throw new Error(
      "VAM_UAT_RUN_ID is not set. Every UAT lifecycle run needs its own run id (for example 20260805-01). No network operation attempted."
    );
  }
  const runId = String(rawRunId).trim();
  if (runId !== String(rawRunId)) {
    throw new Error(`VAM_UAT_RUN_ID must not contain leading or trailing whitespace. No network operation attempted.`);
  }
  if (runId.length < RUN_ID_MIN_LENGTH || runId.length > RUN_ID_MAX_LENGTH) {
    throw new Error(
      `VAM_UAT_RUN_ID must be between ${RUN_ID_MIN_LENGTH} and ${RUN_ID_MAX_LENGTH} characters (got ${runId.length}). No network operation attempted.`
    );
  }
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      `VAM_UAT_RUN_ID "${runId}" is not in the accepted format: lowercase letters and digits separated by single hyphens, for example 20260805-01. No network operation attempted.`
    );
  }
  return runId;
}

/**
 * Derive the per-run person/membership identity. Markers live in their own
 * namespace so an account marker can never satisfy a person check, or vice
 * versa, and so run A's marker can never satisfy run B's check.
 */
export function personIdentityForRun(rawRunId) {
  const runId = assertRunId(rawRunId);
  return {
    runId,
    full_name: `VAM-UAT-${runId} Person`,
    email_primary: `uat.person+${runId}@example.com`,
    activeMarker: `${PERSON_MARKER_NAMESPACE}:${runId}`,
    retainedMarker: `${PERSON_MARKER_NAMESPACE}:${runId}:retained`,
    membershipRole: "mentor",
    membershipStatus: "active"
  };
}

/**
 * Classify a people.data_quality_flags value against ONE run's identity.
 * Returns "active", "retained" or "none". Exact matches only, so another run's
 * marker classifies as "none" and is therefore never adopted or mutated.
 */
export function classifyPersonRunMarker(value, person) {
  if (value === person.activeMarker) return "active";
  if (value === person.retainedMarker) return "retained";
  return "none";
}

/** Raised when a candidate row fails ownership verification. Always fatal. */
export class FixtureOwnershipError extends Error {
  constructor(message) {
    super(message);
    this.name = "FixtureOwnershipError";
  }
}

// --- Account matrix --------------------------------------------------------
//
// Six Auth accounts, stable across runs. `nonadmin` is Auth-only by design: no
// admin_users row and therefore no admin_scope_access row.

export const ACCOUNTS = [
  { slug: "admin", fullName: "UAT Active Admin", adminRole: "admin", status: "active", scopeRole: "full_access" },
  { slug: "reviewer", fullName: "UAT Active Reviewer", adminRole: "reviewer", status: "active", scopeRole: "review" },
  { slug: "support", fullName: "UAT Active Support", adminRole: "support_team", status: "active", scopeRole: "operations" },
  { slug: "viewer", fullName: "UAT Active Viewer", adminRole: "viewer", status: "active", scopeRole: "read" },
  { slug: "nonadmin", fullName: "UAT Auth Non-admin", adminRole: null, status: null, scopeRole: null },
  { slug: "inactive", fullName: "UAT Inactive Admin", adminRole: "admin", status: "inactive", scopeRole: "read" }
];

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** admin_scope_access.status is active/inactive only; derive it from the account. */
export function scopeStatusFor(account) {
  return account.status === "active" ? "active" : "inactive";
}

// --- Environment guards ----------------------------------------------------

/**
 * Verify the configured Supabase URL resolves to the staging project by exact
 * hostname. A substring check would accept https://evil.example.com/<ref>.
 * Returns the verified hostname; throws otherwise.
 */
export function assertStagingHost(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a parsable URL. No writes attempted.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL must use https (got ${parsed.protocol}). No writes attempted.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== STAGING_HOSTNAME) {
    throw new Error(`Environment host ${hostname} is not VAM OS staging (${STAGING_HOSTNAME}). No writes attempted.`);
  }
  return hostname;
}

/** Only the exact `--apply` token enables write mode. */
export function parseApplyMode(argv) {
  return (argv ?? []).includes("--apply");
}

/**
 * Resolve the run id from CLI (`--run-id=<value>`) or environment, preferring
 * the CLI form. Validation happens in assertRunId.
 */
export function resolveRunId(argv, env) {
  const flag = (argv ?? []).find((arg) => String(arg).startsWith("--run-id="));
  const fromFlag = flag ? String(flag).slice("--run-id=".length) : undefined;
  return fromFlag !== undefined && fromFlag !== "" ? fromFlag : (env ?? {}).VAM_UAT_RUN_ID;
}

// --- Schema preflight reporting --------------------------------------------
//
// A REST dry-run proves the plan and the live data lookups. It cannot prove the
// live column types, constraints or FK delete behaviour that the scripts depend
// on, so it must never claim schema compatibility. Only the separate read-only
// SQL preflight can do that.

export const PREFLIGHT_SQL_PATH = "scripts/uat-fixture-staging-preflight.sql";
export const PLAN_PASS_LINE = "SCRIPT PLAN PASS";
export const LOOKUP_PASS_LINE = "LIVE DATA LOOKUP PASS";
export const SCHEMA_UNVERIFIED_LINE = "SCHEMA PREFLIGHT NOT VERIFIED";
export const SCHEMA_ACKNOWLEDGED_LINE = "SCHEMA PREFLIGHT ACKNOWLEDGED (operator-confirmed, out of band)";

export function schemaPreflightLine(verified) {
  return verified
    ? SCHEMA_ACKNOWLEDGED_LINE
    : `${SCHEMA_UNVERIFIED_LINE} — run ${PREFLIGHT_SQL_PATH} against staging and review its PASS/FAIL rows before apply`;
}

// --- Shared read helpers ---------------------------------------------------

export async function findAuthUserByEmail(db, target) {
  const wanted = normalizeEmail(target);
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    const hit = users.find((u) => normalizeEmail(u.email) === wanted);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

/**
 * Exact head-count. Throws on error or on a malformed response: an
 * indeterminate count must never be interpreted as "nothing references this".
 */
export async function countRows(db, table, column, value) {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (error) throw new Error(`${table}.${column} count failed: ${error.message}`);
  if (typeof count !== "number") {
    throw new Error(`${table}.${column} count returned a malformed response (no count).`);
  }
  return count;
}

/** Resolve the fixture program/season/batch. Shared so both scripts agree. */
export async function resolveFixtureScope(db) {
  const { data: season, error: seasonError } = await db
    .from("seasons")
    .select("id,code,program_id")
    .eq("code", SEASON_CODE)
    .maybeSingle();
  if (seasonError) throw new Error(`Could not read seasons: ${seasonError.message}`);
  if (!season?.id) throw new Error(`Season ${SEASON_CODE} does not exist`);

  const { data: program, error: programError } = await db
    .from("programs")
    .select("id,code,is_active")
    .eq("id", season.program_id)
    .maybeSingle();
  if (programError) throw new Error(`Could not read programs: ${programError.message}`);
  if (!program?.id) throw new Error("Season references missing program");
  if (program.is_active !== true) throw new Error(`Program ${program.code} is not active`);

  const { data: batch, error: batchError } = await db
    .from("intake_batches")
    .select("id,code,season_id")
    .eq("code", BATCH_CODE)
    .maybeSingle();
  if (batchError) throw new Error(`Could not read intake_batches: ${batchError.message}`);
  if (batch?.id && String(batch.season_id) !== String(season.id)) {
    throw new Error(`Batch ${BATCH_CODE} does not belong to season ${SEASON_CODE}`);
  }

  return {
    programId: String(program.id),
    programCode: program.code,
    seasonId: String(season.id),
    batchId: batch?.id ? String(batch.id) : null
  };
}

/** Read a .env.local without echoing any value. Never logs secrets. */
export function loadEnvLocal(readFileSync, existsSync, path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

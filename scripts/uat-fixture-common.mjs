// VAM OS — shared identity model for the synthetic UAT fixtures (STAGING ONLY).
//
// create-uat-fixtures.mjs, cleanup-uat-fixtures.mjs and the regression tests all
// import this module so there is exactly one deterministic account definition
// and exactly one ownership-marker vocabulary. Nothing here performs I/O beyond
// the caller-supplied Supabase client, and nothing here reads credentials.
//
// Status vocabulary follows migration 062 / DEC-04: admin_users.status is
// active or inactive only. 'invited' and 'suspended' are deliberately absent.

export const STAGING_PROJECT_REF = "ljfneyuvpxrmejpxsmpz";
export const STAGING_HOSTNAME = `${STAGING_PROJECT_REF}.supabase.co`;
export const FIXTURE_TAG = "20260805";
export const SEASON_CODE = "UEHM-S12";
export const BATCH_CODE = "UEHM-S12-B1";

// --- Ownership markers -----------------------------------------------------
//
// Exactly two canonical values are recognised per column. Ownership is proven by
// equality against these constants, never by substring containment: `notes` and
// `data_quality_flags` are operator-writable free-text columns, so a real row
// merely mentioning the tag must NOT pass verification.

export const ACTIVE_MARKER = `vam_uat_fixture:${FIXTURE_TAG}`;
export const RETAINED_MARKER = `vam_uat_fixture:${FIXTURE_TAG}:retained`;
export const ADMIN_NOTES_MARKER = `VAM UAT fixture ${FIXTURE_TAG}`;
export const AUTH_METADATA_MARKER = FIXTURE_TAG;

/**
 * Classify a people.data_quality_flags value.
 * Returns "active", "retained", or "none". Only exact matches are accepted.
 */
export function classifyFixtureMarker(value) {
  if (value === ACTIVE_MARKER) return "active";
  if (value === RETAINED_MARKER) return "retained";
  return "none";
}

export function isFixtureMarker(value) {
  return classifyFixtureMarker(value) !== "none";
}

/** admin_users.notes must equal the canonical marker exactly. */
export function isExactAdminNotesMarker(value) {
  return value === ADMIN_NOTES_MARKER;
}

/** auth.users user_metadata.vam_uat_fixture must equal the tag exactly. */
export function isExactAuthFixtureMarker(value) {
  return value === AUTH_METADATA_MARKER;
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
// Six Auth accounts. `nonadmin` is Auth-only by design: no admin_users row and
// therefore no admin_scope_access row.

export const ACCOUNTS = [
  { slug: "admin", fullName: "UAT Active Admin", adminRole: "admin", status: "active", scopeRole: "full_access" },
  { slug: "reviewer", fullName: "UAT Active Reviewer", adminRole: "reviewer", status: "active", scopeRole: "review" },
  { slug: "support", fullName: "UAT Active Support", adminRole: "support_team", status: "active", scopeRole: "operations" },
  { slug: "viewer", fullName: "UAT Active Viewer", adminRole: "viewer", status: "active", scopeRole: "read" },
  { slug: "nonadmin", fullName: "UAT Auth Non-admin", adminRole: null, status: null, scopeRole: null },
  { slug: "inactive", fullName: "UAT Inactive Admin", adminRole: "admin", status: "inactive", scopeRole: "read" }
];

export const PERSON = {
  full_name: `VAM-UAT-${FIXTURE_TAG} Person`,
  email_primary: `uat.person+${FIXTURE_TAG}@example.com`,
  membershipRole: "mentor",
  membershipStatus: "active"
};

export const email = (slug) => `uat.${slug}+${FIXTURE_TAG}@example.com`;

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

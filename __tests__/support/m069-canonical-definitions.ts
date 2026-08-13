/**
 * M069 R3 — the canonical DEFINITIONS the verifier and apply.sql Section 0 are
 * allowed to accept, derived from repository artifacts rather than restated.
 *
 * R2's verifier read definitions but judged them by fragments: V07/V08 pulled
 * the quoted literals out of a CHECK, V19/V23 looked for marker substrings in
 * `prosrc`. Both are satisfiable by a weaker object. `intended OR
 * length(applicant_role) > 0` exposes exactly the same literals; a replacement
 * function body keeps every marker word in a comment while deleting the
 * statement that enforces it. This module is the other half of the fix: it
 * derives, from the canonical migration and from the accepted Production
 * baseline artifacts, the COMPLETE definition each object must have, so the
 * constants hard-coded in verifier.sql / preflight.sql / apply.sql cannot
 * silently drift away from the SQL they are supposed to describe.
 *
 * WHAT IS SEALED, EXACTLY
 *   * CHECK constraints — the full normalised `pg_get_constraintdef(oid, true)`
 *     rendering of the constraint, whitespace-collapsed. Not a hash: the text
 *     itself, because it is short, deterministic and readable in a refusal.
 *     Whitespace is the only variance discarded.
 *   * Functions — `pg_proc.prosrc`, i.e. the exact bytes between the `$$`
 *     delimiters in the canonical migration, hashed with SHA-256. prosrc is
 *     stored verbatim by PostgreSQL, so this is byte identity of the body and
 *     nothing else: not the signature, not the owner, not SECURITY DEFINER,
 *     not the pinned search_path, all of which are proven separately.
 *   * admin_audit_log — a per-column contract (type, how the M069 INSERT
 *     treats the column, and the default family an omitted NOT NULL column
 *     must have), not a hash, so a refusal can name the offending column.
 *
 * Nothing here is imported by runtime code.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

export const MIGRATION_069_PATH = join(
  ROOT,
  "supabase_migrations",
  "069_application_form_controls.sql"
);

export const PROD_BASELINE_PATH = join(
  ROOT,
  "VAM_OS_PROD_S12_RELEASE_20260809",
  "validation",
  "prod_baseline_reproduction.sql"
);

export const PROD_T1_PATH = join(
  ROOT,
  "VAM_OS_PROD_S12_RELEASE_20260809",
  "apply",
  "T1_audit_action_type_compat.sql"
);

/**
 * The completed S12 release transaction that installed the historical Probe C
 * artifact `public.vam069_trusted_context_probe()`. R4 reads it so the
 * "unrelated vam069_ function" the guards must tolerate is a real repository
 * artifact, not a string invented by a test.
 */
export const PROD_T3_PATH = join(
  ROOT,
  "VAM_OS_PROD_S12_RELEASE_20260809",
  "apply",
  "T3_membership_lifecycle_objects.sql"
);

const migration = readFileSync(MIGRATION_069_PATH, "utf8");
const prodBaseline = readFileSync(PROD_BASELINE_PATH, "utf8");
const prodT1 = readFileSync(PROD_T1_PATH, "utf8");
const prodT3 = readFileSync(PROD_T3_PATH, "utf8");

// ===========================================================================
// 0. THE MIGRATION-OWNED OBJECT INVENTORY (R4)
// ===========================================================================

/**
 * R4. The unapplied/partial-schema guards in preflight.sql and apply.sql
 * Section 0 must express "no object belonging to THIS migration exists". R3
 * expressed something broader — "no function anywhere carries the vam069_
 * prefix" — and the two are not the same set.
 *
 * The prefix is NOT owned by migration 069. The completed Production S12
 * release installed `public.vam069_trusted_context_probe()` in its T3, and it
 * is live on Production. Under the R3 rule a completely unapplied Production
 * refused with FUNCTION_PRESENT, which is a false positive, and rollback.sql's
 * post-condition would have declared a correct rollback FAILED for the same
 * reason.
 *
 * These constants are derived from the canonical migration itself, so the
 * inventory the SQL guards hard-code cannot drift away from the objects the
 * migration actually creates.
 */
export interface OwnedFunction {
  schema: string;
  name: string;
  qualifiedName: string;
  /** The declared parameter TYPE vector, e.g. `""` or `"uuid, text, text, text, text"`. */
  argTypes: string;
}

/**
 * Every function `create or replace function`d by migration 069, with its
 * declared parameter type vector. Parsed with a balanced-paren scan rather than
 * a regex over the argument list, because the RPC's parameter list spans lines.
 */
export function ownedFunctionsFromMigration(): OwnedFunction[] {
  const out: OwnedFunction[] = [];
  const head = /create or replace function\s+([a-z_][a-z0-9_]*)\.([a-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = head.exec(migration)) !== null) {
    const open = head.lastIndex - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < migration.length; i += 1) {
      const ch = migration[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) {
      throw new Error(`migration 069: unbalanced parameter list for ${m[1]}.${m[2]}`);
    }
    const argTypes = migration
      .slice(open + 1, close)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      // "p_actor_admin_user_id uuid" -> "uuid"; a bare "uuid" stays "uuid".
      .map((p) => {
        const parts = p.split(/\s+/);
        return parts.length >= 2 ? parts.slice(1).join(" ") : parts[0];
      })
      .join(", ");

    out.push({
      schema: m[1],
      name: m[2],
      qualifiedName: `${m[1]}.${m[2]}`,
      argTypes
    });
  }

  if (out.length === 0) {
    throw new Error("migration 069 creates no functions — the parse is wrong");
  }
  return out.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
}

export const M069_OWNED_FUNCTIONS = ownedFunctionsFromMigration();

/** The bare names the SQL guards match on, sorted, as they appear in the arrays. */
export const M069_OWNED_FUNCTION_NAMES = M069_OWNED_FUNCTIONS.map((f) => f.name);

/**
 * The relation / trigger / constraint half of the inventory. Unlike `vam069_`,
 * the `application_form_controls` prefix IS this migration's own object
 * namespace: every catalog name it can match is a name migration 069 creates.
 * That is why the guards keep a prefix scan there and only there.
 */
export const M069_OWNED_OBJECT_PREFIX = "application_form_controls";

/**
 * TEST FIXTURE, not a rule. The vam069_-prefixed functions that exist in this
 * repository and are NOT owned by migration 069 — read out of the completed S12
 * release so the fixture cannot describe a function that no longer exists.
 *
 * Nothing in the M069 SQL names these. The guards tolerate them because they
 * are not in the owned inventory, never because they appear on a list.
 */
export function foreignVam069FunctionsFromRelease(): string[] {
  const names = new Set<string>();
  const re = /create (?:or replace )?function\s+public\.(vam069_[a-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prodT3)) !== null) {
    if (!M069_OWNED_FUNCTION_NAMES.includes(m[1])) names.add(m[1]);
  }
  return Array.from(names).sort();
}

export const FOREIGN_VAM069_FUNCTIONS = foreignVam069FunctionsFromRelease();

// ===========================================================================
// 1. CHECK constraints — exact normalised catalog definitions
// ===========================================================================

/**
 * The single normalisation both sides apply before comparing: runs of
 * whitespace collapse to one space and the ends are trimmed. This is the
 * `btrim(regexp_replace(def, '\s+', ' ', 'g'))` the verifier performs. Nothing
 * else is discarded — not parentheses, not `::text` casts, not value order, not
 * a trailing `NOT VALID`.
 */
export function normalizeCatalogText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * How PostgreSQL renders `check (<col> = any (array[...]))` through
 * `pg_get_constraintdef(oid, true)`. The form is fixed by existing, accepted
 * repository evidence that compares real Production output to a literal:
 * `supabase_migrations/062_review_only_account_admin_rls_foundation.sql:169`
 * and `VAM_OS_PROD_S12_RELEASE_20260809/preflight.sql:250`.
 */
export function deparseCheckAnyArray(column: string, values: readonly string[]): string {
  const elements = values.map((v) => `'${v}'::text`).join(", ");
  return `CHECK (${column} = ANY (ARRAY[${elements}]))`;
}

export interface CanonicalCheck {
  /** Constraint name as written in the migration. */
  name: string;
  /** The single column the constraint is attached to. */
  column: string;
  /** Admitted values, in the order the migration lists them. */
  values: string[];
  /** The complete normalised definition the verifier must require. */
  definition: string;
}

/**
 * Reads a `constraint <name> check (<col> = any (array[...]))` clause out of
 * the canonical migration and derives the catalog definition it will produce.
 * This is the drift lock: edit the migration's DDL and this value changes, so
 * the verifier's hard-coded constant stops matching and the test fails.
 */
export function canonicalCheckFromMigration(constraintName: string): CanonicalCheck {
  const pattern = new RegExp(
    `constraint\\s+${constraintName}\\s+check\\s*\\(\\s*(\\w+)\\s*=\\s*any\\s*\\(\\s*array\\[([^\\]]*)\\]\\s*\\)\\s*\\)`,
    "i"
  );
  const found = migration.match(pattern);
  if (!found) {
    throw new Error(`migration 069 declares no CHECK named ${constraintName}`);
  }
  const column = found[1];
  const values = Array.from(found[2].matchAll(/'([^']*)'/g)).map((m) => m[1]);
  if (values.length === 0) {
    throw new Error(`CHECK ${constraintName} lists no values`);
  }
  return {
    name: constraintName,
    column,
    values,
    definition: deparseCheckAnyArray(column, values)
  };
}

export const CANONICAL_ROLE_CHECK = canonicalCheckFromMigration(
  "application_form_controls_role_check"
);

export const CANONICAL_STATE_CHECK = canonicalCheckFromMigration(
  "application_form_controls_state_check"
);

/**
 * THE MECHANISM the verifier implements for V07/V08, expressed once so the
 * adversarial cases can be driven through it directly.
 *
 * A candidate constraint is accepted only when every structural fact holds AND
 * the complete normalised definition equals the canonical one. There is no
 * path that accepts a definition because it happens to contain the right
 * literals: `definition` is compared whole.
 */
export interface CandidateConstraint {
  /** `pg_get_constraintdef(oid, true)` as the catalog would render it. */
  definition: string;
  /** `conname`. */
  name: string;
  /** `conrelid::regclass::text`. */
  table: string;
  /** Column names behind `conkey`, joined with `+`. */
  attachedTo: string;
  /** `convalidated`. */
  validated: boolean;
}

export function constraintAccepted(
  expected: CanonicalCheck,
  expectedTable: string,
  candidates: readonly CandidateConstraint[]
): boolean {
  if (candidates.length !== 1) return false;
  const c = candidates[0];
  return (
    c.name === expected.name &&
    c.table === expectedTable &&
    c.attachedTo === expected.column &&
    c.validated === true &&
    normalizeCatalogText(c.definition) === normalizeCatalogText(expected.definition)
  );
}

// ===========================================================================
// 2. Function bodies — exact prosrc identity
// ===========================================================================

/**
 * The exact text PostgreSQL stores in `pg_proc.prosrc` for a function the
 * canonical migration creates: everything between the opening and closing `$$`
 * delimiters, byte for byte, including the leading and trailing newline.
 *
 * The repository is pinned to LF endings (`.gitattributes`), so this is stable
 * across platforms — the same property the migration-immutability and
 * SHA256SUMS gates already depend on.
 */
export function functionBodyFromMigration(qualifiedName: string): string {
  const marker = `create or replace function ${qualifiedName}`;
  const at = migration.indexOf(marker);
  if (at === -1) {
    throw new Error(`migration 069 does not create ${qualifiedName}`);
  }
  const open = migration.indexOf("\nas $$", at);
  if (open === -1) {
    throw new Error(`${qualifiedName} has no dollar-quoted body`);
  }
  const start = open + "\nas $$".length;
  const close = migration.indexOf("$$;", start);
  if (close === -1) {
    throw new Error(`${qualifiedName} has no closing delimiter`);
  }
  return migration.slice(start, close);
}

/** The seal the verifier compares: `encode(sha256(convert_to(prosrc,'UTF8')),'hex')`. */
export function bodySealSha256(body: string): string {
  return createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
}

/** Retained alongside the SHA-256 seal as the R2-compatible diagnostic. */
export function bodySealMd5(body: string): string {
  return createHash("md5").update(Buffer.from(body, "utf8")).digest("hex");
}

export const CANONICAL_BINDING_BODY = functionBodyFromMigration(
  "public.vam069_assert_control_binding"
);

export const CANONICAL_RPC_BODY = functionBodyFromMigration(
  "public.vam069_set_application_form_state"
);

export const EXPECTED_BINDING_BODY_SEAL = bodySealSha256(CANONICAL_BINDING_BODY);
export const EXPECTED_RPC_BODY_SEAL = bodySealSha256(CANONICAL_RPC_BODY);

/**
 * THE MECHANISM the verifier implements for V19/V23. Structural properties are
 * proven one by one, and body identity is proven by seal equality — additional
 * to them, never a substitute. A body is accepted only if its seal equals the
 * expected seal, so preserved marker words in comments or in unreachable code
 * cannot buy a PASS.
 */
export interface CandidateFunction {
  schema: string;
  name: string;
  /**
   * `pg_get_function_identity_arguments(oid)` — which in PostgreSQL includes
   * the parameter NAMES. They are part of the callable contract here, because
   * app/actions/application-form-controls.ts invokes the RPC through PostgREST
   * with named arguments.
   */
  argSignature: string;
  /** `oidvectortypes(proargtypes)` — the bare type vector. */
  argTypes: string;
  /** `pg_get_function_result(oid)`. */
  resultType: string;
  /** `pg_language.lanname`. */
  language: string;
  /** `prosecdef`. */
  securityDefiner: boolean;
  /** `proconfig`, verbatim. */
  config: string[];
  owner: string;
  /** `prosrc`. */
  body: string;
}

export interface FunctionContract {
  schema: string;
  name: string;
  argSignature: string;
  argTypes: string;
  resultType: string;
  language: string;
  securityDefiner: boolean;
  config: string[];
  /** Owners that may never hold a SECURITY DEFINER function. */
  forbiddenOwners: readonly string[];
  expectedBodySeal: string;
}

export function functionAccepted(
  contract: FunctionContract,
  candidates: readonly CandidateFunction[]
): boolean {
  if (candidates.length !== 1) return false;
  const f = candidates[0];
  const normalizedConfig = f.config.map((c) => c.replace(/\s+/g, ""));
  const expectedConfig = contract.config.map((c) => c.replace(/\s+/g, ""));
  return (
    f.schema === contract.schema &&
    f.name === contract.name &&
    f.argSignature === contract.argSignature &&
    f.argTypes === contract.argTypes &&
    f.resultType === contract.resultType &&
    f.language === contract.language &&
    f.securityDefiner === contract.securityDefiner &&
    normalizedConfig.length === expectedConfig.length &&
    normalizedConfig.every((c, i) => c === expectedConfig[i]) &&
    !contract.forbiddenOwners.includes(f.owner) &&
    bodySealSha256(f.body) === contract.expectedBodySeal
  );
}

export const BINDING_FUNCTION_CONTRACT: FunctionContract = {
  schema: "public",
  name: "vam069_assert_control_binding",
  argSignature: "",
  argTypes: "",
  resultType: "trigger",
  language: "plpgsql",
  securityDefiner: true,
  config: ["search_path=public, pg_temp"],
  forbiddenOwners: ["anon", "authenticated", "service_role"],
  expectedBodySeal: EXPECTED_BINDING_BODY_SEAL
};

export const RPC_FUNCTION_CONTRACT: FunctionContract = {
  schema: "public",
  name: "vam069_set_application_form_state",
  argSignature:
    "p_actor_admin_user_id uuid, p_intake_batch_code text, p_applicant_role text, " +
    "p_expected_state text, p_new_state text",
  argTypes: "uuid, text, text, text, text",
  resultType:
    "TABLE(outcome_status text, previous_state text, new_state text, updated_at timestamp with time zone, actor_email text)",
  language: "plpgsql",
  securityDefiner: true,
  config: ["search_path=public, pg_temp"],
  forbiddenOwners: ["anon", "authenticated", "service_role"],
  expectedBodySeal: EXPECTED_RPC_BODY_SEAL
};

// ---------------------------------------------------------------------------
// Body mutations — the adversarial replacements the seal must reject.
// Each one keeps the marker words R2's V19/V23 searched for.
// ---------------------------------------------------------------------------

/**
 * Comment out `lineCount` lines starting at the line containing `needle`. The
 * enforcement is gone; every word of it is still in prosrc, which is exactly
 * the replacement R2's marker search could not tell from the real thing.
 */
export function commentOutBlock(body: string, needle: string, lineCount: number): string {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => l.includes(needle));
  if (at === -1) throw new Error(`body has no line containing ${needle}`);
  for (let i = at; i < at + lineCount; i += 1) {
    lines[i] = `  -- ${lines[i].trim()}`;
  }
  return lines.join("\n");
}

/** Move the block starting at `needle` behind `if false then ... end if;`. */
export function makeUnreachable(body: string, needle: string, lineCount: number): string {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => l.includes(needle));
  if (at === -1) throw new Error(`body has no line containing ${needle}`);
  const block = lines.splice(at, lineCount);
  lines.splice(at, 0, "  if false then", ...block, "  end if;");
  return lines.join("\n");
}

/** Replace an exact substring; throws if it is not present, so a stale test fails loudly. */
export function replaceExactly(body: string, from: string, to: string): string {
  if (!body.includes(from)) throw new Error(`body does not contain ${from}`);
  return body.split(from).join(to);
}

// ===========================================================================
// 3. The complete admin_audit_log INSERT contract
// ===========================================================================

export type AuditSupply = "value" | "null" | "omitted";

export interface AuditColumnContract {
  column: string;
  /** `format_type(atttypid, atttypmod)`, e.g. `text`, `uuid`, `timestamp with time zone`. */
  type: string;
  /**
   * How the M069 audit INSERT treats this column:
   *   value   — an expression is written into it
   *   null    — the literal NULL is written into it, so it must be nullable
   *   omitted — not named in the INSERT at all
   */
  supply: AuditSupply;
  /**
   * For an omitted NOT NULL column: the family its default must belong to.
   * `null` when the column is nullable when omitted, or supplied directly.
   */
  defaultPattern: string | null;
}

export interface AuditColumnCatalog {
  column: string;
  /** `format_type(atttypid, atttypmod)`. */
  type: string;
  /** `attnotnull`. */
  notNull: boolean;
  /** `pg_get_expr(adbin, adrelid)`, or null when the column has no default. */
  defaultExpr: string | null;
  /** `attidentity`: '' | 'a' (ALWAYS) | 'd' (BY DEFAULT). */
  identity: "" | "a" | "d";
  /** `attgenerated`: '' | 's' (STORED). */
  generated: "" | "s";
}

/** The default families an omitted NOT NULL column of each type may rely on. */
const DEFAULT_FAMILIES: Array<{ match: RegExp; pattern: string }> = [
  {
    match: /^(gen_random_uuid|uuid_generate_v4)\(\)$/,
    pattern: "^([a-z_]+\\.)?(gen_random_uuid|uuid_generate_v4)\\(\\)$"
  },
  {
    match: /^(now\(\)|CURRENT_TIMESTAMP)$/,
    pattern: "^([a-z_]+\\.)?(now\\(\\)|CURRENT_TIMESTAMP)$"
  }
];

function defaultFamilyFor(defaultExpr: string): string {
  const family = DEFAULT_FAMILIES.find((f) => f.match.test(defaultExpr));
  if (!family) {
    throw new Error(
      `the accepted Production baseline defaults admin_audit_log to ${defaultExpr}, ` +
        "which is not a modelled generator family"
    );
  }
  return family.pattern;
}

/** SQL type keywords as `format_type` renders them. */
const TYPE_RENDERING: Record<string, string> = {
  uuid: "uuid",
  text: "text",
  jsonb: "jsonb",
  timestamptz: "timestamp with time zone"
};

/**
 * The live Production admin_audit_log shape, derived — not restated — from the
 * two accepted release artifacts:
 *
 *   1. `validation/prod_baseline_reproduction.sql`, which reproduces the
 *      13-column table Probe A captured on 2026-08-09; and
 *   2. `apply/T1_audit_action_type_compat.sql` Section 1, which drops NOT NULL
 *      from every legacy column that was NOT NULL without a default.
 *
 * Applying (2) to (1) is exactly the baseline M069 is proposed against.
 */
export function productionAuditCatalog(): AuditColumnCatalog[] {
  const at = prodBaseline.indexOf("create table public.admin_audit_log (");
  if (at === -1) throw new Error("the baseline reproduction has no admin_audit_log");
  const body = prodBaseline.slice(
    prodBaseline.indexOf("(", at) + 1,
    prodBaseline.indexOf("\n);", at)
  );

  const columns: AuditColumnCatalog[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/--.*$/, "").trim().replace(/,$/, "");
    if (!line) continue;
    const parsed = line.match(/^(\w+)\s+(\w+)\s*(.*)$/);
    if (!parsed) throw new Error(`unparseable admin_audit_log column: ${raw}`);
    const [, column, typeKeyword, rest] = parsed;
    const type = TYPE_RENDERING[typeKeyword];
    if (!type) throw new Error(`unmodelled column type ${typeKeyword} on ${column}`);
    const defaultMatch = rest.match(/\bdefault\s+(.+?)(?:\s+references\b.*)?$/i);
    columns.push({
      column,
      type,
      // PRIMARY KEY implies NOT NULL in the catalog, which is precisely why
      // `id` belongs in the omitted-NOT-NULL-needs-a-default class.
      notNull: /\bnot null\b/i.test(rest) || /\bprimary key\b/i.test(rest),
      defaultExpr: defaultMatch ? defaultMatch[1].trim() : null,
      identity: "",
      generated: ""
    });
  }

  // T1 Section 1: every legacy column that is NOT NULL without a default has
  // its NOT NULL dropped. The column list is read out of T1 itself.
  const legacyClause = prodT1.match(/a\.attname in \(([^)]*)\)/);
  if (!legacyClause) throw new Error("T1 does not name the legacy columns");
  const legacy = Array.from(legacyClause[1].matchAll(/'([^']*)'/g)).map((m) => m[1]);
  for (const column of columns) {
    if (legacy.includes(column.column) && column.notNull && column.defaultExpr === null) {
      column.notNull = false;
    }
  }

  return columns.sort((a, b) => a.column.localeCompare(b.column));
}

/**
 * The columns the M069 audit INSERT names, and the expression written into
 * each — read out of the canonical migration's own INSERT statement, so a
 * change to what the RPC writes changes the derived contract.
 */
export function m069AuditInsert(): Array<{ column: string; value: string }> {
  const at = migration.indexOf("insert into public.admin_audit_log (");
  if (at === -1) throw new Error("migration 069 has no audit INSERT");
  const colsOpen = migration.indexOf("(", at);
  const colsClose = migration.indexOf(")", colsOpen);
  const columns = migration
    .slice(colsOpen + 1, colsClose)
    .split(",")
    .map((c) => c.replace(/--.*$/gm, "").trim())
    .filter(Boolean);

  const valuesOpen = migration.indexOf("(", migration.indexOf("values", colsClose));
  const values: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = valuesOpen + 1; i < migration.length; i += 1) {
    const ch = migration[i];
    if (ch === "(") depth += 1;
    if (ch === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    if (ch === "," && depth === 0) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  values.push(current.trim());

  const cleaned = values.map((v) =>
    v
      .split("\n")
      .map((l) => l.replace(/--.*$/, "").trim())
      .join(" ")
      .trim()
  );

  if (cleaned.length !== columns.length) {
    throw new Error(
      `the audit INSERT names ${columns.length} columns but supplies ${cleaned.length} values`
    );
  }
  return columns.map((column, i) => ({ column, value: cleaned[i] }));
}

/**
 * The complete contract, derived by combining the accepted Production baseline
 * with what the M069 INSERT actually does to each column.
 */
export function deriveAuditContract(): AuditColumnContract[] {
  const catalog = productionAuditCatalog();
  const insert = m069AuditInsert();
  const supplied = new Map(insert.map((i) => [i.column, i.value]));

  return catalog.map((c) => {
    let supply: AuditSupply;
    if (!supplied.has(c.column)) {
      supply = "omitted";
    } else {
      supply = supplied.get(c.column) === "null" ? "null" : "value";
    }

    let defaultPattern: string | null = null;
    if (supply === "omitted" && c.notNull) {
      if (c.defaultExpr === null) {
        throw new Error(
          `${c.column} is NOT NULL, omitted by the M069 INSERT, and has no default in the baseline`
        );
      }
      defaultPattern = defaultFamilyFor(c.defaultExpr);
    }

    return { column: c.column, type: c.type, supply, defaultPattern };
  });
}

export const M069_AUDIT_CONTRACT = deriveAuditContract();

/**
 * THE MECHANISM apply.sql Section 0 and preflight.sql implement, expressed once
 * so the adversarial baselines can be driven through it. Returns one message
 * per violation, sorted, exactly as the SQL aggregates them; empty means the
 * baseline satisfies the contract and the apply may proceed.
 */
export function auditContractViolations(
  contract: readonly AuditColumnContract[],
  catalog: readonly AuditColumnCatalog[]
): string[] {
  const out: string[] = [];
  const byName = new Map(catalog.map((c) => [c.column, c]));
  const expected = new Set(contract.map((c) => c.column));

  for (const e of contract) {
    if (!byName.has(e.column)) out.push(`${e.column}: absent from admin_audit_log`);
  }
  for (const a of catalog) {
    if (!expected.has(a.column)) {
      out.push(`${a.column}: present but not part of the M069 audit INSERT contract`);
    }
  }
  for (const e of contract) {
    const a = byName.get(e.column);
    if (!a) continue;

    if (a.type !== e.type) {
      out.push(`${e.column}: type is ${a.type}, the contract requires ${e.type}`);
    }
    if ((e.supply === "value" || e.supply === "null") && (a.generated !== "" || a.identity === "a")) {
      out.push(
        `${e.column}: GENERATED/IDENTITY ALWAYS, but the M069 INSERT supplies it explicitly`
      );
    }
    if (e.supply === "null" && a.notNull) {
      out.push(`${e.column}: NOT NULL, but the M069 INSERT writes NULL into it`);
    }
    const hasUsableDefault =
      a.defaultExpr !== null && !/^null(::[a-z ]+)?$/i.test(a.defaultExpr.trim());
    if (
      e.supply === "omitted" &&
      a.notNull &&
      a.identity === "" &&
      a.generated === "" &&
      !hasUsableDefault
    ) {
      out.push(
        `${e.column}: omitted by the M069 INSERT and NOT NULL with no usable default, ` +
          "identity or generated value"
      );
    }
    if (
      e.defaultPattern !== null &&
      a.identity === "" &&
      a.generated === "" &&
      (a.defaultExpr === null || !new RegExp(e.defaultPattern).test(a.defaultExpr.trim()))
    ) {
      out.push(
        `${e.column}: default is ${a.defaultExpr ?? "<none>"}, the contract requires ` +
          e.defaultPattern
      );
    }
  }
  return out.sort();
}

/**
 * Serialised contract row, exactly as the SQL contract arrays spell it. `#`
 * separates the fields because the default-family regexes contain `|`.
 */
export function contractRow(c: AuditColumnContract): string {
  return `${c.column}#${c.type}#${c.supply}#${c.defaultPattern ?? ""}`;
}

export const M069_AUDIT_CONTRACT_ROWS = M069_AUDIT_CONTRACT.map(contractRow);

/**
 * Reads a contract array out of a SQL file, given the text that introduces it.
 * Bracket matching skips anything inside a quoted literal, because the
 * default-family regexes contain `[a-z_]`.
 */
export function parseSqlAuditContract(sql: string, marker: string): string[] {
  const at = sql.indexOf(marker);
  if (at === -1) throw new Error(`no contract array introduced by ${marker}`);
  const open = sql.indexOf("array[", at);
  if (open === -1) throw new Error(`no array literal after ${marker}`);
  let i = open + "array[".length;
  let depth = 1;
  let inQuote = false;
  for (; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error(`unterminated contract array at ${marker}`);
  return Array.from(sql.slice(open, i).matchAll(/'([^']*)'/g)).map((m) => m[1]);
}

/** Every place in the package that spells the contract out. */
export const CONTRACT_ARRAY_MARKERS: Array<[string, string]> = [
  ["preflight guard", "v_audit_contract constant text[] := array["],
  ["preflight token CTE", "audit_contract(spec) as ("],
  ["apply Section 0 guard", "v_audit_contract constant text[] := array["]
];

/**
 * The PostgreSQL type each value the RPC writes resolves to. `v_actor.*` is a
 * row from `admin_users`, so those two resolve through the baseline's
 * admin_users DDL rather than being asserted.
 */
export function insertValueType(value: string): string | null {
  if (value === "null") return null;
  if (/^'[^']*'$/.test(value)) return "text";
  if (value.startsWith("jsonb_build_object(")) return "jsonb";
  const actorColumn = value.match(/^v_actor\.(\w+)$/);
  if (actorColumn) return adminUsersColumnType(actorColumn[1]);
  throw new Error(`unmodelled audit INSERT value: ${value}`);
}

function adminUsersColumnType(column: string): string {
  const at = prodBaseline.indexOf("create table public.admin_users (");
  if (at === -1) throw new Error("the baseline reproduction has no admin_users");
  const body = prodBaseline.slice(
    prodBaseline.indexOf("(", at) + 1,
    prodBaseline.indexOf("\n);", at)
  );
  for (const raw of body.split("\n")) {
    const line = raw.replace(/--.*$/, "").trim().replace(/,$/, "");
    const parsed = line.match(/^(\w+)\s+(\w+)\b/);
    if (parsed && parsed[1] === column) {
      const type = TYPE_RENDERING[parsed[2]];
      if (!type) throw new Error(`unmodelled admin_users.${column} type ${parsed[2]}`);
      return type;
    }
  }
  throw new Error(`admin_users has no column ${column}`);
}

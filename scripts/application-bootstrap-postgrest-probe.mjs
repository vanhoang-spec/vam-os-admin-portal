// VAM OS — migration 059 PostgREST security probe (NOT EXECUTED BY THIS PACKAGE).
//
// Verifies, over the real PostgREST surface, that the migration 059 privilege
// contract holds for public.applications and public.application_answers:
//   1. service_role SELECT succeeds
//   2. anon SELECT is denied
//   3. anon INSERT is denied
//   4. unauthorized authenticated SELECT is denied
//   5. unauthorized authenticated INSERT is denied
//   6. service_role controlled INSERT/SELECT/DELETE succeeds and cleans up
//   7. no token, key, email, raw UUID, cookie or authorization header is printed
//
// Safety:
//   * staging only — the endpoint is validated against a strict allowlist by
//     validateEndpoint() below: exact parsed hostname, https only, no
//     credentials, no port, no path/query/fragment. Substring matching is
//     never used, because a host such as
//     ljfneyuvpxrmejpxsmpz.attacker.example contains the staging ref and
//     would otherwise receive every credential in the config file.
//   * refuses to run without --authorize-staging-probe
//   * credentials are read from a caller-supplied config file, never embedded,
//     never echoed, never logged, never interpolated into an error
//   * every emitted string passes through redact() before it reaches stdout
//   * step 6 is the only write, runs at most once with no retry loop, and its
//     cleanup is confirmed by a follow-up read; an unconfirmed cleanup fails
//     the whole probe
//
// This module is side-effect free on import: the probe runs only when the
// file is executed directly, which lets validateEndpoint() and redact() be
// unit-tested without any network access.
//
// Usage (owner-run, staging, after migration 059 is applied and verified):
//   node scripts/application-bootstrap-postgrest-probe.mjs \
//     --config <path> --authorize-staging-probe
//
// Config shape (no secret is ever written back out):
//   { "endpoint": "https://ljfneyuvpxrmejpxsmpz.supabase.co",
//     "anonKey": "...", "serviceRoleKey": "...",
//     "unauthorizedAuthenticatedToken": "..." }

import { pathToFileURL } from "node:url";

export const EXPECTED_HOST = "ljfneyuvpxrmejpxsmpz.supabase.co";
export const FORBIDDEN_HOST = "qkkroesfiazsejkzflcd.supabase.co";

/** The only two endpoint strings this probe will ever accept. */
export const ACCEPTED_ENDPOINTS = Object.freeze([
  `https://${EXPECTED_HOST}`,
  `https://${EXPECTED_HOST}/`,
]);

const TABLES = ["applications", "application_answers"];

/**
 * Strict endpoint contract. Returns null when the endpoint is acceptable, or
 * a fixed error code otherwise. Error codes are constants — the supplied
 * value is never interpolated into them, so a malformed endpoint carrying a
 * credential cannot leak through a validation message.
 *
 * Validation is performed on the parsed WHATWG URL, not on the raw string:
 * `https://ljfneyuvpxrmejpxsmpz.supabase.co@attacker.example` parses to
 * hostname `attacker.example`, and a Unicode homograph parses to its punycode
 * form. Only after the parsed URL fully satisfies the contract is the raw
 * input additionally narrowed to the two canonical forms above, so casing and
 * other non-canonical spellings of the right host are rejected too.
 */
export function validateEndpoint(raw) {
  if (typeof raw !== "string" || raw.length === 0) return "endpoint_missing";

  let u;
  try {
    u = new URL(raw);
  } catch {
    return "endpoint_unparseable";
  }

  if (u.protocol !== "https:") return "endpoint_protocol_not_https";
  if (u.username !== "" || u.password !== "") return "endpoint_contains_credentials";
  if (u.port !== "") return "endpoint_non_default_port";
  if (u.search !== "") return "endpoint_has_query";
  if (u.hash !== "") return "endpoint_has_fragment";
  if (u.pathname !== "" && u.pathname !== "/") return "endpoint_has_path";

  // Explicit production rejection ahead of the generic host check, so the
  // reason is unambiguous in the output.
  if (u.hostname === FORBIDDEN_HOST) return "endpoint_is_forbidden_production_host";

  // Exact hostname equality. A trailing dot ("...supabase.co.") is a distinct
  // hostname and is deliberately NOT normalised away: it is rejected here.
  if (u.hostname !== EXPECTED_HOST) return "endpoint_host_not_expected_staging";

  if (!ACCEPTED_ENDPOINTS.includes(raw)) return "endpoint_not_canonical_literal";

  return null;
}

/** Strip anything that could identify a person, session or project secret. */
export const redact = (v) => {
  if (typeof v !== "string") return v;
  return v
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "[redacted-token]")
    .replace(/sb[ps]?_[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "[redacted-uuid]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/(authorization|apikey|cookie|set-cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]");
};

export async function main(argv = process.argv) {
  const results = [];
  const check = (name, pass, expected, status, rowCount) =>
    results.push({ name, pass: Boolean(pass), expected, status, rowCount });

  const emit = (pass, reason) => {
    // Only names, booleans, expectations, HTTP statuses and row counts leave
    // this process. Response payloads and request metadata never do.
    const safe = results.map((r) => ({
      name: redact(r.name),
      pass: r.pass,
      expected: redact(r.expected),
      status: typeof r.status === "number" ? r.status : null,
      rowCount: typeof r.rowCount === "number" ? r.rowCount : null,
    }));
    process.stdout.write(
      JSON.stringify({
        probe: "VAM059_POSTGREST_SECURITY_PROBE_V1",
        target: "staging",
        credentialsEmbedded: false,
        pass: Boolean(pass),
        reason: redact(reason),
        results: safe,
      })
    );
    if (!pass) process.exitCode = 1;
    return Boolean(pass);
  };

  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? null : argv[i + 1] ?? null;
  };

  const configPath = arg("--config");
  if (!argv.includes("--authorize-staging-probe")) {
    return emit(false, "not_authorized: pass --authorize-staging-probe to run");
  }
  if (!configPath) return emit(false, "missing_config");

  const { readFile } = await import("node:fs/promises");
  let cfg;
  try {
    cfg = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return emit(false, "invalid_config");
  }

  const endpointError = validateEndpoint(cfg?.endpoint);
  if (endpointError) return emit(false, endpointError);

  const keysOk = ["anonKey", "serviceRoleKey", "unauthorizedAuthenticatedToken"].every(
    (k) => typeof cfg[k] === "string" && cfg[k].length >= 20 && !/\s/.test(cfg[k])
  );
  if (!keysOk) return emit(false, "invalid_key_or_token_config");

  const base = `https://${EXPECTED_HOST}`;
  const call = async (path, key, token, init = {}) => {
    try {
      const r = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          apikey: key,
          Authorization: `Bearer ${token ?? key}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      let rows = null;
      try {
        const payload = await r.json();
        rows = Array.isArray(payload) ? payload.length : null;
      } catch {
        rows = null;
      }
      return { status: r.status, rows };
    } catch {
      return { status: 0, rows: null };
    }
  };

  const denied = (r) => r.status === 401 || r.status === 403 || r.status === 404;

  // 1. service_role SELECT succeeds.
  for (const t of TABLES) {
    const r = await call(`/rest/v1/${t}?select=id&limit=1`, cfg.serviceRoleKey);
    check(`service_role_select_${t}`, r.status === 200, "200", r.status, r.rows);
  }

  // 2/3. anon is denied read and write.
  for (const t of TABLES) {
    const s = await call(`/rest/v1/${t}?select=id&limit=1`, cfg.anonKey);
    check(`anon_select_denied_${t}`, denied(s) && s.rows === null, "401/403/404", s.status, s.rows);
    const i = await call(`/rest/v1/${t}`, cfg.anonKey, null, {
      method: "POST",
      body: JSON.stringify({}),
    });
    check(`anon_insert_denied_${t}`, denied(i), "401/403/404", i.status, i.rows);
  }

  // 4/5. an authenticated JWT with no authorization for this data is denied.
  for (const t of TABLES) {
    const s = await call(
      `/rest/v1/${t}?select=id&limit=1`,
      cfg.anonKey,
      cfg.unauthorizedAuthenticatedToken
    );
    check(
      `unauthorized_authenticated_select_denied_${t}`,
      denied(s) && s.rows === null,
      "401/403/404",
      s.status,
      s.rows
    );
    const i = await call(`/rest/v1/${t}`, cfg.anonKey, cfg.unauthorizedAuthenticatedToken, {
      method: "POST",
      body: JSON.stringify({}),
    });
    check(
      `unauthorized_authenticated_insert_denied_${t}`,
      denied(i),
      "401/403/404",
      i.status,
      i.rows
    );
  }

  // 6. service_role controlled INSERT -> SELECT -> DELETE round trip.
  // The identifier is generated locally and never printed. The insert is
  // attempted exactly once: there is no retry, so no path can create a second
  // synthetic row that cleanup would not match.
  const probeId = crypto.randomUUID();
  const marker = `vam059-probe-${probeId}`;
  const filter = `legacy_application_temp_id=eq.${encodeURIComponent(marker)}`;
  let insertAttempted = false;
  let cleanupConfirmed = false;

  try {
    insertAttempted = true;
    const ins = await call(`/rest/v1/applications`, cfg.serviceRoleKey, null, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: probeId,
        legacy_application_temp_id: marker,
        status: "submitted",
      }),
    });
    check("service_role_insert", ins.status === 201, "201", ins.status, ins.rows);

    const sel = await call(`/rest/v1/applications?select=id&${filter}`, cfg.serviceRoleKey);
    check(
      "service_role_select_own_row",
      sel.status === 200 && sel.rows === 1,
      "200/1 row",
      sel.status,
      sel.rows
    );
  } finally {
    // Cleanup runs in a finally path whenever an insert was attempted, even if
    // the insert or the read above threw. Both the delete and an independent
    // confirming read are reported explicitly.
    if (insertAttempted) {
      const del = await call(`/rest/v1/applications?${filter}`, cfg.serviceRoleKey, null, {
        method: "DELETE",
      });
      check(
        "service_role_delete_cleanup",
        del.status === 200 || del.status === 204,
        "200/204",
        del.status,
        del.rows
      );

      const gone = await call(`/rest/v1/applications?select=id&${filter}`, cfg.serviceRoleKey);
      cleanupConfirmed = gone.status === 200 && gone.rows === 0;
      check("probe_row_removed", cleanupConfirmed, "200/0 rows", gone.status, gone.rows);
    }
  }

  const allPass = results.every((r) => r.pass);
  if (!cleanupConfirmed) {
    return emit(false, "cleanup_unconfirmed: synthetic probe row may remain, remove it manually");
  }
  return emit(allPass, allPass ? "pass" : "application_privilege_boundary_failed");
}

// Side-effect free on import; runs only when executed directly. pathToFileURL
// handles Windows drive letters correctly, which a hand-built file:// string
// would not.
const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  await main();
}

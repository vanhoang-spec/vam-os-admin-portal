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
//   * staging only — the endpoint host must contain the expected staging ref
//     and must not contain the forbidden production ref
//   * refuses to run without --authorize-staging-probe
//   * credentials are read from a caller-supplied config file, never embedded,
//     never echoed, never logged
//   * every emitted string passes through redact() before it reaches stdout
//   * step 6 is the only write, is confined to the two tables this migration
//     creates, and always attempts its own DELETE cleanup
//
// Usage (owner-run, staging, after migration 059 is applied and verified):
//   node scripts/application-bootstrap-postgrest-probe.mjs \
//     --config <path> --authorize-staging-probe
//
// Config shape (no secret is ever written back out):
//   { "endpoint": "https://<staging-ref>.supabase.co",
//     "anonKey": "...", "serviceRoleKey": "...",
//     "unauthorizedAuthenticatedToken": "..." }

const STAGING_REF = "ljfneyuvpxrmejpxsmpz";
const PRODUCTION_REF = "qkkroesfiazsejkzflcd";
const TABLES = ["applications", "application_answers"];

const results = [];
const check = (name, pass, expected, status, rowCount) =>
  results.push({ name, pass: Boolean(pass), expected, status, rowCount });

/** Strip anything that could identify a person, session or project secret. */
const redact = (v) => {
  if (typeof v !== "string") return v;
  return v
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "[redacted-token]")
    .replace(/sb[ps]?_[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "[redacted-uuid]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/(authorization|apikey|cookie|set-cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]");
};

const emit = (pass, reason) => {
  // Only names, booleans, expectations, HTTP statuses and row counts leave this
  // process. Response bodies and request headers never do.
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
};

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? null : process.argv[i + 1] ?? null;
};

const configPath = arg("--config");
const authorized = process.argv.includes("--authorize-staging-probe");

if (!authorized) {
  emit(false, "not_authorized: pass --authorize-staging-probe to run");
} else if (!configPath) {
  emit(false, "missing_config");
} else {
  const { readFile } = await import("node:fs/promises");
  let cfg = null;
  try {
    cfg = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    emit(false, "invalid_config");
  }

  let endpointOk = false;
  if (cfg) {
    try {
      const u = new URL(cfg.endpoint);
      endpointOk =
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.hostname.includes(STAGING_REF) &&
        !u.hostname.includes(PRODUCTION_REF);
    } catch {
      endpointOk = false;
    }
  }

  const keysOk =
    cfg &&
    ["anonKey", "serviceRoleKey", "unauthorizedAuthenticatedToken"].every(
      (k) => typeof cfg[k] === "string" && cfg[k].length >= 20 && !/\s/.test(cfg[k])
    );

  if (!cfg) {
    /* already emitted */
  } else if (!endpointOk) {
    emit(false, "endpoint_not_expected_staging_project");
  } else if (!keysOk) {
    emit(false, "invalid_key_or_token_config");
  } else {
    const call = async (path, key, token, init = {}) => {
      try {
        const r = await fetch(`${cfg.endpoint}${path}`, {
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
          const body = await r.json();
          rows = Array.isArray(body) ? body.length : null;
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
    // The identifier is generated locally and never printed.
    const probeId = crypto.randomUUID();
    const marker = `vam059-probe-${probeId}`;
    let created = false;
    try {
      const ins = await call(`/rest/v1/applications`, cfg.serviceRoleKey, null, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          id: probeId,
          legacy_application_temp_id: marker,
          status: "submitted",
        }),
      });
      created = ins.status === 201;
      check("service_role_insert", created, "201", ins.status, ins.rows);

      const sel = await call(
        `/rest/v1/applications?select=id&legacy_application_temp_id=eq.${encodeURIComponent(marker)}`,
        cfg.serviceRoleKey
      );
      check("service_role_select_own_row", sel.status === 200 && sel.rows === 1, "200/1 row", sel.status, sel.rows);
    } finally {
      const del = await call(
        `/rest/v1/applications?legacy_application_temp_id=eq.${encodeURIComponent(marker)}`,
        cfg.serviceRoleKey,
        null,
        { method: "DELETE" }
      );
      check("service_role_delete_cleanup", del.status === 200 || del.status === 204, "200/204", del.status, del.rows);

      const gone = await call(
        `/rest/v1/applications?select=id&legacy_application_temp_id=eq.${encodeURIComponent(marker)}`,
        cfg.serviceRoleKey
      );
      check("probe_row_removed", gone.status === 200 && gone.rows === 0, "200/0 rows", gone.status, gone.rows);
    }

    const allPass = results.every((r) => r.pass);
    emit(allPass, allPass ? "pass" : "application_privilege_boundary_failed");
  }
}

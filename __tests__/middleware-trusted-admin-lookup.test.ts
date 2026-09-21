/**
 * Regression suite for the post-T2 Production auth hotfix.
 *
 * Production release S12 / T2 removed SELECT on `public.admin_users` from
 * `anon` and `authenticated` (RLS enabled, zero policies). RC3 middleware
 * still resolved the active-admin row *as the end user*, so that lookup was
 * refused, middleware read the refusal as "not an admin", and every protected
 * navigation bounced to /login — an infinite redirect loop.
 *
 * The fake PostgREST in this file models the real post-T2 posture: any
 * `admin_users` read that does NOT present the service-role credential is
 * answered `401 42501 permission denied for table admin_users`, exactly as
 * Production does now. A test can therefore only pass by going through the
 * trusted server lookup — restoring anon/authenticated SELECT would not make
 * these green, and weakening T2 is not a way to satisfy them.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveActiveAdminViaTrustedServer,
  resolveTrustedCredential,
  SERVICE_ROLE_ENV_NAME
} from "@/lib/middleware-admin-lookup";
import {
  restoreProcessState,
  snapshotProcessState,
  type ProcessStateSnapshot
} from "./support/process-state";

const SUPABASE_URL = "https://qkkroesfiazsejkzflcd.supabase.co";
const ANON_KEY = "sb_publishable_anonkey_for_tests";
const SERVICE_ROLE_KEY = "test_service_role_key_value";

const ADMIN_ID = "11111111-2222-3333-4444-555555555555";
const ADMIN_EMAIL = "admin@vam.test";
const OTHER_ID = "99999999-8888-7777-6666-555555555555";

const VALID_ACCESS_TOKEN = "valid-access-token";
const EXPIRED_ACCESS_TOKEN = "expired-access-token";
const VALID_REFRESH_TOKEN = "valid-refresh-token";
const REFRESHED_ACCESS_TOKEN = "refreshed-access-token";

function baseEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined as string | undefined,
    [SERVICE_ROLE_ENV_NAME]: SERVICE_ROLE_KEY
  };
}

type AdminRow = { auth_user_id: string | null; email: string | null; status: string | null };

type FakeCall = { url: string; headers: Record<string, string>; cache?: string };

/**
 * Builds a fetch double over Supabase Auth + PostgREST.
 *
 * `rows` is the whole `admin_users` table; filtering is applied from the query
 * string the way PostgREST would, so a test cannot pass by the production code
 * simply forgetting a filter.
 */
function createFakeSupabase(rows: AdminRow[]) {
  const calls: FakeCall[] = [];

  const fetchImpl = (async (input: any, init?: any) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])
    );
    calls.push({ url, headers, cache: init?.cache });

    if (url.includes("/auth/v1/token")) {
      const body = JSON.parse(init?.body ?? "{}");
      if (body.refresh_token !== VALID_REFRESH_TOKEN) return json(400, { error: "invalid_grant" });
      return json(200, {
        access_token: REFRESHED_ACCESS_TOKEN,
        refresh_token: "rotated-refresh-token",
        expires_in: 3600
      });
    }

    if (url.includes("/auth/v1/user")) {
      const bearer = (headers.authorization ?? "").replace("Bearer ", "");
      if (bearer !== VALID_ACCESS_TOKEN && bearer !== REFRESHED_ACCESS_TOKEN) {
        return json(401, { message: "invalid JWT" });
      }
      return json(200, { id: ADMIN_ID, email: ADMIN_EMAIL });
    }

    if (url.includes("/rest/v1/admin_users")) {
      // Post-T2 Production posture: RLS on, zero policies, no SELECT for
      // anon/authenticated. Only the service-role credential may read.
      const presented = headers.apikey ?? "";
      const bearer = (headers.authorization ?? "").replace("Bearer ", "");
      if (presented !== SERVICE_ROLE_KEY || bearer !== SERVICE_ROLE_KEY) {
        return json(401, { code: "42501", message: "permission denied for table admin_users" });
      }

      const params = new URL(url).searchParams;
      let result = rows;
      if (params.get("status") === "eq.active") result = result.filter((r) => r.status === "active");
      const authFilter = params.get("auth_user_id");
      if (authFilter === "is.null") result = result.filter((r) => r.auth_user_id === null);
      else if (authFilter?.startsWith("eq.")) {
        const want = authFilter.slice(3);
        result = result.filter((r) => r.auth_user_id === want);
      }
      const emailFilter = params.get("email");
      if (emailFilter?.startsWith("eq.")) {
        const want = emailFilter.slice(3);
        result = result.filter((r) => r.email === want);
      }
      const limit = Number(params.get("limit") ?? "1000");
      return json(200, result.slice(0, limit));
    }

    throw new Error(`unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const activeLinkedAdmin: AdminRow = { auth_user_id: ADMIN_ID, email: ADMIN_EMAIL, status: "active" };

describe("trusted-server admin lookup — credential hardening", () => {
  it("fails closed when the service-role credential is missing", () => {
    const env = { ...baseEnv(), [SERVICE_ROLE_ENV_NAME]: undefined };
    expect(resolveTrustedCredential(env)).toEqual({ ok: false, reason: "missing_service_role_key" });
  });

  it("fails closed when the service-role credential equals the anon credential", () => {
    const env = { ...baseEnv(), [SERVICE_ROLE_ENV_NAME]: ANON_KEY };
    expect(resolveTrustedCredential(env)).toEqual({
      ok: false,
      reason: "service_role_key_equals_anon_key"
    });
  });

  it("fails closed when the service-role credential is a publishable key", () => {
    const env = { ...baseEnv(), [SERVICE_ROLE_ENV_NAME]: "sb_publishable_something_else" };
    expect(resolveTrustedCredential(env)).toEqual({
      ok: false,
      reason: "service_role_key_is_publishable_key"
    });
  });

  it("also compares against the publishable-key env var when anon is unset", () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      [SERVICE_ROLE_ENV_NAME]: "sb_publishable_x"
    };
    expect(resolveTrustedCredential(env)).toEqual({
      ok: false,
      reason: "service_role_key_equals_anon_key"
    });
  });

  it("never uses a NEXT_PUBLIC_ prefixed name for the trusted credential", () => {
    expect(SERVICE_ROLE_ENV_NAME.startsWith("NEXT_PUBLIC_")).toBe(false);
  });

  it("denies the request when the credential cannot be resolved", async () => {
    const { fetchImpl, calls } = createFakeSupabase([activeLinkedAdmin]);
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      { ...baseEnv(), [SERVICE_ROLE_ENV_NAME]: undefined },
      fetchImpl
    );
    expect(decision).toEqual({ allowed: false, reason: "missing_service_role_key" });
    // Fails closed BEFORE reaching the network.
    expect(calls).toHaveLength(0);
  });
});

describe("trusted-server admin lookup — authorization decisions", () => {
  it("allows an active admin linked by auth_user_id", async () => {
    const { fetchImpl } = createFakeSupabase([activeLinkedAdmin]);
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      baseEnv(),
      fetchImpl
    );
    expect(decision).toEqual({ allowed: true, reason: "active_admin_linked" });
  });

  it("allows an active unlinked legacy row matched by email", async () => {
    const { fetchImpl } = createFakeSupabase([
      { auth_user_id: null, email: ADMIN_EMAIL, status: "active" }
    ]);
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      baseEnv(),
      fetchImpl
    );
    expect(decision).toEqual({ allowed: true, reason: "active_admin_legacy_email" });
  });

  it("denies an authenticated user with no admin_users row", async () => {
    const { fetchImpl } = createFakeSupabase([]);
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      baseEnv(),
      fetchImpl
    );
    expect(decision).toEqual({ allowed: false, reason: "no_active_admin_row" });
  });

  it("denies an inactive admin", async () => {
    const { fetchImpl } = createFakeSupabase([
      { auth_user_id: ADMIN_ID, email: ADMIN_EMAIL, status: "inactive" }
    ]);
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      baseEnv(),
      fetchImpl
    );
    expect(decision).toEqual({ allowed: false, reason: "no_active_admin_row" });
  });

  it("denies when the email matches a row owned by a DIFFERENT auth user", async () => {
    // Service role bypasses RLS, so an `or=` style match on email alone would
    // authorize this session against somebody else's admin row.
    const { fetchImpl } = createFakeSupabase([
      { auth_user_id: OTHER_ID, email: ADMIN_EMAIL, status: "active" }
    ]);
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      baseEnv(),
      fetchImpl
    );
    expect(decision).toEqual({ allowed: false, reason: "no_active_admin_row" });
  });

  it("denies ambiguous identity rather than picking a row arbitrarily", async () => {
    const { fetchImpl } = createFakeSupabase([
      { auth_user_id: ADMIN_ID, email: ADMIN_EMAIL, status: "active" },
      { auth_user_id: ADMIN_ID, email: "second@vam.test", status: "active" }
    ]);
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      baseEnv(),
      fetchImpl
    );
    expect(decision).toEqual({ allowed: false, reason: "ambiguous_identity" });
  });

  it("prefers the linked row and does not consult the legacy path when it exists", async () => {
    const { fetchImpl, calls } = createFakeSupabase([activeLinkedAdmin]);
    await resolveActiveAdminViaTrustedServer({ id: ADMIN_ID, email: ADMIN_EMAIL }, baseEnv(), fetchImpl);
    const restCalls = calls.filter((c) => c.url.includes("/rest/v1/admin_users"));
    expect(restCalls).toHaveLength(1);
  });

  it("fails closed when PostgREST refuses the read", async () => {
    const fetchImpl = (async () => json(500, { message: "boom" })) as unknown as typeof fetch;
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      baseEnv(),
      fetchImpl
    );
    expect(decision).toEqual({ allowed: false, reason: "lookup_request_failed" });
  });

  it("fails closed when the transport throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      baseEnv(),
      fetchImpl
    );
    expect(decision).toEqual({ allowed: false, reason: "lookup_request_failed" });
  });

  it("fails closed on a malformed (non-array) response body", async () => {
    const fetchImpl = (async () => json(200, { unexpected: true })) as unknown as typeof fetch;
    const decision = await resolveActiveAdminViaTrustedServer(
      { id: ADMIN_ID, email: ADMIN_EMAIL },
      baseEnv(),
      fetchImpl
    );
    expect(decision).toEqual({ allowed: false, reason: "lookup_request_failed" });
  });
});

describe("trusted-server admin lookup — identity input hardening", () => {
  it.each([
    ["missing id", { id: undefined, email: ADMIN_EMAIL }],
    ["missing email", { id: ADMIN_ID, email: undefined }],
    ["non-uuid id", { id: "not-a-uuid", email: ADMIN_EMAIL }],
    ["email with a PostgREST separator", { id: ADMIN_ID, email: "a@b.test,c@d.test" }],
    ["email with parentheses", { id: ADMIN_ID, email: "a@b.test)" }],
    ["email with a quote", { id: ADMIN_ID, email: 'a"@b.test' }],
    ["email with whitespace", { id: ADMIN_ID, email: "a b@c.test" }],
    ["wildcard id", { id: "*", email: ADMIN_EMAIL }]
  ])("rejects %s without issuing a query", async (_label, user) => {
    const { fetchImpl, calls } = createFakeSupabase([activeLinkedAdmin]);
    const decision = await resolveActiveAdminViaTrustedServer(user as any, baseEnv(), fetchImpl);
    expect(decision).toEqual({ allowed: false, reason: "invalid_user_identity" });
    expect(calls).toHaveLength(0);
  });

  it("always constrains the query to status=eq.active and a bounded limit", async () => {
    const { fetchImpl, calls } = createFakeSupabase([]);
    await resolveActiveAdminViaTrustedServer({ id: ADMIN_ID, email: ADMIN_EMAIL }, baseEnv(), fetchImpl);
    const restCalls = calls.filter((c) => c.url.includes("/rest/v1/admin_users"));
    expect(restCalls.length).toBeGreaterThan(0);
    for (const call of restCalls) {
      expect(call.url).toContain("status=eq.active");
      expect(call.url).toMatch(/limit=\d+/);
      expect(call.cache).toBe("no-store");
    }
  });

  it("presents the trusted credential and never the user's access token", async () => {
    const { fetchImpl, calls } = createFakeSupabase([activeLinkedAdmin]);
    await resolveActiveAdminViaTrustedServer({ id: ADMIN_ID, email: ADMIN_EMAIL }, baseEnv(), fetchImpl);
    const restCalls = calls.filter((c) => c.url.includes("/rest/v1/admin_users"));
    for (const call of restCalls) {
      expect(call.headers.apikey).toBe(SERVICE_ROLE_KEY);
      expect(call.headers.authorization).toBe(`Bearer ${SERVICE_ROLE_KEY}`);
      expect(call.headers.apikey).not.toBe(ANON_KEY);
      expect(call.headers.authorization).not.toContain(VALID_ACCESS_TOKEN);
    }
  });
});

describe("middleware end-to-end against the post-T2 DB posture", () => {
  // Snapshot is taken per test, not once for the describe: a test that throws
  // must not be able to hand its env or its fetch double to the next one.
  let processState: ProcessStateSnapshot;

  beforeEach(() => {
    processState = snapshotProcessState();
    // Mutated IN PLACE. Assigning a fresh object to `process.env` would swap
    // Node's exotic env object for a plain one for the rest of this worker.
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env[SERVICE_ROLE_ENV_NAME] = SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    // Restores env keys and `globalThis.fetch` together, and runs even when the
    // test body threw before reaching its own cleanup.
    restoreProcessState(processState);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function runMiddleware(cookies: Record<string, string>, pathname = "/operations") {
    const { middleware } = await import("@/middleware");
    const { NextRequest } = await import("next/server");
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    const request = new NextRequest(new URL(`https://vam-os-admin-portal.vercel.app${pathname}`), {
      headers: cookieHeader ? { cookie: cookieHeader } : {}
    });
    return middleware(request);
  }

  async function authCookies() {
    const { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE } = await import("@/lib/auth-constants");
    return { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE };
  }

  /**
   * Bị đưa đi khỏi đường của ban tổ chức, tới đâu thì tuỳ.
   *
   * Điều bài kiểm này quan tâm là KHÔNG VÀO ĐƯỢC /operations. Đích đến khác
   * nhau theo lý do: chưa đăng nhập thì về /login; đăng nhập thật nhưng không
   * phải nhân sự thì về /ct, vì đá một người vừa đăng nhập xong về lại chỗ đăng
   * nhập là một vòng lặp không lối ra.
   */
  function isRedirectTo(response: any, pathname: string) {
    if (!response) return false;
    const location = response.headers.get("location");
    return (
      response.status === 307 &&
      Boolean(location) &&
      new URL(location).pathname === pathname
    );
  }

  function isRedirectToLogin(response: any) {
    if (!response) return false;
    const location = response.headers.get("location");
    return response.status === 307 && Boolean(location) && new URL(location).pathname === "/login";
  }

  it("allows a valid active admin through a protected route (loop is broken)", async () => {
    const { fetchImpl, calls } = createFakeSupabase([activeLinkedAdmin]);
    globalThis.fetch = fetchImpl;
    const { AUTH_ACCESS_COOKIE } = await authCookies();

    const response = await runMiddleware({ [AUTH_ACCESS_COOKIE]: VALID_ACCESS_TOKEN });

    expect(isRedirectToLogin(response)).toBe(false);
    expect(response.status).toBe(200);
    // Proof the decision came from the trusted path, not from table privilege.
    const restCalls = calls.filter((c) => c.url.includes("/rest/v1/admin_users"));
    expect(restCalls.length).toBeGreaterThan(0);
    expect(restCalls.every((c) => c.headers.apikey === SERVICE_ROLE_KEY)).toBe(true);
  });

  it("cannot loop merely because `authenticated` lacks SELECT on admin_users", async () => {
    // The fake PostgREST refuses every non-service-role read with 42501, i.e.
    // the exact post-T2 grant posture. RC3 middleware redirected here forever.
    const { fetchImpl } = createFakeSupabase([activeLinkedAdmin]);
    globalThis.fetch = fetchImpl;
    const { AUTH_ACCESS_COOKIE } = await authCookies();

    const first = await runMiddleware({ [AUTH_ACCESS_COOKIE]: VALID_ACCESS_TOKEN });
    const second = await runMiddleware({ [AUTH_ACCESS_COOKIE]: VALID_ACCESS_TOKEN });

    expect(isRedirectToLogin(first)).toBe(false);
    expect(isRedirectToLogin(second)).toBe(false);
  });

  it("đưa một người đăng nhập không phải nhân sự sang /ct, KHÔNG cho vào /operations", async () => {
    const { fetchImpl } = createFakeSupabase([]);
    globalThis.fetch = fetchImpl;
    const { AUTH_ACCESS_COOKIE } = await authCookies();

    const response = await runMiddleware({ [AUTH_ACCESS_COOKIE]: VALID_ACCESS_TOKEN });

    // Điều quan trọng nhất: không lọt vào đường của ban tổ chức.
    expect(response.status).not.toBe(200);
    expect(isRedirectTo(response, "/ct")).toBe(true);
    // Và KHÔNG về /login: họ vừa đăng nhập xong.
    expect(isRedirectToLogin(response)).toBe(false);
  });

  it("đưa một nhân sự đã bị khoá ra khỏi /operations", async () => {
    const { fetchImpl } = createFakeSupabase([
      { auth_user_id: ADMIN_ID, email: ADMIN_EMAIL, status: "inactive" }
    ]);
    globalThis.fetch = fetchImpl;
    const { AUTH_ACCESS_COOKIE } = await authCookies();

    const response = await runMiddleware({ [AUTH_ACCESS_COOKIE]: VALID_ACCESS_TOKEN });

    // Middleware chỉ dẫn đường, không phân biệt được "chưa bao giờ là nhân sự"
    // với "đã bị khoá" — phép tra tin cậy trả về cùng một lý do cho cả hai. Nơi
    // tách hai trường hợp ấy là trang /ct, bằng phép kiểm hasAnyAdminUserRow.
    expect(response.status).not.toBe(200);
    expect(isRedirectTo(response, "/ct")).toBe(true);
  });

  it("fails closed to /login when the service-role credential is missing", async () => {
    delete process.env[SERVICE_ROLE_ENV_NAME];
    const { fetchImpl } = createFakeSupabase([activeLinkedAdmin]);
    globalThis.fetch = fetchImpl;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { AUTH_ACCESS_COOKIE } = await authCookies();

    const response = await runMiddleware({ [AUTH_ACCESS_COOKIE]: VALID_ACCESS_TOKEN });

    expect(isRedirectToLogin(response)).toBe(true);
    // Misconfiguration is diagnosable rather than a silent loop...
    expect(errorSpy).toHaveBeenCalledWith(
      "[middleware] trusted admin lookup credential misconfigured",
      { reason: "missing_service_role_key", envName: SERVICE_ROLE_ENV_NAME }
    );
    errorSpy.mockRestore();
  });

  it("fails closed to /login when the service-role credential equals the anon key", async () => {
    process.env[SERVICE_ROLE_ENV_NAME] = ANON_KEY;
    const { fetchImpl } = createFakeSupabase([activeLinkedAdmin]);
    globalThis.fetch = fetchImpl;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { AUTH_ACCESS_COOKIE } = await authCookies();

    const response = await runMiddleware({ [AUTH_ACCESS_COOKIE]: VALID_ACCESS_TOKEN });

    expect(isRedirectToLogin(response)).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      "[middleware] trusted admin lookup credential misconfigured",
      { reason: "service_role_key_equals_anon_key", envName: SERVICE_ROLE_ENV_NAME }
    );
    // ...but the credential itself never reaches the log.
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(ANON_KEY);
    expect(logged).not.toContain(SERVICE_ROLE_KEY);
    errorSpy.mockRestore();
  });

  it("does not log anything for a routine non-admin denial", async () => {
    const { fetchImpl } = createFakeSupabase([]);
    globalThis.fetch = fetchImpl;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { AUTH_ACCESS_COOKIE } = await authCookies();

    const response = await runMiddleware({ [AUTH_ACCESS_COOKIE]: VALID_ACCESS_TOKEN });

    expect(isRedirectTo(response, "/ct")).toBe(true);
    // No user identity in the logs on the routine path.
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("refreshes an expired access token and allows an active admin", async () => {
    const { fetchImpl } = createFakeSupabase([activeLinkedAdmin]);
    globalThis.fetch = fetchImpl;
    const { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE } = await authCookies();

    const response = await runMiddleware({
      [AUTH_ACCESS_COOKIE]: EXPIRED_ACCESS_TOKEN,
      [AUTH_REFRESH_COOKIE]: VALID_REFRESH_TOKEN
    });

    expect(isRedirectToLogin(response)).toBe(false);
    expect(response.status).toBe(200);
    expect(response.cookies.get(AUTH_ACCESS_COOKIE)?.value).toBe(REFRESHED_ACCESS_TOKEN);
  });

  it("phiên vừa làm mới mà không phải nhân sự cũng KHÔNG vào được /operations", async () => {
    const { fetchImpl } = createFakeSupabase([]);
    globalThis.fetch = fetchImpl;
    const { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE } = await authCookies();

    const response = await runMiddleware({
      [AUTH_ACCESS_COOKIE]: EXPIRED_ACCESS_TOKEN,
      [AUTH_REFRESH_COOKIE]: VALID_REFRESH_TOKEN
    });

    // Đường làm mới token có nhánh riêng, và nó cũng phải phân loại đúng ba
    // trạng thái — không phải chỉ nhánh token còn hạn.
    expect(response.status).not.toBe(200);
    expect(isRedirectTo(response, "/ct")).toBe(true);
  });

  it("redirects an anonymous visitor to /login without touching admin_users", async () => {
    const { fetchImpl, calls } = createFakeSupabase([activeLinkedAdmin]);
    globalThis.fetch = fetchImpl;

    const response = await runMiddleware({});
    expect(isRedirectToLogin(response)).toBe(true);
    expect(calls.filter((c) => c.url.includes("/rest/v1/admin_users"))).toHaveLength(0);
  });

  it("keeps public register/checkin routes passing through untouched", async () => {
    const { fetchImpl, calls } = createFakeSupabase([]);
    globalThis.fetch = fetchImpl;

    for (const path of ["/register/abc", "/checkin/xyz"]) {
      const response = await runMiddleware({}, path);
      expect(isRedirectToLogin(response)).toBe(false);
      expect(response.status).toBe(200);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("public route matcher is unchanged by this hotfix", () => {
  it("still excludes login, apply, reset-password and static assets", async () => {
    const { config } = await import("@/middleware");
    // `api/cron` thêm 22/09/2026 cho bộ gửi thư nhắc đặt lịch phỏng vấn:
    // request của Vercel Cron không mang cookie, để middleware chặn là job
    // chết lặng ở /login. Route tự kiểm CRON_SECRET.
    expect(config.matcher).toEqual([
      "/((?!login|auth/callback|apply|reset-password|e2e-harness|api/cron|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"
    ]);
  });

  it("opens exactly /auth/callback, not the /auth namespace", () => {
    const pattern = new RegExp(
      "^/((?!login|auth/callback|apply|reset-password|e2e-harness|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)$"
    );
    // The page that turns an emailed token into a session must be reachable
    // without one.
    expect(pattern.test("/auth/callback")).toBe(false);
    // Everything else under /auth stays behind the gate.
    expect(pattern.test("/auth")).toBe(true);
    expect(pattern.test("/auth/admin")).toBe(true);
  });

  it("does not run for /apply/mentor or /apply/mentee", () => {
    const pattern = new RegExp(
      "^/((?!login|auth/callback|apply|reset-password|e2e-harness|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)$"
    );
    expect(pattern.test("/apply/mentor")).toBe(false);
    expect(pattern.test("/apply/mentee")).toBe(false);
    expect(pattern.test("/login")).toBe(false);
    expect(pattern.test("/operations")).toBe(true);
  });
});

describe("no client-side exposure of the trusted credential", () => {
  const repoRoot = join(__dirname, "..");

  it("middleware no longer reads admin_users with the anon credential", () => {
    const source = readFileSync(join(repoRoot, "middleware.ts"), "utf8");
    const adminUsersLine = source
      .split("\n")
      .find((line) => line.includes("/rest/v1/admin_users"));
    expect(adminUsersLine).toBeUndefined();
  });

  it("the lookup module imports nothing that could reach a client bundle", () => {
    const raw = readFileSync(join(repoRoot, "lib/middleware-admin-lookup.ts"), "utf8");
    // Assert against CODE, not prose: the header comment legitimately names the
    // modules this file is required to avoid.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    expect(code).not.toContain('"use client"');
    expect(code).not.toContain("next/headers");
    expect(code).not.toContain("@supabase/supabase-js");
    expect(code).not.toContain("server-only");
    // Zero imports at all — only bare `fetch`, keeping the module Edge-safe.
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it("the trusted credential is never interpolated into a log or a response", () => {
    const lookup = readFileSync(join(repoRoot, "lib/middleware-admin-lookup.ts"), "utf8");
    const middleware = readFileSync(join(repoRoot, "middleware.ts"), "utf8");
    for (const source of [lookup, middleware]) {
      expect(source).not.toMatch(/console\.(log|warn|error|info)[\s\S]{0,200}serviceRoleKey/);
      expect(source).not.toMatch(/console\.(log|warn|error|info)[\s\S]{0,200}SERVICE_ROLE_KEY/);
    }
  });

  it("no client component imports the trusted lookup module", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of require("fs").readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".git")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const source = readFileSync(full, "utf8");
          if (source.includes("middleware-admin-lookup") && source.includes('"use client"')) {
            offenders.push(full);
          }
        }
      }
    };
    walk(join(repoRoot, "app"));
    walk(join(repoRoot, "components"));
    walk(join(repoRoot, "lib"));
    expect(offenders).toEqual([]);
  });
});

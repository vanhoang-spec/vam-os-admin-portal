/**
 * VAM OS edge middleware — Supabase authentication access control.
 *
 * Supabase Auth (the /login page + Supabase cookies):
 *   Real per-user identity. Each admin authenticates with their
 *   Supabase account; the row in `public.admin_users` (status =
 *   'active') determines their role and what they can see/do.
 *
 * Expected flow: <protected URL> → /login → originally requested URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE } from "@/lib/auth-constants";
import {
  isTrustedCredentialMisconfiguration,
  resolveActiveAdminViaTrustedServer,
  SERVICE_ROLE_ENV_NAME
} from "@/lib/middleware-admin-lookup";

/**
 * Snapshot of the env vars the trusted lookup needs.
 *
 * Each value is read with a STATIC `process.env.X` member access on purpose.
 * The Edge bundle Next.js builds for middleware substitutes those literals at
 * build time; handing `process.env` itself to another module and indexing it
 * dynamically can therefore yield `undefined` at runtime. That would fail
 * closed — safe, but it would leave the redirect loop unfixed. The rest of
 * this file already reads env the same way.
 */
function trustedLookupEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

async function fetchAuthUser(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  if (!response.ok) return null;
  return (await response.json()) as { id?: string; email?: string };
}

async function refreshAccessToken(refreshToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store"
  });

  if (!response.ok) return null;
  return (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
}

/**
 * Resolves the active `admin_users` row for an ALREADY-VALIDATED Supabase Auth
 * user, in trusted server context.
 *
 * This deliberately does NOT query as the end user. Production release S12/T2
 * removed SELECT on `admin_users` from `anon` and `authenticated` (RLS on,
 * zero policies); querying with the user's access token is refused there, and
 * middleware read that refusal as "not an admin" — the post-RC3 redirect loop.
 * The table stays unreadable to anon/authenticated; only this server-side
 * resolution is privileged. See `lib/middleware-admin-lookup.ts`.
 *
 * Fails CLOSED on every error path, including a missing service-role
 * credential or one that is really the anon key.
 */
async function hasActiveAdminUser(user: { id?: string; email?: string }) {
  const decision = await resolveActiveAdminViaTrustedServer(user, trustedLookupEnv(), fetch);

  // Surface ONLY credential misconfiguration. Those states deny every admin and
  // would otherwise be indistinguishable from "nobody here is an admin" — a
  // silent redirect loop with nothing to diagnose. Per-user denials are
  // deliberately NOT logged: they are routine and would put user identity in
  // the logs. The reason codes are fixed strings; no key, token, header or user
  // identity is ever logged.
  if (isTrustedCredentialMisconfiguration(decision.reason)) {
    console.error("[middleware] trusted admin lookup credential misconfigured", {
      reason: decision.reason,
      envName: SERVICE_ROLE_ENV_NAME
    });
  }

  return decision.allowed;
}

async function authAllowsRequest(request: NextRequest) {
  const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
  if (accessToken) {
    const user = await fetchAuthUser(accessToken);
    if (user && (await hasActiveAdminUser(user))) return NextResponse.next();
  }

  const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;

  const refreshed = await refreshAccessToken(refreshToken);
  if (!refreshed?.access_token) return null;

  const user = await fetchAuthUser(refreshed.access_token);
  if (!user || !(await hasActiveAdminUser(user))) return null;

  const response = NextResponse.next();
  response.cookies.set(AUTH_ACCESS_COOKIE, refreshed.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: refreshed.expires_in ?? 60 * 60
  });
  if (refreshed.refresh_token) {
    response.cookies.set(AUTH_REFRESH_COOKIE, refreshed.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/register/") ||
    request.nextUrl.pathname.startsWith("/checkin/") ||
    request.nextUrl.pathname.startsWith("/renew/")
  ) {
    const requestHeaders = new Headers(request.headers);
    const publicRoute = request.nextUrl.pathname.startsWith("/checkin/")
      ? "checkin"
      : request.nextUrl.pathname.startsWith("/renew/")
        ? "renewal"
        : "register";
    requestHeaders.set("x-vam-public-route", publicRoute);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (publicRoute === "renewal") {
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      response.headers.set("Pragma", "no-cache");
    }
    return response;
  }

  // Stage 2 first: if a real Supabase session resolves to an active
  // admin_users row, the request is allowed through and the unlock
  // gate is not re-checked. This is intentional — real auth is
  // strictly stronger than the shared MVP password.
  const authResponse = await authAllowsRequest(request);
  if (authResponse) return authResponse;
  return redirectToLogin(request);
}

export const config = {
  // Excludes `apply/*` so the public intake forms (/apply/mentor,
  // /apply/mentee) bypass the admin auth + unlock gate.
  //
  // M069: those routes are protected by the database-backed gate in
  // `lib/apply-gate.ts`, which the page render AND the submission Server
  // Action both resolve. The default state is CLOSED, so excluding them here
  // does not expose an open form — it exposes a closed notice until an
  // authorised admin changes the state from Quản trị → Mùa & Form đăng ký.
  matcher: ["/((?!login|apply|reset-password|e2e-harness|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};

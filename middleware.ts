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

async function hasActiveAdminUser(user: { id?: string; email?: string }, accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  if (!supabaseUrl || !supabaseAnonKey || !user.id || !user.email) return false;

  const filter = encodeURIComponent(`(auth_user_id.eq.${user.id},email.eq.${user.email})`);
  const response = await fetch(
    `${supabaseUrl}/rest/v1/admin_users?select=email&status=eq.active&or=${filter}&limit=1`,
    {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    }
  );

  if (!response.ok) return false;
  const rows = (await response.json()) as unknown[];
  return rows.length > 0;
}

async function authAllowsRequest(request: NextRequest) {
  const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
  if (accessToken) {
    const user = await fetchAuthUser(accessToken);
    if (user && (await hasActiveAdminUser(user, accessToken))) return NextResponse.next();
  }

  const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;

  const refreshed = await refreshAccessToken(refreshToken);
  if (!refreshed?.access_token) return null;

  const user = await fetchAuthUser(refreshed.access_token);
  if (!user || !(await hasActiveAdminUser(user, refreshed.access_token))) return null;

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
  // Routes a visitor reaches without a Supabase session: public event
  // registration, public check-in, the mentor season-confirmation link, the
  // program documents, and a mentor's expiring link to their mentee's
  // application. Each is flagged with `x-vam-public-route`
  // so `app/layout.tsx` renders it without the admin shell. The value is
  // derived from the pathname here and never read from the incoming request,
  // so a client cannot spoof it.
  const publicRoute = request.nextUrl.pathname.startsWith("/documents/")
    ? "documents"
    : request.nextUrl.pathname.startsWith("/mentee-dossier/")
      ? "mentee-dossier"
      : request.nextUrl.pathname.startsWith("/register/")
    ? "register"
    : request.nextUrl.pathname.startsWith("/checkin/")
      ? "checkin"
      : request.nextUrl.pathname.startsWith("/confirm/")
        ? "confirm"
        : null;

  if (publicRoute) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-vam-public-route", publicRoute);
    return NextResponse.next({ request: { headers: requestHeaders } });
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
  // Excludes `apply/*` so the public pilot intake forms (/apply/mentor,
  // /apply/mentee) bypass the admin auth + unlock gate. Those routes
  // are protected by their own per-route token check (see
  // `app/apply/*/page.tsx` + `VAM_OS_APPLICATION_PILOT_TOKEN`).
  //
  // Two machine endpoints are excluded as well, because a browser redirect to
  // /login is a useless answer to a program: `api/recap-import` (the Chrome
  // collector, bearer `VAM_OS_RECAP_IMPORT_TOKEN`) and `api/cron/*` (Vercel
  // Cron, bearer `CRON_SECRET`). Both check their own token before touching
  // anything, and both refuse the request outright when the secret is unset.
  // Every other /api path stays behind this gate.
  matcher: ["/((?!login|apply|reset-password|e2e-harness|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/recap-import|api/cron).*)"]
};

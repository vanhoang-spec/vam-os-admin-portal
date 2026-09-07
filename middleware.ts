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
  isParticipantPath,
  isReportOnlyPath,
  isReportOnlyRole,
  ROUTES
} from "@/lib/participant-auth-core";

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
 * The caller's own admin row, if they have one.
 *
 * Returns the role rather than a boolean because `vam_admin` — the read-only
 * reporting account — has to be kept out of every operational screen, and this
 * is the one place that decision can be made once instead of on thirty pages.
 * RLS on admin_users exposes a user their own row, so the user's own token is
 * enough; no service-role key enters the edge runtime.
 */
async function fetchAdminRole(user: { id?: string; email?: string }, accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  if (!supabaseUrl || !supabaseAnonKey || !user.id || !user.email) return null;

  const filter = encodeURIComponent(`(auth_user_id.eq.${user.id},email.eq.${user.email})`);
  const response = await fetch(
    `${supabaseUrl}/rest/v1/admin_users?select=email,role&status=eq.active&or=${filter}&limit=1`,
    {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    }
  );

  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{ role?: string }>;
  return rows.length > 0 ? String(rows[0]?.role ?? "") : null;
}

/**
 * What the current cookies amount to.
 *
 * Three answers, not two. The distinction migration 071 forced open is between
 * "nobody is signed in" and "somebody is signed in but is not staff" — the
 * second is a mentor or a mentee, and sending them to /login when they are
 * already logged in is a loop, not an answer.
 *
 * Deliberately does NOT read `participant_accounts`: that table has RLS on with
 * no policies, so a token-scoped read returns nothing, and giving the edge
 * runtime the service-role key to answer a question the destination page
 * answers anyway would widen the blast radius for nothing. Middleware decides
 * staff-or-not; the participant pages verify who they are themselves.
 */
type SessionState =
  | { state: "none" }
  | { state: "admin"; role: string; response: NextResponse }
  | { state: "signed_in"; response: NextResponse };

function refreshedResponse(
  refreshed: { access_token?: string; refresh_token?: string; expires_in?: number },
  requestHeaders?: Headers
) {
  const response = NextResponse.next(requestHeaders ? { request: { headers: requestHeaders } } : undefined);
  if (refreshed.access_token) {
    response.cookies.set(AUTH_ACCESS_COOKIE, refreshed.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: refreshed.expires_in ?? 60 * 60
    });
  }
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

async function resolveSession(
  request: NextRequest,
  requestHeaders?: Headers
): Promise<SessionState> {
  const pass = () =>
    NextResponse.next(requestHeaders ? { request: { headers: requestHeaders } } : undefined);

  const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
  if (accessToken) {
    const user = await fetchAuthUser(accessToken);
    if (user) {
      const role = await fetchAdminRole(user, accessToken);
      return role === null
        ? { state: "signed_in", response: pass() }
        : { state: "admin", role, response: pass() };
    }
  }

  const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value;
  if (!refreshToken) return { state: "none" };

  const refreshed = await refreshAccessToken(refreshToken);
  if (!refreshed?.access_token) return { state: "none" };

  const user = await fetchAuthUser(refreshed.access_token);
  if (!user) return { state: "none" };

  const role = await fetchAdminRole(user, refreshed.access_token);
  const response = refreshedResponse(refreshed, requestHeaders);
  return role === null ? { state: "signed_in", response } : { state: "admin", role, response };
}

export async function middleware(request: NextRequest) {
  // Routes a visitor reaches without a Supabase session: public event
  // registration, public check-in, the mentor season-confirmation link, the
  // cross-mentoring invitation link, the
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
        : request.nextUrl.pathname.startsWith("/cross/")
          ? "cross"
          : null;

  if (publicRoute) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-vam-public-route", publicRoute);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Flagged the same way as the public routes above: derived from the pathname,
  // never read from the incoming request, so a client cannot claim it. The
  // layout uses it to render a participant without the operations shell.
  const participantRoute = isParticipantPath(request.nextUrl.pathname);
  let requestHeaders: Headers | undefined;
  if (participantRoute) {
    requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-vam-participant-route", "1");
  }

  const session = await resolveSession(request, requestHeaders);

  // Nobody is signed in. Same answer as always.
  if (session.state === "none") return redirectToLogin(request);

  if (session.state === "admin") {
    // The reporting account may read and export, and do nothing else. Enforced
    // here rather than page by page, so a screen added later is closed to it
    // without anybody having to remember.
    if (isReportOnlyRole(session.role) && !isReportOnlyPath(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = ROUTES.reports;
      url.search = "";
      return NextResponse.redirect(url);
    }

    // Every other active admin_users row: allowed everywhere, exactly as before.
    return session.response;
  }

  // Signed in, but not staff — a mentor or a mentee. They may reach the
  // participant routes and nothing else. This is the fence that keeps a mentee
  // out of the operations portal, and it is why participants were given their
  // own table rather than a role in admin_users: the default here is refusal.
  if (participantRoute) return session.response;

  // Bounced to their own home rather than to /login, which they have already
  // passed and would only pass again.
  const url = request.nextUrl.clone();
  url.pathname = ROUTES.participantHome;
  url.search = "";
  return NextResponse.redirect(url);
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

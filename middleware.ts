import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE } from "@/lib/auth-constants";
import { ADMIN_UNLOCK_COOKIE, ADMIN_UNLOCK_SALT } from "@/lib/password-gate";

async function unlockToken(password: string) {
  const payload = new TextEncoder().encode(`${ADMIN_UNLOCK_SALT}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

function redirectToUnlock(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

async function fetchAuthUser(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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

async function hasActiveAdminUser(user: { id?: string; email?: string }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !user.id || !user.email) return false;

  const filter = encodeURIComponent(`(auth_user_id.eq.${user.id},email.eq.${user.email})`);
  const response = await fetch(
    `${supabaseUrl}/rest/v1/admin_users?select=email&status=eq.active&or=${filter}&limit=1`,
    {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`
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
  const authResponse = await authAllowsRequest(request);
  if (authResponse) return authResponse;

  const password = process.env.VAM_OS_ADMIN_PASSWORD;
  if (!password) return redirectToLogin(request);

  const expectedToken = await unlockToken(password);
  const currentToken = request.cookies.get(ADMIN_UNLOCK_COOKIE)?.value;

  if (currentToken === expectedToken) return redirectToLogin(request);

  return redirectToUnlock(request);
}

export const config = {
  matcher: ["/((?!login|unlock|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};

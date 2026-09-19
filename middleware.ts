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

  // KHÔNG phải nhân sự là một chuyện; KHÔNG XÁC ĐỊNH ĐƯỢC là chuyện khác hẳn.
  //
  // Chỉ `no_active_admin_row` mới có nghĩa là phép tra chạy xong và câu trả lời
  // là không. Khoá cấu hình sai, phép đọc hỏng, dữ liệu nhập nhằng — tất cả đều
  // trả về allowed = false, nhưng chúng KHÔNG nói người này không phải nhân sự.
  //
  // Trước khi có đường participant, gộp lại vô hại: cả hai đều bị chặn. Giờ thì
  // không: coi "không xác định được" là "không phải nhân sự" nghĩa là một sự cố
  // hạ tầng biến mọi người đăng nhập thành participant, và cổng chặn-khi-hỏng mà
  // đợt T2 dựng lên bị vô hiệu ngay lúc nó cần chạy nhất.
  return {
    allowed: decision.allowed,
    conclusive: decision.allowed || decision.reason === "no_active_admin_row"
  };
}

/**
 * Ba trạng thái, không phải hai.
 *
 * Trước đây hàm này chỉ trả lời "vào được" hay "không". Mentor và mentee sắp
 * có tài khoản, và họ là trạng thái thứ ba: phiên đăng nhập THẬT, nhưng không
 * phải nhân sự ban tổ chức. Gộp họ vào "không" nghĩa là đá họ về trang đăng
 * nhập trong khi họ vừa đăng nhập xong — một vòng lặp không lối ra.
 *
 * `admin` vẫn dùng đúng `resolveActiveAdminViaTrustedServer` như cũ. KHÔNG
 * thêm một phép tra vai trò nào đọc `admin_users` bằng token của chính người
 * dùng — đó là phép đọc đã bị thu hồi, và lấy lại là tái sinh vòng lặp
 * chuyển hướng mà module tra cứu tin cậy này sinh ra để chữa.
 */
type SessionState =
  | { kind: "none" }
  | { kind: "admin"; response: NextResponse }
  | { kind: "signed_in"; response: NextResponse };

async function resolveSession(request: NextRequest): Promise<SessionState> {
  const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
  if (accessToken) {
    const user = await fetchAuthUser(accessToken);
    if (user) {
      const verdict = await hasActiveAdminUser(user);
      if (!verdict.conclusive) return { kind: "none" };
      return {
        kind: verdict.allowed ? "admin" : "signed_in",
        response: NextResponse.next()
      };
    }
  }

  const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value;
  if (!refreshToken) return { kind: "none" };

  const refreshed = await refreshAccessToken(refreshToken);
  if (!refreshed?.access_token) return { kind: "none" };

  const user = await fetchAuthUser(refreshed.access_token);
  if (!user) return { kind: "none" };

  const verdict = await hasActiveAdminUser(user);
  if (!verdict.conclusive) return { kind: "none" };
  const kind = verdict.allowed ? "admin" : "signed_in";

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
  return { kind, response };
}

/**
 * Những đường mà một người đăng nhập KHÔNG phải nhân sự được vào.
 *
 * Danh sách đóng, và đó là điểm chính: mọi đường khác vẫn chỉ dành cho ban tổ
 * chức. Thêm một đường vào đây là một quyết định có người ký, không phải hệ
 * quả tình cờ của việc đặt tên thư mục.
 */
const PARTICIPANT_PATHS = ["/ct"] as const;

function isParticipantPath(pathname: string): boolean {
  return PARTICIPANT_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function middleware(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/register/") ||
    request.nextUrl.pathname.startsWith("/checkin/") ||
    // Phiếu khảo sát cuối buổi. Người điền là người vừa dự sự kiện, mở bằng mã
    // QR chiếu trên màn hình hoặc bằng link trong thư — không ai trong số họ có
    // tài khoản ban tổ chức để đăng nhập.
    request.nextUrl.pathname.startsWith("/khao-sat/") ||
    // Tấm vé cá nhân. Công khai có chủ ý: mã nằm trong hộp thư của chính chủ,
    // và tấm vé phải mở được trên một điện thoại chưa đăng nhập, ở cửa sự kiện.
    request.nextUrl.pathname.startsWith("/ve/") ||
    request.nextUrl.pathname.startsWith("/renew/") ||
    // Blog: bài công khai phải đọc được mà không cần đăng nhập — đó là cả lý do
    // nó tồn tại. Phép quyết định bài nào ra được ngoài nằm ở lib/blog-core.ts,
    // chạy trên máy chủ cho từng bài; middleware chỉ mở cửa đường dẫn.
    request.nextUrl.pathname === "/blog" ||
    request.nextUrl.pathname.startsWith("/blog/")
  ) {
    const requestHeaders = new Headers(request.headers);
    const publicRoute = request.nextUrl.pathname.startsWith("/checkin/")
      ? "checkin"
      : request.nextUrl.pathname.startsWith("/khao-sat/")
        ? "survey"
          : request.nextUrl.pathname.startsWith("/renew/")
          ? "renewal"
          : request.nextUrl.pathname.startsWith("/ve/")
            ? "ticket"
            : request.nextUrl.pathname === "/blog" ||
                request.nextUrl.pathname.startsWith("/blog/")
              ? "blog"
              : "register";
    requestHeaders.set("x-vam-public-route", publicRoute);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    // Vé mang tên một người và một mã dùng được ở cửa; nó không được nằm lại
    // trong cache dùng chung, và trang đích của bất kỳ đường dẫn nào trên đó
    // không cần biết mã là gì.
    if (publicRoute === "renewal" || publicRoute === "ticket") {
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
  const session = await resolveSession(request);
  if (session.kind === "admin") return session.response;

  if (session.kind === "signed_in") {
    // Đăng nhập thật, nhưng không phải nhân sự ban tổ chức. Chỉ vào được
    // đường của participant; mọi đường khác đưa về trang của họ, KHÔNG đưa về
    // trang đăng nhập — đá một người vừa đăng nhập xong về lại chỗ đăng nhập
    // là một vòng lặp không lối ra.
    if (!isParticipantPath(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/ct";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // Đặt từ ĐƯỜNG DẪN, không bao giờ đọc từ đầu vào của client: bố cục dùng
    // dấu này để chọn khung hiển thị, nên nhận nó từ ngoài vào là để người ta
    // tự chọn khung của mình.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-vam-participant-route", "1");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

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
  // `auth/callback` is excluded for the same reason as `reset-password`: it
  // is the page that CREATES the session. Gating it behind a session check
  // would bounce every emailed link to /login and discard the token, which is
  // exactly the failure it was built to fix.
  //
  // Named in full, NOT as `auth`. These alternatives are prefix tests, so a
  // bare `auth` would take every future /auth/* route out of the gate — and
  // /authors with it — by accident rather than by decision.
  matcher: ["/((?!login|auth/callback|apply|reset-password|e2e-harness|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};

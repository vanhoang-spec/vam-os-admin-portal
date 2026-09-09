"use server";

import {
  clearAuthCookies,
  findAdminUserForAuthUser,
  getSupabaseAuthClientWithAccessToken,
  setAuthCookies
} from "@/lib/admin-auth";
import { mapAuthError, safeNext } from "@/lib/auth-error-messages";

export type AuthCallbackState =
  | { ok: true; next: string }
  | { ok: false; error: string };

/**
 * Turn the tokens an emailed auth link delivered into this app's session.
 *
 * WHY THIS ROUTE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * Supabase finishes an invite, a recovery or a magic link by redirecting the
 * browser to a URL with the tokens in the FRAGMENT: `#access_token=...`. A
 * fragment is never sent to a server, so nothing on the Next.js side can see
 * it — only a client page can read it and hand it back.
 *
 * Until now the only page that read a fragment was `/reset-password`, and the
 * invite carried no `redirectTo`, so an invited reviewer landed on a page that
 * could not consume their token and was bounced to `/login` with the token
 * discarded in the redirect. The account existed and could never be entered.
 *
 * WHY THE TOKEN IS RE-VERIFIED HERE
 * ---------------------------------------------------------------------------
 * The client hands us a string it read out of its own URL. It is not trusted:
 * `getUser()` asks Supabase whether the token is real and unexpired, and the
 * `admin_users` lookup then decides whether that identity may hold a session in
 * this app at all. Both are the same checks the password path runs — a valid
 * Supabase identity with no active admin row gets a session here for exactly
 * as long as it takes to refuse it.
 */
export async function completeEmailLinkSignIn(input: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  next?: string | null;
}): Promise<AuthCallbackState> {
  const accessToken = String(input.accessToken ?? "").trim();
  const refreshToken = String(input.refreshToken ?? "").trim();
  if (!accessToken || !refreshToken) {
    return { ok: false, error: mapAuthError("invalid_credentials") };
  }

  const client = getSupabaseAuthClientWithAccessToken(accessToken);
  if (!client) return { ok: false, error: mapAuthError("network_unavailable") };

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user?.email) {
    console.warn("[auth-callback] token did not resolve to a user", {
      errorName: error?.name ?? null,
      errorStatus: error?.status ?? null
    });
    await clearAuthCookies();
    return { ok: false, error: mapAuthError("invalid_credentials") };
  }

  let adminUser = null;
  try {
    adminUser = await findAdminUserForAuthUser(data.user);
  } catch (err: any) {
    console.warn("[auth-callback] identity linking failed", err?.message);
    await clearAuthCookies();
    return { ok: false, error: mapAuthError("unauthorized_admin") };
  }

  if (!adminUser) {
    console.warn("[auth-callback] no active admin_users row for this identity");
    await clearAuthCookies();
    return { ok: false, error: mapAuthError("unauthorized_admin") };
  }

  // `expires_in` is the access token's own lifetime; the refresh cookie is what
  // keeps the reviewer signed in across the season, and the middleware rolls it
  // forward on every request.
  const expiresIn = Number.isFinite(input.expiresIn) && input.expiresIn > 0 ? input.expiresIn : 3600;
  await setAuthCookies(accessToken, refreshToken, expiresIn);

  return { ok: true, next: safeNext(input.next) };
}

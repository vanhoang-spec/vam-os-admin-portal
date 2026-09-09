import { headers } from "next/headers";

/**
 * The origin this deployment is being served from, for building absolute URLs
 * that must survive a round trip through Supabase Auth.
 *
 * WHY NOT A REQUIRED ENV VAR
 * ---------------------------------------------------------------------------
 * An invite or magic link has to name where the browser should land, and that
 * has to be absolute. Reading it from configuration means every environment —
 * production, a preview deployment, a laptop — needs the value set correctly or
 * the link silently points somewhere else. The request already knows the answer.
 *
 * `VAM_OS_PUBLIC_BASE_URL` still wins when it is set, for the case where the
 * app is served behind a host name it should not advertise.
 *
 * SPOOFING
 * ---------------------------------------------------------------------------
 * `Host` is caller-controlled, so a forged header could name a foreign origin.
 * That is not the boundary here: Supabase refuses to redirect anywhere outside
 * the project's Redirect Allow List, so a forged host produces a refused
 * redirect, not a token delivered to an attacker. The allow list is the control;
 * this function only supplies a convenient default.
 */
export async function getPublicOrigin(): Promise<string | null> {
  const configured = process.env.VAM_OS_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  // `headers()` throws outside a request scope. A caller that cannot learn the
  // origin gets null and omits the destination, which degrades to the Supabase
  // Site URL — worse, but not a thrown error in the middle of a grant.
  let requestHeaders: Headers;
  try {
    requestHeaders = await headers();
  } catch {
    return null;
  }

  // Vercel terminates TLS at the edge, so the proto the app sees is http and
  // only the forwarded header carries the scheme the browser actually used.
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return null;
  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const proto = forwardedProto ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Absolute URL of the route that turns an emailed auth link into a session.
 *
 * NO QUERY STRING, DELIBERATELY
 * ---------------------------------------------------------------------------
 * Supabase refuses to redirect anywhere that does not match its Redirect Allow
 * List, and an entry written as a bare path does not cover the same URL with
 * parameters appended — covering that needs a wildcard entry someone has to
 * remember to add. Carrying a `?next=` here would put the whole invited-reviewer
 * flow behind a configuration line that is easy to miss and fails silently.
 *
 * So the destination is fixed and the allow-list entry can be exact. Where to
 * land afterwards is decided in the callback action instead, where it costs
 * nothing.
 */
export async function getAuthCallbackUrl(): Promise<string | null> {
  const origin = await getPublicOrigin();
  if (!origin) return null;
  return `${origin}/auth/callback`;
}

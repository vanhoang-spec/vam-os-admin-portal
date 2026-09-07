import "server-only";

import { createHash } from "node:crypto";
import { headers, type UnsafeUnwrappedHeaders } from "next/headers";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  checkHoneypot,
  checkRateLimit,
  extractClientIp,
  RATE_LIMIT_WINDOW_MS,
  SUBMISSION_LOG_RETENTION_DAYS,
  SUBMISSIONS_PER_HOUR,
  type AbuseCheck,
  type ApplyRoute
} from "@/lib/apply-abuse-core";

/**
 * lib/apply-abuse.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Abuse protection for the public forms, backed by public.apply_submission_log
 * (migration 064).
 *
 * Privacy: the raw address is never stored. It is salted with
 * VAM_OS_RATE_LIMIT_SALT and hashed, so the log can count repeat submitters
 * without holding an identifier for them. Changing the salt resets the counters.
 *
 * Availability: every failure mode here is fail-open. If the salt is missing,
 * or the table is unreachable, a real applicant must still be able to apply —
 * the alternative is silently rejecting an entire intake because of a
 * configuration problem.
 */

function hashIp(ip: string): string | null {
  const salt = (process.env.VAM_OS_RATE_LIMIT_SALT ?? "").trim();
  // No salt means the hash would be a plain digest of an IP — i.e. reversible
  // by brute force over the address space. Skip rate limiting instead.
  if (!salt) return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

function currentIpHash(): string | null {
  try {
    const h = (headers() as unknown as UnsafeUnwrappedHeaders);
    const ip = extractClientIp({
      forwardedFor: h.get("x-forwarded-for"),
      realIp: h.get("x-real-ip")
    });
    if (!ip) return null;
    return hashIp(ip);
  } catch {
    // headers() is unavailable outside a request scope; treat as "no limit".
    return null;
  }
}

async function recordSubmission(
  route: ApplyRoute,
  ipHash: string,
  outcome: "accepted" | "rejected_rate_limit" | "rejected_honeypot" | "rejected_gate"
) {
  const client = getSupabaseServiceRoleClient();
  if (!client) return;
  const { error } = await client
    .from("apply_submission_log")
    .insert({ ip_hash: ipHash, route, outcome });
  if (error) {
    console.error("[apply-abuse] submission log insert failed", { code: error.code, route });
  }
}

/** Best-effort prune so the log does not grow without bound. */
async function pruneOldSubmissions() {
  const client = getSupabaseServiceRoleClient();
  if (!client) return;
  const cutoff = new Date(Date.now() - SUBMISSION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await client.from("apply_submission_log").delete().lt("created_at", cutoff);
  if (error) {
    console.error("[apply-abuse] submission log prune failed", { code: error.code });
  }
}

export type GuardResult = AbuseCheck & { ipHash?: string | null };

/**
 * Run the honeypot and rate-limit checks for one public submission.
 *
 * Call this BEFORE doing any work: a rejected request should cost nothing but
 * one counting query.
 */
export async function guardPublicSubmission(input: {
  route: ApplyRoute;
  honeypotValue: unknown;
}): Promise<GuardResult> {
  const ipHash = currentIpHash();

  const honeypot = checkHoneypot(input.honeypotValue);
  if (!honeypot.allowed) {
    if (ipHash) await recordSubmission(input.route, ipHash, "rejected_honeypot");
    return { ...honeypot, ipHash };
  }

  // No hash (no salt configured, or no address in the headers) → no limiting.
  if (!ipHash) return { allowed: true, ipHash: null };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { allowed: true, ipHash };

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await client
    .from("apply_submission_log")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (error) {
    // Fail open: a counting failure must not block a legitimate applicant.
    console.error("[apply-abuse] rate-limit query failed", { code: error.code });
    return { allowed: true, ipHash };
  }

  const verdict = checkRateLimit(count ?? 0, SUBMISSIONS_PER_HOUR);
  if (!verdict.allowed) {
    await recordSubmission(input.route, ipHash, "rejected_rate_limit");
    return { ...verdict, ipHash };
  }

  return { allowed: true, ipHash };
}

/** Record an accepted submission against the rate-limit counter. */
export async function recordAcceptedSubmission(route: ApplyRoute, ipHash: string | null) {
  if (!ipHash) return;
  await recordSubmission(route, ipHash, "accepted");
  // Prune occasionally rather than on every write.
  if (Math.random() < 0.02) await pruneOldSubmissions();
}

/** Record a submission refused by the form gate (flag off / bad token). */
export async function recordGateRejection(route: ApplyRoute, ipHash: string | null) {
  if (!ipHash) return;
  await recordSubmission(route, ipHash, "rejected_gate");
}

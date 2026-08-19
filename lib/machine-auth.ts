import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * lib/machine-auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared-secret checking for the two endpoints a program calls rather than a
 * person: the recap collector and the Vercel cron reminder.
 *
 * Two rules, both deliberate:
 *
 * NO SECRET MEANS NO ENTRY. An unset environment variable closes the endpoint
 * instead of opening it. The opposite default — "no secret configured, so let
 * everything through" — is how a staging deploy ends up accepting anonymous
 * writes.
 *
 * THE COMPARISON IS CONSTANT-TIME over a hash of each side, so neither the
 * secret's length nor its leading characters can be read off the clock.
 */

export type MachineAuthResult = { ok: true } | { ok: false; status: 401 | 503; message: string };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** True when two secrets match, without leaking how far the match got. */
export function secretsMatch(presented: string, expected: string): boolean {
  if (!presented || !expected) return false;
  // Hashing first makes both sides the same length, which timingSafeEqual requires.
  return timingSafeEqual(digest(presented), digest(expected));
}

/** The bearer token on a request, or null when the header is absent or malformed. */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/**
 * Check a request against a secret held in the environment.
 *
 * Returns 503 when the secret is missing (the endpoint is not configured yet)
 * and 401 when it is present but wrong — a distinction the operator needs while
 * setting this up, and which tells an outsider nothing they could not learn by
 * guessing.
 */
export function authorizeMachineRequest(request: Request, envName: string): MachineAuthResult {
  const expected = (process.env[envName] ?? "").trim();
  if (!expected) {
    console.error("[machine-auth] endpoint called but", envName, "is not set — refusing.");
    return { ok: false, status: 503, message: "Endpoint chưa được cấu hình." };
  }

  // Header only. A secret in a query string is a secret in every access log.
  const presented = readBearerToken(request) ?? "";

  if (!secretsMatch(presented, expected)) return { ok: false, status: 401, message: "Không có quyền." };

  return { ok: true };
}

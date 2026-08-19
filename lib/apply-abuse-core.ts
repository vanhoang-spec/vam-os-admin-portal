/**
 * lib/apply-abuse-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure abuse-protection logic for the public intake forms. No Supabase, no
 * `next/headers` — everything here is unit-testable, and the I/O wrapper lives
 * in lib/apply-abuse.ts.
 *
 * The forms are open to the internet (there is no login and, on the current
 * production configuration, no token), so three cheap defences apply:
 *   1. a honeypot field no human ever fills in
 *   2. a per-IP submission ceiling
 *   3. field-length caps, so a single request cannot store unbounded text
 */

export type ApplyRoute = "apply_mentee" | "apply_mentor" | "confirm" | "recap_import";

/**
 * Submissions allowed per hashed IP per hour.
 *
 * Deliberately generous: UEH students share campus NAT and a whole computer lab
 * can appear as one address, so a tight limit would lock out real applicants.
 * This stops scripted floods, not a busy afternoon.
 */
export const SUBMISSIONS_PER_HOUR = 30;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Rows older than this are pruned; they have no further purpose. */
export const SUBMISSION_LOG_RETENTION_DAYS = 7;

/** The honeypot input's name. Hidden from humans, irresistible to naive bots. */
export const HONEYPOT_FIELD = "website";

/** Longest value we will store for a single free-text answer. */
export const MAX_FIELD_LENGTH = 5000;
/** Longest value for a short identity field (name, email, phone, city…). */
export const MAX_SHORT_FIELD_LENGTH = 300;

export type AbuseCheck =
  | { allowed: true }
  | { allowed: false; reason: "honeypot" | "rate_limit"; message: string };

/**
 * A filled honeypot means an automated submission. The response deliberately
 * looks like success — telling a bot exactly which field betrayed it just
 * teaches the next attempt to skip it.
 */
export function checkHoneypot(value: unknown): AbuseCheck {
  const filled = String(value ?? "").trim().length > 0;
  if (!filled) return { allowed: true };
  return {
    allowed: false,
    reason: "honeypot",
    message: "Đã ghi nhận đơn đăng ký."
  };
}

export function checkRateLimit(recentCount: number, limit = SUBMISSIONS_PER_HOUR): AbuseCheck {
  if (recentCount < limit) return { allowed: true };
  return {
    allowed: false,
    reason: "rate_limit",
    message:
      "Hệ thống đang nhận quá nhiều lượt gửi từ kết nối của bạn. Vui lòng thử lại sau khoảng một giờ hoặc liên hệ ban tổ chức."
  };
}

/**
 * Pick the caller's address out of the proxy headers.
 * `x-forwarded-for` is a list, oldest first; the first entry is the client.
 */
export function extractClientIp(headers: {
  forwardedFor?: string | null;
  realIp?: string | null;
}): string | null {
  const forwarded = (headers.forwardedFor ?? "").split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = (headers.realIp ?? "").trim();
  return realIp || null;
}

/** Cap every string in a payload so one request cannot store unbounded text. */
export function truncateFieldValues<T extends Record<string, unknown>>(
  payload: T,
  maxLength = MAX_FIELD_LENGTH
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      result[key] = value.length > maxLength ? value.slice(0, maxLength) : value;
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string" && item.length > maxLength ? item.slice(0, maxLength) : item
      );
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/** Cap a short identity field. */
export function truncateShortField(value: string, maxLength = MAX_SHORT_FIELD_LENGTH): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * PostgREST `ilike` treats % and _ as wildcards, so an address containing an
 * underscore — perfectly legal in an email — would match unrelated rows and be
 * reported as a duplicate. Escape both before building a pattern.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

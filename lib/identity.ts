export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Canonical identity comparison; deliberately performs no provider-specific rewriting. */
export function emailsEqual(left: unknown, right: unknown): boolean {
  const leftEmail = normalizeEmail(left);
  return Boolean(leftEmail) && leftEmail === normalizeEmail(right);
}

/**
 * Escape a canonical email before passing it to PostgREST's `ilike` filter.
 * PostgreSQL treats %, _ and backslash as pattern syntax; applicant input must
 * never be allowed to supply that syntax.
 */
export function escapeIlikePattern(value: unknown): string {
  return String(value ?? "").replace(/[\\%_*]/g, "\\$&");
}

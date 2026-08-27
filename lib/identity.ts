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

/**
 * lib/mentor-confirmations-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure decision logic for mentor season confirmations. No Supabase, no cookies,
 * no `server-only` — everything here is unit-testable in isolation, and the I/O
 * wrapper lives in lib/mentor-confirmations.ts (the `*-core` split CLAUDE.md
 * prescribes).
 *
 * The two things this module decides:
 *   1. what a submitted answer means (parse + normalise + validate)
 *   2. how many mentees a mentor may take in a season (the matching cap)
 */

export type ConfirmationStatus = "pending" | "confirmed" | "declined";
export type ConfirmationSource = "form" | "manual" | "phone" | "application";

/** Mentors choose 1..3; when they confirm without choosing, we assume the smallest. */
export const MIN_MAX_MENTEES = 1;
export const MAX_MAX_MENTEES = 3;
export const DEFAULT_MAX_MENTEES = 1;

/** Cap used for a season that predates the confirmation regime (e.g. Season 11). */
export const LEGACY_MENTOR_CAP = 3;

/** How long an invitation link stays valid unless an operator extends it. */
export const DEFAULT_TOKEN_TTL_DAYS = 60;

export type ConfirmationRowForCap = {
  status?: string | null;
  max_mentees?: number | null;
  extra_slots?: number | null;
};

/**
 * Effective number of mentees a mentor may hold in a season.
 *
 *   confirmed          → declared capacity + any extra slots core_team granted
 *   pending | declined → 0 (the mentor is not eligible for this season)
 *   no row at all      → LEGACY_MENTOR_CAP
 *
 * The last case is what keeps Season 11 working: a season where nobody was ever
 * asked to confirm has no rows, so every mentor keeps the historical cap of 3.
 * The moment a season has confirmation rows, absence of a row for a given
 * mentor means "not invited / not confirmed", which is correctly 0.
 */
export function resolveMentorCap(row: ConfirmationRowForCap | null | undefined): number {
  if (!row) return LEGACY_MENTOR_CAP;
  if (row.status !== "confirmed") return 0;
  const declared = clampCapacity(row.max_mentees) ?? DEFAULT_MAX_MENTEES;
  const extra = Number.isFinite(row.extra_slots) ? Math.max(0, Number(row.extra_slots)) : 0;
  return declared + extra;
}

/** True when the mentor can take at least one more mentee. */
export function isMentorAvailable(
  row: ConfirmationRowForCap | null | undefined,
  activeMatchCount: number
): boolean {
  const cap = resolveMentorCap(row);
  const active = Number.isFinite(activeMatchCount) ? Math.max(0, Number(activeMatchCount)) : 0;
  return cap > 0 && active < cap;
}

/** True when a mentor already holds more matches than their confirmed cap allows. */
export function isMentorOverCap(
  row: ConfirmationRowForCap | null | undefined,
  activeMatchCount: number
): boolean {
  const cap = resolveMentorCap(row);
  const active = Number.isFinite(activeMatchCount) ? Math.max(0, Number(activeMatchCount)) : 0;
  return active > cap;
}

/** Parse a capacity value from a form; returns null when absent or out of range. */
export function clampCapacity(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_MAX_MENTEES || parsed > MAX_MAX_MENTEES) return null;
  return parsed;
}

export type ParsedConfirmationAnswer =
  | {
      ok: true;
      status: Exclude<ConfirmationStatus, "pending">;
      maxMentees: number | null;
      agreeToReview: boolean | null;
      agreeToInterview: boolean | null;
      note: string | null;
    }
  | { ok: false; message: string };

/**
 * Interpret one submitted answer, from either the public form or the admin
 * console. Deliberately strict about the decision itself and forgiving about
 * everything else:
 *   * an unknown decision is refused rather than guessed
 *   * a confirmed answer with no capacity falls back to DEFAULT_MAX_MENTEES
 *   * a confirmed answer with an out-of-range capacity is refused, because the
 *     caller sent something the UI cannot produce
 *   * a declined answer drops capacity and the participation questions entirely
 */
export function parseConfirmationAnswer(input: {
  decision: unknown;
  maxMentees?: unknown;
  agreeToReview?: unknown;
  agreeToInterview?: unknown;
  note?: unknown;
}): ParsedConfirmationAnswer {
  const decision = String(input.decision ?? "").trim();

  if (decision !== "confirmed" && decision !== "declined") {
    return { ok: false, message: "Vui lòng chọn tiếp tục hoặc không tiếp tục mùa này." };
  }

  const note = normalizeNote(input.note);
  if (note === false) {
    return { ok: false, message: "Ghi chú quá dài (tối đa 1000 ký tự)." };
  }

  if (decision === "declined") {
    return {
      ok: true,
      status: "declined",
      maxMentees: null,
      agreeToReview: null,
      agreeToInterview: null,
      note
    };
  }

  const rawCapacity = input.maxMentees;
  const capacityProvided = rawCapacity !== null && rawCapacity !== undefined && String(rawCapacity).trim() !== "";
  const capacity = clampCapacity(rawCapacity);

  if (capacityProvided && capacity === null) {
    return { ok: false, message: `Số mentee tối đa phải từ ${MIN_MAX_MENTEES} đến ${MAX_MAX_MENTEES}.` };
  }

  return {
    ok: true,
    status: "confirmed",
    maxMentees: capacity ?? DEFAULT_MAX_MENTEES,
    agreeToReview: parseOptionalBoolean(input.agreeToReview),
    agreeToInterview: parseOptionalBoolean(input.agreeToInterview),
    note
  };
}

/** Checkbox semantics: present and truthy → true; present and falsy → false; absent → null. */
export function parseOptionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["true", "on", "yes", "1", "co", "có"].includes(text)) return true;
  if (["false", "off", "no", "0", "khong", "không"].includes(text)) return false;
  return null;
}

/** Trim and bound a note. Returns null when empty, false when too long. */
function normalizeNote(value: unknown): string | null | false {
  if (value === null || value === undefined) return null;
  // Control characters other than newline/tab would corrupt a CSV export.
  const text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!text) return null;
  if (text.length > 1000) return false;
  return text;
}

export type PublicLinkState = "ready" | "not_found" | "expired" | "locked";

/**
 * What the public confirmation page may do with a row.
 *
 * `locked` means the mentor must talk to the organisers rather than change the
 * answer themselves: an operator has already recorded it by phone, or matching
 * has started for this mentor and silently changing the capacity would strand
 * an existing pair.
 */
export function evaluatePublicLinkState(input: {
  row: {
    token_expires_at?: string | null;
    responded_by_admin_user_id?: string | null;
  } | null;
  activeMatchCount?: number;
  now: Date;
}): PublicLinkState {
  if (!input.row) return "not_found";

  if (input.row.token_expires_at) {
    const expires = new Date(input.row.token_expires_at);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() <= input.now.getTime()) {
      return "expired";
    }
  }

  if (input.row.responded_by_admin_user_id) return "locked";
  if ((input.activeMatchCount ?? 0) > 0) return "locked";

  return "ready";
}

/** Default expiry for a freshly issued invitation link. */
export function defaultTokenExpiry(now: Date, days = DEFAULT_TOKEN_TTL_DAYS): string {
  const expires = new Date(now.getTime());
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires.toISOString();
}

export type ConfirmationSummary = {
  total: number;
  confirmed: number;
  declined: number;
  pending: number;
  totalCapacity: number;
  respondedPct: number;
};

/** Roll-up shown at the top of the admin page and used to size the mentee intake. */
export function summarizeConfirmations(
  rows: Array<ConfirmationRowForCap & { status?: string | null }>
): ConfirmationSummary {
  let confirmed = 0;
  let declined = 0;
  let pending = 0;
  let totalCapacity = 0;

  for (const row of rows) {
    if (row.status === "confirmed") {
      confirmed++;
      totalCapacity += resolveMentorCap(row);
    } else if (row.status === "declined") {
      declined++;
    } else {
      pending++;
    }
  }

  const total = rows.length;
  const responded = confirmed + declined;
  return {
    total,
    confirmed,
    declined,
    pending,
    totalCapacity,
    respondedPct: total === 0 ? 0 : Math.round((responded / total) * 100)
  };
}

/** Build the personal confirmation URL for a token. */
export function buildConfirmUrl(baseUrl: string, token: string): string {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return `${base}/confirm/${token}`;
}

/**
 * The mentee-capacity choices a Season 12 renewal offers, and the only values
 * the server accepts. Declared here — not in the runtime, which is
 * `server-only` — so the public form and the trusted submission path are
 * driven by ONE list rather than by a radio group that happens to agree with a
 * validator.
 *
 * The renewal always defaults to 1. A mentor who carried 3 mentees in Season 11
 * re-chooses deliberately for Season 12; last season's number is shown as
 * context and is never pre-selected, because capacity is a fresh commitment
 * each season rather than a value that persists until someone lowers it.
 */
export const RENEWAL_MENTEE_CAPACITY_CHOICES = Object.freeze([1, 2, 3] as const);

export type RenewalMenteeCapacity = (typeof RENEWAL_MENTEE_CAPACITY_CHOICES)[number];

export const RENEWAL_MENTEE_CAPACITY_DEFAULT: RenewalMenteeCapacity = 1;

export function isRenewalMenteeCapacity(value: unknown): value is RenewalMenteeCapacity {
  return (RENEWAL_MENTEE_CAPACITY_CHOICES as readonly number[]).includes(value as number);
}

export type RenewalPerson = {
  id: string;
  full_name: string | null;
  email_primary: string | null;
  phone_primary: string | null;
};

export type RenewalMentorProfile = Record<string, unknown> & {
  id: string;
  person_id: string;
  mentor_code: string | null;
  company_current: string | null;
  title_current: string | null;
  years_experience_min: number | null;
  years_experience_text: string | null;
  capacity_target: number | null;
  industry: string | null;
  function_area: string | null;
  first_vam_season?: string | null;
  prior_vam_involvement?: string | null;
};

/** Small, display-only payload allowed to cross the unauthenticated client boundary. */
export type RenewalPublicDisplayDto = {
  fullName: string | null;
  emailPrimary: string | null;
  phonePrimary: string | null;
  mentorCode: string | null;
  firstVamSeason: string | null;
  companyCurrent: string | null;
  titleCurrent: string | null;
  yearsExperienceMin: number | null;
  yearsExperienceText: string | null;
  capacityTarget: number | null;
  industry: string | null;
  functionArea: string | null;
};

export type RenewalPublicActionState = {
  ok: boolean;
  outcome?: "accepted" | "declined";
  message: string;
};

export type RenewalAdminActionState = {
  ok: boolean;
  outcome?: string;
  message: string;
  /** A bearer URL returned once by create/regenerate and never persisted. */
  renewalPath?: string;
};

export type RenewalConfirmationIntent = {
  applicationId: string;
  expectedProfile: Record<string, string | number | null>;
  profileUpdate: Record<string, string | number>;
  diff: Array<{ field: string; before: string | number | null; after: string | number | null }>;
};

export const initialRenewalPublicActionState: RenewalPublicActionState = {
  ok: false,
  message: ""
};

export const initialRenewalAdminActionState: RenewalAdminActionState = {
  ok: false,
  message: ""
};

/**
 * ── Batch renewal invite creation ──────────────────────────────────────────
 *
 * Declared here rather than in `lib/renewal-runtime.ts` for the same reason the
 * capacity choices are: the admin console is a Client Component and cannot
 * import a `server-only` module, so the shape of a batch result and the size
 * limit the UI enforces must live somewhere both halves can read.
 */

/**
 * The largest number of mentors one batch may create links for.
 *
 * WHY 25 AND NOT 500
 * Each mentor costs exactly one `vam071_create_renewal_invite` round trip —
 * the batch reuses the single-invite trusted path verbatim rather than minting
 * tokens in bulk, so per-mentor cost cannot be amortised away. This project
 * sets no `maxDuration` anywhere and has no `vercel.json`, so the Server Action
 * runs under Vercel's DEFAULT serverless budget, which is 10s on the most
 * restrictive plan. 25 invites at RENEWAL_BATCH_CONCURRENCY=4 is ~7 waves; even
 * at a pathological 500ms per round trip that is ~3.5s, leaving the rest of the
 * budget for authorization, the pre-flight reads and serialisation.
 *
 * 25 is also an operationally sensible unit: the links are distributed BY HAND
 * over Gmail/Zalo, so a batch larger than this is not something a person
 * finishes in one sitting anyway.
 *
 * Raising it safely means setting an explicit `maxDuration` on the renewals
 * route AND confirming the Vercel plan allows it — not simply editing this
 * number.
 */
export const RENEWAL_BATCH_MAX_SIZE = 25;

/**
 * How many invite RPCs are in flight at once.
 *
 * Bounded rather than unbounded: 25 simultaneous PostgREST calls would burst
 * the Supabase connection pool for no latency gain worth having, and an
 * unbounded Promise.all makes one slow call indistinguishable from a hung
 * batch. Four keeps the wall clock low while staying polite to the pool.
 */
export const RENEWAL_BATCH_CONCURRENCY = 4;

/** Why one mentor in a batch ended up the way it did. */
export type RenewalBatchOutcome =
  | "created"
  | "skipped_live_invite"
  | "not_eligible"
  | "failed";

/** The operator-facing Vietnamese label for each outcome. */
export const RENEWAL_BATCH_OUTCOME_LABEL: Record<RenewalBatchOutcome, string> = {
  created: "Thành công",
  skipped_live_invite: "Đã có invite đang hiệu lực",
  not_eligible: "Không đủ điều kiện / không hợp lệ",
  failed: "Lỗi tạo link"
};

/**
 * One mentor's result. `renewalPath` is present ONLY for `created`, only in the
 * immediate action response, and is never written to any table, log or file.
 */
export type RenewalBatchRow = {
  personId: string;
  fullName: string;
  mentorCode: string | null;
  email: string | null;
  outcome: RenewalBatchOutcome;
  expiresAt: string | null;
  renewalPath?: string;
};

export type RenewalBatchState = {
  ok: boolean;
  message: string;
  createdCount: number;
  failedCount: number;
  skippedCount: number;
  results: RenewalBatchRow[];
};

export const initialRenewalBatchState: RenewalBatchState = {
  ok: false,
  message: "",
  createdCount: 0,
  failedCount: 0,
  skippedCount: 0,
  results: []
};

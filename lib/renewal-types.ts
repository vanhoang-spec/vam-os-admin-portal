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

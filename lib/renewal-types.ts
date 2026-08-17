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

/**
 * Matching quick view — pure shaping layer.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * An operator on /matches is choosing one mentor for one mentee. Name, company
 * and school are not enough to make that judgement, but the application detail
 * page is — and leaving /matches to read it throws away the search text, both
 * selections and the internal note. This module decides WHAT a matching drawer
 * shows; `lib/matching-quick-view.ts` decides WHO may see it.
 *
 * No I/O and no Supabase here, so every inclusion and exclusion rule below is
 * unit-testable without a database.
 *
 * ---------------------------------------------------------------------------
 * ONE INTERPRETATION OF APPLICATION ANSWERS, NOT TWO
 * ---------------------------------------------------------------------------
 * Labels, payload flattening and the internal-segment denylist all come from
 * `lib/application-export.ts`, which is the same source the application detail
 * page and the CSV/PDF export already use. A key that gains a Vietnamese label
 * there gains it here on the same day. Nothing in this file re-derives a label
 * or re-implements flattening.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A DENYLIST AS WELL AS A PRIORITY LIST
 * ---------------------------------------------------------------------------
 * The drawer is for matching fit, not for contacting anyone. Contact fields are
 * removed by KEY here rather than by "we happened not to select them", so a
 * future writer that adds `phone_secondary` to raw_payload cannot leak it into
 * this payload by default. That matters beyond today: the participant-facing
 * model has a stricter rule still — a mentee browsing mentors must not see
 * mentor contact before an active match — and an admin payload that already
 * carries a phone number is one copy-paste away from becoming that endpoint.
 */

import { acknowledgementRegistry } from "@/lib/application-commitments";
import { flattenRawPayload, humanizeKey, isInternalRawPayloadSegment } from "@/lib/application-export";
import { RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD } from "@/lib/renewal-types";
import type { Application, JsonRecord, MenteeProfile, MentorProfile, Person } from "@/lib/types";

export type QuickViewRole = "mentor" | "mentee";

/** One label/value pair in the compact summary at the top of the drawer. */
export type QuickViewSummaryRow = { label: string; value: string };

/** One application answer, rendered through the shared answer card. */
export type QuickViewAnswer = { key: string; label: string; value: string };

export type QuickViewPayload = {
  role: QuickViewRole;
  fullName: string;
  /** Compact, matching-relevant identity and background. */
  summary: QuickViewSummaryRow[];
  /** Matching-relevant application answers, most useful first. */
  answers: QuickViewAnswer[];
  /** True when the application carried nothing renderable. */
  empty: boolean;
};

/**
 * Never leaves the server for a matching drawer.
 *
 * Contact routes (phone, email, socials, direct links) and identity documents
 * are excluded because the drawer's job is fit, not outreach. Acknowledgement
 * and consent booleans are excluded because "Đã chọn" on a boilerplate
 * commitment tells an operator nothing about whether these two people should be
 * paired — and there are enough of them to bury the answers that do.
 */
export const QUICK_VIEW_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  // Contact and outreach
  "email_primary",
  "email_secondary",
  "phone_primary",
  "phone_secondary",
  "social_contact",
  "linkedin_url",
  "consent_contact_methods",
  "email_notification_consent",
  // Identity documents and personal identifiers not used for fit
  "mssv",
  "year_of_birth",
  "gender",
  "gender_other",
  "preferred_name",
  "profile_picture_url",
  // Consent and policy acceptance that is NOT a registry acknowledgement.
  // The registry entries themselves are handled by `isAcknowledgementSegment`
  // below and are deliberately not restated here.
  "consent_data_storage",
  "consent_marketing_email",
  "commitment_understanding",
  // The renewal form's own commitment envelope: `commitments` is an OBJECT of
  // acknowledgement keys, so it is excluded as a whole SUBTREE (see the
  // segment-wise check below) rather than as a leaf.
  "commitments",
  "commitments_completed",
  "participation_confirmed",
  RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD,
  // Scheduling logistics, not matching fit
  "available_for_interview",
  "available_for_kickoff",
  "can_attend_orientation",
  "open_to_intro_call"
]);

/**
 * Every programme acknowledgement, taken from the canonical registry.
 *
 * `acknowledgementRegistry` rather than `acknowledgementsForRole`, deliberately:
 * that helper filters to application-stage entries for ONE role, and the drawer
 * needs to hide all of them regardless of role or collection stage — a
 * post-approval conduct acknowledgement is exactly as useless for matching as a
 * form-stage one. Taking the whole registry also means an acknowledgement added
 * to a future season disappears from the drawer on the day it is defined, with
 * no edit here. Restating the key list would be a second policy allowlist, and
 * the copy nobody updates is the one that silently starts leaking.
 */
const ACKNOWLEDGEMENT_KEYS: readonly string[] = acknowledgementRegistry.map((entry) => entry.key);

/**
 * True for an acknowledgement key, including the derived forms the renewal
 * payload writes alongside it.
 *
 * The renewal stores `MENTOR_ACTIVE_READING_V1_matched` (a boolean) and
 * `MENTOR_ACTIVE_READING_V1_text` (the typed confirmation phrase itself), so an
 * exact-match test would let the whole phrase through under a slightly
 * different key. Prefix matching catches both without enumerating suffixes.
 */
export function isAcknowledgementSegment(segment: string): boolean {
  return ACKNOWLEDGEMENT_KEYS.some((key) => segment === key || segment.startsWith(`${key}_`));
}

/**
 * A contact-shaped key that slipped past the explicit list above still cannot
 * reach the drawer. Substring matching on the normalised key, so
 * `mentor_phone_2` or `contactEmail` are caught without being enumerated.
 */
const CONTACT_KEY_FRAGMENTS = ["email", "phone", "zalo", "facebook", "telegram", "whatsapp", "contact"];

export function isQuickViewExcludedKey(key: unknown): boolean {
  const raw = String(key ?? "").trim();
  if (!raw) return true;

  // EVERY segment is tested, not just the leaf.
  //
  // `flattenRawPayload` walks nested objects into dotted paths, so the renewal
  // form's `commitments: { MENTOR_ELIGIBILITY_V1: true, ... }` arrives as
  // `commitments.MENTOR_ELIGIBILITY_V1`. A leaf-only test would look at
  // `MENTOR_ELIGIBILITY_V1` and never at `commitments`, which is how the whole
  // acknowledgement block — including the typed confirmation phrase — reached
  // the drawer before this. Excluding a parent segment now removes its entire
  // subtree, which is what "hide the commitments block" has to mean.
  for (const segment of raw.split(".")) {
    const bare = segment.replace(/\[\d+\]$/, "");
    if (!bare) continue;
    if (QUICK_VIEW_EXCLUDED_KEYS.has(bare)) return true;
    if (isAcknowledgementSegment(bare)) return true;
    if (isInternalRawPayloadSegment(bare)) return true;
    // `social_contact` and friends. A URL to a CV is deliberately NOT caught —
    // that is background material, and it is on the priority list below.
    const normalized = bare.toLowerCase();
    if (CONTACT_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return true;
  }
  return false;
}

/**
 * The answers an operator actually matches on, in the order they help.
 *
 * A key not listed here is not dropped — it is shown after these, because a
 * season may add a question and it should still be readable. The list decides
 * ORDER and therefore what is visible without scrolling.
 */
export const MENTOR_ANSWER_PRIORITY: readonly string[] = [
  "mentoring_topics",
  "sme_mentoring_experience",
  "preferred_mentee_persona",
  "activities_willing_to_support",
  "activities_willing_to_support_other",
  "motivation_text",
  "secondary_industries_functions",
  "secondary_industries_functions_other",
  "programs_willing_to_join",
  "meeting_frequency",
  "meeting_format_preference",
  "preferred_language",
  "prior_vam_involvement",
  "mentor_people_management_years",
  "mentor_largest_team_size",
  "bio_or_cv_url",
  "additional_notes"
];

export const MENTEE_ANSWER_PRIORITY: readonly string[] = [
  "mentoring_goals_text",
  "target_industry",
  "target_industry_other",
  "target_function",
  "target_function_other",
  "target_soft_skills",
  "target_soft_skills_other",
  "top_3_questions_for_mentor",
  "current_difficulty_text",
  "one_year_vision_text",
  "mentoring_plan_text",
  "why_uem_text",
  "training_topics_interest",
  "training_topics_interest_other",
  "meeting_format_preference",
  "mentor_gender_preference",
  "if_not_effective_text",
  "profile_or_cv_url",
  "additional_notes"
];

function priorityFor(role: QuickViewRole) {
  const list = role === "mentor" ? MENTOR_ANSWER_PRIORITY : MENTEE_ANSWER_PRIORITY;
  return new Map(list.map((key, index) => [key, index]));
}

function text(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw;
}

function push(rows: QuickViewSummaryRow[], label: string, value: unknown) {
  const rendered = text(value);
  if (rendered) rows.push({ label, value: rendered });
}

/**
 * The renewal unwrap, matching what the export already does: a
 * `s12_mentor_renewal` application keeps the applicant's own answers under
 * `raw_payload.renewal`, and the top level holds invite plumbing.
 */
export function applicantPayload(application: Application | null): Record<string, unknown> | null {
  if (!application) return null;
  const payload = (application.raw_payload ?? null) as Record<string, unknown> | null;
  if (application.source !== "s12_mentor_renewal") return payload;
  const renewal = payload?.renewal;
  if (!renewal || typeof renewal !== "object" || Array.isArray(renewal)) return null;
  return renewal as Record<string, unknown>;
}

export type QuickViewSource = {
  role: QuickViewRole;
  person: Person | null;
  application: Application | null;
  mentorProfile?: MentorProfile | null;
  menteeProfile?: MenteeProfile | null;
  /** Legacy `application_answers` rows. Empty for S12 native applications. */
  legacyAnswers?: JsonRecord[];
  /** Active matches this mentor already holds in the season. */
  activeMatchCount?: number;
  /** The capacity the mentor declared, already resolved by the caller. */
  effectiveCapacity?: number;
};

function mentorSummary(source: QuickViewSource): QuickViewSummaryRow[] {
  const rows: QuickViewSummaryRow[] = [];
  const profile = source.mentorProfile ?? null;
  const payload = applicantPayload(source.application) ?? {};

  push(rows, "Chức danh hiện tại", profile?.title_current ?? payload.title_current);
  push(rows, "Công ty hiện tại", profile?.company_current ?? payload.company_current);
  push(rows, "Ngành nghề", profile?.industry ?? payload.industry_primary);
  push(rows, "Chức năng chuyên môn", profile?.function_area ?? payload.function_primary);
  push(
    rows,
    "Số năm kinh nghiệm",
    profile?.years_experience_text ?? profile?.years_experience_min ?? payload.years_of_experience
  );
  push(rows, "Kinh nghiệm mentoring", payload.sme_mentoring_experience);
  push(rows, "Mùa đầu tiên tham gia VAM", profile?.first_vam_season ?? payload.first_vam_season);

  // Capacity is the number the matching mutation actually enforces, shown
  // against the load the operator is about to add to.
  if (typeof source.effectiveCapacity === "number") {
    const used = typeof source.activeMatchCount === "number" ? source.activeMatchCount : 0;
    rows.push({ label: "Mentee hiện tại / sức chứa", value: `${used}/${source.effectiveCapacity}` });
  }
  return rows;
}

function menteeSummary(source: QuickViewSource): QuickViewSummaryRow[] {
  const rows: QuickViewSummaryRow[] = [];
  const profile = source.menteeProfile ?? null;
  const payload = applicantPayload(source.application) ?? {};

  push(rows, "Trường", profile?.school_raw ?? profile?.school_code ?? payload.school_or_faculty ?? payload.university);
  push(rows, "Ngành học", profile?.major ?? payload.major);
  push(rows, "Khóa / lớp", profile?.class_cohort ?? payload.class_cohort);
  push(rows, "Năm học", payload.year_of_study);
  push(rows, "Ngành nghề mục tiêu", payload.target_industry);
  push(rows, "Chức năng mục tiêu", payload.target_function);
  return rows;
}

/**
 * Turns the loaded records into what the drawer renders.
 *
 * Answers come from `raw_payload` for an S12 application and from
 * `application_answers` for a legacy one. Both are filtered by the same
 * exclusion rule and ordered by the same priority list, so the drawer looks the
 * same whichever season the applicant came from.
 */
export function buildQuickView(source: QuickViewSource): QuickViewPayload {
  const order = priorityFor(source.role);
  const seen = new Set<string>();
  const answers: QuickViewAnswer[] = [];

  for (const row of flattenRawPayload(applicantPayload(source.application))) {
    if (isQuickViewExcludedKey(row.key)) continue;
    if (!text(row.value)) continue;
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    answers.push({ key: row.key, label: humanizeKey(row.key), value: row.value });
  }

  for (const legacy of source.legacyAnswers ?? []) {
    const key = String(legacy.question_key ?? "").trim();
    if (!key || isQuickViewExcludedKey(key)) continue;
    const value = text(legacy.value_text);
    if (!value) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    answers.push({ key, label: text(legacy.question_label) || humanizeKey(key), value });
  }

  // Priority first, then everything else in the order it arrived. `key` breaks
  // ties so the drawer does not reshuffle between opens.
  const ranked = answers
    .map((answer, index) => ({ answer, index }))
    .sort((a, b) => {
      const aRank = order.get(a.answer.key.split(".")[0] ?? a.answer.key) ?? Number.MAX_SAFE_INTEGER;
      const bRank = order.get(b.answer.key.split(".")[0] ?? b.answer.key) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.index - b.index;
    })
    .map((entry) => entry.answer);

  const summary = source.role === "mentor" ? mentorSummary(source) : menteeSummary(source);
  const fullName =
    text(source.application?.full_name) || text(source.person?.full_name) || "Không rõ tên";

  return {
    role: source.role,
    fullName,
    summary,
    answers: ranked,
    empty: summary.length === 0 && ranked.length === 0
  };
}

/**
 * Deterministic choice when a person somehow holds more than one approved
 * application for the same season and role.
 *
 * The M083 identity arbiters make this a data anomaly rather than a normal
 * case, so the rule is about being explainable, not about being clever: the
 * MOST RECENTLY SUBMITTED application wins, because that is the one whose
 * answers the approval was made against, and `id` ascending breaks a tie so two
 * page loads never disagree. An application with no `submitted_at` sorts last —
 * an undated row is the weakest evidence of what the applicant currently says.
 */
export function pickQuickViewApplication<T extends { id: string; submitted_at?: string | null }>(
  applications: readonly T[]
): T | null {
  if (!applications.length) return null;
  return [...applications].sort((a, b) => {
    const aAt = text(a.submitted_at);
    const bAt = text(b.submitted_at);
    if (aAt && bAt && aAt !== bAt) return bAt.localeCompare(aAt);
    if (aAt && !bAt) return -1;
    if (!aAt && bAt) return 1;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

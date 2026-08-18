import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canSelfClaimInterview } from "@/lib/permissions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { resolveMentorCap } from "@/lib/mentor-confirmations-core";
import { approveApplication } from "@/lib/application-approvals";
import type { CurrentAdminUser } from "@/lib/auth-constants";

/**
 * lib/mentor-selection.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * A mentor choosing their own mentee, right after they interviewed them.
 *
 * This is the one write path in the application where somebody who is not an
 * organiser creates a match, so the guard is deliberately narrow and every
 * attempt — including every refusal — is written to mentor_mentee_selections
 * (migration 067). Four things must all hold:
 *
 *   1. the caller may interview at all (canSelfClaimInterview);
 *   2. the caller has SUBMITTED the interview score for this very application,
 *      which is what makes them the person who met this candidate;
 *   3. the login resolves to exactly one mentor in `people`;
 *   4. that mentor confirmed a place for the season and has one left.
 *
 * The capacity is the one the mentor declared on the confirmation form plus any
 * extra place core_team granted (resolveMentorCap). Being at the limit is not
 * an error to be worked around here: the mentor is told to ask the organisers,
 * and the refusal is logged so the organisers can see the request without
 * being told about it separately.
 */

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ ban tổ chức.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Interview rounds must be finished before a mentee can be claimed. */
const REQUIRED_REVIEW_STATUS = "submitted";

type SelectionOutcome =
  | "created"
  | "blocked_cap"
  | "blocked_mentee_taken"
  | "blocked_not_confirmed"
  | "blocked_no_interview"
  | "blocked_identity";

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[mentor-selection]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MentorSelectionResult = {
  ok: boolean;
  message: string;
  matchId?: string | null;
  /** True when the mentor is full — the UI shows this in red and names the fix. */
  capExceeded?: boolean;
  cap?: number;
  activeCount?: number;
};

// ── Identity ─────────────────────────────────────────────────────────────────

export type MentorIdentity =
  | { ok: true; personId: string; source: "linked" | "email" }
  | { ok: false; message: string };

/**
 * Which mentor is this login?
 *
 * Preferred answer is admin_users.linked_person_id, written when core_team
 * turned the mentor into an interviewer. The fallback is the email the account
 * was created from, and it deliberately refuses when that address matches more
 * than one person: creating a match for the wrong mentor is worse than asking
 * an organiser to sort the duplicate out.
 */
export async function resolveMentorIdentity(
  client: ServiceClient,
  actor: Pick<CurrentAdminUser, "id" | "email">
): Promise<MentorIdentity> {
  const { data: accountRow, error: accountErr } = await client
    .from("admin_users")
    .select("id,email,linked_person_id")
    .eq("id", actor.id)
    .maybeSingle();

  if (accountErr) {
    log("load admin account", accountErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const account = accountRow as { email: string | null; linked_person_id: string | null } | null;
  if (account?.linked_person_id) {
    return { ok: true, personId: account.linked_person_id, source: "linked" };
  }

  const email = String(account?.email ?? actor.email ?? "").trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      message: "Tài khoản của anh/chị chưa gắn với hồ sơ mentor. Vui lòng liên hệ ban tổ chức."
    };
  }

  const { data: peopleRows, error: peopleErr } = await client
    .from("people")
    .select("id,email_primary")
    .ilike("email_primary", email)
    .limit(5);

  if (peopleErr) {
    log("resolve mentor by email", peopleErr);
    return { ok: false, message: SAFE_ERROR };
  }

  // ilike treats "_" as a wildcard and email addresses are full of them, so the
  // rows that come back are re-checked for a real, case-insensitive match.
  const exact = Array.from(
    new Set(
      ((peopleRows ?? []) as Array<{ id: string; email_primary: string | null }>)
        .filter((row) => String(row.email_primary ?? "").trim().toLowerCase() === email)
        .map((row) => row.id)
    )
  );

  if (exact.length === 1) return { ok: true, personId: exact[0], source: "email" };

  return {
    ok: false,
    message:
      exact.length === 0
        ? "Không tìm thấy hồ sơ mentor ứng với tài khoản của anh/chị. Vui lòng liên hệ ban tổ chức."
        : "Email của anh/chị đang trùng với nhiều hồ sơ trong hệ thống. Vui lòng liên hệ ban tổ chức để xử lý trước khi chọn mentee."
  };
}

// ── Logging ──────────────────────────────────────────────────────────────────

async function recordSelection(
  client: ServiceClient,
  row: {
    seasonId: string;
    intakeBatchId: string | null;
    actorAdminUserId: string | null;
    mentorPersonId: string | null;
    applicationId: string;
    menteePersonId?: string | null;
    outcome: SelectionOutcome;
    matchId?: string | null;
    cap?: number | null;
    activeCount?: number | null;
    reason?: string | null;
  }
) {
  const { error } = await client.from("mentor_mentee_selections").insert({
    season_id: row.seasonId,
    intake_batch_id: row.intakeBatchId,
    actor_admin_user_id: row.actorAdminUserId,
    mentor_person_id: row.mentorPersonId,
    application_id: row.applicationId,
    mentee_person_id: row.menteePersonId ?? null,
    outcome: row.outcome,
    match_id: row.matchId ?? null,
    cap_at_decision: row.cap ?? null,
    active_count_at_decision: row.activeCount ?? null,
    reason: row.reason ? row.reason.slice(0, 500) : null
  });
  if (error) {
    // The log must never break the decision it is recording.
    log("record selection (non-fatal)", error);
  }
}

// ── Shared load + checks ─────────────────────────────────────────────────────

type SelectionContext = {
  client: ServiceClient;
  actor: CurrentAdminUser;
  /** actor.id after the logged-in check, so callers do not re-narrow it. */
  actorId: string;
  application: {
    id: string;
    status: string | null;
    season_id: string;
    intake_batch_id: string | null;
    full_name: string | null;
    email_primary: string | null;
    phone_primary: string | null;
    gender: string | null;
    role_applied: string | null;
    person_id: string | null;
  };
  mentorPersonId: string;
  cap: number;
  activeCount: number;
};

type ContextResult = { ok: true; context: SelectionContext } | { ok: false; message: string; capExceeded?: boolean };

async function loadSelectionContext(applicationId: string): Promise<ContextResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canSelfClaimInterview(actor.role)) {
    return { ok: false, message: "Bạn không có quyền chọn mentee." };
  }

  if (!isValidUuid(applicationId)) return { ok: false, message: "Hồ sơ không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // --- The candidate
  const { data: appRow, error: appErr } = await client
    .from("applications")
    .select(
      "id,status,season_id,intake_batch_id,full_name,email_primary,phone_primary,gender,role_applied,person_id"
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (appErr) {
    log("load application", appErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const application = appRow as SelectionContext["application"] | null;
  if (!application) return { ok: false, message: "Không tìm thấy hồ sơ ứng viên." };
  if (!application.season_id) {
    return { ok: false, message: "Hồ sơ này chưa gắn với mùa nào nên chưa ghép cặp được." };
  }
  if (String(application.role_applied ?? "") !== "mentee") {
    return { ok: false, message: "Chỉ chọn được mentee từ hồ sơ ứng tuyển mentee." };
  }

  // --- The caller must have interviewed this candidate and submitted the score
  const { data: myReview, error: reviewErr } = await client
    .from("application_reviews")
    .select("id,status")
    .eq("application_id", application.id)
    .eq("review_round", "interview")
    .eq("reviewer_admin_user_id", actor.id)
    .eq("status", REQUIRED_REVIEW_STATUS)
    .limit(1)
    .maybeSingle();

  if (reviewErr) {
    log("load own interview review", reviewErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!myReview) {
    await recordSelection(client, {
      seasonId: application.season_id,
      intakeBatchId: application.intake_batch_id,
      actorAdminUserId: actor.id,
      mentorPersonId: null,
      applicationId: application.id,
      outcome: "blocked_no_interview"
    });
    return {
      ok: false,
      message: "Anh/chị cần nộp điểm phỏng vấn cho ứng viên này trước khi chọn làm mentee."
    };
  }

  // --- Which mentor is calling
  const identity = await resolveMentorIdentity(client, actor);
  if (!identity.ok) {
    await recordSelection(client, {
      seasonId: application.season_id,
      intakeBatchId: application.intake_batch_id,
      actorAdminUserId: actor.id,
      mentorPersonId: null,
      applicationId: application.id,
      outcome: "blocked_identity",
      reason: identity.message
    });
    return { ok: false, message: identity.message };
  }

  // --- Their place in this season
  const { data: confirmationRow, error: confirmationErr } = await client
    .from("mentor_season_confirmations")
    .select("id,status,max_mentees,extra_slots")
    .eq("season_id", application.season_id)
    .eq("person_id", identity.personId)
    .maybeSingle();

  if (confirmationErr) {
    log("load mentor confirmation", confirmationErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const cap = resolveMentorCapForSeason(confirmationRow);
  if (cap <= 0) {
    await recordSelection(client, {
      seasonId: application.season_id,
      intakeBatchId: application.intake_batch_id,
      actorAdminUserId: actor.id,
      mentorPersonId: identity.personId,
      applicationId: application.id,
      outcome: "blocked_not_confirmed",
      cap: 0
    });
    return {
      ok: false,
      message:
        "Anh/chị chưa có suất nhận mentee trong mùa này (chưa xác nhận tham gia hoặc đã từ chối). Vui lòng liên hệ ban tổ chức."
    };
  }

  const { count: activeCount, error: countErr } = await client
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("mentor_person_id", identity.personId)
    .eq("season_id", application.season_id)
    .eq("status", "active");

  if (countErr) {
    log("count active matches", countErr);
    return { ok: false, message: SAFE_ERROR };
  }

  return {
    ok: true,
    context: {
      client,
      actor,
      actorId: actor.id,
      application,
      mentorPersonId: identity.personId,
      cap,
      activeCount: activeCount ?? 0
    }
  };
}

/** Cap for a season that runs confirmations: no row means no place. */
function resolveMentorCapForSeason(row: unknown): number {
  if (!row) return 0;
  return resolveMentorCap(row as { status?: string | null; max_mentees?: number | null; extra_slots?: number | null });
}

// ── What the interview screen shows before anyone clicks ─────────────────────

export type MentorSelectionContextView = {
  /** The button is shown at all. */
  available: boolean;
  /** The button is enabled. */
  canSelect: boolean;
  cap: number;
  activeCount: number;
  capExceeded: boolean;
  alreadyMineMatchId: string | null;
  message: string | null;
};

/**
 * Read-only version of the same checks, so the interview screen can show the
 * mentor where they stand ("2/3 mentee") instead of only telling them after
 * they press a button.
 */
export async function getMentorSelectionContext(input: {
  applicationId: string;
}): Promise<MentorSelectionContextView> {
  const unavailable: MentorSelectionContextView = {
    available: false,
    canSelect: false,
    cap: 0,
    activeCount: 0,
    capExceeded: false,
    alreadyMineMatchId: null,
    message: null
  };

  const loaded = await loadSelectionContext(input.applicationId);
  if (!loaded.ok) {
    return { ...unavailable, available: true, message: loaded.message };
  }

  const context = loaded.context;

  // A candidate with no person row yet cannot have a match yet either.
  const existingMatch = context.application.person_id
    ? (((
        await context.client
          .from("matches")
          .select("id,mentor_person_id")
          .eq("mentee_person_id", context.application.person_id)
          .eq("season_id", context.application.season_id)
          .eq("status", "active")
          .limit(1)
          .maybeSingle()
      ).data ?? null) as { id: string; mentor_person_id: string | null } | null)
    : null;
  if (existingMatch) {
    const mine = existingMatch.mentor_person_id === context.mentorPersonId;
    return {
      available: true,
      canSelect: false,
      cap: context.cap,
      activeCount: context.activeCount,
      capExceeded: false,
      alreadyMineMatchId: mine ? existingMatch.id : null,
      message: mine
        ? "Ứng viên này đã là mentee của anh/chị."
        : "Ứng viên này đã được một mentor khác nhận."
    };
  }

  const capExceeded = context.activeCount >= context.cap;
  return {
    available: true,
    canSelect: !capExceeded,
    cap: context.cap,
    activeCount: context.activeCount,
    capExceeded,
    alreadyMineMatchId: null,
    message: capExceeded
      ? `Anh/chị đã nhận đủ ${context.activeCount}/${context.cap} mentee của mùa này. Vui lòng liên hệ ban tổ chức nếu muốn nhận thêm.`
      : null
  };
}

// ── The decision ─────────────────────────────────────────────────────────────

export async function selectMenteeAfterInterview(input: {
  applicationId?: unknown;
  note?: unknown;
}): Promise<MentorSelectionResult> {
  const applicationId = String(input.applicationId ?? "").trim();
  const loaded = await loadSelectionContext(applicationId);
  if (!loaded.ok) return { ok: false, message: loaded.message, capExceeded: loaded.capExceeded };

  const { client, actor, actorId, application, mentorPersonId, cap, activeCount } = loaded.context;

  // --- Is the mentor already full?
  if (activeCount >= cap) {
    await recordSelection(client, {
      seasonId: application.season_id,
      intakeBatchId: application.intake_batch_id,
      actorAdminUserId: actorId,
      mentorPersonId,
      applicationId: application.id,
      outcome: "blocked_cap",
      cap,
      activeCount
    });
    return {
      ok: false,
      capExceeded: true,
      cap,
      activeCount,
      message: `Anh/chị đã nhận đủ ${activeCount}/${cap} mentee của mùa này. Vui lòng liên hệ ban tổ chức để được cấp thêm suất trước khi chọn thêm mentee.`
    };
  }

  // --- Has somebody else already taken this candidate?
  if (application.person_id) {
    const { data: existing, error: existingErr } = await client
      .from("matches")
      .select("id,mentor_person_id")
      .eq("mentee_person_id", application.person_id)
      .eq("season_id", application.season_id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (existingErr) {
      log("check mentee active match", existingErr);
      return { ok: false, message: SAFE_ERROR };
    }

    const existingMatch = existing as { id: string; mentor_person_id: string | null } | null;
    if (existingMatch) {
      if (existingMatch.mentor_person_id === mentorPersonId) {
        return {
          ok: true,
          matchId: existingMatch.id,
          message: "Ứng viên này đã là mentee của anh/chị."
        };
      }
      await recordSelection(client, {
        seasonId: application.season_id,
        intakeBatchId: application.intake_batch_id,
        actorAdminUserId: actorId,
        mentorPersonId,
        applicationId: application.id,
        menteePersonId: application.person_id,
        outcome: "blocked_mentee_taken",
        cap,
        activeCount
      });
      return {
        ok: false,
        message: "Ứng viên này vừa được một mentor khác nhận. Vui lòng chọn ứng viên khác."
      };
    }
  }

  // --- Make sure the candidate exists as a mentee: person + mentee_profile.
  // Identity comes from the application itself, never from the caller.
  if (!application.full_name?.trim()) {
    return {
      ok: false,
      message: "Hồ sơ ứng viên thiếu họ tên nên chưa tạo được hồ sơ mentee. Vui lòng báo ban tổ chức."
    };
  }

  const approval = await approveApplication({
    applicationId: application.id,
    targetRole: "mentee",
    seasonCode: null,
    fullName: application.full_name,
    emailPrimary: application.email_primary,
    phonePrimary: application.phone_primary,
    gender: application.gender,
    intakeBatchId: application.intake_batch_id,
    previousStatus: application.status,
    approvedByAdminUserId: actorId,
    approvedByName: actor.full_name ?? actor.email ?? null
  });

  if (!approval.ok) {
    return { ok: false, message: approval.message };
  }

  // --- The mentor's own profile, for the profile-level columns on `matches`
  const { data: mentorProfileRow } = await client
    .from("mentor_profiles")
    .select("id")
    .eq("person_id", mentorPersonId)
    .limit(1)
    .maybeSingle();

  const payload = {
    season_id: application.season_id,
    mentor_person_id: mentorPersonId,
    mentee_person_id: approval.personId,
    mentor_profile_id: (mentorProfileRow as { id?: string } | null)?.id ?? null,
    mentee_profile_id: approval.profileId,
    intake_batch_id: application.intake_batch_id,
    status: "active",
    match_type: "primary",
    match_source: "mentor_self_select",
    match_source_raw: "mentor_self_select",
    matched_by: actorId,
    matched_at: new Date().toISOString().slice(0, 10),
    admin_notes: String(input.note ?? "").trim().slice(0, 500) || null,
    notes: "Mentor tự chọn sau phỏng vấn"
  };

  const { data: inserted, error: insertErr } = await client
    .from("matches")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (insertErr) {
    log("insert self-selected match", insertErr);
    // The partial unique index on an active mentee profile is the last line of
    // defence when two mentors press the button at the same moment.
    if (insertErr.code === "23505") {
      await recordSelection(client, {
        seasonId: application.season_id,
        intakeBatchId: application.intake_batch_id,
        actorAdminUserId: actorId,
        mentorPersonId,
        applicationId: application.id,
        menteePersonId: approval.personId,
        outcome: "blocked_mentee_taken",
        cap,
        activeCount,
        reason: "unique_violation"
      });
      return {
        ok: false,
        message: "Ứng viên này vừa được một mentor khác nhận. Vui lòng chọn ứng viên khác."
      };
    }
    return { ok: false, message: SAFE_ERROR };
  }

  const matchId = (inserted as { id?: string } | null)?.id ?? null;

  await recordSelection(client, {
    seasonId: application.season_id,
    intakeBatchId: application.intake_batch_id,
    actorAdminUserId: actorId,
    mentorPersonId,
    applicationId: application.id,
    menteePersonId: approval.personId,
    outcome: "created",
    matchId,
    cap,
    activeCount: activeCount + 1
  });

  // Audit trail in the organisers' own log, reusing an action_type that already
  // exists in the vocabulary (no schema change needed).
  const { error: auditErr } = await client.from("admin_audit_log").insert({
    actor_admin_user_id: actorId,
    action_type: "create_manual_match",
    after_data: payload,
    details: {
      source: "mentor_self_select",
      application_id: application.id,
      cap,
      active_count_before: activeCount
    }
  });
  if (auditErr) log("admin_audit_log insert (non-fatal)", auditErr);

  return {
    ok: true,
    matchId,
    cap,
    activeCount: activeCount + 1,
    message: `Đã nhận ứng viên này làm mentee của anh/chị (${activeCount + 1}/${cap} suất).`
  };
}

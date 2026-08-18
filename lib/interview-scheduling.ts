import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBulkAssignReviews, canReview } from "@/lib/permissions";
import { canReviewSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendInterviewInvite, sendInterviewSchedule } from "@/lib/email";
import { SEASON_CONFIG } from "@/lib/season-config";
import {
  buildSlotTimes,
  formatInterviewTimeVi,
  INTERVIEW_MODE_LABELS,
  MAX_INTERVIEWS_PER_RUN,
  parseScheduleInput
} from "@/lib/interview-scheduling-core";

/**
 * lib/interview-scheduling.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Booking the interviews for the candidates a selection run invited.
 *
 * One operator action books one interviewer against a list of candidates: the
 * candidates get consecutive slots, the interviewer gets their list, and each
 * candidate gets their own time. Everything else about an interview — the
 * scoring form, the self-claim path on the day — already exists; this module
 * only adds the appointment.
 *
 * Booking is idempotent per candidate: running it again for the same
 * interviewer moves the time rather than creating a second interview. A
 * candidate already booked with a DIFFERENT interviewer is left alone and
 * reported, because silently reassigning an interview is how two mentors end up
 * turning up for the same call.
 *
 * Authorisation lives here, not in the action: the caller must be allowed to
 * assign reviews and must have review scope over the candidate's season.
 */

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

/** Application statuses that may be given (or moved to) an appointment. */
const SCHEDULABLE_STATUSES = new Set([
  "invited_to_interview",
  "interview_scheduled",
  "interview_in_progress"
]);

/** Statuses that move forward to interview_scheduled once a time exists. */
const ADVANCE_STATUSES = new Set(["invited_to_interview"]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[interview-scheduling]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type ScheduleInterviewsInput = {
  applicationIds: unknown;
  interviewerAdminUserId: unknown;
  startAt: unknown;
  mode?: unknown;
  location?: unknown;
  slotMinutes?: unknown;
  notifyInterviewer?: boolean;
  notifyCandidates?: boolean;
  seasonLabel?: string | null;
  requestOrigin?: string | null;
};

export type ScheduleInterviewsResult =
  | { ok: false; message: string }
  | {
      ok: true;
      message: string;
      scheduled: number;
      rescheduled: number;
      skippedOtherInterviewer: number;
      notifiedCandidates: number;
      notifyFailures: number;
      interviewerNotified: boolean;
    };

export async function scheduleInterviews(
  input: ScheduleInterviewsInput
): Promise<ScheduleInterviewsResult> {
  // ── 1. Who is asking
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canBulkAssignReviews(actor.role)) {
    return { ok: false, message: "Bạn không có quyền xếp lịch phỏng vấn." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // ── 2. The appointment itself
  const schedule = parseScheduleInput({
    startAt: input.startAt,
    mode: input.mode,
    location: input.location,
    slotMinutes: input.slotMinutes
  });
  if (!schedule.ok) return { ok: false, message: schedule.message };

  // ── 3. The candidates
  const rawIds = Array.isArray(input.applicationIds) ? input.applicationIds : [];
  const applicationIds = Array.from(
    new Set(rawIds.map((id) => String(id ?? "").trim()).filter((id) => isValidUuid(id)))
  );
  if (!applicationIds.length) {
    return { ok: false, message: "Vui lòng chọn ít nhất một ứng viên để xếp lịch." };
  }
  if (applicationIds.length > MAX_INTERVIEWS_PER_RUN) {
    return {
      ok: false,
      message: `Mỗi lần chỉ xếp được tối đa ${MAX_INTERVIEWS_PER_RUN} ca phỏng vấn. Vui lòng chia thành nhiều lượt.`
    };
  }

  // ── 4. The interviewer — an id from a form is never trusted as a reviewer id
  const interviewerId = String(input.interviewerAdminUserId ?? "").trim();
  if (!isValidUuid(interviewerId)) {
    return { ok: false, message: "Vui lòng chọn người phỏng vấn." };
  }

  const { data: interviewerRow, error: interviewerErr } = await client
    .from("admin_users")
    .select("id,email,full_name,role,status")
    .eq("id", interviewerId)
    .maybeSingle();

  if (interviewerErr) {
    log("interviewer lookup", interviewerErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const interviewer = interviewerRow as {
    id: string;
    email: string | null;
    full_name: string | null;
    role: string | null;
    status: string | null;
  } | null;

  if (!interviewer || String(interviewer.status ?? "") !== "active" || !canReview(interviewer.role)) {
    return {
      ok: false,
      message:
        "Người phỏng vấn được chọn không hợp lệ (tài khoản không tồn tại, đang khoá, hoặc không có quyền chấm). Vui lòng tải lại danh sách."
    };
  }

  // ── 5. Load the applications and check scope on each season
  const { data: appRows, error: appsErr } = await client
    .from("applications")
    .select("id,status,season_id,intake_batch_id,full_name,email_primary,role_applied,submitted_at")
    .in("id", applicationIds)
    .order("submitted_at", { ascending: true })
    .order("id", { ascending: true });

  if (appsErr) {
    log("load applications", appsErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const apps = (appRows ?? []) as Array<{
    id: string;
    status: string | null;
    season_id: string | null;
    intake_batch_id: string | null;
    full_name: string | null;
    email_primary: string | null;
    role_applied: string | null;
    submitted_at: string | null;
  }>;

  if (!apps.length) return { ok: false, message: "Không tìm thấy hồ sơ nào trong danh sách đã chọn." };

  const scopeContext = await getAdminScopeContext();
  const seasonIds = Array.from(new Set(apps.map((app) => app.season_id).filter(Boolean))) as string[];
  const seasonChecks = await Promise.all(
    seasonIds.map(async (seasonId) => [seasonId, await canReviewSeason(scopeContext, seasonId)] as const)
  );
  const allowedSeasons = new Set(seasonChecks.filter(([, allowed]) => allowed).map(([id]) => id));

  const eligible = apps.filter(
    (app) =>
      SCHEDULABLE_STATUSES.has(String(app.status ?? "")) &&
      app.season_id !== null &&
      allowedSeasons.has(app.season_id)
  );

  if (!eligible.length) {
    return {
      ok: false,
      message:
        "Không có hồ sơ nào xếp lịch được: hồ sơ phải đang ở trạng thái đã mời phỏng vấn và thuộc mùa bạn có quyền."
    };
  }

  // ── 6. Existing interview rows decide insert vs. move vs. leave alone
  const eligibleIds = eligible.map((app) => app.id);
  const { data: existingRows, error: existingErr } = await client
    .from("application_reviews")
    .select("id,application_id,reviewer_admin_user_id,status")
    .eq("review_round", "interview")
    .neq("status", "cancelled")
    .in("application_id", eligibleIds)
    .order("created_at", { ascending: true });

  if (existingErr) {
    log("load existing interview reviews", existingErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const existingByApp = new Map<string, { id: string; reviewer_admin_user_id: string | null }>();
  for (const row of (existingRows ?? []) as Array<{
    id: string;
    application_id: string;
    reviewer_admin_user_id: string | null;
  }>) {
    if (!existingByApp.has(row.application_id)) {
      existingByApp.set(row.application_id, {
        id: row.id,
        reviewer_admin_user_id: row.reviewer_admin_user_id
      });
    }
  }

  const bookable = eligible.filter((app) => {
    const existing = existingByApp.get(app.id);
    return !existing || existing.reviewer_admin_user_id === interviewer.id;
  });
  const skippedOtherInterviewer = eligible.length - bookable.length;

  if (!bookable.length) {
    return {
      ok: false,
      message: `${skippedOtherInterviewer} hồ sơ đã có người phỏng vấn khác. Huỷ lượt phỏng vấn cũ trước khi xếp lại.`
    };
  }

  // ── 7. Write the appointments
  const slots = buildSlotTimes(schedule.startAtIso, schedule.slotMinutes, bookable.length);
  const now = new Date().toISOString();

  const scheduleFields = {
    interview_scheduled_at: null as string | null,
    interview_mode: schedule.mode,
    interview_location: schedule.location
  };

  const inserts: Array<Record<string, unknown>> = [];
  const slotByApp = new Map<string, string>();
  let rescheduled = 0;
  let failed = 0;

  for (let index = 0; index < bookable.length; index++) {
    const app = bookable[index];
    const slotAt = slots[index] ?? schedule.startAtIso;
    slotByApp.set(app.id, slotAt);
    const existing = existingByApp.get(app.id);

    if (existing) {
      const { error: updateErr } = await client
        .from("application_reviews")
        .update({ ...scheduleFields, interview_scheduled_at: slotAt })
        .eq("id", existing.id);
      if (updateErr) {
        log("reschedule interview review", updateErr);
        failed++;
        slotByApp.delete(app.id);
        continue;
      }
      rescheduled++;
      continue;
    }

    inserts.push({
      application_id: app.id,
      review_round: "interview",
      reviewer_admin_user_id: interviewer.id,
      assigned_by: actor.id,
      assigned_at: now,
      status: "assigned",
      claim_source: "bulk_assign",
      ...scheduleFields,
      interview_scheduled_at: slotAt
    });
  }

  if (inserts.length) {
    const { error: insertErr } = await client.from("application_reviews").insert(inserts);
    if (insertErr) {
      log("insert interview reviews", insertErr);
      return {
        ok: false,
        message: `Không thể tạo lượt phỏng vấn: ${insertErr.message}`
      };
    }
  }

  const bookedIds = bookable.map((app) => app.id).filter((id) => slotByApp.has(id));
  const scheduled = inserts.length;

  // ── 8. Move the applications forward (non-fatal — the appointment is written)
  const advanceIds = bookable
    .filter((app) => slotByApp.has(app.id) && ADVANCE_STATUSES.has(String(app.status ?? "")))
    .map((app) => app.id);

  if (advanceIds.length) {
    const { error: statusErr } = await client
      .from("applications")
      .update({ status: "interview_scheduled" })
      .in("id", advanceIds)
      .in("status", Array.from(ADVANCE_STATUSES));
    if (statusErr) {
      log("advance applications to interview_scheduled (non-fatal)", statusErr);
    }
  }

  // ── 9. Tell people (never fatal: the rows are already written)
  const seasonLabel = input.seasonLabel ?? SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
  const modeLabel = schedule.mode ? INTERVIEW_MODE_LABELS[schedule.mode] : null;
  let notifiedCandidates = 0;
  let notifyFailures = 0;
  let interviewerNotified = false;

  if (input.notifyInterviewer !== false && interviewer.email) {
    try {
      const sent = await sendInterviewSchedule({
        toEmail: interviewer.email,
        interviewerName: interviewer.full_name ?? "",
        seasonLabel,
        interviewCount: bookedIds.length,
        firstSlotLabel: formatInterviewTimeVi(schedule.startAtIso),
        modeLabel,
        location: schedule.location,
        requestOrigin: input.requestOrigin ?? null
      });
      if (sent.ok && !sent.skipped) interviewerNotified = true;
      else if (!sent.ok) notifyFailures++;
    } catch (err) {
      log("interviewer schedule email (non-fatal)", err);
      notifyFailures++;
    }
  }

  if (input.notifyCandidates) {
    for (const app of bookable) {
      const slotAt = slotByApp.get(app.id);
      if (!slotAt) continue;
      const email = String(app.email_primary ?? "").trim();
      if (!email) {
        notifyFailures++;
        continue;
      }
      try {
        const sent = await sendInterviewInvite({
          toEmail: email,
          candidateName: app.full_name ?? "",
          seasonLabel,
          timeLabel: formatInterviewTimeVi(slotAt) ?? "",
          modeLabel,
          location: schedule.location,
          applicationId: app.id
        });
        if (sent.ok && !sent.skipped) notifiedCandidates++;
        else if (!sent.ok) notifyFailures++;
      } catch (err) {
        log("candidate invite email (non-fatal)", err);
        notifyFailures++;
      }
    }
  }

  const parts = [
    `Đã xếp lịch ${bookedIds.length} ca phỏng vấn cho ${interviewer.full_name ?? interviewer.email ?? "người phỏng vấn"}`
  ];
  if (rescheduled) parts.push(`${rescheduled} ca được dời giờ`);
  if (skippedOtherInterviewer) parts.push(`${skippedOtherInterviewer} hồ sơ bỏ qua vì đã có người phỏng vấn khác`);
  if (failed) parts.push(`${failed} ca không cập nhật được`);
  if (input.notifyCandidates) parts.push(`${notifiedCandidates} ứng viên đã nhận email`);
  if (notifyFailures) parts.push(`${notifyFailures} email chưa gửi được`);

  return {
    ok: true,
    message: `${parts.join(" · ")}.`,
    scheduled,
    rescheduled,
    skippedOtherInterviewer,
    notifiedCandidates,
    notifyFailures,
    interviewerNotified
  };
}

export type CancelInterviewResult = { ok: boolean; message: string };

/**
 * Release an appointment: the interview row is cancelled and the candidate goes
 * back to the pool. Used when an interviewer drops out — without it the only
 * way to change interviewer would be to edit the database by hand.
 */
export async function cancelInterviewSlot(input: {
  reviewId: unknown;
}): Promise<CancelInterviewResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canBulkAssignReviews(actor.role)) {
    return { ok: false, message: "Bạn không có quyền huỷ lịch phỏng vấn." };
  }

  const reviewId = String(input.reviewId ?? "").trim();
  if (!isValidUuid(reviewId)) return { ok: false, message: "Lượt phỏng vấn không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: reviewRow, error: reviewErr } = await client
    .from("application_reviews")
    .select("id,application_id,review_round,status")
    .eq("id", reviewId)
    .maybeSingle();

  if (reviewErr) {
    log("load review for cancellation", reviewErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const review = reviewRow as {
    id: string;
    application_id: string;
    review_round: string;
    status: string;
  } | null;

  if (!review || review.review_round !== "interview") {
    return { ok: false, message: "Không tìm thấy lượt phỏng vấn này." };
  }
  if (review.status === "submitted") {
    return { ok: false, message: "Lượt phỏng vấn đã nộp điểm nên không huỷ được." };
  }

  const { data: app, error: appErr } = await client
    .from("applications")
    .select("id,season_id,status")
    .eq("id", review.application_id)
    .maybeSingle();
  if (appErr) {
    log("load application for cancellation", appErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const scopeContext = await getAdminScopeContext();
  if (!(await canReviewSeason(scopeContext, (app as { season_id?: string | null } | null)?.season_id ?? null))) {
    return { ok: false, message: "Bạn không có quyền trong mùa của hồ sơ này." };
  }

  const { error: cancelErr } = await client
    .from("application_reviews")
    .update({ status: "cancelled" })
    .eq("id", reviewId)
    .neq("status", "submitted");

  if (cancelErr) {
    log("cancel interview review", cancelErr);
    return { ok: false, message: SAFE_ERROR };
  }

  // Put the candidate back in the invited pool so they can be rebooked.
  const currentStatus = String((app as { status?: string | null } | null)?.status ?? "");
  if (currentStatus === "interview_scheduled") {
    const { error: statusErr } = await client
      .from("applications")
      .update({ status: "invited_to_interview" })
      .eq("id", review.application_id)
      .eq("status", "interview_scheduled");
    if (statusErr) log("reset application status (non-fatal)", statusErr);
  }

  return { ok: true, message: "Đã huỷ lịch phỏng vấn. Ứng viên quay lại danh sách chờ xếp lịch." };
}

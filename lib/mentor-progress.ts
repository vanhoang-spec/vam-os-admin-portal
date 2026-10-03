import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { buildMentorProgress, type MentorProgress, type MentorProgressInput } from "@/lib/mentor-progress-core";
import { BOOKING_ELIGIBLE_STATUSES } from "@/lib/interview-schedule-core";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { canViewMenteeSessionStatus } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/mentor-progress.ts — đọc tiến độ phỏng vấn mentor Mùa 12 cho BTC (03/10/2026).
 *
 * Hai cổng, fail-closed: vai trò (canViewMenteeSessionStatus — core team / support
 * team / admin) VÀ quyền vận hành mùa (canOperateSeason). Không đọc được phạm vi →
 * từ chối, không bao giờ "mặc định cho xem".
 *
 * Ai được tính: mentor Mùa 12 nộp đơn mới (không tính 260 mentor gia hạn — họ không
 * qua phỏng vấn) đã bước vào vòng phỏng vấn: có thư mời đặt lịch, có lịch hẹn, có
 * phiếu vòng phỏng vấn, hoặc đang ở trạng thái mời / đặt / đang phỏng vấn.
 */

type Json = Record<string, any>;
const clean = (value: unknown) => String(value ?? "").trim();
const INTERVIEW_STAGE = new Set([...Array.from(BOOKING_ELIGIBLE_STATUSES), "interview_in_progress", "interview_passed"]);

export type MentorProgressResult =
  | { ok: true; progress: MentorProgress; generatedAt: string }
  | { ok: false; message: string };

export async function getMentorProgress(nowMs = Date.now()): Promise<MentorProgressResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id || !canViewMenteeSessionStatus(actor.role)) {
    return { ok: false, message: "Trang này dành cho BTC (Core team, Support team)." };
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: "Hệ thống đang bận, thử lại sau ít phút." };
  try {
    const season = await client.from("seasons").select("id").eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).single();
    if (season.error || !season.data?.id) throw new Error("season");
    const seasonId = String(season.data.id);
    const ctx = await getAdminScopeContext();
    if (ctx.scopeError || !(await canOperateSeason(ctx, seasonId))) {
      return { ok: false, message: "Tài khoản chưa có quyền vận hành mùa hiện tại nên chưa xem được tiến độ phỏng vấn mentor." };
    }

    const apps = await readAllPages<Json>("applications", "id,full_name,email_primary,phone_primary,status,source,role_applied", (columns) =>
      client.from("applications").select(columns).eq("season_id", seasonId).eq("role_applied", "mentor")
    );
    if (apps.error) throw new Error("applications");
    const fresh = apps.data.filter((a) => clean(a.source) !== "s12_mentor_renewal");
    const ids = fresh.map((a) => clean(a.id));
    if (ids.length === 0) return { ok: true, progress: buildMentorProgress([], nowMs), generatedAt: new Date(nowMs).toISOString() };

    const [invites, bookings, reviews] = await Promise.all([
      readAllPagesIn<Json>(client, "interview_slot_invites", "application_id", ids, "id,application_id,send_count,last_sent_at"),
      readAllPagesIn<Json>(client, "interview_bookings", "application_id", ids, "id,application_id,status,slot_starts_at,interviewer_admin_user_id"),
      readAllPagesIn<Json>(client, "application_reviews", "application_id", ids,
        "id,application_id,status,recommendation,total_score,submitted_at,updated_at,reviewer_admin_user_id",
        (q) => q.eq("review_round", "interview").neq("status", "cancelled"))
    ]);
    if (invites.error || bookings.error || reviews.error) throw new Error("related");

    const staffIds = Array.from(new Set([
      ...bookings.data.map((b) => clean(b.interviewer_admin_user_id)),
      ...reviews.data.map((r) => clean(r.reviewer_admin_user_id))
    ].filter(Boolean)));
    const staff = staffIds.length
      ? await readAllPagesIn<Json>(client, "admin_users", "id", staffIds, "id,full_name,email")
      : { data: [] as Json[], error: null };
    if (staff.error) throw new Error("staff");
    const nameOf = new Map(staff.data.map((s) => [clean(s.id), clean(s.full_name) || clean(s.email)]));

    const inviteBy = new Map(invites.data.map((i) => [clean(i.application_id), i]));
    const activeBooking = new Map<string, Json>();
    const cancelled = new Map<string, number>();
    for (const b of bookings.data) {
      const app = clean(b.application_id);
      if (clean(b.status) === "booked") activeBooking.set(app, b);
      else cancelled.set(app, (cancelled.get(app) ?? 0) + 1);
    }
    const reviewBy = new Map<string, Json>();
    for (const r of reviews.data) {
      const app = clean(r.application_id);
      const prev = reviewBy.get(app);
      const rank = (x: Json) => (clean(x.status) === "submitted" ? 1 : 0);
      if (!prev || rank(r) > rank(prev) || (rank(r) === rank(prev) && clean(r.updated_at) > clean(prev.updated_at))) reviewBy.set(app, r);
    }

    const inputs: MentorProgressInput[] = [];
    for (const a of fresh) {
      const id = clean(a.id);
      const invite = inviteBy.get(id);
      const booking = activeBooking.get(id);
      const review = reviewBy.get(id);
      const status = clean(a.status);
      const inInterviewRound = Boolean(invite || booking || review || cancelled.get(id)) || INTERVIEW_STAGE.has(status);
      if (!inInterviewRound) continue;
      inputs.push({
        applicationId: id,
        name: clean(a.full_name) || "(chưa có tên)",
        email: clean(a.email_primary),
        phone: clean(a.phone_primary),
        appStatus: status,
        booking: booking
          ? { slotStartsAt: new Date(String(booking.slot_starts_at)).toISOString(), interviewer: nameOf.get(clean(booking.interviewer_admin_user_id)) ?? "" }
          : null,
        cancelledBookings: cancelled.get(id) ?? 0,
        review: review
          ? {
              status: clean(review.status),
              reviewer: nameOf.get(clean(review.reviewer_admin_user_id)) ?? "",
              recommendation: clean(review.recommendation) || null,
              totalScore: review.total_score == null ? null : Number(review.total_score),
              submittedAt: clean(review.submitted_at) || null
            }
          : null,
        invite: invite ? { sendCount: Number(invite.send_count) || 0, lastSentAt: clean(invite.last_sent_at) || null } : null
      });
    }
    return { ok: true, progress: buildMentorProgress(inputs, nowMs), generatedAt: new Date(nowMs).toISOString() };
  } catch (error) {
    console.error("[mentor-progress] read failed", error);
    return { ok: false, message: "Không tải được tiến độ phỏng vấn mentor. Vui lòng thử lại." };
  }
}

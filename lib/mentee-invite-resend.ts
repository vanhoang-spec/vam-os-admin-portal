import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendMenteeSessionInvite } from "@/lib/email";
import { countSentInWindow, readSessionContext } from "@/lib/mentee-invite-dispatch";
import { DAILY_EMAIL_LIMIT } from "@/lib/mentee-invite-dispatch-core";
import { normalizeApplicantEmail, resendRefusal, withinCooldown } from "@/lib/mentee-invite-resend-core";
import { requireBtc } from "@/lib/mentee-session-admin";
import { getPublicOrigin } from "@/lib/public-url";
import { CURRENT_APPLICATION_SEASON_LABEL } from "@/lib/season-labels";

/**
 * lib/mentee-invite-resend.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sửa email của MỘT hồ sơ mentee (nếu cần) và gửi lại thư mời chọn ca vào đúng
 * địa chỉ đó. Cùng cổng với gửi thư mời (requireBtc), cùng lá thư
 * (sendMenteeSessionInvite) và cùng link đặt ca đã cấp — chỉ khác là gửi được
 * cho người đã từng được gửi.
 *
 * Đường ghi hẹp: chỉ cột applications.email_primary, và chỉ khi email trong
 * database vẫn đúng là email người bấm nhìn thấy (ai đó vừa sửa thì dừng). Mỗi
 * lần sửa ghi admin_audit_log TRƯỚC — không ghi được lịch sử thì không sửa: đổi
 * email là đổi nơi mọi thư sau này tìm đến.
 */

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResendResult = { ok: boolean; message: string };

export async function correctEmailAndResendMenteeInvite(input: {
  applicationId: unknown;
  newEmail: unknown;
  expectedEmail: unknown;
  nowMs?: number;
}): Promise<ResendResult> {
  const nowMs = input.nowMs ?? Date.now();
  const access = await requireBtc();
  if (!access.ok) return access;
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Cần đăng nhập." };
  const { client, seasonId } = access;

  const applicationId = String(input.applicationId ?? "").trim();
  if (!UUID.test(applicationId)) return { ok: false, message: "Không xác định được hồ sơ." };
  const newEmail = normalizeApplicantEmail(input.newEmail);
  if (!newEmail) return { ok: false, message: "Email mới không hợp lệ — kiểm lại phần sau @ (ví dụ …@st.ueh.edu.vn)." };

  const { data: app, error: appError } = await client
    .from("applications")
    .select("id,full_name,email_primary,role_applied,status,source,season_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (appError) return { ok: false, message: SAFE_ERROR };
  if (!app) return { ok: false, message: "Không tìm thấy hồ sơ." };
  const currentEmail = String(app.email_primary ?? "").trim().toLowerCase();
  if (String(input.expectedEmail ?? "").trim().toLowerCase() !== currentEmail) {
    return { ok: false, message: "Email của hồ sơ vừa được đổi ở nơi khác. Tải lại trang rồi kiểm lại." };
  }

  const [{ data: invite, error: inviteError }, { data: booking, error: bookingError }] = await Promise.all([
    client.from("mentee_interview_invites").select("id,token,send_count,last_sent_at").eq("application_id", applicationId).maybeSingle(),
    client.from("mentee_interview_bookings").select("id").eq("application_id", applicationId).eq("status", "booked").maybeSingle()
  ]);
  if (inviteError || bookingError) return { ok: false, message: SAFE_ERROR };

  const refusal = resendRefusal({
    roleApplied: app.role_applied,
    status: app.status,
    source: app.source,
    inCurrentSeason: String(app.season_id) === seasonId,
    hasActiveBooking: Boolean(booking),
    hasInvite: Boolean(invite?.token)
  });
  if (refusal) return { ok: false, message: refusal };

  const emailChanged = newEmail !== currentEmail;
  if (withinCooldown(invite.last_sent_at ?? null, emailChanged, nowMs)) {
    return { ok: false, message: "Vừa gửi thư mời tới địa chỉ này chưa tới 10 phút — đợi rồi hẵng gửi lại." };
  }

  // Không mời vào một lưới ca đã đóng: thư sẽ dẫn tới trang không chọn được ca nào.
  const context = await readSessionContext(client, seasonId);
  if (!context) return { ok: false, message: SAFE_ERROR };
  if (!context.anyBookable) return { ok: false, message: "Đã hết hạn đặt ca hoặc không còn ca nào trống — không gửi thư mời." };

  const sentInWindow = await countSentInWindow(client, nowMs);
  if (sentInWindow === null) return { ok: false, message: "Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi." };
  if (sentInWindow >= DAILY_EMAIL_LIMIT) return { ok: false, message: "Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ." };

  if (emailChanged) {
    const { error: auditError } = await client.from("admin_audit_log").insert({
      actor_admin_user_id: actor.id,
      // Bảng chỉ nhận một danh sách loại cố định; thêm loại mới cần migration.
      // "unknown" + details nói rõ đây là việc gì.
      action_type: "unknown",
      target_admin_user_id: null,
      before_data: { email_primary: currentEmail },
      after_data: { email_primary: newEmail },
      details: { action: "correct_mentee_applicant_email", application_id: applicationId, reason: "resend_session_invite" }
    });
    if (auditError) {
      console.error("[mentee-invite-resend] audit failed", auditError);
      return { ok: false, message: "Không ghi được lịch sử sửa nên chưa sửa email. Thử lại sau ít phút." };
    }
    const { data: updated, error: updateError } = await client
      .from("applications")
      .update({ email_primary: newEmail })
      .eq("id", applicationId)
      .eq("email_primary", app.email_primary)
      .select("id");
    if (updateError) return { ok: false, message: SAFE_ERROR };
    if (!updated?.length) return { ok: false, message: "Email của hồ sơ vừa được đổi ở nơi khác. Tải lại trang rồi kiểm lại." };
  }

  const nowIso = new Date(nowMs).toISOString();
  const outcome = await sendMenteeSessionInvite({
    toEmail: newEmail,
    candidateName: String(app.full_name ?? "").trim() || "bạn",
    seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
    interviewDaysLabel: context.daysLabel,
    deadlineLabel: context.deadlineLabel,
    bookingToken: String(invite.token),
    applicationId,
    requestOrigin: await getPublicOrigin()
  });
  if (outcome.skipped) {
    return { ok: false, message: `${emailChanged ? "Đã sửa email. " : ""}Môi trường này đang tắt gửi thư — thư mời chưa đi.` };
  }
  const { error: inviteUpdateError } = await client
    .from("mentee_interview_invites")
    .update(
      outcome.ok
        ? { send_count: (Number(invite.send_count) || 0) + 1, last_sent_at: nowIso, last_error: null }
        : { last_error: String(outcome.reason ?? "Gửi thất bại").slice(0, 500) }
    )
    .eq("id", invite.id);
  if (inviteUpdateError) console.error("[mentee-invite-resend] invite bookkeeping failed", inviteUpdateError);
  if (!outcome.ok) {
    return { ok: false, message: `${emailChanged ? "Đã sửa email nhưng " : ""}gửi thư mời không thành công. Xem sổ thư để biết lý do.` };
  }
  return {
    ok: true,
    message: `${emailChanged ? `Đã sửa email thành ${newEmail} và g` : "G"}ửi lại thư mời chọn ca (hạn đặt ${context.deadlineLabel}).`
  };
}

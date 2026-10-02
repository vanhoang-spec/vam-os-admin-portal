import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { buildMenteeSessionReopenEmail } from "@/lib/email-core";
import { sendMenteeSessionReopen } from "@/lib/email";
import { countSentInWindow, readSessionContext } from "@/lib/mentee-invite-dispatch";
import {
  DAILY_EMAIL_LIMIT,
  DISPATCH_MAX_PER_RUN,
  DISPATCH_TIME_BUDGET_MS,
  dispatchAllowance
} from "@/lib/mentee-invite-dispatch-core";
import { HOTLINE_ZALO } from "@/lib/mentee-interview-core";
import {
  latestOpenUntil,
  pickReopenAudience,
  type ReopenApplicant,
  type ReopenInvite,
  type ReopenRecipient
} from "@/lib/mentee-reopen-notice-core";
import { requireBtc, requireSessionViewer } from "@/lib/mentee-session-admin";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { getPublicOrigin } from "@/lib/public-url";
import { CURRENT_APPLICATION_SEASON_LABEL } from "@/lib/season-labels";
import { formatDate, formatTime } from "@/lib/utils";

/**
 * lib/mentee-reopen-notice.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thư báo "mở lại chọn ca" cho mentee BTC đã gia hạn riêng (booking_open_until).
 * Cùng cổng với gửi thư mời (requireBtc để gửi, requireSessionViewer để xem),
 * cùng hạn mức chung (dispatchAllowance), cùng nhịp lượt (tối đa
 * DISPATCH_MAX_PER_RUN thư, DISPATCH_TIME_BUDGET_MS) — thư này ăn vào cùng một
 * hạn mức Brevo với mọi thư khác.
 *
 * Không gửi trùng: mỗi người được ĐÁNH DẤU reopen_notified_at ngay TRƯỚC khi gửi,
 * từng người một, với điều kiện cột đang trống — hai lượt bấm chồng nhau thì
 * chỉ một lượt giành được người đó. Gửi hỏng thì xoá dấu để lượt sau gửi lại.
 * Đánh dấu từng người chứ không cả lô: hàm bị cắt giữa chừng chỉ để lại tối đa
 * một người bị đánh dấu nhầm, không phải cả lô chưa gửi.
 */

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";
const SAMPLE_NAME = "Nguyễn Văn A";
const PLACEHOLDER_LINK = "(đường dẫn riêng của từng bạn)";

type Json = Record<string, any>;
const clean = (value: unknown) => String(value ?? "").trim();
const deadlineLabelOf = (iso: string) => `${formatTime(iso)} ngày ${formatDate(iso)}`;
const log = (message: string, error: unknown) => console.error(`[mentee-reopen-notice] ${message}`, error);

async function readAudience(
  client: any,
  seasonId: string,
  nowIso: string
): Promise<{ ok: true; recipients: ReopenRecipient[] } | { ok: false }> {
  const invites = await readAllPages<Json>(
    "mentee_interview_invites",
    "id,application_id,token,booking_open_until,reopen_notified_at",
    (columns) => client.from("mentee_interview_invites").select(columns).not("booking_open_until", "is", null)
  );
  if (invites.error) {
    log("invites read failed", invites.error);
    return { ok: false };
  }
  const ids = invites.data.map((row) => clean(row.application_id)).filter(Boolean);
  if (ids.length === 0) return { ok: true, recipients: [] };

  const [apps, booked] = await Promise.all([
    readAllPagesIn<Json>(client, "applications", "id", ids, "id,full_name,email_primary,status,role_applied,source,season_id"),
    readAllPagesIn<Json>(client, "mentee_interview_bookings", "application_id", ids, "id,application_id", (q) =>
      q.eq("status", "booked")
    )
  ]);
  if (apps.error || booked.error) {
    log("audience read failed", apps.error ?? booked.error);
    return { ok: false };
  }

  const recipients = pickReopenAudience({
    invites: invites.data.map(
      (row): ReopenInvite => ({
        id: clean(row.id),
        applicationId: clean(row.application_id),
        token: clean(row.token) || null,
        openUntil: clean(row.booking_open_until) || null,
        notifiedAt: clean(row.reopen_notified_at) || null
      })
    ),
    applicants: apps.data.map(
      (row): ReopenApplicant => ({
        id: clean(row.id),
        fullName: clean(row.full_name),
        email: clean(row.email_primary).toLowerCase(),
        status: clean(row.status),
        roleApplied: clean(row.role_applied),
        source: clean(row.source),
        seasonId: clean(row.season_id)
      })
    ),
    bookedApplicationIds: new Set(booked.data.map((row) => clean(row.application_id))),
    seasonId,
    nowIso
  });
  return { ok: true, recipients };
}

export type ReopenNoticeStatus =
  | { ok: false; message: string }
  | {
      ok: true;
      /** Người đang được mở lại, hạn riêng chưa qua, chưa chọn ca. */
      total: number;
      pending: number;
      notified: number;
      deadlineLabel: string;
      daysLabel: string;
      anyBookable: boolean;
      sentInWindow: number | null;
      allowance: number;
      preview: { subject: string; text: string } | null;
    };

export async function getReopenNoticeStatus(): Promise<ReopenNoticeStatus> {
  const access = await requireSessionViewer();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, seasonId } = access;

  const nowMs = Date.now();
  const audience = await readAudience(client, seasonId, new Date(nowMs).toISOString());
  if (!audience.ok) return { ok: false, message: SAFE_ERROR };
  const { recipients } = audience;
  const deadline = latestOpenUntil(recipients);

  const [sentInWindow, context] = await Promise.all([
    countSentInWindow(client, nowMs),
    deadline ? readSessionContext(client, seasonId, deadline) : Promise.resolve(null)
  ]);
  if (deadline && !context) return { ok: false, message: SAFE_ERROR };

  const deadlineLabel = deadline ? deadlineLabelOf(deadline) : "";
  const daysLabel = context?.daysLabel ?? "";
  const sample = deadline
    ? buildMenteeSessionReopenEmail({
        candidateName: SAMPLE_NAME,
        seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
        interviewDaysLabel: daysLabel,
        bookingUrl: PLACEHOLDER_LINK,
        deadlineLabel,
        hotlineZalo: HOTLINE_ZALO
      })
    : null;

  const pending = recipients.filter((r) => !r.notified).length;
  return {
    ok: true,
    total: recipients.length,
    pending,
    notified: recipients.length - pending,
    deadlineLabel,
    daysLabel,
    anyBookable: Boolean(context?.anyBookable),
    sentInWindow,
    allowance: sentInWindow === null ? 0 : Math.min(DISPATCH_MAX_PER_RUN, dispatchAllowance(sentInWindow)),
    preview: sample ? { subject: sample.subject, text: sample.text } : null
  };
}

export type ReopenSendResult = { ok: boolean; message: string; sent: number; failed: number };

const fail = (message: string): ReopenSendResult => ({ ok: false, message, sent: 0, failed: 0 });

/** Gửi MỘT thư mẫu tới chính người bấm — đường dẫn là câu giữ chỗ, không phải link của ai. */
export async function sendReopenNoticeTest(input: { nowMs?: number } = {}): Promise<ReopenSendResult> {
  const nowMs = input.nowMs ?? Date.now();
  const access = await requireBtc();
  if (!access.ok) return fail(access.message);
  const actor = await getCurrentAdminUser();
  if (!actor?.email) return fail("Cần đăng nhập.");
  const { client, seasonId } = access;

  const audience = await readAudience(client, seasonId, new Date(nowMs).toISOString());
  if (!audience.ok) return fail(SAFE_ERROR);
  const deadline = latestOpenUntil(audience.recipients);
  if (!deadline) return fail("Chưa có bạn nào đang được mở lại chọn ca — không có gì để gửi thử.");
  const context = await readSessionContext(client, seasonId, deadline);
  if (!context) return fail(SAFE_ERROR);

  const sentInWindow = await countSentInWindow(client, nowMs);
  if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
  if (sentInWindow >= DAILY_EMAIL_LIMIT) return fail("Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ.");

  const outcome = await sendMenteeSessionReopen({
    toEmail: actor.email,
    candidateName: clean(actor.full_name) || "bạn",
    seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
    interviewDaysLabel: context.daysLabel,
    deadlineLabel: deadlineLabelOf(deadline),
    bookingToken: null,
    applicationId: null
  });
  if (outcome.skipped) return fail("Môi trường này đang tắt gửi thư — thư thử chưa đi.");
  if (!outcome.ok) return fail("Gửi thư thử không thành công. Xem Vận hành → Mail → Nhật ký gửi.");
  return { ok: true, message: `Đã gửi thư thử tới ${actor.email}.`, sent: 1, failed: 0 };
}

export async function sendReopenNotices(input: { now?: () => number } = {}): Promise<ReopenSendResult> {
  const now = input.now ?? Date.now;
  const access = await requireBtc();
  if (!access.ok) return fail(access.message);
  const { client, seasonId } = access;

  const startedMs = now();
  const nowIso = new Date(startedMs).toISOString();

  const audience = await readAudience(client, seasonId, nowIso);
  if (!audience.ok) return fail(SAFE_ERROR);
  const pending = audience.recipients.filter((r) => !r.notified);
  if (pending.length === 0) {
    return { ok: true, message: "Không còn ai chờ thư mở lại — mọi bạn đã được báo hoặc đã chọn ca.", sent: 0, failed: 0 };
  }

  // Không mời vào một lưới không còn ca nào đặt được trước hạn mới.
  const deadline = latestOpenUntil(audience.recipients) as string;
  const context = await readSessionContext(client, seasonId, deadline);
  if (!context) return fail(SAFE_ERROR);
  if (!context.anyBookable || !context.daysLabel) {
    return fail("Không còn ca nào đặt được trước hạn mới — không gửi thư dẫn tới một trang không chọn được ca.");
  }

  const sentInWindow = await countSentInWindow(client, startedMs);
  if (sentInWindow === null) {
    return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi — gửi mù có thể làm các thư khác của hệ thống bị chặn.");
  }
  const allowance = Math.min(DISPATCH_MAX_PER_RUN, dispatchAllowance(sentInWindow));
  if (allowance === 0) return fail("Đã chạm phần hạn mức thư trong 24 giờ qua. Thử lại sau vài giờ.");

  const requestOrigin = await getPublicOrigin();
  let sent = 0;
  let failed = 0;
  let stopped429 = false;

  for (const recipient of pending.slice(0, allowance)) {
    if (stopped429 || now() - startedMs > DISPATCH_TIME_BUDGET_MS) break;

    // Đánh dấu TRƯỚC khi gửi, chỉ khi còn trống: lượt bấm chồng không gửi trùng.
    const stamp = new Date(now()).toISOString();
    const { data: claimed, error: claimError } = await client
      .from("mentee_interview_invites")
      .update({ reopen_notified_at: stamp })
      .eq("id", recipient.inviteId)
      .is("reopen_notified_at", null)
      .select("id");
    if (claimError) {
      log("claim failed", claimError);
      return { ok: false, message: `${SAFE_ERROR} Đã gửi ${sent} thư trước khi dừng.`, sent, failed };
    }
    if (!claimed?.length) continue;

    let outcome: { ok: boolean; skipped: boolean; reason?: string; providerStatus?: number | null };
    try {
      outcome = await sendMenteeSessionReopen({
        toEmail: recipient.email,
        candidateName: recipient.fullName || "bạn",
        seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
        interviewDaysLabel: context.daysLabel,
        deadlineLabel: deadlineLabelOf(recipient.openUntil),
        bookingToken: recipient.token,
        applicationId: recipient.applicationId,
        requestOrigin
      });
    } catch (error) {
      log("send crashed", error);
      outcome = { ok: false, skipped: false, reason: String(error) };
    }

    if (outcome.ok && !outcome.skipped) {
      sent += 1;
      continue;
    }
    if (!outcome.skipped) failed += 1;
    if (outcome.providerStatus === 429) stopped429 = true;
    // Không đi được thì xoá dấu — người này vẫn chờ thư ở lượt sau.
    const { error: releaseError } = await client
      .from("mentee_interview_invites")
      .update({ reopen_notified_at: null, last_error: clean(outcome.reason ?? "Gửi thất bại").slice(0, 500) })
      .eq("id", recipient.inviteId)
      .eq("reopen_notified_at", stamp);
    if (releaseError) log("release failed", releaseError);
    if (outcome.skipped) {
      return { ok: false, message: "Môi trường này đang tắt gửi thư — chưa gửi thư nào.", sent, failed };
    }
  }

  const left = Math.max(0, pending.length - sent);
  const parts = [`Đã gửi ${sent} thư mở lại chọn ca.`];
  if (stopped429) parts.push("Nhà cung cấp báo chạm trần thư trong ngày — bấm lại sau vài giờ.");
  if (failed > 0) parts.push(`${failed} thư lỗi, xem Vận hành → Mail → Nhật ký gửi.`);
  if (left > 0 && !stopped429) parts.push(`Còn ${left} bạn chờ thư — bấm lại để gửi tiếp.`);
  return { ok: failed === 0 && !stopped429, message: parts.join(" "), sent, failed };
}

import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendTemplatedEmail } from "@/lib/email";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import {
  DAILY_EMAIL_LIMIT,
  DISPATCH_MAX_PER_RUN,
  DISPATCH_TIME_BUDGET_MS,
  dispatchAllowance
} from "@/lib/mentee-invite-dispatch-core";
import { HOTLINE_ZALO, menteeBookingUrl } from "@/lib/mentee-interview-core";
import {
  buildOnlineNoticeEmail,
  pickOnlineAudience,
  type OnlineRecipient
} from "@/lib/mentee-online-notice-core";
import { requireBtc, requireSessionViewer } from "@/lib/mentee-session-admin";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { getPublicOrigin } from "@/lib/public-url";

/**
 * lib/mentee-online-notice.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thư báo "ca của bạn chuyển sang PHỎNG VẤN ONLINE" (BTC 08/10/2026). Cùng khuôn
 * với thư "mở lại chọn ca" (lib/mentee-reopen-notice.ts): requireBtc để gửi,
 * requireSessionViewer để xem; cùng hạn mức chung và cùng nhịp lượt (tối đa
 * DISPATCH_MAX_PER_RUN thư, DISPATCH_TIME_BUDGET_MS).
 *
 * Không gửi trùng: đánh dấu online_notified_at ngay TRƯỚC khi gửi, từng người, chỉ
 * khi cột đang trống — hai lượt bấm chồng nhau thì chỉ một lượt giành được người
 * đó. Gửi hỏng thì xoá dấu để lượt sau gửi lại.
 *
 * Thư đi bằng loại general_announcement (đã có trong outbound_emails_kind_check),
 * nối về đơn của mentee — không cần nới ràng buộc loại thư.
 */

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";
const SAMPLE_NAME = "Nguyễn Văn A";
const PLACEHOLDER_LINK = "(đường dẫn riêng của từng bạn)";
const FALLBACK_ORIGIN = "https://os.alumni-mentoring.edu.vn";

type Json = Record<string, any>;
const clean = (value: unknown) => String(value ?? "").trim();
const log = (message: string, error: unknown) => console.error(`[mentee-online-notice] ${message}`, error);

async function readAudience(
  client: any,
  seasonId: string,
  nowIso: string
): Promise<{ ok: true; recipients: OnlineRecipient[]; sessionsWithoutLink: number } | { ok: false }> {
  const sessions = await readAllPages<Json>("interview_sessions", "id,starts_at,ends_at,venue", (columns) =>
    client.from("interview_sessions").select(columns).eq("season_id", seasonId)
  );
  if (sessions.error) {
    log("sessions read failed", sessions.error);
    return { ok: false };
  }
  const sessionIds = sessions.data.map((row) => clean(row.id)).filter(Boolean);
  if (!sessionIds.length) return { ok: true, recipients: [], sessionsWithoutLink: 0 };

  const bookings = await readAllPagesIn<Json>(client, "mentee_interview_bookings", "session_id", sessionIds, "id,application_id,session_id", (q) =>
    q.eq("status", "booked")
  );
  if (bookings.error) {
    log("bookings read failed", bookings.error);
    return { ok: false };
  }
  const appIds = Array.from(new Set(bookings.data.map((row) => clean(row.application_id)).filter(Boolean)));

  const [apps, invites] = appIds.length
    ? await Promise.all([
        readAllPagesIn<Json>(client, "applications", "id", appIds, "id,full_name,email_primary,status,role_applied,season_id"),
        readAllPagesIn<Json>(client, "mentee_interview_invites", "application_id", appIds, "id,application_id,token,online_notified_at")
      ])
    : [{ data: [] as Json[], error: null }, { data: [] as Json[], error: null }];
  if (apps.error || invites.error) {
    log("audience read failed", apps.error ?? invites.error);
    return { ok: false };
  }

  const picked = pickOnlineAudience({
    sessions: sessions.data.map((row) => ({
      id: clean(row.id),
      startsAtIso: new Date(row.starts_at).toISOString(),
      endsAtIso: new Date(row.ends_at).toISOString(),
      venue: row.venue ?? null
    })),
    bookings: bookings.data.map((row) => ({ applicationId: clean(row.application_id), sessionId: clean(row.session_id) })),
    applicants: apps.data.map((row) => ({
      id: clean(row.id),
      fullName: clean(row.full_name),
      email: clean(row.email_primary).toLowerCase(),
      status: clean(row.status),
      roleApplied: clean(row.role_applied),
      seasonId: clean(row.season_id)
    })),
    invites: invites.data.map((row) => ({
      id: clean(row.id),
      applicationId: clean(row.application_id),
      token: clean(row.token) || null,
      notifiedAt: clean(row.online_notified_at) || null
    })),
    seasonId,
    nowIso
  });
  return { ok: true, ...picked };
}

export type OnlineNoticeStatus =
  | { ok: false; message: string }
  | {
      ok: true;
      total: number;
      pending: number;
      notified: number;
      sessionsWithoutLink: number;
      sentInWindow: number | null;
      allowance: number;
      preview: { subject: string; text: string } | null;
    };

export async function getOnlineNoticeStatus(): Promise<OnlineNoticeStatus> {
  const access = await requireSessionViewer();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, seasonId } = access;
  const nowMs = Date.now();
  const audience = await readAudience(client, seasonId, new Date(nowMs).toISOString());
  if (!audience.ok) return { ok: false, message: SAFE_ERROR };
  const sentInWindow = await countSentInWindow(client, nowMs);
  const first = audience.recipients[0];
  const preview = first
    ? buildOnlineNoticeEmail({
        candidateName: SAMPLE_NAME,
        sessionLabel: first.sessionLabel,
        groupUrl: first.groupUrl,
        manageUrl: PLACEHOLDER_LINK,
        hotlineZalo: HOTLINE_ZALO
      })
    : null;
  const pending = audience.recipients.filter((r) => !r.notified).length;
  return {
    ok: true,
    total: audience.recipients.length,
    pending,
    notified: audience.recipients.length - pending,
    sessionsWithoutLink: audience.sessionsWithoutLink,
    sentInWindow,
    allowance: sentInWindow === null ? 0 : Math.min(DISPATCH_MAX_PER_RUN, dispatchAllowance(sentInWindow)),
    preview
  };
}

export type OnlineSendResult = { ok: boolean; message: string; sent: number; failed: number };

const fail = (message: string): OnlineSendResult => ({ ok: false, message, sent: 0, failed: 0 });

/** Một thư mẫu tới chính người bấm — đường dẫn là câu giữ chỗ, không phải link của ai. */
export async function sendOnlineNoticeTest(input: { nowMs?: number } = {}): Promise<OnlineSendResult> {
  const nowMs = input.nowMs ?? Date.now();
  const access = await requireBtc();
  if (!access.ok) return fail(access.message);
  const actor = await getCurrentAdminUser();
  if (!actor?.email) return fail("Cần đăng nhập.");
  const { client, seasonId } = access;

  const audience = await readAudience(client, seasonId, new Date(nowMs).toISOString());
  if (!audience.ok) return fail(SAFE_ERROR);
  const first = audience.recipients[0];
  if (!first) return fail("Chưa có bạn nào giữ ca phỏng vấn online — không có gì để gửi thử.");

  const sentInWindow = await countSentInWindow(client, nowMs);
  if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
  if (sentInWindow >= DAILY_EMAIL_LIMIT) return fail("Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ.");

  const mail = buildOnlineNoticeEmail({
    candidateName: clean(actor.full_name) || "bạn",
    sessionLabel: first.sessionLabel,
    groupUrl: first.groupUrl,
    manageUrl: PLACEHOLDER_LINK,
    hotlineZalo: HOTLINE_ZALO
  });
  const outcome = await sendTemplatedEmail({
    kind: "general_announcement",
    toEmail: actor.email,
    subject: `[THỬ] ${mail.subject}`,
    body: mail.text
  });
  if (outcome.skipped) return fail("Môi trường này đang tắt gửi thư — thư thử chưa đi.");
  if (!outcome.ok) return fail("Gửi thư thử không thành công. Xem Vận hành → Mail → Nhật ký gửi.");
  return { ok: true, message: `Đã gửi thư thử tới ${actor.email}.`, sent: 1, failed: 0 };
}

export async function sendOnlineNotices(input: { now?: () => number } = {}): Promise<OnlineSendResult> {
  const now = input.now ?? Date.now;
  const access = await requireBtc();
  if (!access.ok) return fail(access.message);
  const { client, seasonId } = access;

  const startedMs = now();
  const audience = await readAudience(client, seasonId, new Date(startedMs).toISOString());
  if (!audience.ok) return fail(SAFE_ERROR);
  const pending = audience.recipients.filter((r) => !r.notified);
  if (pending.length === 0) {
    return { ok: true, message: "Không còn ai chờ thư báo phỏng vấn online.", sent: 0, failed: 0 };
  }

  const sentInWindow = await countSentInWindow(client, startedMs);
  if (sentInWindow === null) {
    return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi — gửi mù có thể làm các thư khác của hệ thống bị chặn.");
  }
  const allowance = Math.min(DISPATCH_MAX_PER_RUN, dispatchAllowance(sentInWindow));
  if (allowance === 0) return fail("Đã chạm phần hạn mức thư trong 24 giờ qua. Thử lại sau vài giờ.");

  const origin = (await getPublicOrigin()) ?? FALLBACK_ORIGIN;
  let sent = 0;
  let failed = 0;
  let stopped429 = false;

  for (const recipient of pending.slice(0, allowance)) {
    if (stopped429 || now() - startedMs > DISPATCH_TIME_BUDGET_MS) break;

    // Đánh dấu TRƯỚC khi gửi, chỉ khi còn trống: lượt bấm chồng không gửi trùng.
    const stamp = new Date(now()).toISOString();
    const { data: claimed, error: claimError } = await client
      .from("mentee_interview_invites")
      .update({ online_notified_at: stamp })
      .eq("id", recipient.inviteId)
      .is("online_notified_at", null)
      .select("id");
    if (claimError) {
      log("claim failed", claimError);
      return { ok: false, message: `${SAFE_ERROR} Đã gửi ${sent} thư trước khi dừng.`, sent, failed };
    }
    if (!claimed?.length) continue;

    const mail = buildOnlineNoticeEmail({
      candidateName: recipient.fullName || "bạn",
      sessionLabel: recipient.sessionLabel,
      groupUrl: recipient.groupUrl,
      manageUrl: menteeBookingUrl(origin, recipient.token),
      hotlineZalo: HOTLINE_ZALO
    });
    let outcome: { ok: boolean; skipped: boolean; reason?: string; providerStatus?: number | null };
    try {
      outcome = await sendTemplatedEmail({
        kind: "general_announcement",
        toEmail: recipient.email,
        subject: mail.subject,
        body: mail.text,
        relation: { table: "applications", id: recipient.applicationId }
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
      .update({ online_notified_at: null })
      .eq("id", recipient.inviteId)
      .eq("online_notified_at", stamp);
    if (releaseError) log("release failed", releaseError);
    if (outcome.skipped) {
      return { ok: false, message: "Môi trường này đang tắt gửi thư — chưa gửi thư nào.", sent, failed };
    }
  }

  const left = Math.max(0, pending.length - sent);
  const parts = [`Đã gửi ${sent} thư báo phỏng vấn online.`];
  if (stopped429) parts.push("Nhà cung cấp báo chạm trần thư trong ngày — bấm lại sau vài giờ.");
  if (failed > 0) parts.push(`${failed} thư lỗi, xem Vận hành → Mail → Nhật ký gửi.`);
  if (left > 0 && !stopped429) parts.push(`Còn ${left} bạn chờ thư — bấm lại để gửi tiếp.`);
  return { ok: failed === 0 && !stopped429, message: parts.join(" "), sent, failed };
}

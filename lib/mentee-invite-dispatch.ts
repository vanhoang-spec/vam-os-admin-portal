import "server-only";

import { sendMenteeSessionInvite } from "@/lib/email";
import {
  DISPATCH_STALE_CLAIM_MS,
  DISPATCH_TIME_BUDGET_MS,
  DAILY_EMAIL_LIMIT,
  DISPATCH_RESERVE,
  INVITE_AUDIENCE_STATUSES,
  type InviteDispatchSummary,
  QUOTA_WINDOW_MS,
  dispatchAllowance,
  isInviteRecipient
} from "@/lib/mentee-invite-dispatch-core";
import {
  type SessionRow,
  bookingClosesAt,
  buildSessionDays,
  hasBookableSession,
  interviewDaysLabel
} from "@/lib/mentee-interview-core";
import { requireBtc } from "@/lib/mentee-session-admin";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { getPublicOrigin } from "@/lib/public-url";
import { CURRENT_APPLICATION_SEASON_LABEL } from "@/lib/season-labels";
import { formatDate, formatTime } from "@/lib/utils";

/**
 * lib/mentee-invite-dispatch.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Gửi thư mời mentee chọn ca phỏng vấn, kèm link riêng.
 *
 * Khuôn là bộ gửi của vòng mentor (runDispatchCore trong lib/interview-schedule.ts),
 * vốn đã chạy thật: cấp mã link cho người chưa có, CLAIM nguyên tử trước khi
 * gửi để hai tab bấm cùng lúc không ai nhận hai thư, dừng ngay khi nhà cung cấp
 * báo 429, và nhả lại mọi claim chưa kịp gửi để lượt sau gửi tiếp.
 *
 * Hai chặn THÊM so với vòng mentor, đều từ quyết định 26/09/2026:
 *
 * 1. KHÔNG GỬI KHI CHƯA CÓ CA NÀO ĐẶT ĐƯỢC. Ca chưa có ghế là ca đóng. Một thư
 *    mời trỏ vào một trang toàn ca "chưa mở" dạy người nhận bỏ qua thư sau — và
 *    với 334 người thì đó là 334 cuộc gọi.
 *
 * 2. KHÔNG VƯỢT PHẦN HẠN MỨC CỦA THƯ MỜI. Xem đầu lib/mentee-invite-dispatch-core.ts:
 *    thư xác nhận ca cần chỗ trong cùng hạn mức 300 thư/ngày.
 */

type Json = Record<string, any>;

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";

function log(message: string, error?: unknown) {
  console.error(`[mentee-invite-dispatch] ${message}`, error ?? "");
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normIso(value: unknown): string {
  const at = new Date(String(value ?? ""));
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Đọc
// ─────────────────────────────────────────────────────────────────────────────

type Recipient = {
  applicationId: string;
  fullName: string;
  email: string;
};

type Audience = {
  summary: InviteDispatchSummary;
  recipients: Recipient[];
};

async function readAudience(
  client: any,
  seasonId: string
): Promise<{ ok: true; audience: Audience } | { ok: false }> {
  const apps = await readAllPages<Json>(
    "applications",
    "id,full_name,email_primary,status,source,role_applied",
    (columns) => client.from("applications").select(columns).eq("season_id", seasonId).eq("role_applied", "mentee")
  );
  if (apps.error) {
    log("applications read failed", apps.error);
    return { ok: false };
  }

  const bookings = await readAllPages<Json>("mentee_interview_bookings", "id,application_id", (columns) =>
    client.from("mentee_interview_bookings").select(columns).eq("season_id", seasonId).eq("status", "booked")
  );
  if (bookings.error) {
    log("bookings read failed", bookings.error);
    return { ok: false };
  }
  const booked = new Set(bookings.data.map((row) => String(row.application_id)));

  const inAudience = apps.data.filter((app) => INVITE_AUDIENCE_STATUSES.has(clean(app.status)));
  const invites = await readAllPagesIn<Json>(
    client,
    "mentee_interview_invites",
    "application_id",
    inAudience.map((app) => String(app.id)),
    "id,application_id,send_count,last_error"
  );
  if (invites.error) {
    log("invites read failed", invites.error);
    return { ok: false };
  }
  const inviteByApp = new Map(invites.data.map((row) => [String(row.application_id), row]));

  const summary: InviteDispatchSummary = { waiting: 0, invitedNotBooked: 0, booked: booked.size, lastFailed: 0 };
  const recipients: Recipient[] = [];

  for (const app of inAudience) {
    const id = String(app.id);
    const invite = inviteByApp.get(id);
    const sendCount = invite ? Number(invite.send_count) || 0 : null;
    const hasActiveBooking = booked.has(id);

    if (
      isInviteRecipient({
        roleApplied: app.role_applied,
        source: app.source,
        status: app.status,
        hasActiveBooking,
        sendCount
      })
    ) {
      summary.waiting += 1;
      if (invite?.last_error) summary.lastFailed += 1;
      const email = clean(app.email_primary);
      if (email) recipients.push({ applicationId: id, fullName: clean(app.full_name), email });
    } else if (!hasActiveBooking && (sendCount ?? 0) > 0) {
      summary.invitedNotBooked += 1;
    }
  }

  return { ok: true, audience: { summary, recipients } };
}

/** Số thư CẢ HỆ THỐNG đã gửi trong 24 giờ trượt — mọi loại, không riêng thư mời. */
async function countSentInWindow(client: any, nowMs: number): Promise<number | null> {
  const sinceIso = new Date(nowMs - QUOTA_WINDOW_MS).toISOString();
  const { count, error } = await client
    .from("outbound_emails")
    .select("id", { count: "exact", head: true })
    .in("status", ["sent", "queued"])
    .gte("created_at", sinceIso);
  if (error) {
    log("quota count failed", error);
    return null;
  }
  return Number(count) || 0;
}

type SessionContext = { anyBookable: boolean; deadlineLabel: string; daysLabel: string };

async function readSessionContext(client: any, seasonId: string): Promise<SessionContext | null> {
  const sessions = await readAllPages<Json>(
    "interview_sessions",
    "id,starts_at,ends_at,seat_limit,venue,booking_closes_at,status",
    (columns) => client.from("interview_sessions").select(columns).eq("season_id", seasonId)
  );
  if (sessions.error) {
    log("sessions read failed", sessions.error);
    return null;
  }

  const rows: SessionRow[] = sessions.data.map((row) => ({
    id: String(row.id),
    startsAtIso: normIso(row.starts_at),
    endsAtIso: normIso(row.ends_at),
    seatLimit: row.seat_limit === null || row.seat_limit === undefined ? null : Number(row.seat_limit),
    venue: clean(row.venue) || null,
    bookingClosesAtIso: normIso(row.booking_closes_at),
    status: String(row.status ?? "")
  }));

  // Số chỗ đã giữ không đổi câu trả lời "còn ca nào mở không" trừ khi ca kín
  // hết — mà ca kín hết thì chính là lúc không nên mời thêm ai. Nên đếm thật.
  const bookings = await readAllPages<Json>("mentee_interview_bookings", "id,session_id", (columns) =>
    client.from("mentee_interview_bookings").select(columns).eq("season_id", seasonId).eq("status", "booked")
  );
  if (bookings.error) {
    log("session bookings read failed", bookings.error);
    return null;
  }
  const taken = new Map<string, number>();
  for (const row of bookings.data) {
    const key = String(row.session_id);
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }

  const days = buildSessionDays(rows, taken, new Date().toISOString());
  const closesAt = bookingClosesAt(rows);
  return {
    anyBookable: hasBookableSession(days),
    deadlineLabel: closesAt ? `${formatTime(closesAt)} ngày ${formatDate(closesAt)}` : "",
    daysLabel: interviewDaysLabel(days)
  };
}

export type MenteeInviteStatus =
  | { ok: false; message: string }
  | {
      ok: true;
      summary: InviteDispatchSummary;
      /** Số thư cả hệ thống đã gửi trong 24 giờ qua. Null khi không đếm được. */
      sentInWindow: number | null;
      /** Lần bấm tới gửi được tối đa bao nhiêu thư mời. */
      allowance: number;
      dailyLimit: number;
      reserve: number;
      anyBookable: boolean;
      deadlineLabel: string;
      daysLabel: string;
    };

export async function getMenteeInviteStatus(): Promise<MenteeInviteStatus> {
  const access = await requireBtc();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, seasonId } = access;

  const [audience, sentInWindow, context] = await Promise.all([
    readAudience(client, seasonId),
    countSentInWindow(client, Date.now()),
    readSessionContext(client, seasonId)
  ]);
  if (!audience.ok || !context) return { ok: false, message: SAFE_ERROR };

  return {
    ok: true,
    summary: audience.audience.summary,
    sentInWindow,
    // Không đếm được thư đã gửi thì coi như đã đầy: gửi mù vào hạn mức chung
    // là đúng rủi ro mà cả cơ chế chừa hạn mức sinh ra để tránh.
    allowance: sentInWindow === null ? 0 : dispatchAllowance(sentInWindow),
    dailyLimit: DAILY_EMAIL_LIMIT,
    reserve: DISPATCH_RESERVE,
    anyBookable: context.anyBookable,
    deadlineLabel: context.deadlineLabel,
    daysLabel: context.daysLabel
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gửi
// ─────────────────────────────────────────────────────────────────────────────

export type MenteeInviteDispatchResult = {
  ok: boolean;
  message: string;
  sent: number;
  failed: number;
  stopped429: boolean;
};

function fail(message: string): MenteeInviteDispatchResult {
  return { ok: false, message, sent: 0, failed: 0, stopped429: false };
}

function done(message: string, sent = 0, failed = 0, stopped429 = false): MenteeInviteDispatchResult {
  return { ok: true, message, sent, failed, stopped429 };
}

export async function runMenteeInviteDispatch(input: { now?: () => number } = {}): Promise<MenteeInviteDispatchResult> {
  const now = input.now ?? Date.now;
  const access = await requireBtc();
  if (!access.ok) return fail(access.message);
  const { client, seasonId } = access;

  const startedMs = now();
  const nowIso = new Date(startedMs).toISOString();

  // Chặn 1 — không mời vào một lưới ca rỗng.
  const context = await readSessionContext(client, seasonId);
  if (!context) return fail(SAFE_ERROR);
  if (!context.anyBookable) {
    return fail(
      "Chưa có ca nào đặt được — ca chưa điền số ghế thì đang đóng, hoặc đã quá hạn. Không gửi thư mời vào một trang không chọn được ca nào."
    );
  }
  if (!context.deadlineLabel || !context.daysLabel) return fail(SAFE_ERROR);

  // Chặn 2 — không ăn vào phần hạn mức chừa cho thư xác nhận.
  const sentInWindow = await countSentInWindow(client, startedMs);
  if (sentInWindow === null) {
    return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi — gửi mù có thể làm thư xác nhận ca bị chặn.");
  }
  const allowance = dispatchAllowance(sentInWindow);
  if (allowance === 0) {
    return done(
      `Đã chạm phần hạn mức của thư mời: cả hệ thống đã gửi ${sentInWindow}/${DAILY_EMAIL_LIMIT} thư trong 24 giờ qua, ${DISPATCH_RESERVE} thư còn lại chừa cho thư xác nhận ca. Thử lại sau vài giờ.`
    );
  }

  const audience = await readAudience(client, seasonId);
  if (!audience.ok) return fail(SAFE_ERROR);
  const { recipients } = audience.audience;
  if (recipients.length === 0) {
    return done("Không còn ai chờ thư mời — mọi bạn đã được mời đều đã nhận thư hoặc đã chọn ca.");
  }
  const recipientById = new Map(recipients.map((row) => [row.applicationId, row]));

  // Cấp mã link cho người chưa có — ignoreDuplicates nên chạy lại vô hại, và
  // KHÔNG đổi mã của người đã có: mã cũ đang nằm trong hộp thư của họ.
  const { error: ensureError } = await client
    .from("mentee_interview_invites")
    .upsert(
      recipients.map((row) => ({ application_id: row.applicationId })),
      { onConflict: "application_id", ignoreDuplicates: true }
    );
  if (ensureError) {
    log("ensure invites failed", ensureError);
    return fail(SAFE_ERROR);
  }

  const staleIso = new Date(startedMs - DISPATCH_STALE_CLAIM_MS).toISOString();
  const { error: staleError } = await client
    .from("mentee_interview_invites")
    .update({ claimed_at: null })
    .lt("claimed_at", staleIso);
  if (staleError) log("stale release failed", staleError);

  const invites = await readAllPagesIn<Json>(
    client,
    "mentee_interview_invites",
    "application_id",
    recipients.map((row) => row.applicationId),
    "id,application_id,token,send_count,claimed_at,created_at"
  );
  if (invites.error) {
    log("invites read failed", invites.error);
    return fail(SAFE_ERROR);
  }

  const due = invites.data
    .filter((row) => !row.claimed_at && (Number(row.send_count) || 0) === 0 && row.token)
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)));
  if (due.length === 0) {
    return done("Không còn ai chờ thư mời ở lượt này — có thể một lượt gửi khác đang chạy.");
  }

  const chunk = due.slice(0, allowance);
  const claimStamp = nowIso;
  const { data: claimedRows, error: claimError } = await client
    .from("mentee_interview_invites")
    .update({ claimed_at: claimStamp })
    .in(
      "id",
      chunk.map((row) => String(row.id))
    )
    .is("claimed_at", null)
    .select("id");
  if (claimError) {
    log("claim failed", claimError);
    return fail(SAFE_ERROR);
  }
  const claimedIds = new Set((claimedRows ?? []).map((row: Json) => String(row.id)));
  const claimed = chunk.filter((row) => claimedIds.has(String(row.id)));

  const requestOrigin = await getPublicOrigin();
  let sent = 0;
  let failed = 0;
  let stopped429 = false;
  const release: string[] = [];

  for (const row of claimed) {
    const rowId = String(row.id);
    if (stopped429 || now() - startedMs > DISPATCH_TIME_BUDGET_MS) {
      release.push(rowId);
      continue;
    }
    const recipient = recipientById.get(String(row.application_id));
    if (!recipient) {
      release.push(rowId);
      continue;
    }

    let outcome: { ok: boolean; skipped: boolean; reason?: string; providerStatus?: number | null };
    try {
      outcome = await sendMenteeSessionInvite({
        toEmail: recipient.email,
        candidateName: recipient.fullName || "bạn",
        seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
        interviewDaysLabel: context.daysLabel,
        deadlineLabel: context.deadlineLabel,
        bookingToken: String(row.token),
        applicationId: recipient.applicationId,
        requestOrigin
      });
    } catch (error) {
      log("send crashed", error);
      outcome = { ok: false, skipped: false, reason: String(error) };
    }

    if (outcome.ok && !outcome.skipped) {
      sent += 1;
      const { error: doneError } = await client
        .from("mentee_interview_invites")
        .update({ send_count: 1, first_sent_at: nowIso, last_sent_at: nowIso, last_error: null, claimed_at: null })
        .eq("id", rowId)
        .eq("claimed_at", claimStamp);
      if (doneError) log("finalize failed", doneError);
    } else if (outcome.skipped) {
      // Cổng gửi thư chặn (môi trường thử): KHÔNG đốt lượt — send_count giữ
      // nguyên để bản production thật vẫn gửi cho người này.
      const { error: skipError } = await client
        .from("mentee_interview_invites")
        .update({ claimed_at: null, last_error: outcome.reason ?? "Bị chặn bởi cấu hình gửi thư" })
        .eq("id", rowId)
        .eq("claimed_at", claimStamp);
      if (skipError) log("skip release failed", skipError);
    } else {
      failed += 1;
      if (outcome.providerStatus === 429) stopped429 = true;
      const { error: failError } = await client
        .from("mentee_interview_invites")
        .update({ claimed_at: null, last_error: (outcome.reason ?? "Gửi thất bại").slice(0, 500) })
        .eq("id", rowId)
        .eq("claimed_at", claimStamp);
      if (failError) log("fail release failed", failError);
    }
  }

  if (release.length > 0) {
    const { error: releaseError } = await client
      .from("mentee_interview_invites")
      .update({ claimed_at: null })
      .in("id", release)
      .eq("claimed_at", claimStamp);
    if (releaseError) log("release failed", releaseError);
  }

  const left = Math.max(0, recipients.length - sent);
  if (stopped429) {
    return done(
      `Đã gửi ${sent} thư rồi nhà cung cấp báo chạm trần thư trong ngày. Còn ${left} bạn chờ thư mời — bấm lại sau vài giờ.`,
      sent,
      failed,
      true
    );
  }
  const parts = [`Đã gửi ${sent} thư mời chọn ca.`];
  if (failed > 0) parts.push(`${failed} thư lỗi, xem Vận hành → Mail → Nhật ký gửi.`);
  if (left > 0) parts.push(`Còn ${left} bạn chờ thư mời — bấm lại để gửi tiếp.`);
  return done(parts.join(" "), sent, failed, false);
}

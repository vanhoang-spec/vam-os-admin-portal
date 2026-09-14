import "server-only";

/**
 * lib/event-reminders.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * "Gửi remind": thư nhắc lịch một buổi, gửi tới mọi người đang giữ chỗ.
 *
 * ---------------------------------------------------------------------------
 * MỘT LƯỢT GỬI CHẠY QUA NHIỀU LẦN GỌI
 * ---------------------------------------------------------------------------
 *   startEventReminder     kiểm quyền, kiểm ngày nhập lại, CHỐT danh sách người
 *                          nhận vào event_reminder_recipients (trạng thái queued).
 *   continueEventReminder  mỗi lần gửi tối đa REMINDER_CHUNK thư. Màn hình gọi lặp
 *                          lại tới khi hết.
 *   retryFailedEventReminder / cancelEventReminder — gửi lại người lỗi, dừng lượt.
 *
 * ---------------------------------------------------------------------------
 * KHÔNG AI NHẬN HAI THƯ
 * ---------------------------------------------------------------------------
 * Một thư chỉ đi sau khi dòng của người đó được CHIẾM: `update ... set status =
 * 'sending' where id in (...) and status = 'queued'`, và chỉ những dòng lệnh ghi
 * đó trả về mới được gửi. Hai tab chạy cùng một lượt chiếm hai phần rời nhau.
 * Một dòng kẹt ở 'sending' quá lâu (lần gọi đã chết) được chốt thành LỖI, không
 * đưa lại hàng đợi — không biết thư đã đi hay chưa, nên không tự gửi lại.
 *
 * ---------------------------------------------------------------------------
 * THÔNG TIN MỚI NHẤT
 * ---------------------------------------------------------------------------
 * Buổi và dòng đăng ký được đọc lại ở MỖI lần gọi, ngay trước khi gửi. Ban tổ
 * chức sửa phòng giữa lúc đang gửi thì những thư sau mang phòng mới; một người
 * huỷ đăng ký giữa chừng thì không nhận thư.
 */

import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { readAllPages } from "@/lib/paged-read";
import { isValidUuid, renderTicketQrBase64, requireEventAdmin } from "@/lib/events";
import { ensureCheckinCode } from "@/lib/event-checkin";
import { checkinCodeUrl, usesQrCheckin } from "@/lib/event-checkin-code";
import { eventEmailPlace } from "@/lib/event-location";
import { evaluateEmailGate } from "@/lib/email-core";
import { resolveEmailBaseUrl, sendEventReminder } from "@/lib/email";
import { getPublicOrigin } from "@/lib/public-url";
import { formatTimeRange } from "@/lib/utils";
import {
  EMPTY_REMINDER_COUNTS,
  REMINDER_CHUNK,
  REMINDER_STALE_SENDING_MS,
  REMINDER_TIME_BUDGET_MS,
  checkReminderDate,
  countReminderStates,
  describeReminderCounts,
  isReminderRecipient,
  reminderBlockReason,
  reminderRemaining,
  reminderTotal,
  type ReminderChunk,
  type ReminderCounts,
  type ReminderProgress,
  type ReminderRunState,
  type ReminderRunSummary
} from "@/lib/event-reminder-core";

type Json = Record<string, any>;

const SAFE_ERROR = "Không thực hiện được. Vui lòng thử lại; nếu lỗi lặp lại, xem server logs.";
const NO_PERMISSION = "Bạn không có quyền vận hành trong mùa của sự kiện này.";
const RUN_ALREADY_RUNNING =
  "Buổi này đang có một lượt remind chưa gửi xong. Bấm “Gửi tiếp” để gửi phần còn lại, hoặc dừng lượt đó trước.";
const STALE_SENDING_ERROR = "Lần gửi bị ngắt giữa chừng — không xác nhận được thư đã đi hay chưa.";
const NOT_HOLDING_SEAT = "Không còn giữ chỗ lúc gửi (đã huỷ, bị từ chối, vào danh sách chờ hoặc đã check-in).";
const STOPPED_ERROR = "Đã dừng lượt gửi.";
const RECIPIENT_INSERT_CHUNK = 500;

function log(message: string, error?: unknown) {
  const err = error as { code?: string; message?: string } | undefined;
  console.error(`[event-reminders] ${message}`, err ? { code: err.code ?? null, message: err.message ?? String(error) } : "");
}

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function serviceClient(): any | null {
  try {
    return getSupabaseServiceRoleClient();
  } catch (error) {
    log("service client unavailable", error);
    return null;
  }
}

function fail(message: string): ReminderProgress {
  return { ok: false, message };
}

async function writeAudit(client: any, input: { actorId: string | null; actionType: string; afterData: Json }) {
  try {
    const { error } = await client.from("admin_audit_log").insert({
      actor_admin_user_id: input.actorId,
      action_type: input.actionType,
      target_admin_user_id: null,
      before_data: null,
      after_data: input.afterData
    });
    if (error) log(`admin_audit_log insert failed (${input.actionType})`, error);
  } catch (error) {
    log("admin audit crashed", error);
  }
}

async function readRunCounts(client: any, runId: string): Promise<{ counts: ReminderCounts; error: unknown }> {
  const { data, error } = await readAllPages<Json>("event_reminder_recipients", "id,status", (projection) =>
    client.from("event_reminder_recipients").select(projection).eq("run_id", runId)
  );
  if (error) return { counts: { ...EMPTY_REMINDER_COUNTS }, error };
  return { counts: countReminderStates(data), error: null };
}

async function loadAuthorizedEvent(
  client: any,
  eventId: string
): Promise<{ ok: true; event: Json } | { ok: false; message: string }> {
  const { data: event, error } = await client.from("events").select("*").eq("id", eventId).maybeSingle();
  if (error) {
    log("load event failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!event) return { ok: false, message: "Không tìm thấy buổi này." };

  const scope = await getAdminScopeContext();
  if (!(await canOperateSeason(scope, clean(event.season_id)))) return { ok: false, message: NO_PERMISSION };
  return { ok: true, event };
}

async function loadAuthorizedRun(
  client: any,
  runId: string
): Promise<{ ok: true; run: Json; event: Json } | { ok: false; message: string }> {
  const { data: run, error } = await client
    .from("event_reminder_runs")
    .select("id,event_id,status,recipient_count")
    .eq("id", runId)
    .maybeSingle();
  if (error) {
    log("load run failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!run) return { ok: false, message: "Không tìm thấy lượt remind này." };

  const loaded = await loadAuthorizedEvent(client, String(run.event_id));
  if (!loaded.ok) return loaded;
  return { ok: true, run, event: loaded.event };
}

function emailGateMessage(): string | null {
  const gate = evaluateEmailGate(process.env);
  return gate.canSend ? null : `Chưa gửi gì: môi trường này đang tắt gửi thư (${gate.reason}).`;
}

/**
 * Bắt đầu một lượt remind cho một buổi.
 *
 * Mọi phép kiểm chạy TRƯỚC khi ghi dòng nào: ngày nhập lại sai, buổi đã huỷ hay
 * đã bắt đầu, cổng thư đang tắt, không có ai giữ chỗ — đều trả lời mà không để
 * lại một lượt rỗng.
 */
export async function startEventReminder(input: { eventId: unknown; typedDate: unknown }): Promise<ReminderProgress> {
  const access = await requireEventAdmin();
  if (!access.ok) return fail(access.message);

  const eventId = clean(input.eventId);
  if (!eventId || !isValidUuid(eventId)) return fail("ID buổi không hợp lệ.");

  const client = serviceClient();
  if (!client) return fail(SAFE_ERROR);

  const loaded = await loadAuthorizedEvent(client, eventId);
  if (!loaded.ok) return fail(loaded.message);
  const event = loaded.event;

  const blocked = reminderBlockReason(event, Date.now());
  if (blocked) return fail(blocked);

  // Kiểm lại ở máy chủ: màn hình đã so ngày, nhưng cái đến từ biểu mẫu là thứ
  // người gửi tự đặt được.
  const date = checkReminderDate(input.typedDate, event.starts_at);
  if (!date.ok) return fail(date.message);

  const gateMessage = emailGateMessage();
  if (gateMessage) return fail(gateMessage);

  const { data: registrations, error: registrationsError } = await readAllPages<Json>(
    "event_registrations",
    "id,email,registration_status,attendance_status",
    (projection) => client.from("event_registrations").select(projection).eq("event_id", eventId)
  );
  if (registrationsError) {
    log("load registrations failed", registrationsError);
    return fail(SAFE_ERROR);
  }

  const recipients = registrations.filter(isReminderRecipient);
  if (!recipients.length) return fail("Buổi này chưa có ai đang giữ chỗ để gửi remind.");

  const { data: run, error: runError } = await client
    .from("event_reminder_runs")
    .insert({
      event_id: eventId,
      created_by: access.admin?.id ?? null,
      confirmed_event_date: date.isoDate,
      status: "running",
      recipient_count: recipients.length
    })
    .select("id")
    .maybeSingle();

  if (runError) {
    if ((runError as { code?: string }).code === "23505") return fail(RUN_ALREADY_RUNNING);
    log("insert run failed", runError);
    return fail(SAFE_ERROR);
  }
  if (!run?.id) return fail(SAFE_ERROR);
  const runId = String(run.id);

  for (let start = 0; start < recipients.length; start += RECIPIENT_INSERT_CHUNK) {
    const rows = recipients.slice(start, start + RECIPIENT_INSERT_CHUNK).map((row) => ({
      run_id: runId,
      registration_id: String(row.id),
      status: "queued"
    }));
    const { error: insertError } = await client.from("event_reminder_recipients").insert(rows);
    if (insertError) {
      log("insert recipients failed", insertError);
      // Danh sách lập dở thì không gửi từ nó: dừng lượt để một lượt mới lập lại
      // được từ đầu, và không để phần đã chèn nằm chờ trong hàng đợi.
      await client
        .from("event_reminder_recipients")
        .update({ status: "skipped", error: "Không lập đủ danh sách người nhận." })
        .eq("run_id", runId)
        .eq("status", "queued");
      await client
        .from("event_reminder_runs")
        .update({ status: "cancelled", finished_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("status", "running");
      return fail("Chưa gửi thư nào: không lập được danh sách người nhận. Vui lòng thử lại.");
    }
  }

  await writeAudit(client, {
    actorId: access.admin?.id ?? null,
    actionType: "send_event_reminder",
    afterData: {
      run_id: runId,
      event_id: eventId,
      recipient_count: recipients.length,
      confirmed_event_date: date.isoDate
    }
  });

  const counts: ReminderCounts = { ...EMPTY_REMINDER_COUNTS, queued: recipients.length };
  return {
    ok: true,
    message: `Đã lập danh sách ${recipients.length} người nhận. Đang gửi…`,
    runId,
    counts,
    total: recipients.length,
    done: false
  };
}

type SendContext = {
  eventName: string;
  whenLabel: string;
  placeLabel: string | null;
  mapUrl: string | null;
  joinUrl: string | null;
  description: string | null;
  qrCheckin: boolean;
  origin: string;
};

async function sendReminderTo(
  registration: Json,
  context: SendContext
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const toEmail = clean(registration.email);
  if (!toEmail) return { ok: false, reason: "Thiếu email." };

  let ticketUrl: string | null = null;
  let ticketCode: string | null = null;
  let shortCode = clean(registration.short_code);
  let qrPngBase64: string | null = null;

  try {
    if (context.qrCheckin) {
      ticketCode = clean(registration.checkin_code);
      // Người đăng ký trước khi có vé QR thì cấp vé ngay lúc nhắc: thư này là lá
      // họ mang tới cửa. Cấp một lần, không bao giờ đổi mã đã có.
      if (!ticketCode) {
        const issued = await ensureCheckinCode(String(registration.id));
        ticketCode = issued.code;
        shortCode = issued.shortCode ?? shortCode;
      }
      if (ticketCode && context.origin) {
        ticketUrl = checkinCodeUrl(context.origin, ticketCode);
        qrPngBase64 = await renderTicketQrBase64(ticketUrl);
      }
    }

    const result = await sendEventReminder({
      toEmail,
      recipientName: String(registration.full_name ?? "").trim(),
      eventName: context.eventName,
      whenLabel: context.whenLabel,
      placeLabel: context.placeLabel,
      mapUrl: context.mapUrl,
      joinUrl: context.joinUrl,
      description: context.description,
      qrCheckin: context.qrCheckin,
      ticketUrl,
      ticketCode: ticketUrl ? ticketCode : null,
      shortCode: ticketUrl ? shortCode : null,
      qrPngBase64,
      pendingApproval: clean(registration.registration_status) === "pending_review",
      registrationId: String(registration.id)
    });

    if (!result.ok) return { ok: false, reason: result.reason ?? "Nhà cung cấp thư từ chối." };
    // Cổng thư chặn KHÔNG phải là đã gửi. Tính nó là "đã gửi" là báo cho ban tổ
    // chức rằng mọi người đã được nhắc trong khi không ai nhận được gì.
    if (result.skipped) return { ok: false, reason: `Không gửi: ${result.reason ?? "cổng thư đang tắt"}.` };
    return { ok: true };
  } catch (error) {
    log("send reminder threw", error);
    return { ok: false, reason: "Lỗi khi gửi thư." };
  }
}

async function markRecipient(client: any, recipientId: string, status: "sent" | "failed" | "skipped", error: string | null) {
  const { error: markError } = await client
    .from("event_reminder_recipients")
    .update({ status, error: error ? error.slice(0, 500) : null })
    .eq("id", recipientId)
    .eq("status", "sending");
  if (markError) log(`mark ${status} failed`, markError);
}

/**
 * Gửi tiếp tối đa REMINDER_CHUNK thư của một lượt đang chạy.
 */
export async function continueEventReminder(input: { runId: unknown }): Promise<ReminderProgress> {
  const access = await requireEventAdmin();
  if (!access.ok) return fail(access.message);

  const runId = clean(input.runId);
  if (!runId || !isValidUuid(runId)) return fail("Lượt remind không hợp lệ.");

  const client = serviceClient();
  if (!client) return fail(SAFE_ERROR);

  const loaded = await loadAuthorizedRun(client, runId);
  if (!loaded.ok) return fail(loaded.message);
  const { run, event } = loaded;

  if (String(run.status) !== "running") {
    const { counts } = await readRunCounts(client, runId);
    return {
      ok: true,
      message: `Lượt remind này đã kết thúc. ${describeReminderCounts(counts)}`,
      runId,
      counts,
      total: reminderTotal(counts),
      done: true,
      chunk: { sent: 0, failed: 0, skipped: 0, released: 0 }
    };
  }

  const blocked = reminderBlockReason(event, Date.now());
  if (blocked) return fail(`${blocked} Chưa gửi thêm thư nào.`);

  const startedMs = Date.now();

  // Dòng kẹt ở "đang gửi" của một lần gọi đã chết: chốt thành lỗi, không gửi lại.
  const { error: staleError } = await client
    .from("event_reminder_recipients")
    .update({ status: "failed", error: STALE_SENDING_ERROR })
    .eq("run_id", runId)
    .eq("status", "sending")
    .lt("attempted_at", new Date(startedMs - REMINDER_STALE_SENDING_MS).toISOString());
  if (staleError) log("expire stale sending failed", staleError);

  const { data: queued, error: queuedError } = await client
    .from("event_reminder_recipients")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "queued")
    .order("id", { ascending: true })
    .limit(REMINDER_CHUNK);
  if (queuedError) {
    log("load queued failed", queuedError);
    return fail(SAFE_ERROR);
  }

  const chunk: ReminderChunk = { sent: 0, failed: 0, skipped: 0, released: 0 };
  const queuedIds = ((queued ?? []) as Json[]).map((row) => String(row.id));

  if (queuedIds.length) {
    const { data: claimed, error: claimError } = await client
      .from("event_reminder_recipients")
      .update({ status: "sending", attempted_at: new Date(startedMs).toISOString(), error: null })
      .in("id", queuedIds)
      .eq("status", "queued")
      .select("id,registration_id");
    if (claimError) {
      log("claim failed", claimError);
      return fail(SAFE_ERROR);
    }

    const claimedRows = (claimed ?? []) as Json[];
    if (claimedRows.length) {
      const { data: registrations, error: registrationsError } = await client
        .from("event_registrations")
        .select("id,event_id,full_name,email,registration_status,attendance_status,checkin_code,short_code")
        .in(
          "id",
          claimedRows.map((row) => String(row.registration_id))
        );

      if (registrationsError) {
        log("load claimed registrations failed", registrationsError);
        await client
          .from("event_reminder_recipients")
          .update({ status: "queued", attempted_at: null })
          .in("id", claimedRows.map((row) => String(row.id)))
          .eq("status", "sending");
        return fail(SAFE_ERROR);
      }

      const byId = new Map(((registrations ?? []) as Json[]).map((row) => [String(row.id), row]));
      const place = eventEmailPlace(event);
      const qrCheckin = usesQrCheckin(event);
      const context: SendContext = {
        eventName: String(event.event_name ?? "").trim() || "sự kiện",
        whenLabel: formatTimeRange(event.starts_at, event.ends_at),
        placeLabel: place.placeLabel,
        mapUrl: place.mapUrl,
        joinUrl: place.joinUrl,
        description: clean(event.event_description),
        qrCheckin,
        origin: qrCheckin ? resolveEmailBaseUrl(await getPublicOrigin()) : ""
      };

      const release: string[] = [];
      for (const row of claimedRows) {
        const recipientId = String(row.id);
        if (Date.now() - startedMs > REMINDER_TIME_BUDGET_MS) {
          release.push(recipientId);
          continue;
        }

        const registration = byId.get(String(row.registration_id));
        if (
          !registration ||
          String(registration.event_id) !== String(run.event_id) ||
          !isReminderRecipient(registration)
        ) {
          await markRecipient(client, recipientId, "skipped", NOT_HOLDING_SEAT);
          chunk.skipped += 1;
          continue;
        }

        const outcome = await sendReminderTo(registration, context);
        if (outcome.ok) {
          await markRecipient(client, recipientId, "sent", null);
          chunk.sent += 1;
        } else {
          await markRecipient(client, recipientId, "failed", outcome.reason);
          chunk.failed += 1;
        }
      }

      if (release.length) {
        const { error: releaseError } = await client
          .from("event_reminder_recipients")
          .update({ status: "queued", attempted_at: null })
          .in("id", release)
          .eq("status", "sending");
        if (releaseError) log("release unsent failed", releaseError);
        chunk.released = release.length;
      }
    }
  }

  const { counts, error: countError } = await readRunCounts(client, runId);
  if (countError) {
    log("read counts failed", countError);
    return fail(
      `Đã gửi ${chunk.sent} thư trong lần này nhưng không đọc lại được tiến độ. Tải lại trang rồi bấm “Gửi tiếp” — không ai nhận hai lần.`
    );
  }

  const remaining = reminderRemaining(counts);
  if (remaining === 0) {
    const { error: finishError } = await client
      .from("event_reminder_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "running");
    if (finishError) log("finish run failed", finishError);
    return {
      ok: true,
      message: `Đã gửi xong. ${describeReminderCounts(counts)}`,
      runId,
      counts,
      total: reminderTotal(counts),
      done: true,
      chunk
    };
  }

  const busyElsewhere = !queuedIds.length && counts.queued === 0 && counts.sending > 0;
  return {
    ok: true,
    message: busyElsewhere
      ? "Một lần gửi khác đang xử lý các thư còn lại. Tải lại trang sau ít phút để xem kết quả."
      : describeReminderCounts(counts),
    runId,
    counts,
    total: reminderTotal(counts),
    done: false,
    chunk
  };
}

/** Đưa những người bị lỗi của một lượt trở lại hàng đợi. */
export async function retryFailedEventReminder(input: { runId: unknown }): Promise<ReminderProgress> {
  const access = await requireEventAdmin();
  if (!access.ok) return fail(access.message);

  const runId = clean(input.runId);
  if (!runId || !isValidUuid(runId)) return fail("Lượt remind không hợp lệ.");

  const client = serviceClient();
  if (!client) return fail(SAFE_ERROR);

  const loaded = await loadAuthorizedRun(client, runId);
  if (!loaded.ok) return fail(loaded.message);
  const { run, event } = loaded;
  const runStatus = String(run.status) as ReminderRunState;

  if (runStatus === "cancelled") return fail("Lượt remind này đã dừng — không gửi lại từ một lượt đã dừng.");

  const blocked = reminderBlockReason(event, Date.now());
  if (blocked) return fail(blocked);

  const gateMessage = emailGateMessage();
  if (gateMessage) return fail(gateMessage);

  const { counts: before, error: countError } = await readRunCounts(client, runId);
  if (countError) {
    log("read counts failed", countError);
    return fail(SAFE_ERROR);
  }
  if (!before.failed) return fail("Lượt này không có thư lỗi nào để gửi lại.");

  if (runStatus !== "running") {
    const { error: reopenError } = await client
      .from("event_reminder_runs")
      .update({ status: "running", finished_at: null })
      .eq("id", runId)
      .eq("status", runStatus);
    if (reopenError) {
      if ((reopenError as { code?: string }).code === "23505") return fail(RUN_ALREADY_RUNNING);
      log("reopen run failed", reopenError);
      return fail(SAFE_ERROR);
    }
  }

  const { error: resetError } = await client
    .from("event_reminder_recipients")
    .update({ status: "queued", error: null, attempted_at: null })
    .eq("run_id", runId)
    .eq("status", "failed");
  if (resetError) {
    log("reset failed recipients failed", resetError);
    return fail(SAFE_ERROR);
  }

  await writeAudit(client, {
    actorId: access.admin?.id ?? null,
    actionType: "retry_event_reminder",
    afterData: { run_id: runId, event_id: String(run.event_id), retried: before.failed }
  });

  const counts: ReminderCounts = { ...before, queued: before.queued + before.failed, failed: 0 };
  return {
    ok: true,
    message: `Đang gửi lại cho ${before.failed} người bị lỗi…`,
    runId,
    counts,
    total: reminderTotal(counts),
    done: false
  };
}

/** Dừng một lượt đang chạy: người chưa gửi được đánh dấu bỏ qua. */
export async function cancelEventReminder(input: { runId: unknown }): Promise<ReminderProgress> {
  const access = await requireEventAdmin();
  if (!access.ok) return fail(access.message);

  const runId = clean(input.runId);
  if (!runId || !isValidUuid(runId)) return fail("Lượt remind không hợp lệ.");

  const client = serviceClient();
  if (!client) return fail(SAFE_ERROR);

  const loaded = await loadAuthorizedRun(client, runId);
  if (!loaded.ok) return fail(loaded.message);
  const { run } = loaded;

  if (String(run.status) === "running") {
    const { error: skipError } = await client
      .from("event_reminder_recipients")
      .update({ status: "skipped", error: STOPPED_ERROR })
      .eq("run_id", runId)
      .eq("status", "queued");
    if (skipError) {
      log("skip queued failed", skipError);
      return fail(SAFE_ERROR);
    }

    const { error: stopError } = await client
      .from("event_reminder_runs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "running");
    if (stopError) {
      log("stop run failed", stopError);
      return fail(SAFE_ERROR);
    }

    await writeAudit(client, {
      actorId: access.admin?.id ?? null,
      actionType: "cancel_event_reminder",
      afterData: { run_id: runId, event_id: String(run.event_id) }
    });
  }

  const { counts } = await readRunCounts(client, runId);
  return {
    ok: true,
    message: `Đã dừng lượt remind. ${describeReminderCounts(counts)}`,
    runId,
    counts,
    total: reminderTotal(counts),
    done: true
  };
}

/**
 * Lượt remind gần nhất của một buổi, cho trang sự kiện.
 *
 * Không tự kiểm quyền: chỉ trang chi tiết sự kiện gọi hàm này, SAU cổng quyền
 * của trang. Không đọc được thì trả lỗi để trang nói ra, không trả "chưa gửi
 * lần nào" — câu đó sai sẽ khiến người ta bấm gửi lần thứ hai.
 */
export async function getLatestEventReminder(
  eventId: string
): Promise<{ run: ReminderRunSummary | null; error: string | null }> {
  if (!isValidUuid(eventId)) return { run: null, error: null };
  const client = serviceClient();
  if (!client) return { run: null, error: SAFE_ERROR };

  const unreadable = "Không đọc được lịch sử gửi remind của buổi này.";

  const { data, error } = await client
    .from("event_reminder_runs")
    .select("id,status,created_at,created_by,confirmed_event_date,recipient_count")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    log("load latest run failed", error);
    return { run: null, error: unreadable };
  }

  const row = ((data ?? []) as Json[])[0];
  if (!row) return { run: null, error: null };

  const { counts, error: countError } = await readRunCounts(client, String(row.id));
  if (countError) {
    log("read latest counts failed", countError);
    return { run: null, error: unreadable };
  }

  let createdByName: string | null = null;
  if (row.created_by) {
    const { data: admin } = await client
      .from("admin_users")
      .select("full_name,email")
      .eq("id", String(row.created_by))
      .maybeSingle();
    createdByName = clean(admin?.full_name) ?? clean(admin?.email);
  }

  return {
    run: {
      id: String(row.id),
      status: String(row.status) as ReminderRunState,
      createdAt: clean(row.created_at),
      createdByName,
      confirmedDate: clean(row.confirmed_event_date),
      total: reminderTotal(counts),
      counts
    },
    error: null
  };
}

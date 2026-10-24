import "server-only";

/**
 * Ghép cặp Vòng 2 — gửi link chọn mentee cho mentor còn chỗ (BTC 07/10/2026).
 *
 * Khuôn là bộ gửi thư mời chọn ca (lib/mentee-invite-dispatch.ts), vốn đã chạy thật:
 * cấp link cho người chưa có, CLAIM nguyên tử trước khi gửi để hai tab bấm cùng lúc
 * không ai nhận hai thư, dừng ngay khi nhà cung cấp báo 429, nhả mọi claim chưa gửi.
 * Dùng chung trần thư 24 giờ (DAILY_EMAIL_LIMIT) và phần chừa 80 thư cho các thư khác của hệ thống.
 *
 * Gửi được khi đã đặt giờ mở và vòng chưa đóng, kể cả khi giờ mở còn ở tương lai (BTC
 * 14/10/2026): gửi hết thư trước giờ mở để mọi mentor bắt đầu cùng một lúc; thư ghi giờ mở.
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendMatchingRound2Invite, sendMatchingRound2Reminder } from "@/lib/email";
import {
  ROUND2_REMINDER_COOLDOWN_MS,
  isRound2Recipient,
  isRound2ReminderRecipient,
  round2DeadlineLabel,
  round2DispatchBlocked,
  round2OpensLabel,
  round2ReminderBlocked,
  round2WaveNote
} from "@/lib/matching-round2-dispatch-core";
import type { Round2Board, Round2Row } from "@/lib/matching-round2-core";
import { mentorPoolLabel } from "@/lib/matching-round2-pools-core";
import { windowState, type WindowState } from "@/lib/matching-round2-link-core";
import { loadRound2Board, round2Operator, round2SeasonContext } from "@/lib/matching-round2";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import {
  DAILY_EMAIL_LIMIT,
  DISPATCH_RESERVE,
  DISPATCH_STALE_CLAIM_MS,
  DISPATCH_TIME_BUDGET_MS,
  dispatchAllowance
} from "@/lib/mentee-invite-dispatch-core";
import { readAllPages } from "@/lib/paged-read";
import { getPublicOrigin } from "@/lib/public-url";
import { CURRENT_APPLICATION_SEASON_LABEL } from "@/lib/season-labels";

type Row = Record<string, any>;
const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";

export type Round2SendResult = { ok: boolean; message: string; sent: number; failed: number };

export type Round2DispatchStatus = {
  window: WindowState;
  opensAt: string | null;
  closesAt: string | null;
  wave: number;
  /** Mentor còn chỗ, có email, chưa nhận thư của đợt hiện hành. */
  pending: number;
  /** Mentor đã nhận thư của đợt hiện hành. */
  sentThisWave: number;
  sentInWindow: number | null;
  allowance: number;
};

function log(message: string, error?: unknown) {
  console.error(`[round2-dispatch] ${message}`, error ?? "");
}

async function readSettings(client: any, seasonId: string) {
  const { data, error } = await client
    .from("matching_round2_settings")
    .select("opens_at,closes_at,current_send_wave")
    .eq("season_id", seasonId)
    .maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

async function readLinks(client: any, seasonId: string) {
  const links = await readAllPages<Row>(
    "matching_round2_links",
    "id,mentor_person_id,token,last_sent_wave,send_count,first_sent_at,claimed_at,revoked_at,created_at",
    (columns) => client.from("matching_round2_links").select(columns).eq("season_id", seasonId)
  );
  if (links.error) throw links.error;
  return new Map(links.data.map((l) => [String(l.mentor_person_id), l]));
}

export async function getRound2DispatchStatus(nowMs = Date.now()): Promise<Round2DispatchStatus | null> {
  try {
    const { client, seasonId } = await round2SeasonContext();
    const [settings, board, links, sentInWindow] = await Promise.all([
      readSettings(client, seasonId),
      loadRound2Board(client, seasonId),
      readLinks(client, seasonId),
      countSentInWindow(client, nowMs)
    ]);
    const wave = Number(settings?.current_send_wave ?? 1);
    let pending = 0;
    let sentThisWave = 0;
    for (const row of board.rows) {
      if (row.person.role !== "mentor") continue;
      const link = links.get(row.person.personId);
      const last = Number(link?.last_sent_wave ?? 0);
      if (last >= wave) sentThisWave += 1;
      // Link đã thu hồi không bao giờ được gửi: đếm vào "chờ thư" là con số không bao giờ về 0.
      else if (!link?.revoked_at && isRound2Recipient(row, last, wave)) pending += 1;
    }
    return {
      window: windowState(settings ? { opensAt: settings.opens_at, closesAt: settings.closes_at } : null, nowMs),
      opensAt: settings?.opens_at ?? null,
      closesAt: settings?.closes_at ?? null,
      wave,
      pending,
      sentThisWave,
      sentInWindow,
      allowance: sentInWindow === null ? 0 : dispatchAllowance(sentInWindow)
    };
  } catch (error) {
    log("status failed", error);
    return null;
  }
}

export async function runRound2Dispatch(input: { now?: () => number } = {}): Promise<Round2SendResult> {
  const now = input.now ?? Date.now;
  const fail = (message: string): Round2SendResult => ({ ok: false, message, sent: 0, failed: 0 });
  try {
    const { client, seasonId } = await round2SeasonContext();
    if (!(await round2Operator(seasonId))) return fail("Bạn không có quyền vận hành ghép cặp mùa này.");
    const startedMs = now();
    const nowIso = new Date(startedMs).toISOString();

    const settings = await readSettings(client, seasonId);
    const blocked = round2DispatchBlocked(settings ? { opensAt: settings.opens_at, closesAt: settings.closes_at } : null, startedMs);
    if (blocked) return fail(blocked);
    const wave = Number(settings?.current_send_wave ?? 1);

    const sentInWindow = await countSentInWindow(client, startedMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    const allowance = dispatchAllowance(sentInWindow);
    if (allowance === 0) {
      return {
        ok: true,
        message: `Đã chạm phần hạn mức: cả hệ thống đã gửi ${sentInWindow}/${DAILY_EMAIL_LIMIT} thư trong 24 giờ qua, ${DISPATCH_RESERVE} thư chừa cho các thư khác. Thử lại sau vài giờ.`,
        sent: 0,
        failed: 0
      };
    }

    const [board, linksBefore] = await Promise.all([loadRound2Board(client, seasonId), readLinks(client, seasonId)]);
    const recipients = board.rows.filter((row) => {
      const link = linksBefore.get(row.person.personId);
      return !link?.revoked_at && isRound2Recipient(row, Number(link?.last_sent_wave ?? 0), wave);
    });
    if (!recipients.length) return { ok: true, message: `Không còn mentor nào chờ thư của đợt ${wave}.`, sent: 0, failed: 0 };
    const byPerson = new Map(recipients.map((r) => [r.person.personId, r]));

    // Cấp link cho người chưa có — ignoreDuplicates: không bao giờ đổi link đã nằm trong hộp thư.
    const { error: ensureError } = await client
      .from("matching_round2_links")
      .upsert(
        recipients.map((r) => ({ season_id: seasonId, mentor_person_id: r.person.personId })),
        { onConflict: "season_id,mentor_person_id", ignoreDuplicates: true }
      );
    if (ensureError) {
      log("ensure links failed", ensureError);
      return fail(SAFE_ERROR);
    }
    const staleIso = new Date(startedMs - DISPATCH_STALE_CLAIM_MS).toISOString();
    const { error: staleError } = await client
      .from("matching_round2_links")
      .update({ claimed_at: null })
      .eq("season_id", seasonId)
      .lt("claimed_at", staleIso);
    if (staleError) log("stale release failed", staleError);

    const links = await readLinks(client, seasonId);
    const due = recipients
      .map((r) => links.get(r.person.personId))
      .filter((l): l is Row => Boolean(l) && !l!.claimed_at && !l!.revoked_at && Number(l!.last_sent_wave ?? 0) < wave && Boolean(l!.token))
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)));
    if (!due.length) return { ok: true, message: "Không còn ai chờ thư ở lượt này — có thể một lượt gửi khác đang chạy.", sent: 0, failed: 0 };

    const chunk = due.slice(0, allowance);
    const claimStamp = nowIso;
    const { data: claimedRows, error: claimError } = await client
      .from("matching_round2_links")
      .update({ claimed_at: claimStamp })
      .in("id", chunk.map((l) => String(l.id)))
      .is("claimed_at", null)
      .select("id");
    if (claimError) {
      log("claim failed", claimError);
      return fail(SAFE_ERROR);
    }
    const claimedIds = new Set(((claimedRows ?? []) as Row[]).map((r) => String(r.id)));
    const claimed = chunk.filter((l) => claimedIds.has(String(l.id)));

    const requestOrigin = await getPublicOrigin();
    const deadlineLabel = round2DeadlineLabel(settings?.closes_at ?? null);
    const opensLabel = round2OpensLabel(settings?.opens_at ?? null);
    const waveNote = round2WaveNote(wave);
    let sent = 0;
    let failed = 0;
    let stopped429 = false;
    const release: string[] = [];

    for (const link of claimed) {
      const id = String(link.id);
      const row = byPerson.get(String(link.mentor_person_id));
      if (stopped429 || now() - startedMs > DISPATCH_TIME_BUDGET_MS || !row) {
        release.push(id);
        continue;
      }
      let outcome: { ok: boolean; skipped: boolean; reason?: string; providerStatus?: number | null };
      try {
        outcome = await sendMatchingRound2Invite({
          toEmail: row.person.email!,
          mentorName: row.person.name,
          seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
          groupLabel: row.group === null ? "" : mentorPoolLabel(board.poolMap, row.group),
          slots: row.slots ?? 0,
          opensLabel,
          deadlineLabel,
          waveNote,
          token: String(link.token),
          linkId: id,
          requestOrigin
        });
      } catch (error) {
        log("send crashed", error);
        outcome = { ok: false, skipped: false, reason: String(error) };
      }
      if (outcome.ok && !outcome.skipped) {
        sent += 1;
        const { error } = await client
          .from("matching_round2_links")
          .update({
            last_sent_wave: wave,
            send_count: (Number(link.send_count) || 0) + 1,
            first_sent_at: link.first_sent_at ?? nowIso,
            last_sent_at: nowIso,
            last_error: null,
            claimed_at: null
          })
          .eq("id", id)
          .eq("claimed_at", claimStamp);
        if (error) log("finalize failed", error);
      } else {
        // Bị cổng gửi thư chặn (môi trường thử) thì KHÔNG đốt lượt; lỗi thật thì ghi lại.
        if (!outcome.skipped) failed += 1;
        if (outcome.providerStatus === 429) stopped429 = true;
        const { error } = await client
          .from("matching_round2_links")
          .update({ claimed_at: null, last_error: (outcome.reason ?? "Gửi thất bại").slice(0, 500) })
          .eq("id", id)
          .eq("claimed_at", claimStamp);
        if (error) log("release failed", error);
      }
    }
    if (release.length) {
      const { error } = await client.from("matching_round2_links").update({ claimed_at: null }).in("id", release).eq("claimed_at", claimStamp);
      if (error) log("release leftovers failed", error);
    }
    const left = Math.max(0, recipients.length - sent);
    if (stopped429) {
      return { ok: true, message: `Đã gửi ${sent} thư rồi nhà cung cấp báo chạm trần. Còn ${left} mentor chờ thư — bấm lại sau vài giờ.`, sent, failed };
    }
    const parts = [`Đã gửi ${sent} thư mời chọn mentee (đợt ${wave}).`];
    if (failed) parts.push(`${failed} thư lỗi, xem Vận hành → Mail → Nhật ký gửi.`);
    if (left) parts.push(`Còn ${left} mentor chờ thư — bấm lại để gửi tiếp.`);
    return { ok: true, message: parts.join(" "), sent, failed };
  } catch (error) {
    log("dispatch failed", error);
    return fail(SAFE_ERROR);
  }
}

/** Gửi thử cho chính BTC đang bấm: đường dẫn là câu giữ chỗ, không link thật nào rời hệ thống. */
export async function sendRound2InviteTest(nowMs = Date.now()): Promise<Round2SendResult> {
  const fail = (message: string): Round2SendResult => ({ ok: false, message, sent: 0, failed: 0 });
  try {
    const { client, seasonId } = await round2SeasonContext();
    if (!(await round2Operator(seasonId))) return fail("Bạn không có quyền vận hành ghép cặp mùa này.");
    const actor = await getCurrentAdminUser();
    if (!actor?.email) return fail("Cần đăng nhập.");
    const settings = await readSettings(client, seasonId);
    const sentInWindow = await countSentInWindow(client, nowMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    if (sentInWindow >= DAILY_EMAIL_LIMIT) return fail("Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ.");
    const outcome = await sendMatchingRound2Invite({
      toEmail: actor.email,
      mentorName: String(actor.full_name ?? "").trim() || "anh/chị",
      seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
      groupLabel: "(nhóm ngành của từng mentor)",
      slots: 2,
      opensLabel: round2OpensLabel(settings?.opens_at ?? null),
      deadlineLabel: round2DeadlineLabel(settings?.closes_at ?? null),
      waveNote: round2WaveNote(Number(settings?.current_send_wave ?? 1)),
      token: null,
      linkId: null,
      // Cùng địa chỉ trang như thư thật: production không đặt VAM_OS_PUBLIC_BASE_URL, thiếu dòng này
      // thì thư thử mất link file PDF hướng dẫn (BTC thấy 15/10/2026) dù thư thật vẫn có.
      requestOrigin: await getPublicOrigin()
    });
    if (outcome.skipped) return fail("Môi trường này đang tắt gửi thư — thư thử chưa đi.");
    if (!outcome.ok) return fail("Gửi thư thử không thành công. Xem Vận hành → Mail → Nhật ký gửi.");
    return { ok: true, message: `Đã gửi thư thử tới ${actor.email}.`, sent: 1, failed: 0 };
  } catch (error) {
    log("test send failed", error);
    return fail(SAFE_ERROR);
  }
}

// ---------------------------------------------------------------------------
// Thư NHẮC mentor chưa chọn mentee (BTC 16/10/2026). Xem lib/matching-round2-dispatch-core.ts.
// ---------------------------------------------------------------------------

export type Round2ReminderStatus = {
  window: WindowState;
  /** Mentor sẽ nhận thư nếu bấm gửi lúc này. */
  eligible: number;
  /** Mentor đã được nhắc trong ROUND2_REMINDER_COOLDOWN_MS gần đây (không nhắc lại). */
  remindedRecently: number;
  sentInWindow: number | null;
  allowance: number;
};

/** Mã link đã được nhắc thành công trong cửa sổ chống trùng. Lỗi đọc thì ném: không biết ai đã được nhắc thì không gửi. */
async function readRecentReminders(client: any, nowMs: number): Promise<Set<string>> {
  const sinceIso = new Date(nowMs - ROUND2_REMINDER_COOLDOWN_MS).toISOString();
  const res = await readAllPages<Row>("outbound_emails", "id,related_id", (columns) =>
    client
      .from("outbound_emails")
      .select(columns)
      .eq("kind", "matching_round2_reminder")
      .eq("related_table", "matching_round2_links")
      .in("status", ["sent", "queued"])
      .gte("created_at", sinceIso)
  );
  if (res.error) throw res.error;
  return new Set(res.data.map((r) => String(r.related_id ?? "")).filter(Boolean));
}

/** Số bạn đang chờ mentor trong danh sách chọn của mentor này (cụm), để thư nói con số thật. */
function waitingInPool(board: Round2Board, row: Round2Row): number | null {
  if (row.group === null) return null;
  return board.pools.find((p) => p.groups.includes(row.group as number))?.visible ?? null;
}

export async function getRound2ReminderStatus(board: Round2Board, nowMs = Date.now()): Promise<Round2ReminderStatus | null> {
  try {
    const { client, seasonId } = await round2SeasonContext();
    const [settings, links, reminded, sentInWindow] = await Promise.all([
      readSettings(client, seasonId),
      readLinks(client, seasonId),
      readRecentReminders(client, nowMs),
      countSentInWindow(client, nowMs)
    ]);
    let eligible = 0;
    for (const row of board.rows) {
      if (isRound2ReminderRecipient(row, links.get(row.person.personId), reminded)) eligible += 1;
    }
    return {
      window: windowState(settings ? { opensAt: settings.opens_at, closesAt: settings.closes_at } : null, nowMs),
      eligible,
      remindedRecently: reminded.size,
      sentInWindow,
      allowance: sentInWindow === null ? 0 : dispatchAllowance(sentInWindow)
    };
  } catch (error) {
    log("reminder status failed", error);
    return null;
  }
}

/**
 * Gửi thư nhắc. Danh sách người nhận tính LẠI lúc bấm (ai đã chọn xong thì không bị nhắc). Mỗi link được
 * khoá (claimed_at) trước khi gửi nên hai người cùng bấm không gửi trùng; sau khi gửi chỉ nhả khoá —
 * không đổi mã link, không đổi đợt gửi, không đếm vào số lần gửi thư mời. Ai đã được nhắc trong
 * ROUND2_REMINDER_COOLDOWN_MS thì bỏ qua (đọc từ sổ thư), nên bấm lại không gửi trùng.
 */
export async function runRound2Reminder(input: { now?: () => number } = {}): Promise<Round2SendResult> {
  const now = input.now ?? Date.now;
  const fail = (message: string): Round2SendResult => ({ ok: false, message, sent: 0, failed: 0 });
  try {
    const { client, seasonId } = await round2SeasonContext();
    if (!(await round2Operator(seasonId))) return fail("Bạn không có quyền vận hành ghép cặp mùa này.");
    const startedMs = now();
    const nowIso = new Date(startedMs).toISOString();

    const settings = await readSettings(client, seasonId);
    const blocked = round2ReminderBlocked(settings ? { opensAt: settings.opens_at, closesAt: settings.closes_at } : null, startedMs);
    if (blocked) return fail(blocked);

    const sentInWindow = await countSentInWindow(client, startedMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    const allowance = dispatchAllowance(sentInWindow);
    if (allowance === 0) {
      return {
        ok: true,
        message: `Đã chạm phần hạn mức: cả hệ thống đã gửi ${sentInWindow}/${DAILY_EMAIL_LIMIT} thư trong 24 giờ qua, ${DISPATCH_RESERVE} thư chừa cho các thư khác. Thử lại sau vài giờ.`,
        sent: 0,
        failed: 0
      };
    }

    const [board, linksBefore, reminded] = await Promise.all([
      loadRound2Board(client, seasonId),
      readLinks(client, seasonId),
      readRecentReminders(client, startedMs)
    ]);
    const recipients = board.rows.filter((row) => isRound2ReminderRecipient(row, linksBefore.get(row.person.personId), reminded));
    if (!recipients.length) {
      return { ok: true, message: "Không còn mentor nào cần nhắc: ai còn chỗ đều đã chọn mentee hoặc đã được nhắc trong 18 giờ qua.", sent: 0, failed: 0 };
    }
    const byPerson = new Map(recipients.map((r) => [r.person.personId, r]));

    // Nhả khoá bỏ quên (lượt gửi trước chết giữa chừng), rồi đọc lại link để biết link nào đang rảnh.
    const staleIso = new Date(startedMs - DISPATCH_STALE_CLAIM_MS).toISOString();
    const { error: staleError } = await client.from("matching_round2_links").update({ claimed_at: null }).eq("season_id", seasonId).lt("claimed_at", staleIso);
    if (staleError) log("reminder stale release failed", staleError);

    const links = await readLinks(client, seasonId);
    const due = recipients
      .map((r) => links.get(r.person.personId))
      .filter((l): l is Row => Boolean(l) && !l!.claimed_at && !l!.revoked_at && Boolean(l!.token))
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)));
    if (!due.length) return { ok: true, message: "Không còn ai chờ thư nhắc ở lượt này — có thể một lượt gửi khác đang chạy.", sent: 0, failed: 0 };

    const chunk = due.slice(0, allowance);
    const claimStamp = nowIso;
    const { data: claimedRows, error: claimError } = await client
      .from("matching_round2_links")
      .update({ claimed_at: claimStamp })
      .in("id", chunk.map((l) => String(l.id)))
      .is("claimed_at", null)
      .select("id");
    if (claimError) {
      log("reminder claim failed", claimError);
      return fail(SAFE_ERROR);
    }
    const claimedIds = new Set(((claimedRows ?? []) as Row[]).map((r) => String(r.id)));
    const claimed = chunk.filter((l) => claimedIds.has(String(l.id)));

    const requestOrigin = await getPublicOrigin();
    const deadlineLabel = round2DeadlineLabel(settings?.closes_at ?? null);
    let sent = 0;
    let failed = 0;
    let stopped429 = false;
    const release: string[] = [];

    for (const link of claimed) {
      const id = String(link.id);
      const row = byPerson.get(String(link.mentor_person_id));
      if (stopped429 || now() - startedMs > DISPATCH_TIME_BUDGET_MS || !row) {
        release.push(id);
        continue;
      }
      let outcome: { ok: boolean; skipped: boolean; reason?: string; providerStatus?: number | null };
      try {
        outcome = await sendMatchingRound2Reminder({
          toEmail: row.person.email!,
          mentorName: row.person.name,
          seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
          slots: row.slots ?? 0,
          waitingMentees: waitingInPool(board, row),
          deadlineLabel,
          token: String(link.token),
          linkId: id,
          requestOrigin
        });
      } catch (error) {
        log("reminder crashed", error);
        outcome = { ok: false, skipped: false, reason: String(error) };
      }
      if (outcome.ok && !outcome.skipped) sent += 1;
      else {
        // Bị cổng gửi thư chặn (môi trường thử) thì không tính là lỗi; lỗi thật ghi ở sổ thư (status failed).
        if (!outcome.skipped) failed += 1;
        if (outcome.providerStatus === 429) stopped429 = true;
      }
      // Sau mỗi thư (thành công hay không) chỉ nhả khoá của đúng link này: người đã được nhắc thì sổ thư
      // giữ dấu; người chưa gửi được thì lần bấm sau thử lại.
      const { error } = await client.from("matching_round2_links").update({ claimed_at: null }).eq("id", id).eq("claimed_at", claimStamp);
      if (error) log("reminder release failed", error);
    }
    if (release.length) {
      const { error } = await client.from("matching_round2_links").update({ claimed_at: null }).in("id", release).eq("claimed_at", claimStamp);
      if (error) log("reminder release leftovers failed", error);
    }
    const left = Math.max(0, recipients.length - sent);
    if (stopped429) {
      return { ok: true, message: `Đã gửi ${sent} thư nhắc rồi nhà cung cấp báo chạm trần. Còn ${left} mentor chưa được nhắc — bấm lại sau vài giờ.`, sent, failed };
    }
    const parts = [`Đã gửi ${sent} thư nhắc.`];
    if (failed) parts.push(`${failed} thư lỗi, xem Vận hành → Mail → Nhật ký gửi.`);
    if (left) parts.push(`Còn ${left} mentor chưa được nhắc — bấm lại để gửi tiếp.`);
    return { ok: true, message: parts.join(" "), sent, failed };
  } catch (error) {
    log("reminder dispatch failed", error);
    return fail(SAFE_ERROR);
  }
}

/** Gửi thử thư nhắc cho chính BTC đang bấm: đường dẫn là câu giữ chỗ, không link thật nào rời hệ thống. */
export async function sendRound2ReminderTest(nowMs = Date.now()): Promise<Round2SendResult> {
  const fail = (message: string): Round2SendResult => ({ ok: false, message, sent: 0, failed: 0 });
  try {
    const { client, seasonId } = await round2SeasonContext();
    if (!(await round2Operator(seasonId))) return fail("Bạn không có quyền vận hành ghép cặp mùa này.");
    const actor = await getCurrentAdminUser();
    if (!actor?.email) return fail("Cần đăng nhập.");
    const settings = await readSettings(client, seasonId);
    const sentInWindow = await countSentInWindow(client, nowMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    if (sentInWindow >= DAILY_EMAIL_LIMIT) return fail("Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ.");
    const board = await loadRound2Board(client, seasonId);
    const outcome = await sendMatchingRound2Reminder({
      toEmail: actor.email,
      mentorName: String(actor.full_name ?? "").trim() || "Anh/Chị",
      seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
      slots: 2,
      // Một con số thật trong báo cáo, để BTC thấy câu "còn N bạn chưa có mentor" trong thư thử.
      waitingMentees: board.pools.find((p) => p.visible > 0)?.visible ?? null,
      deadlineLabel: round2DeadlineLabel(settings?.closes_at ?? null),
      token: null,
      linkId: null,
      requestOrigin: await getPublicOrigin()
    });
    if (outcome.skipped) return fail("Môi trường này đang tắt gửi thư — thư thử chưa đi.");
    if (!outcome.ok) return fail("Gửi thư thử không thành công. Xem Vận hành → Mail → Nhật ký gửi.");
    return { ok: true, message: `Đã gửi thư thử tới ${actor.email}.`, sent: 1, failed: 0 };
  } catch (error) {
    log("reminder test failed", error);
    return fail(SAFE_ERROR);
  }
}

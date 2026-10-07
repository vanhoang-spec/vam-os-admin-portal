import "server-only";

/**
 * Ghép cặp Vòng 2 — gửi link chọn mentee cho mentor còn chỗ (BTC 07/10/2026).
 *
 * Khuôn là bộ gửi thư mời chọn ca (lib/mentee-invite-dispatch.ts), vốn đã chạy thật:
 * cấp link cho người chưa có, CLAIM nguyên tử trước khi gửi để hai tab bấm cùng lúc
 * không ai nhận hai thư, dừng ngay khi nhà cung cấp báo 429, nhả mọi claim chưa gửi.
 * Dùng chung trần thư 1.000/24 giờ và phần chừa 80 thư cho các thư khác của hệ thống.
 *
 * Không gửi khi vòng 2 chưa mở hoặc đã đóng: thư trỏ vào một trang "chưa mở" dạy người
 * nhận bỏ qua thư sau.
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendMatchingRound2Invite } from "@/lib/email";
import { industryGroupLabel } from "@/lib/matching-round2-groups-core";
import { isRound2Recipient, round2DeadlineLabel, round2WaveNote } from "@/lib/matching-round2-dispatch-core";
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
      const last = Number(links.get(row.person.personId)?.last_sent_wave ?? 0);
      if (last >= wave) sentThisWave += 1;
      else if (isRound2Recipient(row, last, wave)) pending += 1;
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
    const state = windowState(settings ? { opensAt: settings.opens_at, closesAt: settings.closes_at } : null, startedMs);
    if (state !== "open") {
      return fail(state === "closed" ? "Vòng 2 đã đóng — không gửi link." : "Vòng 2 chưa mở — đặt giờ mở (đã tới giờ) trước khi gửi link.");
    }
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
    const recipients = board.rows.filter((row) =>
      isRound2Recipient(row, Number(linksBefore.get(row.person.personId)?.last_sent_wave ?? 0), wave)
    );
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
          groupLabel: industryGroupLabel(row.group),
          slots: row.slots ?? 0,
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
      deadlineLabel: round2DeadlineLabel(settings?.closes_at ?? null),
      waveNote: round2WaveNote(Number(settings?.current_send_wave ?? 1)),
      token: null,
      linkId: null
    });
    if (outcome.skipped) return fail("Môi trường này đang tắt gửi thư — thư thử chưa đi.");
    if (!outcome.ok) return fail("Gửi thư thử không thành công. Xem Vận hành → Mail → Nhật ký gửi.");
    return { ok: true, message: `Đã gửi thư thử tới ${actor.email}.`, sent: 1, failed: 0 };
  } catch (error) {
    log("test send failed", error);
    return fail(SAFE_ERROR);
  }
}

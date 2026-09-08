import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  BackfillCandidate,
  BackfillOutcome,
  BackfillSummary,
  CONFIRMATION_BACKFILL_AUDIT_ACTION_TYPE,
  CONFIRMATION_BACKFILL_ELIGIBLE_STATUSES,
  CONFIRMATION_BACKFILL_MAX_PER_RUN,
  CONFIRMATION_BACKFILL_SINCE,
  CONFIRMATION_BACKFILL_STALE_CLAIM_MINUTES,
  CONFIRMATION_BACKFILL_TIME_BUDGET_MS,
  selectBackfillCandidates,
  summarizeBackfillOutcomes,
  type BackfillApplicationRow
} from "@/lib/confirmation-backfill-core";
import { evaluateEmailGate } from "@/lib/email-core";
import { sendApplicationConfirmation } from "@/lib/email";
import { MAIN_OUTBOUND_EMAIL_KINDS } from "@/lib/outbound-emails-core";
import { SEASON_CONFIG } from "@/lib/season-config";
import { CURRENT_APPLICATION_SEASON_LABEL } from "@/lib/season-labels";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/confirmation-backfill.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Gửi bù thư xác nhận cho những đơn đã nộp trước khi hệ thống có tầng email.
 *
 * Nguyên tắc đặt-chỗ-trước-khi-gửi: chèn một dòng `queued` vào outbound_emails
 * TRƯỚC khi gọi Brevo, rồi chốt kết quả lên chính dòng đó. Index unique
 * outbound_emails_application_confirmation_once_idx khiến người thứ hai va
 * 23505 ngay lúc đặt chỗ, tức là trước khi kịp gửi. Nếu đọc trước rồi mới gửi
 * thì hai người bấm cách nhau vài giây sẽ cùng nhìn thấy một ảnh chụp cũ và
 * cùng gửi thư cho ứng viên, mà sổ chỉ hiện một dòng — không có cách nào phát
 * hiện sau đó.
 */

const CHUNK_SIZE = 200;
const MAX_CHUNKS = 25;
const VI_ERROR = "Không đọc được danh sách đơn cần gửi bù.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[confirmation-backfill]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

export type BackfillCandidateSummary =
  | {
      ok: true;
      seasonId: string;
      pending: number;
      /** True khi đã chạm trần đếm: con số là "ít nhất chừng này". */
      pendingCapped: boolean;
      byRole: { mentor: number; mentee: number };
    }
  | { ok: false; error: string };

/**
 * Đếm số đơn còn chờ thư xác nhận.
 *
 * Đọc theo trang 200 dòng và đối chiếu từng trang với outbound_emails bằng
 * `.in("related_id", …)`: giữ URL PostgREST ngắn và tránh trần max-rows 1000
 * của Supabase, vốn cắt bớt âm thầm chứ không báo lỗi.
 */
export async function countConfirmationBackfillCandidates(
  limit = 500
): Promise<BackfillCandidateSummary> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, error: VI_ERROR };

  const { data: season, error: seasonError } = await client
    .from("seasons")
    .select("id")
    .eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE)
    .maybeSingle();

  if (seasonError) {
    log("seasons lookup failed", seasonError);
    return { ok: false, error: VI_ERROR };
  }
  if (!season?.id) {
    return { ok: false, error: `Không tìm thấy mùa ${SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE}.` };
  }

  const collected = await collectCandidates(client, String(season.id), limit);
  if (!collected.ok) return { ok: false, error: collected.error };

  const byRole = { mentor: 0, mentee: 0 };
  for (const candidate of collected.candidates) byRole[candidate.role] += 1;

  return {
    ok: true,
    seasonId: String(season.id),
    pending: collected.candidates.length,
    pendingCapped: collected.candidates.length >= limit,
    byRole
  };
}

type CollectResult =
  | { ok: true; candidates: BackfillCandidate[] }
  | { ok: false; error: string };

async function collectCandidates(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  seasonId: string,
  max: number
): Promise<CollectResult> {
  const candidates: BackfillCandidate[] = [];

  for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
    const from = chunk * CHUNK_SIZE;
    const { data, error } = await client
      .from("applications")
      .select("id, role_applied, full_name, email_primary, submitted_at, status")
      .eq("season_id", seasonId)
      .eq("source", "vam_os_form")
      .in("status", CONFIRMATION_BACKFILL_ELIGIBLE_STATUSES as unknown as string[])
      .not("email_primary", "is", null)
      .gte("submitted_at", CONFIRMATION_BACKFILL_SINCE)
      .order("submitted_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + CHUNK_SIZE - 1);

    if (error) {
      log("applications page failed", error);
      return { ok: false, error: VI_ERROR };
    }

    const rows = (data ?? []) as BackfillApplicationRow[];
    if (rows.length === 0) break;

    const liveIds = await readLiveConfirmationIds(client, rows.map((row) => row.id));
    if (!liveIds.ok) return { ok: false, error: liveIds.error };

    const selection = selectBackfillCandidates({
      applications: rows,
      alreadyLiveIds: liveIds.ids,
      max: max - candidates.length
    });
    candidates.push(...selection.candidates);

    if (candidates.length >= max) break;
    if (rows.length < CHUNK_SIZE) break;
  }

  return { ok: true, candidates };
}

async function readLiveConfirmationIds(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  applicationIds: string[]
): Promise<{ ok: true; ids: Set<string> } | { ok: false; error: string }> {
  if (applicationIds.length === 0) return { ok: true, ids: new Set() };

  const { data, error } = await client
    .from("outbound_emails")
    .select("related_id")
    .eq("related_table", "applications")
    .in("kind", MAIN_OUTBOUND_EMAIL_KINDS as unknown as string[])
    .in("status", ["queued", "sent"])
    .in("related_id", applicationIds);

  if (error) {
    log("outbound_emails lookup failed", error);
    // Không đoán: một lần đọc hỏng mà vẫn gửi là có thể gửi trùng.
    return { ok: false, error: VI_ERROR };
  }

  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ related_id: string | null }>) {
    if (row.related_id) ids.add(row.related_id);
  }
  return { ok: true, ids };
}

/**
 * Dọn những chỗ đã đặt mà không bao giờ được chốt.
 *
 * Xảy ra khi function bị cắt giữa lúc đặt chỗ và lúc ghi kết quả. Dòng `queued`
 * còn lại nằm trong phạm vi index chống trùng nên sẽ chặn ứng viên đó mãi mãi.
 */
async function expireStaleClaims(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>
): Promise<void> {
  const cutoff = new Date(
    Date.now() - CONFIRMATION_BACKFILL_STALE_CLAIM_MINUTES * 60_000
  ).toISOString();

  const { error } = await client
    .from("outbound_emails")
    .update({ status: "failed", error: "Claim hết hạn (lượt gửi bị gián đoạn)" })
    .eq("status", "queued")
    .in("kind", MAIN_OUTBOUND_EMAIL_KINDS as unknown as string[])
    .lt("created_at", cutoff);

  // Không chặn lượt chạy: dọn dẹp hỏng thì cùng lắm là bỏ sót vài ứng viên.
  if (error) log("stale claim sweep failed", error);
}

export type BackfillRunResult =
  | {
      ok: true;
      summary: BackfillSummary;
      requested: number;
      remainingAfter: number | null;
      gateOpen: boolean;
      stoppedByBudget: boolean;
    }
  | { ok: false; error: string };

export async function runConfirmationBackfill(input: {
  seasonId: string;
  max?: number;
  now?: () => number;
}): Promise<BackfillRunResult> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, error: VI_ERROR };

  const now = input.now ?? Date.now;
  const max = Math.max(1, Math.min(input.max ?? CONFIRMATION_BACKFILL_MAX_PER_RUN, CONFIRMATION_BACKFILL_MAX_PER_RUN));
  const startedAt = now();

  await expireStaleClaims(client);

  const collected = await collectCandidates(client, input.seasonId, max);
  if (!collected.ok) return { ok: false, error: collected.error };

  const gateOpen = evaluateEmailGate(process.env).canSend;
  const outcomes: BackfillOutcome[] = [];
  let stoppedByBudget = false;

  for (const candidate of collected.candidates) {
    if (now() - startedAt > CONFIRMATION_BACKFILL_TIME_BUDGET_MS) {
      stoppedByBudget = true;
      break;
    }

    const { data: claimed, error: claimError } = await client
      .from("outbound_emails")
      .insert({
        kind: candidate.kind,
        to_email: candidate.emailPrimary,
        subject: null,
        status: "queued",
        provider: "brevo",
        related_table: "applications",
        related_id: candidate.applicationId
      })
      .select("id")
      .maybeSingle();

    if (claimError) {
      // 23505 = một lượt khác đã đặt chỗ cho đúng đơn này trước.
      outcomes.push(claimError.code === "23505" ? "claimed_elsewhere" : "claim_failed");
      if (claimError.code !== "23505") log("claim insert failed", claimError);
      continue;
    }
    if (!claimed?.id) {
      outcomes.push("claim_failed");
      continue;
    }

    const result = await sendApplicationConfirmation({
      toEmail: candidate.emailPrimary,
      applicantName: candidate.fullName,
      role: candidate.role,
      seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
      applicationId: candidate.applicationId,
      claimedRowId: String(claimed.id)
    });

    outcomes.push(result.skipped ? "skipped" : result.ok ? "sent" : "failed");
  }

  const summary = summarizeBackfillOutcomes(outcomes);
  const remaining = await countConfirmationBackfillCandidates();

  await writeAdminAudit(client, {
    seasonCode: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
    requested: collected.candidates.length,
    summary,
    gateOpen,
    stoppedByBudget
  });

  return {
    ok: true,
    summary,
    requested: collected.candidates.length,
    remainingAfter: remaining.ok ? remaining.pending : null,
    gateOpen,
    stoppedByBudget
  };
}

/** Cùng khuôn với lib/matches.ts: ghi audit không bao giờ làm hỏng thao tác. */
async function writeAdminAudit(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  details: {
    seasonCode: string;
    requested: number;
    summary: BackfillSummary;
    gateOpen: boolean;
    stoppedByBudget: boolean;
  }
) {
  try {
    const admin = await getCurrentAdminUser();
    const { error } = await client.from("admin_audit_log").insert({
      actor_admin_user_id: admin?.id ?? null,
      action_type: CONFIRMATION_BACKFILL_AUDIT_ACTION_TYPE,
      target_admin_user_id: null,
      before_data: null,
      after_data: null,
      details: {
        season_code: details.seasonCode,
        since: CONFIRMATION_BACKFILL_SINCE,
        requested: details.requested,
        sent: details.summary.sent,
        failed: details.summary.failed,
        skipped: details.summary.skipped,
        claimed_elsewhere: details.summary.claimed_elsewhere,
        claim_failed: details.summary.claim_failed,
        gate_open: details.gateOpen,
        stopped_by_budget: details.stoppedByBudget
      }
    });
    if (error) log("admin_audit_log insert failed", error);
  } catch (err) {
    log("admin audit crashed", err);
  }
}

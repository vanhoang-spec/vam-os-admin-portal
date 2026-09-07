/**
 * lib/confirmation-backfill-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của việc gửi bù thư xác nhận đơn.
 *
 * Bối cảnh: hai form tuyển sinh mở công khai từ 15/08/2026, nhưng hệ thống chưa
 * có tầng gửi email nào cho tới nay. Mọi người nộp đơn trong quãng đó đều không
 * nhận được gì, dù trang cảm ơn bảo họ theo dõi hộp thư. Đây là phần quyết định
 * gửi bù cho ai và đếm kết quả; phần chạm database nằm ở
 * lib/confirmation-backfill.ts.
 */

import { confirmationKindForRole, type ConfirmationKind } from "@/lib/outbound-emails-core";

/** Ngày hai form được mở. Đơn trước mốc này thuộc đợt tuyển khác. */
export const CONFIRMATION_BACKFILL_SINCE = "2026-08-15";

/**
 * Số thư tối đa mỗi lần bấm.
 *
 * Gửi là tuần tự và mỗi lời gọi Brevo có thể treo tới 20 giây, nên trần này là
 * trần thời gian chứ không phải trần lịch sự. Gói Brevo miễn phí cho 300 thư
 * mỗi ngày, nên chia nhiều lượt không mất gì.
 */
export const CONFIRMATION_BACKFILL_MAX_PER_RUN = 25;

/** Ngân sách thời gian một lượt, dưới giới hạn maxDuration của trang. */
export const CONFIRMATION_BACKFILL_TIME_BUDGET_MS = 40_000;

/**
 * Sau bao lâu thì một chỗ đã đặt mà chưa chốt được coi là hỏng.
 *
 * Nếu function bị giết giữa lúc đặt chỗ và lúc ghi kết quả, dòng `queued` sẽ
 * nằm lại và index chống trùng sẽ chặn ứng viên đó vĩnh viễn. Mỗi lượt chạy mở
 * đầu bằng việc dọn những dòng như vậy, nên hệ thống tự lành mà không cần cron.
 */
export const CONFIRMATION_BACKFILL_STALE_CLAIM_MINUTES = 15;

export const CONFIRMATION_BACKFILL_AUDIT_ACTION_TYPE = "send_application_confirmation_backfill";

/**
 * Những trạng thái đơn được gửi bù.
 *
 * Thư viết "bước tiếp theo: ban tổ chức rà soát và chấm hồ sơ, nếu phù hợp sẽ
 * mời phỏng vấn". Gửi câu đó cho người đã phỏng vấn xong hoặc đã có kết quả là
 * lạc điệu, nên danh sách này dừng đúng trước vòng phỏng vấn. Đối chiếu từ vựng
 * 22 trạng thái ở
 * supabase/migrations/20260905140800_s12_application_status_constraint_prerequisite.sql
 */
export const CONFIRMATION_BACKFILL_ELIGIBLE_STATUSES = [
  "submitted",
  "under_data_check",
  "ready_for_screening",
  "screening_assigned",
  "screening_in_progress",
  "screening_completed",
  "screening_passed",
  "needs_more_review",
  "needs_admin_review",
  "ready_for_final_decision"
] as const;

export type BackfillApplicationRow = {
  id: string;
  role_applied: string | null;
  full_name: string | null;
  email_primary: string | null;
  submitted_at: string | null;
  status: string | null;
};

export type BackfillCandidate = {
  applicationId: string;
  role: "mentor" | "mentee";
  kind: ConfirmationKind;
  fullName: string;
  emailPrimary: string;
  submittedAt: string | null;
};

export type BackfillSelection = {
  candidates: BackfillCandidate[];
  skippedNoEmail: number;
  skippedUnknownRole: number;
};

/**
 * Lọc ra những đơn thực sự gửi được, giữ nguyên thứ tự đầu vào.
 *
 * Thứ tự vào là thứ tự nộp tăng dần, nên người chờ lâu nhất được gửi trước.
 * `alreadyLiveIds` là những đơn đã có thư còn sống (queued hoặc sent) — index
 * unique dưới database mới là trọng tài cuối cùng, chỗ này chỉ để không gọi
 * Brevo một cách vô ích.
 */
export function selectBackfillCandidates(input: {
  applications: BackfillApplicationRow[];
  alreadyLiveIds: ReadonlySet<string>;
  max: number;
}): BackfillSelection {
  const candidates: BackfillCandidate[] = [];
  let skippedNoEmail = 0;
  let skippedUnknownRole = 0;

  for (const row of input.applications) {
    if (candidates.length >= input.max) break;
    if (input.alreadyLiveIds.has(row.id)) continue;

    const kind = confirmationKindForRole(row.role_applied);
    if (!kind) {
      skippedUnknownRole++;
      continue;
    }

    const emailPrimary = String(row.email_primary ?? "").trim();
    if (!emailPrimary) {
      skippedNoEmail++;
      continue;
    }

    candidates.push({
      applicationId: row.id,
      role: row.role_applied === "mentor" ? "mentor" : "mentee",
      kind,
      fullName: String(row.full_name ?? "").trim(),
      emailPrimary,
      submittedAt: row.submitted_at
    });
  }

  return { candidates, skippedNoEmail, skippedUnknownRole };
}

export type BackfillOutcome = "sent" | "failed" | "skipped" | "claimed_elsewhere" | "claim_failed";

export type BackfillSummary = Record<BackfillOutcome, number>;

export function emptyBackfillSummary(): BackfillSummary {
  return { sent: 0, failed: 0, skipped: 0, claimed_elsewhere: 0, claim_failed: 0 };
}

export function summarizeBackfillOutcomes(outcomes: readonly BackfillOutcome[]): BackfillSummary {
  const summary = emptyBackfillSummary();
  for (const outcome of outcomes) summary[outcome] += 1;
  return summary;
}

/**
 * Câu tổng kết hiện lên sau khi bấm.
 *
 * Trường hợp cổng gửi đang tắt được nói thẳng, vì khi đó mọi dòng đều là "bỏ
 * qua" và người vận hành cần biết ngay là do cấu hình chứ không phải do lỗi.
 */
export function backfillResultMessage(
  summary: BackfillSummary,
  input: { requested: number; remainingAfter: number | null; gateOpen: boolean; stoppedByBudget: boolean }
): string {
  if (input.requested === 0) {
    return "Không còn đơn nào cần gửi bù.";
  }

  if (!input.gateOpen) {
    return `Gửi email đang tắt nên không có thư nào rời hệ thống. Đã ghi ${summary.skipped} dòng "Bỏ qua" để bạn thấy thư sẽ đi tới đâu khi bật.`;
  }

  const parts: string[] = [`Đã gửi ${summary.sent}/${input.requested} thư.`];
  if (summary.failed > 0) parts.push(`${summary.failed} thư lỗi.`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} thư bị bỏ qua do cấu hình.`);
  if (summary.claimed_elsewhere > 0) parts.push(`${summary.claimed_elsewhere} đơn đã được lượt khác nhận.`);
  if (summary.claim_failed > 0) parts.push(`${summary.claim_failed} đơn không đặt chỗ được.`);
  if (input.stoppedByBudget) parts.push("Dừng sớm do hết thời gian cho một lượt.");
  if (input.remainingAfter !== null) {
    parts.push(
      input.remainingAfter > 0
        ? `Còn khoảng ${input.remainingAfter} đơn chờ, bấm tiếp để gửi lượt sau.`
        : "Không còn đơn nào chờ."
    );
  }
  return parts.join(" ");
}

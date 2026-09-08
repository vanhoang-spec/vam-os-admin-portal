import "server-only";

import { sendInterviewRoundInvite } from "@/lib/email";
import { CURRENT_APPLICATION_SEASON_LABEL } from "@/lib/season-labels";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/interview-invite-notifications.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Báo cho ứng viên biết họ vừa được mời vào vòng phỏng vấn.
 *
 * Trước đây hệ thống chỉ đổi trạng thái đơn sang `invited_to_interview` rồi
 * dừng — người được mời không nhận được gì, và ai đó ở ban tổ chức phải tự mở
 * hộp thư gõ tay từng người.
 *
 * Tách khỏi lib/application-decisions.ts để chỗ ra quyết định vẫn chỉ nói về
 * quyết định, và để phần gửi thư có thể thay đổi mà không đụng vào đường ghi
 * trạng thái.
 */

/** Trạng thái duy nhất kích hoạt lá thư này. */
export const INTERVIEW_INVITE_STATUS = "invited_to_interview";

/**
 * Số thư tối đa gửi trong một lần bấm.
 *
 * Màn mời hàng loạt cho chọn tới 100 đơn, nhưng gửi là tuần tự và mỗi lời gọi
 * tới nhà cung cấp có thể treo tới 20 giây trước khi bị cắt. Trần này là trần
 * thời gian của một request, không phải trần lịch sự.
 */
export const INTERVIEW_INVITE_MAX_PER_RUN = 50;

/** Ngân sách thời gian, nằm dưới maxDuration của trang. */
export const INTERVIEW_INVITE_TIME_BUDGET_MS = 40_000;

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[interview-invite-notifications]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

export type InterviewInviteNotifyResult = {
  sent: number;
  failed: number;
  /** Cổng gửi đang tắt — đã ghi sổ nhưng không thư nào rời hệ thống. */
  skipped: number;
  /** Không có email hợp lệ trong hồ sơ. */
  noEmail: number;
  /** Vượt trần hoặc hết ngân sách thời gian — CHƯA ai gửi cho những người này. */
  notAttempted: number;
  /** Tên những người chưa được gửi, để người vận hành biết còn nợ ai. */
  notAttemptedNames: string[];
};

function emptyResult(): InterviewInviteNotifyResult {
  return { sent: 0, failed: 0, skipped: 0, noEmail: 0, notAttempted: 0, notAttemptedNames: [] };
}

/**
 * Gửi thư mời phỏng vấn cho những đơn vừa được chuyển trạng thái thành công.
 *
 * Không bao giờ ném lỗi: quyết định đã ghi vào database rồi, và một quyết định
 * đúng không được phép bị báo là hỏng chỉ vì nhà cung cấp email không trả lời.
 * Người gọi nhận về số liệu và tự quyết hiển thị thế nào.
 */
export async function notifyInterviewRoundInvites(input: {
  applicationIds: string[];
  now?: () => number;
}): Promise<InterviewInviteNotifyResult> {
  const result = emptyResult();
  if (input.applicationIds.length === 0) return result;

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    log("service-role client unavailable", null);
    result.notAttempted = input.applicationIds.length;
    return result;
  }

  const { data, error } = await client
    .from("applications")
    .select("id, full_name, email_primary")
    .in("id", input.applicationIds);

  if (error) {
    log("applications lookup failed", error);
    result.notAttempted = input.applicationIds.length;
    return result;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email_primary: string | null;
  }>;

  const now = input.now ?? Date.now;
  const startedAt = now();

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const displayName = String(row.full_name ?? "").trim();

    const overCap = index >= INTERVIEW_INVITE_MAX_PER_RUN;
    const overBudget = now() - startedAt > INTERVIEW_INVITE_TIME_BUDGET_MS;
    if (overCap || overBudget) {
      result.notAttempted += 1;
      result.notAttemptedNames.push(displayName || row.id);
      continue;
    }

    const toEmail = String(row.email_primary ?? "").trim();
    if (!toEmail) {
      result.noEmail += 1;
      continue;
    }

    try {
      const sendResult = await sendInterviewRoundInvite({
        toEmail,
        candidateName: displayName,
        seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
        applicationId: row.id
      });
      if (sendResult.skipped) result.skipped += 1;
      else if (sendResult.ok) result.sent += 1;
      else result.failed += 1;
    } catch (err) {
      log("send crashed", err);
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Câu mô tả kết quả gửi, ghép vào thông báo của thao tác quyết định.
 *
 * Trả về chuỗi rỗng khi không có gì đáng nói, để thông báo gốc không bị loãng
 * trong trường hợp thường gặp là mọi thứ chạy đúng.
 */
export function interviewInviteNotifyMessage(result: InterviewInviteNotifyResult): string {
  const parts: string[] = [];
  if (result.sent > 0) parts.push(`Đã gửi ${result.sent} thư mời phỏng vấn.`);
  if (result.skipped > 0) {
    parts.push(`${result.skipped} thư chưa gửi được vì tính năng gửi email đang tắt.`);
  }
  if (result.failed > 0) parts.push(`${result.failed} thư gửi lỗi, xem Vận hành → Email đã gửi.`);
  if (result.noEmail > 0) parts.push(`${result.noEmail} đơn không có email hợp lệ.`);
  if (result.notAttempted > 0) {
    const names = result.notAttemptedNames.slice(0, 5).join(", ");
    const more = result.notAttemptedNames.length > 5 ? `, và ${result.notAttemptedNames.length - 5} người nữa` : "";
    parts.push(
      `CHƯA gửi thư cho ${result.notAttempted} người (${names}${more}) — vượt giới hạn một lượt. Những người này đã được mời trong hệ thống nhưng chưa nhận được thư; cần liên hệ tay hoặc chia nhỏ lần mời sau.`
    );
  }
  return parts.join(" ");
}

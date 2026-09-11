"use server";

import { revalidatePath } from "next/cache";
import { confirmBulkSend } from "@/lib/bulk-mail-core";
import { loadLoginInviteRoster } from "@/lib/login-invite-roster";
import {
  PARTICIPANT_ACCOUNTS_PATH,
  type BulkInviteState,
  type ParticipantInviteState
} from "@/lib/participant-action-types";
import {
  INVITE_BATCH_MAX,
  describeBulkRun,
  selectBulkCandidates,
  type BulkRunTally
} from "@/lib/participant-invite-core";
import {
  authorizeParticipantInvites,
  inviteParticipantAccount,
  inviteParticipantsInSeason
} from "@/lib/participant-invites";

const SYSTEM_ERROR = "Lỗi hệ thống. Vui lòng thử lại.";
const MAX_PROBLEMS = 10;

/**
 * Nút trên một dòng: Mời, Gửi lại, hoặc Gửi link đặt lại mật khẩu.
 *
 * Cổng quyền nằm trong `inviteParticipantAccount` chứ không ở đây: hàm đó là
 * chỗ duy nhất gửi được lời mời, nên nó phải tự gác cửa cho mình. Một cổng đặt
 * ở lớp hành động sẽ vắng mặt vào ngày có chỗ thứ hai gọi thẳng vào hàm.
 */
export async function inviteParticipantAction(
  _previousState: ParticipantInviteState,
  formData: FormData
): Promise<ParticipantInviteState> {
  try {
    const result = await inviteParticipantAccount({
      personId: String(formData.get("person_id") ?? ""),
      seasonId: String(formData.get("season_id") ?? ""),
      mode: formData.get("mode") === "reset" ? "reset" : "invite"
    });

    // Làm mới cả khi không gửi: bị từ chối vì một người khác vừa gửi xong cũng
    // có nghĩa là màn hình đang cũ.
    revalidatePath(PARTICIPANT_ACCOUNTS_PATH);
    return { ok: result.ok, message: result.message, outcome: result.outcome, at: Date.now() };
  } catch (error) {
    console.error("[inviteParticipantAction]", error);
    return { ok: false, message: SYSTEM_ERROR, outcome: "failed", at: Date.now() };
  }
}

/**
 * Một lượt mời hàng loạt.
 *
 * ---------------------------------------------------------------------------
 * AI ĐƯỢC MỜI DO MÁY CHỦ TÍNH, KHÔNG DO BIỂU MẪU GỬI LÊN
 * ---------------------------------------------------------------------------
 * Biểu mẫu chỉ mang mùa, bước (bắt đầu / gửi tiếp) và con số người vận hành gõ
 * lại. Danh sách người được tính lại từ database ở mỗi lượt; con số gõ lại phải
 * khớp với con số máy chủ vừa tính, không phải với một con số ẩn trong biểu mẫu.
 *
 * "Gửi tiếp" không hỏi lại con số, nhưng từ chối nếu danh sách đã DÀI RA so với
 * lần trước — ai đó vừa xếp thêm người vào mùa, và người vận hành chưa hề thấy
 * quy mô mới.
 *
 * Số người còn lại luôn ĐẾM LẠI sau lượt chạy, không lấy "trước trừ số vừa
 * gửi": thư lỗi không làm ai rời khỏi danh sách.
 */
export async function runBulkInviteAction(
  previousState: BulkInviteState,
  formData: FormData
): Promise<BulkInviteState> {
  const fail = (message: string): BulkInviteState => ({
    ok: false,
    message,
    problems: [],
    remaining: previousState?.remaining ?? null,
    canContinue: false,
    at: Date.now()
  });

  try {
    const seasonId = String(formData.get("season_id") ?? "").trim();
    const phase = formData.get("phase") === "continue" ? "continue" : "start";

    // Cổng trước mọi lần đọc.
    const access = await authorizeParticipantInvites(seasonId);
    if (!access.ok) return fail(access.message);

    const nowMs = Date.now();
    const roster = await loadLoginInviteRoster(seasonId, nowMs);
    if (!roster.ok) return fail(roster.error);
    if (!roster.gateOpen) return fail("Hệ thống đang tắt gửi thư trên môi trường này. Chưa gửi gì.");

    const candidates = selectBulkCandidates(roster.rows, nowMs);

    if (phase === "start") {
      const confirmation = confirmBulkSend({ typed: formData.get("typed_count"), expected: candidates.length });
      if (!confirmation.ok) return fail(confirmation.message);
    } else {
      if (!candidates.length) return fail("Không còn ai chưa mời trong mùa này.");
      const previous = Number(formData.get("previous_remaining"));
      if (!Number.isFinite(previous) || candidates.length > previous) {
        return fail(
          `Danh sách người chưa mời vừa thay đổi (hiện có ${candidates.length} người). Tải lại trang và xác nhận lại.`
        );
      }
    }

    const batch = await inviteParticipantsInSeason({
      seasonId,
      personIds: candidates.slice(0, INVITE_BATCH_MAX).map((row) => row.personId)
    });
    if (!batch.ok) return fail(batch.message);

    const names = new Map<string, string>(candidates.map((row) => [row.personId, row.fullName] as [string, string]));
    const tally: BulkRunTally = { sent: 0, alreadyActive: 0, refused: 0, notSent: 0 };
    const problems: string[] = [];
    for (const result of batch.results) {
      if (result.outcome === "sent") tally.sent += 1;
      else if (result.outcome === "already_active") tally.alreadyActive += 1;
      else if (result.outcome === "refused") tally.refused += 1;
      else tally.notSent += 1;

      if (result.outcome !== "sent" && result.outcome !== "already_active" && problems.length < MAX_PROBLEMS) {
        problems.push(`${names.get(result.personId) ?? "Một người"}: ${result.message}`);
      }
    }

    const recount = await loadLoginInviteRoster(seasonId);
    const remaining = recount.ok ? selectBulkCandidates(recount.rows, Date.now()).length : null;
    const stoppedHard =
      batch.stoppedBy === "daily_budget" || batch.stoppedBy === "send_failures" || batch.stoppedBy === "gate_closed";

    revalidatePath(PARTICIPANT_ACCOUNTS_PATH);
    return {
      ok: tally.sent > 0 || (tally.notSent === 0 && tally.refused === 0),
      message: describeBulkRun({ tally, stoppedBy: batch.stoppedBy, remaining }),
      problems,
      remaining,
      canContinue: remaining !== null && remaining > 0 && !stoppedHard,
      at: Date.now()
    };
  } catch (error) {
    console.error("[runBulkInviteAction]", error);
    return fail(SYSTEM_ERROR);
  }
}

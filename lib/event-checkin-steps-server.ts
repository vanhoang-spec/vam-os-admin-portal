import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps, type CurrentAdminUser } from "@/lib/auth-constants";
import { parseCheckinStepsInput } from "@/lib/event-checkin-steps";
import { canScanEvent } from "@/lib/event-supporters";
import { isValidUuid, writeAdminAudit } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/event-checkin-steps-server.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ai được thiết lập các lần quét mã QR của một buổi, và đường ghi hẹp của việc đó.
 *
 * Chủ dự án chốt lại 14/09/2026: support team cũng được sửa phần này. Support team
 * không mở được form "Sửa sự kiện" — form đó ghi cả tên, giờ, địa điểm, phí — nên
 * họ thiết lập ngay trên màn hình máy quét, qua một hàm chỉ chạm đúng một cột.
 */

const VI_ERROR = "Không lưu được các lần quét. Thử lại.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[event-checkin-steps]", scope, { code: err?.code, message: err?.message ?? String(error) });
}

/**
 * Người này có được thiết lập các lần quét của buổi này không.
 *
 * Hai đường:
 *   * quản trị sự kiện (super_admin, admin, core_team) — cùng cổng mùa với việc sửa
 *     sự kiện: không vận hành được mùa đó thì không đổi được gì của buổi đó;
 *   * support team được ghép vào ĐÚNG buổi này — cùng điều kiện mở máy quét của
 *     buổi đó. Bạn hỗ trợ buổi Orientation không đổi được lần quét của buổi phỏng
 *     vấn tuần sau.
 *
 * Vai trò khác, dù có dòng ghép, không được: dòng ghép cho quyền quét, còn đổi
 * thiết lập là quyền chủ dự án trao riêng cho support team.
 *
 * Fail-closed: không đọc được phạm vi hay danh sách hỗ trợ thì trả về false.
 */
export async function canConfigureCheckinSteps(
  adminUser: CurrentAdminUser | null,
  event: { id: string; season_id?: string | null }
): Promise<boolean> {
  if (!adminUser?.id) return false;

  if (canEditRecaps(adminUser)) {
    try {
      return await canOperateSeason(await getAdminScopeContext(), event.season_id ?? null);
    } catch (error) {
      log("canConfigureCheckinSteps:scope", error);
      return false;
    }
  }

  if (adminUser.role !== "support_team") return false;
  return canScanEvent(adminUser, event.id);
}

/**
 * Lưu các lần quét của một buổi — và CHỈ cột đó.
 *
 * Kiểm quyền trước, kiểm danh sách sau: người không có quyền nhận câu "không có
 * quyền" dù danh sách gửi lên sai hay đúng.
 */
export async function updateEventCheckinSteps(input: {
  eventId: unknown;
  steps: unknown;
}): Promise<{ ok: boolean; message: string }> {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) return { ok: false, message: "Bạn chưa đăng nhập." };

  const eventId = String(input.eventId ?? "").trim();
  if (!isValidUuid(eventId)) return { ok: false, message: "ID sự kiện không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: VI_ERROR };

  const { data: before, error: readError } = await client
    .from("events")
    .select("id, season_id, checkin_steps")
    .eq("id", eventId)
    .maybeSingle();

  if (readError) {
    log("updateEventCheckinSteps:read", readError);
    return { ok: false, message: VI_ERROR };
  }
  if (!before) return { ok: false, message: "Không tìm thấy sự kiện." };

  const seasonId = (before as { season_id?: string | null }).season_id ?? null;
  if (!(await canConfigureCheckinSteps(adminUser, { id: eventId, season_id: seasonId }))) {
    return { ok: false, message: "Bạn không có quyền thiết lập các lần quét của sự kiện này." };
  }

  const parsed = parseCheckinStepsInput(input.steps);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const { data: after, error: updateError } = await client
    .from("events")
    .update({ checkin_steps: parsed.steps })
    .eq("id", eventId)
    .select("id, season_id, checkin_steps")
    .maybeSingle();

  if (updateError || !after) {
    log("updateEventCheckinSteps:update", updateError ?? "không có dòng nào được cập nhật");
    return { ok: false, message: VI_ERROR };
  }

  await writeAdminAudit(client, { actionType: "update_event", beforeData: before, afterData: after });
  return { ok: true, message: "Đã lưu các lần quét." };
}

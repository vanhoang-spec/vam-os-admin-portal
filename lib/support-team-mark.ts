import "server-only";

/**
 * Tích "Support team" trên hồ sơ (BTC 13/10/2026) — phần máy chủ.
 *
 * Đường ghi hẹp: một RPC duy nhất (vam121_set_support_team) làm cho người đó thành mentee của mùa
 * hiện tại. Không có phép kiểm nghiệp vụ nào thay cho hàm đó — ở đây chỉ có cổng quyền của màn
 * hình (vai trò + phạm vi vận hành mùa; database kiểm lại cả hai), đọc trạng thái khung, và câu chữ.
 *
 * "Mùa hiện tại" là mùa đang tuyển và ghép cặp (SEASON_CONFIG), nên sang mùa mới chỉ cần đổi mã mùa
 * ở đó như mọi màn hình khác — không có SQL nào phải chạy lại.
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canMarkSupportTeam } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  supportTeamErrorMessage,
  supportTeamPanelState,
  supportTeamResultMessage,
  type SupportTeamPanelState
} from "@/lib/support-team-mark-core";

export const SUPPORT_TEAM_SEASON_CODE = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function log(message: string, error?: unknown) {
  console.error(`[support-team] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

/**
 * Người thao tác + mùa, hoặc null. Fail-closed: không đọc được vai trò, mùa hay phạm vi quyền thì
 * là không có quyền — lỗi hạ tầng không được biến thành quyền.
 */
async function operatorForCurrentSeason() {
  const actor = await getCurrentAdminUser();
  if (!actor?.id || !canMarkSupportTeam(actor.role)) return null;
  const client = getSupabaseServiceRoleClient();
  if (!client) return null;
  const { data: season, error } = await client.from("seasons").select("id").eq("code", SUPPORT_TEAM_SEASON_CODE).maybeSingle();
  if (error || !season?.id) return null;
  const seasonId = String(season.id);
  const scope = await getAdminScopeContext();
  if (!(await canOperateSeason(scope, seasonId))) return null;
  return { actor, client, seasonId };
}

export type SupportTeamPanelData = {
  seasonCode: string;
  state: SupportTeamPanelState;
  /** Số thư mời đặc cách đã gửi (khi người này nằm trong danh sách thư mời nhưng chưa xác nhận). */
  sendCount: number;
};

/**
 * Dữ liệu cho khung trên hồ sơ, hoặc null nếu người xem không được tích (khung ẩn hẳn — không mời
 * một nút mà máy chủ chắc chắn từ chối). Không ghi gì.
 */
export async function getSupportTeamPanel(personId: string): Promise<SupportTeamPanelData | null> {
  try {
    if (!UUID.test(String(personId ?? ""))) return null;
    const operator = await operatorForCurrentSeason();
    if (!operator) return null;
    const { data, error } = await operator.client
      .from("mentee_exemptions")
      .select("confirmed_at,revoked_at,send_count")
      .eq("season_id", operator.seasonId)
      .eq("person_id", personId)
      .maybeSingle();
    // Không đọc được trạng thái thì ẩn khung: hiện "chưa tích" cho một người đã tích là mời tích lần hai.
    if (error) {
      log("read exemption failed", error);
      return null;
    }
    const row = data
      ? { confirmedAt: data.confirmed_at ? String(data.confirmed_at) : null, revokedAt: data.revoked_at ? String(data.revoked_at) : null, sendCount: Number(data.send_count) || 0 }
      : null;
    return { seasonCode: SUPPORT_TEAM_SEASON_CODE, state: supportTeamPanelState(row), sendCount: row?.sendCount ?? 0 };
  } catch (error) {
    log("panel failed", error);
    return null;
  }
}

export type SupportTeamMarkResult = { ok: boolean; message: string };

/** Tích Support team cho một người. `personId` đến từ phía người gửi nên được kiểm lại ở đây và trong database. */
export async function markSupportTeam(input: { personId: unknown }): Promise<SupportTeamMarkResult> {
  const personId = String(input.personId ?? "").trim();
  if (!UUID.test(personId)) return { ok: false, message: "Thiếu mã người. Tải lại trang rồi thử lại." };
  try {
    const operator = await operatorForCurrentSeason();
    if (!operator) return { ok: false, message: supportTeamErrorMessage("ACCESS_DENIED") };
    const { data, error } = await operator.client.rpc("vam121_set_support_team", {
      p_actor: operator.actor.id,
      p_season: operator.seasonId,
      p_person: personId
    });
    if (error) return { ok: false, message: supportTeamErrorMessage(error.message) };
    const message = data?.ok === true ? supportTeamResultMessage(data?.code, SUPPORT_TEAM_SEASON_CODE) : null;
    // Không chắc kết quả thì KHÔNG báo thành công.
    if (!message) return { ok: false, message: "Chưa xác nhận được kết quả. Tải lại trang để kiểm tra." };
    return { ok: true, message };
  } catch (error) {
    log("mark failed", error);
    return { ok: false, message: supportTeamErrorMessage("") };
  }
}

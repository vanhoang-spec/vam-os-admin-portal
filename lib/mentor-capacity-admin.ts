import "server-only";

/**
 * Sửa số mentee tối đa một mentor nhận trong mùa (BTC 10/10/2026) — đường ghi hẹp:
 * chỉ cột mentor_profiles.capacity_target, qua RPC vam116_set_mentor_capacity.
 *
 * Không đi qua form "Sửa hồ sơ mentor": form đó ghi lại cả chục trường của người và hồ
 * sơ, nên một ô không có mặt trên màn hình sẽ đè lên giá trị đang đúng. Ở đây kiểm
 * quyền tại máy chủ, rồi database kiểm lại lần nữa (vai trò, quyền vận hành mùa, số cặp
 * đang hoạt động, số đang lưu).
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { MENTOR_CAPACITY_MAX, parseMentorCapacity } from "@/lib/mentor-capacity";
import { canEditMentorCapacity } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/** Mùa mà trần sức nhận đang áp: mùa đang tuyển và ghép cặp, cùng mùa với Vòng 2. */
export const MENTOR_CAPACITY_SEASON_CODE = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RPC_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: "Bạn không có quyền sửa số mentee tối đa của mentor mùa này.",
  INVALID_CAPACITY: `Số mentee tối đa phải là số nguyên từ 1 đến ${MENTOR_CAPACITY_MAX}.`,
  NOT_SEASON_MENTOR: "Người này không phải mentor đang tham dự mùa này nên chưa sửa được.",
  MENTOR_IDENTITY_AMBIGUOUS: "Người này không có đúng một hồ sơ mentor — báo quản trị viên kiểm tra trước khi sửa.",
  STALE_CAPACITY: "Số này vừa được người khác đổi — tải lại trang để xem số mới rồi sửa lại.",
  CAPACITY_BELOW_ACTIVE: "Mentor đang nhận nhiều mentee hơn số bạn nhập. Huỷ bớt cặp ở trang Ghép cặp trước, rồi mới hạ số này."
};

function rpcMessage(error: { message?: string } | null | undefined): string {
  const raw = String(error?.message ?? "");
  const code = Object.keys(RPC_MESSAGES).find((c) => raw.includes(c));
  return code ? RPC_MESSAGES[code] : "Không lưu được. Thử lại; nếu vẫn lỗi, báo quản trị viên.";
}

export type MentorCapacityResult = { ok: boolean; message: string };

/**
 * `expected` là số đang hiện trên màn hình lúc người dùng bấm (null = chưa khai);
 * `capacity` là số mới. Cả hai đến từ biểu mẫu nên được kiểm lại ở đây và trong database.
 */
export async function setMentorCapacity(input: { personId: unknown; expected: unknown; capacity: unknown }): Promise<MentorCapacityResult> {
  const personId = String(input.personId ?? "").trim();
  if (!UUID.test(personId)) return { ok: false, message: "Thiếu mã người. Tải lại trang rồi thử lại." };
  const capacity = parseMentorCapacity(input.capacity);
  if (capacity === null) return { ok: false, message: RPC_MESSAGES.INVALID_CAPACITY };
  const expectedText = String(input.expected ?? "").trim();
  let expected: number | null = null;
  if (expectedText !== "") {
    expected = Number(expectedText);
    if (!Number.isInteger(expected)) return { ok: false, message: RPC_MESSAGES.STALE_CAPACITY };
  }

  try {
    const actor = await getCurrentAdminUser();
    if (!actor?.id || !canEditMentorCapacity(actor.role)) return { ok: false, message: RPC_MESSAGES.ACCESS_DENIED };

    const client = getSupabaseServiceRoleClient();
    if (!client) return { ok: false, message: "Chưa kết nối được database. Thử lại sau." };
    const { data: season, error: seasonError } = await client.from("seasons").select("id").eq("code", MENTOR_CAPACITY_SEASON_CODE).maybeSingle();
    if (seasonError || !season?.id) return { ok: false, message: "Không xác định được mùa đang vận hành. Thử tải lại trang." };
    const seasonId = String(season.id);

    // Không đọc được phạm vi quyền thì coi như không có quyền.
    const scope = await getAdminScopeContext();
    if (!(await canOperateSeason(scope, seasonId))) return { ok: false, message: RPC_MESSAGES.ACCESS_DENIED };

    const { data, error } = await client.rpc("vam116_set_mentor_capacity", {
      p_actor: actor.id,
      p_season: seasonId,
      p_person: personId,
      p_expected: expected,
      p_capacity: capacity
    });
    if (error) return { ok: false, message: rpcMessage(error) };
    if (data?.ok !== true || data?.capacity !== capacity) {
      return { ok: false, message: "Chưa xác nhận được kết quả. Tải lại trang để kiểm tra." };
    }
    return {
      ok: true,
      message: data.changed === false ? `Số mentee tối đa vẫn là ${capacity}.` : `Đã lưu: tối đa ${capacity} mentee trong mùa này.`
    };
  } catch (error) {
    console.error("[mentor-capacity] set failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, message: "Không lưu được. Tải lại trang rồi thử lại." };
  }
}

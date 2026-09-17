"use server";
import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { isMembershipLifecycleOperation, isMembershipRole, isParticipationRole, membershipChangeDeniedMessage, membershipOperationNeedsReason, type MembershipLifecycleOperation, type MembershipLifecycleActionState } from "@/lib/membership-lifecycle";
import { canChangeSeasonMembership } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
const RPC_BY_OPERATION: Record<MembershipLifecycleOperation, string> = {
  pause: "vam063_pause_membership", reactivate: "vam063_reactivate_membership", withdraw: "vam063_withdraw_membership",
  opt_out: "vam063_opt_out_membership", cancel: "vam063_cancel_membership", remove_role: "vam063_remove_membership_role"
};
function value(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function uuid(input: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input); }
function safeRpcMessage(message: string) {
  if (message.includes("reason required")) return "Vui lòng nhập lý do cho thao tác này.";
  if (message.includes("invalid status transition")) return "Trạng thái membership đã thay đổi hoặc không hỗ trợ thao tác này.";
  if (message.includes("not authorized") || message.includes("unauthorized")) return "Bạn không có quyền operations trong program và season này.";
  if (message.includes("membership not found")) return "Không tìm thấy membership cần cập nhật.";
  if (message.includes("cross-program") || message.includes("program-season")) return "Program và season không hợp lệ cho membership này.";
  if (message.includes("unsupported participant role")) return "Vai trò membership không được hỗ trợ.";
  return "Không thể cập nhật membership an toàn. Vui lòng tải lại và thử lại.";
}
async function authorizedActor(seasonId: string) {
  const ctx = await getAdminScopeContext();
  const admin = ctx.adminUser ?? (await getCurrentAdminUser());
  if (!admin?.id || admin.status !== "active" || !(await canOperateSeason(ctx, seasonId))) return null;
  return admin;
}
// Danh sách Mentor/Mentee của mùa đọc từ chính các membership này.
function revalidateMembershipViews(personId: string) {
  revalidatePath(`/people/${personId}`, "page");
  revalidatePath("/mentors");
  revalidatePath("/mentees");
}
async function validateProgramSeason(client: any, programId: string, seasonId: string) {
  const { data, error } = await client.from("seasons").select("id,program_id").eq("id", seasonId).eq("program_id", programId).maybeSingle();
  return !error && Boolean(data?.id);
}
export async function transitionMembershipAction(_previous: MembershipLifecycleActionState, formData: FormData): Promise<MembershipLifecycleActionState> {
  const membershipId = value(formData, "membership_id"), personId = value(formData, "person_id");
  const expectedStatus = value(formData, "expected_status").toLowerCase(), operationText = value(formData, "operation"), reason = value(formData, "reason");
  if (!uuid(membershipId) || !uuid(personId) || !isMembershipLifecycleOperation(operationText)) return { ok: false, message: "Yêu cầu lifecycle không hợp lệ." };
  if (membershipOperationNeedsReason(operationText) && !reason) return { ok: false, message: "Vui lòng nhập lý do cho thao tác này." };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: "Dịch vụ lifecycle chưa sẵn sàng." };
  const { data: membership, error: membershipError } = await client.from("person_season_memberships").select("id,person_id,program_id,season_id,role,status").eq("id", membershipId).eq("person_id", personId).maybeSingle();
  if (membershipError || !membership) return { ok: false, message: "Không tìm thấy membership cần cập nhật." };
  if (String(membership.status).toLowerCase() !== expectedStatus) return { ok: false, message: "Trạng thái membership đã thay đổi. Vui lòng tải lại trang." };
  if (!(await validateProgramSeason(client, String(membership.program_id), String(membership.season_id)))) return { ok: false, message: "Membership không thuộc program và season hợp lệ." };
  const actor = await authorizedActor(String(membership.season_id));
  if (!actor) return { ok: false, message: "Bạn không có quyền operations trong program và season này." };
  // Vai trò lấy từ dòng đã lưu, không từ form: form nói "mentee" về một mentor là
  // đúng đường vòng qua phần chia mentor/mentee giữa Core Team và Support Team.
  if (!canChangeSeasonMembership(actor.role, membership.role)) return { ok: false, message: membershipChangeDeniedMessage(membership.role) };
  const { data, error } = await client.rpc(RPC_BY_OPERATION[operationText], { p_actor_admin_user_id: actor.id, p_membership_id: membershipId, p_reason: reason || null });
  if (error) return { ok: false, message: safeRpcMessage(String(error.message ?? "")) };
  const result = Array.isArray(data) ? data[0] : data, outcome = String(result?.outcome_status ?? "");
  if (outcome !== "transitioned" && outcome !== "noop") return { ok: false, message: "Lifecycle RPC không trả về kết quả hợp lệ." };
  revalidateMembershipViews(personId);
  if (outcome === "noop") return { ok: true, outcome, message: "Membership đã ở trạng thái yêu cầu; không tạo log trùng." };
  if (isParticipationRole(membership.role) && operationText === "opt_out") return { ok: true, outcome, message: "Đã chuyển sang Không tham dự và ghi lịch sử kiểm toán." };
  if (isParticipationRole(membership.role) && operationText === "reactivate") return { ok: true, outcome, message: "Đã chuyển sang Tham dự và ghi lịch sử kiểm toán." };
  return { ok: true, outcome, message: "Đã cập nhật membership và ghi lịch sử kiểm toán." };
}
export async function addMembershipRoleAction(_previous: MembershipLifecycleActionState, formData: FormData): Promise<MembershipLifecycleActionState> {
  const personId = value(formData, "person_id"), programId = value(formData, "program_id"), seasonId = value(formData, "season_id");
  const role = value(formData, "role"), reason = value(formData, "reason");
  if (![personId, programId, seasonId].every(uuid) || !isMembershipRole(role)) return { ok: false, message: "Program, season hoặc vai trò không hợp lệ." };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: "Dịch vụ lifecycle chưa sẵn sàng." };
  if (!(await validateProgramSeason(client, programId, seasonId))) return { ok: false, message: "Season không thuộc program đã chọn." };
  const actor = await authorizedActor(seasonId);
  if (!actor) return { ok: false, message: "Bạn không có quyền operations trong program và season này." };
  // Thêm vai trò mentor/mentee đang active cũng là chuyển một người sang "Tham dự".
  if (!canChangeSeasonMembership(actor.role, role)) return { ok: false, message: membershipChangeDeniedMessage(role) };
  const { data, error } = await client.rpc("vam063_add_membership_role", { p_actor_admin_user_id: actor.id, p_person_id: personId, p_program_id: programId, p_season_id: seasonId, p_role: role, p_reason: reason || null });
  if (error) return { ok: false, message: safeRpcMessage(String(error.message ?? "")) };
  const result = Array.isArray(data) ? data[0] : data, outcome = String(result?.outcome_status ?? "");
  if (outcome !== "created" && outcome !== "noop") return { ok: false, message: "Lifecycle RPC không trả về kết quả hợp lệ." };
  revalidateMembershipViews(personId);
  return { ok: true, outcome, message: outcome === "noop" ? "Vai trò đã tồn tại; không tạo membership hoặc log trùng." : "Đã thêm vai trò active và ghi lịch sử kiểm toán." };
}

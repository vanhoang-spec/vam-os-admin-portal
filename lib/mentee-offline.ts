import "server-only";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { SEASON_CONFIG } from "@/lib/season-config";
import { flattenRawPayload, humanizeKey } from "@/lib/application-export";
import { offlineError, parseOfflineQr, type OfflineActionResult, type OfflineDashboard } from "@/lib/mentee-offline-core";
import { sanitizeHandbookHtml } from "@/lib/handbook-html";
import type { InterviewGuide } from "@/lib/mentee-interview-rubric-core";
import { readAllPagesIn } from "@/lib/paged-read";

async function context() {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) throw new Error("ACCESS_DENIED");
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("DATABASE_UNAVAILABLE");
  const { data, error } = await client.from("seasons").select("id").eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).single();
  if (error || !data) throw new Error("SEASON_UNAVAILABLE");
  return { actor, client, seasonId: String(data.id) };
}

export async function getOfflineDashboard(): Promise<{ok: true; data: OfflineDashboard} | {ok: false; message: string}> {
  try {
    const { actor, client, seasonId } = await context();
    const [board, guide] = await Promise.all([
      client.rpc("vam104_offline_dashboard",{p_actor:actor.id,p_season:seasonId}),
      // Không kèm Handbook: màn hình làm mới sau mỗi thao tác, chở cả trang
      // hướng dẫn theo mỗi lần là phí. Trang Handbook đọc riêng.
      client.rpc("vam106_interview_guide",{p_actor:actor.id,p_season:seasonId,p_include_handbook:false})
    ]);
    if (board.error || !board.data) throw new Error(board.error?.message ?? "READ_FAILED");
    if (guide.error) throw new Error(guide.error.message);
    const dashboard = board.data as OfflineDashboard;
    dashboard.actorId=actor.id!;
    dashboard.seasonId=seasonId;
    dashboard.rubric=(guide.data as InterviewGuide | null)?.rubric ?? null;
    // Ai đã check-in cho từng bạn (BTC 04/10/2026): tên tài khoản Support/BTC. Danh sách
    // người phỏng vấn không chứa Support, nên đọc riêng đúng các tài khoản xuất hiện.
    const checkinIds = Array.from(new Set(dashboard.candidates.map(c => String(c.operation?.checked_in_by ?? "")).filter(Boolean)));
    const names = new Map<string,string>();
    if (checkinIds.length) {
      const staff = await readAllPagesIn<{id:string;full_name:string|null;email:string|null}>(client,"admin_users","id",checkinIds,"id,full_name,email");
      // Không đọc được tên thì vẫn mở màn hình — chỉ thiếu tên người check-in, không chặn ca phỏng vấn.
      if (!staff.error) for (const s of staff.data) names.set(String(s.id), String(s.full_name || s.email || ""));
    }
    dashboard.candidates=dashboard.candidates.map(c => ({...c,
      answers:flattenRawPayload(c.rawPayload ?? {}).map(({key,value}) => [humanizeKey(key),value]),
      rawPayload:null,
      operation: c.operation ? {...c.operation, checked_in_by_name: c.operation.checked_in_by ? names.get(String(c.operation.checked_in_by)) ?? null : null} : null
    }));
    return {ok:true,data:dashboard};
  } catch (error) {
    return {ok:false,message:offlineError(error instanceof Error ? error.message : "")};
  }
}

/** Phiếu + Handbook của mùa hiện hành cho trang hướng dẫn. Cùng cổng xem với màn hình phỏng vấn. */
export async function getInterviewGuide(): Promise<{ok: true; data: InterviewGuide; seasonCode: string} | {ok: false; message: string}> {
  try {
    const { actor, client, seasonId } = await context();
    const {data,error} = await client.rpc("vam106_interview_guide",{p_actor:actor.id,p_season:seasonId,p_include_handbook:true});
    if (error || !data) throw new Error(error?.message ?? "READ_FAILED");
    const guide = data as InterviewGuide;
    // Lọc lại lúc hiển thị dù đã lọc lúc lưu: dòng trong database không phải
    // lúc nào cũng đi qua đúng đường lưu của ứng dụng.
    if (guide.rubric?.handbookHtml) guide.rubric.handbookHtml = sanitizeHandbookHtml(guide.rubric.handbookHtml);
    return {ok:true,data:guide,seasonCode:SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE};
  } catch (error) {
    return {ok:false,message:offlineError(error instanceof Error ? error.message : "")};
  }
}

export async function saveOfflineInterview(input: {applicationId: string; action: string; revision: number; values: Record<string, unknown>}): Promise<OfflineActionResult> {
  try {
    const {actor,client} = await context();
    const call = (revision: number) => client.rpc("vam104_save_offline_interview",{
      p_actor:actor.id,p_application:input.applicationId,p_action:input.action,p_revision:revision,p_values:input.values
    });
    let {data,error} = await call(input.revision);
    // Lưu KẾT QUẢ bị STALE_REVISION (sự cố 03/10/2026): mentor chấm 15–20 phút, trong
    // lúc đó Support đổi phòng/bàn/online của chính hồ sơ này → phiên bản tăng, phiếu
    // bị từ chối, mentor tải lại và mất hết. Gửi lại MỘT lần với phiên bản mới nhất,
    // chỉ khi vẫn an toàn: hồ sơ còn phân cho đúng mentor này, đã check-in và CHƯA có
    // kết quả — tức không có kết quả nào của ai bị đè. Database vẫn tự kiểm mọi luật.
    if (error && input.action === "result" && String(error.message).includes("STALE_REVISION")) {
      const {data:fresh} = await client.from("mentee_interview_operations")
        .select("revision,interviewer_id,outcome,checked_in_at").eq("id",input.applicationId).maybeSingle();
      if (fresh && fresh.interviewer_id===actor.id && fresh.checked_in_at && fresh.outcome==null) {
        ({data,error} = await call(Number(fresh.revision)));
      } else if (fresh && fresh.interviewer_id===actor.id && fresh.outcome!=null) {
        return {ok:false,message:"Kết quả của bạn cho mentee này đã được lưu trước đó. Tải lại trang để xem — muốn sửa thì bấm “Sửa kết quả”."};
      }
    }
    if (error) {
      if (error.code==="23505") return {ok:false,message:"Bàn/người phỏng vấn đã được phân trong ca, hoặc mentee đã có mentor. Tải lại để kiểm tra."};
      throw new Error(error.message);
    }
    if (!data?.ok) throw new Error("WRITE_FAILED");
    return {ok:true,message:String(data.message)};
  } catch (error) {
    return {ok:false,message:offlineError(error instanceof Error ? error.message : "")};
  }
}

export async function lookupOfflineTicket(scanned: string): Promise<OfflineActionResult> {
  const code=parseOfflineQr(scanned);
  if (!code) return {ok:false,message:"Mã này không phải vé phỏng vấn mentee."};
  try {
    const {actor,client,seasonId}=await context();
    const {data,error}=await client.rpc("vam104_lookup_offline_ticket",{p_actor:actor.id,p_season:seasonId,p_code:code});
    if (error) throw new Error(error.message);
    return data ? {ok:true,message:"Đã tìm thấy vé. Kiểm tra thông tin rồi check-in.",applicationId:String(data)}
      : {ok:false,message:"Không tìm thấy vé đang hiệu lực. Có thể tìm bằng số điện thoại."};
  } catch (error) { return {ok:false,message:offlineError(error instanceof Error ? error.message : "")}; }
}

/**
 * BTC/Support đổi ca cho một mentee — kể cả sau hạn tự đổi ca. Mọi chặn (còn chỗ,
 * ca chưa bắt đầu, chưa check-in, bắt buộc lý do) nằm trong vam107, chạy nguyên tử.
 */
export async function moveMenteeBooking(input: {applicationId: string; sessionId: string; reason: string}): Promise<OfflineActionResult> {
  try {
    const {actor,client} = await context();
    const {data,error} = await client.rpc("vam107_move_mentee_booking",{
      p_actor:actor.id,p_application:input.applicationId,p_session:input.sessionId,p_reason:input.reason
    });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error("WRITE_FAILED");
    return {ok:true,message:String(data.message)};
  } catch (error) {
    return {ok:false,message:offlineError(error instanceof Error ? error.message : "")};
  }
}

export async function cancelMenteeBooking(input: {applicationId: string; reason: string}): Promise<OfflineActionResult> {
  try {
    const {actor,client} = await context();
    const {data,error} = await client.rpc("vam105_cancel_mentee_booking",{
      p_actor:actor.id,p_application:input.applicationId,p_reason:input.reason
    });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error("WRITE_FAILED");
    return {ok:true,message:String(data.message)};
  } catch (error) {
    return {ok:false,message:offlineError(error instanceof Error ? error.message : "")};
  }
}

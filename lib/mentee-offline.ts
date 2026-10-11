import "server-only";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { SEASON_CONFIG } from "@/lib/season-config";
import { flattenRawPayload, humanizeKey } from "@/lib/application-export";
import { offlineError, parseOfflineQr, type OfflineActionResult, type OfflineDashboard, type OfflineDetailResult, type OfflineReview } from "@/lib/mentee-offline-core";
import { interviewWaves, resolveOfflineWave } from "@/lib/mentee-interview-waves";
import { vietnamDateKey } from "@/lib/utils";
import { sanitizeHandbookHtml } from "@/lib/handbook-html";
import type { InterviewGuide } from "@/lib/mentee-interview-rubric-core";
import { readAllPagesIn } from "@/lib/paged-read";
import { reportRowsFrom, type ReportRow } from "@/lib/mentee-interview-report-core";

async function context() {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) throw new Error("ACCESS_DENIED");
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("DATABASE_UNAVAILABLE");
  const { data, error } = await client.from("seasons").select("id").eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).single();
  if (error || !data) throw new Error("SEASON_UNAVAILABLE");
  return { actor, client, seasonId: String(data.id) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ai đang hỏi dữ liệu. Màn hình phỏng vấn chỉ cần ứng viên của MỘT đợt (đợt trên
 * đường dẫn); trang Tiến độ cần mọi đợt nhưng không cần nhật ký hay phiếu chấm.
 */
export type OfflineDashboardScope =
  | { kind: "interview"; application?: string | null; dot?: string | null }
  | { kind: "progress" };

type OfflineClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

/**
 * Các ca của đợt mà màn hình phỏng vấn sẽ hiện. Hai lần đọc này CHỈ để chọn đợt cần
 * tải — không dòng nào của chúng được hiển thị; quyền xem vẫn do vam118_offline_board
 * quyết định ở bước sau. null = mùa chưa có ca nào (không có gì để lọc).
 */
async function waveSessionIds(client: OfflineClient, seasonId: string, scope: { application?: string | null; dot?: string | null }): Promise<string[] | null> {
  const sessions = await client.from("interview_sessions").select("id,starts_at").eq("season_id", seasonId);
  // Không đọc được lịch ca thì không đoán đợt: tải nhầm đợt là màn hình hiện danh sách rỗng giữa buổi phỏng vấn.
  if (sessions.error) throw new Error("READ_FAILED");
  let linkedSessionId: string | null = null;
  const application = String(scope.application ?? "");
  // ?application= đến từ đường dẫn — ai cũng gõ được; không phải UUID thì đừng đem đi hỏi database.
  if (!scope.dot && UUID.test(application)) {
    const booking = await client.from("mentee_interview_bookings").select("session_id")
      .eq("season_id", seasonId).eq("application_id", application).eq("status", "booked").maybeSingle();
    // Không tra được ca của hồ sơ thì mở đợt hiện tại — vẫn là một màn hình dùng được.
    linkedSessionId = booking.error ? null : (booking.data?.session_id ? String(booking.data.session_id) : null);
  }
  const waves = interviewWaves((sessions.data ?? []).map((s) => ({ id: String(s.id), starts_at: String(s.starts_at) })));
  const wave = resolveOfflineWave(waves, { dot: scope.dot, linkedSessionId, todayKey: vietnamDateKey(new Date()) ?? "" });
  return wave ? wave.sessionIds : null;
}

/**
 * Danh sách gọn cho màn hình phỏng vấn và trang Tiến độ (11/10/2026). Không còn chở
 * đơn đăng ký và phiếu chấm của mọi ứng viên — hồ sơ chi tiết của từng bạn tải riêng
 * bằng getOfflineCandidateDetail khi mở.
 */
export async function getOfflineDashboard(scope: OfflineDashboardScope): Promise<{ok: true; data: OfflineDashboard} | {ok: false; message: string}> {
  try {
    const { actor, client, seasonId } = await context();
    const interview = scope.kind === "interview";
    const sessionIds = interview ? await waveSessionIds(client, seasonId, scope) : null;
    const [board, guide] = await Promise.all([
      client.rpc("vam118_offline_board",{p_actor:actor.id,p_season:seasonId,p_sessions:sessionIds,p_with_logs:interview}),
      // Không kèm Handbook: màn hình làm mới sau mỗi thao tác, chở cả trang
      // hướng dẫn theo mỗi lần là phí. Trang Handbook đọc riêng. Trang Tiến độ
      // không chấm nên không cần phiếu.
      interview
        ? client.rpc("vam106_interview_guide",{p_actor:actor.id,p_season:seasonId,p_include_handbook:false})
        : Promise.resolve({data:null,error:null})
    ]);
    if (board.error || !board.data) throw new Error(board.error?.message ?? "READ_FAILED");
    if (guide.error) throw new Error(guide.error.message);
    const dashboard = board.data as OfflineDashboard;
    dashboard.actorId=actor.id!;
    dashboard.seasonId=seasonId;
    dashboard.rubric=(guide.data as InterviewGuide | null)?.rubric ?? null;
    dashboard.logs=dashboard.logs ?? [];
    // Ai đã check-in cho từng bạn (BTC 04/10/2026): tên tài khoản Support/BTC. Danh sách
    // người phỏng vấn không chứa Support, nên đọc riêng đúng các tài khoản xuất hiện.
    const checkinIds = Array.from(new Set(dashboard.candidates.map(c => String(c.operation?.checked_in_by ?? "")).filter(Boolean)));
    const names = new Map<string,string>();
    if (checkinIds.length) {
      const staff = await readAllPagesIn<{id:string;full_name:string|null;email:string|null}>(client,"admin_users","id",checkinIds,"id,full_name,email");
      // Không đọc được tên thì vẫn mở màn hình — chỉ thiếu tên người check-in, không chặn ca phỏng vấn.
      if (!staff.error) for (const s of staff.data) names.set(String(s.id), String(s.full_name || s.email || ""));
    }
    // `answers` cố ý vắng mặt: đó là dấu hiệu "hồ sơ chi tiết chưa tải" cho màn hình.
    dashboard.candidates=dashboard.candidates.map(c => ({...c,
      reviews:[],
      operation: c.operation ? {...c.operation, checked_in_by_name: c.operation.checked_in_by ? names.get(String(c.operation.checked_in_by)) ?? null : null} : null
    }));
    return {ok:true,data:dashboard};
  } catch (error) {
    return {ok:false,message:offlineError(error instanceof Error ? error.message : "")};
  }
}

/**
 * Đơn đăng ký + mọi phiếu chấm chưa huỷ của MỘT ứng viên — màn hình gọi khi mở hồ sơ
 * bạn đó. Cùng cổng quyền với danh sách (vam104_offline_access, kiểm trong database),
 * và chỉ mở được hồ sơ đang giữ ca trong mùa.
 */
export async function getOfflineCandidateDetail(applicationId: string): Promise<OfflineDetailResult> {
  try {
    if (!UUID.test(String(applicationId ?? ""))) throw new Error("NO_BOOKING");
    const { actor, client, seasonId } = await context();
    const {data,error} = await client.rpc("vam118_offline_candidate_detail",{p_actor:actor.id,p_season:seasonId,p_application:applicationId});
    if (error || !data) throw new Error(error?.message ?? "READ_FAILED");
    const row = data as {rawPayload: Record<string, unknown> | null; reviews: OfflineReview[] | null};
    return {ok:true,detail:{
      answers:flattenRawPayload(row.rawPayload ?? {}).map(({key,value}) => [humanizeKey(key),value]),
      reviews:row.reviews ?? []
    }};
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // offlineError nói "Chưa lưu được" cho lỗi lạ — đúng cho thao tác ghi, sai cho một lần đọc.
    return {ok:false,message:message.includes("ACCESS_DENIED") || message.includes("NO_BOOKING")
      ? offlineError(message)
      : "Chưa tải được hồ sơ của bạn này. Kiểm tra mạng rồi bấm “Tải lại hồ sơ”."};
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
      if (error.code==="23505") return {ok:false,message:"Mentee đã có mentor, hoặc hồ sơ vừa được cập nhật ở thiết bị khác. Tải lại để kiểm tra."};
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

/**
 * Dữ liệu cho báo cáo phỏng vấn mentee theo đợt (BTC 06/10/2026). Cùng RPC, cùng
 * cổng với màn hình phỏng vấn và trang tiến độ; chỉ trả về dòng đã rút gọn — không
 * tên, không SĐT, không câu trả lời đơn của mentee.
 *
 * Trạng thái cặp ghép đọc riêng: màn hình phỏng vấn giữ match_id cả khi BTC đã huỷ
 * cặp. Không đọc được thì báo lỗi chứ không đoán — "bao nhiêu bạn được mentor chọn
 * ngay" là đúng con số BTC hỏi, đếm nhầm là sai cả mục so sánh.
 */
export async function getInterviewReportData(): Promise<
  {ok: true; data: {canOperate: boolean; sessions: OfflineDashboard["sessions"]; rows: ReportRow[]}} | {ok: false; message: string}
> {
  try {
    const { actor, client, seasonId } = await context();
    const board = await client.rpc("vam104_offline_dashboard",{p_actor:actor.id,p_season:seasonId});
    if (board.error || !board.data) throw new Error(board.error?.message ?? "READ_FAILED");
    const dashboard = board.data as OfflineDashboard;
    const matchIds = (dashboard.candidates ?? []).map(c => String(c.operation?.match_id ?? "")).filter(Boolean);
    const active = new Set<string>();
    if (matchIds.length) {
      const matches = await readAllPagesIn<{id:string;status:string}>(client,"matches","id",matchIds,"id,status");
      if (matches.error) throw new Error("READ_FAILED");
      for (const m of matches.data) if (m.status === "active") active.add(String(m.id));
    }
    return {ok:true,data:{
      canOperate:Boolean(dashboard.canOperate),
      sessions:dashboard.sessions ?? [],
      rows:reportRowsFrom(dashboard.candidates ?? [],active)
    }};
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // offlineError nói "Chưa lưu được" cho lỗi lạ — đúng cho thao tác ghi, sai cho một trang chỉ đọc.
    return {ok:false,message:message.includes("ACCESS_DENIED") ? offlineError(message) : "Chưa đọc được dữ liệu phỏng vấn. Tải lại trang sau ít phút."};
  }
}

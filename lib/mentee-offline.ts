import "server-only";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { SEASON_CONFIG } from "@/lib/season-config";
import { flattenRawPayload, humanizeKey } from "@/lib/application-export";
import { offlineError, parseOfflineQr, type OfflineActionResult, type OfflineDashboard } from "@/lib/mentee-offline-core";

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
    const {data,error} = await client.rpc("vam104_offline_dashboard",{p_actor:actor.id,p_season:seasonId});
    if (error || !data) throw new Error(error?.message ?? "READ_FAILED");
    const dashboard = data as OfflineDashboard;
    dashboard.actorId=actor.id!;
    dashboard.seasonId=seasonId;
    dashboard.candidates=dashboard.candidates.map(c => ({...c,
      answers:flattenRawPayload(c.rawPayload ?? {}).map(({key,value}) => [humanizeKey(key),value]),
      rawPayload:null
    }));
    return {ok:true,data:dashboard};
  } catch (error) {
    return {ok:false,message:offlineError(error instanceof Error ? error.message : "")};
  }
}

export async function saveOfflineInterview(input: {applicationId: string; action: string; revision: number; values: Record<string, unknown>}): Promise<OfflineActionResult> {
  try {
    const {actor,client} = await context();
    const {data,error} = await client.rpc("vam104_save_offline_interview",{
      p_actor:actor.id,p_application:input.applicationId,p_action:input.action,p_revision:input.revision,p_values:input.values
    });
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

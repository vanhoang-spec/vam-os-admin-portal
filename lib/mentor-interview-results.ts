import "server-only";
import {getCurrentAdminUser} from "@/lib/admin-auth";
import {canAssignReview,canSelfClaimInterview} from "@/lib/permissions";
import {canBrowseApplications} from "@/lib/read-access";
import {getAdminScopeContext,canReadSeason,canReviewSeason,canOperateSeason} from "@/lib/program-scope";
import {getSupabaseServiceRoleClient} from "@/lib/supabase-server";
import {readAllPages} from "@/lib/paged-read";
import {MENTOR_RESULTS_SEASON,type MentorInterviewResult,type MentorDecision,type MentorResultsData} from "@/lib/mentor-interview-results-core";

type Result={ok:true;data:MentorResultsData}|{ok:false;status:number;message:string};
// Đọc phiếu đã lưu, KHÔNG lọc trạng thái application: duyệt/rớt vẫn tìm lại được.
export async function getMentorInterviewResults(forExport=false):Promise<Result> {
  try {
    const actor=await getCurrentAdminUser();
    if(!actor?.id) return {ok:false,status:401,message:"Vui lòng đăng nhập."};
    if(!(canSelfClaimInterview(actor.role)||canBrowseApplications(actor.role)) || (forExport&&!canAssignReview(actor.role)))
      return {ok:false,status:403,message:"Bạn không có quyền xem hoặc xuất kết quả này."};
    const ctx=await getAdminScopeContext();
    if(ctx.scopeError) return {ok:false,status:503,message:"Chưa xác minh được phạm vi truy cập. Vui lòng thử lại."};
    const client=getSupabaseServiceRoleClient();
    if(!client) throw new Error("database unavailable");
    const season=await client.from("seasons").select("id").eq("code",MENTOR_RESULTS_SEASON).single();
    if(season.error||!season.data?.id) throw new Error("season unavailable");
    const seasonId=String(season.data.id);
    const isReviewer=actor.role==="reviewer";
    const canOperate=await canOperateSeason(ctx,seasonId);
    const allowed=isReviewer ? canOperate||await canReviewSeason(ctx,seasonId) : await canReadSeason(ctx,seasonId);
    const canExport=canAssignReview(actor.role)&&canOperate;
    if(!allowed||(forExport&&!canExport)) return {ok:false,status:403,message:"Bạn chưa được cấp quyền phù hợp trong mùa 12."};
    const reviews=await readAllPages<MentorInterviewResult>("application_reviews",`
      id,application_id,status,submitted_at,updated_at,reviewer_admin_user_id,
      score_motivation,score_goal_clarity,score_commitment,score_fit,score_communication,total_score,recommendation,reviewer_note,
      reviewer:admin_users!application_reviews_reviewer_admin_user_id_fkey(full_name,email),
      application:applications!inner(id,full_name,email_primary,phone_primary,status,season_id,intake_batch_id)
    `,(columns)=>{
      let q=client.from("application_reviews").select(columns).eq("review_round","interview")
        .in("status",["in_progress","submitted","returned_for_clarification"])
        .eq("application.season_id",seasonId).eq("application.role_applied","mentor");
      if(isReviewer) q=q.eq("reviewer_admin_user_id",actor.id);
      return q;
    });
    if(reviews.error) throw new Error("reviews read failed");
    const rows=[...reviews.data].sort((a,b)=>String(b.submitted_at||b.updated_at||"").localeCompare(String(a.submitted_at||a.updated_at||""))||a.id.localeCompare(b.id));
    const decisions:MentorDecision[]=[];
    // Quyết định BTC chỉ cho đội vận hành; interviewer chỉ xem phiếu của mình.
    if(!isReviewer) {
      const appIds=Array.from(new Set(rows.map(r=>r.application_id)));
      for(let offset=0;offset<appIds.length;offset+=50) {
        const ids=appIds.slice(offset,offset+50);
        const read=await readAllPages<MentorDecision>("application_decisions","id,application_id,decided_by_name,new_status,decision_note,created_at",
          columns=>client.from("application_decisions").select(columns).in("application_id",ids));
        if(read.error) throw new Error("decisions read failed");
        decisions.push(...read.data);
      }
      decisions.sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
    }
    return {ok:true,data:{rows,decisions,canExport,isReviewer,generatedAt:new Date().toISOString()}};
  } catch {
    return {ok:false,status:500,message:"Không tải được đầy đủ kết quả phỏng vấn. Vui lòng thử lại; chưa xuất dữ liệu thiếu."};
  }
}

import type {MentorInterviewResult,MentorResultsData} from "@/lib/mentor-interview-results-core";
export function mentorResult(over:Partial<MentorInterviewResult>={}):MentorInterviewResult {
  return {id:"r1",application_id:"a1",status:"submitted",submitted_at:"2026-09-27T03:00:00Z",updated_at:"2026-09-27T03:00:00Z",reviewer_admin_user_id:"interviewer",
    score_motivation:4,score_goal_clarity:3,score_commitment:4,score_fit:2,score_communication:4,total_score:17,recommendation:"reject",
    reviewer_note:"Cần thêm thời gian cho cam kết.\nChưa phù hợp mùa này.",reviewer:{full_name:"Interviewer mẫu",email:"interviewer@example.test"},
    application:{id:"a1",full_name:"Mentor mẫu",email_primary:"mentor@example.test",phone_primary:"0900000000",status:"rejected_or_not_fit",season_id:"s12",intake_batch_id:"batch"},...over};
}
export function mentorReport():MentorResultsData {return {rows:[mentorResult()],decisions:[{id:"d1",application_id:"a1",decided_by_name:"Core team",new_status:"rejected_or_not_fit",decision_note:"Cần ưu tiên khả năng đồng hành đều đặn.",created_at:"2026-09-27T04:00:00Z"}],canExport:true,isReviewer:false,generatedAt:"2026-09-27T05:00:00Z"};}

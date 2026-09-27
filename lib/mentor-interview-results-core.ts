import { applicationStatusLabel } from "@/lib/ui-labels";
import { recommendationLabel, reviewStatusLabel } from "@/lib/screening-decision";
import { formatDateTime } from "@/lib/utils";

export const MENTOR_RESULTS_PATH = "/interviews/ket-qua-mentor";
export const MENTOR_RESULTS_SEASON = "UEHM-S12";
export const RESULT_SCORE_FIELDS = [
  ["score_motivation", "Động lực"], ["score_goal_clarity", "Mục tiêu"],
  ["score_commitment", "Cam kết"], ["score_fit", "Phù hợp"], ["score_communication", "Giao tiếp"]
] as const;
export type MentorInterviewResult = {
  id: string; application_id: string; status: string; submitted_at: string | null; updated_at: string | null;
  reviewer_admin_user_id: string | null;
  score_motivation: number | null; score_goal_clarity: number | null; score_commitment: number | null;
  score_fit: number | null; score_communication: number | null; total_score: number | null;
  recommendation: string | null; reviewer_note: string | null;
  reviewer: {full_name: string | null; email: string | null} | null;
  application: {id: string; full_name: string | null; email_primary: string | null; phone_primary: string | null;
    status: string; season_id: string; intake_batch_id: string | null};
};
export type MentorDecision = {id:string;application_id:string;decided_by_name:string|null;new_status:string;decision_note:string|null;created_at:string};
export type MentorResultsData = {rows:MentorInterviewResult[];decisions:MentorDecision[];canExport:boolean;isReviewer:boolean;generatedAt:string};
export function decisionText(data:MentorResultsData,applicationId:string) {
  return data.decisions.filter(d=>d.application_id===applicationId).map(d=>
    `${formatDateTime(d.created_at)} · ${d.decided_by_name||"BTC"} · ${applicationStatusLabel(d.new_status)}\n${d.decision_note||"Không ghi chú"}`
  ).join("\n\n");
}
export const MENTOR_RESULT_HEADERS = ["Mã hồ sơ","Họ tên mentor","Email","Số điện thoại","Trạng thái hồ sơ hiện tại","Interviewer","Email interviewer","Trạng thái phiếu","Ngày nộp phiếu","Cập nhật gần nhất",...RESULT_SCORE_FIELDS.map(([,label])=>`Điểm ${label}`),"Tổng điểm /25","Đề xuất interviewer","Nhận xét phỏng vấn","Quyết định và ghi chú BTC","Mã phiếu"];
export function mentorResultCells(data:MentorResultsData,row:MentorInterviewResult):(string|number)[] {
  return [row.application_id,row.application.full_name||"",row.application.email_primary||"",row.application.phone_primary||"",
    applicationStatusLabel(row.application.status),row.reviewer?.full_name||"Chưa xác định",row.reviewer?.email||"",reviewStatusLabel(row.status),
    row.submitted_at?formatDateTime(row.submitted_at):"",row.updated_at?formatDateTime(row.updated_at):"",
    ...RESULT_SCORE_FIELDS.map(([key])=>row[key]??""),row.total_score??"",recommendationLabel(row.recommendation),row.reviewer_note||"",decisionText(data,row.application_id),row.id];
}

import type { ExportApplication, ExportBooking, ExportDataset, ExportOperation, ExportReview, ExportSession } from "@/lib/mentee-offline-export-core";

/** Mã hợp lệ dạng UUID cho dữ liệu thử: 8-4-4-4-12 chữ số hex. */
export const uuid = (n: number, kind = 0) => `${String(kind).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const SESSION_A = uuid(1, 9);
export const SESSION_B = uuid(2, 9);
export const STAFF_HOA = uuid(1, 7);
export const STAFF_BINH = uuid(2, 7);
export const STAFF_OLD = uuid(3, 7);

export function review(partial: Partial<ExportReview> & Pick<ExportReview, "id" | "application_id" | "review_round">): ExportReview {
  return {
    reviewer_admin_user_id: STAFF_HOA,
    status: "submitted",
    score_motivation: null,
    score_goal_clarity: null,
    score_commitment: null,
    score_fit: null,
    score_communication: null,
    total_score: null,
    recommendation: null,
    reviewer_note: null,
    interview_scores: null,
    weighted_score: null,
    key_development_need: null,
    expectation_alignment: null,
    alignment_note: null,
    take_choice: null,
    desired_mentor_profile: null,
    additional_note: null,
    submitted_at: "2026-10-03T03:00:00Z",
    created_at: "2026-10-01T03:00:00Z",
    updated_at: "2026-10-03T03:00:00Z",
    ...partial
  };
}

export const SCORES_V4 = [
  { key: "need", label: "Nhu cầu Mentoring", weight: 30, score: 4, note: "Nêu rõ nhu cầu" },
  { key: "readiness", label: "Sẵn sàng học hỏi", weight: 70, score: 5, note: "Rất cởi mở" }
];

/** Ba mentee: An (đủ hai vòng, đã đổi người chấm vòng hồ sơ), Bình (chỉ vòng hồ sơ), Chi (chưa có phiếu nào). */
export function dataset(): ExportDataset {
  const applications: ExportApplication[] = [
    { id: uuid(1), full_name: "Nguyễn Văn An", email_primary: "an@example.test", phone_primary: "0900000001", status: "approved_as_mentee", raw_payload: { major: "Tài chính", cv_url: "https://drive.example.test/cv-an", mssv: "31241000001" } },
    { id: uuid(2), full_name: "Trần Thị Bình", email_primary: "binh@example.test", phone_primary: "0900000002", status: "interview_passed", raw_payload: { major: "Marketing", portfolio: "=HYPERLINK(\"https://x.test\")" } },
    { id: uuid(3), full_name: "Đặng Chi", email_primary: "chi@example.test", phone_primary: "0900000003", status: "submitted", raw_payload: null }
  ];
  const bookings: ExportBooking[] = [
    { application_id: uuid(2), session_id: SESSION_B },
    { application_id: uuid(1), session_id: SESSION_A },
    { application_id: uuid(3), session_id: SESSION_A }
  ];
  const sessions: ExportSession[] = [
    { id: SESSION_A, starts_at: "2026-10-03T02:00:00Z", venue: "Phòng B1.503, B1.504 — Cơ sở B" },
    { id: SESSION_B, starts_at: "2026-10-04T02:00:00Z", venue: null }
  ];
  const operations: ExportOperation[] = [
    { id: uuid(1), outcome: "passed", outcome_reason: "Phù hợp", checked_in_at: "2026-10-03T01:50:00Z", room: 2, desk: 3, is_online: false },
    { id: uuid(2), outcome: "needs_review", outcome_reason: null, checked_in_at: null, room: null, desk: null, is_online: true }
  ];
  const reviews: ExportReview[] = [
    // An: người chấm vòng hồ sơ CŨ đã bị huỷ, người hiện tại là Hoà.
    review({ id: uuid(11, 5), application_id: uuid(1), review_round: "profile_screening", reviewer_admin_user_id: STAFF_OLD, status: "cancelled", recommendation: "reject", reviewer_note: "ghi chú của người cũ", total_score: 5 }),
    review({ id: uuid(12, 5), application_id: uuid(1), review_round: "profile_screening", reviewer_admin_user_id: STAFF_HOA, recommendation: "pass_to_interview", total_score: 21, score_motivation: 5, score_goal_clarity: 4, score_commitment: 4, score_fit: 4, score_communication: 4, reviewer_note: "Hồ sơ tốt" }),
    review({ id: uuid(13, 5), application_id: uuid(1), review_round: "interview", reviewer_admin_user_id: STAFF_BINH, recommendation: "approve_recommended", interview_scores: SCORES_V4, weighted_score: "4.70", reviewer_note: "Rất phù hợp", key_development_need: "Tự tin hơn", expectation_alignment: "aligned", alignment_note: "Kỳ vọng rõ", take_choice: "take", desired_mentor_profile: "Mentor tài chính", additional_note: "Ưu tiên ghép sớm" }),
    // Bình: chỉ vòng hồ sơ, người chấm là Bình.
    review({ id: uuid(14, 5), application_id: uuid(2), review_round: "profile_screening", reviewer_admin_user_id: STAFF_BINH, recommendation: "waitlist", total_score: 14 })
  ];
  const staffNames = new Map([[STAFF_HOA, "Lê Hoà"], [STAFF_BINH, "Phạm Bình"], [STAFF_OLD, "Người Cũ"]]);
  return { applications, bookings, sessions, operations, reviews, staffNames };
}

import type { ExpectationAlignment, InterviewRubric, InterviewScore, TakeChoice } from "@/lib/mentee-interview-rubric-core";

export const OFFLINE_PATH = "/interviews/mentee-offline";
export const OFFLINE_GUIDE_PATH = "/interviews/mentee-offline/huong-dan";
export const RUBRIC_EDITOR_PATH = "/interviews/phieu-cham-mentee";

/**
 * 5 tiêu chí của VÒNG HỒ SƠ (profile_screening) — chỉ còn dùng để hiện điểm vòng
 * hồ sơ trong màn hình phỏng vấn, và để đọc phiếu phỏng vấn trực tiếp cũ nộp trước
 * khi có phiếu theo mùa (interview_scores null, điểm nằm ở 5 cột score_*).
 * Phiếu phỏng vấn hiện hành là dữ liệu theo mùa (mentee_interview_rubrics).
 */
export const PROFILE_SCREENING_SCORES = [
  ["score_motivation", "Động lực tham gia"],
  ["score_goal_clarity", "Mục tiêu rõ ràng"],
  ["score_commitment", "Mức độ cam kết"],
  ["score_fit", "Mức độ phù hợp"],
  ["score_communication", "Giao tiếp"]
] as const;
export const OFFLINE_OUTCOMES = { passed: "Đạt làm mentee", rejected: "Không chọn làm mentee", needs_review: "Cần BTC xem xét thêm" };
export type OfflineOutcome = keyof typeof OFFLINE_OUTCOMES;
export type OfflineReview = {
  id: string; review_round: string; reviewerName: string; status: string;
  score_motivation: number | null; score_goal_clarity: number | null; score_commitment: number | null;
  score_fit: number | null; score_communication: number | null; total_score: number | null;
  recommendation: string | null; reviewer_note: string | null;
  interview_scores?: InterviewScore[] | null; rubric_version?: number | null; weighted_score?: number | string | null;
  key_development_need?: string | null; expectation_alignment?: ExpectationAlignment | null; alignment_note?: string | null;
  take_choice?: TakeChoice | null; desired_mentor_profile?: string | null; additional_note?: string | null;
};
export type OfflineOperation = {
  checked_in_at: string | null; room: number | null; desk: number | null;
  interviewer_id: string | null; review_id: string | null; outcome: OfflineOutcome | null;
  match_id: string | null; revision: number;
  outcome_reason?: string | null;
  is_online: boolean; online_note: string | null;
};
export type OfflineCandidate = {
  id: string; name: string; phone: string | null; email: string | null; status: string;
  sessionId: string; bookedAt: string; rawPayload: Record<string, unknown> | null;
  answers: Array<[string, string]>; operation: OfflineOperation | null; reviews: OfflineReview[];
};
export type OfflineDashboard = {
  actorId: string; seasonId: string; canOperate: boolean;
  /** Phiếu chấm hiệu lực của mùa (riêng, hoặc kế thừa phiếu lưu gần nhất). null = chưa có phiếu nào. */
  rubric: InterviewRubric | null;
  sessions: Array<{id: string; starts_at: string; ends_at: string; venue: string | null; seat_limit: number | null}>;
  participants: Array<{id: string; full_name: string; email: string; capacity: number | null; activeMatches: number}>;
  candidates: OfflineCandidate[];
  logs: Array<{id: string; application_id: string; actor_name: string; candidate_name: string; action: string; reason: string | null;
    created_at: string; before_data: unknown; after_data: unknown}>;
};
export type OfflineActionResult = { ok: boolean; message: string; applicationId?: string };
export function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("84") ? `0${digits.slice(2)}` : digits;
}
export function parseOfflineQr(value: string): string | null {
  const match = /^VAM-PV:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value.trim());
  return match?.[1] ?? null;
}
export function offlineError(message: string): string {
  const errors: Record<string,string> = {
    ACCESS_DENIED: "Bạn chưa được cấp quyền phỏng vấn trong mùa này.",
    STALE_REVISION: "Thông tin vừa được cập nhật trên thiết bị khác. Tải lại trước khi lưu.",
    NO_BOOKING: "Bạn này chưa có ca phỏng vấn đang hiệu lực.",
    APPLICATION_WITHDRAWN: "Hồ sơ đã rút, không thể thao tác.",
    CHECKIN_REQUIRED: "Cần check-in và phân người phỏng vấn trước khi chấm.",
    NOT_ASSIGNED: "Chỉ người được phân công mới lưu hoặc sửa kết quả này.",
    INVALID_ASSIGNMENT: "Chọn phòng, bàn và người phỏng vấn hợp lệ.",
    ALREADY_SCORED: "Đã có kết quả, không thể đổi người phỏng vấn tại đây.",
    EXISTING_SUBMITTED_REVIEW: "Đã có phiếu phỏng vấn nộp ở luồng cũ. Nhờ BTC kiểm tra trước khi phân lại.",
    REASON_REQUIRED: "Nhập lý do trước khi lưu — bắt buộc khi đổi người phỏng vấn, sửa kết quả đã chốt hoặc huỷ lịch.",
    RUBRIC_MISSING: "Mùa này chưa có phiếu chấm. Nhờ BTC cài phiếu ở mục Phiếu chấm & hướng dẫn mentee.",
    RUBRIC_CHANGED: "BTC vừa sửa phiếu chấm. Tải lại trang rồi chấm lại theo phiếu mới — điểm chưa được lưu.",
    INVALID_SCORES: "Cần chấm đủ mọi tiêu chí của phiếu, mỗi tiêu chí từ 1 đến 5.",
    RATIONALE_REQUIRED: "Nhập lý do chọn / không chọn (mục A, bắt buộc).",
    KEY_NEED_REQUIRED: "Nhập nhu cầu phát triển chính (mục A, bắt buộc).",
    DESIRED_MENTOR_REQUIRED: "Nhập chân dung Mentor phù hợp (mục C, bắt buộc).",
    INVALID_ALIGNMENT: "Chọn mức độ alignment (mục B).",
    INVALID_TAKE_CHOICE: "Chọn mentor có muốn nhận bạn này không (mục C).",
    TEXT_TOO_LONG: "Một ô ghi chú quá dài. Rút gọn rồi lưu lại.",
    INVALID_RUBRIC: "Phiếu chưa hợp lệ: kiểm tên tiêu chí, độ dài, và tổng trọng số phải đúng 100%.",
    STALE_VERSION: "Phiếu vừa được người khác lưu. Tải lại trang để xem bản mới rồi sửa tiếp.",
    INVALID_HANDBOOK: "File Handbook rỗng hoặc quá lớn sau khi chuyển đổi.",
    ALREADY_CHECKED_IN: "Đã check-in rồi, không huỷ lịch đăng ký được nữa — nhờ BTC xử lý trực tiếp.",
    INVALID_RESULT: "Kiểm tra kết quả: \"Có – Tôi muốn nhận bạn này\" chỉ chọn được khi kết quả là Đạt.",
    MENTOR_FULL: "Mentor đã đủ số mentee đăng ký nhận. Kết quả chưa được lưu.",
    MENTOR_NOT_APPROVED: "Tài khoản này chưa liên kết duy nhất với mentor đã được duyệt trong mùa.",
    MENTOR_IDENTITY_AMBIGUOUS: "Hồ sơ mentor chưa xác định duy nhất. Nhờ BTC kiểm tra.",
    IDENTITY_REQUIRES_BTC: "Danh tính/hồ sơ ứng viên cần BTC kiểm tra trước khi duyệt.",
    MEMBERSHIP_REQUIRES_BTC: "Mentee đã có trạng thái tham gia từ luồng khác. Nhờ BTC xử lý trước khi sửa.",
    OTHER_MATCH_REQUIRES_BTC: "Mentee có cặp ghép từ luồng khác. Nhờ BTC xử lý trước khi đổi kết quả.",
    SESSION_CHANGED: "Ca đã thay đổi sau check-in, cần BTC kiểm tra."
  };
  return Object.entries(errors).find(([key]) => message.includes(key))?.[1] ?? "Chưa lưu được. Vui lòng thử lại hoặc liên hệ BTC.";
}

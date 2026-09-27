export const OFFLINE_PATH = "/interviews/mentee-offline";
export const OFFLINE_SCORES = [
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
};
export type OfflineOperation = {
  checked_in_at: string | null; room: number | null; desk: number | null;
  interviewer_id: string | null; review_id: string | null; outcome: OfflineOutcome | null;
  match_id: string | null; revision: number;
  outcome_reason?: string | null;
};
export type OfflineCandidate = {
  id: string; name: string; phone: string | null; email: string | null; status: string;
  sessionId: string; bookedAt: string; rawPayload: Record<string, unknown> | null;
  answers: Array<[string, string]>; operation: OfflineOperation | null; reviews: OfflineReview[];
};
export type OfflineDashboard = {
  actorId: string; seasonId: string; canOperate: boolean;
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
    REASON_REQUIRED: "Nhập lý do sửa kết quả hoặc lý do không chọn/cần xem thêm.",
    INVALID_SCORES: "Cần đủ 5 tiêu chí, mỗi tiêu chí từ 1 đến 5.",
    INVALID_RESULT: "Kiểm tra kết quả và lựa chọn nhận mentee.",
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

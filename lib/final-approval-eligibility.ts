/**
 * Duyệt thành viên chính thức — từ vựng lý do, phần thuần.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CÓ FILE NÀY
 * ---------------------------------------------------------------------------
 * 21/10/2026: hai đơn mentor nằm ở `interview_passed` mà chưa có phiếu phỏng
 * vấn nào được nộp. Màn hình đơn vẽ thẻ "Duyệt thành viên chính thức" chỉ dựa
 * vào trạng thái, nên nút hiện ra; `vam084_application_decision_eligibility`
 * thì còn đếm phiếu, nên mọi lần bấm đều bị từ chối bằng đúng một câu chung
 * chung — không nói thiếu gì. BTC mất một buổi và một lượt đọc database mới
 * biết lý do.
 *
 * Hai cửa đọc hai thứ khác nhau là gốc của chuyện đó. Từ nay màn hình hỏi
 * CHÍNH hàm mà đường ghi sẽ hỏi, và in ra chính `reason` hàm ấy trả về.
 *
 * ---------------------------------------------------------------------------
 * TẠI SAO LÀ MỘT DANH SÁCH ĐÓNG
 * ---------------------------------------------------------------------------
 * Mỗi giá trị dưới đây là một nhánh có thật trong thân hàm SQL. Một mã lạ
 * không được hiện thành câu tiếng Việt đoán mò: nó rơi về `eligibility_unknown`
 * và màn hình nói thẳng là không đọc được — một lời giải thích sai còn tốn
 * thời gian hơn là không có lời giải thích nào.
 *
 * `__tests__/final-approval-eligibility.test.ts` đối chiếu danh sách này với
 * thân hàm trong migration, nên thêm nhánh SQL mà quên thêm ở đây thì test đỏ.
 */

/** Trạng thái đích của lần duyệt chính thức, theo vai trò ứng tuyển. */
export function finalApprovalTargetStatus(
  roleApplied: unknown
): "approved_as_mentor" | "approved_as_mentee" | null {
  const role = String(roleApplied ?? "").trim().toLowerCase();
  if (role === "mentor") return "approved_as_mentor";
  if (role === "mentee") return "approved_as_mentee";
  return null;
}

export const FINAL_APPROVAL_REASONS = [
  "eligible",
  "application_not_found",
  "stage_requirement_missing",
  "profile_review_minimum_not_met",
  "interview_review_minimum_not_met",
  "additional_review_not_submitted",
  "application_role_mismatch",
  "invalid_transition",
  "terminal_status",
  "unsupported_decision",
  /** Không đọc được câu trả lời. Không bao giờ vẽ thành "duyệt được". */
  "eligibility_unknown"
] as const;

export type FinalApprovalReason = (typeof FINAL_APPROVAL_REASONS)[number];

export function isFinalApprovalReason(value: unknown): value is FinalApprovalReason {
  return FINAL_APPROVAL_REASONS.includes(String(value ?? "") as FinalApprovalReason);
}

/**
 * Câu nói cho người vận hành: thiếu gì, chứ không phải "không đủ điều kiện".
 *
 * Giữ cùng lối diễn đạt với `lib/bulk-official-approval.ts` — cùng một phép
 * kiểm thì người đọc phải gặp cùng một câu, dù đi qua màn hình đơn lẻ hay màn
 * hình duyệt hàng loạt.
 */
export const FINAL_APPROVAL_REASON_MESSAGE: Record<FinalApprovalReason, string> = {
  eligible: "Đủ điều kiện duyệt chính thức.",
  application_not_found: "Không tìm thấy đơn ứng tuyển.",
  stage_requirement_missing: "Mùa tuyển sinh chưa cấu hình số đánh giá tối thiểu.",
  profile_review_minimum_not_met: "Đơn chưa đủ số đánh giá hồ sơ đã nộp.",
  interview_review_minimum_not_met: "Đơn chưa đủ số phiếu phỏng vấn đã nộp.",
  additional_review_not_submitted:
    "Đã yêu cầu xem thêm nhưng chưa có đánh giá mới được nộp sau đó.",
  application_role_mismatch: "Vai trò duyệt không khớp với vai trò ứng tuyển.",
  invalid_transition: "Trạng thái hiện tại không cho phép duyệt chính thức.",
  terminal_status: "Đơn đã ở trạng thái kết thúc.",
  unsupported_decision: "Đơn chưa đủ điều kiện vòng đời để duyệt chính thức.",
  eligibility_unknown:
    "Không đọc được điều kiện duyệt từ hệ thống. Vui lòng thử lại hoặc báo admin."
};

export function finalApprovalReasonMessage(reason: unknown): string {
  return FINAL_APPROVAL_REASON_MESSAGE[
    isFinalApprovalReason(reason) ? reason : "eligibility_unknown"
  ];
}

/**
 * Việc cần làm tiếp, viết bằng lời của quy trình.
 *
 * Biết "chưa đủ phiếu phỏng vấn" vẫn chưa gỡ được tình thế: ở `interview_passed`
 * màn hình KHÔNG cho phân công người phỏng vấn nữa (xem
 * `lib/application-review-assignability.ts`), nên câu gợi ý phải nói ra chỗ
 * nghẽn thật, không chỉ nhắc lại phép đếm.
 */
export const FINAL_APPROVAL_REASON_NEXT_STEP: Partial<Record<FinalApprovalReason, string>> = {
  profile_review_minimum_not_met: "Cần thêm đánh giá hồ sơ được nộp trước khi duyệt.",
  interview_review_minimum_not_met:
    "Cần người phỏng vấn nộp phiếu. Nếu đơn chưa từng có phiếu phỏng vấn nào thì ở trạng thái này cũng không phân công được nữa — đơn phải quay về bước mời phỏng vấn, liên hệ admin.",
  additional_review_not_submitted: "Cần một đánh giá mới được nộp sau lần yêu cầu xem thêm.",
  application_role_mismatch: "Chọn đúng vai trò ứng tuyển của đơn, hoặc sửa vai trò trên đơn.",
  invalid_transition: "Đơn phải ở bước ngay trước khi duyệt thì nút duyệt mới dùng được.",
  stage_requirement_missing: "Khai số đánh giá tối thiểu cho mùa này rồi quay lại."
};

export function finalApprovalNextStep(reason: unknown): string | null {
  return isFinalApprovalReason(reason)
    ? FINAL_APPROVAL_REASON_NEXT_STEP[reason] ?? null
    : null;
}

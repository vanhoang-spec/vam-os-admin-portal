import {
  WITHDRAWN_APPLICATION_REVIEW_MESSAGE,
  type ApplicationReviewRound
} from "@/lib/application-review-assignability";

/**
 * lib/review-assignment-refusals.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vì sao database từ chối một lần giao hồ sơ — nói bằng lời người vận hành hiểu.
 *
 * Hai hàm giao (`vam094_assign_selected_application_reviews` cho giao theo lô,
 * `vam090_bulk_assign_application_reviews` cho chia tự động) tự kiểm lại mọi thứ
 * trước khi ghi, và từ chối bằng một câu tiếng Anh. Trước đây mọi câu đều biến
 * thành "Không thể thực hiện thao tác", nên người vận hành không phân biệt được
 * "hồ sơ vừa có người giao" với "bạn không có quyền" hay "người chấm chưa đủ điều
 * kiện" — và lần bấm lại nào cũng ra đúng câu đó.
 *
 * ---------------------------------------------------------------------------
 * `refreshList`
 * ---------------------------------------------------------------------------
 * Một số lý do có nghĩa là trang đang hiện dữ liệu cũ: hồ sơ đã được giao, đã đổi
 * trạng thái, người chấm vừa bị thu hồi quyền. Với những lý do đó, server action
 * tải lại danh sách — nếu không, người vận hành chỉ còn cách bấm lại vào đúng
 * những hồ sơ vừa bị từ chối.
 *
 * Module thuần, không import gì có I/O: test đối chiếu được từng câu với chính
 * định nghĩa hàm trong migration.
 */

export const ASSIGNMENT_SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

export type AssignmentRefusal = { message: string; refreshList: boolean };

const RELOADED = "Danh sách đã được tải lại.";

export type AssignmentRefusalRule = {
  /** Đúng câu database raise. Test bắt nó phải còn nằm trong định nghĩa hàm. */
  match: string;
  refreshList: boolean;
  message: (work: string) => string;
};

/**
 * Thứ tự không quan trọng: không câu nào là chuỗi con của câu khác — test giữ
 * điều đó.
 */
export const ASSIGNMENT_REFUSAL_RULES: readonly AssignmentRefusalRule[] = [
  {
    match: "One or more applications are already assigned for this round",
    refreshList: true,
    message: (work) =>
      `Có hồ sơ trong lựa chọn đã được giao ${work} trước đó — có thể ai đó vừa giao, hoặc trang đang hiện dữ liệu cũ. ${RELOADED} Chọn lại những hồ sơ còn ở tab Chưa giao.`
  },
  {
    match: "No non-duplicate assignments could be created",
    refreshList: true,
    message: (work) => `Mọi hồ sơ khớp bộ lọc đều đã được giao ${work} trước đó. ${RELOADED}`
  },
  {
    match: "No applications matched the assignment filters",
    refreshList: true,
    message: () => `Không còn hồ sơ nào khớp bộ lọc để giao. ${RELOADED}`
  },
  {
    match: "APPLICATION_WITHDRAWN",
    refreshList: true,
    message: () => `${WITHDRAWN_APPLICATION_REVIEW_MESSAGE} ${RELOADED}`
  },
  {
    match: "One or more selected applications have an invalid status for this review round",
    refreshList: true,
    message: (work) => `Có hồ sơ vừa đổi trạng thái nên không còn giao ${work} được. ${RELOADED}`
  },
  {
    match: "One or more application IDs do not exist",
    refreshList: true,
    message: () => `Có hồ sơ không còn trong hệ thống. ${RELOADED}`
  },
  {
    match: "Target assignee is not an active participant for this season and stage",
    refreshList: true,
    message: (work) =>
      `Người được chọn chưa đủ điều kiện ${work} trong mùa này. Kiểm quyền của họ ở Ứng tuyển → Danh sách nhân sự tuyển sinh.`
  },
  {
    match: "Reviewer is not an active participant for this season and stage",
    refreshList: true,
    message: (work) =>
      `Có người được chọn chưa đủ điều kiện ${work} trong mùa này. Kiểm quyền của họ ở Ứng tuyển → Danh sách nhân sự tuyển sinh.`
  },
  {
    match: "One or more reviewers are not active",
    refreshList: true,
    message: () => `Có người được chọn đã bị khoá tài khoản. ${RELOADED}`
  },
  {
    match: "Assignment batch scope denied",
    refreshList: false,
    message: () => "Bạn không có quyền vận hành mùa của các hồ sơ này."
  },
  {
    match: "All selected applications must belong to exactly one intake batch and have the same role_applied",
    refreshList: false,
    message: () => "Các hồ sơ đã chọn phải cùng một đợt tuyển và cùng vai trò (mentor hoặc mentee). Chọn lại theo từng đợt."
  },
  {
    match: "Cannot assign more than 500 applications at once",
    refreshList: false,
    message: () => "Mỗi lần giao tối đa 500 hồ sơ. Chia lựa chọn thành nhiều lần."
  },
  {
    match: "Assignment limit must be between 1 and 500",
    refreshList: false,
    message: () => "Mỗi lần giao tối đa 500 hồ sơ. Chia lựa chọn thành nhiều lần."
  }
];

function workLabel(round: ApplicationReviewRound): string {
  return round === "interview" ? "phỏng vấn" : "chấm hồ sơ";
}

/**
 * Lỗi database (hoặc chính câu lỗi) → câu báo cho người vận hành.
 *
 * Câu lạ thì trả câu chung, KHÔNG BAO GIỜ trả nguyên văn: lỗi Postgres có thể mang
 * tên bảng, tên cột, giá trị, và chúng không dành cho màn hình.
 */
export function describeAssignmentRefusal(error: unknown, round: ApplicationReviewRound): AssignmentRefusal {
  const text =
    typeof error === "string"
      ? error
      : String((error as { message?: unknown } | null)?.message ?? "");
  const rule = ASSIGNMENT_REFUSAL_RULES.find((candidate) => text.includes(candidate.match));
  if (!rule) return { message: ASSIGNMENT_SAFE_ERROR, refreshList: false };
  return { message: rule.message(workLabel(round)), refreshList: rule.refreshList };
}

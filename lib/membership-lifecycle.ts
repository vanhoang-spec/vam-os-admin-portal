/**
 * Vai trò một người có thể mang trong một mùa, và thêm tay được từ hồ sơ của họ.
 *
 * Danh sách này HẸP HƠN ràng buộc CHECK của `person_season_memberships`, và đó
 * là chủ ý. 'reviewer' và 'interviewer' lưu được trong bảng nhưng không nằm ở
 * đây: chúng do đường cấp quyền tuyển sinh ghi ra cùng với những thứ khác — ghi
 * danh sách nhân sự, mở quyền chấm — nên thêm tay một dòng membership trần chỉ
 * tạo ra một reviewer không chấm được gì.
 *
 * Trainer và Speaker vào đây vì chúng KHÔNG có đường nào khác. Trước đó hai vai
 * trò này chỉ tồn tại ở phạm vi một buổi (`event_participants.role_at_event`),
 * nên người đứng lớp cả mùa không có chỗ nào trong CRM nói rằng họ thuộc mùa đó.
 *
 * Một cửa cho cả ô chọn trên màn hình lẫn phép kiểm của server action: hai danh
 * sách viết riêng là hai cơ hội để ô chọn mời một giá trị mà server từ chối.
 */
export const MEMBERSHIP_ROLES = ["mentor", "mentee", "trainer", "speaker"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Nhãn tiếng Việt của vai trò trong mùa, dùng chung cho ô chọn và chỗ hiển thị. */
export const MEMBERSHIP_ROLE_LABELS: Record<MembershipRole, string> = {
  mentor: "Mentor",
  mentee: "Mentee",
  trainer: "Trainer / Người đào tạo",
  speaker: "Speaker / Diễn giả"
};

export type MembershipLifecycleActionState = { ok: boolean; message: string; outcome?: string };
export const initialMembershipLifecycleState: MembershipLifecycleActionState = { ok: false, message: "" };


export const MEMBERSHIP_LIFECYCLE_OPERATIONS = ["pause", "reactivate", "withdraw", "opt_out", "cancel", "remove_role"] as const;
export type MembershipLifecycleOperation = (typeof MEMBERSHIP_LIFECYCLE_OPERATIONS)[number];

const AVAILABLE_BY_STATUS: Record<string, MembershipLifecycleOperation[]> = {
  active: ["pause", "withdraw", "opt_out", "cancel", "remove_role"],
  paused: ["reactivate", "withdraw", "opt_out", "cancel", "remove_role"],
  invited: ["withdraw", "opt_out", "cancel", "remove_role"],
  withdrawn: ["reactivate", "cancel"], opted_out: ["reactivate", "cancel"], cancelled: ["reactivate"]
};
export function availableMembershipActions(status: unknown) { return AVAILABLE_BY_STATUS[String(status ?? "").trim().toLowerCase()] ?? []; }
export function isMembershipRole(value: unknown): value is MembershipRole { return MEMBERSHIP_ROLES.includes(value as MembershipRole); }
export function isMembershipLifecycleOperation(value: unknown): value is MembershipLifecycleOperation { return MEMBERSHIP_LIFECYCLE_OPERATIONS.includes(value as MembershipLifecycleOperation); }
export function membershipOperationNeedsReason(operation: MembershipLifecycleOperation) { return operation === "cancel" || operation === "remove_role"; }
export const MEMBERSHIP_ACTION_LABELS: Record<MembershipLifecycleOperation, string> = {
  pause: "Tạm nghỉ", reactivate: "Kích hoạt lại", withdraw: "Rút khỏi chương trình", opt_out: "Không tiếp tục", cancel: "Hủy membership", remove_role: "Gỡ vai trò"
};

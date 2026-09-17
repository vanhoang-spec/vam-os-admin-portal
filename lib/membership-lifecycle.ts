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

/**
 * "Tham dự / Không tham dự" của mentor và mentee trong một mùa — kết quả nhận mà
 * ban tổ chức sửa trực tiếp trên hồ sơ CRM (chủ dự án chốt 17/09/2026).
 *
 * Không tham dự ghi `opted_out`, không phải `withdrawn` hay `cancelled`. Đó là
 * trạng thái luồng gia hạn ghi khi mentor từ chối, và là trạng thái duy nhất luồng
 * đó tự kích hoạt lại khi mentor đổi ý bấm xác nhận (`lib/renewal-runtime.ts`).
 * Ghi `withdrawn` thì mentor đổi ý bị chặn lại ở bước duyệt đơn.
 *
 * Chuyển về "Tham dự" nhận mọi trạng thái không tham dự, kể cả đã rút, đã hủy:
 * với người vận hành chúng cùng một nghĩa. Phân biệt chúng là việc của phần
 * "Thao tác khác", nơi hai nút này không lặp lại.
 */
export const PARTICIPATION_ROLES = ["mentor", "mentee"] as const;
export type ParticipationRole = (typeof PARTICIPATION_ROLES)[number];
export type ParticipationMove = Extract<MembershipLifecycleOperation, "opt_out" | "reactivate">;

export const PARTICIPATION_MOVE_LABELS: Record<ParticipationMove, string> = {
  reactivate: "Chuyển sang Tham dự",
  opt_out: "Chuyển sang Không tham dự"
};

const PARTICIPATION_MOVES: readonly ParticipationMove[] = ["reactivate", "opt_out"];

const PARTICIPATION_STATUS_LABELS: Record<string, string> = {
  active: "Đang tham dự",
  opted_out: "Không tham dự",
  withdrawn: "Không tham dự · đã rút khỏi chương trình",
  cancelled: "Không tham dự · membership đã hủy",
  paused: "Tạm nghỉ",
  invited: "Được mời, chưa xác nhận",
  completed: "Đã hoàn thành mùa",
  graduated: "Đã hoàn thành mùa"
};

function normalizedText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isParticipationRole(value: unknown): value is ParticipationRole {
  return PARTICIPATION_ROLES.includes(normalizedText(value) as ParticipationRole);
}

/** Nhãn trạng thái tham dự và các lần chuyển hợp lệ, cùng bảng trạng thái với RPC. */
export function participationView(status: unknown): { label: string; moves: ParticipationMove[] } {
  const key = normalizedText(status);
  const available = availableMembershipActions(key);
  return {
    label: PARTICIPATION_STATUS_LABELS[key] ?? (String(status ?? "").trim() || "Không rõ trạng thái"),
    moves: PARTICIPATION_MOVES.filter((move) => available.includes(move))
  };
}

/** Các thao tác còn lại của một membership; với mentor/mentee đã bỏ hai lần chuyển tham dự. */
export function otherMembershipActions(role: unknown, status: unknown): MembershipLifecycleOperation[] {
  const available = availableMembershipActions(status);
  if (!isParticipationRole(role)) return available;
  return available.filter((operation) => !(PARTICIPATION_MOVES as readonly string[]).includes(operation));
}

/** Câu từ chối khi vai trò của người thao tác không được đổi membership này. */
export function membershipChangeDeniedMessage(role: unknown) {
  const kind = normalizedText(role);
  if (kind === "mentor") return "Chỉ Core Team, Admin và Super Admin được đổi trạng thái tham dự của mentor.";
  if (kind === "mentee") return "Chỉ Support Team, Core Team, Admin và Super Admin được đổi trạng thái tham dự của mentee.";
  return "Bạn không có quyền đổi vai trò này trong mùa.";
}

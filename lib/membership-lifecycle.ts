export const MEMBERSHIP_ROLES = ["mentor", "mentee"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

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

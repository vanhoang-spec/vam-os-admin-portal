import { canAssignReview, canManageReviewers } from "@/lib/permissions";

/**
 * lib/recruitment-permissions-core.ts — bốn nhóm quyền tuyển sinh theo mùa (BTC 04/10/2026).
 *
 * Bốn nhóm ĐỘC LẬP — có quyền nhóm này không kéo theo nhóm nào khác:
 *   'reviewer'           Chấm hồ sơ mentee
 *   'interviewer'        Phỏng vấn mentee
 *   'mentor_reviewer'    Chấm hồ sơ mentor
 *   'mentor_interviewer' Phỏng vấn mentor (lịch rảnh 1:1)
 *
 * Giá trị là person_season_memberships.role; database quyết định bằng
 * vam110_eligible_for(admin, mùa, vòng, mentor|mentee) — migration 20261004170000.
 * 'reviewer'/'interviewer' giữ tên cũ vì đã có hàng trăm dòng thật, và mọi dòng đó
 * đều là quyền với hồ sơ MENTEE.
 *
 * Trước 04/10: chấm hồ sơ chỉ cần scope (không phân mentor/mentee) và cấp quyền phỏng vấn
 * kéo theo quyền chấm mọi hồ sơ — đúng kiểu gán chéo BTC không muốn. Phần thuần, không I/O.
 */

export type ReviewStage = "profile_screening" | "interview";
export type AppliedRole = "mentor" | "mentee";
export type ParticipationRole = "reviewer" | "interviewer" | "mentor_reviewer" | "mentor_interviewer";

export type ParticipationGroup = {
  role: ParticipationRole;
  label: string;
  stage: ReviewStage;
  applied: AppliedRole;
  /** Chỉ ban điều hành (super_admin/admin/core_team) cấp / thu — support thì không. */
  coreOnly: boolean;
};

/** Thứ tự hiển thị: hai nhóm mentee (BTC + support cấp) rồi hai nhóm mentor (core team cấp). */
export const PARTICIPATION_GROUPS: readonly ParticipationGroup[] = Object.freeze([
  { role: "reviewer", label: "Chấm hồ sơ mentee", stage: "profile_screening", applied: "mentee", coreOnly: false },
  { role: "interviewer", label: "Phỏng vấn mentee", stage: "interview", applied: "mentee", coreOnly: false },
  { role: "mentor_reviewer", label: "Chấm hồ sơ mentor", stage: "profile_screening", applied: "mentor", coreOnly: true },
  { role: "mentor_interviewer", label: "Phỏng vấn mentor", stage: "interview", applied: "mentor", coreOnly: true }
]);

const BY_ROLE = new Map(PARTICIPATION_GROUPS.map((g) => [g.role, g]));

export function isParticipationRole(value: unknown): value is ParticipationRole {
  return typeof value === "string" && BY_ROLE.has(value as ParticipationRole);
}

export function participationGroup(role: ParticipationRole): ParticipationGroup {
  return BY_ROLE.get(role)!;
}

export function participationLabel(role: ParticipationRole): string {
  return participationGroup(role).label;
}

/** Hồ sơ mentor hay mentee — null nếu không rõ (fail-closed: nơi gọi phải từ chối). */
export function normalizeAppliedRole(value: unknown): AppliedRole | null {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "mentor" || v === "mentee" ? v : null;
}

export function participationRoleFor(stage: ReviewStage, applied: AppliedRole): ParticipationRole {
  if (stage === "profile_screening") return applied === "mentee" ? "reviewer" : "mentor_reviewer";
  return applied === "mentee" ? "interviewer" : "mentor_interviewer";
}

/** Ai được cấp / thu nhóm quyền này. Mùa phải kiểm riêng (canOperateSeason). */
export function canGrantParticipation(actorRole: string | null | undefined, role: ParticipationRole): boolean {
  return participationGroup(role).coreOnly ? canAssignReview(actorRole) : canManageReviewers(actorRole);
}

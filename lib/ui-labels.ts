/**
 * lib/ui-labels.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized user-facing label layer for VAM OS.
 *
 * Rules:
 *  1. DB enum values NEVER change — only the visible display text changes.
 *  2. Each domain has its own function to avoid cross-domain label confusion.
 *  3. Unknown values fall back safely (return raw value), never mapped to a
 *     different valid status.
 *  4. No DB validation or normalization logic here — display only.
 *  5. This module must remain dependency-light and fully testable without
 *     importing server-only modules.
 *
 * Accepted VAM domain terms that may remain in English:
 *   Mentor · Mentee · Season · Core Team · Support Team · Matching · Recap
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Safe fallback: returns the raw string when no mapping exists.
 * Never returns a different mapped value for an unknown key.
 */
function fallback(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw || "—";
}

// ── Recap status ──────────────────────────────────────────────────────────────
/**
 * Display label for mentoring_recaps.status enum values.
 *
 * DB values (must remain unchanged): submitted | needs_review | invalid |
 * duplicate | deleted | excluded
 */
export function applicationAcquisitionChannelLabel(rawPayload: Record<string, unknown> | null, acquisitionChannel: string | null): string {
  if (rawPayload?.referrer_or_source) {
    const val = String(rawPayload.referrer_or_source).trim();
    if (val === "friend") return "Bạn bè";
    if (val === "social_media") return "Mạng xã hội";
    if (val === "website") return "Website chương trình";
    if (val === "ueh_alumni") return "UEH Alumni";
    if (val === "alumni_referral") return "Cựu mentor giới thiệu";
    if (val === "other") {
      const otherDetail = rawPayload.referrer_or_source_other ? String(rawPayload.referrer_or_source_other).trim() : "";
      return otherDetail ? `Khác (${otherDetail})` : "Khác";
    }
    // Unknown raw enum value -> fallback to legacy acquisition_channel if available, otherwise safe fallback
    if (acquisitionChannel && acquisitionChannel.trim()) {
      return fallback(acquisitionChannel);
    }
    return fallback(val);
  }
  return acquisitionChannel ? fallback(acquisitionChannel) : "—";
}

export function recapStatusLabel(value: unknown): string {
  const key = normalize(value);
  if (key === "submitted") return "Đã ghi nhận";
  if (key === "needs_review") return "Cần kiểm tra";
  if (key === "invalid") return "Không hợp lệ";
  if (key === "duplicate") return "Trùng dữ liệu";
  if (key === "deleted") return "Đã ẩn";
  if (key === "excluded") return "Không tính vào báo cáo";
  return fallback(value);
}

// ── Follow-up / task status ───────────────────────────────────────────────────
/**
 * Display label for workflow_queue.status enum values (follow-up action items).
 *
 * DB values (must remain unchanged): open | in_progress | resolved |
 * no_response | dropped | parked
 */
export function followUpStatusLabel(value: unknown): string {
  const key = normalize(value);
  if (key === "open") return "Chưa xử lý";
  if (key === "in_progress") return "Đang xử lý";
  if (key === "resolved") return "Đã hoàn tất";
  if (key === "no_response") return "Chưa nhận phản hồi";
  if (key === "dropped") return "Người tham gia đã dừng";
  if (key === "parked") return "Tạm để sau";
  return fallback(value);
}

// ── Match status ──────────────────────────────────────────────────────────────
/**
 * Display label for matches.status enum values.
 * Uses match-specific wording (different from participant status).
 *
 * DB values (must remain unchanged): active | completed | dropped |
 * unmatched_review
 */
export function matchStatusLabel(value: unknown): string {
  const key = normalize(value);
  if (key === "active") return "Đang đồng hành";
  if (key === "completed") return "Đã hoàn thành";
  if (key === "dropped") return "Đã dừng";
  if (key === "unmatched_review") return "Cần xem lại ghép cặp";
  return fallback(value);
}

// ── Participant / profile status ──────────────────────────────────────────────
/**
 * Display label for participant/profile status (mentor/mentee profiles).
 * Uses participant-specific wording (different from match status).
 *
 * DB values (must remain unchanged): active | inactive | pending | dropped
 */
export function participantStatusLabel(value: unknown): string {
  const key = normalize(value);
  if (key === "active") return "Đang tham gia";
  if (key === "inactive") return "Không hoạt động";
  if (key === "pending") return "Đang chờ xác nhận";
  if (key === "dropped") return "Đã dừng tham gia";
  return fallback(value);
}

// ── Application status ────────────────────────────────────────────────────────
/**
 * Display label for applications.status CHECK values (S12 pipeline, 20 values).
 * Applications page already has a local applicationStatusLabel() — this
 * canonical version is the authoritative source.
 *
 * DB values (must remain unchanged): submitted | under_data_check |
 * ready_for_screening | screening_assigned | screening_in_progress |
 * screening_completed | screening_passed | invited_to_meeting |
 * invited_to_orientation | invited_to_interview | interview_scheduled |
 * interview_in_progress | interview_completed | interview_passed |
 * approved_as_mentor | approved_as_mentee | waitlisted |
 * rejected_or_not_fit | needs_more_review | withdrawn
 */
export function applicationStatusLabel(value: unknown): string {
  const key = normalize(value);
  if (key === "submitted") return "Đã nộp / Chờ xử lý";
  if (key === "under_data_check") return "Đang kiểm tra dữ liệu";
  if (key === "ready_for_screening") return "Sẵn sàng review";
  if (key === "screening_assigned") return "Đã giao review";
  if (key === "screening_in_progress") return "Đang review hồ sơ";
  if (key === "screening_completed") return "Đã chấm hồ sơ";
  if (key === "screening_passed") return "Qua vòng hồ sơ";
  if (key === "invited_to_meeting") return "Mời gặp mặt";
  if (key === "invited_to_orientation") return "Mời buổi định hướng";
  if (key === "invited_to_interview") return "Mời phỏng vấn";
  if (key === "interview_scheduled") return "Đã lên lịch phỏng vấn";
  if (key === "interview_in_progress") return "Đang phỏng vấn";
  if (key === "interview_completed") return "Hoàn tất phỏng vấn";
  if (key === "ready_for_final_decision") return "Sẵn sàng ra quyết định cuối";
  if (key === "interview_passed") return "Qua vòng phỏng vấn";
  if (key === "approved_as_mentor") return "Đã duyệt — Mentor";
  if (key === "approved_as_mentee") return "Đã duyệt — Mentee";
  if (key === "waitlisted") return "Danh sách chờ";
  if (key === "rejected_or_not_fit") return "Không phù hợp";
  if (key === "needs_more_review") return "Cần xem thêm";
  if (key === "withdrawn") return "Rút đơn";
  return fallback(value);
}

// ── Meeting type ──────────────────────────────────────────────────────────────
/**
 * Display label for mentoring_recaps.meeting_type enum values.
 *
 * DB values (must remain unchanged): 1on1_primary | 1on1_cross | group |
 * online | offline | unknown
 */
export function meetingTypeLabel(value: unknown): string {
  const key = normalize(value);
  if (key === "1on1_primary") return "Mentoring 1–1";
  if (key === "1on1_cross") return "Cross-mentoring";
  if (key === "group" || key === "group_training") return "Mentoring theo nhóm";
  if (key === "online") return "Trực tuyến";
  if (key === "offline") return "Trực tiếp";
  if (key === "unknown") return "Chưa xác định";
  if (key === "other") return "Khác / chưa xác định";
  return fallback(value);
}

// ── Navigation labels (exported for testing) ──────────────────────────────────
/**
 * Canonical primary navigation labels.
 * These must match exactly what is rendered in components/app-shell.tsx.
 *
 * Structural navigation grouping (≤8 items) is DEFERRED to Batch 1B / Batch 2.
 * This export documents the current visible labels post-Batch 1A.
 */
export const NAV_LABELS = {
  dashboard: "Tổng quan",
  operations: "Vận hành",
  people: "Cộng đồng VAM",
  mentors: "Mentor",
  mentees: "Mentee",
  applications: "Ứng tuyển",
  matches: "Ghép cặp",
  events: "Sự kiện",
  dataIssues: "Rà soát dữ liệu",
  reviews: "Đánh giá",
  interviews: "Phỏng vấn",
  team: "Phân công & Trách nhiệm",
  admin: "Quản trị",
  adminUsers: "Quản lý người dùng",
} as const;

/**
 * Forbidden corporate terms that must NOT appear in user-facing UI copy.
 * Used in tests to verify no regression.
 */
export const FORBIDDEN_UI_TERMS = [
  "CEO View",
  "Founder View",
  "Founder & Core Team Intelligence",
  "Mentor Intelligence",
  "Mentee Intelligence",
  "Matching Intelligence",
  "Operations Intelligence",
  "Command Center",
  "Silent mentee",
  "Mentee im lặng",
  "Im lặng",
  "Sức khỏe mentoring",
  "Mentee health",
  "Data Issues",
  "Admin Workflow",
  "Admin Correction Workflow",
  "Follow-up Queue",
  "Data Issues Queue",
  "Activity by Segment",
  "Recommended Actions",
] as const;

/**
 * Accepted VAM domain terms that may remain in English (not forbidden).
 */
export const ACCEPTED_VAM_TERMS = [
  "Mentor",
  "Mentee",
  "Season",
  "Core Team",
  "Support Team",
  "Matching",
  "Recap",
] as const;

// ── Staff account roles ───────────────────────────────────────────────────────
/**
 * Display label for admin_users.role.
 *
 * DB values are unchanged: reviewer | core_team | admin | super_admin |
 * viewer | support_team. Operators were reading raw enum strings such as
 * "core_team" next to a mailbox address; these are the terms the programme
 * actually uses.
 */
export function adminRoleLabel(value: unknown): string {
  const key = normalize(value);
  if (key === "core_team") return "Ban Điều hành";
  if (key === "admin") return "Quản trị viên";
  if (key === "super_admin") return "Quản trị viên cấp cao";
  if (key === "reviewer") return "Người đánh giá hồ sơ";
  if (key === "support_team") return "Ban Hỗ trợ";
  if (key === "viewer") return "Người xem";
  return fallback(value);
}

// ── Application source ────────────────────────────────────────────────────────
/**
 * Display label for applications.known_source.
 *
 * DB values are unchanged: vam_os_form | s12_mentor_renewal.
 */
export function applicationSourceLabel(value: unknown): string {
  const key = normalize(value);
  if (key === "vam_os_form") return "Form VAM OS";
  if (key === "s12_mentor_renewal") return "Gia hạn Mentor Mùa 12";
  return fallback(value);
}

// ── Review round ──────────────────────────────────────────────────────────────
/** Display label for application_reviews.review_round. DB values unchanged. */
export function reviewRoundLabel(value: unknown): string {
  const key = normalize(value);
  if (key === "profile_screening") return "Đánh giá hồ sơ";
  if (key === "interview") return "Phỏng vấn";
  return fallback(value);
}

// ── Recruitment staff naming ──────────────────────────────────────────────────
/**
 * The name an operator should see for a staff account.
 *
 * Precedence is people.full_name → admin_users.full_name → email. An email
 * address is a last resort, never the primary label: the Reviewer Pool and the
 * assignee dropdowns were showing "dangminhloan@yahoo.com (core_team)" for a
 * person whose real name the system already held.
 *
 * Mirrors the same coalesce in vam084_list_recruitment_participants, so a name
 * rendered from a pool row and one rendered from the dropdown agree.
 */
export function staffDisplayName(input: {
  peopleFullName?: string | null;
  adminFullName?: string | null;
  email?: string | null;
}): string {
  const people = String(input.peopleFullName ?? "").trim();
  if (people) return people;
  const admin = String(input.adminFullName ?? "").trim();
  if (admin) return admin;
  return String(input.email ?? "").trim();
}

/**
 * `Tên — Vai trò`, or just the name when the role is unknown.
 *
 * Example: "Đặng Phạm Minh Loan — Ban Điều hành".
 */
export function staffDisplayLabel(input: {
  peopleFullName?: string | null;
  adminFullName?: string | null;
  email?: string | null;
  role?: string | null;
}): string {
  const name = staffDisplayName(input);
  const role = String(input.role ?? "").trim();
  if (!role) return name;
  return `${name} — ${adminRoleLabel(role)}`;
}

// ── Intrinsic recruitment eligibility (mirrors the DB policy) ─────────────────
/**
 * Roles that are intrinsically authorised to review profiles AND to interview
 * for the target season, per the Owner decision encoded in migration
 * 20260904143000. They must never be offered a "Cấp Reviewer" / "Cấp
 * Interviewer" button, because their rights do not come from a participation
 * grant and cannot be revoked by removing one.
 */
export const PRIVILEGED_RECRUITMENT_ROLES: ReadonlySet<string> = new Set([
  "core_team",
  "admin",
  "super_admin"
]);

/** Whether an account holds recruitment rights by virtue of its role alone. */
export function hasIntrinsicRecruitmentRights(input: {
  role?: string | null;
  status?: string | null;
}): boolean {
  return (
    String(input.status ?? "").trim().toLowerCase() === "active" &&
    PRIVILEGED_RECRUITMENT_ROLES.has(String(input.role ?? "").trim())
  );
}

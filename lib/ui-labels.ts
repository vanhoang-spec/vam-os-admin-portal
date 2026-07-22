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

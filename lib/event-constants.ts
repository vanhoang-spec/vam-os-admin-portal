export type EventTypeValue =
  | "orientation"
  | "training"
  | "kickoff"
  | "company_tour"
  | "networking"
  | "closing"
  | "business_case"
  | "job_shadowing"
  | "cross_mentoring"
  | "other";

export type AttendanceStatusValue =
  | "attended"
  | "absent_excused"
  | "absent_unexcused"
  | "registered_no_response"
  | "walk_in"
  | "unknown"
  | "registered_absent";
export type RegistrationStatusValue = "registered" | "confirmed" | "declined" | "no_response" | "cancelled" | "unknown";
export type EventRoleValue = "mentor" | "mentee" | "core_team" | "speaker" | "trainer" | "guest" | "unknown";

export const EVENT_TYPE_OPTIONS: Array<{ value: EventTypeValue; label: string }> = [
  { value: "orientation", label: "Orientation / Định hướng" },
  { value: "training", label: "Training / Đào tạo" },
  { value: "kickoff", label: "Kickoff / Lễ phát động" },
  { value: "company_tour", label: "Company tour / Tham quan doanh nghiệp" },
  { value: "networking", label: "Networking / Giao lưu" },
  { value: "closing", label: "Tổng kết / Closing" },
  { value: "business_case", label: "Business case" },
  { value: "job_shadowing", label: "Job shadowing" },
  { value: "cross_mentoring", label: "Cross-mentoring" },
  { value: "other", label: "Khác" }
];

export const ATTENDANCE_STATUS_OPTIONS: Array<{ value: AttendanceStatusValue; label: string }> = [
  { value: "attended", label: "Đã tham gia" },
  { value: "absent_excused", label: "Vắng có phép" },
  { value: "absent_unexcused", label: "Vắng không phép" },
  { value: "registered_no_response", label: "Đã đăng ký - chưa phản hồi" },
  { value: "walk_in", label: "Walk-in" },
  { value: "unknown", label: "Chưa rõ" },
  { value: "registered_absent", label: "Đăng ký nhưng không tham gia (legacy)" }
];

export const REGISTRATION_STATUS_OPTIONS: Array<{ value: RegistrationStatusValue; label: string }> = [
  { value: "registered", label: "Đã đăng ký" },
  { value: "confirmed", label: "Đã xác nhận" },
  { value: "declined", label: "Từ chối tham gia" },
  { value: "no_response", label: "Không phản hồi" },
  { value: "cancelled", label: "Đã hủy" },
  { value: "unknown", label: "Chưa rõ" }
];

export const EVENT_ROLE_OPTIONS: Array<{ value: EventRoleValue; label: string }> = [
  { value: "mentor", label: "Mentor" },
  { value: "mentee", label: "Mentee" },
  { value: "core_team", label: "Core team" },
  { value: "speaker", label: "Diễn giả" },
  { value: "trainer", label: "Trainer / người đào tạo" },
  { value: "guest", label: "Khách mời" },
  { value: "unknown", label: "Khác / chưa phân loại" }
];

export const NON_MENTOR_MENTEE_ROLE_VALUES: EventRoleValue[] = ["core_team", "speaker", "trainer", "guest", "unknown"];

export function eventRoleLabel(value: unknown): string {
  const text = String(value ?? "").trim();
  return EVENT_ROLE_OPTIONS.find((option) => option.value === text)?.label ?? "Chưa rõ";
}

export function attendanceStatusLabel(value: unknown): string {
  const text = String(value ?? "").trim();
  return ATTENDANCE_STATUS_OPTIONS.find((option) => option.value === text)?.label ?? text;
}

export const EVENT_TYPE_VALUES = new Set<EventTypeValue>(EVENT_TYPE_OPTIONS.map((option) => option.value));
export const ATTENDANCE_STATUS_VALUES = new Set<AttendanceStatusValue>(ATTENDANCE_STATUS_OPTIONS.map((option) => option.value));
export const REGISTRATION_STATUS_VALUES = new Set<RegistrationStatusValue>(REGISTRATION_STATUS_OPTIONS.map((option) => option.value));
export const EVENT_ROLE_VALUES = new Set<EventRoleValue>(EVENT_ROLE_OPTIONS.map((option) => option.value));
export const EVENT_ABSENCE_STATUS_VALUES = new Set<AttendanceStatusValue>([
  "absent_excused",
  "absent_unexcused",
  "registered_absent"
]);

export function isEventAttendedStatus(value: unknown): boolean {
  return String(value ?? "").trim() === "attended";
}

export function isEventAbsenceStatus(value: unknown): boolean {
  return EVENT_ABSENCE_STATUS_VALUES.has(String(value ?? "").trim() as AttendanceStatusValue);
}

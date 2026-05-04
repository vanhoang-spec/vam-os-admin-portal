export type EventTypeValue =
  | "orientation"
  | "kickoff"
  | "tong_ket"
  | "training"
  | "workshop"
  | "community"
  | "matching"
  | "other";

export type AttendanceStatusValue = "attended" | "registered_absent";
export type RegistrationStatusValue = "registered" | "unknown";
export type EventRoleValue = "mentor" | "mentee" | "core_team" | "speaker" | "trainer" | "guest" | "unknown";

export const EVENT_TYPE_OPTIONS: Array<{ value: EventTypeValue; label: string }> = [
  { value: "orientation", label: "Orientation (định hướng)" },
  { value: "kickoff", label: "Kickoff" },
  { value: "tong_ket", label: "Tổng kết / Closing" },
  { value: "training", label: "Training (đào tạo)" },
  { value: "workshop", label: "Workshop" },
  { value: "community", label: "Community (cộng đồng)" },
  { value: "matching", label: "Matching" },
  { value: "other", label: "Khác" }
];

export const ATTENDANCE_STATUS_OPTIONS: Array<{ value: AttendanceStatusValue; label: string }> = [
  { value: "attended", label: "Đã tham gia" },
  { value: "registered_absent", label: "Đăng ký nhưng không tham gia" }
];

export const REGISTRATION_STATUS_OPTIONS: Array<{ value: RegistrationStatusValue; label: string }> = [
  { value: "registered", label: "Đã đăng ký" },
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

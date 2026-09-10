export type EventTypeValue =
  | "orientation"
  | "mentee_orientation"
  | "mentor_orientation"
  | "training"
  | "kickoff"
  | "company_tour"
  | "networking"
  | "closing"
  | "business_case"
  | "job_shadowing"
  | "interview_day"
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

/**
 * Thứ tự ở đây là thứ tự một mùa diễn ra, không phải thứ tự bảng chữ cái:
 * người tạo sự kiện đang nghĩ theo dòng thời gian của chương trình.
 *
 * `orientation` chung được giữ lại bên cạnh hai bản dành riêng cho mentor và
 * mentee — các sự kiện đã diễn ra đang mang giá trị đó, và đổi nghĩa một giá
 * trị cũ là viết lại lịch sử.
 *
 * `interview_day` là NGÀY phỏng vấn: một buổi có địa điểm, sức chứa và điểm
 * danh. Nó không thay cho module /interviews, nơi quản lý từng ca phỏng vấn
 * của từng ứng viên.
 */
export const EVENT_TYPE_OPTIONS: Array<{ value: EventTypeValue; label: string }> = [
  { value: "mentee_orientation", label: "Orientation cho Mentee" },
  { value: "mentor_orientation", label: "Orientation cho Mentor" },
  { value: "orientation", label: "Orientation / Định hướng (chung)" },
  { value: "interview_day", label: "Ngày phỏng vấn" },
  { value: "kickoff", label: "Kickoff / Lễ phát động" },
  { value: "training", label: "Training / Đào tạo" },
  { value: "cross_mentoring", label: "Cross-mentoring" },
  { value: "company_tour", label: "Company tour / Tham quan doanh nghiệp" },
  { value: "business_case", label: "Business case" },
  { value: "job_shadowing", label: "Job shadowing" },
  { value: "networking", label: "Networking / Giao lưu" },
  { value: "closing", label: "Tổng kết / Closing" },
  { value: "other", label: "Khác" }
];

/** Nhãn tiếng Việt của một loại sự kiện, hoặc chính giá trị nếu chưa biết. */
export function eventTypeLabel(value: unknown): string {
  const raw = String(value ?? "").trim();
  return EVENT_TYPE_OPTIONS.find((option) => option.value === raw)?.label || raw || "—";
}

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

/**
 * Nhãn tiếng Việt của một trạng thái đăng ký.
 *
 * Một cửa duy nhất cho cả huy hiệu trên màn hình lẫn ô trong bảng xuất ra: hai
 * bảng chữ khác nhau cho cùng một trạng thái là hai bảng sẽ lệch nhau, và lúc
 * đó không ai biết bảng nào đúng.
 *
 * `REGISTRATION_STATUS_OPTIONS` chỉ liệt kê những giá trị hệ thống tự ghi ra;
 * các giá trị đến từ quy trình duyệt đơn được ghi thêm ở đây.
 */
export function eventRegistrationStatusLabel(value: unknown): string {
  const status = String(value ?? "").trim();
  if (status === "registered") return "Đã đăng ký";
  if (status === "pending_review") return "Chờ duyệt";
  if (status === "confirmed") return "Đã xác nhận";
  if (status === "waitlisted") return "Danh sách chờ";
  if (status === "rejected") return "Bị từ chối";
  if (status === "cancelled") return "Đã hủy";
  return REGISTRATION_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

import "server-only";

import { csvCell } from "@/lib/csv-export";
import { formatDateTime } from "@/lib/utils";
import { attendanceStatusLabel, eventRegistrationStatusLabel } from "@/lib/event-constants";

/**
 * lib/event-export.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dựng bảng danh sách đăng ký của một sự kiện thành các dòng CSV.
 *
 * Tách khỏi route để phần quyết định NỘI DUNG bảng — cột nào, nhãn nào, thứ tự
 * ra sao — kiểm được mà không phải dựng một yêu cầu HTTP giả. Route chỉ còn lo
 * chuyện gác cổng và nạp dữ liệu.
 */

export type ExportRegistration = Record<string, unknown>;

/** Buổi mà một dòng đăng ký thuộc về, chỉ những gì bảng cần in ra. */
export type ExportSession = {
  id: string;
  seriesIndex: number | null;
  startsAt: string | null;
};

/**
 * Tiêu đề cột.
 *
 * Tiếng Việt, vì bảng này mở ra trong Excel của người vận hành chứ không đi vào
 * một hệ thống khác. Thứ tự đi từ "ai" tới "họ làm gì" tới "giấy tờ hành
 * chính": người đọc quét mắt từ trái sang và câu hỏi đầu tiên luôn là ai.
 */
export const EVENT_EXPORT_HEADERS = [
  "Buổi",
  "Thời gian buổi",
  "Họ và tên",
  "Email",
  "Số điện thoại",
  "Trạng thái đăng ký",
  "Trạng thái tham dự",
  "Đã check-in",
  "Thời điểm check-in",
  "Vãng lai",
  "MSSV",
  "Mã mentee",
  "Trường",
  "Ngành học",
  "Vai trò tự khai",
  "Ghi chú",
  "Câu hỏi cho diễn giả",
  "Mã vé",
  "Mã dự phòng",
  "Thời điểm đăng ký"
] as const;

function yesNo(value: unknown): string {
  return value === true || String(value) === "true" ? "Có" : "Không";
}

function text(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw;
}

/**
 * Một dòng đăng ký thành một dòng bảng.
 *
 * `sessions` tra theo `event_id` để cột "Buổi" nói đúng buổi nào — với một
 * chuỗi nhiều buổi, đây là cột người vận hành lọc đầu tiên.
 */
export function eventRegistrationRow(
  row: ExportRegistration,
  sessions: Map<string, ExportSession>
): string[] {
  const session = sessions.get(String(row.event_id));
  const checkedIn = row.attendance_status === "checked_in";

  return [
    session?.seriesIndex == null ? "" : `Buổi ${session.seriesIndex}`,
    session?.startsAt ? formatDateTime(session.startsAt) : "",
    text(row.full_name),
    text(row.email),
    text(row.phone),
    eventRegistrationStatusLabel(row.registration_status),
    attendanceStatusLabel(row.attendance_status),
    yesNo(checkedIn),
    row.checked_in_at ? formatDateTime(row.checked_in_at) : "",
    yesNo(row.is_walk_in),
    text(row.student_id),
    text(row.mentee_code),
    text(row.school),
    text(row.program_of_study),
    text(row.role_text),
    text(row.notes),
    text(row.speaker_question),
    text(row.checkin_code),
    text(row.short_code),
    row.registered_at ? formatDateTime(row.registered_at) : ""
  ];
}

/**
 * Tên file người vận hành nhìn thấy lúc tải về.
 *
 * Có tên sự kiện và ngày, vì tải ba buổi về cùng một thư mục mà cả ba tên là
 * `dang-ky.csv` thì không ai biết file nào của buổi nào. Bỏ dấu và mọi ký tự
 * Windows không nhận trong tên file.
 */
export function exportFileName(eventName: unknown, startsAt: unknown): string {
  const slug = String(eventName ?? "su-kien")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);

  const day = startsAt ? formatDateTime(startsAt).slice(0, 10).replace(/\//g, "-") : "";
  return ["dang-ky", slug || "su-kien", day].filter(Boolean).join("_") + ".csv";
}

/** Bảng hoàn chỉnh, kèm dòng tiêu đề. */
export function buildEventRegistrationCsv(
  rows: ExportRegistration[],
  sessions: Map<string, ExportSession>
): string {
  const table = [
    [...EVENT_EXPORT_HEADERS],
    ...rows.map((row) => eventRegistrationRow(row, sessions))
  ];
  return table.map((line) => line.map(csvCell).join(",")).join("\n");
}

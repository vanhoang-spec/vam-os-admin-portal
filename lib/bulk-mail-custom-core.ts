/**
 * lib/bulk-mail-custom-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của nhóm nhận thư "Danh sách tùy chỉnh" (VAM00026).
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO DANH SÁCH NÀY ĐƯỢC CHỐT VÀO LÔ, KHÔNG DỰNG LẠI
 * ---------------------------------------------------------------------------
 * Mọi nhóm cũ là một câu truy vấn viết sẵn, nên "Gửi tiếp" dựng lại được đúng danh
 * sách (xem đầu lib/bulk-mail-core.ts). Danh sách tùy chỉnh là nhiều nguồn cộng lại,
 * cộng người thêm tay, trừ người bỏ tick — không có câu truy vấn nào dựng lại nó.
 * Nên lúc mở lô, máy chủ ghi đúng danh sách cuối cùng vào `email_batch_recipients`,
 * và "Gửi tiếp" chỉ đọc bảng đó.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO FORM GỬI LÊN NGUỒN + KHOÁ, KHÔNG GỬI EMAIL
 * ---------------------------------------------------------------------------
 * Form là thứ người gửi tự đặt được. Nếu nhận email từ form, một lô "tùy chỉnh" là
 * một đường gửi thư của VAM tới bất kỳ địa chỉ nào. Nên form chỉ gửi lên (1) các
 * nguồn đã tick, (2) id người thêm tay, (3) khoá của từng dòng còn giữ tick. Máy chủ
 * dựng lại tập ứng viên từ database, và MỌI khoá gửi lên phải nằm trong tập đó —
 * lệch một khoá là từ chối cả lượt, không lặng lẽ bỏ dòng lạ đi. Email và họ tên
 * luôn lấy từ database.
 *
 * Không I/O — để test chạy được mà không cần database.
 */

import {
  partitionRecipients,
  type BulkRecipient,
  type RecipientPartition,
  type RecipientSource
} from "@/lib/bulk-mail-core";

/** Lọc người đăng ký sự kiện theo check-in — `event_registrations.attendance_status`. */
export const EVENT_CHECKIN_FILTERS = ["all", "checked_in", "not_checked_in"] as const;
export type EventCheckinFilter = (typeof EVENT_CHECKIN_FILTERS)[number];

export const EVENT_CHECKIN_FILTER_LABELS: Record<EventCheckinFilter, string> = {
  all: "Tất cả",
  checked_in: "Đã check-in",
  not_checked_in: "Chưa check-in"
};

export function isEventCheckinFilter(value: unknown): value is EventCheckinFilter {
  return typeof value === "string" && (EVENT_CHECKIN_FILTERS as readonly string[]).includes(value);
}

/**
 * Một phiếu đăng ký có qua bộ lọc check-in không.
 *
 * "Đã check-in" là đúng `attendance_status = 'checked_in'` — cùng điều máy quét ghi và
 * cùng điều trang điểm danh, thư khảo sát, thư nhắc đang đọc. "Chưa check-in" là mọi
 * giá trị còn lại (pending, no_show…), để hai lựa chọn cộng lại đúng bằng "Tất cả".
 */
export function matchesCheckinFilter(attendanceStatus: unknown, filter: EventCheckinFilter): boolean {
  if (filter === "all") return true;
  const checkedIn = String(attendanceStatus ?? "").trim() === "checked_in";
  return filter === "checked_in" ? checkedIn : !checkedIn;
}

export type CustomListSpec = {
  mentor: boolean;
  mentee: boolean;
  staff: boolean;
  event: { eventId: string; coversSeries: boolean; checkin: EventCheckinFilter } | null;
  /** Người thêm tay — id trong bảng `people`. */
  addedPersonIds: string[];
};

/** Trần người thêm tay và trần dòng một lượt gửi lên — chặn một form phình to bất thường. */
export const CUSTOM_LIST_MAX_ADDED = 200;
export const CUSTOM_LIST_MAX_RECIPIENTS = 5000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FormLike = {
  get(name: string): unknown;
  getAll(name: string): unknown[];
};

const flag = (value: unknown) => String(value ?? "").trim() === "true";

/**
 * Đọc nguồn của danh sách từ form. Chỉ kiểm HÌNH DẠNG; sự kiện có thuộc mùa không,
 * người thêm tay có thuộc mùa không là việc của đường đọc danh sách.
 *
 * Một id thêm tay sai dạng thì từ chối cả form, không lặng lẽ bỏ: người bấm đã thấy
 * người đó trong danh sách, và bỏ đi mà không nói là gửi thiếu.
 */
export function readCustomListSpec(form: FormLike): { ok: true; spec: CustomListSpec } | { ok: false; message: string } {
  const eventId = String(form.get("src_event_id") ?? "").trim();
  let event: CustomListSpec["event"] = null;
  if (eventId) {
    if (!UUID_PATTERN.test(eventId)) return { ok: false, message: "Sự kiện đã chọn không hợp lệ." };
    const checkin = String(form.get("src_event_checkin") ?? "all").trim() || "all";
    if (!isEventCheckinFilter(checkin)) return { ok: false, message: "Điều kiện check-in không hợp lệ." };
    event = { eventId: eventId.toLowerCase(), coversSeries: flag(form.get("src_event_series")), checkin };
  }

  const added: string[] = [];
  for (const raw of form.getAll("added_person_id")) {
    const id = String(raw ?? "").trim().toLowerCase();
    if (!id) continue;
    if (!UUID_PATTERN.test(id)) return { ok: false, message: "Có người thêm tay không hợp lệ. Vui lòng tải lại trang." };
    if (!added.includes(id)) added.push(id);
  }
  if (added.length > CUSTOM_LIST_MAX_ADDED) {
    return { ok: false, message: `Chỉ thêm tay được tối đa ${CUSTOM_LIST_MAX_ADDED} người một lượt.` };
  }

  const spec: CustomListSpec = {
    mentor: flag(form.get("src_mentor")),
    mentee: flag(form.get("src_mentee")),
    staff: flag(form.get("src_staff")),
    event,
    addedPersonIds: added
  };
  if (!spec.mentor && !spec.mentee && !spec.staff && !spec.event && !spec.addedPersonIds.length) {
    return { ok: false, message: "Chưa chọn nguồn nào và chưa thêm ai vào danh sách." };
  }
  return { ok: true, spec };
}

/**
 * Chuỗi đại diện cho một bộ nguồn — để màn hình biết bản xem trước đang hiện có còn
 * khớp với các ô đang tick không. Không dùng cho phép kiểm nào phía máy chủ.
 */
export function customListSignature(spec: CustomListSpec): string {
  return JSON.stringify([
    spec.mentor,
    spec.mentee,
    spec.staff,
    spec.event ? [spec.event.eventId, spec.event.coversSeries, spec.event.checkin] : null,
    spec.addedPersonIds.slice().sort()
  ]);
}

/** Khoá của một dòng: bảng nguồn + id. Khoá là thứ duy nhất form gửi lên về từng người. */
export function recipientKey(row: Pick<BulkRecipient, "personId" | "relationTable">): string {
  return `${row.relationTable ?? "people"}:${row.personId}`;
}

const SOURCES: readonly RecipientSource[] = ["people", "admin_users", "event_registrations", "applications"];

function isWellFormedKey(key: string): boolean {
  const at = key.indexOf(":");
  if (at <= 0) return false;
  return (SOURCES as readonly string[]).includes(key.slice(0, at)) && UUID_PATTERN.test(key.slice(at + 1));
}

/**
 * Gộp các nguồn thành một danh sách: mỗi email một lá.
 *
 * Mỗi nguồn sắp theo tên trước — đúng như các nhóm cũ — rồi nối theo thứ tự nguồn
 * truyền vào; bản giữ lại khi trùng email là bản của nguồn đứng trước (nên vai trò
 * "mentor" thắng vai trò "người tham dự" của cùng một người). Danh sách cuối cùng sắp
 * lại theo tên để người bấm đọc được.
 */
export function mergeCustomSources(groups: BulkRecipient[][]): RecipientPartition {
  const byName = (a: BulkRecipient, b: BulkRecipient) =>
    a.fullName.localeCompare(b.fullName, "vi") || a.email.localeCompare(b.email);
  const ordered = groups.flatMap((group) => group.slice().sort(byName));
  const partition = partitionRecipients(ordered);
  return { sendable: partition.sendable.slice().sort(byName), unreachable: partition.unreachable };
}

/**
 * Chọn danh sách cuối cùng từ tập ứng viên máy chủ tự dựng và các khoá form gửi lên.
 *
 * Fail-closed: một khoá sai dạng, trùng, hoặc không có trong tập ứng viên (id bịa, người
 * ngoài mùa, hoặc dữ liệu đã đổi từ lúc xem trước) là từ chối cả lượt.
 */
export function selectCustomRecipients(
  universe: BulkRecipient[],
  submittedKeys: unknown[]
): { ok: true; rows: BulkRecipient[] } | { ok: false; message: string } {
  const keys = submittedKeys.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (!keys.length) return { ok: false, message: "Danh sách chưa có ai được chọn." };
  if (keys.length > CUSTOM_LIST_MAX_RECIPIENTS) {
    return { ok: false, message: `Một lượt gửi tối đa ${CUSTOM_LIST_MAX_RECIPIENTS} người.` };
  }
  const wanted = new Set<string>();
  for (const key of keys) {
    if (!isWellFormedKey(key) || wanted.has(key)) {
      return { ok: false, message: "Danh sách gửi lên không hợp lệ. Vui lòng bấm “Xem danh sách người nhận” lại." };
    }
    wanted.add(key);
  }

  const known = new Map(universe.map((row) => [recipientKey(row), row]));
  const unknown = Array.from(wanted).filter((key) => !known.has(key)).length;
  if (unknown) {
    return {
      ok: false,
      message: `${unknown} người trong danh sách không còn khớp dữ liệu của mùa này (hoặc không thuộc mùa). Bấm “Xem danh sách người nhận” lại rồi gửi.`
    };
  }
  return { ok: true, rows: universe.filter((row) => wanted.has(recipientKey(row))) };
}

/**
 * lib/outbound-emails-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của sổ ghi thư đi: từ vựng, nhãn tiếng Việt và việc đọc tham số
 * lọc từ URL. Không import gì, không chạm DB — nên test được trọn vẹn và an
 * toàn để dùng từ cả server lẫn client component.
 *
 * Danh sách loại thư ở đây CỐ Ý hẹp hơn `EmailKind` trong lib/email-core.ts.
 * Union kia có 16 giá trị vì nó đi kèm cả tầng email của các giai đoạn chưa
 * merge; main mới chỉ phát ra hai loại, và bộ lọc trên màn hình chỉ nên chào
 * những gì thực sự có thể xuất hiện.
 */

export const OUTBOUND_EMAIL_STATUSES = ["queued", "sent", "failed", "skipped"] as const;
export type OutboundEmailStatus = (typeof OUTBOUND_EMAIL_STATUSES)[number];

export function isOutboundEmailStatus(value: unknown): value is OutboundEmailStatus {
  return (OUTBOUND_EMAIL_STATUSES as readonly string[]).includes(String(value ?? ""));
}

/** Loại thư xác nhận tương ứng với vai trò người nộp đơn. */
export const CONFIRMATION_KIND_BY_ROLE = {
  mentor: "mentor_application_confirmation",
  mentee: "mentee_application_confirmation"
} as const;

export type ApplicantRole = keyof typeof CONFIRMATION_KIND_BY_ROLE;
export type ConfirmationKind = (typeof CONFIRMATION_KIND_BY_ROLE)[ApplicantRole];

/** Thư mời ứng viên vào vòng phỏng vấn — gửi khi đơn chuyển sang invited_to_interview. */
export const INTERVIEW_ROUND_INVITE_KIND = "interview_round_invite";

/** Những loại thư main thực sự có thể phát ra hôm nay. */
export const MAIN_OUTBOUND_EMAIL_KINDS = [
  CONFIRMATION_KIND_BY_ROLE.mentee,
  CONFIRMATION_KIND_BY_ROLE.mentor,
  INTERVIEW_ROUND_INVITE_KIND
] as const;

export function confirmationKindForRole(role: unknown): ConfirmationKind | null {
  const text = String(role ?? "").trim();
  if (text === "mentor" || text === "mentee") return CONFIRMATION_KIND_BY_ROLE[text];
  return null;
}

const STATUS_LABELS: Record<OutboundEmailStatus, string> = {
  queued: "Đang chờ",
  sent: "Đã gửi",
  failed: "Lỗi",
  skipped: "Bỏ qua"
};

export function outboundEmailStatusLabel(value: unknown): string {
  const text = String(value ?? "");
  return isOutboundEmailStatus(text) ? STATUS_LABELS[text] : text || "-";
}

const KIND_LABELS: Record<string, string> = {
  mentee_application_confirmation: "Xác nhận đơn mentee",
  mentor_application_confirmation: "Xác nhận đơn mentor",
  interview_round_invite: "Mời vòng phỏng vấn",
  mentor_confirmation_link: "Link xác nhận mentor",
  review_batch_assigned: "Giao lô chấm hồ sơ",
  interview_scheduled: "Lịch phỏng vấn",
  reviewer_invite: "Mời chấm hồ sơ"
};

/** Nhãn tiếng Việt; loại lạ trả về nguyên mã để không giấu mất thông tin. */
export function outboundEmailKindLabel(value: unknown): string {
  const text = String(value ?? "");
  return KIND_LABELS[text] ?? (text || "-");
}

/**
 * Làm sạch chuỗi tìm kiếm trước khi nhúng vào bộ lọc PostgREST.
 *
 * Dấu phẩy, ngoặc đơn và nháy là ký tự dành riêng của cú pháp lọc PostgREST;
 * `%` và `_` là ký tự đại diện SQL. Cùng quy tắc với lib/data.ts.
 */
export function sanitizeIlikeTerm(value: unknown): string {
  return String(value ?? "")
    .replace(/[,()"'%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type OutboundEmailFilters = {
  status: OutboundEmailStatus | null;
  kind: string | null;
  q: string;
  page: number;
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Đọc tham số lọc từ searchParams.
 *
 * Giá trị lạ bị bỏ chứ không báo lỗi: một URL người dùng sửa tay không nên làm
 * hỏng trang, chỉ nên trả về danh sách không lọc.
 */
export function parseOutboundEmailFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined
): OutboundEmailFilters {
  const statusText = firstParam(searchParams?.status).trim();
  const kindText = firstParam(searchParams?.kind).trim();
  const pageRaw = Number.parseInt(firstParam(searchParams?.page).trim(), 10);

  return {
    status: isOutboundEmailStatus(statusText) ? statusText : null,
    kind: (MAIN_OUTBOUND_EMAIL_KINDS as readonly string[]).includes(kindText) ? kindText : null,
    q: sanitizeIlikeTerm(firstParam(searchParams?.q)),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
  };
}

/** Dựng lại query string cho link phân trang, giữ nguyên bộ lọc đang áp dụng. */
export function outboundEmailQueryString(filters: OutboundEmailFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.q) params.set("q", filters.q);
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `?${text}` : "";
}

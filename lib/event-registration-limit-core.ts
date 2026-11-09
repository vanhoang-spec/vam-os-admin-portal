/**
 * Giới hạn số lần một email được đăng ký sự kiện (báo lỗi VAM00015, 03/11/2026). Phần thuần, không I/O.
 *
 * Chốt chặn thật nằm ở database (trigger trong migration 20261103230000), để hai lần bấm gần nhau
 * không cùng lọt qua. Ở đây chỉ có luật đọc ô nhập, câu báo cho người đăng ký, và nhận ra lỗi của trigger.
 */

export type RegistrationLimitScope = "event" | "series";
export type RegistrationLimit = { limit: number | null; scope: RegistrationLimitScope };

/** Tên lỗi trigger ném ra. Trùng với message của `raise exception` trong migration. */
export const REGISTRATION_LIMIT_ERROR = "EVENT_REGISTRATION_LIMIT_REACHED";

/** Một con số chặn trên cho ô nhập: gõ nhầm 1000000 không phải là một giới hạn. */
export const REGISTRATION_LIMIT_MAX = 1000;

export const NO_REGISTRATION_LIMIT: RegistrationLimit = { limit: null, scope: "event" };

/**
 * Một lượt đăng ký có tính vào giới hạn không. Phải khớp `vam_registration_counts_toward_limit` trong
 * migration: huỷ và bị từ chối thì hoàn lượt; chờ duyệt, đã xác nhận và danh sách chờ đều tính.
 */
export function countsTowardRegistrationLimit(status: string | null | undefined) {
  const value = String(status ?? "");
  return value !== "cancelled" && value !== "rejected";
}

function wholeNumber(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Đọc hai ô trên form sự kiện.
 *
 * - Ô số để trống: không giới hạn (phạm vi bị bỏ qua, về "event").
 * - Có số: phải là số nguyên dương, tối đa REGISTRATION_LIMIT_MAX.
 * - Phạm vi "series" được GIỮ cả trên sự kiện lẻ (VAM00028): nó có hiệu lực từ lúc sự kiện được thêm
 *   buổi. Hạ nó về "event" như trước thì "Thêm buổi" chép "event" sang buổi mới, và mỗi buổi tự giới
 *   hạn riêng thay vì chung cả chuỗi. Khi còn lẻ, "series" đọc như "event" (`readRegistrationLimit`).
 * - Phạm vi "event" chỉ nhận số 1: trong một buổi mỗi email đã chỉ giữ một đăng ký còn hiệu lực
 *   (nộp lại là ghi đè), nên số lớn hơn sẽ là lời hứa mà hệ thống không giữ.
 */
export function parseRegistrationLimitInput(
  limitRaw: unknown,
  scopeRaw: unknown
): { ok: true; value: RegistrationLimit } | { ok: false; message: string } {
  const text = String(limitRaw ?? "").trim();
  if (text === "") return { ok: true, value: NO_REGISTRATION_LIMIT };

  const limit = wholeNumber(text);
  if (limit === null || limit < 1) {
    return { ok: false, message: "Giới hạn số lần đăng ký phải là số nguyên dương (1, 2, 3…), hoặc để trống nếu không giới hạn." };
  }
  if (limit > REGISTRATION_LIMIT_MAX) {
    return { ok: false, message: `Giới hạn số lần đăng ký tối đa là ${REGISTRATION_LIMIT_MAX}.` };
  }

  const scope: RegistrationLimitScope = String(scopeRaw ?? "").trim() === "series" ? "series" : "event";
  if (scope === "event" && limit > 1) {
    return {
      ok: false,
      message:
        "Trong một sự kiện, mỗi email chỉ giữ một đăng ký còn hiệu lực (nộp lại là ghi đè), nên phạm vi “Một sự kiện” chỉ nhận số 1. Muốn cho đăng ký nhiều buổi, chọn phạm vi “Toàn bộ chuỗi”."
    };
  }
  return { ok: true, value: { limit, scope } };
}

/** Giới hạn đang lưu trên một dòng sự kiện. Giá trị lạ coi như không giới hạn. */
export function readRegistrationLimit(event: Record<string, unknown> | null | undefined): RegistrationLimit {
  const limit = wholeNumber(event?.registration_limit_per_email);
  if (limit === null || limit < 1) return NO_REGISTRATION_LIMIT;
  const inSeries = Boolean(event?.series_id);
  const scope: RegistrationLimitScope = event?.registration_limit_scope === "series" && inSeries ? "series" : "event";
  return { limit, scope };
}

/**
 * Giới hạn CHUNG của một chuỗi (VAM00028), từ các dòng `events` cùng `series_id`: số nhỏ nhất trong
 * các buổi có phạm vi "series" và có số. Một buổi mang giới hạn theo chuỗi là đủ để mọi buổi, kể cả
 * buổi thêm sau, cùng chịu nó. Phải khớp trigger `vam_enforce_event_registration_limit`
 * (migration 20261109120000). null: chuỗi không có giới hạn theo chuỗi.
 */
export function seriesRegistrationLimit(sessions: ReadonlyArray<Record<string, unknown> | null | undefined>): RegistrationLimit | null {
  let lowest: number | null = null;
  for (const row of sessions) {
    if (row?.registration_limit_scope !== "series") continue;
    const limit = wholeNumber(row.registration_limit_per_email);
    if (limit === null || limit < 1) continue;
    if (lowest === null || limit < lowest) lowest = limit;
  }
  return lowest === null ? null : { limit: lowest, scope: "series" };
}

/**
 * Giới hạn có hiệu lực cho một buổi: buổi thuộc chuỗi mà chuỗi có giới hạn chung thì theo chuỗi,
 * bất kể chính dòng của buổi đó ghi gì; còn lại đọc trên chính dòng.
 */
export function effectiveRegistrationLimit(
  event: Record<string, unknown> | null | undefined,
  seriesSessions: ReadonlyArray<Record<string, unknown> | null | undefined>
): RegistrationLimit {
  if (event?.series_id) {
    const shared = seriesRegistrationLimit(seriesSessions);
    if (shared) return shared;
  }
  return readRegistrationLimit(event);
}

/**
 * Giới hạn mà trigger đã dùng để chặn, đọc từ `detail` của lỗi ("scope=series; limit=N; ...").
 * Câu báo cho người đăng ký lấy số từ đây, vì đó là con số database thật sự áp, không phải số
 * ghi trên riêng buổi họ chọn.
 */
export function registrationLimitFromError(error: unknown): RegistrationLimit | null {
  if (!isRegistrationLimitError(error)) return null;
  const shape = error as { message?: unknown; details?: unknown; hint?: unknown };
  for (const part of [shape.details, shape.message, shape.hint]) {
    if (typeof part !== "string") continue;
    const match = /limit=(\d+)/.exec(part);
    const limit = match ? wholeNumber(match[1]) : null;
    if (limit !== null && limit >= 1) {
      return { limit, scope: /scope=event/.test(part) ? "event" : "series" };
    }
  }
  return null;
}

/** Câu người đăng ký đọc khi email của họ đã đủ lượt. */
export function registrationLimitReachedMessage(value: RegistrationLimit): string {
  const times = value.limit ?? 1;
  if (value.scope === "series") {
    return (
      `Email này đã đăng ký đủ số lần cho phép (${times} lần) trong chuỗi sự kiện này. ` +
      "Muốn đăng ký buổi khác, hãy huỷ một đăng ký đã có hoặc liên hệ ban tổ chức."
    );
  }
  return "Email này đã đăng ký sự kiện này rồi. Nếu cần thay đổi, vui lòng liên hệ ban tổ chức.";
}

/** Dòng thông tin hiện trên form đăng ký công khai; null khi không có giới hạn đáng nói. */
export function registrationLimitNotice(value: RegistrationLimit): string | null {
  if (value.limit === null) return null;
  if (value.scope === "series") {
    return `Mỗi email được đăng ký tối đa ${value.limit} buổi trong chuỗi sự kiện này.`;
  }
  return "Mỗi email chỉ đăng ký một lần cho sự kiện này.";
}

/** Lỗi do trigger giới hạn ném ra (qua PostgREST hoặc qua hàm ghi đăng ký của form tùy chỉnh). */
export function isRegistrationLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const shape = error as { message?: unknown; details?: unknown; hint?: unknown };
  return [shape.message, shape.details, shape.hint].some(
    (part) => typeof part === "string" && part.includes(REGISTRATION_LIMIT_ERROR)
  );
}

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
 * - Phạm vi "series" chỉ có nghĩa với sự kiện thuộc chuỗi; sự kiện lẻ tự về "event".
 * - Phạm vi "event" chỉ nhận số 1: trong một buổi mỗi email đã chỉ giữ một đăng ký còn hiệu lực
 *   (nộp lại là ghi đè), nên số lớn hơn sẽ là lời hứa mà hệ thống không giữ.
 */
export function parseRegistrationLimitInput(
  limitRaw: unknown,
  scopeRaw: unknown,
  options: { inSeries: boolean }
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

  const wantsSeries = String(scopeRaw ?? "").trim() === "series";
  const scope: RegistrationLimitScope = wantsSeries && options.inSeries ? "series" : "event";
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

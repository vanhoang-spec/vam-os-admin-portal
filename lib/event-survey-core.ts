/**
 * lib/event-survey-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Khảo sát sau sự kiện: câu hỏi, phép kiểm phiếu, ai nhận thư, và "nộp phiếu là
 * check out".
 *
 * Module thuần, không I/O — form công khai (trình duyệt), hàm ghi (máy chủ) và
 * bảng điều khiển của ban tổ chức đọc chung một định nghĩa. Nhờ vậy câu chữ trên
 * màn hình không thể nói khác điều hàm ghi thật sự làm.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO NỘP PHIẾU LẠI LÀ CHECK OUT
 * ---------------------------------------------------------------------------
 * Chủ dự án chốt 19/09/2026: sinh viên dự Mentee Orientation được đề xuất điểm
 * rèn luyện, và căn cứ là "có check in VÀ có check out". Bắt các bạn xếp hàng
 * quét mã lần nữa lúc tan buổi là thứ không ai làm được trong ba phút cuối, nên
 * hành động điền phiếu được tính luôn là check out.
 *
 * Việc đó ghi đúng một dòng `event_scans` ở trạm check out — không phải một khái
 * niệm thứ hai song song. Xem đầu file migration 20260919043000.
 */

import { isValidEmail, normalizeEmail } from "@/lib/identity";
import { normalizeRegistrationPhone } from "@/lib/event-registration-match";
import {
  ENTRANCE_STATION,
  stationFor,
  type CheckinPurpose,
  type CheckinStep
} from "@/lib/event-checkin-steps";

/** Mục "Check out" trong thiết lập các lần quét của một sự kiện. */
export const CHECKOUT_PURPOSE: CheckinPurpose = "checkout";

/**
 * Trạm được ghi khi một người nộp phiếu.
 *
 * Sự kiện đã thiết lập lần quét Check out thì dùng ĐÚNG trạm đó, để phiếu và
 * lượt quét tay ở cửa ra rơi vào cùng một con số. Chưa thiết lập (phần lớn sự
 * kiện chỉ có Check in) thì vẫn ghi `checkout`: bảng đếm hiện nó như một trạm
 * ngoài thiết lập, thà vậy còn hơn im lặng không ghi gì.
 */
export function checkoutStationFor(steps: readonly CheckinStep[]): string {
  return steps.find((step) => step.purpose === CHECKOUT_PURPOSE)?.station ?? stationFor(CHECKOUT_PURPOSE, 1);
}

/** Người này đã qua một lần quét Check in nào của buổi chưa. */
export function hasEntranceScan(stations: readonly string[], steps: readonly CheckinStep[]): boolean {
  const entrances = new Set(steps.filter((step) => step.purpose === ENTRANCE_STATION).map((step) => step.station));
  // Sự kiện không thiết lập lần Check in nào thì trạm mặc định vẫn là `entrance`
  // — đó là trạm mọi lượt quét cũ đã ghi.
  if (!entrances.size) entrances.add(ENTRANCE_STATION);
  return stations.some((station) => entrances.has(String(station ?? "").trim()));
}

/** Tên câu hỏi thứ nhất, gắn với tên buổi để phiếu không hỏi trống không. */
export function impressionQuestion(eventName: unknown): string {
  const name = String(eventName ?? "").trim();
  return name
    ? `Điều làm bạn ấn tượng nhất sau chương trình ${name}?`
    : "Điều làm bạn ấn tượng nhất sau chương trình?";
}

/** Câu hỏi thứ hai. Không đổi theo sự kiện. */
export const QUESTION_PROMPT = "Bạn có câu hỏi gì muốn BTC UEH Mentoring giải đáp không?";

/**
 * Câu nói rõ vì sao phiếu hỏi họ tên, email và số điện thoại.
 *
 * Đúng nguyên văn chủ dự án yêu cầu 19/09/2026, chỉ thay tên buổi và ngày. Hỏi
 * thông tin cá nhân mà không nói dùng để làm gì là thứ người điền có quyền từ
 * chối, và họ sẽ từ chối bằng cách gõ tên giả.
 */
export function trackingNotice(eventName: unknown, dayLabel: unknown): string {
  const name = String(eventName ?? "").trim() || "sự kiện";
  const day = String(dayLabel ?? "").trim();
  return (
    "Câu hỏi survey này nhằm giúp BTC có thông tin cho việc đề xuất điểm rèn luyện " +
    `cho các bạn Sinh viên tham dự event ${name}${day ? ` ngày ${day}` : ""}.`
  );
}

/** Nộp phiếu xong thì màn hình nói gì. */
export const SUBMITTED_HEADING = "Đã ghi nhận phiếu của bạn";
export const SUBMITTED_CHECKED_OUT =
  "Phiếu này cũng là thao tác check out của bạn cho buổi hôm nay — ban tổ chức đã ghi nhận bạn tham dự đầy đủ.";
export const SUBMITTED_UNMATCHED =
  "Ban tổ chức chưa tìm thấy lượt đăng ký khớp với email và số điện thoại bạn vừa điền, nên phần check out sẽ được đối chiếu tay. Nếu bạn có đăng ký bằng email khác, vui lòng báo ban tổ chức tại chỗ.";
export const SUBMITTED_NO_CHECKIN =
  "Ban tổ chức chưa ghi nhận lượt check in đầu buổi của bạn. Phiếu vẫn được lưu; vui lòng báo ban tổ chức để được điểm danh bù.";

/** Giới hạn độ dài từng ô. Cắt ở tầng thuần để cả form lẫn hàm ghi cùng một số. */
export const MAX_NAME = 120;
export const MAX_EMAIL = 200;
export const MAX_PHONE = 40;
export const MAX_STUDENT_ID = 40;
export const MAX_ANSWER = 2000;

export type SurveySource = "email" | "qr";

export type SurveyInput = {
  full_name: string;
  email: string;
  phone: string;
  student_id: string;
  impression: string;
  question: string;
};

export const EMPTY_SURVEY_INPUT: SurveyInput = {
  full_name: "",
  email: "",
  phone: "",
  student_id: "",
  impression: "",
  question: ""
};

export type SurveyValidation =
  | {
      ok: true;
      values: SurveyInput;
      emailNorm: string;
      phoneNorm: string;
    }
  | { ok: false; message: string; field: keyof SurveyInput };

function trim(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

/**
 * Kiểm phiếu gửi lên.
 *
 * Ô chọn và thuộc tính `required` trên màn hình KHÔNG phải một phép kiểm — thứ
 * đến từ biểu mẫu là thứ người gửi tự đặt được. Hàm này là phép kiểm thật, và
 * hàm ghi gọi nó chứ không tin form.
 *
 * Email bắt buộc vì nó là khoá đối chiếu với lượt đăng ký; số điện thoại là
 * đường đối chiếu thứ hai khi email lệch, nên cũng bắt buộc.
 */
export function validateSurveyInput(raw: Partial<SurveyInput> | null | undefined): SurveyValidation {
  const values: SurveyInput = {
    full_name: trim(raw?.full_name, MAX_NAME),
    email: trim(raw?.email, MAX_EMAIL),
    phone: trim(raw?.phone, MAX_PHONE),
    student_id: trim(raw?.student_id, MAX_STUDENT_ID),
    impression: trim(raw?.impression, MAX_ANSWER),
    question: trim(raw?.question, MAX_ANSWER)
  };

  if (!values.full_name) return { ok: false, field: "full_name", message: "Vui lòng điền họ và tên của bạn." };

  const emailNorm = normalizeEmail(values.email);
  if (!isValidEmail(emailNorm)) {
    return { ok: false, field: "email", message: "Vui lòng điền email — đây là thông tin dùng để đối chiếu với lượt check in." };
  }

  const phoneNorm = normalizeRegistrationPhone(values.phone);
  if (!phoneNorm) {
    return { ok: false, field: "phone", message: "Vui lòng điền số điện thoại của bạn." };
  }

  if (!values.impression) {
    return { ok: false, field: "impression", message: "Vui lòng trả lời câu hỏi đầu tiên." };
  }

  return { ok: true, values, emailNorm, phoneNorm };
}

export function isSurveySource(value: unknown): value is SurveySource {
  return value === "email" || value === "qr";
}

/** Link công khai của phiếu. `?tu=thu` chỉ để biết phiếu tới từ thư hay từ mã QR. */
export function surveyUrl(origin: unknown, token: unknown, source?: SurveySource): string {
  const base = String(origin ?? "").replace(/\/+$/, "");
  const path = `${base}/khao-sat/${String(token ?? "").trim()}`;
  return source === "email" ? `${path}?tu=thu` : path;
}

/** Đọc `?tu=` thành nguồn phiếu. Giá trị lạ là QR — đó là đường không mang tham số. */
export function sourceFromParam(value: unknown): SurveySource {
  return String(value ?? "").trim() === "thu" ? "email" : "qr";
}

// ───────────────────────────────────────────────────────────────────────────
// Gửi thư khảo sát
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ai nhận thư khảo sát.
 *
 * `checked_in` là mặc định và là điều chủ dự án yêu cầu: chỉ gửi cho người đã
 * qua khâu check in, tức là chắc chắn có dự.
 *
 * `all_registered` là đường lùi có chủ ý, KHÔNG phải mặc định. Buổi trực tuyến
 * thường không ai quét mã, và lúc 18:30 mà số check in bằng 0 thì ban tổ chức
 * phải chọn được giữa "không gửi cho ai" và "gửi cho toàn bộ người đăng ký". Màn
 * hình nói rõ lựa chọn này rộng hơn quy tắc gốc trước khi cho bấm.
 */
export const SURVEY_AUDIENCES = ["checked_in", "all_registered"] as const;
export type SurveyAudience = (typeof SURVEY_AUDIENCES)[number];

export const SURVEY_AUDIENCE_LABELS: Record<SurveyAudience, string> = {
  checked_in: "Người đã check in",
  all_registered: "Toàn bộ người đăng ký (kể cả chưa check in)"
};

export function isSurveyAudience(value: unknown): value is SurveyAudience {
  return typeof value === "string" && (SURVEY_AUDIENCES as readonly string[]).includes(value);
}

/** Trạng thái đăng ký còn được nhận thư: đã huỷ hay bị từ chối thì không. */
const MAILABLE_STATUSES = ["registered", "confirmed", "pending_review", "waitlisted"] as const;

/**
 * Dòng đăng ký này có nhận thư khảo sát không.
 *
 * Danh sách chờ CÓ nhận — khác thư nhắc lịch, nơi người chưa có chỗ không được
 * hứa hẹn gì. Ở đây điều kiện là đã check in, tức là họ đã ngồi trong buổi rồi,
 * và một người có mặt mà không được hỏi ý kiến là một thiếu sót.
 */
export function isSurveyRecipient(
  row: { registration_status?: unknown; attendance_status?: unknown; email?: unknown },
  audience: SurveyAudience
): boolean {
  const status = String(row.registration_status ?? "").trim();
  if (!(MAILABLE_STATUSES as readonly string[]).includes(status)) return false;
  if (!String(row.email ?? "").trim()) return false;
  if (audience === "all_registered") return true;
  return String(row.attendance_status ?? "").trim() === "checked_in";
}

/**
 * Số thư mỗi lần gọi máy chủ, và trần thời gian của một lần gọi.
 *
 * Cùng con số với "Gửi remind" (lib/event-reminder-core.ts) và vì cùng lý do:
 * mỗi thư có thể mất vài giây ở nhà cung cấp, còn một lần gọi bị cắt vì quá giờ
 * là thư cuối đã đi mà dòng đánh dấu chưa kịp ghi.
 */
export const SURVEY_CHUNK = 10;
export const SURVEY_TIME_BUDGET_MS = 45_000;

/** Dòng 'sending' cũ hơn mốc này là của một lần gọi đã chết; chốt thành lỗi. */
export const SURVEY_STALE_SENDING_MS = 10 * 60_000;

export const SURVEY_STATES = ["queued", "sending", "sent", "failed", "skipped"] as const;
export type SurveyState = (typeof SURVEY_STATES)[number];
export type SurveyCounts = Record<SurveyState, number>;

export const EMPTY_SURVEY_COUNTS: SurveyCounts = { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };

export function countSurveyStates(rows: Array<{ status?: unknown }>): SurveyCounts {
  const counts: SurveyCounts = { ...EMPTY_SURVEY_COUNTS };
  for (const row of rows) {
    const status = String(row.status ?? "").trim() as SurveyState;
    if ((SURVEY_STATES as readonly string[]).includes(status)) counts[status] += 1;
  }
  return counts;
}

export function surveyRemaining(counts: SurveyCounts): number {
  return counts.queued + counts.sending;
}

export function surveyTotal(counts: SurveyCounts): number {
  return counts.queued + counts.sending + counts.sent + counts.failed + counts.skipped;
}

/** "Đã gửi 12/40 · lỗi 1 · còn 27" — chỉ nói những con số khác 0. */
export function describeSurveyCounts(counts: SurveyCounts, total = surveyTotal(counts)): string {
  const parts = [`Đã gửi ${counts.sent}/${total}`];
  if (counts.failed) parts.push(`lỗi ${counts.failed}`);
  if (counts.skipped) parts.push(`bỏ qua ${counts.skipped}`);
  const remaining = surveyRemaining(counts);
  if (remaining) parts.push(`còn ${remaining}`);
  return parts.join(" · ");
}

export type SurveySendResult = {
  ok: boolean;
  message: string;
  counts?: SurveyCounts;
  /** Kết quả của riêng lần gọi này. Vắng khi lần gọi không gửi thư nào. */
  chunk?: { sent: number; failed: number; skipped: number; queued: number };
};

/** Vòng gửi tự động của màn hình có gọi tiếp không. */
export function shouldContinueSurvey(result: SurveySendResult): boolean {
  if (!result.ok || !result.chunk) return false;
  if (!surveyRemaining(result.counts ?? EMPTY_SURVEY_COUNTS)) return false;
  // Cả lô đều lỗi thì lỗi nằm ở nhà cung cấp hay hạn mức; gọi tiếp chỉ đốt nốt
  // phần còn lại của danh sách thành thư lỗi.
  return result.chunk.sent + result.chunk.skipped > 0;
}

export function surveyMaxRounds(total: number): number {
  const safe = Number.isFinite(total) && total > 0 ? total : 0;
  return Math.ceil(safe / SURVEY_CHUNK) + 5;
}

/**
 * Đã tới giờ tự gửi chưa.
 *
 * Có trần 6 giờ: một mốc `survey_send_at` của buổi tuần trước không được biến
 * thành một lượt gửi bất ngờ vào hôm nay chỉ vì ai đó mở lại trang sự kiện cũ.
 */
export const SURVEY_AUTO_WINDOW_MS = 6 * 60 * 60_000;

export function surveyAutoSendDue(sendAt: unknown, nowMs: number): boolean {
  const at = Date.parse(String(sendAt ?? ""));
  if (!Number.isFinite(at)) return false;
  return nowMs >= at && nowMs - at <= SURVEY_AUTO_WINDOW_MS;
}

/** Lý do KHÔNG gửi được thư khảo sát lúc này, hoặc null. */
export function surveySendBlockReason(
  event: { status?: unknown; starts_at?: unknown } | null,
  hasLink: boolean
): string | null {
  if (!event) return "Không tìm thấy buổi này.";
  if (String(event.status ?? "").trim() === "cancelled") {
    return "Buổi này đã huỷ — không gửi khảo sát cho một buổi không diễn ra.";
  }
  if (!hasLink) {
    return "Chưa có link khảo sát. Bấm “Tạo link khảo sát” trước, vì thư gửi đi phải mang được link đó.";
  }
  return null;
}

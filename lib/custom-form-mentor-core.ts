/**
 * Form tùy chỉnh: "Tự động gửi Submission cho Mentor" (VAM00011) — phần thuần, không I/O.
 *
 * Trạng thái sống ở bảng custom_form_mentor_sends, mỗi câu trả lời một dòng:
 *   cho_ghep_cap   đã nhận ra mentee, chưa có mentor (hoặc thư chưa đi vì chạm hạn mức)
 *   dang_gui       một tiến trình đã chiếm dòng này, đang gửi
 *   da_gui         đã gửi. Không bao giờ gửi lại, kể cả khi mentee đổi mentor
 *   loi            chưa gửi được, lý do ở last_error
 *   khong_nhan_ra  email không khớp đúng một người: không gửi, BTC thấy trên trang câu trả lời
 */
import { answerText, isQuestion, type CustomFormAnswers, type CustomFormField } from "@/lib/custom-form-core";

export const MENTOR_SEND_STATUSES = ["cho_ghep_cap", "dang_gui", "da_gui", "loi", "khong_nhan_ra"] as const;
export type MentorSendStatus = (typeof MENTOR_SEND_STATUSES)[number];

export const MENTOR_SEND_STATUS_LABELS: Record<MentorSendStatus, string> = {
  cho_ghep_cap: "Chờ ghép cặp",
  dang_gui: "Đang gửi",
  da_gui: "Đã gửi",
  loi: "Lỗi",
  khong_nhan_ra: "Không nhận ra mentee"
};

/** Nhãn cho một giá trị đọc từ database; giá trị lạ hiện nguyên để không giấu thông tin. */
export function mentorSendStatusLabel(value: unknown): string {
  const text = String(value ?? "");
  return (MENTOR_SEND_STATUSES as readonly string[]).includes(text) ? MENTOR_SEND_STATUS_LABELS[text as MentorSendStatus] : text || "-";
}

/** Gửi lỗi quá chừng này lần thì dừng tự thử lại: mỗi lần thử với nhà cung cấp đang lỗi đều có nguy cơ trùng thư. */
export const MENTOR_SEND_MAX_ATTEMPTS = 3;
/** Số thư tối đa một lượt, và thời gian tối đa một lượt: route cron có 60 giây, phần còn lại để lượt sau. */
export const MENTOR_SEND_BATCH = 60;
export const MENTOR_SEND_RUN_MS = 45_000;
/** Dòng `dang_gui` lâu hơn mức này là tiến trình đã chết giữa chừng. */
export const MENTOR_CLAIM_STALE_MS = 15 * 60_000;

/**
 * Một dòng có còn việc để làm không. `khong_nhan_ra` chỉ xét lại khi BTC bấm nút: mỗi dòng tốn một lần tra
 * `people`, và form công khai ai cũng gửi được email lạ, nên cron không nên trả giá đó hằng ngày.
 */
export function isOpenMentorSend(row: { status?: unknown; attempts?: unknown }, recheckUnknown: boolean): boolean {
  if (row.status === "cho_ghep_cap") return true;
  if (row.status === "khong_nhan_ra") return recheckUnknown;
  return row.status === "loi" && Number(row.attempts ?? 0) < MENTOR_SEND_MAX_ATTEMPTS;
}

export type ActiveMatchRow = { id?: unknown; mentor_person_id?: unknown; mentee_person_id?: unknown };
export type MentorPick = { kind: "none" } | { kind: "one"; matchId: string; mentorPersonId: string } | { kind: "many"; count: number };

/**
 * Mentor của mentee từ các cặp active. Hai mentor khác nhau thì KHÔNG chọn: đổi cặp mà cặp cũ chưa kết thúc
 * cũng trông y như vậy, và gửi nhầm là đưa dữ liệu mentee cho người không liên quan. Hai dòng cùng một
 * mentor không phải mơ hồ. Lấy id nhỏ nhất để kết quả không phụ thuộc thứ tự database trả về.
 */
export function pickMentor(matches: ActiveMatchRow[]): MentorPick {
  const usable = matches.filter((m) => m.mentor_person_id).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const mentors = new Set(usable.map((m) => String(m.mentor_person_id)));
  if (mentors.size === 0) return { kind: "none" };
  if (mentors.size > 1) return { kind: "many", count: mentors.size };
  return { kind: "one", matchId: String(usable[0].id), mentorPersonId: String(usable[0].mentor_person_id) };
}

export type MentorAnswerRow = { label: string; value: string };

/**
 * Bảng câu trả lời trong thư. Theo định nghĩa ĐANG có của form: câu BTC đã ẩn không ra khỏi hệ thống, dù
 * mentee đã trả lời trước lúc ẩn. Câu bị bỏ qua vì rẽ nhánh không có câu trả lời nên không chiếm dòng.
 */
export function mentorAnswerRows(fields: CustomFormField[], answers: CustomFormAnswers): MentorAnswerRow[] {
  return fields
    .filter((f) => isQuestion(f) && !f.hidden)
    .map((f) => ({ label: f.label, value: answerText(answers[f.id]) }))
    .filter((row) => row.value);
}

/** Bảng cho thư thử: đúng câu hỏi đang hiện, chữ giữ chỗ, không chạm dữ liệu người thật. */
export function sampleMentorAnswerRows(fields: CustomFormField[]): MentorAnswerRow[] {
  return fields.filter((f) => isQuestion(f) && !f.hidden).map((f) => ({ label: f.label, value: "(câu trả lời của mentee)" }));
}

export type MentorSweepCounts = { sent: number; waiting: number; unknown: number; failed: number };
export type MentorSweepStop = "quota" | "mail_off" | "time" | "batch" | null;

/** Câu báo cho người bấm nút. */
export function mentorSweepMessage(counts: MentorSweepCounts, stop: MentorSweepStop): string {
  const parts = [`Đã gửi ${counts.sent} bản`, `${counts.waiting} bản còn chờ ghép cặp`];
  if (counts.unknown) parts.push(`${counts.unknown} bản không nhận ra mentee`);
  if (counts.failed) parts.push(`${counts.failed} bản lỗi`);
  const tail =
    stop === "quota"
      ? " Đã chạm hạn mức thư, phần còn lại gửi ở lượt sau."
      : stop === "mail_off"
        ? " Môi trường này đang tắt gửi thư nên chưa bản nào đi."
        : stop === "time" || stop === "batch"
          ? " Còn bản chưa xử lý, bấm lại để gửi tiếp."
          : "";
  return `${parts.join(", ")}.${tail}`;
}

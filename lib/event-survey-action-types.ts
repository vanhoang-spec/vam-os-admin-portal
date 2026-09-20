import { EMPTY_SURVEY_INPUT, type SurveyInput } from "@/lib/event-survey-core";

/**
 * lib/event-survey-action-types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Trạng thái của form khảo sát công khai.
 *
 * Nằm ở file riêng vì file `"use server"` chỉ được xuất hàm async — xuất một
 * hằng số hay một kiểu từ đó là lỗi lúc biên dịch, và bài kiểm
 * `use-server-export-contract` giữ đúng ranh giới đó.
 */

export type SurveyFormStatus = "idle" | "success" | "validation_error" | "link_error" | "server_error";

export type SurveyFormState = {
  ok: boolean;
  status: SurveyFormStatus;
  message: string;
  /** Ô nào sai, để màn hình đưa con trỏ về đúng chỗ. */
  field: keyof SurveyInput | null;
  /** Khớp được lượt đăng ký nào không. */
  matched: boolean;
  /** Người này đã được quét Check in đầu buổi chưa. */
  checkedIn: boolean;
  /** Giữ lại những gì người ta vừa gõ, để lỗi không xoá trắng phiếu. */
  values: SurveyInput;
};

export const INITIAL_SURVEY_FORM_STATE: SurveyFormState = {
  ok: false,
  status: "idle",
  message: "",
  field: null,
  matched: false,
  checkedIn: false,
  values: { ...EMPTY_SURVEY_INPUT }
};

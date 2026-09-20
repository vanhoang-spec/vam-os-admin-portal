"use server";

import { submitEventSurvey } from "@/lib/event-survey";
import { sourceFromParam, type SurveyInput } from "@/lib/event-survey-core";
import type { SurveyFormState } from "@/lib/event-survey-action-types";

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Nộp phiếu khảo sát cuối buổi.
 *
 * Trả kết quả về ngay trên trang thay vì chuyển hướng: người điền đang cầm điện
 * thoại giữa hội trường, và họ cần đọc được câu "phiếu này cũng là check out của
 * bạn" ngay tại chỗ — một lần tải lại trang giữa mạng 4G chật là một lần họ
 * không chắc mình đã gửi được hay chưa.
 */
export async function submitEventSurveyAction(
  _previousState: SurveyFormState,
  formData: FormData
): Promise<SurveyFormState> {
  const values: SurveyInput = {
    full_name: formText(formData, "full_name"),
    email: formText(formData, "email"),
    phone: formText(formData, "phone"),
    student_id: formText(formData, "student_id"),
    impression: formText(formData, "impression"),
    question: formText(formData, "question")
  };

  const result = await submitEventSurvey({
    token: formText(formData, "token"),
    source: sourceFromParam(formText(formData, "source")),
    values
  });

  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    field: result.field ?? null,
    matched: Boolean(result.matched),
    checkedIn: Boolean(result.checkedIn),
    // Gửi xong thì không giữ lại nội dung: màn hình kết quả thay chỗ cái form, và
    // giữ lại chỉ mời người ta bấm gửi lần nữa.
    values: result.status === "success" ? { ...values, impression: "", question: "" } : values
  };
}

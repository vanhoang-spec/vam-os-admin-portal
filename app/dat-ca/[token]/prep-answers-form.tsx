"use client";

import { useFormState } from "react-dom";
import { keepFormValues } from "@/lib/keep-form-values";
import { savePrepAnswersAction } from "./actions";
import {
  INITIAL_PREP_ANSWERS_STATE,
  type PrepAnswersState
} from "@/lib/mentee-interview-action-types";
import { MENTEE_PREP_QUESTIONS } from "@/lib/email-core";
import type { PrepQuestion } from "@/lib/mentee-interview";

/**
 * Hai câu hỏi chuẩn bị — không bắt buộc, mentee điền được bất cứ lúc nào sau
 * khi nhận thư mời, không cần chờ tới ngày phỏng vấn. Câu trả lời lưu thẳng
 * vào hồ sơ và mentor thấy lại trong lúc phỏng vấn — không cần một trang riêng.
 */
export function PrepAnswersForm({ token, answers }: { token: string; answers: PrepQuestion[] }) {
  const [state, action] = useFormState<PrepAnswersState, FormData>(
    savePrepAnswersAction.bind(null, token),
    INITIAL_PREP_ANSWERS_STATE
  );

  return (
    <form action={action} onReset={keepFormValues} className="grid gap-4">
      <p className="text-sm text-slate-600">
        Không bắt buộc, nhưng giúp mentor chuẩn bị tốt hơn cho buổi trò chuyện với bạn. Bạn có thể
        điền ngay bây giờ hoặc quay lại điền sau — lưu lại là ghi đè câu trả lời cũ (nếu có).
      </p>
      {MENTEE_PREP_QUESTIONS.map((q, index) => (
        <label key={q.rawPayloadKey} className="grid gap-1 text-sm">
          <span className="font-medium text-vam-ink">
            {index + 1}. {q.question}
          </span>
          <span className="text-xs text-slate-500">{q.hint}</span>
          <textarea
            name={q.rawPayloadKey}
            rows={3}
            maxLength={2000}
            defaultValue={answers[index]?.value ?? ""}
            className="rounded-md border border-slate-300 bg-white p-2 text-sm"
          />
        </label>
      ))}
      {state.status !== "idle" && state.message ? (
        <p
          role={state.status === "success" ? "status" : "alert"}
          className={state.status === "success" ? "text-sm text-vam-green" : "text-sm text-red-700"}
        >
          {state.message}
        </p>
      ) : null}
      <button type="submit" className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white">
        Lưu câu trả lời
      </button>
    </form>
  );
}

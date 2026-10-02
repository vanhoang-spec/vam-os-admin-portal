"use client";

import { useFormState } from "react-dom";
import { keepFormValues } from "@/lib/keep-form-values";
import { bookSessionAction, changeSessionAction } from "./actions";
import {
  INITIAL_SESSION_BOOKING_STATE,
  type SessionBookingState
} from "@/lib/mentee-interview-action-types";
import type { MenteeSessionDay } from "@/lib/mentee-interview-core";
import { MENTEE_PREP_QUESTIONS } from "@/lib/email-core";

/**
 * Lưới 12 ca, dùng cho cả hai việc: chọn ca lần đầu và đổi sang ca khác.
 *
 * Mỗi ca là một nút gửi mang chính id của nó, nên biểu mẫu không cần trạng thái
 * "đang chọn cái nào" — bấm là gửi luôn, đúng một lần chạm. Trên điện thoại,
 * một bước xác nhận nữa chỉ là một cơ hội nữa để người dùng bỏ dở.
 *
 * Ca không bấm được thì render thành ô mờ KHÔNG phải nút: một nút trông bấm
 * được mà bấm vào chỉ để nhận lời từ chối là thứ người dùng sẽ thử ba lần.
 */
export function SessionForm({
  token,
  days,
  mode = "book",
  currentSessionId = null,
  prepAnswers = null
}: {
  token: string;
  days: MenteeSessionDay[];
  mode?: "book" | "change";
  currentSessionId?: string | null;
  /** Chế độ chọn ca lần đầu: hai câu hỏi chuẩn bị bắt buộc nằm ngay trong form (BTC 02/10/2026). */
  prepAnswers?: string[] | null;
}) {
  const [state, action] = useFormState<SessionBookingState, FormData>(
    (mode === "change" ? changeSessionAction : bookSessionAction).bind(null, token),
    INITIAL_SESSION_BOOKING_STATE
  );

  const nhanNut = mode === "change" ? "Đổi sang ca này" : null;

  return (
    <form action={action} onReset={keepFormValues} className="grid gap-5">
      {state.status === "error" ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      ) : null}

      {prepAnswers ? (
        <fieldset className="grid gap-3 rounded-md border border-vam-line p-3">
          <legend className="px-1 text-sm font-semibold text-vam-ink">Bước 1 — Trả lời 2 câu hỏi (bắt buộc)</legend>
          {MENTEE_PREP_QUESTIONS.map((q, index) => (
            <label key={q.rawPayloadKey} className="grid gap-1 text-sm">
              <span className="font-medium text-vam-ink">{index + 1}. {q.question}</span>
              <span className="text-xs text-slate-500">{q.hint}</span>
              <textarea name={q.rawPayloadKey} required rows={3} maxLength={2000} defaultValue={prepAnswers[index] ?? ""}
                className="rounded-md border border-slate-300 bg-white p-2 text-sm" />
            </label>
          ))}
          <p className="text-xs text-slate-500">Bước 2 — bấm vào ca bạn chọn bên dưới. Câu trả lời được lưu cùng lúc giữ chỗ.</p>
        </fieldset>
      ) : null}

      {days.map((day) => (
        <div key={day.dateKey}>
          <h3 className="mb-2 text-sm font-semibold text-vam-ink">{day.label}</h3>
          <div className="grid gap-2">
            {day.sessions.map((session) => {
              // Ca đang giữ không phải một lựa chọn để đổi sang. Hiện nó như một
              // nút sẽ dẫn tới lời từ chối "đây đang là ca của bạn rồi".
              if (session.id === currentSessionId) {
                return (
                  <div
                    key={session.id}
                    className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border-2 border-vam-green bg-vam-mint/40 px-4 py-3 text-sm font-semibold text-vam-ink"
                  >
                    <span>{session.timeLabel}</span>
                    <span className="text-xs font-medium text-vam-green">Ca hiện tại của bạn</span>
                  </div>
                );
              }

              return session.state === "open" ? (
                <button
                  key={session.id}
                  type="submit"
                  name="sessionId"
                  value={session.id}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border border-vam-green bg-white px-4 py-3 text-left text-sm font-semibold text-vam-green hover:bg-vam-mint"
                >
                  <span>
                    {session.timeLabel}
                    {nhanNut ? <span className="ml-2 text-xs font-medium">· {nhanNut}</span> : null}
                  </span>
                  <span className="text-xs font-medium text-slate-500">còn {session.remaining} chỗ</span>
                </button>
              ) : (
                <div
                  key={session.id}
                  aria-disabled="true"
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border border-vam-line bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-400"
                >
                  <span>{session.timeLabel}</span>
                  <span className="text-xs">{session.note}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </form>
  );
}

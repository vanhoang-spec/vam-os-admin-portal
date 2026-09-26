"use client";

import { useFormState } from "react-dom";
import { keepFormValues } from "@/lib/keep-form-values";
import { bookSessionAction, changeSessionAction } from "./actions";
import {
  INITIAL_SESSION_BOOKING_STATE,
  type SessionBookingState
} from "@/lib/mentee-interview-action-types";
import type { MenteeSessionDay } from "@/lib/mentee-interview-core";

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
  currentSessionId = null
}: {
  token: string;
  days: MenteeSessionDay[];
  mode?: "book" | "change";
  currentSessionId?: string | null;
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
